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
import * as XLSX from "xlsx-republish";
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

  it("appendEntry swallows AuditLogIntegrityError and logs to console (non-fatal)", async () => {
    const { AppDataAuditFacade } = await import("./app-data-audit.facade.js");
    const { AuditLogIntegrityError } = await import("./audit-log.service.js");

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

    // Must have logged the integrity error
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("[AuditLog] INTEGRITY ERROR"),
      expect.any(String),
      expect.anything(),
      expect.any(String),
      expect.anything()
    );
  });

  it("appendEntry swallows generic errors and logs to console (non-fatal)", async () => {
    const { AppDataAuditFacade } = await import("./app-data-audit.facade.js");
    const { AuditLogService } = await import("./audit-log.service.js");

    const facade = new AppDataAuditFacade();
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    vi.spyOn(AuditLogService.prototype, "append").mockRejectedValueOnce(
      new Error("Generic audit error")
    );

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

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[AuditLog] Failed to append entry:",
      expect.any(Error)
    );
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

    const mockResult = { entries: [], totalCount: 0 };
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
      entryCount: 0
    };
    const exportSpy = vi.spyOn(AppDataAuditFacade.prototype, "exportAuditLog").mockResolvedValueOnce(mockResult);

    const service = new AppDataService();
    const result = await service.exportAuditLog(exportPath, { page: 1, pageSize: 100 });

    expect(exportSpy).toHaveBeenCalledOnce();
    expect(exportSpy).toHaveBeenCalledWith(exportPath, { page: 1, pageSize: 100 });
    expect(result).toBe(mockResult);
  });
});
