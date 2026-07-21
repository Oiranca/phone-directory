import { z } from "zod";

/**
 * Validates the per-row conflict-policy selections the
 * renderer submits when confirming a CSV/ODS/XLS/XLSX bulk import
 * (`importCsvDataset`). Previously this array was validated by hand
 * (typeof/Number.isInteger/Set.has checks in contacts.ipc.ts) instead of
 * going through Zod like every other IPC input in this codebase
 * (createRecord, updateRecord, mergeDuplicates, beeper channels, etc). Not
 * exploitable as hand-written (the manual checks were correct), but a
 * consistency/maintainability regression risk — extracted here so future
 * changes to this shape can't silently bypass validation.
 */
export const csvImportPolicySelectionSchema = z.object({
  recordIndex: z.number().int(),
  policy: z.enum(["overwrite", "skip", "merge-fields"])
});

// Defensive upper bound: this list holds at most one entry per *conflicting*
// row of the previewed import — a subset of the total row count, which the
// import services already cap at 5000 rows (MAX_CSV_IMPORT_ROWS in
// csv-import.service.ts / MAX_SPREADSHEET_IMPORT_ROWS in
// spreadsheet-import.service.ts). Mirrored here as a literal rather than
// imported, since src/shared must not depend on src/main. A legitimate
// payload can never exceed this; anything larger is malformed or malicious
// and would otherwise force the main process to do unbounded work.
const MAX_CSV_IMPORT_POLICY_SELECTIONS = 5000;

export const csvImportPolicySelectionListSchema = z
  .array(csvImportPolicySelectionSchema)
  .max(MAX_CSV_IMPORT_POLICY_SELECTIONS);

export type CsvImportPolicySelectionInput = z.infer<typeof csvImportPolicySelectionSchema>;
