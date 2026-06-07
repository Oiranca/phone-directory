import type { z } from "zod";
import type { buscaRecordSchema, editableBuscaRecordSchema, buscaDatasetSchema } from "../schemas/busca.js";

export type BuscaRecord = z.infer<typeof buscaRecordSchema>;
export type EditableBuscaRecord = z.infer<typeof editableBuscaRecordSchema>;
export type BuscaDataset = z.infer<typeof buscaDatasetSchema>;
