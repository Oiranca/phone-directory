/**
 * AppDataAuditFacade — unit tests
 *
 * Verifies:
 *  1. getAuditLog delegates to AuditLogService.query
 *  2. exportAuditLog delegates to AuditLogService.query + toCsv, writes the CSV
 *     file, creates the directory, and returns the expected result shape
 *  3. appendEntry delegates to AuditLogService.append (happy path)
 *  4. appendEntry swallows AuditLogIntegrityError (non-fatal, logs to console)
 *  5. appendEntry swallows generic errors (non-fatal, logs to console)
 *  6. AppDataService facade delegation — getAuditLog and exportAuditLog on
 *     AppDataService call through to the collaborator
 */

import nodeFs from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as XLSX from "xlsx";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getPathMock = vi.fn();

vi.mock("electron", () => ({
  app: {
    getPath: getPathMock
  }
}));

XLSX.set_fs(nodeFs);

describe("AppDataAuditFacade", () => {
  let testRoot: string;

  beforeEach(async () => {
    testRoot = await fs.mkdtemp(path.join(os.tmpdir(), "phone-directory-audit-facade-"));
    getPathMock.mockImplementation(() => testRoot);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    getPathMock.mockReset();
    await fs.rm(testRoot, { recursive: true, force: true });
  });

  it("getAuditLog returns empty entries and zero total when no entries appended", async () => {
    const { AppDataAuditFacade } = await import("./app-data-audit.facade.js");

    const facade = new AppDataAuditFacade();
    const result = await facade.getAuditLog({ page: 1, pageSize: 20 });

    expect(result.entries).toHaveLength(0);
    expect(result.totalCount).toBe(0);
  });

  it("getAuditLog returns entries appended via appendEntry", async () => {
    const { AppDataAuditFacade } = await import("./app-data-audit.facade.js");

    // The audit log lives in {userData}/data/audit-log.json.
    // AuditLogService.append reads ENOENT as empty array then writes via writeJsonFile,
    // which requires the directory to already exist.  Create it here — this mirrors
    // what AppDataService.ensureInitialFiles does in production.
    await fs.mkdir(path.join(testRoot, "data"), { recursive: true });

    const facade = new AppDataAuditFacade();
    const entry = {
      timestamp: new Date().toISOString(),
      editor: "Test Editor",
      action: "create" as const,
      recordsAffected: 1,
      recordId: "cnt_test1",
      changes: {}
    };

    await facade.appendEntry(entry);

    const result = await facade.getAuditLog({ page: 1, pageSize: 20 });
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.editor).toBe("Test Editor");
    expect(result.entries[0]?.action).toBe("create");
    expect(result.totalCount).toBe(1);
  });

  it("exportAuditLog writes a CSV file to the target path and returns correct metadata", async () => {
    const { AppDataAuditFacade } = await import("./app-data-audit.facade.js");

    const facade = new AppDataAuditFacade();
    const exportDir = path.join(testRoot, "exports");
    const exportPath = path.join(exportDir, "audit.csv");

    const result = await facade.exportAuditLog(exportPath, { page: 1, pageSize: 100 });

    expect(result.filePath).toBe(exportPath);
    expect(result.entryCount).toBe(0);
    expect(typeof result.exportedAt).toBe("string");
    expect(new Date(result.exportedAt).toISOString()).toBe(result.exportedAt);

    const stat = await fs.stat(exportPath);
    expect(stat.isFile()).toBe(true);

    const contents = await fs.readFile(exportPath, "utf-8");
    expect(typeof contents).toBe("string");
  });

  it("exportAuditLog creates nested target directory if it does not exist", async () => {
    const { AppDataAuditFacade } = await import("./app-data-audit.facade.js");

    const facade = new AppDataAuditFacade();
    const exportPath = path.join(testRoot, "deep", "nested", "path", "audit.csv");

    await facade.exportAuditLog(exportPath, { page: 1, pageSize: 100 });

    const stat = await fs.stat(exportPath);
    expect(stat.isFile()).toBe(true);
  });

  it("getAuditLog reports hasArchivedHistory: false and archivedFileCount: 0 when no rotation has occurred", async () => {
    const { AppDataAuditFacade } = await import("./app-data-audit.facade.js");

    const facade = new AppDataAuditFacade();
    const result = await facade.getAuditLog({ page: 1, pageSize: 20 });

    expect(result.hasArchivedHistory).toBe(false);
    expect(result.archivedFileCount).toBe(0);
  });

  it("getAuditLog and exportAuditLog surface archived-history visibility after a rotation", async () => {
    const { AppDataAuditFacade } = await import("./app-data-audit.facade.js");
    const { AuditLogService } = await import("./audit-log.service.js");

    await fs.mkdir(path.join(testRoot, "data"), { recursive: true });

    // Force a rotation directly via a low-threshold AuditLogService instance
    // writing to the same on-disk location the facade will subsequently read.
    const rotatingService = new AuditLogService({ rotationThresholdEntries: 1 });
    await rotatingService.ensureInitialized();
    await rotatingService.append({
      timestamp: "2026-05-01T00:00:00.000Z",
      editor: "Editor A",
      action: "create",
      recordId: "cnt_001",
      recordName: "Alice"
    });
    // Second append crosses the threshold of 1 and triggers rotation.
    await rotatingService.append({
      timestamp: "2026-05-01T01:00:00.000Z",
      editor: "Editor B",
      action: "create",
      recordId: "cnt_002",
      recordName: "Bob"
    });

    const facade = new AppDataAuditFacade();

    const queryResult = await facade.getAuditLog({ page: 1, pageSize: 20 });
    expect(queryResult.hasArchivedHistory).toBe(true);
    expect(queryResult.archivedFileCount).toBe(1);

    const exportPath = path.join(testRoot, "exports", "audit.csv");
    const exportResult = await facade.exportAuditLog(exportPath, { page: 1, pageSize: 100 });
    expect(exportResult.hasArchivedHistory).toBe(true);
    expect(exportResult.archivedFileCount).toBe(1);
  });

  it("appendEntry swallows AuditLogIntegrityError and logs to console (non-fatal)", async () => {
    const { AppDataAuditFacade } = await import("./app-data-audit.facade.js");

    const facade = new AppDataAuditFacade();
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    // Corrupt the audit log file so the next append triggers AuditLogIntegrityError
    const auditLogPath = path.join(testRoot, "data", "audit-log.json");
    await fs.mkdir(path.dirname(auditLogPath), { recursive: true });
    await fs.writeFile(auditLogPath, "{ invalid json {{{{", "utf-8");

    const entry = {
      timestamp: new Date().toISOString(),
      editor: "Integrity Test",
      action: "create" as const,
      recordsAffected: 1,
      recordId: "cnt_integrity",
      changes: {}
    };

    // Must NOT throw even though the audit log is corrupt
    await expect(facade.appendEntry(entry)).resolves.toBeUndefined();

    // Must have logged the integrity error exactly once
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("[AuditLog] INTEGRITY ERROR"),
      expect.any(String),
      expect.anything(),
      expect.any(String),
      expect.anything()
    );
  });

  it("appendEntry one-shot latch: integrity-error block fires ONCE across multiple appends after the log latches", async () => {
    const { AppDataAuditFacade } = await import("./app-data-audit.facade.js");
    const { AuditLogService } = await import("./audit-log.service.js");
    const { AuditLogIntegrityError } = await import("./audit-log.service.js");

    const facade = new AppDataAuditFacade();
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    // Build a stable AuditLogIntegrityError that the mock will keep throwing
    const integrityErr = new AuditLogIntegrityError({
      logFilePath: "/abs/path/to/audit-log.json",
      quarantineFilePath: "/abs/path/to/audit-log.json.quarantine",
      cause: new SyntaxError("Unexpected token"),
    });

    // Make every append call throw AuditLogIntegrityError (simulates the service
    // having latched after the first corruption detection)
    vi.spyOn(AuditLogService.prototype, "append").mockRejectedValue(integrityErr);

    const entry = {
      timestamp: new Date().toISOString(),
      editor: "Latch Test",
      action: "create" as const,
      recordsAffected: 1,
      recordId: "cnt_latch",
      changes: {}
    };

    // Drive five back-to-back appends — all must be fail-open (no throw)
    for (let i = 0; i < 5; i++) {
      await expect(facade.appendEntry(entry)).resolves.toBeUndefined();
    }

    // The integrity-error console.error block must have fired EXACTLY ONCE
    const integrityCalls = consoleErrorSpy.mock.calls.filter(
      ([msg]) => typeof msg === "string" && (msg as string).includes("[AuditLog] INTEGRITY ERROR")
    );
    expect(integrityCalls).toHaveLength(1);
  });

  it("appendEntry swallows generic errors and logs code+message without the raw error object (FIX 4 — path-leak guard)", async () => {
    const { AppDataAuditFacade } = await import("./app-data-audit.facade.js");
    const { AuditLogService } = await import("./audit-log.service.js");

    const facade = new AppDataAuditFacade();
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    // Simulate an EACCES error whose message contains an absolute filesystem path
    const fsError = Object.assign(
      new Error("EACCES: permission denied, open '/private/tmp/phone-dir/data/audit-log.json'"),
      { code: "EACCES" }
    );
    vi.spyOn(AuditLogService.prototype, "append").mockRejectedValueOnce(fsError);

    const entry = {
      timestamp: new Date().toISOString(),
      editor: "Generic Error Test",
      action: "update" as const,
      recordsAffected: 1,
      recordId: "cnt_generic",
      changes: {}
    };

    // Must NOT throw
    await expect(facade.appendEntry(entry)).resolves.toBeUndefined();

    // FIX 4: console.error must have been called exactly once, with a single
    // string argument (no raw Error object, no stray empty-string argument).
    expect(consoleErrorSpy).toHaveBeenCalledOnce();
    const loggedArgs = consoleErrorSpy.mock.calls[0]!;
    // Exactly one argument — the fully-interpolated message string
    expect(loggedArgs).toHaveLength(1);
    expect(typeof loggedArgs[0]).toBe("string");
    expect(loggedArgs[0]).toContain("[AuditLog] Failed to append entry —");
    expect(loggedArgs[0]).toContain("EACCES");
    // The raw Error object must not have been passed
    expect(loggedArgs).not.toContain(fsError);
  });

  it("recoverFromIntegrityError clears the latched error so a subsequent appendEntry succeeds", async () => {
    const { AppDataAuditFacade } = await import("./app-data-audit.facade.js");

    // Create the audit-log directory so AuditLogService can write
    await fs.mkdir(path.join(testRoot, "data"), { recursive: true });

    // Corrupt the audit log to trigger AuditLogIntegrityError on the first append
    const auditLogPath = path.join(testRoot, "data", "audit-log.json");
    await fs.writeFile(auditLogPath, "{ invalid json {{{{", "utf-8");

    const facade = new AppDataAuditFacade();
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const entry = {
      timestamp: new Date().toISOString(),
      editor: "Recovery Test",
      action: "create" as const,
      recordsAffected: 1,
      recordId: "cnt_recovery",
      changes: {}
    };

    // First append: latches the integrity error (non-fatal, swallowed)
    await facade.appendEntry(entry);
    expect(consoleErrorSpy).toHaveBeenCalled();

    // Remove the corrupt file so recoverFromIntegrityError + subsequent writes can succeed
    await fs.rm(auditLogPath, { force: true });

    // Recovery must not throw
    await expect(facade.recoverFromIntegrityError()).resolves.toBeUndefined();

    // After recovery a second append must succeed — integrity guard is cleared
    consoleErrorSpy.mockClear();
    await facade.appendEntry(entry);

    // No integrity error must have been logged after recovery
    const integrityCallsAfterRecovery = consoleErrorSpy.mock.calls.filter(
      ([msg]) => typeof msg === "string" && (msg as string).includes("INTEGRITY ERROR")
    );
    expect(integrityCallsAfterRecovery).toHaveLength(0);

    // The entry must actually be persisted on disk
    const result = await facade.getAuditLog({ page: 1, pageSize: 20 });
    expect(result.entries.length).toBeGreaterThanOrEqual(1);
  });
});

describe("AppDataService → AppDataAuditFacade delegation", () => {
  let testRoot: string;

  beforeEach(async () => {
    testRoot = await fs.mkdtemp(path.join(os.tmpdir(), "phone-directory-facade-delegation-"));
    getPathMock.mockImplementation(() => testRoot);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    getPathMock.mockReset();
    await fs.rm(testRoot, { recursive: true, force: true });
  });

  it("AppDataService.getAuditLog delegates to the audit facade", async () => {
    const { AppDataService } = await import("./app-data.service.js");
    const { AppDataAuditFacade } = await import("./app-data-audit.facade.js");

    const mockResult = { entries: [], totalCount: 0, hasArchivedHistory: false, archivedFileCount: 0 };
    const querySpy = vi.spyOn(AppDataAuditFacade.prototype, "getAuditLog").mockResolvedValueOnce(mockResult);

    const service = new AppDataService();
    const result = await service.getAuditLog({ page: 1, pageSize: 10 });

    expect(querySpy).toHaveBeenCalledOnce();
    expect(querySpy).toHaveBeenCalledWith({ page: 1, pageSize: 10 });
    expect(result).toBe(mockResult);
  });

  it("AppDataService.exportAuditLog delegates to the audit facade", async () => {
    const { AppDataService } = await import("./app-data.service.js");
    const { AppDataAuditFacade } = await import("./app-data-audit.facade.js");

    const exportPath = path.join(testRoot, "audit.csv");
    const mockResult = {
      filePath: exportPath,
      exportedAt: new Date().toISOString(),
      entryCount: 0,
      hasArchivedHistory: false,
      archivedFileCount: 0
    };
    const exportSpy = vi.spyOn(AppDataAuditFacade.prototype, "exportAuditLog").mockResolvedValueOnce(mockResult);

    const service = new AppDataService();
    const result = await service.exportAuditLog(exportPath, { page: 1, pageSize: 100 });

    expect(exportSpy).toHaveBeenCalledOnce();
    expect(exportSpy).toHaveBeenCalledWith(exportPath, { page: 1, pageSize: 100 });
    expect(result).toBe(mockResult);
  });

  it("AppDataService.recoverAuditLog delegates to AppDataAuditFacade.recoverFromIntegrityError (FIX 1)", async () => {
    const { AppDataService } = await import("./app-data.service.js");
    const { AppDataAuditFacade } = await import("./app-data-audit.facade.js");

    const recoverSpy = vi.spyOn(AppDataAuditFacade.prototype, "recoverFromIntegrityError").mockResolvedValueOnce(undefined);

    const service = new AppDataService();
    await expect(service.recoverAuditLog()).resolves.toBeUndefined();

    expect(recoverSpy).toHaveBeenCalledOnce();
  });
});
