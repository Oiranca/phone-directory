import { z } from "zod";
import { AREAS, RECORD_TYPES } from "../constants/catalogs.js";

const isoDateTimeString = z.string().datetime({ offset: true });
const autoBackupDefaults = {
  enabled: false,
  trigger: "launch" as const,
  intervalHours: 2,
  editCountThreshold: 10,
  retentionCount: 5
};

export const phoneContactSchema = z.object({
  id: z.string(),
  label: z.string().optional(),
  number: z.string(),
  extension: z.string().optional(),
  kind: z.string(),
  isPrimary: z.boolean(),
  // Advisory presentation marker only — not an enforced access control; records and flagged values
  // remain fully searchable. See audit plan §4 P1-03 resolution (OIR-105).
  // NOTE: getPreferredResultPhone() in search.service.ts intentionally deprioritizes confidential
  // phones when selecting the default displayed number — this is UI convenience, not a security gate.
  confidential: z.boolean(),
  // Advisory presentation marker only — not an enforced access control; records and flagged values
  // remain fully searchable. See audit plan §4 P1-03 resolution (OIR-105).
  // NOTE: getPreferredResultPhone() in search.service.ts intentionally deprioritizes noPatientSharing
  // phones when selecting the default displayed number — this is UI convenience, not a security gate.
  noPatientSharing: z.boolean(),
  notes: z.string().optional()
});

export const emailContactSchema = z.object({
  id: z.string(),
  address: z.string(),
  label: z.string().optional(),
  isPrimary: z.boolean()
});

/**
 * Platform enum for social-media contacts (OIR-131).
 * Naming mirrors the existing kind/type enum convention: lowercase slug.
 */
export const socialPlatformSchema = z.enum([
  "instagram",
  "twitter",
  "facebook",
  "linkedin",
  "youtube",
  "tiktok",
  "web",
  "other"
]);

/**
 * Persisted social-media contact entry (OIR-131).
 * At least one of `handle` or `url` is required (enforced by .refine).
 * BACKWARD COMPAT: contactMethods.socials uses .default([]) so old records parse fine.
 */
/**
 * Validates that `url`, when present, uses only http: or https: scheme.
 * Rejects javascript:, data:, vbscript:, file:, and any other scheme.
 */
const isSafeHttpUrl = (url: string | undefined): boolean => {
  if (url === undefined || url.trim() === "") return true;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
};

export const socialContactSchema = z.object({
  id: z.string(),
  platform: socialPlatformSchema,
  handle: z.string().optional(),
  url: z.string().optional(),
  label: z.string().optional(),
  isPrimary: z.boolean()
}).refine(
  (entry) => Boolean(entry.handle ?? entry.url),
  { message: "Cada entrada de red social necesita al menos un handle o una URL." }
).refine(
  (entry) => isSafeHttpUrl(entry.url),
  { message: "La URL de la red social debe usar http o https.", path: ["url"] }
);

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
    emails: z.array(emailContactSchema),
    // BACKWARD COMPAT (OIR-131): existing persisted records have no `socials` field.
    // .default([]) ensures old datasets (contacts.json without this key) parse without errors.
    socials: z.array(socialContactSchema).default([])
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
    createdAt: isoDateTimeString,
    updatedAt: isoDateTimeString,
    createdBy: z.string(),
    updatedBy: z.string()
  })
});

export const directoryDatasetSchema = z.object({
  version: z.string(),
  exportedAt: isoDateTimeString,
  metadata: z.object({
    recordCount: z.number(),
    generatedFrom: z.string(),
    generatedBy: z.string(),
    editorName: z.string(),
    typeCounts: z.record(z.enum(RECORD_TYPES), z.number()),
    areaCounts: z.record(z.enum(AREAS), z.number())
  }),
  catalogs: z.object({
    recordTypes: z.array(z.enum(RECORD_TYPES)),
    areas: z.array(z.enum(AREAS))
  }),
  records: z.array(contactRecordSchema)
});

export const appSettingsSchema = z.object({
  editorName: z.string(),
  dataFilePath: z.string().trim().min(1, "La ruta del archivo de datos es obligatoria."),
  backupDirectoryPath: z.string().trim().min(1, "La ruta de la carpeta de backups es obligatoria."),
  managedPaths: z.object({
    dataFilePath: z.boolean(),
    backupDirectoryPath: z.boolean()
  }).optional(),
  ui: z.object({
    showInactiveByDefault: z.boolean(),
    autoBackup: z.object({
      enabled: z.boolean(),
      trigger: z.enum(["launch", "intervalHours", "editCount"]),
      intervalHours: z.number().int().min(1).max(168),
      editCountThreshold: z.number().int().min(1).max(1000),
      retentionCount: z.number().int().min(1).max(100)
    }).default(autoBackupDefaults)
  })
});

export const editableAppSettingsSchema = appSettingsSchema.pick({
  editorName: true,
  dataFilePath: true,
  backupDirectoryPath: true,
  ui: true
});

const optionalTextField = () =>
  z.string().trim().optional().transform((value) => value || undefined);

export const editablePhoneContactSchema = z.object({
  id: z.string().min(1),
  label: optionalTextField(),
  number: z.string().trim().min(1, "El teléfono es obligatorio."),
  extension: optionalTextField(),
  kind: z.string().trim().min(1, "El tipo de teléfono es obligatorio."),
  isPrimary: z.boolean(),
  // Advisory presentation marker only — not an enforced access control. See audit plan §4 P1-03 resolution (OIR-105).
  confidential: z.boolean(),
  // Advisory presentation marker only — not an enforced access control. See audit plan §4 P1-03 resolution (OIR-105).
  noPatientSharing: z.boolean(),
  notes: optionalTextField()
});

export const editableEmailContactSchema = z.object({
  id: z.string().min(1),
  address: z.string().trim().email("Introduce un correo electrónico válido."),
  label: optionalTextField(),
  isPrimary: z.boolean()
});

/**
 * Editable social-media contact entry (OIR-131).
 * Mirrors the EditablePhoneContact pattern: trim transforms applied,
 * at-least-one-of handle/url validated.
 */
export const editableSocialContactSchema = z.object({
  id: z.string().min(1),
  platform: socialPlatformSchema,
  handle: optionalTextField(),
  url: optionalTextField(),
  label: optionalTextField(),
  isPrimary: z.boolean()
}).refine(
  (entry) => Boolean(entry.handle ?? entry.url),
  { message: "Introduce un handle o una URL para la red social." }
).refine(
  (entry) => isSafeHttpUrl(entry.url),
  { message: "La URL de la red social debe usar http o https.", path: ["url"] }
);

export const auditActionSchema = z.enum(["create", "update", "delete", "bulk-import", "dataset-replace", "restore-from-backup", "reset"]);

export const auditLogEntrySchema = z.object({
  timestamp: isoDateTimeString,
  editor: z.string(),
  action: auditActionSchema,
  recordId: z.string().optional(),
  recordName: z.string().optional(),
  changes: z.record(z.object({ old: z.any(), new: z.any() })).nullable().optional(),
  reason: z.string().nullable().optional(),
  recordsAffected: z.number().optional(),
  importSource: z.string().optional()
});

export const auditLogSchema = z.array(auditLogEntrySchema);

export const auditLogQueryParamsSchema = z.object({
  fromDate: z.string().optional(),
  toDate: z.string().optional(),
  editor: z.string().optional(),
  action: auditActionSchema.optional(),
  recordName: z.string().optional()
});

export const editableContactRecordSchema = z.object({
  id: z.string().optional(),
  externalId: optionalTextField(),
  type: z.enum(RECORD_TYPES, {
    errorMap: () => ({ message: "Selecciona un tipo de registro válido." })
  }),
  displayName: z.string().trim().min(1, "El nombre visible es obligatorio."),
  person: z.object({
    firstName: optionalTextField(),
    lastName: optionalTextField()
  }).optional(),
  organization: z.object({
    department: optionalTextField(),
    service: optionalTextField(),
    area: z.enum(AREAS).optional(),
    specialty: optionalTextField()
  }),
  location: z.object({
    building: optionalTextField(),
    floor: optionalTextField(),
    room: optionalTextField(),
    text: optionalTextField()
  }).optional(),
  contactMethods: z.object({
    phones: z.array(editablePhoneContactSchema),
    emails: z.array(editableEmailContactSchema),
    socials: z.array(editableSocialContactSchema).default([])
  }),
  aliases: z.array(z.string().trim().min(1)).default([]),
  tags: z.array(z.string().trim().min(1)).default([]),
  notes: optionalTextField(),
  status: z.enum(["active", "inactive"], {
    errorMap: () => ({ message: "Selecciona un estado válido." })
  })
});

// ---------------------------------------------------------------------------
// Derived types — stable persisted/IPC domain types derived from Zod schemas.
// These are the single source of truth for serialization shape.
// UX-only types (form state, view models) remain in types/contact.ts.
// ---------------------------------------------------------------------------

/** Persisted phone entry — derived from the persistence schema. */
export type PhoneContact = z.infer<typeof phoneContactSchema>;

/** Persisted email entry — derived from the persistence schema. */
export type EmailContact = z.infer<typeof emailContactSchema>;

/** Social-media platform enum — derived from the persistence schema (OIR-131). */
export type SocialPlatform = z.infer<typeof socialPlatformSchema>;

/** Persisted social-media contact entry — derived from the persistence schema (OIR-131). */
export type SocialContact = z.infer<typeof socialContactSchema>;

/** Persisted contact record — derived from the persistence schema. */
export type ContactRecord = z.infer<typeof contactRecordSchema>;

/** Persisted directory dataset — derived from the persistence schema. */
export type DirectoryDataset = z.infer<typeof directoryDatasetSchema>;

/**
 * Auto-backup trigger union — derived from the persistence schema.
 * Named alias for use in AppSettings sub-type exports.
 */
export type AutoBackupTrigger = z.infer<typeof appSettingsSchema>["ui"]["autoBackup"]["trigger"];

/**
 * Auto-backup settings block — derived from the persistence schema.
 * Named alias for use in AppSettings sub-type exports.
 */
export type AutoBackupSettings = z.infer<typeof appSettingsSchema>["ui"]["autoBackup"];

/** Full persisted application settings — derived from the persistence schema. */
export type AppSettings = z.infer<typeof appSettingsSchema>;

/** Editable slice of app settings sent over IPC — derived from the persistence schema. */
export type EditableAppSettings = z.infer<typeof editableAppSettingsSchema>;

/** Audit action union — derived from the audit schema. */
export type AuditAction = z.infer<typeof auditActionSchema>;

/** Persisted audit log entry — derived from the audit schema. */
export type AuditLogEntry = z.infer<typeof auditLogEntrySchema>;

/** Audit log query parameters — derived from the audit schema. */
export type AuditLogQueryParams = z.infer<typeof auditLogQueryParamsSchema>;
