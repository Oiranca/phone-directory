import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const getPathMock = vi.fn();

vi.mock("electron", () => ({
  app: { getPath: getPathMock }
}));

const usbDataRoot = process.env.USB_IMPORT_FIXTURE_ROOT;

describe.runIf(Boolean(usbDataRoot))("USB JSON import integration", () => {
  let testRoot: string;

  beforeAll(async () => {
    testRoot = await fs.mkdtemp(path.join(os.tmpdir(), "hospiagenda-usb-import-"));
    getPathMock.mockReturnValue(testRoot);
  });

  afterAll(async () => {
    await fs.rm(testRoot, { recursive: true, force: true });
    getPathMock.mockReset();
  });

  it("imports the exact contacts, beepers, and settings files from the USB into an isolated profile", async () => {
    const { AppDataService } = await import("./app-data.service.js");
    const { BeepersService } = await import("./beeper.service.js");
    const beepersService = new BeepersService();
    const service = new AppDataService({ beepersService });

    await service.ensureInitialFiles();

    const contactsResult = await service.importJsonFile(path.join(usbDataRoot!, "contacts.json"));
    const beepersResult = await service.importJsonFile(path.join(usbDataRoot!, "beepers.json"));
    const settingsResult = await service.importJsonFile(path.join(usbDataRoot!, "settings.json"));

    expect(contactsResult.kind).toBe("contacts-import");
    expect(contactsResult.kind === "contacts-import" && contactsResult.result.recordCount).toBe(1667);
    expect(beepersResult).toEqual({ kind: "beepers-import", recordCount: 0, importedRecordCount: 231 });
    expect(await beepersService.listImported()).toHaveLength(231);
    expect(settingsResult.kind).toBe("settings-import");

    if (settingsResult.kind === "settings-import") {
      expect(settingsResult.settings.dataFilePath).toBe(path.join(testRoot, "data", "contacts.json"));
      expect(settingsResult.settings.backupDirectoryPath).toBe(path.join(testRoot, "backups"));
    }
  });
});
