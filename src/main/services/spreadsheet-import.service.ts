import nodeFs from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { fileURLToPath, pathToFileURL } from "node:url";
import Papa from "papaparse";
import XLSX from "xlsx-republish";
import { buildCsvImportPreview, buildImportPreviewFromRows, type NormalizedImportRow } from "./csv-import.service.js";
import type { CsvImportPreview, DirectoryDataset } from "../../shared/types/contact.js";

const MAX_SPREADSHEET_IMPORT_SIZE_BYTES = 5 * 1024 * 1024;
const MAX_SPREADSHEET_IMPORT_ROWS = 5000;
const MAX_SPREADSHEET_IMPORT_WORKER_TIMEOUT_MS = 5_000;
const IS_VITEST_RUNTIME = process.env.VITEST === "true";

XLSX.set_fs(nodeFs);
const NORMALIZED_TEMPLATE_HEADERS = new Set([
  "externalId",
  "type",
  "displayName",
  "firstName",
  "lastName",
  "area",
  "department",
  "service",
  "specialty",
  "building",
  "floor",
  "room",
  "locationText",
  "phone1Label",
  "phone1Number",
  "phone1Extension",
  "phone1Kind",
  "phone1IsPrimary",
  "phone1Confidential",
  "phone1NoPatientSharing",
  "phone1Notes",
  "phone2Label",
  "phone2Number",
  "phone2Extension",
  "phone2Kind",
  "phone2IsPrimary",
  "phone2Confidential",
  "phone2NoPatientSharing",
  "phone2Notes",
  "email1",
  "email1Label",
  "email1IsPrimary",
  "email2",
  "email2Label",
  "email2IsPrimary",
  "tags",
  "aliases",
  "notes",
  "status"
]);

const SERVICE_SHEETS: Record<string, { area: string; department: string }> = {
  "admision-central": { area: "gestion-administracion", department: "Admisión Central" },
  rayos: { area: "especialidades", department: "Rayos" },
  secretarias: { area: "gestion-administracion", department: "Secretarías" },
  urgencias: { area: "sanitaria-asistencial", department: "Urgencias" },
  "hospitales-de-dia": { area: "sanitaria-asistencial", department: "Hospitales de día" },
  umi: { area: "sanitaria-asistencial", department: "UMI" }
};

const CENTER_SERVICE_LABELS: Record<string, string> = {
  "INF.": "Información",
  "ADM.": "Administración",
  "URG.": "Urgencias",
  URGENCIAS: "Urgencias",
  "FAX.": "Fax",
  FAX: "Fax"
};

const EXCLUDED_PATTERNS = [
  /^servicio$/i,
  /^n[uú]mero/i,
  /^centros de salud$/i,
  /^sala[s]?$/i,
  /^[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ\s\-.\(\)0-9]+$/
];

const NO_SHARE_MARKERS = [
  "NO DAR A LA CALLE",
  "NO PASAR DESPACHO MÉDICO",
  "NO DAR EL NÚMERO LARGO A LA CALLE",
  "NO PASAR LLAMADAS EXTERNAS",
  "NO HACEN CAMBIOS DE CITAS"
];

const CONFIDENTIAL_MARKERS = [
  "DESPACHO MÉDICO",
  "INTERNAL USE ONLY"
];

type SheetData = {
  name: string;
  slug: string;
  rows: string[][];
};

type DetectionConfidence = "high" | "medium" | "low";

export type SpreadsheetImportNormalizationResult = {
  rows: NormalizedImportRow[];
  detectedFormat: string;
  detectionConfidence: DetectionConfidence;
};

type SheetProfile = {
  parser: "centers" | "service";
  canonicalSlug: string;
  department: string;
  area?: string;
  rowsToSkip: number;
  detectedFormat: string;
  detectionConfidence: DetectionConfidence;
};

const clean = (value: string) => value.replace(/\u00a0/g, " ").split(/\s+/).filter(Boolean).join(" ").trim();

/**
 * A serialized phone entry stored as JSON in NormalizedImportRow["phones"].
 * Carrying this structured form lets the normalization layer pass an unbounded
 * list of phones through the flat Record<string,string> intermediate without
 * capping at phone1/phone2.
 */
export type SerializedPhoneEntry = {
  number: string;
  label: string;
  kind: string;
  isPrimary: boolean;
  confidential: boolean;
  noPatientSharing: boolean;
  notes?: string;
};

/**
 * Normalizes a displayName for cross-sheet identity matching:
 * trim + lowercase + strip diacritics/accents.
 * Two names that are equal after this transform are considered the same contact.
 * Exact normalized equality only \u2014 no fuzzy matching.
 */
const normalizeDisplayNameForMerge = (name: string): string =>
  name
    .trim()
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ");

/**
 * Normalizes a phone number for deduplication purposes:
 * strip all non-digit characters.
 */
const normalizeNumberForDedup = (number: string): string => number.replace(/\D/g, "");

const normalizeAscii = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "sheet";

const normalizeMarker = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toUpperCase()
    .replace(/\s+/g, "");

const dedupeKeepOrder = (values: string[]) => {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    if (seen.has(value)) {
      continue;
    }

    seen.add(value);
    result.push(value);
  }

  return result;
};

const isExcludedLabel = (label: string) => {
  const value = clean(label);

  if (!value) {
    return true;
  }

  const normalized = normalizeMarker(value);

  if (normalized === "INDICEAGENDA" || normalized === "INDICEAGENDAHOSPITALARIA") {
    return true;
  }

  return EXCLUDED_PATTERNS.some((pattern) => {
    if (!pattern.test(value)) {
      return false;
    }

    if (/\d/.test(value) && value.split(" ").length > 3) {
      return false;
    }

    return true;
  });
};

const expandCompactRange = (part: string) => {
  const match = /^(\d+)-(\d+)$/.exec(part);

  if (!match) {
    return null;
  }

  const [, startRaw, endSuffix] = match;

  if (startRaw.length <= endSuffix.length) {
    return null;
  }

  const prefix = startRaw.slice(0, startRaw.length - endSuffix.length);
  const start = Number(startRaw);
  const end = Number(`${prefix}${endSuffix}`);

  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || end - start > 20) {
    return null;
  }

  return Array.from({ length: end - start + 1 }, (_, index) => String(start + index));
};

const expandCompactSuffix = (previousDigits: string | undefined, currentPart: string) => {
  const currentDigits = currentPart.replace(/\D/g, "");

  if (!previousDigits || currentDigits.length === 0 || currentDigits.length >= previousDigits.length) {
    return null;
  }

  const prefix = previousDigits.slice(0, previousDigits.length - currentDigits.length);
  const candidate = `${prefix}${currentDigits}`;

  return /^\d+$/.test(candidate) ? candidate : null;
};

const extractNumbers = (text: string) => {
  const value = clean(text);

  if (!value) {
    return [];
  }

  const results: string[] = [];
  let previousDigits: string | undefined;

  for (const part of value.split(/\s*\/\s*/)) {
    const normalizedPart = clean(part);

    if (!normalizedPart) {
      continue;
    }

    const expanded = expandCompactRange(normalizedPart);

    if (expanded) {
      results.push(...expanded);
      previousDigits = expanded[expanded.length - 1];
      continue;
    }

    const digits = normalizedPart.replace(/\D/g, "");

    if (digits.length >= 4) {
      results.push(digits);
      previousDigits = digits;
      continue;
    }

    const expandedSuffix = expandCompactSuffix(previousDigits, normalizedPart);

    if (expandedSuffix) {
      results.push(expandedSuffix);
      previousDigits = expandedSuffix;
    }
  }

  return dedupeKeepOrder(results);
};

const detectPrivacy = (notes: string): { confidential: boolean; noPatientSharing: boolean } => {
  const upper = notes.toUpperCase();
  return {
    confidential: CONFIDENTIAL_MARKERS.some((marker) => upper.includes(marker)),
    noPatientSharing: NO_SHARE_MARKERS.some((marker) => upper.includes(marker))
  };
};

const cleanNoteFragments = (values: string[]) =>
  values
    .map((value) => clean(value))
    .filter((value) => {
      if (!value) {
        return false;
      }

      const marker = normalizeMarker(value);
      return marker !== "INDICEAGENDA" && marker !== "INDICEAGENDAHOSPITALARIA";
    });

const looksLikePerson = (label: string) => {
  const lower = label.toLowerCase();
  return ["dr.", "dra.", "laura", "juan", "lidia", "tere", "cris", "ana ", "david ", "natalia "]
    .some((marker) => lower.includes(marker));
};

const classifyType = (label: string, sheetSlug: string) => {
  const lower = label.toLowerCase();

  if (lower.includes("supervisi")) {
    return "supervision";
  }

  if (lower.startsWith("sala") || lower.startsWith("qx ") || lower.includes("camas") || lower.includes("boxes")) {
    return "room";
  }

  if (lower.includes("mostrador") || lower.includes("control") || lower.includes("puerta")) {
    return "control";
  }

  if (sheetSlug === "centros-de-salud") {
    return "external-center";
  }

  if (looksLikePerson(label)) {
    return "person";
  }

  return "service";
};

const aliasesFromLabel = (label: string) => {
  const aliases: string[] = [];
  const upper = label.toUpperCase();

  if (upper.includes("TAC")) {
    aliases.push("scanner");
  }

  if (upper.includes("RX")) {
    aliases.push("radiologia");
  }

  if (upper.includes("UMI")) {
    aliases.push("uci");
  }

  if (upper.includes("SECRETAR")) {
    aliases.push("secretaria");
  }

  return dedupeKeepOrder(aliases).join("|");
};

const blankRecord = (): NormalizedImportRow => ({
  externalId: "",
  type: "",
  displayName: "",
  firstName: "",
  lastName: "",
  area: "",
  department: "",
  service: "",
  specialty: "",
  building: "",
  floor: "",
  room: "",
  locationText: "",
  phone1Label: "",
  phone1Number: "",
  phone1Extension: "",
  phone1Kind: "",
  phone1IsPrimary: "",
  phone1Confidential: "",
  phone1NoPatientSharing: "",
  phone1Notes: "",
  phone2Label: "",
  phone2Number: "",
  phone2Extension: "",
  phone2Kind: "",
  phone2IsPrimary: "",
  phone2Confidential: "",
  phone2NoPatientSharing: "",
  phone2Notes: "",
  email1: "",
  email1Label: "",
  email1IsPrimary: "",
  email2: "",
  email2Label: "",
  email2IsPrimary: "",
  tags: "",
  aliases: "",
  notes: "",
  status: ""
});

const buildStableExternalId = (parts: Array<string | undefined>) =>
  parts
    .map((part) => normalizeAscii(part ?? ""))
    .filter(Boolean)
    .join("-") || "row";

const buildCenterPhones = (longNumber: string, shortNumber: string) => {
  const longNumbers = extractNumbers(longNumber);
  const shortNumbers = extractNumbers(shortNumber);

  return longNumbers.slice(0, 2).map((number, index) => ({
    number,
    extension: shortNumbers[index] ?? undefined
  }));
};

const stripBom = (value: string) => value.replace(/^\uFEFF/, "");
const hasLetters = (value: string) => /[A-Za-zÁÉÍÓÚáéíóúÑñ]/.test(value);
const looksLikeDateValue = (value: string) => {
  const normalized = clean(value);

  if (!normalized) {
    return false;
  }

  return /^(\d{1,4})[\/.-](\d{1,2})[\/.-](\d{1,4})$/.test(normalized);
};

const hasPhoneLikeNumber = (value: string) =>
  !looksLikeDateValue(value) && extractNumbers(value).some((number) => number.length >= 4 && number.length <= 9);

const isMeaningfulServiceLabel = (value: string) => {
  const normalized = clean(value);

  if (!normalized || !hasLetters(normalized) || isExcludedLabel(normalized) || looksLikeDateValue(normalized)) {
    return false;
  }

  return !/^\d/.test(normalized);
};

const prettifyLabel = (value: string) =>
  clean(
    value
      .replace(/[_-]+/g, " ")
      .toLowerCase()
      .replace(/\b\w/g, (match) => match.toUpperCase())
  );

const inferAreaFromLabel = (value: string) => {
  const normalized = normalizeAscii(value);

  if (/(urgencias|hospitales-de-dia|hospitalizacion|planta|umi|quirofanos|quirofanos|criticos|uci)/.test(normalized)) {
    return "sanitaria-asistencial";
  }

  if (/(admision|secretarias|secretaria|citas|usuario|almacenes|telecomunicaciones)/.test(normalized)) {
    return "gestion-administracion";
  }

  if (/(rayos|cc-ee|consulta|consulta|especialidades)/.test(normalized)) {
    return "especialidades";
  }

  return undefined;
};

/**
 * Slugs that indicate a navigation/TOC sheet (no real contact data).
 * Slugs are produced by normalizeAscii (lower, diacritics stripped, non-alnum→"-").
 * "indice*" covers "Índice_Agenda_Telefónica" → "indice-agenda-telefonica" etc.
 * "original" covers a literal sheet named "Original" used as a reference copy.
 */
const NAVIGATION_SHEET_SLUG_PREFIXES = ["indice"];
const NAVIGATION_SHEET_SLUG_EXACT = new Set(["original"]);

const isNavigationSheet = (slug: string): boolean => {
  if (NAVIGATION_SHEET_SLUG_EXACT.has(slug)) {
    return true;
  }
  return NAVIGATION_SHEET_SLUG_PREFIXES.some((prefix) => slug.startsWith(prefix));
};

/**
 * INTERIM (OIR-102): Slug prefix for Buscas sheets (pager/localizador system).
 *
 * Sheets like Buscas_Facultativos, Buscas_Enfermería, Buscas_Celadores, and
 * Buscas_Varios belong to the separate Buscas (pager/localizador) section that
 * has its own data store (BuscasService / buscas.json) and is NOT part of the
 * phone-directory contact import pipeline.  Their rows use 4-digit pager codes,
 * not phone numbers, and their column header "PRINCIPAL / RESIDENTE" would be
 * mistakenly parsed as a contact name, causing spurious rejections.
 *
 * These sheets are skipped here — kept distinct from isNavigationSheet so the
 * reason is explicit and easy to remove once a proper Buscas ODS-import path
 * is built.  Tracked as a future Linear feature (child of OIR-102).
 */
const BUSCAS_SHEET_SLUG_PREFIX = "buscas";

/** Returns true when the sheet is a deferred-feature Buscas (pager) sheet. */
const isDeferredFeatureSheet = (slug: string): boolean =>
  slug.startsWith(BUSCAS_SHEET_SLUG_PREFIX);

/**
 * INTERIM (OIR-102): Returns true when a resolved row label looks like a
 * social-media handle rather than a real contact name.
 *
 * Predicate: the label is a single whitespace-free token, entirely lowercase
 * (no capital letters), contains no digits, and is at least 8 characters long.
 *
 * This precisely targets patterns like "hospitaldrnegrin" (the hospital's
 * Instagram/Facebook handle stored in the ODS alongside the phone number of
 * the Comunicaciones / Redes Sociales row) while leaving real contact names
 * untouched:
 *   - Multi-word names ("Banco de Sangre", "Dr. García") contain spaces → not matched.
 *   - Title-case names ("Secretaria", "Resonancia") have an uppercase first
 *     letter → not matched.
 *   - Names that are single lowercase words but do have phone numbers (e.g.
 *     "secretaria 70979") are never affected because the skip fires ONLY when
 *     dedupedPhoneNumbers.length === 0.
 *   - A real name with a missing number (incomplete contact the operator needs
 *     to see as REJECTED) will almost always be multi-word or title-case, so
 *     it is NOT matched and continues to surface as a rejection.
 *
 * Social media as a contact method is a planned future feature; this skip is
 * the minimal interim guard until that feature exists (sibling of OIR-102).
 */
const isSocialHandle = (label: string): boolean => {
  if (/\s/.test(label)) return false;       // spaces → multi-word → real name
  if (/\d/.test(label)) return false;       // digits → phone-like or code → not a handle
  if (label.length < 8) return false;       // too short to be a concatenated handle
  if (label !== label.toLowerCase()) return false; // uppercase → title-case → real name
  return /[a-z]/.test(label);              // must contain at least one ASCII lowercase letter
};

const SAME_AS_CANONICAL = new Set(Object.keys(SERVICE_SHEETS));

const SERVICE_PROFILE_ALIASES: Record<string, string> = {
  ...Object.fromEntries([...SAME_AS_CANONICAL].map((slug) => [slug, slug])),
  urgencias: "urgencias",
  rayos: "rayos",
  secretarias: "secretarias",
  "secretarias-medicas": "secretarias",
  "admision-central": "admision-central",
  "admision central": "admision-central",
  "admisión central": "admision-central",
  "hospitales-de-dia": "hospitales-de-dia",
  "hospitales de dia": "hospitales-de-dia",
  "hospitales de día": "hospitales-de-dia",
  umi: "umi"
};

const resolveServiceRowLabel = (cells: string[]) => {
  const firstCell = cells[0] ?? "";

  if (firstCell && !isExcludedLabel(firstCell)) {
    return firstCell;
  }

  return cells.find((cell, index) =>
    index > 0 &&
    cell &&
    hasLetters(cell) &&
    !isExcludedLabel(cell) &&
    extractNumbers(cell).length === 0
  ) ?? "";
};

const normalizeServiceSheet = (sheet: SheetData, profile: SheetProfile) => {
  const metadata = {
    area: profile.area ?? "otros",
    department: profile.department,
    slug: profile.canonicalSlug
  };
  const data = sheet.rows.slice(profile.rowsToSkip);
  const records: NormalizedImportRow[] = [];
  let currentSection = "";

  data.forEach((row, rowIndex) => {
    const cells = row.map((value) => clean(value));
    const firstCell = cells[0] ?? "";
    const nonEmpty = cells.filter(Boolean);

    if (
      nonEmpty.length === 1 &&
      firstCell &&
      !["INDICEAGENDA", "INDICEAGENDAHOSPITALARIA"].includes(normalizeMarker(firstCell))
    ) {
      currentSection = firstCell;
      return;
    }

    // Fix (Bug B): isExcludedLabel uses an all-caps regex to catch section
    // headers (e.g. a lone "URGENCIAS" banner row).  But ALL-CAPS service names
    // like "BANCO DE SANGRE (ADMINISTRATIVO)" that appear in the same row as a
    // phone number are contact rows, not section headers.
    //
    // Strategy: compute rowHasPhone BEFORE resolving the label so we can apply
    // the phone-aware gate in two places:
    //   1. resolveServiceRowLabel returns "" when the first cell is all-caps
    //      excluded — if that happens but the row has a phone, fall back to the
    //      raw firstCell so the label is never lost.
    //   2. Gate all isExcludedLabel early-returns on !rowHasPhone so an
    //      all-caps label that co-occurs with a phone is kept as a contact name.
    const rowHasPhone = cells.slice(1).some((cell) => hasPhoneLikeNumber(cell));

    const resolvedLabel = resolveServiceRowLabel(cells);
    // When resolveServiceRowLabel excluded the first cell (returned "") but a
    // phone is present, use firstCell directly — it is the contact name.
    const label = resolvedLabel === "" && rowHasPhone && firstCell && hasLetters(firstCell)
      ? firstCell
      : resolvedLabel;

    if (label && isExcludedLabel(label) && !rowHasPhone) {
      return;
    }

    if (nonEmpty.length === 1 && label && cells[0] === label) {
      currentSection = label;
      return;
    }

    // Only drop an all-cells-excluded row when the row also has no phone.
    if (nonEmpty.length > 0 && !rowHasPhone && nonEmpty.every((value) => isExcludedLabel(value))) {
      return;
    }

    if (
      !rowHasPhone &&
      cells[0] === label &&
      nonEmpty.length > 1 &&
      nonEmpty.every((value, index) => index === 0 || isExcludedLabel(value) || extractNumbers(value).length === 0) &&
      extractNumbers(label).length === 0
    ) {
      currentSection = label;
      return;
    }

    if (!label) {
      return;
    }

    const phoneNumbers: string[] = [];
    const noteFragments: string[] = [];

    for (const cell of cells.slice(1)) {
      if (!cell) {
        continue;
      }

      const extracted = extractNumbers(cell);

      if (extracted.length > 0) {
        phoneNumbers.push(...extracted);
      }

      if (hasLetters(cell) && cell !== label) {
        noteFragments.push(...cleanNoteFragments([cell]));
      }
    }

    const dedupedPhoneNumbers = dedupeKeepOrder(phoneNumbers);

    if (dedupedPhoneNumbers.length === 0 && cells.slice(1).every((value) => !value)) {
      return;
    }

    // INTERIM (OIR-102): Skip social-media handle rows silently.
    //
    // Some ODS sheets contain a row whose resolved label is a social-media
    // handle (e.g. "hospitaldrnegrin" — the hospital's Instagram/Facebook
    // handle) with no phone number.  The handle appears because the operator
    // typed it next to the Comunicaciones/Redes Sociales phone row, and the
    // parser picks it up as the "label" via resolveServiceRowLabel's fallback.
    //
    // We skip it here rather than emitting a rejected record, because the
    // operator cannot fix it (there IS no phone number to add) and it blocks
    // the import unnecessarily.  A "missing phone" on a real contact (e.g.
    // "Dr. García" with no number yet) is NOT matched: real names are either
    // multi-word (contain spaces) or start with a capital letter, whereas a
    // social handle is all-lowercase, single-token, no digits, and 8+ chars.
    //
    // Social media as a contact method is a planned future feature; this guard
    // is the minimal interim skip until that feature exists (sibling of OIR-102).
    if (dedupedPhoneNumbers.length === 0 && isSocialHandle(label)) {
      return;
    }

    const labelNotes: string[] = [];

    if (currentSection && currentSection !== metadata.department) {
      labelNotes.push(`Sección: ${currentSection}`);
    }

    if (noteFragments.length > 0) {
      labelNotes.push(noteFragments.join(" | "));
    }

    const finalNotes = cleanNoteFragments(labelNotes).join(" | ");
    const privacySource = cleanNoteFragments([label, currentSection, finalNotes]).join(" | ");
    const privacy = detectPrivacy(privacySource);
    const record = blankRecord();
    const rowNumber = rowIndex + 1;

    record.externalId = `${metadata.slug}-${buildStableExternalId([
      metadata.department,
      currentSection && currentSection !== metadata.department ? currentSection : label,
      dedupedPhoneNumbers[0],
      dedupedPhoneNumbers[1]
    ])}`;
    record.type = classifyType(label, metadata.slug);
    record.displayName = label;
    record.area = metadata.area;
    record.department = metadata.department;
    record.service = currentSection && currentSection !== metadata.department ? currentSection : label;
    record.aliases = aliasesFromLabel(label);
    record.notes = finalNotes;
    record.status = "active";

    // Serialize ALL deduped phone numbers into the structured `phones` JSON
    // field so that the downstream buildPhones() can carry an unbounded list.
    // The label for each entry is the source sheet name (most informative
    // context for where the number came from). The first number is primary.
    const phoneEntries: SerializedPhoneEntry[] = dedupedPhoneNumbers.map((number, index) => ({
      number,
      label: sheet.name,
      kind: "internal",
      isPrimary: index === 0,
      confidential: privacy.confidential,
      noPatientSharing: privacy.noPatientSharing,
      notes: finalNotes || undefined
    }));
    record.phones = JSON.stringify(phoneEntries);

    // Keep phone1/phone2 populated for backward compatibility with any reader
    // that does not yet understand the phones JSON field.
    record.phone1Label = dedupedPhoneNumbers.length > 0 ? "Principal" : "";
    record.phone1Number = dedupedPhoneNumbers[0] ?? "";
    record.phone1Kind = dedupedPhoneNumbers.length > 0 ? "internal" : "";
    record.phone1IsPrimary = dedupedPhoneNumbers.length > 0 ? "true" : "false";
    record.phone1Confidential = privacy.confidential ? "true" : "false";
    record.phone1NoPatientSharing = privacy.noPatientSharing ? "true" : "false";
    record.phone1Notes = finalNotes;

    if (dedupedPhoneNumbers.length > 1) {
      record.phone2Label = "Secundario";
      record.phone2Number = dedupedPhoneNumbers[1] ?? "";
      record.phone2Kind = "internal";
      record.phone2IsPrimary = "false";
      record.phone2Confidential = privacy.confidential ? "true" : "false";
      record.phone2NoPatientSharing = privacy.noPatientSharing ? "true" : "false";
      record.phone2Notes = finalNotes;
    }

    records.push(record);
  });

  return records;
};

const splitCenterAddress = (raw: string) => {
  const value = clean(raw);
  let index = 0;
  const prefixChars: string[] = [];

  while (index < value.length) {
    const char = value[index]!;

    if (/[A-ZÁÉÍÓÚÜÑ ,.\-]/.test(char)) {
      prefixChars.push(char);
      index += 1;
      continue;
    }

    break;
  }

  if (prefixChars.length === 0) {
    return { center: value, address: "" };
  }

  let centerRaw = prefixChars.join("").trimEnd();
  let address = value.slice(index).trimStart();
  const nextThree = address.slice(0, 3);

  if (
    address &&
    centerRaw &&
    /[A-ZÁÉÍÓÚÜÑ]$/.test(centerRaw) &&
    nextThree.length === 3 &&
    /^[a-záéíóúüñ]{3}$/i.test(nextThree) &&
    nextThree === nextThree.toLowerCase()
  ) {
    address = `${centerRaw.slice(-1)}${address}`;
    centerRaw = centerRaw.slice(0, -1).trimEnd();
  }

  const center = clean(
    centerRaw
      .toLowerCase()
      .replace(/\b\w/g, (match) => match.toUpperCase())
  );

  return {
    center: center || value,
    address: clean(address)
  };
};

const normalizeCenterService = (value: string) => {
  const text = clean(value);
  return CENTER_SERVICE_LABELS[text.toUpperCase()] ?? text;
};

const looksLikeCenterHeader = (first: string, second: string) => {
  if (!first || !second) {
    return false;
  }

  if (!Object.values(CENTER_SERVICE_LABELS).includes(normalizeCenterService(second))) {
    return false;
  }

  const firstClean = clean(first);

  if (/\d/.test(firstClean)) {
    return true;
  }

  return ["c/", "carretera", "avda", "calle", "plaza", "paseo", "doctor", "médico", "medico"]
    .some((marker) => firstClean.toLowerCase().includes(marker));
};

const normalizeCentersSheet = (sheet: SheetData, profile: SheetProfile) => {
  const data = sheet.rows.slice(profile.rowsToSkip);
  const records: NormalizedImportRow[] = [];
  let currentCenter = "";
  let currentAddress = "";

  data.forEach((row, rowIndex) => {
    const cells = row.map((value) => clean(value));
    const first = cells[0] ?? "";
    const second = cells[1] ?? "";
    const third = cells[2] ?? "";
    const fourth = cells[3] ?? "";

    if (first && isExcludedLabel(first)) {
      return;
    }

    let service = "";
    let longNumber = "";
    let shortNumber = "";

    if (looksLikeCenterHeader(first, second)) {
      const normalized = splitCenterAddress(first);
      currentCenter = normalized.center;
      currentAddress = normalized.address;
      service = normalizeCenterService(second);
      longNumber = third;
      shortNumber = fourth;
    } else {
      if (!currentCenter) {
        return;
      }

      service = normalizeCenterService(second);
      longNumber = third;
      shortNumber = fourth;
    }

    if (!service) {
      return;
    }

    const phones = buildCenterPhones(longNumber, shortNumber);
    const record = blankRecord();
    record.externalId = `${profile.canonicalSlug}-${buildStableExternalId([
      currentCenter,
      service,
      phones[0]?.number,
      phones[1]?.number
    ])}`;
    record.type = "external-center";
    record.displayName = `${currentCenter} - ${service}`;
    record.area = "otros";
    record.department = "Centros de salud";
    record.service = service;
    record.locationText = currentAddress;
    record.aliases = currentCenter.toLowerCase();
    record.status = "active";

    if (phones.length > 0) {
      record.phone1Label = "General";
      record.phone1Number = phones[0]?.number ?? "";
      record.phone1Extension = phones[0]?.extension ?? "";
      record.phone1Kind = "external";
      record.phone1IsPrimary = "true";
      record.phone1Confidential = "false";
      record.phone1NoPatientSharing = "false";
    }

    if (phones.length > 1) {
      record.phone2Label = "Secundario";
      record.phone2Number = phones[1]?.number ?? "";
      record.phone2Extension = phones[1]?.extension ?? "";
      record.phone2Kind = "external";
      record.phone2IsPrimary = "false";
      record.phone2Confidential = "false";
      record.phone2NoPatientSharing = "false";
    }

    records.push(record);
  });

  return records;
};

const readSheetRows = (sheet: XLSX.WorkSheet) =>
  (XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: false,
    defval: "",
    blankrows: false
  }) as Array<Array<string | number | boolean | null>>)
    .map((row) => row.map((value) => clean(String(value ?? ""))))
    .filter((row) => row.some((value) => value));

const readWorkbookSheets = (sourceFilePath: string): SheetData[] => {
  const workbook = XLSX.readFile(sourceFilePath, {
    dense: true,
    raw: false,
    cellText: false
  });
  const fileSlug = normalizeAscii(path.parse(sourceFilePath).name);

  return workbook.SheetNames.map((sheetName) => {
    const rows = readSheetRows(workbook.Sheets[sheetName]!);
    const normalizedName = normalizeAscii(sheetName);
    const slug = normalizedName === "sheet1" || normalizedName === "hoja1" ? fileSlug : normalizedName;

    return {
      name: sheetName,
      slug,
      rows
    };
  });
};

const readCsvHeaders = async (sourceFilePath: string) => {
  const rawSource = await fs.readFile(sourceFilePath, "utf-8");
  const headerResult = Papa.parse<string[]>(rawSource, {
    preview: 1,
    skipEmptyLines: "greedy",
    transform: (value: string) => stripBom(value).trim()
  });

  return (headerResult.data[0] ?? []).map((header) => stripBom(header).trim());
};

const isNormalizedTemplateHeaders = (headers: string[]) => {
  if (headers.length === 0) {
    return false;
  }

  if (headers.some((header) => header.length === 0)) {
    return false;
  }

  const headerSet = new Set(headers);
  const recognizedTemplateHeaders = headers.filter((header) => NORMALIZED_TEMPLATE_HEADERS.has(header)).length;

  return recognizedTemplateHeaders >= 2 && headerSet.has("type") && headerSet.has("displayName");
};

const isNormalizedTemplateCsv = async (sourceFilePath: string) => {
  const headers = await readCsvHeaders(sourceFilePath);

  if (headers.length === 0) {
    return false;
  }

  return isNormalizedTemplateHeaders(headers);
};

const centersHeaderAliases = {
  center: new Set(["CENTROSDESALUD", "CENTRO", "CENTRODESALUD", "CENTROYDIRECCION"]),
  service: new Set(["SERVICIO", "UNIDAD", "AREA", "TIPO"]),
  longNumber: new Set(["NUMEROLARGO", "TELEFONOLARGO", "TLFLARGO", "LARGO", "TELEFONO"]),
  shortNumber: new Set(["NUMEROCORTO", "NUMEROINTERNO", "EXTENSION", "CORTO", "TLFCORTO"])
};

const serviceHeaderAliases = {
  label: new Set(["SERVICIO", "NOMBRE", "NOMBREVISIBLE", "CONTACTO", "UNIDAD"]),
  phone: new Set(["NUMERO", "NUMEROLARGO", "TELEFONO", "TELEFONO", "TLF", "EXTENSION"])
};

const detectHeaderRowIndex = (
  rows: string[][],
  scorer: (row: string[]) => number
) => {
  let bestIndex = -1;
  let bestScore = -1;

  rows.slice(0, 5).forEach((row, index) => {
    const score = scorer(row);

    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });

  return { index: bestIndex, score: bestScore };
};

const scoreCentersHeader = (row: string[]) => {
  const normalized = row.slice(0, 4).map((cell) => normalizeMarker(cell));
  let score = 0;

  if (centersHeaderAliases.center.has(normalized[0] ?? "")) score += 3;
  if (centersHeaderAliases.service.has(normalized[1] ?? "")) score += 2;
  if (centersHeaderAliases.longNumber.has(normalized[2] ?? "")) score += 2;
  if (centersHeaderAliases.shortNumber.has(normalized[3] ?? "")) score += 2;

  return score;
};

const scoreServiceHeader = (row: string[]) => {
  const normalized = row.slice(0, 4).map((cell) => normalizeMarker(cell));
  let score = 0;

  if (serviceHeaderAliases.label.has(normalized[0] ?? "")) score += 2;
  if (normalized.slice(1).some((cell) => serviceHeaderAliases.phone.has(cell))) score += 2;

  return score;
};

const hasStrictServiceHeader = (row: string[]) => {
  const normalized = row.slice(0, 4).map((cell) => normalizeMarker(cell));
  return ["SERVICIO", "UNIDAD"].includes(normalized[0] ?? "") &&
    normalized.slice(1).some((cell) => serviceHeaderAliases.phone.has(cell));
};

const analyzeRawServiceRows = (rows: string[][], startIndex = 0) => {
  let score = 0;
  let phoneBearingRows = 0;
  let continuationRows = 0;
  let sectionRows = 0;
  let meaningfulLabelRows = 0;
  const uniqueLabels = new Set<string>();

  rows.slice(startIndex, startIndex + 8).forEach((row) => {
    const cells = row.map((cell) => clean(cell));
    const label = resolveServiceRowLabel(cells);
    const labelLooksMeaningful = isMeaningfulServiceLabel(label);
    const phoneLikeCells = cells.filter((cell, index) => index > 0 && hasPhoneLikeNumber(cell)).length;
    const nonEmpty = cells.filter(Boolean);

    if (labelLooksMeaningful) {
      meaningfulLabelRows += 1;
      uniqueLabels.add(normalizeAscii(label));
    }

    if (labelLooksMeaningful && phoneLikeCells > 0) {
      score += 2;
      phoneBearingRows += 1;
    }

    if ((cells[0] ?? "") === "" && phoneLikeCells > 0) {
      score += 1;
      continuationRows += 1;
    }

    if (
      nonEmpty.length === 1 &&
      (cells[0] ?? "") &&
      isMeaningfulServiceLabel(cells[0] ?? "") &&
      !["INDICEAGENDA", "INDICEAGENDAHOSPITALARIA"].includes(normalizeMarker(cells[0] ?? ""))
    ) {
      sectionRows += 1;
    }
  });

  return {
    score,
    phoneBearingRows,
    continuationRows,
    sectionRows,
    meaningfulLabelRows,
    uniqueLabelCount: uniqueLabels.size
  };
};

/**
 * Counts rows that look like a flat contact row: first cell has at least one
 * letter, AND at least one non-first cell has a phone-like number.
 *
 * Unlike analyzeRawServiceRows / isMeaningfulServiceLabel this intentionally
 * does NOT apply isExcludedLabel so that ALL-CAPS service names such as
 * "BANCO DE SANGRE (ADMINISTRATIVO)" are counted.  It is only used as an
 * acceptance threshold in detectSheetProfile (Bug A fix).
 */
const countFlatPhoneBearingRows = (rows: string[][], startIndex = 0): number => {
  let count = 0;

  rows.slice(startIndex, startIndex + 20).forEach((row) => {
    const cells = row.map((cell) => clean(cell));
    const firstCell = cells[0] ?? "";
    const hasLetterInFirst = firstCell !== "" && hasLetters(firstCell);
    const phoneLikeCells = cells.filter((cell, index) => index > 0 && hasPhoneLikeNumber(cell)).length;

    if (hasLetterInFirst && phoneLikeCells > 0) {
      count += 1;
    }
  });

  return count;
};

const detectSheetProfile = (sheet: SheetData): SheetProfile | null => {
  if (sheet.rows.length === 0) {
    return null;
  }

  // Fix: skip navigation / TOC sheets by slug before any further analysis.
  if (isNavigationSheet(sheet.slug)) {
    return null;
  }

  // INTERIM (OIR-102): Skip Buscas (pager/localizador) sheets.
  // These belong to a separate app section that does not yet have an ODS-import
  // pipeline.  Their column header "PRINCIPAL / RESIDENTE" would be mistakenly
  // parsed as a contact and rejected, blocking the whole import.
  // Remove this guard when a proper Buscas import path is built.
  if (isDeferredFeatureSheet(sheet.slug)) {
    return null;
  }

  const normalizedSheetName = normalizeAscii(sheet.name);
  const canonicalFromName = SERVICE_PROFILE_ALIASES[normalizedSheetName] ?? SERVICE_PROFILE_ALIASES[sheet.slug];

  const centersHeader = detectHeaderRowIndex(sheet.rows, scoreCentersHeader);

  if (centersHeader.score >= 7) {
    return {
      parser: "centers",
      canonicalSlug: "centros-de-salud",
      department: "Centros de salud",
      area: "otros",
      rowsToSkip: centersHeader.index + 1,
      detectedFormat: "exportación cruda de centros de salud",
      detectionConfidence: "high"
    };
  }

  const serviceHeader = detectHeaderRowIndex(sheet.rows, scoreServiceHeader);
  const serviceRowsStartIndex = serviceHeader.score >= 3 ? serviceHeader.index + 1 : Math.max(serviceHeader.index, 0);
  const rawServiceSignals = analyzeRawServiceRows(sheet.rows, serviceRowsStartIndex);
  const strictServiceHeader = hasStrictServiceHeader(sheet.rows[serviceHeader.index] ?? []);
  const hasReliableHeaderBackedServiceEvidence =
    serviceHeader.score >= 3 &&
    rawServiceSignals.phoneBearingRows >= 1 &&
    (rawServiceSignals.sectionRows >= 1 || rawServiceSignals.continuationRows >= 1);
  const hasMinimalCanonicalServiceEvidence =
    Boolean(canonicalFromName) &&
    strictServiceHeader &&
    serviceHeader.score >= 3 &&
    rawServiceSignals.phoneBearingRows >= 1 &&
    rawServiceSignals.meaningfulLabelRows >= 1;
  const hasReliableRawServiceEvidence =
    rawServiceSignals.score >= 5 &&
    rawServiceSignals.phoneBearingRows >= 2 &&
    rawServiceSignals.meaningfulLabelRows >= 2 &&
    (rawServiceSignals.sectionRows >= 1 || rawServiceSignals.continuationRows >= 1);
  const hasStructuredServiceEvidence =
    hasReliableHeaderBackedServiceEvidence ||
    hasMinimalCanonicalServiceEvidence ||
    hasReliableRawServiceEvidence;

  if (canonicalFromName && hasStructuredServiceEvidence) {
    const metadata = SERVICE_SHEETS[canonicalFromName];
    const detectionConfidence: DetectionConfidence =
      hasReliableHeaderBackedServiceEvidence || hasReliableRawServiceEvidence ? "high" : "medium";

    return {
      parser: "service",
      canonicalSlug: canonicalFromName,
      department: metadata.department,
      area: metadata.area,
      rowsToSkip: serviceHeader.score >= 3 ? serviceHeader.index + 1 : 1,
      detectedFormat: "exportación cruda de hoja de servicios",
      detectionConfidence
    };
  }

  const derivedDepartment = (() => {
    const firstMeaningfulLabel = sheet.rows
      .slice(serviceHeader.score >= 3 ? serviceHeader.index + 1 : 0, 8)
      .map((row) => resolveServiceRowLabel(row.map((cell) => clean(cell))))
      .find(Boolean);

    if (firstMeaningfulLabel) {
      return prettifyLabel(firstMeaningfulLabel);
    }

    return prettifyLabel(sheet.name);
  })();

  if (
    hasReliableHeaderBackedServiceEvidence ||
    (
      rawServiceSignals.score >= 8 &&
      rawServiceSignals.phoneBearingRows >= 3 &&
      rawServiceSignals.meaningfulLabelRows >= 2 &&
      rawServiceSignals.sectionRows >= 1 &&
      rawServiceSignals.continuationRows >= 1
    )
  ) {

    return {
      parser: "service",
      canonicalSlug: normalizeAscii(derivedDepartment),
      department: derivedDepartment,
      area: inferAreaFromLabel(derivedDepartment),
      rowsToSkip: serviceHeader.score >= 3 ? serviceHeader.index + 1 : 0,
      detectedFormat: "exportación cruda de hoja de servicios",
      detectionConfidence: serviceHeader.score >= 3 ? "high" : "medium"
    };
  }

  // Fix (Bug A): Generic flat label+phone acceptance.
  //
  // Flat service sheets (e.g. Banco de Sangre index sheets A/B/S/D,
  // Telefonos_emergencias, Corporativos, etc.) have zero section rows and zero
  // continuation rows, so all evidence paths above reject them.  However they
  // ARE real contact tables: every row is simply [label, phone, ...].
  //
  // We accept a sheet as a generic flat service sheet when at least 3 rows
  // have a non-empty first cell with letters AND at least one phone-like value
  // in a subsequent cell.  countFlatPhoneBearingRows intentionally skips
  // isExcludedLabel so that ALL-CAPS multi-word service names (Bug B companion)
  // are counted; those rows are handled at parse time.
  //
  // Threshold of 3 is conservative: it admits real contact sheets (which always
  // have many rows) while rejecting 1- or 2-row tables that only mimic the
  // label+phone layout (e.g. budget or scheduling sheets with two entries).
  const flatStartIndex = serviceHeader.score >= 3 ? serviceHeader.index + 1 : 0;
  const flatPhoneBearingRows = countFlatPhoneBearingRows(sheet.rows, flatStartIndex);

  if (flatPhoneBearingRows >= 3) {
    return {
      parser: "service",
      canonicalSlug: normalizeAscii(derivedDepartment),
      department: derivedDepartment,
      area: inferAreaFromLabel(derivedDepartment),
      rowsToSkip: flatStartIndex,
      detectedFormat: "exportación cruda de hoja de servicios",
      detectionConfidence: "low"
    };
  }

  return null;
};

const summarizeDetectedFormat = (profiles: SheetProfile[]) => {
  const kinds = new Set(profiles.map((profile) => profile.detectedFormat));
  const confidence: DetectionConfidence = profiles.some((profile) => profile.detectionConfidence === "low")
    ? "low"
    : profiles.some((profile) => profile.detectionConfidence === "medium")
      ? "medium"
      : "high";

  return {
    detectedFormat: kinds.size === 1 ? [...kinds][0]! : "hoja de cálculo cruda mixta",
    detectionConfidence: confidence
  };
};

/**
 * Merges service-sheet NormalizedImportRows that share the same normalized
 * displayName (trim + lowercase + strip diacritics) into a single row.
 *
 * Merge rules (confirmed with operator):
 * - Identity key: exact normalized displayName equality only (no fuzzy match).
 * - Phones: combine all SerializedPhoneEntry lists; deduplicate by normalized
 *   digit string; keep first occurrence. Each phone retains the source sheet
 *   label it was tagged with in normalizeServiceSheet.
 * - externalId: the FIRST record's externalId is kept (deterministic, stable
 *   across re-imports of the same file PROVIDED sheet order in the workbook is
 *   unchanged — reordering tabs changes which sheet is "first" and therefore
 *   which externalId is selected, which can produce a duplicate on re-import).
 * - All other scalar fields (type, area, department, service, aliases, notes,
 *   status): taken from the first record in the group.
 * - phone1/phone2 flat fields: rewritten to match the merged phones list so
 *   any reader that uses only those fields still gets the primary number.
 * - Records without a `phones` JSON field (e.g. centers-parser records) are
 *   passed through unchanged — they are never merged.
 */
const mergeRecordsByDisplayName = (records: NormalizedImportRow[]): NormalizedImportRow[] => {
  // Separate records that carry the structured phones field from those that don't.
  const mergeableRecords: NormalizedImportRow[] = [];
  const passthroughRecords: NormalizedImportRow[] = [];

  for (const record of records) {
    if (record.phones !== undefined && record.phones !== "") {
      mergeableRecords.push(record);
    } else {
      passthroughRecords.push(record);
    }
  }

  // Group mergeable records by normalized displayName, preserving insertion order.
  const groups = new Map<string, NormalizedImportRow[]>();

  for (const record of mergeableRecords) {
    const key = normalizeDisplayNameForMerge(record.displayName);
    const existing = groups.get(key);

    if (existing) {
      existing.push(record);
    } else {
      groups.set(key, [record]);
    }
  }

  const merged: NormalizedImportRow[] = [];

  for (const group of groups.values()) {
    // Single-record groups need no merging.
    if (group.length === 1) {
      merged.push(group[0]!);
      continue;
    }

    // Combine all phone entries from every record in the group.
    const combinedPhones: SerializedPhoneEntry[] = [];
    const seenNormalized = new Set<string>();

    for (const record of group) {
      let entries: SerializedPhoneEntry[] = [];

      try {
        const parsed = JSON.parse(record.phones ?? "[]");
        if (Array.isArray(parsed)) entries = parsed as SerializedPhoneEntry[];
      } catch {
        // Malformed JSON is treated as no phones for this record.
      }

      for (const entry of entries) {
        const normalized = normalizeNumberForDedup(entry.number);

        if (normalized && !seenNormalized.has(normalized)) {
          seenNormalized.add(normalized);
          combinedPhones.push(entry);
        }
      }
    }

    // Re-assert primary: first phone is primary, rest are not.
    const reassertedPhones = combinedPhones.map((phone, index) => ({
      ...phone,
      isPrimary: index === 0
    }));

    // Build the merged record from the first record in the group (keeps its
    // externalId and other scalar fields stable for re-import).
    const base = { ...group[0]! };
    base.phones = JSON.stringify(reassertedPhones);

    // Rewrite phone1/phone2 flat fields to match merged result.
    const first = reassertedPhones[0];
    const second = reassertedPhones[1];

    base.phone1Label = first ? "Principal" : "";
    base.phone1Number = first?.number ?? "";
    base.phone1Kind = first ? "internal" : "";
    base.phone1IsPrimary = first ? "true" : "false";
    base.phone1Confidential = first?.confidential ? "true" : "false";
    base.phone1NoPatientSharing = first?.noPatientSharing ? "true" : "false";
    base.phone1Notes = first?.notes ?? "";
    base.phone2Label = second ? "Secundario" : "";
    base.phone2Number = second?.number ?? "";
    base.phone2Kind = second ? "internal" : "";
    base.phone2IsPrimary = "false";
    base.phone2Confidential = second?.confidential ? "true" : "false";
    base.phone2NoPatientSharing = second?.noPatientSharing ? "true" : "false";
    base.phone2Notes = second?.notes ?? "";

    merged.push(base);
  }

  // Reconstruct the final list in original encounter order: mergeable records
  // first (in key-insertion order), then passthrough.
  return [...merged, ...passthroughRecords];
};

export const normalizeWorkbookRowsFromFile = (
  sourceFilePath: string
): SpreadsheetImportNormalizationResult => {
  let sheets: SheetData[];

  try {
    sheets = readWorkbookSheets(sourceFilePath);
  } catch (error) {
    throw new Error(
      error instanceof Error && error.message.includes("Unsupported")
        ? "No se pudo leer la hoja de cálculo seleccionada. El formato del archivo no es compatible."
        : "No se pudo leer la hoja de cálculo seleccionada."
    );
  }

  const records: NormalizedImportRow[] = [];
  const profiles: SheetProfile[] = [];

  for (const sheet of sheets) {
    if (sheet.rows.length === 0) {
      continue;
    }

    const profile = detectSheetProfile(sheet);

    if (!profile) {
      continue;
    }

    profiles.push(profile);

    if (profile.parser === "centers") {
      records.push(...normalizeCentersSheet(sheet, profile));
      continue;
    }

    records.push(...normalizeServiceSheet(sheet, profile));
  }

  if (records.length === 0) {
    throw new Error(
      "No se encontraron hojas soportadas para importar. Usa Admisión Central, Urgencias, Rayos, Secretarías, Hospitales de día, UMI o Centros de salud."
    );
  }

  // Merge records that share the same normalized displayName across sheets.
  const mergedRecords = mergeRecordsByDisplayName(records);

  return {
    rows: mergedRecords,
    ...summarizeDetectedFormat(profiles)
  };
};

type SpreadsheetImportWorkerResponse =
  | { type: "success"; result: SpreadsheetImportNormalizationResult }
  | { type: "error"; message: string };

type SpreadsheetImportWorker = Pick<Worker, "once" | "terminate">;

type SpreadsheetImportWorkerFactory = (sourceFilePath: string) => SpreadsheetImportWorker;

type ReadWorkbookRowsInWorkerOptions = {
  timeoutMs?: number;
  workerFactory?: SpreadsheetImportWorkerFactory;
};

const createSpreadsheetImportWorker: SpreadsheetImportWorkerFactory = (sourceFilePath) =>
  new Worker(
    pathToFileURL(fileURLToPath(new URL("./spreadsheet-import.worker.js", import.meta.url))),
    {
      execArgv: [],
      resourceLimits: {
        maxOldGenerationSizeMb: 128,
        maxYoungGenerationSizeMb: 32,
        stackSizeMb: 4
      },
      workerData: { sourceFilePath }
    }
  );

export const readWorkbookRowsInWorker = (
  sourceFilePath: string,
  options: ReadWorkbookRowsInWorkerOptions = {}
): Promise<SpreadsheetImportNormalizationResult> => {
  const timeoutMs = options.timeoutMs ?? MAX_SPREADSHEET_IMPORT_WORKER_TIMEOUT_MS;
  const workerFactory = options.workerFactory ?? createSpreadsheetImportWorker;

  return new Promise((resolve, reject) => {
    const worker = workerFactory(sourceFilePath);
    let settled = false;

    const settle = (handler: (value: SpreadsheetImportNormalizationResult | Error) => void) =>
      (value: SpreadsheetImportNormalizationResult | Error) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimeout(timeoutId);
        handler(value);
      };

    const resolveWorker = settle((value) => resolve(value as SpreadsheetImportNormalizationResult));
    const rejectWorker = settle((value) =>
      reject(value instanceof Error ? value : new Error("No se pudo leer la hoja de cálculo seleccionada."))
    );

    const timeoutId = setTimeout(() => {
      void worker.terminate().catch(() => {});
      rejectWorker(
        new Error(
          "No se pudo leer la hoja de cálculo seleccionada. El procesamiento tardó demasiado. Prueba con un archivo más pequeño o conviértelo a CSV."
        )
      );
    }, timeoutMs);

    worker.once("message", (payload: SpreadsheetImportWorkerResponse) => {
      if (payload?.type === "success") {
        resolveWorker(payload.result);
        return;
      }

      if (payload?.type === "error") {
        rejectWorker(new Error(payload.message));
        return;
      }

      rejectWorker(
        new Error(
          "No se pudo leer la hoja de cálculo seleccionada. El proceso de importación devolvió una respuesta no válida."
        )
      );
    });

    worker.once("error", (error) => {
      rejectWorker(
        new Error(
          error instanceof Error && error.name === "RangeError"
            ? "No se pudo leer la hoja de cálculo seleccionada. El archivo supera los límites seguros de procesamiento."
            : "No se pudo leer la hoja de cálculo seleccionada."
        )
      );
    });

    worker.once("exit", (code) => {
      if (settled) {
        return;
      }

      rejectWorker(
        new Error(
          code === 0
            ? "No se pudo leer la hoja de cálculo seleccionada. El proceso terminó sin respuesta."
            : "No se pudo leer la hoja de cálculo seleccionada. El proceso de importación terminó de forma inesperada."
        )
      );
    });
  });
};

export const buildSpreadsheetImportPreview = async (
  sourceFilePath: string,
  editorName: string
): Promise<{ dataset: DirectoryDataset; preview: CsvImportPreview }> => {
  const extension = path.extname(sourceFilePath).toLowerCase();
  const sourceStats = await fs.stat(sourceFilePath);

  if (sourceStats.size > MAX_SPREADSHEET_IMPORT_SIZE_BYTES) {
    throw new Error(
      extension === ".csv"
        ? "El CSV supera el tamaño máximo permitido de 5 MB. Divide el archivo antes de importarlo."
        : "El archivo supera el tamaño máximo permitido de 5 MB. Divide el archivo antes de importarlo."
    );
  }

  if (extension === ".csv" && await isNormalizedTemplateCsv(sourceFilePath)) {
    const result = await buildCsvImportPreview(sourceFilePath, editorName);

    return {
      ...result,
      preview: {
        ...result.preview,
        detectedFormat: "plantilla normalizada",
        detectionConfidence: "high"
      }
    };
  }

  if (![".csv", ".ods", ".xlsx", ".xls"].includes(extension)) {
    throw new Error("Formato no soportado. Usa CSV, ODS, XLSX o XLS.");
  }

  const normalized = IS_VITEST_RUNTIME
    ? normalizeWorkbookRowsFromFile(sourceFilePath)
    : await readWorkbookRowsInWorker(sourceFilePath);

  if (normalized.rows.length > MAX_SPREADSHEET_IMPORT_ROWS) {
    throw new Error(`El archivo supera el límite máximo de ${MAX_SPREADSHEET_IMPORT_ROWS} filas. Divide el archivo e importa en lotes.`);
  }

  return buildImportPreviewFromRows(normalized.rows, {
    sourceFilePath,
    fileName: path.basename(sourceFilePath),
    editorName,
    detectedFormat: normalized.detectedFormat,
    detectionConfidence: normalized.detectionConfidence
  });
};
