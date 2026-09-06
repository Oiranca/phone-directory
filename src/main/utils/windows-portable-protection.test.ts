import { describe, expect, it, vi } from "vitest";
import {
  assertWindowsPortableVolumeProtected,
  WINDOWS_PORTABLE_PROTECTION_MESSAGE,
  WindowsPortableProtectionError
} from "./windows-portable-protection.js";

describe("assertWindowsPortableVolumeProtected", () => {
  it("does nothing outside Windows", () => {
    const run = vi.fn();

    assertWindowsPortableVolumeProtected({ platform: "darwin", run });

    expect(run).not.toHaveBeenCalled();
  });

  it("accepts a protected Windows volume", () => {
    const run = vi.fn().mockReturnValue({ status: 0 });

    assertWindowsPortableVolumeProtected({
      platform: "win32",
      execPath: "E:\\HospiAgenda.exe",
      systemRoot: "C:\\Windows",
      run: run as never
    });

    expect(run).toHaveBeenCalledWith(
      "C:\\Windows\\System32\\manage-bde.exe",
      ["-status", "E:", "-protectionaserrorlevel"],
      { encoding: "utf8", timeout: 10_000, windowsHide: true }
    );
  });

  it.each([{ status: 1 }, { status: null, error: new Error("missing") }])(
    "blocks when BitLocker protection cannot be confirmed",
    (result) => {
      expect(() =>
        assertWindowsPortableVolumeProtected({
          platform: "win32",
          execPath: "E:\\HospiAgenda.exe",
          run: vi.fn().mockReturnValue(result) as never
        })
      ).toThrow(WINDOWS_PORTABLE_PROTECTION_MESSAGE);
    }
  );

  it("blocks Windows network paths that cannot identify a local BitLocker volume", () => {
    expect(() =>
      assertWindowsPortableVolumeProtected({
        platform: "win32",
        execPath: "\\\\server\\share\\HospiAgenda.exe"
      })
    ).toThrow(WindowsPortableProtectionError);
  });
});
