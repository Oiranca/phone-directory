import fs from "node:fs/promises";
import path from "node:path";

export const ensureDirectory = async (directoryPath: string) => {
  await fs.mkdir(directoryPath, { recursive: true });
};

export const readJsonFile = async <T>(filePath: string): Promise<T> => {
  const contents = await fs.readFile(filePath, "utf-8");
  return JSON.parse(contents) as T;
};

export const shouldFsyncParentDirectory = (platform: NodeJS.Platform = process.platform): boolean =>
  platform !== "win32";

// Rename over an existing file can fail transiently with EPERM/EEXIST — most commonly on
// Windows, where antivirus/backup software briefly opens the destination for scanning. These
// locks are normally released within milliseconds to low seconds, so retrying with a short
// backoff resolves the vast majority of cases without ever leaving the atomic `rename()` path.
const DEFAULT_RENAME_RETRY_ATTEMPTS = 5;
const DEFAULT_RENAME_RETRY_DELAY_MS = 50;

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const isTransientRenameError = (err: unknown): boolean => {
  const code = (err as NodeJS.ErrnoException).code;
  return code === "EPERM" || code === "EEXIST";
};

/** Attempts `fs.rename(src, dest)`, retrying with exponential backoff when the failure is a
 *  transient EPERM/EEXIST (e.g. a momentary Windows file lock). Any other error is thrown
 *  immediately without retrying. */
async function renameWithRetry(src: string, dest: string, attempts: number, baseDelayMs: number): Promise<void> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      await fs.rename(src, dest);
      return;
    } catch (err: unknown) {
      if (!isTransientRenameError(err)) {
        throw err;
      }
      lastErr = err;
      if (attempt < attempts - 1) {
        await delay(baseDelayMs * 2 ** attempt);
      }
    }
  }
  throw lastErr;
}

export interface WriteJsonFileOptions {
  /** Override the platform used to decide whether to fsync the parent directory.
   *  Defaults to `process.platform`. Intended for unit tests that need to exercise
   *  both POSIX and Windows code paths on any host without `it.runIf` guards. */
  platform?: NodeJS.Platform;
  /** Override the number of `rename()` attempts (initial attempt + retries) before falling
   *  back to the safer copy-then-replace path. Defaults to 5. Intended for unit tests. */
  renameRetryAttempts?: number;
  /** Override the base backoff delay (ms) between rename retries (doubles each attempt).
   *  Defaults to 50ms. Intended for unit tests to avoid slow, real-time waits. */
  renameRetryDelayMs?: number;
}

export async function writeJsonFile(filePath: string, data: unknown, options: WriteJsonFileOptions = {}): Promise<void> {
  const platform = options.platform ?? process.platform;
  const renameRetryAttempts = options.renameRetryAttempts ?? DEFAULT_RENAME_RETRY_ATTEMPTS;
  const renameRetryDelayMs = options.renameRetryDelayMs ?? DEFAULT_RENAME_RETRY_DELAY_MS;
  const tmp = filePath + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), "utf-8");
  try {
    const fh = await fs.open(tmp, "r+");
    try {
      await fh.sync();
    } finally {
      await fh.close();
    }
    try {
      // Atomic path (unchanged): rename the fsynced tmp file directly over the destination,
      // retrying transient EPERM/EEXIST failures before giving up.
      await renameWithRetry(tmp, filePath, renameRetryAttempts, renameRetryDelayMs);
      if (shouldFsyncParentDirectory(platform)) {
        const dirFd = await fs.open(path.dirname(filePath), "r");
        try {
          await dirFd.sync();
        } finally {
          await dirFd.close();
        }
      }
    } catch (err: unknown) {
      if (!isTransientRenameError(err)) {
        await fs.unlink(tmp).catch(() => undefined);
        throw err;
      }
      // Rename retries exhausted — the destination is still locked (typically Windows AV/backup
      // software). Fall back to a still crash-safe replace: copy the already-fsynced tmp file to
      // a NEW adjacent staging file, fsync THAT staging file, and only then atomically rename it
      // over the destination (retrying the same way). The destination file is never opened for
      // in-place writing/truncation, so a crash at any point before the final rename leaves the
      // original file fully intact — never truncated or partially written.
      const staging = filePath + ".new";
      try {
        await fs.copyFile(tmp, staging);
        const stagingFh = await fs.open(staging, "r+");
        try {
          await stagingFh.sync();
        } finally {
          await stagingFh.close();
        }
        await renameWithRetry(staging, filePath, renameRetryAttempts, renameRetryDelayMs);
        await fs.unlink(tmp).catch(() => undefined);
      } catch (fallbackErr) {
        await fs.unlink(staging).catch(() => undefined);
        await fs.unlink(tmp).catch(() => undefined);
        throw fallbackErr;
      }
    }
  } catch (err) {
    await fs.unlink(tmp).catch(() => undefined);
    throw err;
  }
}
