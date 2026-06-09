import { z } from "zod";

export const mergeContactsSchema = z.object({
  keepId: z.string().min(1),
  discardId: z.string().min(1),
}).refine((d) => d.keepId !== d.discardId, {
  message: "keepId and discardId must be different",
  path: ["discardId"]
});

export type MergeContactsRequest = z.infer<typeof mergeContactsSchema>;
