import { z } from "zod";

export const mergeContactsSchema = z.object({
  keepId: z.string().min(1),
  discardId: z.string().min(1),
});

export type MergeContactsRequest = z.infer<typeof mergeContactsSchema>;
