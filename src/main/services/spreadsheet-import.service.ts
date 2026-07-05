import nodeFs from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { fileURLToPath, pathToFileURL } from "node:url";
import Papa from "papaparse";
import XLSX from "xlsx-republish";
import { buildCsvImportPreview, buildImportPreviewFromRows, type CsvImportPreviewInternal, type NormalizedImportRow } from "./csv-import.service.js";
import type { DirectoryDataset } from "../../shared/types/contact.js";
import {
  clean,
  stripBom,
  hasLetters,
  hasPhoneLikeNumber,
  normalizeAscii,
  normalizeMarker,
  isMeaningfulServiceLabel as isMeaningfulServiceLabelBase,
  inferAreaFromLabel,
  prettifyLabel,
  isExcludedLabel,
} from "./spreadsheet-normalize.js";
import {
  normalizeServiceSheet,
  normalizeCentersSheet,
  normalizeTabularAgendaSheet,
  isAgendaTabularHeader,
  resolveServiceRowLabel,
  mergeRecordsByDisplayName,
} from "./spreadsheet-parsers.js";
import { parseBuscasSheets } from "./spreadsheet-buscas-parser.js";
import type { BuscasSheetParseResult } from "./spreadsheet-buscas-parser.js";

// Re-export the public symbols that external modules depend on.
export type { SerializedPhoneEntry } from "./spreadsheet-normalize.js";
export { isSerializedPhoneEntry } from "./spreadsheet-normalize.js";
export { mergeRecordsByDisplayName } from "./spreadsheet-parsers.js";

const MAX_SPREADSHEET_IMPORT_SIZE_BYTES = 5 * 1024 * 1024;
export const MAX_SPREADSHEET_IMPORT_ROWS = 5000;
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
  // OIR-222: role/job title and operating hours (ODS "Categoría"/"Horario" columns).
  "role",
  "schedule",
  "building",
  "floor",
  "room",
  "locationText",
  // OIR-222: ODS "Sector"/"Sección" columns.
  "sector",
  "section",
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
  // Social media columns (OIR-131)
  "social1Platform",
  "social1Handle",
  "social1Url",
  "social1Label",
  "social1IsPrimary",
  "social2Platform",
  "social2Handle",
  "social2Url",
  "social2Label",
  "social2IsPrimary",
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
  /**
   * OIR-130: Parse result for buscas sheets found in the workbook.
   * Populated when one or more sheets with a "buscas" slug prefix are present.
   * The caller (AppDataService.previewCsvImport) persists these via BuscasService.
   * buscasSkippedRowCount counts rows that were in buscas sheets but yielded no
   * parseable pager record (e.g. empty rows, comment-only rows).
   */
  buscasParseResult: BuscasSheetParseResult;
  /** Alias kept for backwards-compat with preview panel display (genuinely-unparseable buscas rows). */
  buscasSkippedRowCount: number;
  /** OIR-131/OIR-134: Rows skipped because they are social-media handles. */
  socialHandleSkippedRowCount: number;
};

type SheetProfile = {
  parser: "centers" | "service" | "tabular";
  canonicalSlug: string;
  department: string;
  area?: string;
  rowsToSkip: number;
  detectedFormat: string;
  detectionConfidence: DetectionConfidence;
};

// ---------------------------------------------------------------------------
// Heuristic helpers — these stay in the main service (format-detection logic)
// ---------------------------------------------------------------------------

/** Wrapper that binds isExcludedLabel into the base isMeaningfulServiceLabel. */
const isMeaningfulServiceLabel = (value: string) =>
  isMeaningfulServiceLabelBase(value, isExcludedLabel);

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

/**
 * OIR-230: matches a phone-header alias exactly (serviceHeaderAliases.phone)
 * OR a numbered "Número N" column (e.g. "NUMERO1".."NUMERO7", normalized).
 * Fixes a header-leak bug: a sheet whose header is "Nombre, Categoría,
 * Servicio, Número 1, Número 2, ..." (the Agenda-tabular column layout, see
 * spreadsheet-parsers.ts) previously scored only 2 (the "NOMBRE" label match)
 * because "NUMERO1" didn't match the bare "NUMERO" alias — below the >=3
 * threshold that triggers skipping the header row. That let the header row
 * itself get treated as a data row by the legacy heuristics below (e.g. its
 * "Nombre" cell leaking into a record's department/notes as literal text).
 */
const isServicePhoneHeaderCell = (cell: string) =>
  serviceHeaderAliases.phone.has(cell) || /^NUMERO\d+$/.test(cell);

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
  if (normalized.slice(1).some((cell) => isServicePhoneHeaderCell(cell))) score += 2;

  return score;
};

const hasStrictServiceHeader = (row: string[]) => {
  const normalized = row.slice(0, 4).map((cell) => normalizeMarker(cell));
  return ["SERVICIO", "UNIDAD"].includes(normalized[0] ?? "") &&
    normalized.slice(1).some((cell) => isServicePhoneHeaderCell(cell));
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
 * Minimum number of flat label+phone rows required to accept a sheet as a
 * generic flat service sheet (Bug A fix — see detectSheetProfile comment).
 * Conservative: admits real contact tables while rejecting 1- or 2-row tables
 * that only mimic the label+phone layout.
 */
const MIN_FLAT_PHONE_BEARING_ROWS = 3;

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

/**
 * OIR-222: the hospital's real ODS export names the canonical, complete
 * directory sheet "Agenda" (slug "agenda"). The same workbook also contains
 * "Agenda_3" (a byte-identical duplicate/backup copy) and "Departamentos" (a
 * separate, much smaller, mostly-blank department-index sheet) which both
 * happen to share the same Agenda tabular header. Those two are excluded by
 * slug below (AGENDA_TABULAR_NON_DEPARTMENT_SLUGS) rather than falling
 * through to the generic centers/service heuristics — the legacy heuristics
 * extract phone-like digit runs from ANY cell, so a structured column like
 * Horario ("8:00-22:00") gets misparsed as a fake phone number ("8002200").
 */
const AGENDA_TABULAR_SHEET_SLUG = "agenda";

/**
 * OIR-230: sheets confirmed (from a prior real export of this same workbook)
 * to share the Agenda tabular header without being a genuine per-department
 * "book" of contacts — see AGENDA_TABULAR_SHEET_SLUG comment above. Both must
 * keep being skipped entirely rather than imported as duplicate/junk
 * department sheets. Matched by slug (normalizeAscii of the sheet name), so
 * accent/case variants are also caught.
 */
const AGENDA_TABULAR_NON_DEPARTMENT_SLUGS = new Set(["agenda-3", "departamentos"]);

const detectSheetProfile = (sheet: SheetData): SheetProfile | null => {
  if (sheet.rows.length === 0) {
    return null;
  }

  // Fix: skip navigation / TOC sheets by slug before any further analysis.
  if (isNavigationSheet(sheet.slug)) {
    return null;
  }

  // OIR-222/OIR-230: a sheet whose header matches the Agenda tabular format
  // (see resolveAgendaColumnIndices — tolerates extra inserted columns, e.g.
  // the real "Sindicatos" sheet's Fax column). The canonical directory sheet
  // (slug "agenda") is routed to the dedicated tabular parser with a blank
  // department. Two known non-department artifacts (a byte-identical
  // duplicate and a TOC sheet — AGENDA_TABULAR_NON_DEPARTMENT_SLUGS) are
  // skipped entirely, exactly as before. Every OTHER sheet sharing this
  // header is a genuine per-department "book" of contacts (e.g. the real
  // "Almacenes", "Quirófanos", "Corporativos" sheets) — OIR-230 requires
  // every contact imported from one of these to be tagged with the sheet's
  // own name as department, so route it to the same tabular parser instead of
  // silently dropping it (previous behavior) or misparsing it via the legacy
  // heuristics.
  if (isAgendaTabularHeader(sheet.rows[0] ?? [])) {
    if (sheet.slug === AGENDA_TABULAR_SHEET_SLUG) {
      return {
        parser: "tabular",
        canonicalSlug: AGENDA_TABULAR_SHEET_SLUG,
        department: "",
        area: undefined,
        rowsToSkip: 1,
        detectedFormat: "exportación cruda de agenda tabular",
        detectionConfidence: "high"
      };
    }

    if (AGENDA_TABULAR_NON_DEPARTMENT_SLUGS.has(sheet.slug)) {
      return null;
    }

    return {
      parser: "tabular",
      canonicalSlug: sheet.slug,
      department: clean(sheet.name),
      area: undefined,
      rowsToSkip: 1,
      detectedFormat: "exportación cruda de agenda tabular (hoja de departamento)",
      detectionConfidence: "high"
    };
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
    // OIR-230: prefer the sheet's own (real, human-assigned) tab name over a
    // guess derived from the first row's content. Guessing from content was
    // the root cause of a header-leak bug: when the header row wasn't reliably
    // recognized as a header (see isServicePhoneHeaderCell fix above), its
    // first cell (e.g. literal "Nombre") could be picked up here as the
    // "meaningful label" and become every record's department. Sheet tab
    // names are a much more reliable department signal in general — except
    // for spreadsheet-assigned generic defaults ("Sheet1"/"Hoja1"/"Plan1"),
    // which carry no real information and still fall back to content-derived
    // guessing exactly as before.
    const cleanedSheetName = clean(sheet.name);
    const isGenericSheetName = !cleanedSheetName || /^(sheet|hoja|plan)\d*$/.test(normalizeAscii(cleanedSheetName));

    if (!isGenericSheetName) {
      return prettifyLabel(cleanedSheetName);
    }

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

  if (flatPhoneBearingRows >= MIN_FLAT_PHONE_BEARING_ROWS) {
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

// ---------------------------------------------------------------------------
// I/O helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Main normalization entry point (sync — used by worker and Vitest)
// ---------------------------------------------------------------------------

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
  const buscasSheets: Array<{ name: string; rows: string[][] }> = [];
  let socialHandleSkippedRowCount = 0;

  for (const sheet of sheets) {
    if (sheet.rows.length === 0) {
      continue;
    }

    // OIR-130: Route buscas sheets to the dedicated pager parser instead of skipping.
    // These sheets (Buscas_Facultativos, Buscas_Enfermería, Buscas_Celadores,
    // Buscas_Varios) use column-per-holder-type layout and belong to the separate
    // Buscas section. parseBuscasSheets() is called after the loop with all collected
    // sheets so a single BuscasSheetParseResult is returned to the caller.
    if (isDeferredFeatureSheet(sheet.slug)) {
      buscasSheets.push({ name: sheet.name, rows: sheet.rows });
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

    if (profile.parser === "tabular") {
      records.push(...normalizeTabularAgendaSheet(sheet, profile));
      continue;
    }

    const serviceResult = normalizeServiceSheet(sheet, profile);
    records.push(...serviceResult.records);
    socialHandleSkippedRowCount += serviceResult.socialSkippedRows;
  }

  if (records.length === 0 && buscasSheets.length === 0) {
    throw new Error(
      "No se encontraron hojas soportadas para importar. Usa Admisión Central, Urgencias, Rayos, Secretarías, Hospitales de día, UMI o Centros de salud."
    );
  }

  // OIR-130: Parse buscas sheets collected above.
  const buscasParseResult = parseBuscasSheets(buscasSheets);

  // Allow import of buscas-only workbooks (no phone contacts) only when at least one
  // buscas record was parsed. Otherwise the "no supported sheets" error stands for
  // workbooks that are genuinely empty.
  if (records.length === 0 && buscasParseResult.parsedCellCount === 0) {
    throw new Error(
      "No se encontraron hojas soportadas para importar. Usa Admisión Central, Urgencias, Rayos, Secretarías, Hospitales de día, UMI o Centros de salud."
    );
  }

  // Merge records that share the same normalized displayName across sheets.
  const mergedRecords = mergeRecordsByDisplayName(records);

  return {
    rows: mergedRecords,
    ...summarizeDetectedFormat(profiles.length > 0 ? profiles : []),
    buscasParseResult,
    buscasSkippedRowCount: buscasParseResult.skippedRowCount,
    socialHandleSkippedRowCount
  };
};

// ---------------------------------------------------------------------------
// Worker orchestration
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Public API entry point
// ---------------------------------------------------------------------------

const emptyBuscasParseResult = (): BuscasSheetParseResult => ({
  records: [],
  parsedCellCount: 0,
  skippedRowCount: 0
});

export const buildSpreadsheetImportPreview = async (
  sourceFilePath: string,
  editorName: string
): Promise<{ dataset: DirectoryDataset; preview: CsvImportPreviewInternal; buscasParseResult: BuscasSheetParseResult }> => {
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
      },
      buscasParseResult: emptyBuscasParseResult()
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

  const result = await buildImportPreviewFromRows(normalized.rows, {
    sourceFilePath,
    fileName: path.basename(sourceFilePath),
    editorName,
    detectedFormat: normalized.detectedFormat,
    detectionConfidence: normalized.detectionConfidence,
    buscasSkippedRowCount: normalized.buscasSkippedRowCount,
    socialHandleSkippedRowCount: normalized.socialHandleSkippedRowCount
  });

  return {
    ...result,
    preview: {
      ...result.preview,
      parsedBuscasCellCount: normalized.buscasParseResult.parsedCellCount
    },
    buscasParseResult: normalized.buscasParseResult
  };
};
