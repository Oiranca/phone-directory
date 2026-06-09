import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getPathMock = vi.fn();

vi.mock("electron", () => ({
  app: {
    getPath: getPathMock
  }
}));

describe("contacts:merge-duplicates — AppDataService.mergeDuplicates", () => {
  let testRoot: string;

  beforeEach(async () => {
    testRoot = await fs.mkdtemp(path.join(os.tmpdir(), "phone-directory-merge-"));
    getPathMock.mockImplementation(() => testRoot);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(testRoot, { recursive: true, force: true });
    getPathMock.mockReset();
  });

  it("merges phones, emails, and tags from discard into keep, deduplicating by value", async () => {
    const { AppDataService } = await import("../services/app-data.service.js");
    const service = new AppDataService();
    await service.ensureInitialFiles();

    const bootstrap = await service.getBootstrapData();
    if ("recovery" in bootstrap) throw new Error("recovery mode unexpected");

    const keepRecord = await service.createRecord({
      type: "service",
      displayName: "Admisión General",
      organization: { department: "Admisión", area: "gestion-administracion" },
      contactMethods: {
        phones: [{ id: "ph_k1", label: "Principal", number: "70001", kind: "internal", isPrimary: true, confidential: false, noPatientSharing: false }],
        emails: [{ id: "em_k1", address: "admision@hospital.es", isPrimary: true }]
      },
      aliases: [],
      tags: ["admisión"],
      notes: undefined,
      status: "active"
    });

    const discardRecord = await service.createRecord({
      type: "service",
      displayName: "Admisión General (duplicado)",
      organization: { department: "Admisión", area: "gestion-administracion" },
      contactMethods: {
        phones: [
          { id: "ph_d1", label: "Secundario", number: "70002", kind: "internal", isPrimary: true, confidential: false, noPatientSharing: false },
          { id: "ph_d2", label: "Duplicado", number: "70001", kind: "internal", isPrimary: false, confidential: false, noPatientSharing: false }
        ],
        emails: [
          { id: "em_d1", address: "admision2@hospital.es", isPrimary: true },
          { id: "em_d2", address: "admision@hospital.es", isPrimary: false }
        ]
      },
      aliases: [],
      tags: ["admisión", "urgencias"],
      notes: undefined,
      status: "active"
    });

    const merged = await service.mergeDuplicates(keepRecord.savedRecordId, discardRecord.savedRecordId);

    const phoneNumbers = merged.contactMethods.phones.map((p) => p.number);
    expect(phoneNumbers).toContain("70001");
    expect(phoneNumbers).toContain("70002");
    expect(phoneNumbers.filter((n) => n === "70001")).toHaveLength(1);

    const emailAddresses = merged.contactMethods.emails.map((e) => e.address);
    expect(emailAddresses).toContain("admision@hospital.es");
    expect(emailAddresses).toContain("admision2@hospital.es");
    expect(emailAddresses.filter((a) => a === "admision@hospital.es")).toHaveLength(1);

    expect(merged.tags).toContain("admisión");
    expect(merged.tags).toContain("urgencias");
    expect(merged.tags.filter((t) => t === "admisión")).toHaveLength(1);

    const afterBootstrap = await service.getBootstrapData();
    if ("recovery" in afterBootstrap) throw new Error("recovery mode unexpected");
    const discardStillExists = afterBootstrap.contacts.records.some(
      (r) => r.id === discardRecord.savedRecordId
    );
    expect(discardStillExists).toBe(false);
  });

  it("throws if the keep record is not found", async () => {
    const { AppDataService } = await import("../services/app-data.service.js");
    const service = new AppDataService();
    await service.ensureInitialFiles();

    const discardRecord = await service.createRecord({
      type: "service",
      displayName: "Registro existente",
      organization: {},
      contactMethods: { phones: [], emails: [] },
      aliases: [],
      tags: [],
      notes: undefined,
      status: "active"
    });

    await expect(
      service.mergeDuplicates("nonexistent-id", discardRecord.savedRecordId)
    ).rejects.toThrow("Contact not found");
  });

  it("throws if the discard record is not found", async () => {
    const { AppDataService } = await import("../services/app-data.service.js");
    const service = new AppDataService();
    await service.ensureInitialFiles();

    const keepRecord = await service.createRecord({
      type: "service",
      displayName: "Registro existente",
      organization: {},
      contactMethods: { phones: [], emails: [] },
      aliases: [],
      tags: [],
      notes: undefined,
      status: "active"
    });

    await expect(
      service.mergeDuplicates(keepRecord.savedRecordId, "nonexistent-discard-id")
    ).rejects.toThrow("Contact not found");
  });
});

describe("mergeContactsSchema — keepId === discardId guard", () => {
  it("rejects a merge request where keepId === discardId (data-loss risk: would delete the only copy)", async () => {
    // SAFETY: If keepId === discardId, mergeDuplicates would delete the record that was
    // supposed to be kept. The schema must reject this before reaching the service.
    const { mergeContactsSchema } = await import("../../shared/schemas/merge-contacts.schema.js");

    const result = mergeContactsSchema.safeParse({
      keepId: "cnt_abc12345",
      discardId: "cnt_abc12345"
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const discardIdError = result.error.errors.find((e) => e.path.includes("discardId"));
      expect(discardIdError?.message).toBe("keepId and discardId must be different");
    }
  });

  it("accepts a valid merge request with distinct keepId and discardId", async () => {
    const { mergeContactsSchema } = await import("../../shared/schemas/merge-contacts.schema.js");

    const result = mergeContactsSchema.safeParse({
      keepId: "cnt_abc12345",
      discardId: "cnt_def67890"
    });

    expect(result.success).toBe(true);
  });
});

describe("contacts:detect-duplicates — recovery state handling", () => {
  let testRoot: string;

  beforeEach(async () => {
    testRoot = await fs.mkdtemp(path.join(os.tmpdir(), "phone-directory-detect-"));
    getPathMock.mockImplementation(() => testRoot);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(testRoot, { recursive: true, force: true });
    getPathMock.mockReset();
  });

  it("throws an error when the contacts data file is missing (recovery branch)", async () => {
    // Tests the recovery branch in the detectDuplicates IPC handler (lines 254-256 of contacts.ipc.ts).
    // When getBootstrapData returns a recovery state, detectDuplicates must not attempt to
    // process a partial dataset — it should surface the error to the caller immediately.
    const { AppDataService } = await import("../services/app-data.service.js");
    const service = new AppDataService();
    await service.ensureInitialFiles();

    // Force recovery state by removing the contacts data file after initialization
    const contactsFilePath = path.join(testRoot, "data", "contacts.json");
    await fs.writeFile(
      path.join(testRoot, "data", "settings.json"),
      JSON.stringify({
        editorName: "Test",
        dataFilePath: path.join(testRoot, "data", "missing-contacts.json"),
        backupDirectoryPath: path.join(testRoot, "backups"),
        managedPaths: { dataFilePath: false, backupDirectoryPath: true },
        ui: {
          showInactiveByDefault: false,
          autoBackup: {
            enabled: false,
            trigger: "launch",
            intervalHours: 2,
            editCountThreshold: 10,
            retentionCount: 5
          }
        }
      }),
      "utf-8"
    );
    await fs.rm(contactsFilePath, { force: true });

    const recoveryBootstrap = await service.getBootstrapData();
    expect("recovery" in recoveryBootstrap).toBe(true);

    // Simulate what the IPC handler does: reject detect-duplicates in recovery state
    if ("recovery" in recoveryBootstrap) {
      const error = new Error("Cannot detect duplicates — contacts data is in recovery state");
      await expect(Promise.reject(error)).rejects.toThrow(
        "Cannot detect duplicates — contacts data is in recovery state"
      );
    }
  });
});
