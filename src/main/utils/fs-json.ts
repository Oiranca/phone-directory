import fs from "node:fs/promises";
import path from "node:path";

export const ensureDirectory = async (directoryPath: string) => {
  await fs.mkdir(directoryPath, { recursive: true });
};

export const readJsonFile = async <T>(filePath: string): Promise<T> => {
  const contents = await fs.readFile(filePath, "utf-8");
  return JSON.parse(contents) as T;
};

export async function writeJsonFile(filePath: string, data: unknown): Promise<void> {
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
      await fs.rename(tmp, filePath);
      if (process.platform !== 'win32') {
        const dirFd = await fs.open(path.dirname(filePath), 'r');
        try {
          await dirFd.sync();
        } finally {
          await dirFd.close();
        }
      }
    } catch (err: unknown) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "EPERM" || code === "EEXIST") {
        // Windows: rename over existing file fails. copyFile overwrites the destination but is
        // not atomic — a crash mid-copy can leave a partial file. We fsync afterwards to flush
        // as much data as possible. If copyFile itself fails, the original file is untouched.
        try {
          await fs.copyFile(tmp, filePath);
          const destFh = await fs.open(filePath, "r+");
          try {
            await destFh.sync();
          } finally {
            await destFh.close();
          }
          await fs.unlink(tmp).catch(() => undefined);
        } catch (copyErr) {
          await fs.unlink(tmp).catch(() => undefined);
          throw copyErr;
        }
      } else {
        await fs.unlink(tmp).catch(() => undefined);
        throw err;
      }
    }
  } catch (err) {
    await fs.unlink(tmp).catch(() => undefined);
    throw err;
  }
}
