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
    "does not follow a pre-created legacy rotation symlink",
    async () => {
      const { logCrash } = await import("./crash-log.service.js");
      const crashLogPath = path.join(testRoot, "data", "crash-log.jsonl");
      const staleTmpPath = `${crashLogPath}.tmp`;
      const victimPath = path.join(testRoot, "victim.jsonl");

      logCrash({ source: "uncaughtException", message: "First" });
      await fs.writeFile(victimPath, "untouched", "utf-8");
      await fs.symlink(victimPath, staleTmpPath);

      logCrash({ source: "unhandledRejection", message: "Second" });

      expect(await fs.readFile(victimPath, "utf-8")).toBe("untouched");
      expect((await fs.stat(crashLogPath)).mode & 0o777).toBe(0o600);
    }
  );

  it.runIf(process.platform !== "win32")(
    "does not modify a victim when a rotation path is swapped after its identity check",
    async () => {
      const { logCrash } = await import("./crash-log.service.js");
      const crashLogPath = path.join(testRoot, "data", "crash-log.jsonl");
      const victimPath = path.join(testRoot, "victim.jsonl");

      logCrash({ source: "uncaughtException", message: "First" });
      await fs.writeFile(victimPath, "untouched", { encoding: "utf-8", mode: 0o644 });

      const originalRenameSync = fsSync.renameSync.bind(fsSync);
      let swapped = false;
      const writeFileSyncSpy = vi.spyOn(fsSync, "writeFileSync");
      vi.spyOn(fsSync, "renameSync").mockImplementation((oldPath, newPath) => {
        if (
          !swapped &&
          typeof oldPath === "string" &&
          oldPath.startsWith(`${crashLogPath}.`) &&
          oldPath.endsWith(".tmp") &&
          newPath === crashLogPath
        ) {
          fsSync.unlinkSync(oldPath);
          fsSync.linkSync(victimPath, oldPath);
          swapped = true;
        }
        return originalRenameSync(oldPath, newPath);
      });

      logCrash({ source: "unhandledRejection", message: "Second" });

      expect(swapped).toBe(true);
      expect(await fs.readFile(victimPath, "utf-8")).toBe("untouched");
      expect((await fs.stat(victimPath)).mode & 0o777).toBe(0o644);
      expect(writeFileSyncSpy).toHaveBeenCalledTimes(1);
    }
  );

  it.runIf(process.platform !== "win32")(
    "rejects a hard-link rotation swap after exclusive creation",
    async () => {
      const { logCrash } = await import("./crash-log.service.js");
      const crashLogPath = path.join(testRoot, "data", "crash-log.jsonl");
      const victimPath = path.join(testRoot, "victim.jsonl");

      logCrash({ source: "uncaughtException", message: "First" });
      await fs.writeFile(victimPath, "untouched", "utf-8");

      const originalLstatSync = fsSync.lstatSync.bind(fsSync);
      let swapped = false;
      vi.spyOn(fsSync, "lstatSync").mockImplementation((candidate, options) => {
        if (
          !swapped &&
          typeof candidate === "string" &&
          candidate.startsWith(`${crashLogPath}.`) &&
          candidate.endsWith(".tmp")
        ) {
          fsSync.unlinkSync(candidate);
          fsSync.linkSync(victimPath, candidate);
          swapped = true;
        }
        return originalLstatSync(candidate, options);
      });

      logCrash({ source: "unhandledRejection", message: "Second" });

      expect(swapped).toBe(true);
      expect(await fs.readFile(victimPath, "utf-8")).toBe("untouched");
      expect(await fs.readFile(crashLogPath, "utf-8")).toContain("First");
    }
  );

  it.runIf(process.platform !== "win32")(
    "retries an exclusively claimed rotation name without following its symlink",
    async () => {
      const { logCrash } = await import("./crash-log.service.js");
      const crashLogPath = path.join(testRoot, "data", "crash-log.jsonl");
      const victimPath = path.join(testRoot, "victim.jsonl");
      const collidingUuid = "00000000-0000-4000-8000-000000000001";
      const replacementUuid = "00000000-0000-4000-8000-000000000002";
      const collidingPath = `${crashLogPath}.${collidingUuid}.tmp`;

      logCrash({ source: "uncaughtException", message: "First" });
      await fs.writeFile(victimPath, "untouched", "utf-8");
      await fs.symlink(victimPath, collidingPath);
      vi.spyOn(globalThis.crypto, "randomUUID")
        .mockReturnValueOnce(collidingUuid as ReturnType<typeof globalThis.crypto.randomUUID>)
        .mockReturnValueOnce(replacementUuid as ReturnType<typeof globalThis.crypto.randomUUID>);

      logCrash({ source: "unhandledRejection", message: "Second" });

      expect(await fs.readFile(victimPath, "utf-8")).toBe("untouched");
      expect((await fs.readFile(crashLogPath, "utf-8")).trim().split("\n")).toHaveLength(2);
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
