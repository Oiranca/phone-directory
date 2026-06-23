import fs from "node:fs/promises";
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
      it(`falls back to copyFile + fsync when rename fails with ${errCode}`, async () => {
        const testFilePath = "C:\\test\\data.json";

        vi.spyOn(fs, "writeFile").mockResolvedValue(undefined);

        // First open call (tmp fsync) returns the mock handle.
        // Second open call (dest fsync after copyFile) also returns mock handle.
        vi.spyOn(fs, "open").mockResolvedValue(mockFileHandle as any);

        const renameErr = Object.assign(new Error(errCode), { code: errCode });
        vi.spyOn(fs, "rename").mockRejectedValue(renameErr);

        const copyFileSpy = vi.spyOn(fs, "copyFile").mockResolvedValue(undefined);
        vi.spyOn(fs, "unlink").mockResolvedValue(undefined);

        await writeJsonFile(testFilePath, {}, { platform });

        expect(copyFileSpy).toHaveBeenCalledWith(testFilePath + ".tmp", testFilePath);
        // Two open calls: tmp fsync + dest fsync
        expect(mockFileHandle.sync).toHaveBeenCalledTimes(2);
      });

      it(`removes the tmp file after a successful ${errCode} fallback`, async () => {
        const testFilePath = "C:\\test\\data.json";

        vi.spyOn(fs, "writeFile").mockResolvedValue(undefined);
        vi.spyOn(fs, "open").mockResolvedValue(mockFileHandle as any);

        const renameErr = Object.assign(new Error(errCode), { code: errCode });
        vi.spyOn(fs, "rename").mockRejectedValue(renameErr);
        vi.spyOn(fs, "copyFile").mockResolvedValue(undefined);

        const unlinkSpy = vi.spyOn(fs, "unlink").mockResolvedValue(undefined);

        await writeJsonFile(testFilePath, {}, { platform });

        expect(unlinkSpy).toHaveBeenCalledWith(testFilePath + ".tmp");
      });

      it(`removes the tmp file when copyFile itself fails after ${errCode}`, async () => {
        const testFilePath = "C:\\test\\data.json";

        vi.spyOn(fs, "writeFile").mockResolvedValue(undefined);
        vi.spyOn(fs, "open").mockResolvedValue(mockFileHandle as any);

        const renameErr = Object.assign(new Error(errCode), { code: errCode });
        vi.spyOn(fs, "rename").mockRejectedValue(renameErr);

        const copyErr = new Error("copy failed");
        vi.spyOn(fs, "copyFile").mockRejectedValue(copyErr);

        const unlinkSpy = vi.spyOn(fs, "unlink").mockResolvedValue(undefined);

        await expect(writeJsonFile(testFilePath, {}, { platform })).rejects.toThrow("copy failed");
        expect(unlinkSpy).toHaveBeenCalledWith(testFilePath + ".tmp");
      });
    }

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
