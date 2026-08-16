import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolvePortableUserDataPath } from "./portable-paths.js";

const isWindows = process.platform === "win32";
const platformPath = isWindows ? path.win32 : path.posix;
const usbRoot = isWindows ? "C:\\HospitalUSB" : "/Volumes/HospitalUSB";
const portableDataPath = platformPath.join(usbRoot, "portable-data");

describe("resolvePortableUserDataPath", () => {
  it("uses the USB root for a directly launched Windows executable without wrapper environment", () => {
    expect(
      resolvePortableUserDataPath({
        execPath: platformPath.join(usbRoot, "HospiAgenda.exe"),
        isPackaged: true
      })
    ).toBe(portableDataPath);
  });

  it("uses the USB root for a directly launched Windows unpacked executable", () => {
    expect(
      resolvePortableUserDataPath({
        execPath: platformPath.join(usbRoot, "win-unpacked", "HospiAgenda.exe"),
        isPackaged: true
      })
    ).toBe(portableDataPath);
  });

  it("uses the AppImage parent directory when launched directly", () => {
    expect(
      resolvePortableUserDataPath({
        execPath: platformPath.join("/tmp", ".mount_Hospi", "usr", "bin", "hospiagenda"),
        appImagePath: platformPath.join(usbRoot, "HospiAgenda.AppImage"),
        isPackaged: true
      })
    ).toBe(portableDataPath);
  });

  it.each(["mac", "mac-arm64"])(
    "uses the USB root for a directly launched macOS app inside %s",
    (containerName) => {
      expect(
        resolvePortableUserDataPath({
          execPath: platformPath.join(
            usbRoot,
            containerName,
            "HospiAgenda.app",
            "Contents",
            "MacOS",
            "HospiAgenda"
          ),
          isPackaged: true
        })
      ).toBe(portableDataPath);
    }
  );

  it("uses the USB root for a directly launched Linux unpacked executable", () => {
    expect(
      resolvePortableUserDataPath({
        execPath: platformPath.join(usbRoot, "linux-unpacked", "hospiagenda"),
        isPackaged: true
      })
    ).toBe(portableDataPath);
  });

  it("keeps Electron's default userData path during development", () => {
    expect(
      resolvePortableUserDataPath({
        execPath: platformPath.join(usbRoot, "HospiAgenda.exe"),
        isPackaged: false
      })
    ).toBeNull();
  });
});
