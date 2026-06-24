import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import {
  auditLogEntrySchema,
  appSettingsSchema,
  contactRecordSchema,
  directoryDatasetSchema,
  phoneContactSchema,
  emailContactSchema,
} from "./contact";
import type {
  AuditAction,
  AuditLogEntry,
  AuditLogQueryParams,
  AppSettings,
  AutoBackupSettings,
  AutoBackupTrigger,
  ContactRecord,
  DirectoryDataset,
  EditableAppSettings,
  EmailContact,
  PhoneContact,
} from "./contact";
import { defaultContacts } from "../fixtures/defaultContacts";

describe("directoryDatasetSchema", () => {
  it("parses the default dataset fixture", () => {
    const result = directoryDatasetSchema.parse(defaultContacts);
    expect(result.records).toHaveLength(2);
    expect(result.records[0]?.displayName).toBe("Admisión General");
  });

  it("rejects invalid timestamp fields", () => {
    const invalidDataset = structuredClone(defaultContacts);
    invalidDataset.exportedAt = "not-a-date";

    expect(() => directoryDatasetSchema.parse(invalidDataset)).toThrow();
  });

  it("rejects records with invalid audit timestamps", () => {
    const invalidDataset = structuredClone(defaultContacts);
    invalidDataset.records[0]!.audit.createdAt = "not-a-date";

    expect(() => directoryDatasetSchema.parse(invalidDataset)).toThrow();
  });

  it("rejects dataset with invalid typeCounts key", () => {
    const invalidDataset = structuredClone(defaultContacts) as unknown as {
      metadata: { typeCounts: Record<string, number> };
    };
    invalidDataset.metadata.typeCounts = { "invalid-type": 1 };

    expect(() => directoryDatasetSchema.parse(invalidDataset)).toThrow(ZodError);
  });

  it("rejects dataset with invalid areaCounts key", () => {
    const invalidDataset = structuredClone(defaultContacts) as unknown as {
      metadata: { areaCounts: Record<string, number> };
    };
    invalidDataset.metadata.areaCounts = { "invalid-area": 1 };

    expect(() => directoryDatasetSchema.parse(invalidDataset)).toThrow(ZodError);
  });
});

// ---------------------------------------------------------------------------
// OIR-118: Serialization parity — derived types must round-trip identically
// through their Zod schema (parse → JSON.stringify → JSON.parse → parse).
// ---------------------------------------------------------------------------

describe("OIR-118 serialization parity — derived types round-trip identically", () => {
  const phoneFixture = defaultContacts.records[0]!.contactMethods.phones[0]!;
  const recordFixture = defaultContacts.records[0]!;

  it("PhoneContact round-trips through phoneContactSchema", () => {
    const parsed: PhoneContact = phoneContactSchema.parse(phoneFixture);
    const serialized = JSON.parse(JSON.stringify(parsed)) as PhoneContact;
    const reparsed: PhoneContact = phoneContactSchema.parse(serialized);
    expect(reparsed).toEqual(parsed);
  });

  it("EmailContact shape matches emailContactSchema output", () => {
    const emailFixture = { id: "em_001", address: "test@example.com", isPrimary: true };
    const parsed: EmailContact = emailContactSchema.parse(emailFixture);
    expect(parsed).toMatchObject(emailFixture);
  });

  it("ContactRecord round-trips through contactRecordSchema", () => {
    const parsed: ContactRecord = contactRecordSchema.parse(recordFixture);
    const serialized = JSON.parse(JSON.stringify(parsed)) as ContactRecord;
    const reparsed: ContactRecord = contactRecordSchema.parse(serialized);
    expect(reparsed).toEqual(parsed);
  });

  it("DirectoryDataset round-trips through directoryDatasetSchema", () => {
    const parsed: DirectoryDataset = directoryDatasetSchema.parse(defaultContacts);
    const serialized = JSON.parse(JSON.stringify(parsed)) as DirectoryDataset;
    const reparsed: DirectoryDataset = directoryDatasetSchema.parse(serialized);
    expect(reparsed).toEqual(parsed);
  });

  it("AppSettings round-trips through appSettingsSchema", () => {
    const fixture: AppSettings = {
      editorName: "Test Editor",
      dataFilePath: "/data/contacts.json",
      backupDirectoryPath: "/data/backups",
      ui: {
        showInactiveByDefault: false,
        autoBackup: {
          enabled: true,
          trigger: "launch" as AutoBackupTrigger,
          intervalHours: 2,
          editCountThreshold: 10,
          retentionCount: 5,
        } satisfies AutoBackupSettings,
      },
    };
    const parsed: AppSettings = appSettingsSchema.parse(fixture);
    const serialized = JSON.parse(JSON.stringify(parsed)) as AppSettings;
    const reparsed: AppSettings = appSettingsSchema.parse(serialized);
    expect(reparsed).toEqual(parsed);
  });

  it("EditableAppSettings is structurally identical to AppSettings (no managedPaths)", () => {
    const fixture: EditableAppSettings = {
      editorName: "Test",
      dataFilePath: "/data/contacts.json",
      backupDirectoryPath: "/data/backups",
      ui: {
        showInactiveByDefault: true,
        autoBackup: {
          enabled: false,
          trigger: "editCount" as AutoBackupTrigger,
          intervalHours: 4,
          editCountThreshold: 20,
          retentionCount: 3,
        },
      },
    };
    // Must parse through appSettingsSchema (EditableAppSettings is a Pick of AppSettings)
    const parsed: AppSettings = appSettingsSchema.parse(fixture);
    expect(parsed.editorName).toBe("Test");
    expect(parsed.ui.autoBackup.trigger).toBe("editCount");
  });

  it("AuditLogEntry round-trips through auditLogEntrySchema", () => {
    const fixture: AuditLogEntry = {
      timestamp: "2026-04-13T00:00:00Z",
      editor: "System",
      action: "create" as AuditAction,
      recordId: "cnt_0001",
      recordName: "Admisión General",
      changes: null,
      reason: null,
    };
    const parsed: AuditLogEntry = auditLogEntrySchema.parse(fixture);
    const serialized = JSON.parse(JSON.stringify(parsed)) as AuditLogEntry;
    const reparsed: AuditLogEntry = auditLogEntrySchema.parse(serialized);
    expect(reparsed).toEqual(parsed);
  });

  it("AuditLogQueryParams type is structurally all-optional", () => {
    // Compile-time proof: an empty object is assignable to AuditLogQueryParams
    const params: AuditLogQueryParams = {};
    expect(params).toBeDefined();
  });
});
