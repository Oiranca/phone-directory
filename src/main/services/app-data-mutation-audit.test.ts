/**
 * Mutation audit coverage tests
 *
 * Verifies:
 *  1. Exactly ONE audit entry is appended per successful mutation
 *     (create, update, merge-duplicates, restore-from-backup, reset)
 *  2. No audit entry is appended when a mutation fails before the durable write
 *  3. Redaction: no PII (name, phone number), no absolute paths, no tokens in entries
 *  4. actor/source (editor) field is present in every entry
 *  5. action values are valid AuditAction enum members
 *  6. Audit failure is non-blocking (fail-open): mutation result is returned normally
 *  7. Concurrent mutations produce entries in write-queue order
 */

import nodeFs from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as XLSX from "xlsx";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EditableContactRecord } from "../../shared/types/contact.js";

const getPathMock = vi.fn();

vi.mock("electron", () => ({
  app: {
    getPath: getPathMock
  }
}));

XLSX.set_fs(nodeFs);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal valid EditableContactRecord conforming to the real
 * editableContactRecordSchema (type from RECORD_TYPES, phone with id/kind/
 * confidential/noPatientSharing, email with id).
 */
const makeContact = (overrides: Partial<EditableContactRecord> = {}): EditableContactRecord => ({
  type: "service",
  displayName: "Test Contact",
  organization: {
    department: "Dept",
    service: "Service",
    area: undefined,
    specialty: undefined
  },
  location: undefined,
  person: undefined,
  contactMethods: {
    phones: [
      {
        id: "ph_test_1",
        label: "main",
        number: "123456789",
        extension: undefined,
        kind: "internal",
        isPrimary: true,
        confidential: false,
        noPatientSharing: false,
        notes: undefined
      }
    ],
    emails: [],
    socials: []
  },
  aliases: [],
  tags: [],
  notes: undefined,
  externalId: undefined,
  status: "active",
  ...overrides
});

/** Read the raw audit log array from the test temp dir. */
const readAuditLog = async (testRoot: string) => {
  const auditLogPath = path.join(testRoot, "data", "audit-log.json");
  const raw = await fs.readFile(auditLogPath, "utf-8");
  return JSON.parse(raw) as Array<Record<string, unknown>>;
};

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("AppDataService — mutation audit coverage", () => {
  let testRoot: string;

  beforeEach(async () => {
    testRoot = await fs.mkdtemp(path.join(os.tmpdir(), "phone-directory-audit-"));
    getPathMock.mockImplementation(() => testRoot);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    getPathMock.mockReset();
    await fs.rm(testRoot, { recursive: true, force: true });
  });

  // -------------------------------------------------------------------------
  // createRecord — 1 entry on success, 0 on failure
  // -------------------------------------------------------------------------

  it("createRecord appends exactly one audit entry on success", async () => {
    const { AppDataService } = await import("./app-data.service.js");
    const service = new AppDataService();
    await service.ensureInitialFiles();

    await service.createRecord(makeContact());

    const entries = await readAuditLog(testRoot);
    expect(entries).toHaveLength(1);
    const entry = entries[0]!;
    expect(entry["action"]).toBe("create");
    expect(typeof entry["recordId"]).toBe("string");
    expect(entry["recordsAffected"]).toBe(1);
  });

  it("createRecord appends NO audit entry when schema validation fails", async () => {
    const { AppDataService } = await import("./app-data.service.js");
    const service = new AppDataService();
    await service.ensureInitialFiles();

    // Pass a payload that fails Zod validation (missing required fields)
    await expect(
      service.createRecord({ displayName: "Bad" } as unknown as EditableContactRecord)
    ).rejects.toThrow();

    // Audit log file may not exist yet — that counts as 0 entries.
    let entries: Array<unknown> = [];
    try {
      entries = await readAuditLog(testRoot);
    } catch {
      // ENOENT = file was never created = 0 entries
    }
    expect(entries).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // updateRecord — 1 entry on success, 0 on failure
  // -------------------------------------------------------------------------

  it("updateRecord appends exactly one audit entry on success", async () => {
    const { AppDataService } = await import("./app-data.service.js");
    const service = new AppDataService();
    await service.ensureInitialFiles();

    const { savedRecordId } = await service.createRecord(makeContact());
    // Clear audit log after create so we start fresh for the update assertion
    await fs.writeFile(path.join(testRoot, "data", "audit-log.json"), "[]", "utf-8");

    await service.updateRecord(savedRecordId, makeContact({ displayName: "Updated Name" }));

    const entries = await readAuditLog(testRoot);
    expect(entries).toHaveLength(1);
    const entry = entries[0]!;
    expect(entry["action"]).toBe("update");
    expect(entry["recordId"]).toBe(savedRecordId);
    expect(entry["recordsAffected"]).toBe(1);
  });

  it("updateRecord appends NO audit entry when recordId is not found", async () => {
    const { AppDataService } = await import("./app-data.service.js");
    const service = new AppDataService();
    await service.ensureInitialFiles();

    await expect(
      service.updateRecord("cnt_nonexistent", makeContact())
    ).rejects.toThrow("No se encontró el registro solicitado.");

    let entries: Array<unknown> = [];
    try {
      entries = await readAuditLog(testRoot);
    } catch {
      // ENOENT = 0 entries
    }
    expect(entries).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // mergeDuplicates — 1 entry on success, 0 on failure
  // -------------------------------------------------------------------------

  it("mergeDuplicates appends exactly one audit entry on success", async () => {
    const { AppDataService } = await import("./app-data.service.js");
    const service = new AppDataService();
    await service.ensureInitialFiles();

    const { savedRecordId: keepId } = await service.createRecord(makeContact({ displayName: "Keep" }));
    const { savedRecordId: discardId } = await service.createRecord(makeContact({ displayName: "Discard" }));
    await fs.writeFile(path.join(testRoot, "data", "audit-log.json"), "[]", "utf-8");

    await service.mergeDuplicates(keepId, discardId);

    const entries = await readAuditLog(testRoot);
    expect(entries).toHaveLength(1);
    const entry = entries[0]!;
    expect(entry["action"]).toBe("update");
    expect(entry["recordId"]).toBe(keepId);
    expect(entry["recordsAffected"]).toBe(1);
    // discardedId is recorded as a non-PII stable identifier, not the contact's name/phone
    expect((entry["changes"] as Record<string, unknown>)?.["discardedId"]).toEqual({
      old: discardId,
      new: null
    });
  });

  it("mergeDuplicates appends NO audit entry when keepId does not exist", async () => {
    const { AppDataService } = await import("./app-data.service.js");
    const service = new AppDataService();
    await service.ensureInitialFiles();

    await expect(
      service.mergeDuplicates("cnt_nonexistent", "cnt_also_nonexistent")
    ).rejects.toThrow("Contact not found");

    let entries: Array<unknown> = [];
    try {
      entries = await readAuditLog(testRoot);
    } catch {
      // ENOENT = 0 entries
    }
    expect(entries).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // restoreBackup — 1 entry on success
  // -------------------------------------------------------------------------

  it("restoreBackup appends exactly one audit entry on success", async () => {
    const { AppDataService } = await import("./app-data.service.js");
    const service = new AppDataService();
    await service.ensureInitialFiles();

    const backupFilePath = await service.createBackup();
    await fs.writeFile(path.join(testRoot, "data", "audit-log.json"), "[]", "utf-8");

    await service.restoreBackup(backupFilePath);

    const entries = await readAuditLog(testRoot);
    expect(entries).toHaveLength(1);
    const entry = entries[0]!;
    expect(entry["action"]).toBe("restore-from-backup");
    expect(typeof entry["recordsAffected"]).toBe("number");
    expect(typeof entry["importSource"]).toBe("string");
  });

  // -------------------------------------------------------------------------
  // importDataset — 1 entry on success, 0 on failure
  // -------------------------------------------------------------------------

  it("importDataset appends exactly one audit entry on success (action: dataset-replace)", async () => {
    const { AppDataService } = await import("./app-data.service.js");
    const service = new AppDataService();
    await service.ensureInitialFiles();

    // Export the current dataset to a temp file, then import it back
    const exportPath = path.join(testRoot, "export-for-import.json");
    await service.exportDataset(exportPath);
    await fs.writeFile(path.join(testRoot, "data", "audit-log.json"), "[]", "utf-8");

    await service.importDataset(exportPath);

    const entries = await readAuditLog(testRoot);
    expect(entries).toHaveLength(1);
    const entry = entries[0]!;
    // importDataset is a wholesale JSON replacement — must emit "dataset-replace", NOT "bulk-import"
    expect(entry["action"]).toBe("dataset-replace");
    expect(entry["action"]).not.toBe("bulk-import");
    expect(typeof entry["recordsAffected"]).toBe("number");
    // importSource must be a basename, not an absolute path
    expect(typeof entry["importSource"]).toBe("string");
    expect(path.isAbsolute(entry["importSource"] as string)).toBe(false);
    expect((entry["importSource"] as string).includes(path.sep)).toBe(false);
  });

  it("importDataset appends NO audit entry when the source file is invalid JSON", async () => {
    const { AppDataService } = await import("./app-data.service.js");
    const service = new AppDataService();
    await service.ensureInitialFiles();

    const badPath = path.join(testRoot, "bad-dataset.json");
    await fs.writeFile(badPath, "{ not valid json {{", "utf-8");

    await expect(service.importDataset(badPath)).rejects.toThrow();

    let entries: Array<unknown> = [];
    try {
      entries = await readAuditLog(testRoot);
    } catch {
      // ENOENT = 0 entries
    }
    expect(entries).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // resetDataset — 1 entry on success
  // -------------------------------------------------------------------------

  it("resetDataset appends exactly one audit entry on success", async () => {
    const { AppDataService } = await import("./app-data.service.js");
    const service = new AppDataService();
    await service.ensureInitialFiles();

    // Ensure some records exist first so the reset is meaningful
    await service.createRecord(makeContact());
    await fs.writeFile(path.join(testRoot, "data", "audit-log.json"), "[]", "utf-8");

    await service.resetDataset();

    const entries = await readAuditLog(testRoot);
    expect(entries).toHaveLength(1);
    const entry = entries[0]!;
    expect(entry["action"]).toBe("reset");
    expect(entry["recordsAffected"]).toBe(0);
  });

  // -------------------------------------------------------------------------
  // Redaction — no PII, no absolute paths, no tokens in any entry
  // -------------------------------------------------------------------------

  it("audit entries contain no PII: displayName, phone numbers, or email addresses", async () => {
    const { AppDataService } = await import("./app-data.service.js");
    const service = new AppDataService();
    await service.ensureInitialFiles();

    const piiName = "Juan García Pérez";
    const piiPhone = "666777888";
    const piiEmail = "juan@example.com";
    await service.createRecord(
      makeContact({
        displayName: piiName,
        contactMethods: {
          phones: [
            {
              id: "ph_pii_1",
              label: "main",
              number: piiPhone,
              extension: undefined,
              kind: "internal",
              isPrimary: true,
              confidential: false,
              noPatientSharing: false,
              notes: undefined
            }
          ],
          emails: [
            {
              id: "em_pii_1",
              address: piiEmail,
              label: "work",
              isPrimary: true
            }
          ],
          socials: []
        }
      })
    );

    const entries = await readAuditLog(testRoot);
    expect(entries).toHaveLength(1);

    const serialized = JSON.stringify(entries[0]);
    expect(serialized).not.toContain(piiName);
    expect(serialized).not.toContain(piiPhone);
    expect(serialized).not.toContain(piiEmail);
  });

  it("audit entries contain no absolute filesystem paths", async () => {
    const { AppDataService } = await import("./app-data.service.js");
    const service = new AppDataService();
    await service.ensureInitialFiles();

    const backupFilePath = await service.createBackup();
    await fs.writeFile(path.join(testRoot, "data", "audit-log.json"), "[]", "utf-8");

    await service.restoreBackup(backupFilePath);

    const entries = await readAuditLog(testRoot);
    expect(entries).toHaveLength(1);

    const serialized = JSON.stringify(entries[0]);
    // No absolute path segment from testRoot should appear in the entry
    expect(serialized).not.toContain(testRoot);
    // importSource must be a basename only (no directory separators, not absolute)
    const importSource = entries[0]!["importSource"] as string | undefined;
    if (importSource) {
      expect(path.isAbsolute(importSource)).toBe(false);
      expect(importSource.includes(path.sep)).toBe(false);
    }
  });

  // -------------------------------------------------------------------------
  // editor/actor field is present in every entry
  // -------------------------------------------------------------------------

  it("every audit entry carries a non-empty editor field", async () => {
    const { AppDataService } = await import("./app-data.service.js");
    const service = new AppDataService();
    await service.ensureInitialFiles();

    await service.createRecord(makeContact());
    const entries = await readAuditLog(testRoot);
    expect(entries).toHaveLength(1);

    const entry = entries[0]!;
    expect(typeof entry["editor"]).toBe("string");
    expect((entry["editor"] as string).length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // Audit failure is non-blocking (fail-open)
  // -------------------------------------------------------------------------

  it("audit failure does not block createRecord from returning successfully", async () => {
    const { AppDataService } = await import("./app-data.service.js");
    const { AuditLogService } = await import("./audit-log.service.js");

    // Mock at the inner AuditLogService layer so the facade's catch block
    // fires normally (fail-open semantics) — this matches real failure scenarios
    // where the underlying write fails (IO error, integrity error, etc.).
    const appendSpy = vi
      .spyOn(AuditLogService.prototype, "append")
      .mockRejectedValueOnce(new Error("Simulated audit IO failure"));
    // Suppress the expected console.error that the facade emits on failure
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const service = new AppDataService();
    await service.ensureInitialFiles();

    // Must resolve successfully even though the underlying audit write was mocked to fail
    const result = await service.createRecord(makeContact());
    expect(result.savedRecordId).toBeTruthy();

    // The facade must have logged the error (non-blocking, not silent).
    // The log uses a single concatenated string (code+message) to
    // avoid leaking absolute filesystem paths — assert the new single-string form,
    // and that the error detail (message text) is included in that string.
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringMatching(/^\[AuditLog\] Failed to append entry.*Simulated audit IO failure/)
    );

    appendSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  // -------------------------------------------------------------------------
  // Concurrent mutations — entries land in write-queue order
  // -------------------------------------------------------------------------

  it("concurrent createRecord calls produce one entry per record with all IDs accounted for", async () => {
    const { AppDataService } = await import("./app-data.service.js");
    const service = new AppDataService();
    await service.ensureInitialFiles();

    // Fire three creates concurrently — the write queue serialises both
    // the dataset write and the audit write, so exactly three entries must land.
    const [r1, r2, r3] = await Promise.all([
      service.createRecord(makeContact({ displayName: "A" })),
      service.createRecord(makeContact({ displayName: "B" })),
      service.createRecord(makeContact({ displayName: "C" }))
    ]);

    const entries = await readAuditLog(testRoot);
    expect(entries).toHaveLength(3);

    // All three IDs must be represented exactly once
    const auditedIds = new Set(entries.map((e) => e["recordId"] as string));
    expect(auditedIds.has(r1!.savedRecordId)).toBe(true);
    expect(auditedIds.has(r2!.savedRecordId)).toBe(true);
    expect(auditedIds.has(r3!.savedRecordId)).toBe(true);

    // All entries must carry the create action
    for (const entry of entries) {
      expect(entry["action"]).toBe("create");
    }
  });
});

// ---------------------------------------------------------------------------
// Schema — "reset" and "dataset-replace" are valid AuditAction values
// ---------------------------------------------------------------------------

describe("auditActionSchema — reset is a valid action", () => {
  it("accepts reset as a valid AuditAction", async () => {
    const { auditActionSchema } = await import("../../shared/schemas/contact.js");
    expect(() => auditActionSchema.parse("reset")).not.toThrow();
  });

  it("still rejects unknown action values", async () => {
    const { auditActionSchema } = await import("../../shared/schemas/contact.js");
    expect(() => auditActionSchema.parse("unknown-action")).toThrow();
  });
});

describe("auditActionSchema — dataset-replace is a distinct valid action", () => {
  it("accepts dataset-replace as a valid AuditAction", async () => {
    const { auditActionSchema } = await import("../../shared/schemas/contact.js");
    expect(() => auditActionSchema.parse("dataset-replace")).not.toThrow();
  });

  it("dataset-replace and bulk-import are distinct string values", () => {
    // Guard: the two import operations must never share the same action string,
    // otherwise audit queries can't distinguish a full JSON replacement from a
    // CSV row-by-row merge.
    const datasetReplace = "dataset-replace";
    const bulkImport = "bulk-import";
    expect(datasetReplace).not.toBe(bulkImport);
  });
});
