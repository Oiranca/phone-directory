import fs from "node:fs/promises";

export const ensureDirectory = async (directoryPath: string) => {
  await fs.mkdir(directoryPath, { recursive: true });
};

export const readJsonFile = async <T>(filePath: string): Promise<T> => {
  const contents = await fs.readFile(filePath, "utf-8");
  return JSON.parse(contents) as T;
};

export const writeJsonFile = async (filePath: string, payload: unknown): Promise<void> => {
  const tmp = filePath + ".tmp";
  await fs.writeFile(tmp, JSON.stringify(payload, null, 2) + "\n", "utf-8");
  try {
    await fs.rename(tmp, filePath);
  } catch (err) {
    await fs.unlink(tmp).catch(() => undefined);
    throw err;
  }
};
