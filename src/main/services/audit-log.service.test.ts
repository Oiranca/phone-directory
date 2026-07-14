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

  it("ensureInitialized() does NOT overwrite log when fs.access rejects with non-ENOENT (EACCES) — propagates error and leaves file intact", async () => {
    // Regression guard for the bare-catch hole: a transient EACCES on fs.access
    // must NOT cause ensureInitialized() to silently overwrite an existing log
    // with [].  The error must propagate and the file content must be untouched.
    const { AuditLogService } = await import("./audit-log.service.js");
    const service = new AuditLogService();
    const auditLogPath = path.join(testRoot, "data", "audit-log.json");
    await fs.mkdir(path.dirname(auditLogPath), { recursive: true });

    const existingContent = JSON.stringify([{
      timestamp: "2026-06-01T10:00:00.000Z",
      editor: "Admin",
      action: "create",
      recordName: "Existing entry"
    }]);
    await fs.writeFile(auditLogPath, existingContent, "utf-8");

    // Mock fs.access to simulate a transient EACCES (not ENOENT).
    const accessSpy = vi.spyOn(fs, "access");
    accessSpy.mockRejectedValueOnce(
      Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" })
    );

    // ensureInitialized() must propagate the error (not swallow it).
    await expect(service.ensureInitialized()).rejects.toMatchObject({ code: "EACCES" });

    // The existing file content must be completely untouched.
    const onDisk = await fs.readFile(auditLogPath, "utf-8");
    expect(onDisk).toBe(existingContent);
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

  it("returns empty result when audit log file is missing (ENOENT is not a corruption)", async () => {
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

  // ---------------------------------------------------------------------------
  // CSV formula injection neutralization (CWE-1236)
  // ---------------------------------------------------------------------------

  describe("toCsv — formula injection neutralization", () => {
    it("prefixes apostrophe for cell starting with '='", async () => {
      const { AuditLogService } = await import("./audit-log.service.js");
      const service = new AuditLogService();
      const csv = service.toCsv([
        { timestamp: "2026-05-01T10:00:00.000Z", editor: "=HYPERLINK(\"evil.com\")", action: "create" as const }
      ]);
      // editor cell must contain the apostrophe-prefixed value (inside quotes because it contains quotes)
      expect(csv).toContain("'=HYPERLINK");
    });

    it("prefixes apostrophe for cell starting with '+'", async () => {
      const { AuditLogService } = await import("./audit-log.service.js");
      const service = new AuditLogService();
      const csv = service.toCsv([
        { timestamp: "2026-05-01T10:00:00.000Z", editor: "+cmd|' /C calc", action: "create" as const }
      ]);
      expect(csv).toContain("'+cmd");
    });

    it("prefixes apostrophe for cell starting with '-'", async () => {
      const { AuditLogService } = await import("./audit-log.service.js");
      const service = new AuditLogService();
      const csv = service.toCsv([
        { timestamp: "2026-05-01T10:00:00.000Z", editor: "-2+3", action: "create" as const }
      ]);
      expect(csv).toContain("'-2+3");
    });

    it("prefixes apostrophe for cell starting with '@'", async () => {
      const { AuditLogService } = await import("./audit-log.service.js");
      const service = new AuditLogService();
      const csv = service.toCsv([
        { timestamp: "2026-05-01T10:00:00.000Z", editor: "@SUM(1,2)", action: "create" as const }
      ]);
      expect(csv).toContain("'@SUM");
    });

    it("prefixes apostrophe for cell starting with TAB (0x09)", async () => {
      const { AuditLogService } = await import("./audit-log.service.js");
      const service = new AuditLogService();
      const csv = service.toCsv([
        { timestamp: "2026-05-01T10:00:00.000Z", editor: "\tindented", action: "create" as const }
      ]);
      expect(csv).toContain("'\t");
    });

    it("prefixes apostrophe for cell starting with CR (0x0D)", async () => {
      const { AuditLogService } = await import("./audit-log.service.js");
      const service = new AuditLogService();
      const csv = service.toCsv([
        { timestamp: "2026-05-01T10:00:00.000Z", editor: "\rcarriage", action: "create" as const }
      ]);
      expect(csv).toContain("'\r");
    });

    it("wraps field in double-quotes when cell contains a mid-value CR (RFC 4180 §2.6)", async () => {
      const { AuditLogService } = await import("./audit-log.service.js");
      const service = new AuditLogService();
      const csv = service.toCsv([
        { timestamp: "2026-05-01T10:00:00.000Z", editor: "hello\rworld", action: "create" as const }
      ]);
      // The CR is mid-value (not at position 0), so no apostrophe prefix.
      // RFC 4180 requires the field to be wrapped in double quotes.
      expect(csv).toContain('"hello\rworld"');
    });

    it("wraps CR-prefixed formula trigger in double-quotes AND adds apostrophe prefix", async () => {
      const { AuditLogService } = await import("./audit-log.service.js");
      const service = new AuditLogService();
      // \r at position 0 → apostrophe prefix (injection neutralization)
      // resulting neutralized value '\rcarriage contains \r → must also be double-quoted
      const csv = service.toCsv([
        { timestamp: "2026-05-01T10:00:00.000Z", editor: "\rcarriage", action: "create" as const }
      ]);
      // Cell must be outer-quoted AND contain apostrophe then CR
      expect(csv).toContain("\"'\rcarriage\"");
    });

    it("does NOT prefix apostrophe for trigger char that is NOT at position 0", async () => {
      const { AuditLogService } = await import("./audit-log.service.js");
      const service = new AuditLogService();
      const csv = service.toCsv([
        { timestamp: "2026-05-01T10:00:00.000Z", editor: "a=b+c", action: "create" as const }
      ]);
      expect(csv).not.toContain("'a=b+c");
      expect(csv).toContain("a=b+c");
    });

    it("does NOT modify a normal Unicode value (accented name)", async () => {
      const { AuditLogService } = await import("./audit-log.service.js");
      const service = new AuditLogService();
      const csv = service.toCsv([
        { timestamp: "2026-05-01T10:00:00.000Z", editor: "José Müller", action: "create" as const }
      ]);
      expect(csv).toContain("José Müller");
      expect(csv).not.toContain("'José");
    });

    it("wraps a quoted field correctly when trigger cell also contains a double-quote", async () => {
      const { AuditLogService } = await import("./audit-log.service.js");
      const service = new AuditLogService();
      // Input: ="say ""hello"""  (has = trigger and internal quotes)
      // After neutralization: '="say ""hello"""
      // After RFC 4180 quote-wrap + double internal quotes: "'=""say """"hello"""""" (wrapped in outer quotes)
      const csv = service.toCsv([
        { timestamp: "2026-05-01T10:00:00.000Z", editor: '="say ""hello"""', action: "create" as const }
      ]);
      // Actual produced cell: outer-quoted, apostrophe first, all internal quotes doubled
      expect(csv).toContain(`"'=""say """"hello"""""""`);
    });

    it("wraps field in quotes when trigger cell contains a comma", async () => {
      const { AuditLogService } = await import("./audit-log.service.js");
      const service = new AuditLogService();
      const csv = service.toCsv([
        { timestamp: "2026-05-01T10:00:00.000Z", editor: "=SUM(A1,B1)", action: "create" as const }
      ]);
      // After neutralization: '=SUM(A1,B1) — has a comma so must be quoted
      expect(csv).toContain('"\'=SUM(A1,B1)"');
    });

    it("wraps field in quotes when trigger cell contains a newline", async () => {
      const { AuditLogService } = await import("./audit-log.service.js");
      const service = new AuditLogService();
      const csv = service.toCsv([
        { timestamp: "2026-05-01T10:00:00.000Z", editor: "=line1\nline2", action: "create" as const }
      ]);
      // After neutralization: '=line1\nline2 — has a newline so must be quoted
      expect(csv).toContain('"\'=line1\nline2"');
    });
  });

  // ---------------------------------------------------------------------------
  // Fail-closed on corruption
  // ---------------------------------------------------------------------------

  describe("corruption handling — query", () => {
    it("throws AuditLogIntegrityError (not empty result) when file contains malformed JSON", async () => {
      const { AuditLogService, AuditLogIntegrityError } = await import("./audit-log.service.js");
      const service = new AuditLogService();
      const auditLogPath = path.join(testRoot, "data", "audit-log.json");
      await fs.mkdir(path.dirname(auditLogPath), { recursive: true });
      await fs.writeFile(auditLogPath, "{ this is not valid json !!!}", "utf-8");

      await expect(service.query({})).rejects.toBeInstanceOf(AuditLogIntegrityError);
    });

    it("throws AuditLogIntegrityError when file fails Zod schema validation", async () => {
      const { AuditLogService, AuditLogIntegrityError } = await import("./audit-log.service.js");
      const service = new AuditLogService();
      const auditLogPath = path.join(testRoot, "data", "audit-log.json");
      await fs.mkdir(path.dirname(auditLogPath), { recursive: true });
      // Valid JSON but wrong shape — not an array of audit entries.
      await fs.writeFile(auditLogPath, JSON.stringify({ corrupted: true }), "utf-8");

      await expect(service.query({})).rejects.toBeInstanceOf(AuditLogIntegrityError);
    });

    it("preserves original bytes byte-for-byte in the quarantine sidecar after malformed JSON", async () => {
      const { AuditLogService, AuditLogIntegrityError } = await import("./audit-log.service.js");
      const service = new AuditLogService();
      const auditLogPath = path.join(testRoot, "data", "audit-log.json");
      await fs.mkdir(path.dirname(auditLogPath), { recursive: true });
      const corruptContent = "{ this is not valid json !!!}";
      await fs.writeFile(auditLogPath, corruptContent, "utf-8");

      let integrityError!: InstanceType<typeof AuditLogIntegrityError>;
      try {
        await service.query({});
      } catch (err) {
        integrityError = err as InstanceType<typeof AuditLogIntegrityError>;
      }

      expect(integrityError).toBeInstanceOf(AuditLogIntegrityError);
      expect(integrityError.quarantineFilePath).not.toBeNull();

      const sidecarBytes = await fs.readFile(integrityError.quarantineFilePath!);
      expect(sidecarBytes.toString("utf-8")).toBe(corruptContent);
    });

    it("quarantine sidecar filename matches expected pattern (audit-log.corrupt-<timestamp>.json)", async () => {
      const { AuditLogService, AuditLogIntegrityError } = await import("./audit-log.service.js");
      const service = new AuditLogService();
      const auditLogPath = path.join(testRoot, "data", "audit-log.json");
      await fs.mkdir(path.dirname(auditLogPath), { recursive: true });
      await fs.writeFile(auditLogPath, "bad json", "utf-8");

      let integrityError!: InstanceType<typeof AuditLogIntegrityError>;
      try {
        await service.query({});
      } catch (err) {
        integrityError = err as InstanceType<typeof AuditLogIntegrityError>;
      }

      expect(integrityError.quarantineFilePath).toMatch(
        /audit-log\.corrupt-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.json$/
      );
    });

    it("second query() on a corrupt file throws cached error and does NOT create an additional sidecar", async () => {
      const { AuditLogService, AuditLogIntegrityError } = await import("./audit-log.service.js");
      const service = new AuditLogService();
      const auditLogPath = path.join(testRoot, "data", "audit-log.json");
      const dataDir = path.dirname(auditLogPath);
      await fs.mkdir(dataDir, { recursive: true });
      await fs.writeFile(auditLogPath, "bad json", "utf-8");

      // First query — triggers quarantine, writes one sidecar.
      await expect(service.query({})).rejects.toBeInstanceOf(AuditLogIntegrityError);

      const sidecarsAfterFirst = (await fs.readdir(dataDir)).filter((f) =>
        f.includes(".corrupt-")
      );
      expect(sidecarsAfterFirst).toHaveLength(1);

      // Second query — must re-throw the cached error without quarantining again.
      await expect(service.query({})).rejects.toBeInstanceOf(AuditLogIntegrityError);

      const sidecarsAfterSecond = (await fs.readdir(dataDir)).filter((f) =>
        f.includes(".corrupt-")
      );
      expect(sidecarsAfterSecond).toHaveLength(1);
    });
  });

  describe("corruption handling — append", () => {
    it("throws AuditLogIntegrityError (not silently overwriting) when file is malformed JSON", async () => {
      const { AuditLogService, AuditLogIntegrityError } = await import("./audit-log.service.js");
      const service = new AuditLogService();
      const auditLogPath = path.join(testRoot, "data", "audit-log.json");
      await fs.mkdir(path.dirname(auditLogPath), { recursive: true });
      await fs.writeFile(auditLogPath, "not-json", "utf-8");

      await expect(
        service.append({ timestamp: "2026-06-01T00:00:00.000Z", editor: "Admin", action: "create" })
      ).rejects.toBeInstanceOf(AuditLogIntegrityError);
    });

    it("does NOT overwrite the corrupt file after a failed append", async () => {
      const { AuditLogService, AuditLogIntegrityError } = await import("./audit-log.service.js");
      const service = new AuditLogService();
      const auditLogPath = path.join(testRoot, "data", "audit-log.json");
      await fs.mkdir(path.dirname(auditLogPath), { recursive: true });
      const originalCorruptContent = "not-json";
      await fs.writeFile(auditLogPath, originalCorruptContent, "utf-8");

      try {
        await service.append({ timestamp: "2026-06-01T00:00:00.000Z", editor: "Admin", action: "create" });
      } catch (err) {
        expect(err).toBeInstanceOf(AuditLogIntegrityError);
      }

      // The original file must still contain the corrupt bytes — not a fresh [].
      const stillOnDisk = await fs.readFile(auditLogPath, "utf-8");
      expect(stillOnDisk).toBe(originalCorruptContent);
    });

    it("refuses subsequent appends while in integrity-error state without calling recoverFromIntegrityError()", async () => {
      const { AuditLogService, AuditLogIntegrityError } = await import("./audit-log.service.js");
      const service = new AuditLogService();
      const auditLogPath = path.join(testRoot, "data", "audit-log.json");
      await fs.mkdir(path.dirname(auditLogPath), { recursive: true });
      await fs.writeFile(auditLogPath, "bad-json", "utf-8");

      // First append triggers the integrity error and quarantine.
      await expect(
        service.append({ timestamp: "2026-06-01T00:00:00.000Z", editor: "Admin", action: "create" })
      ).rejects.toBeInstanceOf(AuditLogIntegrityError);

      // Externally fix the file — but without calling recoverFromIntegrityError()
      // the service must still refuse to append (fail-closed on cached state).
      await fs.writeFile(auditLogPath, "[]", "utf-8");

      await expect(
        service.append({ timestamp: "2026-06-01T01:00:00.000Z", editor: "Admin", action: "update", changes: null })
      ).rejects.toBeInstanceOf(AuditLogIntegrityError);
    });
  });

  describe("corruption handling — failed quarantine", () => {
    it("still throws AuditLogIntegrityError even when quarantine sidecar write itself fails, with quarantineFilePath null", async () => {
      // Strategy: the audit log file must be readable (so JSON.parse fires and
      // confirms real corruption), but the sidecar write must fail.  We achieve
      // this by spying on fs.writeFile so the *first* call (the sidecar write
      // inside quarantine()) rejects while subsequent calls (writeJsonFile during
      // recovery) still work.  The original chmod-the-directory approach no
      // longer works because POSIX execute permission on the directory is also
      // required to open files inside it, so it triggers an EACCES on readFile
      // which is treated as structural corruption (latches integrityError) rather
      // than as a transient — that behaviour is asserted separately below.
      const { AuditLogService, AuditLogIntegrityError } = await import("./audit-log.service.js");
      const service = new AuditLogService();
      const auditLogPath = path.join(testRoot, "data", "audit-log.json");
      await fs.mkdir(path.dirname(auditLogPath), { recursive: true });
      await fs.writeFile(auditLogPath, "bad-json", "utf-8");

      // Spy on fs.writeFile: reject the first call (quarantine sidecar write),
      // pass all subsequent calls through to the real implementation.
      const realWriteFile = fs.writeFile.bind(fs);
      const writeFileSpy = vi.spyOn(fs, "writeFile");
      writeFileSpy.mockImplementationOnce(() =>
        Promise.reject(Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" }))
      );
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      writeFileSpy.mockImplementation((...args: any[]) => (realWriteFile as any)(...args));

      let integrityError!: InstanceType<typeof AuditLogIntegrityError>;
      try {
        await service.query({});
      } catch (err) {
        integrityError = err as InstanceType<typeof AuditLogIntegrityError>;
      }

      expect(integrityError).toBeInstanceOf(AuditLogIntegrityError);
      // Quarantine sidecar write failed — path must be null, not a string.
      expect(integrityError.quarantineFilePath).toBeNull();
    });

    it("EACCES on an unreadable file IS treated as corruption (quarantine + latch), not a transient error", async () => {
      // EACCES is excluded from TRANSIENT_FS_CODES: a file that is both corrupt
      // AND chmod 0o000 must not escape the fail-closed guarantee.  EACCES
      // therefore quarantines and latches integrityError like any other unknown
      // IO error.
      const { AuditLogService, AuditLogIntegrityError } = await import("./audit-log.service.js");
      const service = new AuditLogService();
      const auditLogPath = path.join(testRoot, "data", "audit-log.json");
      await fs.mkdir(path.dirname(auditLogPath), { recursive: true });
      await fs.writeFile(auditLogPath, "[]", "utf-8");

      // Make the file unreadable (EACCES).
      await fs.chmod(auditLogPath, 0o000);

      let thrownErr: unknown;
      try {
        await service.query({});
      } catch (err) {
        thrownErr = err;
      } finally {
        // Restore so afterEach can clean up.
        await fs.chmod(auditLogPath, 0o644);
      }

      // Must be AuditLogIntegrityError — EACCES latches.
      expect(thrownErr).toBeInstanceOf(AuditLogIntegrityError);
      // No bytes were read so quarantineFilePath is null.
      expect((thrownErr as InstanceType<typeof AuditLogIntegrityError>).quarantineFilePath).toBeNull();
    });
  });

  describe("recovery — recoverFromIntegrityError()", () => {
    it("allows appends after recoverFromIntegrityError() is called", async () => {
      const { AuditLogService, AuditLogIntegrityError } = await import("./audit-log.service.js");
      const service = new AuditLogService();
      const auditLogPath = path.join(testRoot, "data", "audit-log.json");
      await fs.mkdir(path.dirname(auditLogPath), { recursive: true });
      await fs.writeFile(auditLogPath, "bad-json", "utf-8");

      // Trigger integrity error.
      await expect(
        service.append({ timestamp: "2026-06-01T00:00:00.000Z", editor: "Admin", action: "create" })
      ).rejects.toBeInstanceOf(AuditLogIntegrityError);

      // Explicit recovery — must not throw.
      await service.recoverFromIntegrityError();

      // Subsequent append must succeed.
      await service.append({
        timestamp: "2026-06-02T00:00:00.000Z",
        editor: "Admin",
        action: "create",
        recordName: "Post-recovery entry"
      });

      const result = await service.query({});
      expect(result.totalCount).toBe(1);
      expect(result.entries[0]!.recordName).toBe("Post-recovery entry");
    });

    it("fresh log after recovery starts with exactly the appended entries, not merged with old corrupt content", async () => {
      const { AuditLogService } = await import("./audit-log.service.js");
      const service = new AuditLogService();
      const auditLogPath = path.join(testRoot, "data", "audit-log.json");
      await fs.mkdir(path.dirname(auditLogPath), { recursive: true });
      await fs.writeFile(auditLogPath, "bad-json", "utf-8");

      // Force integrity error via query.
      await service.query({}).catch(() => undefined);
      await service.recoverFromIntegrityError();

      await service.append({ timestamp: "2026-06-02T00:00:00.000Z", editor: "Admin", action: "create" });

      const diskContent = JSON.parse(await fs.readFile(auditLogPath, "utf-8")) as unknown[];
      expect(diskContent).toHaveLength(1);
    });

    it("query succeeds and returns empty after recoverFromIntegrityError()", async () => {
      const { AuditLogService, AuditLogIntegrityError } = await import("./audit-log.service.js");
      const service = new AuditLogService();
      const auditLogPath = path.join(testRoot, "data", "audit-log.json");
      await fs.mkdir(path.dirname(auditLogPath), { recursive: true });
      await fs.writeFile(auditLogPath, "bad-json", "utf-8");

      // Trigger corruption on query.
      await expect(service.query({})).rejects.toBeInstanceOf(AuditLogIntegrityError);

      await service.recoverFromIntegrityError();

      const result = await service.query({});
      expect(result.entries).toHaveLength(0);
      expect(result.totalCount).toBe(0);
    });

    it("recoverFromIntegrityError() called with no active integrity error is a no-op and does NOT overwrite the log", async () => {
      const { AuditLogService } = await import("./audit-log.service.js");
      const service = new AuditLogService();
      const auditLogPath = path.join(testRoot, "data", "audit-log.json");
      await fs.mkdir(path.dirname(auditLogPath), { recursive: true });

      // Write a healthy log with one existing entry.
      const existingEntry = {
        timestamp: "2026-06-01T10:00:00.000Z",
        editor: "Admin",
        action: "create",
        recordName: "Existing Entry"
      };
      await fs.writeFile(auditLogPath, JSON.stringify([existingEntry]), "utf-8");

      // Call recoverFromIntegrityError() on a healthy service (no corruption).
      await service.recoverFromIntegrityError();

      // The file must NOT have been overwritten with [].
      const diskContent = JSON.parse(await fs.readFile(auditLogPath, "utf-8")) as unknown[];
      expect(diskContent).toHaveLength(1);

      // integrityError must still be null — a subsequent append succeeds and
      // is visible in the query result (proving the latch was not set).
      await service.append({
        timestamp: "2026-06-02T00:00:00.000Z",
        editor: "Admin",
        action: "create",
        recordName: "Post-noop append"
      });
      const result = await service.query({});
      expect(result.totalCount).toBe(2);
    });
  });

  // ---------------------------------------------------------------------------
  // Transient FS error handling (FIX 1: availability / self-healing)
  // EMFILE, ENFILE, EAGAIN, EBUSY are safe-transient (resource exhaustion).
  // EACCES is intentionally NOT transient — see TRANSIENT_FS_CODES comment.
  // ---------------------------------------------------------------------------

  describe("transient fs error handling", () => {
    it("a transient EMFILE readFile error (query) does NOT latch integrityError and service self-heals on next call", async () => {
      const { AuditLogService, AuditLogIntegrityError } = await import("./audit-log.service.js");
      const service = new AuditLogService();
      const auditLogPath = path.join(testRoot, "data", "audit-log.json");
      await fs.mkdir(path.dirname(auditLogPath), { recursive: true });
      await fs.writeFile(auditLogPath, "[]", "utf-8");

      // Simulate transient EMFILE (fd table exhausted) — fail once, then pass through.
      const readFileSpy = vi.spyOn(fs, "readFile");
      const emfile = Object.assign(new Error("EMFILE: too many open files"), {
        code: "EMFILE",
        errno: -24,
      }) as NodeJS.ErrnoException;
      readFileSpy.mockRejectedValueOnce(emfile);

      // First call: must rethrow the raw EMFILE (not AuditLogIntegrityError).
      await expect(service.query({})).rejects.toMatchObject({ code: "EMFILE" });

      // integrityError must NOT be latched: the very next query resolves normally.
      await service.append({
        timestamp: "2026-06-01T12:00:00.000Z",
        editor: "Admin",
        action: "create",
        recordName: "Post-transient entry"
      });
      const result = await service.query({});
      expect(result.totalCount).toBe(1);
      expect(result.entries[0]!.recordName).toBe("Post-transient entry");
    });

    it("a transient EMFILE readFile error (append) does NOT latch integrityError and service self-heals on next call", async () => {
      const { AuditLogService } = await import("./audit-log.service.js");
      const service = new AuditLogService();
      const auditLogPath = path.join(testRoot, "data", "audit-log.json");
      await fs.mkdir(path.dirname(auditLogPath), { recursive: true });
      await fs.writeFile(auditLogPath, "[]", "utf-8");

      // Simulate transient EMFILE on the readFile call inside append().
      const readFileSpy = vi.spyOn(fs, "readFile");
      const emfile = Object.assign(new Error("EMFILE: too many open files"), {
        code: "EMFILE",
        errno: -24,
      }) as NodeJS.ErrnoException;
      readFileSpy.mockRejectedValueOnce(emfile);

      // First append: must rethrow raw EMFILE (not AuditLogIntegrityError).
      await expect(
        service.append({ timestamp: "2026-06-01T10:00:00.000Z", editor: "Admin", action: "create" })
      ).rejects.toMatchObject({ code: "EMFILE" });

      // readFile spy is now exhausted — subsequent calls use the real implementation.
      // integrityError must NOT be latched: next append succeeds and is queryable.
      await service.append({
        timestamp: "2026-06-01T11:00:00.000Z",
        editor: "Admin",
        action: "create",
        recordName: "Self-healed entry"
      });
      const result = await service.query({});
      expect(result.totalCount).toBe(1);
      expect(result.entries[0]!.recordName).toBe("Self-healed entry");
    });

    it("genuine corruption (bad JSON) still latches integrityError and quarantines, transient path is not taken", async () => {
      const { AuditLogService, AuditLogIntegrityError } = await import("./audit-log.service.js");
      const service = new AuditLogService();
      const auditLogPath = path.join(testRoot, "data", "audit-log.json");
      await fs.mkdir(path.dirname(auditLogPath), { recursive: true });
      await fs.writeFile(auditLogPath, "{ not valid json }", "utf-8");

      // Must throw AuditLogIntegrityError (corruption, not transient).
      let caughtErr: unknown;
      try {
        await service.query({});
      } catch (err) {
        caughtErr = err;
      }

      expect(caughtErr).toBeInstanceOf(AuditLogIntegrityError);

      // integrityError must be latched: a second query returns the cached error.
      await expect(service.query({})).rejects.toBeInstanceOf(AuditLogIntegrityError);

      // A quarantine sidecar must have been created.
      const dataDir = path.dirname(auditLogPath);
      const sidecars = (await fs.readdir(dataDir)).filter((f) => f.includes(".corrupt-"));
      expect(sidecars).toHaveLength(1);
    });
  });
});
