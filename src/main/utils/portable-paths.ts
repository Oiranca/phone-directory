import path from "node:path";

const unpackedContainerNames = new Set(["win-unpacked", "linux-unpacked", "mac", "mac-arm64"]);

const resolveExecutableRoot = (execPath: string) => {
  const executableDirectory = path.dirname(path.resolve(execPath));
  const contentsDirectory = path.dirname(executableDirectory);
  const bundleDirectory = path.dirname(contentsDirectory);

  if (
    path.basename(executableDirectory) === "MacOS" &&
    path.basename(contentsDirectory) === "Contents" &&
    path.extname(bundleDirectory) === ".app"
  ) {
    const appContainer = path.dirname(bundleDirectory);
    return unpackedContainerNames.has(path.basename(appContainer))
      ? path.dirname(appContainer)
      : appContainer;
  }

  return unpackedContainerNames.has(path.basename(executableDirectory))
    ? path.dirname(executableDirectory)
    : executableDirectory;
};

const resolveAutomaticPortableRoot = (options: {
  execPath: string;
  appImagePath?: string | null;
  portableExecutableDirectory?: string | null;
}) => {
  if (options.portableExecutableDirectory && path.isAbsolute(options.portableExecutableDirectory)) {
    return path.normalize(options.portableExecutableDirectory);
  }

  if (options.appImagePath && path.isAbsolute(options.appImagePath)) {
    return path.dirname(path.resolve(options.appImagePath));
  }

  return resolveExecutableRoot(options.execPath);
};

/**
 * Packaged applications are USB-portable by construction. Their Electron
 * userData directory is always `<USB_ROOT>/portable-data`, regardless of how
 * the platform executable is opened.
 */
export const resolvePortableUserDataPath = (options: {
  execPath: string;
  appImagePath?: string | null;
  isPackaged: boolean;
  portableExecutableDirectory?: string | null;
}) => {
  if (!options.isPackaged) {
    return null;
  }

  return path.join(resolveAutomaticPortableRoot(options), "portable-data");
};
