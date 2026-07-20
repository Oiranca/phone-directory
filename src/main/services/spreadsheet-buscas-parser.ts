/**
 * Buscas sheet parser.
 *
 * OIR-266: the real-world ODS buscas sheets ("Buscas Todos", "Buscas Usuales",
 * "Buscas Celadores") use a PER-PERSON/PER-ROW layout, not the legacy
 * column-per-holder-type layout this parser originally targeted:
 *
 *   Nombre | Categoría | Servicio | Busca 1 | Busca 2 | Número 1 | Corporativo | ...
 *
 * (column order varies slightly between sheets — e.g. "Buscas Celadores" has
 * Número 1/Corporativo before Busca 1/Busca 2 — so columns are always located
 * by NAME, never by fixed index.)
 *
 * Each data row identifies a single service/holder via Nombre/Categoría/Servicio,
 * and carries up to two 4-5 digit pager codes in "Busca 1"/"Busca 2". A row with
 * both cells filled produces TWO ImportedBuscaRecord entries (one per code).
 * "Número 1"/"Corporativo" are phone extensions, not pager codes, and are ignored
 * here.
 *
 * Confirmed against the real source workbook (Agenda Normalizada.ods,
 * 2026-07-20): all three buscas sheets present in that workbook use this exact
 * per-person layout — no sheet used the legacy column-per-holder-type shape.
 *
 * LEGACY LAYOUT (kept as a fallback): earlier/other ODS exports used a
 * column-per-holder-type layout instead:
 *
 *   Col 0: SERVICIO (row label — the service/department name)
 *   Col 1+: holder-type columns (PRINCIPAL, PRINCIPAL / RESIDENTE, ADJUNTO 1, etc.)
 *   Last col: COMENTARIOS (ignored — no pager numbers)
 *
 * parseBuscasSheet() tries the new per-person layout first (detected via a
 * literal "Busca 1" column header) and falls back to the legacy holder-type
 * layout when no such column is found. The legacy path is retained because it
 * is still exercised indirectly by the wider import-pipeline test suite
 * (spreadsheet-import-row-skips.test.ts, spreadsheet-import.golden.test.ts,
 * app-data.service.test.ts, buscas.service.test.ts) with real
 * PRINCIPAL/RESIDENTE-style fixtures; there is no evidence those shapes still
 * occur in current source data, but removing support outright is out of scope
 * for OIR-266 (parser rewrite only).
 */

import type { ImportedBuscaRecord } from "../../shared/schemas/busca.schema.js";

type RawSheetData = {
  name: string;
  rows: string[][];
};

// ---------------------------------------------------------------------------
// Shared cell normalisation helpers
// ---------------------------------------------------------------------------

/**
 * Normalises a raw cell to uppercase, strips punctuation noise, collapses
 * spaces — used only for column-header matching, not stored in records.
 */
const normalizeHeaderCell = (cell: string): string =>
  cell
    .toUpperCase()
    .replace(/[^A-ZÁÉÍÓÚÜÑ0-9\s/]/gi, "")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Normalises a raw cell for EXACT column-name matching: uppercase, strips
 * accents (so "Categoría" and "CATEGORIA" both match "CATEGORIA"), collapses
 * whitespace. Used to locate the new per-person layout's named columns
 * (Busca 1, Busca 2, Nombre, Categoría, Servicio).
 */
const normalizeColumnName = (cell: string): string =>
  cell
    .normalize("NFD")
    // Strip combining diacritical marks (U+0300–U+036F) left behind by NFD
    // decomposition, e.g. "í" → "i" + U+0301.
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();

/**
 * Prettifies a raw ODS cell value for display:
 *   - Title-cases words (e.g. "ANESTESIA" → "Anestesia")
 *   - Preserves "/" separators (e.g. "PRINCIPAL / RESIDENTE" → "Principal / Residente")
 *   - Collapses extra whitespace
 */
const prettify = (raw: string): string =>
  raw
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[A-Za-záéíóúüñÁÉÍÓÚÜÑ]+/g, (word) =>
      word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()
    );

/**
 * Returns true when a cell value looks like a pager/localizador number.
 * Real pager codes are usually 4 digits but occasional 5-digit codes exist
 * in real data (e.g. "79258"); we accept any non-empty numeric-ish value
 * (digits, hyphens, dots) to handle "7321", "7321-A", "83.2" etc.
 * Rejects cells that are clearly comment/label text (contain letters).
 */
const isPagerNumber = (value: string): boolean => {
  const trimmed = value.trim();
  if (!trimmed) return false;
  // Must start with a digit and be mostly numeric
  return /^\d[\d\s.\-]*$/.test(trimmed) && trimmed.length <= 20;
};

/**
 * Normalises a pager number for storage: strips all internal whitespace so
 * that "7 321" → "7321" and lookups by typing "7321" always succeed.
 * Leading/trailing whitespace is already removed by the caller (.trim()) before
 * isPagerNumber is called; this strips only internal spaces.
 */
const normalizePagerNumber = (value: string): string => value.replace(/\s+/g, "");

export type BuscasSheetParseResult = {
  records: Omit<ImportedBuscaRecord, "id">[];
  /** Number of non-empty pager cells that were parsed into records. */
  parsedCellCount: number;
  /** Number of rows skipped because they were empty or comment-only. */
  skippedRowCount: number;
};

// ---------------------------------------------------------------------------
// New layout: per-person rows with named "Busca 1"/"Busca 2" columns
// ---------------------------------------------------------------------------

const NEW_LAYOUT_COLUMN_NAMES = {
  busca1: "BUSCA 1",
  busca2: "BUSCA 2",
  name: "NOMBRE",
  category: "CATEGORIA",
  service: "SERVICIO"
} as const;

type NewLayoutColumnMap = {
  busca1: number;
  busca2: number;
  name: number;
  category: number;
  service: number;
};

/**
 * Detects the header row of the new per-person layout within the first 5 rows.
 * Triggered by a literal "Busca 1" column header (accent/case-insensitive) —
 * the layout's distinguishing marker. Returns the 0-based row index and the
 * resolved column map, or null when not found.
 */
const detectNewLayoutHeader = (
  rows: string[][]
): { headerIdx: number; columns: NewLayoutColumnMap } | null => {
  for (let i = 0; i < Math.min(rows.length, 5); i++) {
    const row = rows[i] ?? [];
    const normalizedCells = row.map(normalizeColumnName);
    const busca1Idx = normalizedCells.indexOf(NEW_LAYOUT_COLUMN_NAMES.busca1);
    if (busca1Idx === -1) continue;

    const serviceIdx = normalizedCells.indexOf(NEW_LAYOUT_COLUMN_NAMES.service);
    if (serviceIdx === -1) {
      // No identity column to anchor the required `department` field — not a
      // usable new-layout header, keep searching.
      continue;
    }

    return {
      headerIdx: i,
      columns: {
        busca1: busca1Idx,
        busca2: normalizedCells.indexOf(NEW_LAYOUT_COLUMN_NAMES.busca2),
        name: normalizedCells.indexOf(NEW_LAYOUT_COLUMN_NAMES.name),
        category: normalizedCells.indexOf(NEW_LAYOUT_COLUMN_NAMES.category),
        service: serviceIdx
      }
    };
  }
  return null;
};

/** Reads a cell by column index, returning "" for missing columns/cells. */
const cellAt = (row: string[], colIdx: number): string =>
  colIdx === -1 ? "" : (row[colIdx] ?? "");

const parseNewLayoutSheet = (
  sheet: RawSheetData,
  headerIdx: number,
  columns: NewLayoutColumnMap
): BuscasSheetParseResult => {
  const { name: sheetName, rows } = sheet;
  const records: Omit<ImportedBuscaRecord, "id">[] = [];
  let parsedCellCount = 0;
  let skippedRowCount = 0;

  const dataRows = rows.slice(headerIdx + 1);

  for (let rowIdx = 0; rowIdx < dataRows.length; rowIdx++) {
    const row = dataRows[rowIdx] ?? [];
    const rawService = cellAt(row, columns.service).trim();

    if (!rawService) {
      skippedRowCount += 1;
      continue;
    }

    const department = prettify(rawService);
    const name = cellAt(row, columns.name).trim() || undefined;
    const category = cellAt(row, columns.category).trim() || undefined;

    const buscaValues = [cellAt(row, columns.busca1), cellAt(row, columns.busca2)];

    let rowHasRecord = false;
    for (const rawValue of buscaValues) {
      const cellValue = rawValue.trim();
      if (!isPagerNumber(cellValue)) continue;

      records.push({
        deviceNumber: normalizePagerNumber(cellValue),
        department,
        name,
        category,
        sourceSheet: sheetName,
        sourceRow: rowIdx
      });
      parsedCellCount += 1;
      rowHasRecord = true;
    }

    if (!rowHasRecord) {
      skippedRowCount += 1;
    }
  }

  return { records, parsedCellCount, skippedRowCount };
};

// ---------------------------------------------------------------------------
// Legacy layout: column-per-holder-type (fallback)
// ---------------------------------------------------------------------------

/**
 * Column-header keywords that identify a pager-number column.
 * A cell is a holder-type header when it contains one of these words.
 */
const HOLDER_TYPE_KEYWORDS = [
  "PRINCIPAL",
  "RESIDENTE",
  "ADJUNTO",
  "SUPLENTE",
  "GUARDIA",
  "LOCALIZADOR"
] as const;

const isHolderTypeHeader = (cell: string): boolean => {
  const norm = normalizeHeaderCell(cell);
  return HOLDER_TYPE_KEYWORDS.some((kw) => norm.includes(kw));
};

/**
 * Detects the legacy header row within the first 5 rows.
 * The header row must have at least one holder-type column header in col 1+.
 * Returns the 0-based row index, or -1 if not found.
 */
export const detectBuscasHeaderRowIndex = (rows: string[][]): number => {
  for (let i = 0; i < Math.min(rows.length, 5); i++) {
    const row = rows[i] ?? [];
    // Col 0 is the SERVICIO label; check col 1+ for holder-type keywords
    const holderCols = row.slice(1).filter(isHolderTypeHeader);
    if (holderCols.length >= 1) {
      return i;
    }
  }
  return -1;
};

const parseLegacyLayoutSheet = (sheet: RawSheetData): BuscasSheetParseResult => {
  const { name: sheetName, rows } = sheet;

  const headerIdx = detectBuscasHeaderRowIndex(rows);
  if (headerIdx === -1) {
    // Cannot identify header — treat all rows as skipped
    return { records: [], parsedCellCount: 0, skippedRowCount: rows.length };
  }

  const headerRow = rows[headerIdx] ?? [];

  // Build column map: colIndex → prettified holder-type label
  // Col 0 is always the SERVICIO column — skip it
  const holderTypeByCol = new Map<number, string>();
  for (let c = 1; c < headerRow.length; c++) {
    const cell = headerRow[c] ?? "";
    if (isHolderTypeHeader(cell)) {
      holderTypeByCol.set(c, prettify(cell));
    }
    // Non-holder columns (e.g. COMENTARIOS) are silently skipped
  }

  const records: Omit<ImportedBuscaRecord, "id">[] = [];
  let parsedCellCount = 0;
  let skippedRowCount = 0;

  const dataRows = rows.slice(headerIdx + 1);

  for (let rowIdx = 0; rowIdx < dataRows.length; rowIdx++) {
    const row = dataRows[rowIdx] ?? [];
    const rawDept = (row[0] ?? "").trim();

    if (!rawDept) {
      skippedRowCount += 1;
      continue;
    }

    const department = prettify(rawDept);
    let rowHasRecord = false;

    for (const [colIdx, holderType] of holderTypeByCol) {
      const cellValue = (row[colIdx] ?? "").trim();
      if (!isPagerNumber(cellValue)) {
        continue;
      }

      records.push({
        deviceNumber: normalizePagerNumber(cellValue),
        department,
        holderType,
        sourceSheet: sheetName,
        sourceRow: rowIdx
      });
      parsedCellCount += 1;
      rowHasRecord = true;
    }

    if (!rowHasRecord) {
      skippedRowCount += 1;
    }
  }

  return { records, parsedCellCount, skippedRowCount };
};

// ---------------------------------------------------------------------------
// Public parse functions
// ---------------------------------------------------------------------------

/**
 * Parses a single buscas sheet and returns import-ready records (no IDs —
 * the service assigns IDs when persisting).
 *
 * Tries the new per-person "Busca 1"/"Busca 2" layout first; falls back to
 * the legacy column-per-holder-type layout when no "Busca 1" column is found.
 *
 * @param sheet Raw sheet data (name + 2-D string array of cells).
 */
export const parseBuscasSheet = (sheet: RawSheetData): BuscasSheetParseResult => {
  const newLayout = detectNewLayoutHeader(sheet.rows);
  if (newLayout) {
    return parseNewLayoutSheet(sheet, newLayout.headerIdx, newLayout.columns);
  }
  return parseLegacyLayoutSheet(sheet);
};

/**
 * Parses multiple buscas sheets and aggregates the results.
 */
export const parseBuscasSheets = (sheets: RawSheetData[]): BuscasSheetParseResult => {
  const combined: BuscasSheetParseResult = {
    records: [],
    parsedCellCount: 0,
    skippedRowCount: 0
  };

  for (const sheet of sheets) {
    const result = parseBuscasSheet(sheet);
    combined.records.push(...result.records);
    combined.parsedCellCount += result.parsedCellCount;
    combined.skippedRowCount += result.skippedRowCount;
  }

  return combined;
};
