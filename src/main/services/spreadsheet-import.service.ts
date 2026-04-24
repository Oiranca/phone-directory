import fs from "node:fs/promises";
import path from "node:path";
import Papa from "papaparse";
import XLSX from "xlsx";
import { buildCsvImportPreview, buildImportPreviewFromRows, type NormalizedImportRow } from "./csv-import.service.js";
import type { CsvImportPreview, DirectoryDataset } from "../../shared/types/contact.js";

const MAX_SPREADSHEET_IMPORT_SIZE_BYTES = 5 * 1024 * 1024;
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

    const label = resolveServiceRowLabel(cells);

    if (label && isExcludedLabel(label)) {
      return;
    }

    if (nonEmpty.length === 1 && label && cells[0] === label) {
      currentSection = label;
      return;
    }

    if (nonEmpty.length > 0 && nonEmpty.every((value) => isExcludedLabel(value))) {
      return;
    }

    if (
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
    record.phone1Label = dedupedPhoneNumbers.length > 0 ? "Principal" : "";
    record.phone1Number = dedupedPhoneNumbers[0] ?? "";
    record.phone1Kind = dedupedPhoneNumbers.length > 0 ? "internal" : "";
    record.phone1IsPrimary = dedupedPhoneNumbers.length > 0 ? "true" : "false";
    record.phone1Confidential = privacy.confidential ? "true" : "false";
    record.phone1NoPatientSharing = privacy.noPatientSharing ? "true" : "false";
    record.phone1Notes = finalNotes;
    record.aliases = aliasesFromLabel(label);
    record.notes = finalNotes;
    record.status = "active";

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

const detectSheetProfile = (sheet: SheetData): SheetProfile | null => {
  if (sheet.rows.length === 0) {
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

const normalizeWorkbookRows = (
  sourceFilePath: string
): { rows: NormalizedImportRow[]; detectedFormat: string; detectionConfidence: DetectionConfidence } => {
  let sheets: SheetData[];

  try {
    sheets = readWorkbookSheets(sourceFilePath);
  } catch (error) {
    throw new Error(
      error instanceof Error && error.message
        ? `No se pudo leer la hoja de cálculo seleccionada. ${error.message}`
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

  return {
    rows: records,
    ...summarizeDetectedFormat(profiles)
  };
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

  const normalized = normalizeWorkbookRows(sourceFilePath);

  return buildImportPreviewFromRows(normalized.rows, {
    sourceFilePath,
    fileName: path.basename(sourceFilePath),
    editorName,
    detectedFormat: normalized.detectedFormat,
    detectionConfidence: normalized.detectionConfidence
  });
};
