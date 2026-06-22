/**
 * OIR-130 — Buscas sheet parser.
 *
 * ODS buscas sheets (Buscas_Facultativos, Buscas_Enfermería, Buscas_Celadores,
 * Buscas_Varios) use a column-per-holder-type layout:
 *
 *   Col 0: SERVICIO (row label — the service/department name)
 *   Col 1+: holder-type columns (PRINCIPAL, PRINCIPAL / RESIDENTE, ADJUNTO 1, etc.)
 *   Last col: COMENTARIOS (ignored — no pager numbers)
 *
 * The header row ("PRINCIPAL / RESIDENTE", "ADJUNTO 1", etc.) is detected
 * and used as column labels — it must NOT become a contact.
 *
 * Each non-empty data cell produces one ImportedBuscaRecord:
 *   deviceNumber = cell value (e.g. "7321")
 *   department   = prettified row label (e.g. "Anestesia")
 *   holderType   = prettified column header (e.g. "Principal / Residente")
 *   sourceSheet  = sheet name from the ODS
 *   sourceRow    = 0-based data row index (after header)
 */

import type { ImportedBuscaRecord } from "../../shared/schemas/busca.schema.js";

type RawSheetData = {
  name: string;
  rows: string[][];
};

// ---------------------------------------------------------------------------
// Header detection
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
 * Detects the header row within the first 5 rows.
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

// ---------------------------------------------------------------------------
// Cell prettification
// ---------------------------------------------------------------------------

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
 * Real pager codes are 4–6 digit strings; we accept any non-empty numeric-ish
 * value (digits, hyphens, dots) to handle "7321", "7321-A", "83.2" etc.
 * Rejects cells that are clearly comment/label text (contain letters).
 */
const isPagerNumber = (value: string): boolean => {
  const trimmed = value.trim();
  if (!trimmed) return false;
  // Must start with a digit and be mostly numeric
  return /^\d[\d\s.\-]*$/.test(trimmed) && trimmed.length <= 20;
};

// ---------------------------------------------------------------------------
// Public parse function
// ---------------------------------------------------------------------------

export type BuscasSheetParseResult = {
  records: Omit<ImportedBuscaRecord, "id">[];
  /** Number of non-empty pager cells that were parsed into records. */
  parsedCellCount: number;
  /** Number of rows skipped because they were empty or comment-only. */
  skippedRowCount: number;
};

/**
 * Parses a single buscas sheet and returns import-ready records (no IDs —
 * the service assigns IDs when persisting).
 *
 * @param sheet    Raw sheet data (name + 2-D string array of cells).
 * @param options  Optional overrides for testing.
 */
export const parseBuscasSheet = (
  sheet: RawSheetData
): BuscasSheetParseResult => {
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
        deviceNumber: cellValue,
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

/**
 * Parses multiple buscas sheets and aggregates the results.
 */
export const parseBuscasSheets = (
  sheets: RawSheetData[]
): BuscasSheetParseResult => {
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
