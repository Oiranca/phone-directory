/**
 * Shared spreadsheet-import test helper (OIR-217/MANT-6).
 *
 * Previously copy-pasted verbatim across spreadsheet-import.golden.test.ts,
 * spreadsheet-import-oir102-multisheet.test.ts, spreadsheet-import-oir102-interim.test.ts
 * and social-contact-oir131.test.ts. Extracted here so it has a single
 * definition shared by all spreadsheet-import test suites.
 */
import fs from "node:fs";
import path from "node:path";
import XLSX from "xlsx";

/** Options for {@link writeWorkbook}. */
export interface WriteWorkbookOptions {
  /**
   * When true, creates `dir` (recursively) before writing the workbook.
   * Needed by callers that write into a nested/not-yet-existing directory
   * (e.g. `<testRoot>/incoming/...`), as opposed to callers whose `dir` is
   * already guaranteed to exist (e.g. a `mkdtemp` root used directly).
   */
  mkdir?: boolean;
}

/** Write a multi-sheet workbook to disk as .xlsx and return the file path. */
export const writeWorkbook = (
  dir: string,
  fileName: string,
  sheets: Array<{ name: string; data: string[][] }>,
  options?: WriteWorkbookOptions
): string => {
  if (options?.mkdir) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const wb = XLSX.utils.book_new();

  for (const { name, data } of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, name);
  }

  const filePath = path.join(dir, fileName);
  XLSX.writeFile(wb, filePath);
  return filePath;
};
