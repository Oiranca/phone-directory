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
