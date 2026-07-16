import fs from "node:fs/promises";
import path from "node:path";

const getErrnoException = (error: unknown) => {
  if (error && typeof error === "object" && "code" in error) {
    return error as NodeJS.ErrnoException;
  }

  return null;
};

const isAllowedSystemAliasRoot = (currentPath: string, index: number) =>
  index === 0 && process.platform !== "win32" && ["/tmp", "/var"].includes(currentPath);

/**
 * Reduces an absolute filesystem path to its basename before it is
 * interpolated into an error message that may cross the IPC boundary.
 * Mirrors the sanitization AppDataService.toFilesystemError() applies to
 * fs-callback errors so hand-built `new Error(...)` messages in
 * this module and in path-validation guards never leak absolute realpaths
 * (which typically embed the OS username/home directory) to the renderer.
 */
export const formatPathForError = (targetPath: string) => path.basename(targetPath) || "<raíz>";

/**
 * Node's fs errno errors (e.g. `ENOENT: no such file or directory, lstat
 * '/abs/path'`) embed the absolute path they operated on directly in
 * `error.message`. Rewrapping that message verbatim (as a "detail" suffix)
 * would silently reintroduce the same absolute-path leak that
 * formatPathForError() sanitizes out of the "Ruta afectada" segment. Strip
 * any literal occurrence of the known sensitive path before it is surfaced.
 */
const sanitizeErrorDetailMessage = (rawMessage: string, sensitivePath: string) => {
  if (sensitivePath.trim() === "") {
    return rawMessage;
  }

  return rawMessage.split(sensitivePath).join(formatPathForError(sensitivePath));
};

const buildPathSafetyError = (message: string, currentPath: string, detail: string) =>
  new Error(`${message} Ruta afectada: ${formatPathForError(currentPath)}. ${detail}`);

export const assertPathChainIsNotSymlink = async (
  targetPath: string,
  message: string,
  allowMissingLeaf = false
) => {
  const resolvedPath = path.resolve(targetPath);
  const parsedPath = path.parse(resolvedPath);
  const relativeSegments = resolvedPath.slice(parsedPath.root.length).split(path.sep).filter(Boolean);
  let currentPath = parsedPath.root;

  for (let index = 0; index < relativeSegments.length; index += 1) {
    currentPath = path.join(currentPath, relativeSegments[index]!);

    if (isAllowedSystemAliasRoot(currentPath, index)) {
      continue;
    }

    try {
      const stats = await fs.lstat(currentPath);

      if (stats.isSymbolicLink()) {
        throw buildPathSafetyError(message, currentPath, "No se permiten enlaces simbólicos.");
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes("No se permiten enlaces simbólicos")) {
        throw error;
      }

      const filesystemError = getErrnoException(error);
      const isLeaf = index === relativeSegments.length - 1;

      if (allowMissingLeaf && isLeaf && filesystemError?.code === "ENOENT") {
        return;
      }

      const errorMessage = error instanceof Error ? error.message : String(error);
      throw buildPathSafetyError(
        message,
        currentPath,
        `Error al verificar la ruta: ${sanitizeErrorDetailMessage(errorMessage, currentPath)}`
      );
    }
  }
};
