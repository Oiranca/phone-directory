/**
 * spreadsheet-normalize.ts — Pure normalization helpers for the spreadsheet
 * import pipeline.
 *
 * All functions in this module are:
 *   - PURE: no I/O, no side effects, no Node.js built-ins beyond string/array ops
 *   - STATELESS: no module-level state that changes at runtime
 *   - FORMAT-AGNOSTIC: they serve both the service-sheet and centers-sheet parsers
 *
 * Extracted from spreadsheet-import.service.ts as part of OIR-109. The
 * heuristics that decide WHICH parser applies (detectSheetProfile, scoring
 * functions, format detection) deliberately remain in the main service so
 * this module stays free of decision logic.
 */

// ---------------------------------------------------------------------------
// Constants — privacy markers (shared by both parsers)
// ---------------------------------------------------------------------------

export const NO_SHARE_MARKERS = [
  "NO DAR A LA CALLE",
  "NO PASAR DESPACHO MÉDICO",
  "NO DAR EL NÚMERO LARGO A LA CALLE",
  "NO PASAR LLAMADAS EXTERNAS",
  "NO HACEN CAMBIOS DE CITAS"
];

export const CONFIDENTIAL_MARKERS = [
  "DESPACHO MÉDICO",
  "INTERNAL USE ONLY"
];

// ---------------------------------------------------------------------------
// Serialized phone entry type + guard (also exported from main service)
// ---------------------------------------------------------------------------

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
 * Runtime type guard for SerializedPhoneEntry (Bug 4 fix).
 * Validates that an untrusted JSON-parsed value has the required shape before
 * it is used so a crafted phones column cannot crash the import pipeline.
 */
export const isSerializedPhoneEntry = (value: unknown): value is SerializedPhoneEntry =>
  typeof value === "object" &&
  value !== null &&
  typeof (value as Record<string, unknown>).number === "string" &&
  typeof (value as Record<string, unknown>).label === "string" &&
  typeof (value as Record<string, unknown>).kind === "string" &&
  typeof (value as Record<string, unknown>).isPrimary === "boolean" &&
  typeof (value as Record<string, unknown>).confidential === "boolean" &&
  typeof (value as Record<string, unknown>).noPatientSharing === "boolean";

// ---------------------------------------------------------------------------
// String cleaning
// ---------------------------------------------------------------------------

/** Collapse non-breaking spaces, multiple whitespace, and trim. */
export const clean = (value: string) =>
  value.replace(/ /g, " ").split(/\s+/).filter(Boolean).join(" ").trim();

/** Remove a leading UTF-8 BOM character if present. */
export const stripBom = (value: string) => value.replace(/^\uFEFF/, "");

/** Returns true when the string contains at least one letter (including accented). */
export const hasLetters = (value: string) => /[A-Za-zÁÉÍÓÚáéíóúÑñ]/.test(value);

// ---------------------------------------------------------------------------
// Normalization transforms
// ---------------------------------------------------------------------------

/**
 * Normalizes a displayName for cross-sheet identity matching.
 * Re-exported alias for the canonical NFKD normalizer in shared/utils/matching.ts.
 * Two names that are equal after this transform are considered the same contact.
 * Exact normalized equality only — no fuzzy matching.
 */
export { normalizeDisplayName as normalizeDisplayNameForMerge } from "../../shared/utils/matching.js";

/**
 * Normalizes a phone number for deduplication purposes:
 * strip all non-digit characters.
 *
 * Re-exported from shared/utils/matching.ts (normalizePhoneForDedup) so that
 * spreadsheet-parsers.ts consumers keep their existing import path.
 */
export { normalizePhoneForDedup as normalizeNumberForDedup } from "../../shared/utils/matching.js";

/** ASCII-slug normalization: lower, strip diacritics, replace non-alnum with "-". */
export const normalizeAscii = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "sheet";

/** Diacritic-stripped uppercase with whitespace removed, for marker matching. */
export const normalizeMarker = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toUpperCase()
    .replace(/\s+/g, "");

// ---------------------------------------------------------------------------
// Array helpers
// ---------------------------------------------------------------------------

/** Remove duplicates while preserving original encounter order. */
export const dedupeKeepOrder = (values: string[]) => {
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

// ---------------------------------------------------------------------------
// Number extraction helpers
// ---------------------------------------------------------------------------

/**
 * Expands a compact range like "928101-15" → ["928101", "928102", ..., "928115"].
 * Returns null when the string is not a compact range or the range is too large (>20).
 */
export const expandCompactRange = (part: string) => {
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

/**
 * Expands a compact suffix like "928101, 02" where "02" expands to "928102"
 * by borrowing the prefix from the previous number.
 * Returns null when the suffix cannot be expanded.
 */
export const expandCompactSuffix = (previousDigits: string | undefined, currentPart: string) => {
  const currentDigits = currentPart.replace(/\D/g, "");

  if (!previousDigits || currentDigits.length === 0 || currentDigits.length >= previousDigits.length) {
    return null;
  }

  const prefix = previousDigits.slice(0, previousDigits.length - currentDigits.length);
  const candidate = `${prefix}${currentDigits}`;

  return /^\d+$/.test(candidate) ? candidate : null;
};

/**
 * Extracts all phone-like digit strings from a cell value.
 * Handles slash-separated lists, compact ranges, and compact suffixes.
 * Returns an ordered, deduplicated list of digit strings (≥4 digits each).
 */
export const extractNumbers = (text: string) => {
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

// ---------------------------------------------------------------------------
// Privacy detection
// ---------------------------------------------------------------------------

/**
 * Scans a note/label string for privacy-relevant markers.
 * Returns confidential and noPatientSharing flags.
 */
export const detectPrivacy = (notes: string): { confidential: boolean; noPatientSharing: boolean } => {
  const upper = notes.toUpperCase();
  return {
    confidential: CONFIDENTIAL_MARKERS.some((marker) => upper.includes(marker)),
    noPatientSharing: NO_SHARE_MARKERS.some((marker) => upper.includes(marker))
  };
};

/**
 * Parses a row-level "Si"/"Sí" (case- and accent-insensitive) boolean cell value,
 * as used by the ODS "Confidencial" column in the tabular Agenda sheet format
 * (OIR-222). Reuses normalizeMarker (NFKD strip diacritics + uppercase + strip
 * whitespace) so "Si", "sí", " SÍ " all resolve the same way. Any other value
 * (including empty string) is treated as false.
 */
export const parseSiNoFlag = (value: string): boolean => normalizeMarker(value) === "SI";

// ---------------------------------------------------------------------------
// Label and note helpers
// ---------------------------------------------------------------------------

/** Returns true when a string looks like a date value (dd/mm/yyyy etc.). */
export const looksLikeDateValue = (value: string) => {
  const normalized = clean(value);

  if (!normalized) {
    return false;
  }

  return /^(\d{1,4})[\/.-](\d{1,2})[\/.-](\d{1,4})$/.test(normalized);
};

/**
 * Returns true when a cell value contains at least one phone-like number
 * (4–9 digits) and does not look like a date.
 */
export const hasPhoneLikeNumber = (value: string) =>
  !looksLikeDateValue(value) && extractNumbers(value).some((number) => number.length >= 4 && number.length <= 9);

/**
 * Cleans an array of note fragment strings: trims, filters blanks, and removes
 * internal INDICE_AGENDA markers that appear as noise in some sheets.
 */
export const cleanNoteFragments = (values: string[]) =>
  values
    .map((value) => clean(value))
    .filter((value) => {
      if (!value) {
        return false;
      }

      const marker = normalizeMarker(value);
      return marker !== "INDICEAGENDA" && marker !== "INDICEAGENDAHOSPITALARIA";
    });

/** Returns true when a label looks like a person's name (heuristic — person markers). */
export const looksLikePerson = (label: string) => {
  const lower = label.toLowerCase();
  return ["dr.", "dra.", "laura", "juan", "lidia", "tere", "cris", "ana ", "david ", "natalia "]
    .some((marker) => lower.includes(marker));
};

/** Infers the contact type from the label and sheet slug. */
export const classifyType = (label: string, sheetSlug: string) => {
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

/** Returns common aliases inferred from label content (TAC→scanner, RX→radiologia, etc.). */
export const aliasesFromLabel = (label: string) => {
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

// ---------------------------------------------------------------------------
// Excluded-label gate (canonical — imported by both service and parsers)
// ---------------------------------------------------------------------------

/**
 * Patterns whose matching labels are considered noise / structural markers
 * and must not be treated as contact names.
 */
export const EXCLUDED_PATTERNS = [
  /^servicio$/i,
  /^n[uú]mero/i,
  /^centros de salud$/i,
  /^sala[s]?$/i,
  /^[A-ZÁÉÍÓÚÑ][A-ZÁÉÍÓÚÑ\s\-.\(\)0-9]+$/
];

/**
 * Returns true when a label value is a structural/noise cell that should be
 * skipped rather than imported as a contact field.
 */
export const isExcludedLabel = (label: string) => {
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

/** Returns true when the label is a meaningful service label (has letters, not excluded, not a date). */
export const isMeaningfulServiceLabel = (
  value: string,
  isExcludedLabelFn: (label: string) => boolean
) => {
  const normalized = clean(value);

  if (!normalized || !hasLetters(normalized) || isExcludedLabelFn(normalized) || looksLikeDateValue(normalized)) {
    return false;
  }

  return !/^\d/.test(normalized);
};

/** Prettifies a raw label by replacing delimiters and title-casing. */
export const prettifyLabel = (value: string) =>
  clean(
    value
      .replace(/[_-]+/g, " ")
      .toLowerCase()
      .replace(/\b\w/g, (match) => match.toUpperCase())
  );

/** Infers the contact area slug from the label/department name. */
export const inferAreaFromLabel = (value: string) => {
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

