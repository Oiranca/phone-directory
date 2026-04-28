import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolvePortableUserDataPath } from "./portable-paths.js";

describe("resolvePortableUserDataPath", () => {
  it("prefers an explicit portable root path override", () => {
    expect(
      resolvePortableUserDataPath({
        execPath: "/Volumes/HospitalUSB/mac/PhoneDirectory.app/Contents/MacOS/PhoneDirectory",
        isPackaged: true,
        portableMode: true,
        portableRootPath: "../shared-data"
      })
    ).toBe(path.resolve("/Volumes/HospitalUSB/shared-data"));
  });

  it("returns the executable directory for packaged portable builds", () => {
    expect(
      resolvePortableUserDataPath({
        execPath: "/Volumes/HospitalUSB/win/PhoneDirectory.exe",
        isPackaged: true,
        portableMode: true,
        portableRootPath: null
      })
    ).toBe(path.resolve("/Volumes/HospitalUSB/win"));
  });

  it("prefers the AppImage parent directory when Linux exposes APPIMAGE", () => {
    expect(
      resolvePortableUserDataPath({
        execPath: "/tmp/.mount_PhoneD/usr/bin/phone-directory",
        appImagePath: "/media/USB/linux/PhoneDirectory.AppImage",
        isPackaged: true,
        portableMode: true,
        portableRootPath: null
      })
    ).toBe(path.resolve("/media/USB/linux"));
  });

  it("returns the app bundle parent directory for packaged macOS portable builds", () => {
    expect(
      resolvePortableUserDataPath({
        execPath: "/Volumes/HospitalUSB/mac/PhoneDirectory.app/Contents/MacOS/PhoneDirectory",
        isPackaged: true,
        portableMode: true,
        portableRootPath: null
      })
    ).toBe(path.resolve("/Volumes/HospitalUSB/mac"));
  });

  it("keeps the default Electron userData path when portable mode is inactive", () => {
    expect(
      resolvePortableUserDataPath({
        execPath: "/Volumes/HospitalUSB/win/PhoneDirectory.exe",
        isPackaged: true,
        portableMode: false,
        portableRootPath: null
      })
    ).toBeNull();
  });
});
