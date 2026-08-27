import { z } from "zod";
import { beepersDatasetSchema } from "./beeper.schema.js";
import { directoryDatasetSchema } from "./contact.js";

export const COMBINED_DATA_FORMAT = "hospiagenda-data" as const;
export const COMBINED_DATA_VERSION = "1.0.0" as const;

export const combinedDataEnvelopeSchema = z.object({
  format: z.literal(COMBINED_DATA_FORMAT),
  version: z.literal(COMBINED_DATA_VERSION),
  exportedAt: z.string().datetime({ offset: true }),
  contacts: directoryDatasetSchema,
  beepers: beepersDatasetSchema
}).strict();

export type CombinedDataEnvelope = z.infer<typeof combinedDataEnvelopeSchema>;
