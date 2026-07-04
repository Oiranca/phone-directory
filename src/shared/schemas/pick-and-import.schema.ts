import { z } from "zod";

/**
 * OIR-219 — response envelope for the unified "Importar" entry point
 * (pickAndImportDataset).
 *
 * The main process owns the single native open-dialog (filtered to
 * .json/.csv/.ods/.xls/.xlsx) and, based on the extension of whichever file
 * the user picked, internally dispatches to the EXISTING pipelines:
 *   - .json                  → importDataset()'s full-replace pipeline
 *   - .csv/.ods/.xls/.xlsx   → previewCsvImport()'s normalize/validate/preview pipeline
 *
 * A file path picked by the user never crosses back into the renderer, and no
 * renderer-supplied path is ever accepted by main — the dialog and the file
 * read both happen inside this one main-process handler, mirroring the
 * existing importDataset()/previewCsvImport() dialog-ownership pattern.
 *
 * This schema validates the discriminant/dispatch envelope only. The nested
 * `result` (ImportContactsResult) and `preview` (CsvImportPreviewWithConflicts)
 * payloads are the pre-existing hand-authored shapes produced by those two
 * pipelines (src/shared/types/contact.ts) — they are not restructured or
 * re-validated here, consistent with how those return shapes are already
 * handled by the existing importDataset/previewCsvImport channels (no Zod
 * schema wraps them today either).
 */
export const pickAndImportKindSchema = z.enum([
  "json-import",
  "csv-preview",
  "unsupported-extension",
  "cancelled"
]);

export const pickAndImportDatasetResponseSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("json-import"), result: z.unknown() }),
  z.object({ kind: z.literal("csv-preview"), preview: z.unknown() }),
  z.object({ kind: z.literal("unsupported-extension"), extension: z.string() }),
  z.object({ kind: z.literal("cancelled") })
]);

export type PickAndImportKind = z.infer<typeof pickAndImportKindSchema>;
