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
 * Extracted from spreadsheet-import.service.ts as part of OIR-109.
 * The heuristics that decide WHICH parser applies deliberately remain in the
 * main service.
 */

import type { NormalizedImportRow } from "./csv-import.service.js";
import {
  clean,
  hasLetters,
  hasPhoneLikeNumber,
  looksLikeDateValue,
  extractNumbers,
  detectPrivacy,
  cleanNoteFragments,
  dedupeKeepOrder,
  classifyType,
  aliasesFromLabel,
  normalizeDisplayNameForMerge,
  normalizeNumberForDedup,
  isSerializedPhoneEntry,
  normalizeMarker,
  normalizeAscii,
  isExcludedLabel,
  parseSiNoFlag,
  inferAreaFromLabel,
} from "./spreadsheet-normalize.js";
import type { SerializedPhoneEntry } from "./spreadsheet-normalize.js";

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
  // OIR-222: role/job title and operating hours (ODS "Categoría"/"Horario" columns).
  role: "",
  schedule: "",
  building: "",
  floor: "",
  room: "",
  locationText: "",
  // OIR-222: ODS "Sector"/"Sección" columns.
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
  // Social media columns (OIR-131)
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

export type DetectionConfidence = "high" | "medium" | "low";

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
 * Social context detection (INTERIM OIR-102 — see main service for full docs).
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
 * Infers the social-media platform from one or more text sources (OIR-131).
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
   * (OIR-131): Social-handle rows are now imported as first-class contacts,
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
      // OIR-131: Do NOT treat a single-cell row as a section header when it
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
      // OIR-131: same guard as the first section-header path — skip this
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
    // social-handle rows (single cell with empty tail cells) are not dropped here
    // (OIR-131). prevRowHadSocialContext is updated now; the early-exit only fires
    // when the row is neither a phone row nor a social handle.
    const thisCellsHaveSocialContext = rowContainsSocialToken(cells);
    const effectiveSocialContext = sectionIsSocial(currentSection) || thisCellsHaveSocialContext || prevRowHadSocialContext;
    prevRowHadSocialContext = thisCellsHaveSocialContext;

    if (
      dedupedPhoneNumbers.length === 0 &&
      cells.slice(1).every((value) => !value) &&
      // OIR-131: Don't drop a social-handle row just because its tail cells are all empty.
      !isSocialContextRow(label, effectiveSocialContext)
    ) {
      return;
    }

    // OIR-131: Social-handle rows are now first-class contacts, not skipped.
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
      record.type = classifyType(label, metadata.slug);
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
    record.type = classifyType(label, metadata.slug);
    record.displayName = label;
    record.area = metadata.area;
    record.department = metadata.department;
    record.service = currentSection && currentSection !== metadata.department ? currentSection : label;
    record.aliases = aliasesFromLabel(label);
    record.notes = finalNotes;
    record.status = "active";

    const phoneEntries = dedupedPhoneNumbers.map((number, index) => ({
      number,
      label: sheet.name,
      kind: "internal",
      isPrimary: index === 0,
      confidential: privacy.confidential,
      noPatientSharing: privacy.noPatientSharing,
      notes: finalNotes || undefined
    }));
    record.phones = JSON.stringify(phoneEntries);

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

  return { records, socialSkippedRows };
};

// ---------------------------------------------------------------------------
// Tabular Agenda-sheet parser (OIR-222)
// ---------------------------------------------------------------------------

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
 * AGENDA_TABULAR_HEADER_MARKERS above 1:1 by position.
 */
const AGENDA_COLUMN = {
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
} as const;

/**
 * Returns true when `headerRow` matches the canonical Agenda tabular header
 * (see AGENDA_TABULAR_HEADER_MARKERS), cell-by-cell.
 */
export const isAgendaTabularHeader = (headerRow: string[]): boolean =>
  AGENDA_TABULAR_HEADER_MARKERS.every((marker, index) => normalizeMarker(headerRow[index] ?? "") === marker);

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
 * Parses a tabular Agenda-format sheet (OIR-222): a flat table with an exact
 * 17-column header (Nombre, Categoría, Servicio, Número 1..7, Horario,
 * Confidencial, Edificio, Planta, Sector, Sección, Comentarios), one contact
 * per data row. Unlike normalizeServiceSheet, columns are read by FIXED INDEX
 * (not inferred from cell content) because the header guarantees positional
 * meaning.
 *
 * Row exclusions (see OIR-222 investigation, confirmed against the real file):
 *   - the header row itself (handled by profile.rowsToSkip)
 *   - "section divider" rows with exactly one non-empty cell, in column 0
 *     (e.g. "Letra A", "Hospital Polivalente")
 *   - rows with no Nombre AND no Servicio (nothing to build a displayName from)
 *
 * Row-level Confidencial ("Si"/"Sí") is applied to EVERY phone built from that
 * row's Número 1..7 columns (OIR-222 Step 3), not just the first phone.
 */
export const normalizeTabularAgendaSheet = (
  sheet: SheetData,
  profile: SheetProfile
): NormalizedImportRow[] => {
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

    const nombre = cells[AGENDA_COLUMN.nombre] ?? "";
    const categoria = cells[AGENDA_COLUMN.categoria] ?? "";
    const servicio = cells[AGENDA_COLUMN.servicio] ?? "";
    const horario = cells[AGENDA_COLUMN.horario] ?? "";
    const confidencialRaw = cells[AGENDA_COLUMN.confidencial] ?? "";
    const edificio = cells[AGENDA_COLUMN.edificio] ?? "";
    const planta = cells[AGENDA_COLUMN.planta] ?? "";
    const sector = cells[AGENDA_COLUMN.sector] ?? "";
    const seccion = cells[AGENDA_COLUMN.seccion] ?? "";
    const comentarios = cells[AGENDA_COLUMN.comentarios] ?? "";

    const displayName = nombre || servicio;

    if (!displayName) {
      return;
    }

    // Row-level Confidencial ("Si"/"Sí") applies to every phone on this row
    // (OIR-222 Step 3) — OR'd with the existing free-text privacy-marker
    // detection over Comentarios for defense in depth (same markers used by
    // the legacy service-sheet parser).
    const rowConfidential = parseSiNoFlag(confidencialRaw);
    const privacy = detectPrivacy(comentarios);
    const confidential = rowConfidential || privacy.confidential;

    const phoneEntries: SerializedPhoneEntry[] = [];

    for (let column = AGENDA_COLUMN.numeroStart; column <= AGENDA_COLUMN.numeroEnd; column += 1) {
      const cellValue = cells[column] ?? "";

      if (!cellValue) {
        continue;
      }

      extractNumbers(cellValue).forEach((number) => {
        phoneEntries.push({
          number,
          label: `Número ${column - AGENDA_COLUMN.numeroStart + 1}`,
          kind: "internal",
          isPrimary: phoneEntries.length === 0,
          confidential,
          noPatientSharing: privacy.noPatientSharing,
          notes: comentarios || undefined
        });
      });
    }

    const record = blankRecord();

    record.externalId = `${profile.canonicalSlug}-${buildStableExternalId([String(rowIndex), displayName, servicio])}`;
    record.type = classifyType(displayName, profile.canonicalSlug);
    record.displayName = displayName;
    record.area = inferAreaFromLabel(servicio || displayName) ?? "";
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

    const first = phoneEntries[0];
    const second = phoneEntries[1];

    record.phone1Label = first ? first.label : "";
    record.phone1Number = first?.number ?? "";
    record.phone1Kind = first ? "internal" : "";
    record.phone1IsPrimary = first ? "true" : "false";
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

    const key = normalizeDisplayNameForMerge(record.displayName);

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

    const key = normalizeDisplayNameForMerge(record.displayName);

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
    const seenNormalized = new Set<string>();

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

        if (normalized && !seenNormalized.has(normalized)) {
          seenNormalized.add(normalized);
          combinedPhones.push(entry);
        }
      }
    }

    const reassertedPhones = combinedPhones.map((phone, index) => ({
      ...phone,
      isPrimary: index === 0
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

    result.push(base);
  }

  return result;
};
