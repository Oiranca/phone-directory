import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ensurePrivateDirectory,
  PRIVATE_DIRECTORY_MODE,
  SENSITIVE_FILE_MODE,
  shouldFsyncParentDirectory,
  writeJsonFile
} from "./fs-json.js";

const realLstat = fs.lstat.bind(fs) as (...args: any[]) => Promise<any>;

// ---------------------------------------------------------------------------
// Per-OS release smoke intent
// ---------------------------------------------------------------------------
// This project has no CI (local-USB release model). Platform durability is
// validated here via Vitest parametrization over ["win32","darwin","linux"],
// exercising each branch on ANY host by injecting a `platform` option into
// writeJsonFile.
//
// When building release artifacts, run `pnpm test` on each target OS to
// confirm host-native behaviour (real kernel fsync, real rename semantics)
// in addition to the injected-platform unit tests below.
// ---------------------------------------------------------------------------

describe("writeJsonFile", () => {
  let mockFileHandle: {
    sync: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    stat: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    const fileIdentity = {
      dev: 1n,
      ino: 1n,
      isSymbolicLink: () => false
    };
    mockFileHandle = {
      sync: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined),
      stat: vi.fn().mockResolvedValue(fileIdentity)
    };
    vi.spyOn(fs, "lstat").mockImplementation(async (filePath, options?) => {
      const candidate = String(filePath);
      if (candidate.startsWith("/test/") || candidate.startsWith("C:\\test\\")) {
        return fileIdentity as Awaited<ReturnType<typeof fs.lstat>>;
      }
      return realLstat(filePath, options);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // shouldFsyncParentDirectory — pure platform guard, no skipping
  // -------------------------------------------------------------------------

  it("should expose the platform guard logic explicitly", () => {
    expect(shouldFsyncParentDirectory("linux")).toBe(true);
    expect(shouldFsyncParentDirectory("darwin")).toBe(true);
    expect(shouldFsyncParentDirectory("win32")).toBe(false);
  });

  it("creates private directories on POSIX platforms", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fs-json-private-dir-"));
    const privateDir = path.join(tmpDir, "data");

    try {
      await ensurePrivateDirectory(privateDir, "linux");

      const mode = (await fs.stat(privateDir)).mode & 0o777;
      expect(mode).toBe(PRIVATE_DIRECTORY_MODE);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it("writes private JSON files on POSIX platforms", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fs-json-private-file-"));
    const filePath = path.join(tmpDir, "contacts.json");

    try {
      await writeJsonFile(filePath, { sensitive: true }, { platform: "linux" });

      const mode = (await fs.stat(filePath)).mode & 0o777;
      expect(mode).toBe(SENSITIVE_FILE_MODE);
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  });

  it.runIf(process.platform !== "win32")(
    "does not follow a pre-created temporary-file symlink",
    async () => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fs-json-symlink-"));
      const filePath = path.join(tmpDir, "contacts.json");
      const victimPath = path.join(tmpDir, "victim.json");
      const uuid = "00000000-0000-4000-8000-000000000001";

      try {
        await fs.writeFile(victimPath, "untouched", "utf-8");
        await fs.symlink(victimPath, `${filePath}.${uuid}.tmp`);

        await expect(
          writeJsonFile(filePath, { safe: true }, { randomUuid: () => uuid })
        ).rejects.toMatchObject({ code: "EEXIST" });

        expect(await fs.readFile(victimPath, "utf-8")).toBe("untouched");
        await expect(fs.readFile(filePath, "utf-8")).rejects.toMatchObject({ code: "ENOENT" });
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    }
  );

  it.runIf(process.platform !== "win32")(
    "rejects a temporary path replaced with a symlink after exclusive creation",
    async () => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fs-json-swap-tmp-"));
      const filePath = path.join(tmpDir, "contacts.json");
      const victimPath = path.join(tmpDir, "victim.json");
      const uuid = "00000000-0000-4000-8000-000000000004";
      const tmpPath = `${filePath}.${uuid}.tmp`;

      try {
        await fs.writeFile(victimPath, "untouched", "utf-8");
        vi.spyOn(fs, "lstat").mockImplementation(async (candidate, options?) => {
          if (candidate === tmpPath) {
            await fs.unlink(tmpPath);
            await fs.symlink(victimPath, tmpPath);
          }
          return realLstat(candidate, options);
        });

        await expect(
          writeJsonFile(filePath, { safe: true }, { randomUuid: () => uuid })
        ).rejects.toMatchObject({ code: "ELOOP" });

        expect(await fs.readFile(victimPath, "utf-8")).toBe("untouched");
        await expect(fs.readFile(filePath, "utf-8")).rejects.toMatchObject({ code: "ENOENT" });
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    }
  );

  it("creates the temporary file exclusively and cleans it after a failed write", async () => {
    const writeError = Object.assign(new Error("disk full"), { code: "ENOSPC" });
    const writeFileSpy = vi.spyOn(fs, "writeFile").mockRejectedValue(writeError);
    const openSpy = vi.spyOn(fs, "open").mockResolvedValue(mockFileHandle as any);
    const unlinkSpy = vi.spyOn(fs, "unlink").mockResolvedValue(undefined);

    await expect(writeJsonFile("/test/data.json", {})).rejects.toThrow("disk full");

    const temporaryPath = expect.stringMatching(/^\/test\/data\.json\.[0-9a-f-]{36}\.tmp$/);
    expect(openSpy).toHaveBeenCalledWith(
      temporaryPath,
      "wx+",
      SENSITIVE_FILE_MODE
    );
    expect(writeFileSpy).toHaveBeenCalledWith(mockFileHandle, expect.any(String), "utf-8");
    expect(unlinkSpy).toHaveBeenCalledWith(temporaryPath);
  });

  it.runIf(process.platform !== "win32")(
    "does not follow a pre-created staging-file symlink during fallback",
    async () => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fs-json-stale-new-"));
      const filePath = path.join(tmpDir, "contacts.json");
      const victimPath = path.join(tmpDir, "victim.json");
      const tmpUuid = "00000000-0000-4000-8000-000000000002";
      const stagingUuid = "00000000-0000-4000-8000-000000000003";

      try {
        const randomUuid = vi.fn().mockReturnValueOnce(tmpUuid).mockReturnValueOnce(stagingUuid);
        await fs.writeFile(victimPath, "untouched", "utf-8");
        await fs.symlink(victimPath, `${filePath}.${stagingUuid}.new`);

        const originalRename = fs.rename.bind(fs);
        vi.spyOn(fs, "rename").mockImplementation(async (src, dest) => {
          if (typeof src === "string" && src.endsWith(".tmp")) {
            throw Object.assign(new Error("EPERM"), { code: "EPERM" });
          }
          return originalRename(src, dest);
        });

        await expect(
          writeJsonFile(
            filePath,
            { sensitive: true },
            { platform: "linux", renameRetryAttempts: 1, renameRetryDelayMs: 0, randomUuid }
          )
        ).rejects.toMatchObject({ code: "EEXIST" });

        expect(await fs.readFile(victimPath, "utf-8")).toBe("untouched");
        await expect(fs.readFile(filePath, "utf-8")).rejects.toMatchObject({ code: "ENOENT" });
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    }
  );

  it.runIf(process.platform !== "win32")(
    "rejects a staging path replaced with a different file after exclusive creation",
    async () => {
      const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fs-json-swap-new-"));
      const filePath = path.join(tmpDir, "contacts.json");
      const replacementPath = path.join(tmpDir, "replacement.json");
      const tmpUuid = "00000000-0000-4000-8000-000000000005";
      const stagingUuid = "00000000-0000-4000-8000-000000000006";
      const stagingPath = `${filePath}.${stagingUuid}.new`;
      const randomUuid = vi.fn().mockReturnValueOnce(tmpUuid).mockReturnValueOnce(stagingUuid);

      try {
        await fs.writeFile(replacementPath, "attacker-controlled", "utf-8");
        const originalRename = fs.rename.bind(fs);
        vi.spyOn(fs, "rename").mockImplementation(async (src, dest) => {
          if (typeof src === "string" && src.endsWith(".tmp")) {
            throw Object.assign(new Error("EPERM"), { code: "EPERM" });
          }
          return originalRename(src, dest);
        });
        vi.spyOn(fs, "lstat").mockImplementation(async (candidate, options?) => {
          if (candidate === stagingPath) {
            await fs.unlink(stagingPath);
            await fs.rename(replacementPath, stagingPath);
          }
          return realLstat(candidate, options);
        });

        await expect(
          writeJsonFile(
            filePath,
            { safe: true },
            { platform: "linux", renameRetryAttempts: 1, renameRetryDelayMs: 0, randomUuid }
          )
        ).rejects.toMatchObject({ code: "ELOOP" });

        await expect(fs.readFile(filePath, "utf-8")).rejects.toMatchObject({ code: "ENOENT" });
      } finally {
        await fs.rm(tmpDir, { recursive: true, force: true });
      }
    }
  );

  // -------------------------------------------------------------------------
  // Per-platform parametrized suite
  // All branches run on every host — no it.runIf guards.
  // -------------------------------------------------------------------------

  // POSIX platforms: rename is atomic; parent directory is fsynced.
  const posixPlatforms: NodeJS.Platform[] = ["darwin", "linux"];

  for (const platform of posixPlatforms) {
    describe(`POSIX semantics — platform: ${platform}`, () => {
      it("uses rename and fsyncs the parent directory", async () => {
        const testFilePath = "/test/data.json";
        const testData = { key: "value" };

        vi.spyOn(fs, "writeFile").mockResolvedValue(undefined);
        vi.spyOn(fs, "chmod").mockResolvedValue(undefined);

        const openSpy = vi.spyOn(fs, "open").mockImplementation(async () => {
          return mockFileHandle as any;
        });

        vi.spyOn(fs, "rename").mockResolvedValue(undefined);

        await writeJsonFile(testFilePath, testData, { platform });

        // open called twice: once for tmp fsync, once for parent dir fsync
        expect(openSpy).toHaveBeenCalledTimes(2);

        const secondCall = openSpy.mock.calls[1];
        expect(secondCall[0]).toBe(path.dirname(testFilePath));
        expect(secondCall[1]).toBe("r");

        expect(mockFileHandle.sync).toHaveBeenCalledTimes(2);
        expect(mockFileHandle.close).toHaveBeenCalledTimes(2);
      });

      it("does NOT create a staging file when rename succeeds", async () => {
        vi.spyOn(fs, "writeFile").mockResolvedValue(undefined);
        vi.spyOn(fs, "chmod").mockResolvedValue(undefined);
        const openSpy = vi.spyOn(fs, "open").mockResolvedValue(mockFileHandle as any);
        vi.spyOn(fs, "rename").mockResolvedValue(undefined);

        await writeJsonFile("/test/data.json", {}, { platform });

        expect(openSpy).not.toHaveBeenCalledWith(expect.stringMatching(/\.new$/), expect.anything(), expect.anything());
      });

      it("propagates non-EPERM/EEXIST rename errors without creating a staging file", async () => {
        vi.spyOn(fs, "writeFile").mockResolvedValue(undefined);
        vi.spyOn(fs, "chmod").mockResolvedValue(undefined);
        const openSpy = vi.spyOn(fs, "open").mockResolvedValue(mockFileHandle as any);

        const enoentErr = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
        vi.spyOn(fs, "rename").mockRejectedValue(enoentErr);

        vi.spyOn(fs, "unlink").mockResolvedValue(undefined);

        await expect(writeJsonFile("/test/data.json", {}, { platform })).rejects.toThrow("ENOENT");
        expect(openSpy).not.toHaveBeenCalledWith(expect.stringMatching(/\.new$/), expect.anything(), expect.anything());
      });

      it("removes the tmp file when rename fails with a non-EPERM error", async () => {
        const testFilePath = "/test/data.json";
        vi.spyOn(fs, "writeFile").mockResolvedValue(undefined);
        vi.spyOn(fs, "chmod").mockResolvedValue(undefined);
        vi.spyOn(fs, "open").mockResolvedValue(mockFileHandle as any);

        const err = Object.assign(new Error("EACCES"), { code: "EACCES" });
        vi.spyOn(fs, "rename").mockRejectedValue(err);

        const unlinkSpy = vi.spyOn(fs, "unlink").mockResolvedValue(undefined);

        await expect(writeJsonFile(testFilePath, {}, { platform })).rejects.toThrow("EACCES");
        expect(unlinkSpy).toHaveBeenCalledWith(expect.stringMatching(/\.tmp$/));
      });

      it("uses a .tmp file as the intermediate (atomic replacement)", async () => {
        const testFilePath = "/test/data.json";
        vi.spyOn(fs, "writeFile").mockResolvedValue(undefined);
        vi.spyOn(fs, "chmod").mockResolvedValue(undefined);
        vi.spyOn(fs, "open").mockResolvedValue(mockFileHandle as any);

        const renameSpy = vi.spyOn(fs, "rename").mockResolvedValue(undefined);

        await writeJsonFile(testFilePath, {}, { platform });

        expect(renameSpy).toHaveBeenCalledWith(expect.stringMatching(/\.tmp$/), testFilePath);
      });
    });
  }

  // Windows: rename over an existing file fails with EPERM/EEXIST; falls back
  // to an exclusively created staging file + fsync. Parent directory is NOT fsynced.
  describe("Windows semantics — platform: win32", () => {
    const platform: NodeJS.Platform = "win32";

    it("does NOT fsync the parent directory", async () => {
      const testFilePath = "C:\\test\\data.json";
      const testData = { key: "value" };

      vi.spyOn(fs, "writeFile").mockResolvedValue(undefined);

      const openSpy = vi.spyOn(fs, "open").mockImplementation(async () => {
        return mockFileHandle as any;
      });

      vi.spyOn(fs, "rename").mockResolvedValue(undefined);

      await writeJsonFile(testFilePath, testData, { platform });

      // open called once: only for tmp fsync; NOT for parent directory
      expect(openSpy).toHaveBeenCalledTimes(1);
      expect(mockFileHandle.sync).toHaveBeenCalledTimes(1);
      expect(mockFileHandle.close).toHaveBeenCalledTimes(1);
    });

    for (const errCode of ["EPERM", "EEXIST"] as const) {
      it(`falls back to a staged write + fsync + rename when rename keeps failing with ${errCode}`, async () => {
        const testFilePath = "C:\\test\\data.json";

        vi.spyOn(fs, "writeFile").mockResolvedValue(undefined);
        const openSpy = vi.spyOn(fs, "open").mockResolvedValue(mockFileHandle as any);

        const renameErr = Object.assign(new Error(errCode), { code: errCode });
        const renameSpy = vi.spyOn(fs, "rename").mockRejectedValue(renameErr);

        vi.spyOn(fs, "unlink").mockResolvedValue(undefined);

        // Force rename to always fail (both the primary attempt and the staging replace),
        // so the write ultimately fails — but the fallback shape is what's under test.
        await expect(
          writeJsonFile(testFilePath, {}, { platform, renameRetryAttempts: 1, renameRetryDelayMs: 0 })
        ).rejects.toThrow(errCode);

        expect(openSpy).toHaveBeenCalledWith(
          expect.stringMatching(/\.new$/),
          "wx+",
          undefined
        );

        // The staging file is fsynced, then an atomic rename is attempted to replace the
        // destination — this is the same rename primitive as the original atomic path, just
        // targeting the staging file instead of tmp.
        expect(renameSpy).toHaveBeenCalledWith(expect.stringMatching(/\.new$/), testFilePath);

        // Three open calls: tmp fsync + staging fsync (dest dir fsync is skipped on win32)
        expect(mockFileHandle.sync).toHaveBeenCalledTimes(2);
      });

      it(`removes the tmp and staging files after a successful ${errCode} fallback`, async () => {
        const testFilePath = "C:\\test\\data.json";

        vi.spyOn(fs, "writeFile").mockResolvedValue(undefined);
        vi.spyOn(fs, "open").mockResolvedValue(mockFileHandle as any);

        const renameErr = Object.assign(new Error(errCode), { code: errCode });
        vi.spyOn(fs, "rename")
          .mockRejectedValueOnce(renameErr) // primary rename fails
          .mockResolvedValueOnce(undefined); // staging replace succeeds
        const unlinkSpy = vi.spyOn(fs, "unlink").mockResolvedValue(undefined);

        await writeJsonFile(testFilePath, {}, { platform, renameRetryAttempts: 1, renameRetryDelayMs: 0 });

        expect(unlinkSpy).toHaveBeenCalledWith(expect.stringMatching(/\.tmp$/));
      });

      it(`removes the tmp and staging files when the staging write fails after ${errCode}`, async () => {
        const testFilePath = "C:\\test\\data.json";

        vi.spyOn(fs, "writeFile").mockResolvedValue(undefined);
        vi.spyOn(fs, "open").mockResolvedValue(mockFileHandle as any);

        const renameErr = Object.assign(new Error(errCode), { code: errCode });
        vi.spyOn(fs, "rename").mockRejectedValue(renameErr);

        const writeErr = new Error("staging write failed");
        const writeFileSpy = vi.spyOn(fs, "writeFile").mockResolvedValueOnce(undefined).mockRejectedValueOnce(writeErr);

        const unlinkSpy = vi.spyOn(fs, "unlink").mockResolvedValue(undefined);

        await expect(
          writeJsonFile(testFilePath, {}, { platform, renameRetryAttempts: 1, renameRetryDelayMs: 0 })
        ).rejects.toThrow("staging write failed");

        // The interrupted write targeted the staging file only — the destination was never
        // opened/truncated, so it remains fully intact even though the write ultimately failed.
        expect(writeFileSpy).toHaveBeenCalledTimes(2);
        expect(unlinkSpy).toHaveBeenCalledWith(expect.stringMatching(/\.tmp$/));
        expect(unlinkSpy).toHaveBeenCalledWith(expect.stringMatching(/\.new$/));
      });
    }

    describe("rename retry with backoff", () => {
      it("retries a transient rename failure and succeeds without creating a staging file", async () => {
        const testFilePath = "C:\\test\\data.json";
        vi.spyOn(fs, "writeFile").mockResolvedValue(undefined);
        const openSpy = vi.spyOn(fs, "open").mockResolvedValue(mockFileHandle as any);

        const renameErr = Object.assign(new Error("EPERM"), { code: "EPERM" });
        const renameSpy = vi
          .spyOn(fs, "rename")
          .mockRejectedValueOnce(renameErr)
          .mockRejectedValueOnce(renameErr)
          .mockResolvedValueOnce(undefined);

        await writeJsonFile(testFilePath, {}, {
          platform: "win32",
          renameRetryAttempts: 5,
          renameRetryDelayMs: 1
        });

        expect(renameSpy).toHaveBeenCalledTimes(3);
        expect(openSpy).toHaveBeenCalledTimes(1);
      });

      it("gives up after exhausting rename retries and then falls back to the staged write+rename", async () => {
        const testFilePath = "C:\\test\\data.json";
        vi.spyOn(fs, "writeFile").mockResolvedValue(undefined);
        vi.spyOn(fs, "open").mockResolvedValue(mockFileHandle as any);

        const renameErr = Object.assign(new Error("EPERM"), { code: "EPERM" });
        const renameSpy = vi.spyOn(fs, "rename").mockRejectedValue(renameErr);

        vi.spyOn(fs, "unlink").mockResolvedValue(undefined);

        await expect(
          writeJsonFile(testFilePath, {}, {
            platform: "win32",
            renameRetryAttempts: 4,
            renameRetryDelayMs: 0
          })
        ).rejects.toThrow("EPERM");

        // 4 attempts for the primary rename + 4 attempts for the staging replace = 8 total.
        expect(renameSpy).toHaveBeenCalledTimes(8);
        expect(fs.writeFile).toHaveBeenCalledTimes(2);
      });

      it("waits with exponential backoff between rename retry attempts", async () => {
        vi.useFakeTimers();
        try {
          const testFilePath = "C:\\test\\data.json";
          vi.spyOn(fs, "writeFile").mockResolvedValue(undefined);
          vi.spyOn(fs, "open").mockResolvedValue(mockFileHandle as any);

          const renameErr = Object.assign(new Error("EPERM"), { code: "EPERM" });
          const renameSpy = vi
            .spyOn(fs, "rename")
            .mockRejectedValueOnce(renameErr)
            .mockRejectedValueOnce(renameErr)
            .mockResolvedValueOnce(undefined);

          const writePromise = writeJsonFile(testFilePath, {}, {
            platform: "win32",
            renameRetryAttempts: 5,
            renameRetryDelayMs: 50
          });

          // First attempt happens immediately and fails.
          await vi.advanceTimersByTimeAsync(0);
          expect(renameSpy).toHaveBeenCalledTimes(1);

          // Backoff before the 2nd attempt is the base delay (50ms).
          await vi.advanceTimersByTimeAsync(50);
          expect(renameSpy).toHaveBeenCalledTimes(2);

          // Backoff before the 3rd attempt doubles (100ms).
          await vi.advanceTimersByTimeAsync(100);
          expect(renameSpy).toHaveBeenCalledTimes(3);

          await writePromise;
        } finally {
          vi.useRealTimers();
        }
      });
    });

    describe("fallback crash-safety invariant", () => {
      it("never opens the destination file directly — only tmp/staging files", async () => {
        const testFilePath = "C:\\test\\data.json";
        vi.spyOn(fs, "writeFile").mockResolvedValue(undefined);
        const openSpy = vi.spyOn(fs, "open").mockResolvedValue(mockFileHandle as any);

        const renameErr = Object.assign(new Error("EPERM"), { code: "EPERM" });
        vi.spyOn(fs, "rename").mockRejectedValue(renameErr);

        vi.spyOn(fs, "unlink").mockResolvedValue(undefined);

        await expect(
          writeJsonFile(testFilePath, {}, { platform: "win32", renameRetryAttempts: 1, renameRetryDelayMs: 0 })
        ).rejects.toThrow("EPERM");

        // The destination path itself is never passed to fs.open (never opened for writing
        // or truncated in place) — only tmp/staging files are opened for read+sync.
        for (const call of openSpy.mock.calls) {
          expect(call[0]).not.toBe(testFilePath);
        }
      });

      it("leaves the destination fully intact if the staging write is interrupted", async () => {
        const testFilePath = "C:\\test\\data.json";
        vi.spyOn(fs, "writeFile").mockResolvedValue(undefined);
        vi.spyOn(fs, "open").mockResolvedValue(mockFileHandle as any);

        const renameErr = Object.assign(new Error("EPERM"), { code: "EPERM" });
        vi.spyOn(fs, "rename").mockRejectedValue(renameErr);

        const writeErr = new Error("interrupted staging write");
        const writeFileSpy = vi.spyOn(fs, "writeFile").mockResolvedValueOnce(undefined).mockRejectedValueOnce(writeErr);
        const unlinkSpy = vi.spyOn(fs, "unlink").mockResolvedValue(undefined);

        await expect(
          writeJsonFile(testFilePath, {}, { platform: "win32", renameRetryAttempts: 1, renameRetryDelayMs: 0 })
        ).rejects.toThrow("interrupted staging write");

        expect(writeFileSpy).toHaveBeenCalledTimes(2);
        expect(unlinkSpy).toHaveBeenCalledWith(expect.stringMatching(/\.new$/));
        expect(unlinkSpy).toHaveBeenCalledWith(expect.stringMatching(/\.tmp$/));
      });

      it("never leaves the destination truncated/partial when every rename attempt (including the fallback replace) fails — real filesystem", async () => {
        const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "fs-json-test-"));
        const testFilePath = path.join(tmpDir, "data.json");
        const originalContent = JSON.stringify({ original: true });

        try {
          await fs.writeFile(testFilePath, originalContent, "utf-8");

          const renameErr = Object.assign(new Error("EPERM"), { code: "EPERM" });
          vi.spyOn(fs, "rename").mockRejectedValue(renameErr);

          await expect(
            writeJsonFile(testFilePath, { updated: true }, {
              platform: "win32",
              renameRetryAttempts: 1,
              renameRetryDelayMs: 0
            })
          ).rejects.toThrow("EPERM");

          // The original file was never opened for in-place writing/truncation — its content
          // is exactly what it was before the (ultimately failed) write attempt.
          const finalContent = await fs.readFile(testFilePath, "utf-8");
          expect(finalContent).toBe(originalContent);

          // Staging artifacts are cleaned up rather than left behind.
          expect((await fs.readdir(tmpDir)).filter((name) => /\.(tmp|new)$/.test(name))).toEqual([]);
        } finally {
          await fs.rm(tmpDir, { recursive: true, force: true });
        }
      });
    });

    it("propagates non-EPERM/EEXIST rename errors (does not enter Windows fallback)", async () => {
      const testFilePath = "C:\\test\\data.json";

      vi.spyOn(fs, "writeFile").mockResolvedValue(undefined);
      const openSpy = vi.spyOn(fs, "open").mockResolvedValue(mockFileHandle as any);

      const eacces = Object.assign(new Error("EACCES"), { code: "EACCES" });
      vi.spyOn(fs, "rename").mockRejectedValue(eacces);

      vi.spyOn(fs, "unlink").mockResolvedValue(undefined);

      await expect(writeJsonFile(testFilePath, {}, { platform })).rejects.toThrow("EACCES");
      expect(openSpy).toHaveBeenCalledTimes(1);
    });

    it("uses a .tmp file as the intermediate (atomic replacement path)", async () => {
      const testFilePath = "C:\\test\\data.json";

      vi.spyOn(fs, "writeFile").mockResolvedValue(undefined);
      vi.spyOn(fs, "open").mockResolvedValue(mockFileHandle as any);

      const renameSpy = vi.spyOn(fs, "rename").mockResolvedValue(undefined);

      await writeJsonFile(testFilePath, {}, { platform });

      expect(renameSpy).toHaveBeenCalledWith(expect.stringMatching(/\.tmp$/), testFilePath);
    });
  });
});
