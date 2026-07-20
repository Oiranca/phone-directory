/**
 * spreadsheet-parsers.ts — Format-specific contact-record parsers for the
 * spreadsheet import pipeline.
 *
 * This module contains:
 *   - normalizeCentersSheet — parses the "Centros de salud" multi-column format
 *   - normalizeServiceSheet — parses internal service/department sheets
 *   - mergeRecordsByDisplayName — merges cross-sheet records with the same name
 *
 * All functions are PURE (no I/O, no worker, no heuristics). They receive
 * already-loaded sheet data and a profile produced by the heuristics layer
 * (detectSheetProfile in spreadsheet-import.service.ts), then return
 * NormalizedImportRow arrays.
 *
 * Extracted from spreadsheet-import.service.ts.
 * The heuristics that decide WHICH parser applies deliberately remain in the
 * main service.
 */

import type { NormalizedImportRow } from "./csv-import.service.js";
import type { DetectionConfidence } from "../../shared/types/contact.js";
import {
  clean,
  hasLetters,
  hasPhoneLikeNumber,
  looksLikeDateValue,
  extractNumbers,
  detectPrivacy,
  cleanNoteFragments,
  dedupeKeepOrder,
  aliasesFromLabel,
  normalizeDisplayNameForMerge,
  normalizeNumberForDedup,
  isSerializedPhoneEntry,
  normalizeMarker,
  normalizeAscii,
  isExcludedLabel,
  parseSiNoFlag,
} from "./spreadsheet-normalize.js";
import type { SerializedPhoneEntry } from "./spreadsheet-normalize.js";

/**
 * Serialized shape for a "busca" (pager) entry parsed from an inserted
 * "Busca 1" column (OIR-265). Mirrors the `record.phones` JSON-string
 * convention: pushed onto a per-row array, then stored on the
 * NormalizedImportRow as `record.buscas = JSON.stringify(buscaEntries)`.
 * Field shape matches `buscaEntrySchema` (src/shared/schemas/contact.ts).
 */
export type SerializedBuscaEntry = {
  number: string;
  label?: string;
};

// ---------------------------------------------------------------------------
// Record construction helpers (moved here from spreadsheet-normalize.ts to
// break the csv-import ↔ normalize circular dependency)
// ---------------------------------------------------------------------------

/** Returns a NormalizedImportRow with all fields set to empty strings. */
export const blankRecord = (): NormalizedImportRow => ({
  externalId: "",
  type: "",
  displayName: "",
  firstName: "",
  lastName: "",
  area: "",
  department: "",
  service: "",
  specialty: "",
  // Role/job title and operating hours (ODS "Categoría"/"Horario" columns).
  role: "",
  schedule: "",
  building: "",
  floor: "",
  room: "",
  locationText: "",
  // ODS "Sector"/"Sección" columns.
  sector: "",
  section: "",
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
  // Social media columns
  social1Platform: "",
  social1Handle: "",
  social1Url: "",
  social1Label: "",
  social1IsPrimary: "",
  social2Platform: "",
  social2Handle: "",
  social2Url: "",
  social2Label: "",
  social2IsPrimary: "",
  tags: "",
  aliases: "",
  notes: "",
  status: ""
});

/**
 * Builds a stable external ID by normalizing and joining the given parts
 * with dashes. Falls back to "row" when all parts are empty.
 */
export const buildStableExternalId = (parts: Array<string | undefined>) =>
  parts
    .map((part) => normalizeAscii(part ?? ""))
    .filter(Boolean)
    .join("-") || "row";

// ---------------------------------------------------------------------------
// Shared sheet data type (mirrors the private type in the main service)
// ---------------------------------------------------------------------------

export type SheetData = {
  name: string;
  slug: string;
  rows: string[][];
};

export type SheetProfile = {
  parser: "centers" | "service" | "tabular";
  canonicalSlug: string;
  department: string;
  area?: string;
  rowsToSkip: number;
  detectedFormat: string;
  detectionConfidence: DetectionConfidence;
};

// ---------------------------------------------------------------------------
// Centers-sheet constants and helpers
// ---------------------------------------------------------------------------

const CENTER_SERVICE_LABELS: Record<string, string> = {
  "INF.": "Información",
  "ADM.": "Administración",
  "URG.": "Urgencias",
  URGENCIAS: "Urgencias",
  "FAX.": "Fax",
  FAX: "Fax"
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

const buildCenterPhones = (longNumber: string, shortNumber: string) => {
  const longNumbers = extractNumbers(longNumber);
  const shortNumbers = extractNumbers(shortNumber);

  return longNumbers.slice(0, 2).map((number, index) => ({
    number,
    extension: shortNumbers[index] ?? undefined
  }));
};

// ---------------------------------------------------------------------------
// Centers-sheet parser
// ---------------------------------------------------------------------------

/**
 * Parses a "Centros de salud" sheet (multi-column format: center, service,
 * long number, short number) into NormalizedImportRow records.
 */
export const normalizeCentersSheet = (sheet: SheetData, profile: SheetProfile) => {
  const data = sheet.rows.slice(profile.rowsToSkip);
  const records: NormalizedImportRow[] = [];
  let currentCenter = "";
  let currentAddress = "";

  data.forEach((row) => {
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

// ---------------------------------------------------------------------------
// Service-sheet helpers
// ---------------------------------------------------------------------------

/**
 * Social context detection (see main service for full docs).
 */
const SOCIAL_CONTEXT_TOKENS = [
  "REDESSOCIALES",
  "RRSS",
  "INSTAGRAM",
  "FACEBOOK",
  "TWITTER",
  "LINKEDIN",
  "TIKTOK",
  "YOUTUBE"
] as const;

const rowContainsSocialToken = (cells: string[]): boolean =>
  SOCIAL_CONTEXT_TOKENS.some((token) =>
    cells.some((cell) => normalizeMarker(cell).includes(token))
  );

const sectionIsSocial = (section: string): boolean =>
  SOCIAL_CONTEXT_TOKENS.some((token) => normalizeMarker(section).includes(token));

/** Minimum character length for a label to be treated as a social-media handle. */
const MIN_SOCIAL_HANDLE_LENGTH = 8;

const isSocialContextRow = (label: string, hasSocialContext: boolean): boolean => {
  if (!hasSocialContext) {
    return false;
  }

  if (/\s/.test(label)) return false;
  if (/\d/.test(label)) return false;
  if (label.length < MIN_SOCIAL_HANDLE_LENGTH) return false;
  if (label !== label.toLowerCase()) return false;

  return /[a-z]/.test(label);
};

/**
 * Infers the social-media platform from one or more text sources.
 * Checks each source in order and returns the first recognized platform.
 * Falls back to "other" when no known platform is found in any source.
 * Accepts multiple sources so the call site can pass both the current section
 * heading and the raw row cells as fallbacks (handles the case where the
 * platform token appears in the same row as the handle, not a prior header).
 */
const inferSocialPlatformFromSection = (...sources: string[]): string => {
  for (const source of sources) {
    const normalized = normalizeMarker(source);
    if (normalized.includes("INSTAGRAM")) return "instagram";
    if (normalized.includes("TWITTER")) return "twitter";
    if (normalized.includes("FACEBOOK")) return "facebook";
    if (normalized.includes("LINKEDIN")) return "linkedin";
    if (normalized.includes("YOUTUBE")) return "youtube";
    if (normalized.includes("TIKTOK")) return "tiktok";
  }
  return "other";
};

/**
 * Resolves the display label for a service-sheet row from its cells.
 * Prefers the first non-empty, non-excluded, letter-bearing cell at index 0;
 * falls back to the first cell at a later index that has letters but no numbers.
 */
export const resolveServiceRowLabel = (cells: string[]) => {
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

// ---------------------------------------------------------------------------
// Service-sheet parser
// ---------------------------------------------------------------------------

/** Return shape of normalizeServiceSheet. */
export type NormalizeServiceSheetResult = {
  records: NormalizedImportRow[];
  /**
   * Social-handle rows are now imported as first-class contacts,
   * not skipped. This counter remains for interface stability but will always
   * be 0 for rows that have a valid handle. Only genuinely unmappable social
   * rows (no handle, no phone — effectively empty) are still skipped here.
   */
  socialSkippedRows: number;
};

/**
 * Parses an internal service/department sheet into NormalizedImportRow records.
 * Returns both the records and a count of rows silently skipped as social media.
 */
export const normalizeServiceSheet = (
  sheet: SheetData,
  profile: SheetProfile
): NormalizeServiceSheetResult => {
  const metadata = {
    area: profile.area ?? "otros",
    department: profile.department,
    slug: profile.canonicalSlug
  };
  const data = sheet.rows.slice(profile.rowsToSkip);
  const records: NormalizedImportRow[] = [];
  let currentSection = "";
  let socialSkippedRows = 0;
  let prevRowHadSocialContext = false;

  data.forEach((row) => {
    const cells = row.map((value) => clean(value));
    const firstCell = cells[0] ?? "";
    const nonEmpty = cells.filter(Boolean);

    if (
      nonEmpty.length === 1 &&
      firstCell &&
      !["INDICEAGENDA", "INDICEAGENDAHOSPITALARIA"].includes(normalizeMarker(firstCell))
    ) {
      // Do NOT treat a single-cell row as a section header when it
      // looks like a social-media handle (prevRowHadSocialContext or the cell
      // itself is social-context). Social handles are all-lowercase, 8+ chars,
      // no spaces, no digits — exactly what isSocialContextRow checks.
      // We peek at effective social context here to avoid consuming the handle
      // as a section header before we can map it to a social contact.
      const wouldBeSocialHandle = isSocialContextRow(firstCell, prevRowHadSocialContext || sectionIsSocial(firstCell));
      if (!wouldBeSocialHandle) {
        currentSection = firstCell;
        prevRowHadSocialContext = sectionIsSocial(firstCell);
        return;
      }
      // Fall through: let this single-cell social row be processed as a contact below.
    }

    // Single-pass over non-first cells: extract phone numbers and note fragments
    // together so we don't call extractNumbers twice per cell (once for rowHasPhone,
    // once for the phone-list build).
    // rowHasPhone uses the SAME predicate as the OLD hasPhoneLikeNumber gate:
    // date cells and numbers outside the 4–9 digit range do NOT count as phones.
    const tailCells = cells.slice(1);
    const phoneNumbers: string[] = [];
    const noteFragments: string[] = [];
    let rowHasPhone = false;

    for (const cell of tailCells) {
      if (!cell) continue;
      const extracted = extractNumbers(cell);
      if (extracted.length > 0) {
        phoneNumbers.push(...extracted);
      }
      if (!rowHasPhone && !looksLikeDateValue(cell) && extracted.some((n) => n.length >= 4 && n.length <= 9)) {
        rowHasPhone = true;
      }
      if (hasLetters(cell)) {
        noteFragments.push(cell);
      }
    }

    const resolvedLabel = resolveServiceRowLabel(cells);
    const label = resolvedLabel === "" && rowHasPhone && firstCell && hasLetters(firstCell)
      ? firstCell
      : resolvedLabel;

    if (label && isExcludedLabel(label) && !rowHasPhone) {
      return;
    }

    if (nonEmpty.length === 1 && label && cells[0] === label) {
      // Same guard as the first section-header path — skip this
      // for social-handle rows that fell through from the early-return above.
      const wouldBeSocialHandle = isSocialContextRow(label, prevRowHadSocialContext || sectionIsSocial(label));
      if (!wouldBeSocialHandle) {
        currentSection = label;
        prevRowHadSocialContext = sectionIsSocial(label);
        return;
      }
      // Fall through to social contact creation below.
    }

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
      prevRowHadSocialContext = sectionIsSocial(label);
      return;
    }

    if (!label) {
      return;
    }

    // Filter note fragments: exclude the label itself, then clean.
    const filteredNoteFragments = cleanNoteFragments(
      noteFragments.filter((cell) => cell !== label)
    );

    const dedupedPhoneNumbers = dedupeKeepOrder(phoneNumbers);

    // Compute social context before the "all-empty tail cells" early-exit so that
    // social-handle rows (single cell with empty tail cells) are not dropped here.
    // prevRowHadSocialContext is updated now; the early-exit only fires
    // when the row is neither a phone row nor a social handle.
    const thisCellsHaveSocialContext = rowContainsSocialToken(cells);
    const effectiveSocialContext = sectionIsSocial(currentSection) || thisCellsHaveSocialContext || prevRowHadSocialContext;
    prevRowHadSocialContext = thisCellsHaveSocialContext;

    if (
      dedupedPhoneNumbers.length === 0 &&
      cells.slice(1).every((value) => !value) &&
      // Don't drop a social-handle row just because its tail cells are all empty.
      !isSocialContextRow(label, effectiveSocialContext)
    ) {
      return;
    }

    // Social-handle rows are now first-class contacts, not skipped.
    // When a row has no phone numbers but is a social-context handle, map it
    // to a social contact entry using the inferred platform from the section name.
    // Pass the raw row cells as a fallback so that a platform token that appears
    // in the same row as the handle (rather than a preceding section header) is
    // still detected correctly.
    if (dedupedPhoneNumbers.length === 0 && isSocialContextRow(label, effectiveSocialContext)) {
      const inferredPlatform = inferSocialPlatformFromSection(currentSection, ...cells);
      const record = blankRecord();
      record.externalId = `${metadata.slug}-${buildStableExternalId([
        metadata.department,
        currentSection && currentSection !== metadata.department ? currentSection : "social",
        label
      ])}`;
      // type is never keyword-guessed from displayName/section text —
      // service sheets have no Categoría-equivalent concept, so type defaults
      // to the neutral "other" instead.
      record.type = "other";
      record.displayName = label;
      record.area = metadata.area;
      record.department = metadata.department;
      record.service = currentSection && currentSection !== metadata.department ? currentSection : label;
      record.aliases = aliasesFromLabel(label);
      record.notes = currentSection && currentSection !== metadata.department ? `Sección: ${currentSection}` : "";
      record.status = "active";
      record.social1Platform = inferredPlatform;
      record.social1Handle = label;
      record.social1IsPrimary = "true";
      records.push(record);
      return;
    }

    const labelNotes: string[] = [];

    if (currentSection && currentSection !== metadata.department) {
      labelNotes.push(`Sección: ${currentSection}`);
    }

    if (filteredNoteFragments.length > 0) {
      labelNotes.push(filteredNoteFragments.join(" | "));
    }

    const finalNotes = cleanNoteFragments(labelNotes).join(" | ");
    const privacySource = cleanNoteFragments([label, currentSection, finalNotes]).join(" | ");
    const privacy = detectPrivacy(privacySource);
    const record = blankRecord();

    record.externalId = `${metadata.slug}-${buildStableExternalId([
      metadata.department,
      currentSection && currentSection !== metadata.department ? currentSection : label,
      dedupedPhoneNumbers[0],
      dedupedPhoneNumbers[1]
    ])}`;
    // type is never keyword-guessed from displayName/section text —
    // service sheets have no Categoría-equivalent concept, so type defaults
    // to the neutral "other" instead.
    record.type = "other";
    record.displayName = label;
    record.area = metadata.area;
    record.department = metadata.department;
    record.service = currentSection && currentSection !== metadata.department ? currentSection : label;
    record.aliases = aliasesFromLabel(label);
    record.notes = finalNotes;
    record.status = "active";

    const phoneEntries = dedupedPhoneNumbers.map((number) => ({
      number,
      label: sheet.name,
      kind: "internal",
      // "Principal" is a manual, user-editable choice made on the
      // contact's edit form (see PhonesSection.tsx) — it has no equivalent
      // column in the source sheet, so it must never be auto-assigned to
      // the first imported phone.
      isPrimary: false,
      confidential: privacy.confidential,
      noPatientSharing: privacy.noPatientSharing,
      // Comentarios/notes belong to the contact, not
      // to an individual phone — they are already stored at record.notes
      // above. Duplicating them here caused the note text to render directly
      // under the phone number instead of only in the contact's dedicated
      // "Notas" section.
      notes: undefined
    }));
    record.phones = JSON.stringify(phoneEntries);

    record.phone1Label = dedupedPhoneNumbers.length > 0 ? "Principal" : "";
    record.phone1Number = dedupedPhoneNumbers[0] ?? "";
    record.phone1Kind = dedupedPhoneNumbers.length > 0 ? "internal" : "";
    // Do not auto-assign "Principal" on import (see comment above).
    record.phone1IsPrimary = "false";
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

  return { records, socialSkippedRows };
};

// ---------------------------------------------------------------------------
// Tabular Agenda-sheet parser
// ---------------------------------------------------------------------------

/**
 * Categoría -> RecordType mapping for the Agenda tabular import
 * path.
 *
 * Distinct "Categoría" values extracted directly from the hospital's real
 * Agenda ODS export (23 values, verified against the source file). Keys are
 * normalized with normalizeDisplayNameForMerge (trim + lowercase +
 * diacritic-strip + collapse whitespace) so accidental case variants in the
 * source data (e.g. "Jefe/a De Estudio" vs "Jefe/a de estudio") resolve to
 * the same entry.
 *
 * THIS MAPPING IS A PROPOSED DEFAULT, NOT A FINAL PRODUCT DECISION — it is
 * intentionally a reasonable best-guess mapping to unblock the Agenda import
 * path, but it requires explicit user sign-off before being considered
 * settled. Roles denoting a specific individual's
 * job function (nurse, doctor, secretary, technician, etc.) map to "person";
 * roles denoting a leadership/oversight function (chief, supervisor,
 * director, ward-study lead, etc.) map to "supervision", consistent with the
 * existing displayName-keyword heuristic already mapping the substring
 * "supervisi" to "supervision" (see classifyType above).
 */
export const AGENDA_CATEGORIA_TYPE_MAP: Record<string, string> = {
  "enfermero/a": "person",
  "doctora/or": "person",
  "secretario/a": "person",
  "jefe/a": "supervision",
  "administrativo/a": "person",
  "supervisor/a": "supervision",
  "tecnico/a": "person",
  "fotografo/a": "person",
  "informatica/o": "person",
  "ilustrador/a": "person",
  dietista: "person",
  "auxiliar administrativo/a": "person",
  "directora/or": "supervision",
  "jefe/a de estudio": "supervision",
  "encargado/a": "supervision",
  "fisico/a": "person",
  "subdirectora/or": "supervision",
  "gobernante/a": "supervision",
  auxiliar: "person",
  "ingeniera/o": "person",
  periodista: "person",
  "axuliar tecnico sanitario/a": "person"
};

/**
 * Resolves a NormalizedImportRow `type` for an Agenda-tabular row.
 *
 * Sole mechanism: look up the row's "Categoría" value (normalized) in
 * AGENDA_CATEGORIA_TYPE_MAP. The user explicitly does not want type guessed
 * from displayName keywords, so a blank or unmapped Categoría now defaults to
 * the neutral "other" instead of falling back to a keyword heuristic.
 */
const classifyAgendaType = (categoria: string): string => {
  const key = normalizeDisplayNameForMerge(categoria);
  const mapped = key ? AGENDA_CATEGORIA_TYPE_MAP[key] : undefined;

  return mapped ?? "other";
};

/**
 * Canonical 17-column header for the hospital's real "Agenda" ODS export:
 * Nombre, Categoría, Servicio, Número 1..7, Horario, Confidencial, Edificio,
 * Planta, Sector, Sección, Comentarios. Compared against a sheet's first row
 * via normalizeMarker (diacritic-stripped, uppercase, whitespace-stripped) so
 * accent/case/spacing differences in the source file don't break detection.
 */
export const AGENDA_TABULAR_HEADER_MARKERS = [
  "NOMBRE",
  "CATEGORIA",
  "SERVICIO",
  "NUMERO1",
  "NUMERO2",
  "NUMERO3",
  "NUMERO4",
  "NUMERO5",
  "NUMERO6",
  "NUMERO7",
  "HORARIO",
  "CONFIDENCIAL",
  "EDIFICIO",
  "PLANTA",
  "SECTOR",
  "SECCION",
  "COMENTARIOS"
] as const;

/**
 * Column indices within a tabular Agenda-sheet data row, matching
 * AGENDA_TABULAR_HEADER_MARKERS above 1:1 by position. Kept as the fallback
 * shape returned by resolveAgendaColumnIndices for the canonical 17-column
 * header.
 */
export type AgendaColumnIndices = {
  nombre: number;
  categoria: number;
  servicio: number;
  numeroStart: number;
  numeroEnd: number; // inclusive — Número 1..7
  // Optional inserted "Fax" column (e.g. the real "Sindicatos" sheet). Absent
  // (undefined) on sheets that don't have one — the canonical 17-column
  // header falls into this case.
  fax?: number;
  // Optional inserted "Busca 1" column (pager code). Absent (undefined) on
  // sheets that don't have one — mirrors the `fax` optional-column pattern
  // (OIR-265).
  busca1?: number;
  // Optional inserted "Corporativo 1" column (corporate mobile phone).
  // Absent (undefined) on sheets that don't have one — mirrors the `fax`
  // optional-column pattern (OIR-265).
  corporativo1?: number;
  horario: number;
  confidencial: number;
  edificio: number;
  planta: number;
  sector: number;
  seccion: number;
  comentarios: number;
};

const AGENDA_COLUMN: AgendaColumnIndices = {
  nombre: 0,
  categoria: 1,
  servicio: 2,
  numeroStart: 3,
  numeroEnd: 9, // inclusive — Número 1..7
  horario: 10,
  confidencial: 11,
  edificio: 12,
  planta: 13,
  sector: 14,
  seccion: 15,
  comentarios: 16
};

/**
 * The first 10 columns (Nombre, Categoría, Servicio, Número 1-7) MUST appear
 * at these exact fixed positions for a sheet to be treated as Agenda-tabular
 * at all — this positional guarantee is what lets normalizeTabularAgendaSheet
 * read Nombre/Categoría/Servicio/Número by fixed index instead of guessing
 * from cell content.
 */
const AGENDA_FIXED_PREFIX_MARKERS = [
  "NOMBRE",
  "CATEGORIA",
  "SERVICIO",
  "NUMERO1",
  "NUMERO2",
  "NUMERO3",
  "NUMERO4",
  "NUMERO5",
  "NUMERO6",
  "NUMERO7"
] as const;

/**
 * Trailer columns required after the fixed prefix. Located BY NAME
 * anywhere after the fixed prefix (rather than assumed to be at fixed
 * positions 10-16) so a sheet with an EXTRA inserted column — e.g. the real
 * "Sindicatos" sheet, which has a "Fax" column between Número 7 and Horario —
 * is still recognized as an Agenda-tabular sheet instead of silently falling
 * through to the legacy service-sheet heuristics (which drop rows whose only
 * meaningful cell is an ALL-CAPS Servicio value with a blank Nombre).
 */
const AGENDA_TRAILER_MARKERS = [
  "HORARIO",
  "CONFIDENCIAL",
  "EDIFICIO",
  "PLANTA",
  "SECTOR",
  "SECCION",
  "COMENTARIOS"
] as const;

/**
 * Resolves column indices for a tabular Agenda-format header row (tolerates
 * extra inserted columns). Returns null when the
 * header does not match. See AGENDA_FIXED_PREFIX_MARKERS/AGENDA_TRAILER_MARKERS
 * above for the exact matching rules.
 */
export const resolveAgendaColumnIndices = (headerRow: string[]): AgendaColumnIndices | null => {
  const normalized = headerRow.map((cell) => normalizeMarker(cell ?? ""));

  const fixedOk = AGENDA_FIXED_PREFIX_MARKERS.every((marker, index) => normalized[index] === marker);

  if (!fixedOk) {
    return null;
  }

  const trailerStart = AGENDA_FIXED_PREFIX_MARKERS.length;
  const trailerIndexes = AGENDA_TRAILER_MARKERS.map((marker) => normalized.indexOf(marker, trailerStart));

  if (trailerIndexes.some((index) => index === -1)) {
    return null;
  }

  const [horario, confidencial, edificio, planta, sector, seccion, comentarios] = trailerIndexes as [
    number,
    number,
    number,
    number,
    number,
    number,
    number
  ];

  // Optional extra "Fax" column (e.g. the real "Sindicatos" sheet — see
  // AGENDA_TRAILER_MARKERS comment above). Not part of the required trailer
  // shape, so its absence must not fail header detection.
  const faxIndex = normalized.indexOf("FAX", trailerStart);

  // Optional extra "Busca 1" (pager) and "Corporativo 1" (corporate mobile)
  // columns — same optional/graceful pattern as Fax above (OIR-265). Their
  // absence must not fail header detection or change behavior for sheets
  // without them.
  const busca1Index = normalized.indexOf("BUSCA1", trailerStart);
  const corporativo1Index = normalized.indexOf("CORPORATIVO1", trailerStart);

  return {
    nombre: 0,
    categoria: 1,
    servicio: 2,
    numeroStart: 3,
    numeroEnd: 9,
    fax: faxIndex === -1 ? undefined : faxIndex,
    busca1: busca1Index === -1 ? undefined : busca1Index,
    corporativo1: corporativo1Index === -1 ? undefined : corporativo1Index,
    horario,
    confidencial,
    edificio,
    planta,
    sector,
    seccion,
    comentarios
  };
};

/**
 * Returns true when `headerRow` matches the Agenda tabular header shape (see
 * resolveAgendaColumnIndices).
 */
export const isAgendaTabularHeader = (headerRow: string[]): boolean =>
  resolveAgendaColumnIndices(headerRow) !== null;

/**
 * Strips a leading "Planta " (case/diacritic-insensitive) word from a Planta
 * column value (e.g. "Planta 4" -> "4", "Planta Baja" -> "Baja") so it can be
 * stored in location.floor without duplicating the "Planta " prefix that
 * AppDataService's location-summary builder already re-adds at display time
 * (see app-data.service.ts: `if (loc?.floor) locationParts.push(\`Planta ${loc.floor}\`)`).
 */
export const stripPlantaPrefix = (value: string): string => {
  const trimmed = clean(value);
  const match = /^planta\s+(.+)$/i.exec(trimmed);
  return match ? clean(match[1]!) : trimmed;
};

/**
 * Parses a tabular Agenda-format sheet: a flat table with an exact
 * 17-column header (Nombre, Categoría, Servicio, Número 1..7, Horario,
 * Confidencial, Edificio, Planta, Sector, Sección, Comentarios), one contact
 * per data row. Unlike normalizeServiceSheet, columns are read by FIXED INDEX
 * (not inferred from cell content) because the header guarantees positional
 * meaning.
 *
 * Row exclusions (confirmed against the real file):
 *   - the header row itself (handled by profile.rowsToSkip)
 *   - "section divider" rows with exactly one non-empty cell, in column 0
 *     (e.g. "Letra A", "Hospital Polivalente")
 *   - rows with no Nombre AND no Servicio (nothing to build a displayName from)
 *
 * Row-level Confidencial ("Si"/"Sí") is applied to EVERY phone built from that
 * row's Número 1..7 columns, not just the first phone.
 */
export const normalizeTabularAgendaSheet = (
  sheet: SheetData,
  profile: SheetProfile
): NormalizedImportRow[] => {
  // Resolve column positions from THIS sheet's own header row rather
  // than assuming the canonical fixed layout — tolerates sheets with an extra
  // inserted column (e.g. "Sindicatos"' Fax column). Falls back to the
  // canonical fixed layout in the (expected-never) case the header row is
  // missing, since detectSheetProfile already validated it before routing here.
  const columns = resolveAgendaColumnIndices(sheet.rows[0] ?? []) ?? AGENDA_COLUMN;
  const data = sheet.rows.slice(profile.rowsToSkip);
  const records: NormalizedImportRow[] = [];

  data.forEach((row, rowIndex) => {
    const cells = row.map((value) => clean(value));
    const nonEmptyIndexes = cells
      .map((value, index) => (value ? index : -1))
      .filter((index) => index !== -1);

    if (nonEmptyIndexes.length === 0) {
      return;
    }

    // Section divider row (e.g. "Letra A", "Hospital Polivalente"): exactly one
    // non-empty cell, in column 0 (Nombre).
    if (nonEmptyIndexes.length === 1 && nonEmptyIndexes[0] === 0) {
      return;
    }

    const nombre = cells[columns.nombre] ?? "";
    const categoria = cells[columns.categoria] ?? "";
    const servicio = cells[columns.servicio] ?? "";
    const horario = cells[columns.horario] ?? "";
    const confidencialRaw = cells[columns.confidencial] ?? "";
    const edificio = cells[columns.edificio] ?? "";
    const planta = cells[columns.planta] ?? "";
    const sector = cells[columns.sector] ?? "";
    const seccion = cells[columns.seccion] ?? "";
    const comentarios = cells[columns.comentarios] ?? "";

    const displayName = nombre || servicio;

    if (!displayName) {
      return;
    }

    // Row-level Confidencial ("Si"/"Sí") applies to every phone on this row —
    // OR'd with the existing free-text privacy-marker
    // detection over Comentarios for defense in depth (same markers used by
    // the legacy service-sheet parser).
    const rowConfidential = parseSiNoFlag(confidencialRaw);
    const privacy = detectPrivacy(comentarios);
    const confidential = rowConfidential || privacy.confidential;

    const phoneEntries: SerializedPhoneEntry[] = [];

    for (let column = columns.numeroStart; column <= columns.numeroEnd; column += 1) {
      const cellValue = cells[column] ?? "";

      if (!cellValue) {
        continue;
      }

      extractNumbers(cellValue).forEach((number) => {
        phoneEntries.push({
          number,
          label: `Número ${column - columns.numeroStart + 1}`,
          kind: "internal",
          // "Principal" is a manual, user-editable choice made on
          // the contact's edit form — the Agenda sheet has no such column,
          // so it must never be auto-assigned to the first imported phone.
          isPrimary: false,
          confidential,
          noPatientSharing: privacy.noPatientSharing,
          // Comentarios belongs to the contact, not to an individual
          // phone — it is already stored at record.notes below. Duplicating
          // it here caused the Comentarios text to render directly under the
          // phone number instead of in the contact's dedicated "Notas"
          // section.
          notes: undefined
        });
      });
    }

    // The Fax column (present on sheets like "Sindicatos" — see
    // resolveAgendaColumnIndices above) is a distinct, optional trailing
    // column beyond Número 1..7. Without this, any value entered there was
    // silently dropped instead of being imported as a fax phone entry.
    const faxValue = columns.fax !== undefined ? cells[columns.fax] ?? "" : "";

    if (faxValue) {
      extractNumbers(faxValue).forEach((number) => {
        phoneEntries.push({
          number,
          label: "Fax",
          kind: "fax",
          isPrimary: false,
          confidential,
          noPatientSharing: privacy.noPatientSharing,
          notes: undefined
        });
      });
    }

    // The "Corporativo 1" column (present on some real sheets, mirrors the
    // Fax column pattern above — OIR-265) holds a real corporate mobile phone
    // number, so it is cleaned up with extractNumbers exactly like Fax and
    // pushed into contactMethods.phones (not buscas).
    const corporativoValue = columns.corporativo1 !== undefined ? cells[columns.corporativo1] ?? "" : "";

    if (corporativoValue) {
      extractNumbers(corporativoValue).forEach((number) => {
        phoneEntries.push({
          number,
          label: "Corporativo",
          kind: "corporativo",
          isPrimary: false,
          confidential,
          noPatientSharing: privacy.noPatientSharing,
          notes: undefined
        });
      });
    }

    // The "Busca 1" column (pager code, OIR-265) is a single raw ~4-digit
    // value — unlike phone columns it is NOT run through extractNumbers
    // (no multi-value splitting/cleanup), and it is stored on the contact's
    // own `buscas` array, never mixed into contactMethods.phones.
    const buscaEntries: SerializedBuscaEntry[] = [];
    const buscaValue = columns.busca1 !== undefined ? cells[columns.busca1] ?? "" : "";

    if (buscaValue) {
      buscaEntries.push({
        number: buscaValue,
        label: undefined
      });
    }

    const record = blankRecord();

    record.externalId = `${profile.canonicalSlug}-${buildStableExternalId([String(rowIndex), displayName, servicio])}`;
    // Categoría is the SOLE type-inference mechanism for the Agenda
    // path (see classifyAgendaType/AGENDA_CATEGORIA_TYPE_MAP above). A blank
    // or unmapped Categoría value defaults to "other" (no
    // displayName-keyword guessing).
    record.type = classifyAgendaType(categoria);
    record.displayName = displayName;
    // The real Agenda ODS has no genuine Área column — inferring one
    // from Servicio/displayName produced wrong slug-like guesses (e.g.
    // "gestion-administracion" guessed from an unrelated label). Agenda-
    // imported records get a blank área instead; área remains an optional
    // field elsewhere in the schema/UI.
    record.area = "";
    // Tag every contact with its source sheet's name as department
    // (profile.department — "" for the main canonical "Agenda" sheet itself,
    // the sheet's own name for every other per-department "book" sheet) so a
    // future feature can filter/search by exact department value.
    record.department = profile.department;
    record.service = servicio;
    record.role = categoria;
    record.schedule = horario;
    record.building = edificio;
    record.floor = planta ? stripPlantaPrefix(planta) : "";
    record.sector = sector;
    record.section = seccion;
    record.aliases = aliasesFromLabel(displayName);
    record.notes = cleanNoteFragments([comentarios]).join(" | ");
    record.status = "active";
    record.phones = JSON.stringify(phoneEntries);
    record.buscas = JSON.stringify(buscaEntries);

    const first = phoneEntries[0];
    const second = phoneEntries[1];

    record.phone1Label = first ? first.label : "";
    record.phone1Number = first?.number ?? "";
    record.phone1Kind = first ? "internal" : "";
    // Do not auto-assign "Principal" on import (see comment above).
    record.phone1IsPrimary = "false";
    record.phone1Confidential = first?.confidential ? "true" : "false";
    record.phone1NoPatientSharing = first?.noPatientSharing ? "true" : "false";
    record.phone1Notes = first?.notes ?? "";

    if (second) {
      record.phone2Label = second.label;
      record.phone2Number = second.number;
      record.phone2Kind = "internal";
      record.phone2IsPrimary = "false";
      record.phone2Confidential = second.confidential ? "true" : "false";
      record.phone2NoPatientSharing = second.noPatientSharing ? "true" : "false";
      record.phone2Notes = second.notes ?? "";
    }

    records.push(record);
  });

  return records;
};

// ---------------------------------------------------------------------------
// Cross-sheet merge
// ---------------------------------------------------------------------------

/**
 * Builds the composite identity key used by mergeRecordsByDisplayName.
 *
 * Root cause fixed here: the Agenda tabular parser falls back to the
 * "Servicio" column value for displayName whenever "Nombre" is blank (the
 * common case for most rows). Two GENUINELY DISTINCT rows — e.g. "Bioquímica"
 * (general line) and "Bioquímica" (Despacho/office line, confidential) — can
 * therefore share the exact same displayName purely because they share the
 * same Servicio value, even though they are different desks/entities with
 * different phones and a different confidentiality status. Merging them by
 * displayName alone silently bleeds a confidential flag from one onto the
 * other (over- or under-flagging depending on dedup order).
 *
 * Fix: identity now requires displayName equality AND a location/service
 * discriminator (organization.service + building/floor/sector/section) to
 * also match. Rows that share only an inherited/Servicio-derived name but
 * differ on the discriminator are treated as separate entities and never
 * merged. All discriminator components are run through the same
 * normalizeDisplayNameForMerge fold (trim + lowercase + diacritic-strip) as
 * displayName itself, so trivial accent/case differences between sheets (see
 * the "accent-normalizes displayName" cross-sheet golden test) do not cause
 * spurious over-splitting of genuinely-same-entity rows.
 *
 * Department is now also PART OF the discriminator, but ONLY for
 * rows that came from the tabular Agenda parser's per-department "book"
 * sheets (Corporativos, Sindicatos, Almacenes, etc. —
 * every non-canonical sheet sharing the Agenda tabular header, tagged with
 * `department = <its own sheet name>`). Two rows from DIFFERENT book sheets
 * can share the same displayName+service with blank/matching
 * building/floor/sector/section (plausible for generic roles like
 * "Secretaría"/"Recepción" repeated across multiple books) — without this,
 * they would silently merge into one record, losing the second sheet's
 * department attribution (the survivor keeps only group[0]'s scalar fields,
 * including department).
 *
 * This must NOT regress two older, deliberately-designed cross-department/
 * cross-sheet merge behaviors that predate the per-department book sheets and
 * remain fully intentional:
 *  - Verified against real hospital data: the same real desk (e.g.
 *    "Banco de Sangre") is legitimately listed in more than one CANONICAL
 *    service department's phone book (Urgencias, Rayos, UMI, ...) with a
 *    different extension in each — these must keep merging into one
 *    combined-extension contact.
 *  - Bug A (flat/derived-department sheets, e.g. alphabetic index pages
 *    "Hoja_A"/"Hoja_B"/"Hoja_S"): department here is just a label derived
 *    from the sheet's own name/content, not a genuine organizational
 *    department — these must also keep merging across sheets.
 *
 * Rather than re-deriving parser origin from department content (fragile —
 * both book-sheets and flat/derived sheets tag department from the sheet
 * name), this reuses `area`: the tabular Agenda parser is the ONLY parser
 * that always leaves `area` blank ("" — the real Agenda ODS has no genuine
 * Área column, see normalizeTabularAgendaSheet); every other parser
 * (canonical/derived service-sheet, flat-sheet, centers-sheet) always
 * assigns a non-blank area (falling back to "otros"/inferred area when
 * nothing more specific matches). So `area === ""` reliably identifies rows
 * parsed by the tabular Agenda parser (main "Agenda" sheet + book sheets)
 * and only those rows get department folded into the identity key. The main
 * "Agenda" sheet itself has a blank department too, so it is unaffected
 * either way.
 */
const buildMergeIdentityKey = (record: NormalizedImportRow): string => {
  const displayNameKey = normalizeDisplayNameForMerge(record.displayName);

  if (!displayNameKey) {
    return "";
  }

  const isTabularAgendaRow = record.area === "";
  const departmentKey = isTabularAgendaRow ? normalizeDisplayNameForMerge(record.department ?? "") : "";
  const serviceKey = normalizeDisplayNameForMerge(record.service ?? "");
  const buildingKey = normalizeDisplayNameForMerge(record.building ?? "");
  const floorKey = normalizeDisplayNameForMerge(record.floor ?? "");
  const sectorKey = normalizeDisplayNameForMerge(record.sector ?? "");
  const sectionKey = normalizeDisplayNameForMerge(record.section ?? "");

  return [displayNameKey, departmentKey, serviceKey, buildingKey, floorKey, sectorKey, sectionKey].join(
    "::"
  );
};

/**
 * Merges service-sheet NormalizedImportRows that share the same normalized
 * displayName (trim + lowercase + strip diacritics) AND the same
 * department/service/location discriminator (see
 * buildMergeIdentityKey) into a single row.
 *
 * Merge rules (confirmed with operator):
 * - Identity key: normalized displayName equality AND normalized
 *   department+service+building+floor+sector+location equality (no fuzzy
 *   match). Rows with the same displayName but a different discriminator
 *   remain separate records. For rows parsed by the tabular Agenda "book"
 *   sheet parser, a different department now also counts as a
 *   different discriminator. Rows from every other parser (the
 *   canonical/derived service-sheet parser, flat-sheet parser) keep merging
 *   across departments exactly as before (e.g. the same real
 *   "Banco de Sangre" desk deliberately listed in multiple canonical
 *   department books). See buildMergeIdentityKey for the full rationale.
 * - Phones: combine all SerializedPhoneEntry lists; deduplicate by normalized
 *   digit string; keep first occurrence's position, but OR the
 *   confidential/noPatientSharing flags across every duplicate occurrence of
 *   the same number (a confidential duplicate must never be
 *   silently dropped just because a non-confidential duplicate of the same
 *   number was processed first or last). Each phone retains the source sheet
 *   label it was tagged with in normalizeServiceSheet.
 * - externalId: the FIRST record's externalId is kept (deterministic, stable
 *   across re-imports of the same file PROVIDED sheet order in the workbook is
 *   unchanged).
 * - All other scalar fields: taken from the first record in the group.
 * - phone1/phone2 flat fields: rewritten to match the merged phones list.
 * - Records without a `phones` JSON field (e.g. centers-parser records) are
 *   passed through unchanged — they are never merged.
 */
export const mergeRecordsByDisplayName = (records: NormalizedImportRow[]): NormalizedImportRow[] => {
  const groups = new Map<string, NormalizedImportRow[]>();

  for (const record of records) {
    if (record.phones === undefined || record.phones === "") {
      continue;
    }

    const key = buildMergeIdentityKey(record);

    if (!key) {
      continue;
    }

    const existing = groups.get(key);

    if (existing) {
      existing.push(record);
    } else {
      groups.set(key, [record]);
    }
  }

  const result: NormalizedImportRow[] = [];
  const emittedKeys = new Set<string>();

  for (const record of records) {
    const hasPhonesJson = record.phones !== undefined && record.phones !== "";

    if (!hasPhonesJson) {
      result.push(record);
      continue;
    }

    const key = buildMergeIdentityKey(record);

    if (!key) {
      result.push(record);
      continue;
    }

    if (emittedKeys.has(key)) {
      continue;
    }

    emittedKeys.add(key);
    const group = groups.get(key)!;

    if (group.length === 1) {
      result.push(group[0]!);
      continue;
    }

    const combinedPhones: Array<{
      number: string;
      label: string;
      kind: string;
      isPrimary: boolean;
      confidential: boolean;
      noPatientSharing: boolean;
      notes?: string;
    }> = [];
    // Maps a normalized digit string to its index in combinedPhones,
    // so that when the SAME number appears more than once in the group being
    // merged, we can OR its confidential/noPatientSharing flags into the
    // already-kept entry instead of silently discarding a later (or earlier)
    // duplicate's flags. A confidential duplicate must always win.
    const seenNormalized = new Map<string, number>();

    for (const groupRecord of group) {
      let entries: Array<{
        number: string;
        label: string;
        kind: string;
        isPrimary: boolean;
        confidential: boolean;
        noPatientSharing: boolean;
        notes?: string;
      }> = [];

      try {
        const parsed = JSON.parse(groupRecord.phones ?? "[]");
        if (Array.isArray(parsed)) {
          entries = (parsed as unknown[]).filter(isSerializedPhoneEntry);
        }
      } catch {
        // Malformed JSON is treated as no phones for this record.
      }

      for (const entry of entries) {
        const normalized = normalizeNumberForDedup(entry.number);

        if (!normalized) {
          continue;
        }

        const existingIndex = seenNormalized.get(normalized);

        if (existingIndex === undefined) {
          seenNormalized.set(normalized, combinedPhones.length);
          combinedPhones.push(entry);
          continue;
        }

        // Duplicate occurrence of a number already kept: OR the privacy
        // flags in rather than discarding this occurrence's flags
        // (defense-in-depth — never let a confidential duplicate get dropped
        // because a public duplicate of the same number was kept first).
        const existing = combinedPhones[existingIndex]!;
        combinedPhones[existingIndex] = {
          ...existing,
          confidential: existing.confidential || entry.confidential,
          noPatientSharing: existing.noPatientSharing || entry.noPatientSharing
        };
      }
    }

    // "Principal" is a manual, user-editable choice
    // (see PhonesSection.tsx) — it must never be re-derived from a phone's
    // position in the merged array. Preserve whatever isPrimary each phone
    // already carried coming in (the parsers upstream never auto-assign
    // isPrimary=true on import, so in practice this stays false; genuine
    // multi-primary conflicts, if any, are reconciled downstream by
    // ensureSinglePrimary in csv-import.service.ts).
    const reassertedPhones = combinedPhones.map((phone) => ({
      ...phone,
      isPrimary: phone.isPrimary
    }));

    const base = { ...group[0]! };
    base.phones = JSON.stringify(reassertedPhones);

    if (reassertedPhones.length === 0) {
      const existingNotes = base.notes ? `${base.notes} | ` : "";
      base.notes = `${existingNotes}[AVISO: registro combinado sin teléfonos válidos]`;
      base.phone1Label = "";
      base.phone1Number = "";
      base.phone1Kind = "";
      base.phone1IsPrimary = "false";
      base.phone1Confidential = "false";
      base.phone1NoPatientSharing = "false";
      base.phone1Notes = "";
      base.phone2Label = "";
      base.phone2Number = "";
      base.phone2Kind = "";
      base.phone2IsPrimary = "false";
      base.phone2Confidential = "false";
      base.phone2NoPatientSharing = "false";
      base.phone2Notes = "";
      result.push(base);
      continue;
    }

    const first = reassertedPhones[0];
    const second = reassertedPhones[1];

    base.phone1Label = first ? "Principal" : "";
    base.phone1Number = first?.number ?? "";
    base.phone1Kind = first ? "internal" : "";
    // Reflect the phone's actual isPrimary value
    // instead of assuming "true" whenever a first phone exists — keeps this
    // flat mirror field consistent with the reasserted `phones` JSON above.
    base.phone1IsPrimary = first?.isPrimary ? "true" : "false";
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

    result.push(base);
  }

  return result;
};
