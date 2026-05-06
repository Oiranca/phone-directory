import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { shouldFsyncParentDirectory, writeJsonFile } from "./fs-json.js";

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

  it.runIf(process.platform !== "win32")(
    "should call fsync on parent directory on non-Windows platforms",
    async () => {
      const testFilePath = "/test/data.json";
      const testData = { key: "value" };

      vi.spyOn(fs, "writeFile").mockResolvedValue(undefined);

      const openSpy = vi.spyOn(fs, "open").mockImplementation(async () => {
        return mockFileHandle as any;
      });

      vi.spyOn(fs, "rename").mockResolvedValue(undefined);

      await writeJsonFile(testFilePath, testData);

      expect(openSpy).toHaveBeenCalledTimes(2);

      const secondCall = openSpy.mock.calls[1];
      expect(secondCall[0]).toBe(path.dirname(testFilePath));
      expect(secondCall[1]).toBe("r");

      expect(mockFileHandle.sync).toHaveBeenCalledTimes(2);
      expect(mockFileHandle.close).toHaveBeenCalledTimes(2);
    }
  );

  it.runIf(process.platform === "win32")(
    "should NOT call fsync on parent directory on Windows platform",
    async () => {
      const testFilePath = "C:\\test\\data.json";
      const testData = { key: "value" };

      vi.spyOn(fs, "writeFile").mockResolvedValue(undefined);

      const openSpy = vi.spyOn(fs, "open").mockImplementation(async () => {
        return mockFileHandle as any;
      });

      vi.spyOn(fs, "rename").mockResolvedValue(undefined);

      await writeJsonFile(testFilePath, testData);

      expect(openSpy).toHaveBeenCalledTimes(1);
      expect(mockFileHandle.sync).toHaveBeenCalledTimes(1);
      expect(mockFileHandle.close).toHaveBeenCalledTimes(1);
    }
  );

  it("should expose the platform guard logic explicitly", () => {
    expect(shouldFsyncParentDirectory("linux")).toBe(true);
    expect(shouldFsyncParentDirectory("darwin")).toBe(true);
    expect(shouldFsyncParentDirectory("win32")).toBe(false);
  });
});
