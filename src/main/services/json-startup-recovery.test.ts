import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_JSON_FILE_SIZE_BYTES } from "../../shared/constants/json-limits.js";

const getPathMock = vi.fn();

vi.mock("electron", () => ({ app: { getPath: getPathMock } }));

describe("JSON startup limits", () => {
  let testRoot: string;

  beforeEach(async () => {
    testRoot = await fs.mkdtemp(path.join(os.tmpdir(), "json-startup-limits-"));
    getPathMock.mockReturnValue(testRoot);
  });

  afterEach(async () => {
    await fs.rm(testRoot, { recursive: true, force: true });
    getPathMock.mockReset();
  });

  it("returns recovery before reading an oversized contacts file", async () => {
    const { AppDataService } = await import("./app-data.service.js");
    const service = new AppDataService();
    await service.ensureInitialFiles();
    await fs.appendFile(
      path.join(testRoot, "data", "contacts.json"),
      " ".repeat(MAX_JSON_FILE_SIZE_BYTES)
    );

    const result = await service.getBootstrapData();

    expect(result).toMatchObject({
      recovery: {
        details: "El archivo JSON supera el tamaño máximo permitido de 10 MB."
      }
    });
  });
});
