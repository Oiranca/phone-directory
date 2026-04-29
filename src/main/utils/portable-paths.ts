import path from "node:path";

/**
 * Resolves the USB portable root directory from the process executable path.
 *
 * Expected packaged layouts produced by electron-builder `--dir` builds
 * (output directory: dist-portable/):
 *
 *   Windows (win-unpacked/):
 *     dist-portable/win-unpacked/Phone Directory.exe
 *     → executableDirectory = win-unpacked/
 *     → portableRoot         = win-unpacked/    (data lives alongside the executable folder)
 *
 *   macOS (mac/ or mac-<arch>/, e.g. mac-arm64/):
 *     dist-portable/mac-arm64/Phone Directory.app/Contents/MacOS/Phone Directory
 *     → executableDirectory = .../MacOS/
 *     → The .app/Contents/MacOS bundle structure is detected below, so
 *     → portableRoot         = mac-arm64/       (parent of the .app bundle)
 *
 *   Linux (linux-unpacked/):
 *     dist-portable/linux-unpacked/phone-directory
 *     → executableDirectory = linux-unpacked/
 *     → portableRoot         = linux-unpacked/  (data lives alongside the executable folder)
 *
 *   Linux AppImage (when APPIMAGE env var is set by the runtime):
 *     → portableRoot = directory containing the .AppImage file
 */
const resolveDefaultPortableRoot = (execPath: string, appImagePath?: string | null) => {
  if (appImagePath && path.isAbsolute(appImagePath)) {
    return path.dirname(path.resolve(appImagePath));
  }

  const executableDirectory = path.dirname(path.resolve(execPath));
  const contentsDirectory = path.dirname(executableDirectory);
  const bundleDirectory = path.dirname(contentsDirectory);

  if (
    path.basename(executableDirectory) === "MacOS" &&
    path.basename(contentsDirectory) === "Contents" &&
    path.extname(bundleDirectory) === ".app"
  ) {
    return path.dirname(bundleDirectory);
  }

  return executableDirectory;
};

export const resolvePortableUserDataPath = (options: {
  execPath: string;
  appImagePath?: string | null;
  isPackaged: boolean;
  portableMode: boolean;
  portableRootPath: string | null;
}) => {
  if (!options.portableMode || !options.isPackaged) {
    return null;
  }

  const portableRoot = resolveDefaultPortableRoot(options.execPath, options.appImagePath);

  if (options.portableRootPath) {
    return path.isAbsolute(options.portableRootPath)
      ? path.normalize(options.portableRootPath)
      : path.resolve(portableRoot, options.portableRootPath);
  }

  return portableRoot;
};
