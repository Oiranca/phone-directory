import { z } from "zod";

/**
 * OIR-212 (SEC-5) — validates the per-row conflict-policy selections the
 * renderer submits when confirming a CSV/ODS/XLS/XLSX bulk import
 * (`importCsvDataset`). Previously this array was validated by hand
 * (typeof/Number.isInteger/Set.has checks in contacts.ipc.ts) instead of
 * going through Zod like every other IPC input in this codebase
 * (createRecord, updateRecord, mergeDuplicates, busca channels, etc). Not
 * exploitable as hand-written (the manual checks were correct), but a
 * consistency/maintainability regression risk — extracted here so future
 * changes to this shape can't silently bypass validation.
 */
export const csvImportPolicySelectionSchema = z.object({
  recordIndex: z.number().int(),
  policy: z.enum(["overwrite", "skip", "merge-fields"])
});

export const csvImportPolicySelectionListSchema = z.array(csvImportPolicySelectionSchema);

export type CsvImportPolicySelectionInput = z.infer<typeof csvImportPolicySelectionSchema>;
