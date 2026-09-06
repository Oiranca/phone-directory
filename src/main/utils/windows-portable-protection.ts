import { spawnSync } from "node:child_process";
import path from "node:path";

export const WINDOWS_PORTABLE_PROTECTION_MESSAGE =
  "Esta copia portable requiere una unidad protegida con BitLocker To Go. " +
  "Active BitLocker, guarde la clave de recuperación fuera de la unidad y vuelva a abrir la aplicación.";

export class WindowsPortableProtectionError extends Error {
  constructor() {
    super(WINDOWS_PORTABLE_PROTECTION_MESSAGE);
    this.name = "WindowsPortableProtectionError";
  }
}

export const assertWindowsPortableVolumeProtected = (
  options: {
    platform?: NodeJS.Platform;
    execPath?: string;
    systemRoot?: string;
    run?: typeof spawnSync;
  } = {}
): void => {
  if ((options.platform ?? process.platform) !== "win32") {
    return;
  }

  const volume = path.win32.parse(options.execPath ?? process.execPath).root.replace(/[\\/]$/, "");
  if (!/^[a-z]:$/i.test(volume)) {
    throw new WindowsPortableProtectionError();
  }

  const systemRoot = options.systemRoot ?? process.env["SystemRoot"] ?? "C:\\Windows";
  if (!/^[a-z]:[\\/]/i.test(systemRoot)) {
    throw new WindowsPortableProtectionError();
  }

  const result = (options.run ?? spawnSync)(
    path.win32.join(systemRoot, "System32", "manage-bde.exe"),
    ["-status", volume, "-protectionaserrorlevel"],
    { encoding: "utf8", timeout: 10_000, windowsHide: true }
  );
  if (result.status !== 0) {
    throw new WindowsPortableProtectionError();
  }
};
