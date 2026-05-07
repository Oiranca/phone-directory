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

describe("AuditLogService", () => {
  let testRoot: string;

  beforeEach(async () => {
    testRoot = await fs.mkdtemp(path.join(os.tmpdir(), "audit-log-test-"));
    getPathMock.mockImplementation(() => testRoot);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(testRoot, { recursive: true, force: true });
    getPathMock.mockReset();
  });

  it("creates empty audit-log.json on ensureInitialized", async () => {
    const { AuditLogService } = await import("./audit-log.service.js");
    const service = new AuditLogService();
    await service.ensureInitialized();

    const auditLogPath = path.join(testRoot, "data", "audit-log.json");
    const contents = JSON.parse(await fs.readFile(auditLogPath, "utf-8")) as unknown[];
    expect(Array.isArray(contents)).toBe(true);
    expect(contents).toHaveLength(0);
  });

  it("does not overwrite existing audit log on ensureInitialized", async () => {
    const { AuditLogService } = await import("./audit-log.service.js");
    const service = new AuditLogService();
    await service.ensureInitialized();

    const auditLogPath = path.join(testRoot, "data", "audit-log.json");
    await fs.writeFile(auditLogPath, JSON.stringify([{ timestamp: "2026-01-01T00:00:00.000Z", editor: "test", action: "create" }]), "utf-8");

    await service.ensureInitialized();

    const contents = JSON.parse(await fs.readFile(auditLogPath, "utf-8")) as unknown[];
    expect(contents).toHaveLength(1);
  });

  it("appends an entry to the audit log", async () => {
    const { AuditLogService } = await import("./audit-log.service.js");
    const service = new AuditLogService();
    await service.ensureInitialized();

    await service.append({
      timestamp: "2026-04-30T16:00:00.000Z",
      editor: "Dr. Smith",
      action: "create",
      recordId: "cnt_001",
      recordName: "John Doe"
    });

    const auditLogPath = path.join(testRoot, "data", "audit-log.json");
    const contents = JSON.parse(await fs.readFile(auditLogPath, "utf-8")) as Array<{ editor: string; action: string }>;
    expect(contents).toHaveLength(1);
    expect(contents[0]!.editor).toBe("Dr. Smith");
    expect(contents[0]!.action).toBe("create");
  });

  it("accumulates multiple appended entries", async () => {
    const { AuditLogService } = await import("./audit-log.service.js");
    const service = new AuditLogService();
    await service.ensureInitialized();

    await service.append({
      timestamp: "2026-04-30T16:00:00.000Z",
      editor: "Editor A",
      action: "create",
      recordId: "cnt_001",
      recordName: "Alice"
    });
    await service.append({
      timestamp: "2026-04-30T17:00:00.000Z",
      editor: "Editor B",
      action: "update",
      recordId: "cnt_001",
      recordName: "Alice",
      changes: { displayName: { old: "Alice", new: "Alice Smith" } }
    });

    const result = await service.query({});
    expect(result.totalCount).toBe(2);
    // newest first
    expect(result.entries[0]!.editor).toBe("Editor B");
    expect(result.entries[1]!.editor).toBe("Editor A");
  });

  it("filters entries by action type", async () => {
    const { AuditLogService } = await import("./audit-log.service.js");
    const service = new AuditLogService();
    await service.ensureInitialized();

    await service.append({ timestamp: "2026-05-01T10:00:00.000Z", editor: "Admin", action: "create", recordName: "A" });
    await service.append({ timestamp: "2026-05-01T11:00:00.000Z", editor: "Admin", action: "bulk-import", recordsAffected: 50, importSource: "staff.csv" });
    await service.append({ timestamp: "2026-05-01T12:00:00.000Z", editor: "Admin", action: "update", recordName: "A", changes: null });

    const result = await service.query({ action: "bulk-import" });
    expect(result.totalCount).toBe(1);
    expect(result.entries[0]!.action).toBe("bulk-import");
  });

  it("filters entries by editor substring", async () => {
    const { AuditLogService } = await import("./audit-log.service.js");
    const service = new AuditLogService();
    await service.ensureInitialized();

    await service.append({ timestamp: "2026-05-01T10:00:00.000Z", editor: "Dr. Smith", action: "create" });
    await service.append({ timestamp: "2026-05-01T11:00:00.000Z", editor: "Nurse Jones", action: "update", changes: null });

    const result = await service.query({ editor: "smith" });
    expect(result.totalCount).toBe(1);
    expect(result.entries[0]!.editor).toBe("Dr. Smith");
  });

  it("filters entries by date range", async () => {
    const { AuditLogService } = await import("./audit-log.service.js");
    const service = new AuditLogService();
    await service.ensureInitialized();

    await service.append({ timestamp: "2026-03-01T10:00:00.000Z", editor: "Admin", action: "create" });
    await service.append({ timestamp: "2026-05-01T10:00:00.000Z", editor: "Admin", action: "update", changes: null });
    await service.append({ timestamp: "2026-07-01T10:00:00.000Z", editor: "Admin", action: "delete" });

    const result = await service.query({ fromDate: "2026-04-01T00:00:00.000Z", toDate: "2026-06-30T23:59:59.999Z" });
    expect(result.totalCount).toBe(1);
    expect(result.entries[0]!.action).toBe("update");
  });

  it("filters entries by record name substring", async () => {
    const { AuditLogService } = await import("./audit-log.service.js");
    const service = new AuditLogService();
    await service.ensureInitialized();

    await service.append({ timestamp: "2026-05-01T10:00:00.000Z", editor: "Admin", action: "create", recordName: "Admisión General" });
    await service.append({ timestamp: "2026-05-01T11:00:00.000Z", editor: "Admin", action: "create", recordName: "Urgencias" });

    const result = await service.query({ recordName: "admisión" });
    expect(result.totalCount).toBe(1);
    expect(result.entries[0]!.recordName).toBe("Admisión General");
  });

  it("returns empty result when audit log file is missing", async () => {
    const { AuditLogService } = await import("./audit-log.service.js");
    const service = new AuditLogService();

    const result = await service.query({});
    expect(result.entries).toHaveLength(0);
    expect(result.totalCount).toBe(0);
  });

  it("generates valid CSV output", async () => {
    const { AuditLogService } = await import("./audit-log.service.js");
    const service = new AuditLogService();

    const entries = [
      {
        timestamp: "2026-05-01T10:00:00.000Z",
        editor: "Dr. Smith",
        action: "create" as const,
        recordId: "cnt_001",
        recordName: "John Doe"
      },
      {
        timestamp: "2026-05-01T11:00:00.000Z",
        editor: "Admin",
        action: "bulk-import" as const,
        recordsAffected: 50,
        importSource: "staff-list.csv"
      }
    ];

    const csv = service.toCsv(entries);
    const lines = csv.split("\n");
    expect(lines[0]).toBe("timestamp,editor,action,recordId,recordName,changes,reason,recordsAffected,importSource");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain("Dr. Smith");
    expect(lines[1]).toContain("create");
    expect(lines[2]).toContain("50");
    expect(lines[2]).toContain("staff-list.csv");
  });

  it("escapes commas and quotes in CSV values", async () => {
    const { AuditLogService } = await import("./audit-log.service.js");
    const service = new AuditLogService();

    const entries = [
      {
        timestamp: "2026-05-01T10:00:00.000Z",
        editor: 'Smith, John "The Doc"',
        action: "create" as const
      }
    ];

    const csv = service.toCsv(entries);
    expect(csv).toContain('"Smith, John ""The Doc"""');
  });
});
