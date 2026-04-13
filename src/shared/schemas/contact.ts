import { z } from "zod";
import { AREAS, RECORD_TYPES } from "../constants/catalogs.js";

export const phoneContactSchema = z.object({
  id: z.string(),
  label: z.string().optional(),
  number: z.string(),
  extension: z.string().optional(),
  kind: z.string(),
  isPrimary: z.boolean(),
  confidential: z.boolean(),
  noPatientSharing: z.boolean(),
  notes: z.string().optional()
});

export const emailContactSchema = z.object({
  id: z.string(),
  address: z.string(),
  label: z.string().optional(),
  isPrimary: z.boolean()
});

export const contactRecordSchema = z.object({
  id: z.string(),
  externalId: z.string().optional(),
  type: z.enum(RECORD_TYPES),
  displayName: z.string().min(1),
  person: z.object({
    firstName: z.string().optional(),
    lastName: z.string().optional()
  }).optional(),
  organization: z.object({
    department: z.string().optional(),
    service: z.string().optional(),
    area: z.enum(AREAS).optional(),
    specialty: z.string().optional()
  }),
  location: z.object({
    building: z.string().optional(),
    floor: z.string().optional(),
    room: z.string().optional(),
    text: z.string().optional()
  }).optional(),
  contactMethods: z.object({
    phones: z.array(phoneContactSchema),
    emails: z.array(emailContactSchema)
  }),
  aliases: z.array(z.string()),
  tags: z.array(z.string()),
  notes: z.string().optional(),
  status: z.enum(["active", "inactive"]),
  source: z.object({
    externalId: z.string().optional(),
    sheetSlug: z.string().optional(),
    sheetRow: z.string().optional()
  }).optional(),
  audit: z.object({
    createdAt: z.string(),
    updatedAt: z.string(),
    createdBy: z.string(),
    updatedBy: z.string()
  })
});

export const directoryDatasetSchema = z.object({
  version: z.string(),
  exportedAt: z.string(),
  metadata: z.object({
    recordCount: z.number(),
    generatedFrom: z.string(),
    generatedBy: z.string(),
    editorName: z.string(),
    typeCounts: z.record(z.number()),
    areaCounts: z.record(z.number())
  }),
  catalogs: z.object({
    recordTypes: z.array(z.enum(RECORD_TYPES)),
    areas: z.array(z.enum(AREAS))
  }),
  records: z.array(contactRecordSchema)
});

export const appSettingsSchema = z.object({
  editorName: z.string(),
  dataFilePath: z.string(),
  backupDirectoryPath: z.string(),
  ui: z.object({
    showInactiveByDefault: z.boolean()
  })
});
