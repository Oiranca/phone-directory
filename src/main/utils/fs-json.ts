import fs from "node:fs/promises";

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
    await fs.rename(tmp, filePath);
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EPERM" || code === "EEXIST") {
      // Windows: rename over existing file fails. Use copyFile which overwrites atomically.
      // If copyFile fails, the original file is untouched — no data loss.
      try {
        await fs.copyFile(tmp, filePath);
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
}
