import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeJsonFile } from "./fs-json.js";

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
    vi.clearAllMocks();
  });

  it("should call fsync on parent directory on non-Windows platforms", async () => {
    const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");
    const testFilePath = "/test/data.json";
    const testData = { key: "value" };

    // Mock process.platform to non-Windows
    Object.defineProperty(process, "platform", {
      value: "linux",
      configurable: true
    });

    const actualFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    
    // Mock fs.writeFile
    vi.spyOn(fs, "writeFile").mockResolvedValue(undefined);
    
    // Mock fs.open to return our mock file handle
    const openSpy = vi.spyOn(fs, "open").mockImplementation(async (filePath: string | number) => {
      return mockFileHandle as any;
    });

    // Mock fs.rename
    vi.spyOn(fs, "rename").mockResolvedValue(undefined);

    try {
      await writeJsonFile(testFilePath, testData);

      // Verify that fs.open was called twice:
      // 1. Once for the tmp file (sync before rename)
      // 2. Once for the parent directory (sync after rename on non-Windows)
      expect(openSpy).toHaveBeenCalledTimes(2);
      
      // Verify the second call is for the directory with 'r' flag
      const secondCall = openSpy.mock.calls[1];
      expect(secondCall[0]).toBe(path.dirname(testFilePath));
      expect(secondCall[1]).toBe('r');

      // Verify sync was called twice (once for tmp file, once for directory)
      expect(mockFileHandle.sync).toHaveBeenCalledTimes(2);
      
      // Verify close was called twice
      expect(mockFileHandle.close).toHaveBeenCalledTimes(2);
    } finally {
      // Restore platform
      if (originalPlatform) {
        Object.defineProperty(process, "platform", originalPlatform);
      } else {
        Object.defineProperty(process, "platform", {
          value: "linux",
          configurable: true
        });
      }
      vi.restoreAllMocks();
    }
  });

  it("should NOT call fsync on parent directory on Windows platform", async () => {
    const originalPlatform = Object.getOwnPropertyDescriptor(process, "platform");
    const testFilePath = "C:\\test\\data.json";
    const testData = { key: "value" };

    // Mock process.platform to Windows
    Object.defineProperty(process, "platform", {
      value: "win32",
      configurable: true
    });

    // Mock fs.writeFile
    vi.spyOn(fs, "writeFile").mockResolvedValue(undefined);
    
    // Mock fs.open to return our mock file handle
    const openSpy = vi.spyOn(fs, "open").mockImplementation(async () => {
      return mockFileHandle as any;
    });

    // Mock fs.rename
    vi.spyOn(fs, "rename").mockResolvedValue(undefined);

    try {
      await writeJsonFile(testFilePath, testData);

      // Verify that fs.open was called only ONCE (for the tmp file before rename)
      // NOT for the parent directory since it's Windows
      expect(openSpy).toHaveBeenCalledTimes(1);
      
      // Verify sync was called only once (for tmp file only)
      expect(mockFileHandle.sync).toHaveBeenCalledTimes(1);
      
      // Verify close was called only once
      expect(mockFileHandle.close).toHaveBeenCalledTimes(1);
    } finally {
      // Restore platform
      if (originalPlatform) {
        Object.defineProperty(process, "platform", originalPlatform);
      } else {
        Object.defineProperty(process, "platform", {
          value: "win32",
          configurable: true
        });
      }
      vi.restoreAllMocks();
    }
  });
});
