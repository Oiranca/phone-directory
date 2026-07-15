/**
 * Shared spreadsheet-import test helper (OIR-217/MANT-6).
 *
 * Previously copy-pasted verbatim across spreadsheet-import.golden.test.ts,
 * spreadsheet-import-oir102-multisheet.test.ts, spreadsheet-import-oir102-interim.test.ts
 * and social-contact-oir131.test.ts. Extracted here so it has a single
 * definition shared by all spreadsheet-import test suites.
 */
import path from "node:path";
import XLSX from "xlsx";

/** Write a multi-sheet workbook to disk as .xlsx and return the file path. */
export const writeWorkbook = (
  dir: string,
  fileName: string,
  sheets: Array<{ name: string; data: string[][] }>
): string => {
  const wb = XLSX.utils.book_new();

  for (const { name, data } of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, name);
  }

  const filePath = path.join(dir, fileName);
  XLSX.writeFile(wb, filePath);
  return filePath;
};
