import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolvePortableUserDataPath } from "./portable-paths.js";

const isWindows = process.platform === "win32";
const platformPath = isWindows ? path.win32 : path.posix;

const macPortableRoot = isWindows ? "C:\\HospitalUSB\\mac" : "/Volumes/HospitalUSB/mac";
const macExecPath = platformPath.join(
  macPortableRoot,
  "PhoneDirectory.app",
  "Contents",
  "MacOS",
  "PhoneDirectory"
);
const winPortableRoot = isWindows ? "C:\\HospitalUSB\\win" : "/Volumes/HospitalUSB/win";
const winExecPath = platformPath.join(winPortableRoot, "PhoneDirectory.exe");
const linuxPortableRoot = isWindows ? "C:\\USB\\linux" : "/media/USB/linux";
const linuxExecPath = isWindows
  ? "C:\\tmp\\.mount_PhoneD\\usr\\bin\\phone-directory"
  : "/tmp/.mount_PhoneD/usr/bin/phone-directory";
const appImagePath = platformPath.join(linuxPortableRoot, "PhoneDirectory.AppImage");

describe("resolvePortableUserDataPath", () => {
  it("prefers an explicit portable root path override", () => {
    expect(
      resolvePortableUserDataPath({
        execPath: macExecPath,
        isPackaged: true,
        portableMode: true,
        portableRootPath: "../shared-data"
      })
    ).toBe(platformPath.resolve(macPortableRoot, "..", "shared-data"));
  });

  it("returns the executable directory for packaged portable builds", () => {
    expect(
      resolvePortableUserDataPath({
        execPath: winExecPath,
        isPackaged: true,
        portableMode: true,
        portableRootPath: null
      })
    ).toBe(platformPath.resolve(winPortableRoot));
  });

  it("prefers the AppImage parent directory when Linux exposes APPIMAGE", () => {
    expect(
      resolvePortableUserDataPath({
        execPath: linuxExecPath,
        appImagePath,
        isPackaged: true,
        portableMode: true,
        portableRootPath: null
      })
    ).toBe(platformPath.resolve(linuxPortableRoot));
  });

  it("returns the app bundle parent directory for packaged macOS portable builds", () => {
    expect(
      resolvePortableUserDataPath({
        execPath: macExecPath,
        isPackaged: true,
        portableMode: true,
        portableRootPath: null
      })
    ).toBe(platformPath.resolve(macPortableRoot));
  });

  it("keeps the default Electron userData path when portable mode is inactive", () => {
    expect(
      resolvePortableUserDataPath({
        execPath: winExecPath,
        isPackaged: true,
        portableMode: false,
        portableRootPath: null
      })
    ).toBeNull();
  });
});
