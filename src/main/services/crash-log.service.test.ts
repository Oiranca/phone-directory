import fs from "node:fs/promises";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getPathMock = vi.fn();

vi.mock("electron", () => ({
  app: {
    getPath: getPathMock
  }
}));

describe("logCrash", () => {
  let testRoot: string;

  beforeEach(async () => {
    testRoot = await fs.mkdtemp(path.join(os.tmpdir(), "crash-log-test-"));
    getPathMock.mockImplementation(() => testRoot);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(testRoot, { recursive: true, force: true });
    getPathMock.mockReset();
  });

  it("creates the data directory and appends a JSON line for an uncaughtException entry", async () => {
    const { logCrash } = await import("./crash-log.service.js");

    logCrash({ source: "uncaughtException", message: "Boom", stack: "Error: Boom\n at x" });

    const crashLogPath = path.join(testRoot, "data", "crash-log.jsonl");
    const contents = await fs.readFile(crashLogPath, "utf-8");
    const lines = contents.trim().split("\n");
    expect(lines).toHaveLength(1);

    const record = JSON.parse(lines[0]!) as {
      timestamp: string;
      source: string;
      message: string;
      stack?: string;
    };
    expect(record.source).toBe("uncaughtException");
    expect(record.message).toBe("Boom");
    expect(record.stack).toBe("Error: Boom\n at x");
    expect(typeof record.timestamp).toBe("string");
    expect(Number.isNaN(Date.parse(record.timestamp))).toBe(false);
    if (process.platform !== "win32") {
      expect((await fs.stat(path.dirname(crashLogPath))).mode & 0o777).toBe(0o700);
      expect((await fs.stat(crashLogPath)).mode & 0o777).toBe(0o600);
    }
  });

  it("omits the stack field when none is provided", async () => {
    const { logCrash } = await import("./crash-log.service.js");

    logCrash({ source: "unhandledRejection", message: "Rejected" });

    const crashLogPath = path.join(testRoot, "data", "crash-log.jsonl");
    const contents = await fs.readFile(crashLogPath, "utf-8");
    const record = JSON.parse(contents.trim()) as Record<string, unknown>;
    expect("stack" in record).toBe(false);
  });

  it("appends multiple entries as separate JSON lines (does not overwrite)", async () => {
    const { logCrash } = await import("./crash-log.service.js");

    logCrash({ source: "uncaughtException", message: "First" });
    logCrash({ source: "render-process-gone", message: "Second" });

    const crashLogPath = path.join(testRoot, "data", "crash-log.jsonl");
    const contents = await fs.readFile(crashLogPath, "utf-8");
    const lines = contents.trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!).message).toBe("First");
    expect(JSON.parse(lines[1]!).message).toBe("Second");
  });

  it("redacts absolute paths and diagnostic suffixes before writing JSONL", async () => {
    const { logCrash } = await import("./crash-log.service.js");
    const sensitivePath = "/Users/jdoe/Library/Application Support/phone-directory/data/contacts.json";

    logCrash({
      source: "uncaughtException",
      message: `No se pudo leer el archivo. Ruta afectada: ${sensitivePath}.`,
      stack: `Error: Boom\n    at read (${sensitivePath}:1:1)`
    });

    const crashLogPath = path.join(testRoot, "data", "crash-log.jsonl");
    const contents = await fs.readFile(crashLogPath, "utf-8");
    const record = JSON.parse(contents.trim()) as { message: string; stack?: string };

    expect(record.message).toBe("No se pudo leer el archivo.");
    expect(record.stack).not.toContain(sensitivePath);
    expect(record.stack).not.toContain("jdoe");
    expect(record.stack).toContain("contacts.json");
  });

  it("redacts POSIX and Windows paths that contain spaces", async () => {
    const { logCrash } = await import("./crash-log.service.js");

    logCrash({
      source: "uncaughtException",
      message: "Open failed at /srv/acme corp/customers/Jane Smith/report.txt",
      stack: "Error\n    at read (C:\\Users\\John Doe\\AppData\\Roaming\\phone-directory\\contacts.json:1:1)"
    });

    const crashLogPath = path.join(testRoot, "data", "crash-log.jsonl");
    const contents = await fs.readFile(crashLogPath, "utf-8");
    const record = JSON.parse(contents.trim()) as { message: string; stack?: string };

    expect(record.message).not.toContain("/srv/acme corp/customers/Jane Smith");
    expect(record.message).not.toContain("Jane Smith");
    expect(record.message).toContain("report.txt");
    expect(record.stack).not.toContain("C:\\Users\\John Doe");
    expect(record.stack).not.toContain("John Doe");
    expect(record.stack).toContain("contacts.json");
  });

  it("truncates long message and stack payloads before writing JSONL", async () => {
    const {
      logCrash,
      MAX_CRASH_LOG_MESSAGE_LENGTH,
      MAX_CRASH_LOG_STACK_LENGTH
    } = await import("./crash-log.service.js");

    logCrash({
      source: "uncaughtException",
      message: "m".repeat(MAX_CRASH_LOG_MESSAGE_LENGTH + 50),
      stack: "s".repeat(MAX_CRASH_LOG_STACK_LENGTH + 50)
    });

    const crashLogPath = path.join(testRoot, "data", "crash-log.jsonl");
    const contents = await fs.readFile(crashLogPath, "utf-8");
    const record = JSON.parse(contents.trim()) as { message: string; stack?: string };

    expect(record.message).toHaveLength(MAX_CRASH_LOG_MESSAGE_LENGTH + "... [truncated]".length);
    expect(record.message).toMatch(/\.\.\. \[truncated\]$/u);
    expect(record.stack).toHaveLength(MAX_CRASH_LOG_STACK_LENGTH + "... [truncated]".length);
    expect(record.stack).toMatch(/\.\.\. \[truncated\]$/u);
  });

  it("retains only the latest crash entries before appending a new JSON line", async () => {
    const { logCrash, MAX_CRASH_LOG_ENTRIES } = await import("./crash-log.service.js");

    for (let index = 0; index < MAX_CRASH_LOG_ENTRIES + 5; index += 1) {
      logCrash({
        source: "uncaughtException",
        message: `Crash ${index}`,
        timestamp: new Date(index).toISOString()
      });
    }

    const crashLogPath = path.join(testRoot, "data", "crash-log.jsonl");
    const contents = await fs.readFile(crashLogPath, "utf-8");
    const lines = contents.trim().split("\n");

    expect(lines).toHaveLength(MAX_CRASH_LOG_ENTRIES);
    expect(JSON.parse(lines[0]!).message).toBe("Crash 5");
    expect(JSON.parse(lines.at(-1)!).message).toBe(`Crash ${MAX_CRASH_LOG_ENTRIES + 4}`);
  });

  it("sanitizes retained legacy entries when appending", async () => {
    const { logCrash } = await import("./crash-log.service.js");
    const crashLogPath = path.join(testRoot, "data", "crash-log.jsonl");
    const sensitivePath = "/Users/jdoe/Library/Application Support/phone-directory/data/contacts.json";
    await fs.mkdir(path.dirname(crashLogPath), { recursive: true });
    await fs.writeFile(
      crashLogPath,
      `${JSON.stringify({
        timestamp: "2026-07-28T00:00:00.000Z",
        source: "uncaughtException",
        message: `Old crash at ${sensitivePath}`,
        stack: `Error\n at read (${sensitivePath}:1:1)`
      })}\n`,
      "utf-8"
    );

    logCrash({ source: "unhandledRejection", message: "New crash" });

    const contents = await fs.readFile(crashLogPath, "utf-8");
    expect(contents).not.toContain(sensitivePath);
    expect(contents).not.toContain("jdoe");
    expect(contents).toContain("contacts.json");
  });

  it.runIf(process.platform !== "win32")(
    "chmods a stale pre-existing rotation .tmp file to the private mode before it gets renamed into place",
    async () => {
      const { logCrash } = await import("./crash-log.service.js");
      const crashLogPath = path.join(testRoot, "data", "crash-log.jsonl");

      // First write creates the crash log file so the next logCrash call takes the
      // sanitize-and-rotate path (which requires the file to already exist).
      logCrash({ source: "uncaughtException", message: "First" });

      // Simulate a `.tmp` rotation file left behind by a crash of a pre-hardening build: it
      // exists on disk already, at a permissive mode. `fs.writeFileSync` only applies its
      // `mode` option when it CREATES the file — since this one already exists, it must be
      // explicitly chmodded, or the stale permissive mode would be promoted to the final file
      // by the subsequent rename.
      const staleTmpPath = `${crashLogPath}.tmp`;
      await fs.writeFile(staleTmpPath, "", { mode: 0o644 });
      expect((await fs.stat(staleTmpPath)).mode & 0o777).toBe(0o644);

      // Assert the fix directly: the rotation path must chmod the stale tmp file to the
      // private mode BEFORE renaming it over the destination — not just rely on a later,
      // unrelated chmod of the final path masking a stale rotation tmp file.
      const chmodSpy = vi.spyOn(fsSync, "chmodSync");

      logCrash({ source: "unhandledRejection", message: "Second" });

      const tmpChmodCall = chmodSpy.mock.calls.find(([target]) => target === staleTmpPath);
      expect(tmpChmodCall).toBeDefined();
      expect(tmpChmodCall?.[1]).toBe(0o600);

      expect((await fs.stat(crashLogPath)).mode & 0o777).toBe(0o600);
    }
  );

  it("never throws when the target path cannot be created (best-effort)", async () => {
    // Point getPath at a path that cannot be used as a writable directory root
    // (a file, not a directory) so mkdirSync/appendFileSync fail internally.
    const blockerFile = path.join(testRoot, "blocker-file");
    await fs.writeFile(blockerFile, "not a directory");
    getPathMock.mockImplementation(() => blockerFile);

    const { logCrash } = await import("./crash-log.service.js");

    expect(() => logCrash({ source: "uncaughtException", message: "Boom" })).not.toThrow();
  });
});
