import { z } from "zod";
import { AREAS, RECORD_TYPES } from "../constants/catalogs.js";
import {
  editableEmailContactSchema,
  editablePhoneContactSchema,
  editableSocialContactSchema
} from "./contact.js";

/**
 * Optional field-level overrides applied on top of the surviving
 * ("keep") record after the normal keep/discard merge logic runs, so a user
 * editing the surviving record's fields before confirming a merge (e.g.
 * picking the correct displayName/type/phone from either side) wins over
 * whatever the automatic keep/discard union produced.
 *
 * Every top-level key is optional — a request with no `overrides` (or an
 * empty object) behaves exactly like the pre-existing keep/discard-only
 * merge. `id`, `status`, `source`, and `audit` are intentionally NOT
 * overridable here: those fields are derived/managed by the service, not
 * user-editable via this endpoint.
 *
 * `.strict()` rejects unknown keys outright (defense in depth — a malformed
 * or malicious payload attempting to smuggle `id`/`audit`/etc. is rejected
 * at the schema boundary rather than silently ignored).
 *
 * Reuses the same field-level schemas as `editableContactRecordSchema`
 * (phones/emails/socials) rather than inventing ad-hoc validation.
 */
export const mergeContactsOverridesSchema = z.object({
  displayName: z.string().trim().min(1).optional(),
  type: z.enum(RECORD_TYPES).optional(),
  externalId: z.string().trim().optional(),
  person: z.object({
    firstName: z.string().trim().optional(),
    lastName: z.string().trim().optional()
  }).optional(),
  organization: z.object({
    department: z.string().trim().optional(),
    service: z.string().trim().optional(),
    area: z.enum(AREAS).optional(),
    specialty: z.string().trim().optional()
  }).optional(),
  location: z.object({
    building: z.string().trim().optional(),
    floor: z.string().trim().optional(),
    room: z.string().trim().optional(),
    text: z.string().trim().optional()
  }).optional(),
  contactMethods: z.object({
    phones: z.array(editablePhoneContactSchema).optional(),
    emails: z.array(editableEmailContactSchema).optional(),
    socials: z.array(editableSocialContactSchema).optional()
  }).optional(),
  aliases: z.array(z.string().trim().min(1)).optional(),
  tags: z.array(z.string().trim().min(1)).optional(),
  notes: z.string().trim().optional()
}).strict();

export const mergeContactsSchema = z.object({
  keepId: z.string().min(1),
  discardId: z.string().min(1),
  overrides: mergeContactsOverridesSchema.optional()
}).refine((d) => d.keepId !== d.discardId, {
  message: "keepId and discardId must be different",
  path: ["discardId"]
});

export type MergeContactsOverrides = z.infer<typeof mergeContactsOverridesSchema>;
