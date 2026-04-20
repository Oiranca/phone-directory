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
    // On Windows, rename fails with EEXIST/EPERM if destination exists.
    // Fall back to: delete destination, then rename.
    if (
      (err as NodeJS.ErrnoException).code === "EPERM" ||
      (err as NodeJS.ErrnoException).code === "EEXIST"
    ) {
      try {
        await fs.unlink(filePath);
        await fs.rename(tmp, filePath);
      } catch {
        await fs.unlink(tmp).catch(() => undefined);
        throw err;
      }
    } else {
      await fs.unlink(tmp).catch(() => undefined);
      throw err;
    }
  }
}
