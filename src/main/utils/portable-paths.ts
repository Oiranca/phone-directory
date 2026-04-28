import path from "node:path";

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
