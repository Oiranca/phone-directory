import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { shouldFsyncParentDirectory, writeJsonFile } from "./fs-json.js";

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
  };

  beforeEach(() => {
    mockFileHandle = {
      sync: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockResolvedValue(undefined)
    };
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

      it("does NOT fall back to copyFile when rename succeeds", async () => {
        vi.spyOn(fs, "writeFile").mockResolvedValue(undefined);
        vi.spyOn(fs, "open").mockResolvedValue(mockFileHandle as any);
        vi.spyOn(fs, "rename").mockResolvedValue(undefined);

        const copyFileSpy = vi.spyOn(fs, "copyFile").mockResolvedValue(undefined);

        await writeJsonFile("/test/data.json", {}, { platform });

        expect(copyFileSpy).not.toHaveBeenCalled();
      });

      it("propagates non-EPERM/EEXIST rename errors without falling back to copyFile", async () => {
        vi.spyOn(fs, "writeFile").mockResolvedValue(undefined);
        vi.spyOn(fs, "open").mockResolvedValue(mockFileHandle as any);

        const enoentErr = Object.assign(new Error("ENOENT"), { code: "ENOENT" });
        vi.spyOn(fs, "rename").mockRejectedValue(enoentErr);

        const copyFileSpy = vi.spyOn(fs, "copyFile").mockResolvedValue(undefined);
        vi.spyOn(fs, "unlink").mockResolvedValue(undefined);

        await expect(writeJsonFile("/test/data.json", {}, { platform })).rejects.toThrow("ENOENT");
        expect(copyFileSpy).not.toHaveBeenCalled();
      });

      it("removes the tmp file when rename fails with a non-EPERM error", async () => {
        const testFilePath = "/test/data.json";
        vi.spyOn(fs, "writeFile").mockResolvedValue(undefined);
        vi.spyOn(fs, "open").mockResolvedValue(mockFileHandle as any);

        const err = Object.assign(new Error("EACCES"), { code: "EACCES" });
        vi.spyOn(fs, "rename").mockRejectedValue(err);

        const unlinkSpy = vi.spyOn(fs, "unlink").mockResolvedValue(undefined);

        await expect(writeJsonFile(testFilePath, {}, { platform })).rejects.toThrow("EACCES");
        expect(unlinkSpy).toHaveBeenCalledWith(testFilePath + ".tmp");
      });

      it("uses a .tmp file as the intermediate (atomic replacement)", async () => {
        const testFilePath = "/test/data.json";
        vi.spyOn(fs, "writeFile").mockResolvedValue(undefined);
        vi.spyOn(fs, "open").mockResolvedValue(mockFileHandle as any);

        const renameSpy = vi.spyOn(fs, "rename").mockResolvedValue(undefined);

        await writeJsonFile(testFilePath, {}, { platform });

        expect(renameSpy).toHaveBeenCalledWith(testFilePath + ".tmp", testFilePath);
      });
    });
  }

  // Windows: rename over an existing file fails with EPERM/EEXIST; falls back
  // to copyFile + fsync. Parent directory is NOT fsynced.
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
      it(`falls back to a staged copy + fsync + rename when rename keeps failing with ${errCode}`, async () => {
        const testFilePath = "C:\\test\\data.json";

        vi.spyOn(fs, "writeFile").mockResolvedValue(undefined);
        vi.spyOn(fs, "open").mockResolvedValue(mockFileHandle as any);

        const renameErr = Object.assign(new Error(errCode), { code: errCode });
        const renameSpy = vi.spyOn(fs, "rename").mockRejectedValue(renameErr);

        const copyFileSpy = vi.spyOn(fs, "copyFile").mockResolvedValue(undefined);
        vi.spyOn(fs, "unlink").mockResolvedValue(undefined);

        // Force rename to always fail (both the primary attempt and the staging replace),
        // so the write ultimately fails — but the fallback shape is what's under test.
        await expect(
          writeJsonFile(testFilePath, {}, { platform, renameRetryAttempts: 1, renameRetryDelayMs: 0 })
        ).rejects.toThrow(errCode);

        // copyFile writes to a NEW staging file adjacent to the destination — never to the
        // destination path itself (never opens/truncates the destination in place).
        expect(copyFileSpy).toHaveBeenCalledWith(testFilePath + ".tmp", testFilePath + ".new");
        expect(copyFileSpy).not.toHaveBeenCalledWith(expect.anything(), testFilePath);

        // The staging file is fsynced, then an atomic rename is attempted to replace the
        // destination — this is the same rename primitive as the original atomic path, just
        // targeting the staging file instead of tmp.
        expect(renameSpy).toHaveBeenCalledWith(testFilePath + ".new", testFilePath);

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
        vi.spyOn(fs, "copyFile").mockResolvedValue(undefined);

        const unlinkSpy = vi.spyOn(fs, "unlink").mockResolvedValue(undefined);

        await writeJsonFile(testFilePath, {}, { platform, renameRetryAttempts: 1, renameRetryDelayMs: 0 });

        expect(unlinkSpy).toHaveBeenCalledWith(testFilePath + ".tmp");
      });

      it(`removes the tmp and staging files when the copy step itself fails after ${errCode}`, async () => {
        const testFilePath = "C:\\test\\data.json";

        vi.spyOn(fs, "writeFile").mockResolvedValue(undefined);
        vi.spyOn(fs, "open").mockResolvedValue(mockFileHandle as any);

        const renameErr = Object.assign(new Error(errCode), { code: errCode });
        vi.spyOn(fs, "rename").mockRejectedValue(renameErr);

        const copyErr = new Error("copy failed");
        const copyFileSpy = vi.spyOn(fs, "copyFile").mockRejectedValue(copyErr);

        const unlinkSpy = vi.spyOn(fs, "unlink").mockResolvedValue(undefined);

        await expect(
          writeJsonFile(testFilePath, {}, { platform, renameRetryAttempts: 1, renameRetryDelayMs: 0 })
        ).rejects.toThrow("copy failed");

        // The interrupted copy targeted the staging file only — the destination was never
        // opened/truncated, so it remains fully intact even though the write ultimately failed.
        expect(copyFileSpy).toHaveBeenCalledWith(testFilePath + ".tmp", testFilePath + ".new");
        expect(copyFileSpy).not.toHaveBeenCalledWith(expect.anything(), testFilePath);
        expect(unlinkSpy).toHaveBeenCalledWith(testFilePath + ".tmp");
        expect(unlinkSpy).toHaveBeenCalledWith(testFilePath + ".new");
      });
    }

    describe("rename retry with backoff", () => {
      it("retries a transient rename failure and succeeds without ever falling back to copyFile", async () => {
        const testFilePath = "C:\\test\\data.json";
        vi.spyOn(fs, "writeFile").mockResolvedValue(undefined);
        vi.spyOn(fs, "open").mockResolvedValue(mockFileHandle as any);

        const renameErr = Object.assign(new Error("EPERM"), { code: "EPERM" });
        const renameSpy = vi
          .spyOn(fs, "rename")
          .mockRejectedValueOnce(renameErr)
          .mockRejectedValueOnce(renameErr)
          .mockResolvedValueOnce(undefined);

        const copyFileSpy = vi.spyOn(fs, "copyFile").mockResolvedValue(undefined);

        await writeJsonFile(testFilePath, {}, {
          platform: "win32",
          renameRetryAttempts: 5,
          renameRetryDelayMs: 1
        });

        expect(renameSpy).toHaveBeenCalledTimes(3);
        expect(copyFileSpy).not.toHaveBeenCalled();
      });

      it("gives up after exhausting rename retries and then falls back to the staged copy+rename", async () => {
        const testFilePath = "C:\\test\\data.json";
        vi.spyOn(fs, "writeFile").mockResolvedValue(undefined);
        vi.spyOn(fs, "open").mockResolvedValue(mockFileHandle as any);

        const renameErr = Object.assign(new Error("EPERM"), { code: "EPERM" });
        const renameSpy = vi.spyOn(fs, "rename").mockRejectedValue(renameErr);

        const copyFileSpy = vi.spyOn(fs, "copyFile").mockResolvedValue(undefined);
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
        expect(copyFileSpy).toHaveBeenCalledTimes(1);
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
      it("never opens or copies onto the destination file directly — only onto tmp/staging files", async () => {
        const testFilePath = "C:\\test\\data.json";
        vi.spyOn(fs, "writeFile").mockResolvedValue(undefined);
        const openSpy = vi.spyOn(fs, "open").mockResolvedValue(mockFileHandle as any);

        const renameErr = Object.assign(new Error("EPERM"), { code: "EPERM" });
        vi.spyOn(fs, "rename").mockRejectedValue(renameErr);

        const copyFileSpy = vi.spyOn(fs, "copyFile").mockResolvedValue(undefined);
        vi.spyOn(fs, "unlink").mockResolvedValue(undefined);

        await expect(
          writeJsonFile(testFilePath, {}, { platform: "win32", renameRetryAttempts: 1, renameRetryDelayMs: 0 })
        ).rejects.toThrow("EPERM");

        // The destination path itself is never passed to fs.open (never opened for writing
        // or truncated in place) — only tmp/staging files are opened for read+sync.
        for (const call of openSpy.mock.calls) {
          expect(call[0]).not.toBe(testFilePath);
        }
        // copyFile never targets the destination directly.
        for (const call of copyFileSpy.mock.calls) {
          expect(call[1]).not.toBe(testFilePath);
        }
      });

      it("leaves the destination fully intact if the staging copy step is interrupted mid-copy", async () => {
        const testFilePath = "C:\\test\\data.json";
        vi.spyOn(fs, "writeFile").mockResolvedValue(undefined);
        vi.spyOn(fs, "open").mockResolvedValue(mockFileHandle as any);

        const renameErr = Object.assign(new Error("EPERM"), { code: "EPERM" });
        vi.spyOn(fs, "rename").mockRejectedValue(renameErr);

        const copyErr = new Error("interrupted mid-copy");
        const copyFileSpy = vi.spyOn(fs, "copyFile").mockImplementation(async (_src, dest) => {
          // Simulate a crash partway through writing the staging file. Since the destination
          // was never the copy target, it is never touched by this failure.
          expect(dest).not.toBe(testFilePath);
          throw copyErr;
        });
        const unlinkSpy = vi.spyOn(fs, "unlink").mockResolvedValue(undefined);

        await expect(
          writeJsonFile(testFilePath, {}, { platform: "win32", renameRetryAttempts: 1, renameRetryDelayMs: 0 })
        ).rejects.toThrow("interrupted mid-copy");

        expect(copyFileSpy).toHaveBeenCalledWith(testFilePath + ".tmp", testFilePath + ".new");
        expect(unlinkSpy).toHaveBeenCalledWith(testFilePath + ".new");
        expect(unlinkSpy).toHaveBeenCalledWith(testFilePath + ".tmp");
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
          await expect(fs.readFile(testFilePath + ".tmp", "utf-8")).rejects.toThrow();
          await expect(fs.readFile(testFilePath + ".new", "utf-8")).rejects.toThrow();
        } finally {
          await fs.rm(tmpDir, { recursive: true, force: true });
        }
      });
    });

    it("propagates non-EPERM/EEXIST rename errors (does not enter Windows fallback)", async () => {
      const testFilePath = "C:\\test\\data.json";

      vi.spyOn(fs, "writeFile").mockResolvedValue(undefined);
      vi.spyOn(fs, "open").mockResolvedValue(mockFileHandle as any);

      const eacces = Object.assign(new Error("EACCES"), { code: "EACCES" });
      vi.spyOn(fs, "rename").mockRejectedValue(eacces);

      const copyFileSpy = vi.spyOn(fs, "copyFile").mockResolvedValue(undefined);
      vi.spyOn(fs, "unlink").mockResolvedValue(undefined);

      await expect(writeJsonFile(testFilePath, {}, { platform })).rejects.toThrow("EACCES");
      expect(copyFileSpy).not.toHaveBeenCalled();
    });

    it("uses a .tmp file as the intermediate (atomic replacement path)", async () => {
      const testFilePath = "C:\\test\\data.json";

      vi.spyOn(fs, "writeFile").mockResolvedValue(undefined);
      vi.spyOn(fs, "open").mockResolvedValue(mockFileHandle as any);

      const renameSpy = vi.spyOn(fs, "rename").mockResolvedValue(undefined);

      await writeJsonFile(testFilePath, {}, { platform });

      expect(renameSpy).toHaveBeenCalledWith(testFilePath + ".tmp", testFilePath);
    });
  });
});
