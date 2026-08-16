import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultContacts } from "../../shared/fixtures/defaultContacts.js";
import { defaultSettings } from "../../shared/fixtures/defaultSettings.js";

const getPathMock = vi.fn();

vi.mock("electron", () => ({
  app: { getPath: getPathMock }
}));

describe("schema-aware JSON import", () => {
  let testRoot: string;
  let fixtureRoot: string;

  beforeEach(async () => {
    testRoot = await fs.mkdtemp(path.join(os.tmpdir(), "hospiagenda-json-import-"));
    fixtureRoot = path.join(testRoot, "fixtures");
    await fs.mkdir(fixtureRoot, { recursive: true });
    getPathMock.mockReturnValue(path.join(testRoot, "profile"));
  });

  afterEach(async () => {
    await fs.rm(testRoot, { recursive: true, force: true });
    getPathMock.mockReset();
  });

  it("classifies contacts, beepers, and settings without mixing their schemas", async () => {
    const profileRoot = path.join(testRoot, "profile");
    const contactsPath = path.join(fixtureRoot, "contacts.json");
    const beepersPath = path.join(fixtureRoot, "beepers.json");
    const settingsPath = path.join(fixtureRoot, "settings.json");
    await fs.writeFile(contactsPath, JSON.stringify(defaultContacts));
    await fs.writeFile(
      beepersPath,
      JSON.stringify({
        version: "1.0.0",
        records: [],
        importedRecords: [{
          id: "ibsc_aabbccdd",
          deviceNumber: "7182",
          department: "Esterilización",
          sourceSheet: "Buscas Todos",
          sourceRow: 2
        }]
      })
    );
    await fs.writeFile(
      settingsPath,
      JSON.stringify({
        ...defaultSettings("/another-machine/contacts.json", "/another-machine/backups"),
        managedPaths: { dataFilePath: true, backupDirectoryPath: true }
      })
    );

    const { AppDataService } = await import("./app-data.service.js");
    const { BeepersService } = await import("./beeper.service.js");
    const beepersService = new BeepersService();
    const service = new AppDataService({ beepersService });
    await service.ensureInitialFiles();

    const contacts = await service.importJsonFile(contactsPath);
    const beepers = await service.importJsonFile(beepersPath);
    const settings = await service.importJsonFile(settingsPath);

    expect(contacts.kind).toBe("contacts-import");
    expect(beepers).toEqual({ kind: "beepers-import", recordCount: 0, importedRecordCount: 1 });
    const backupNames = await fs.readdir(path.join(profileRoot, "backups"));
    const beepersBackupName = backupNames.find((name) => name.startsWith("beepers-before-import-"));
    const settingsBackupName = backupNames.find((name) => name.startsWith("settings-before-import-"));
    expect(beepersBackupName).toBeDefined();
    expect(
      JSON.parse(await fs.readFile(path.join(profileRoot, "backups", beepersBackupName!), "utf8"))
    ).toEqual({ version: "1.0.0", records: [], importedRecords: [] });
    expect(settingsBackupName).toBeDefined();
    expect(
      JSON.parse(await fs.readFile(path.join(profileRoot, "backups", settingsBackupName!), "utf8"))
    ).toMatchObject({
      editorName: "",
      dataFilePath: path.join(profileRoot, "data", "contacts.json"),
      backupDirectoryPath: path.join(profileRoot, "backups"),
      managedPaths: { dataFilePath: true, backupDirectoryPath: true }
    });
    expect(
      JSON.parse(await fs.readFile(path.join(profileRoot, "data", "beepers.json"), "utf8"))
    ).toMatchObject({ importedRecords: [{ deviceNumber: "7182" }] });
    expect(settings.kind).toBe("settings-import");
    if (settings.kind === "settings-import") {
      expect(settings.settings.dataFilePath).toBe(path.join(profileRoot, "data", "contacts.json"));
      expect(settings.settings.backupDirectoryPath).toBe(path.join(profileRoot, "backups"));
    }
    expect((await service.listBackups()).every((backup) =>
      backup.fileName.startsWith("contacts-") || backup.fileName.startsWith("auto-backup-")
    )).toBe(true);
  });

  it("rejects unknown JSON with a clear domain error", async () => {
    const unknownPath = path.join(fixtureRoot, "unknown.json");
    await fs.writeFile(unknownPath, JSON.stringify({ version: "unknown" }));
    const { AppDataService } = await import("./app-data.service.js");
    const service = new AppDataService();
    await service.ensureInitialFiles();

    await expect(service.importJsonFile(unknownPath)).rejects.toThrow(
      "El JSON no es una agenda, un archivo de buscas ni una configuración válida de HospiAgenda."
    );
  });

  it.runIf(process.platform !== "win32")("rejects a symlinked beeper backup directory", async () => {
    const beepersPath = path.join(fixtureRoot, "beepers.json");
    await fs.writeFile(
      beepersPath,
      JSON.stringify({ version: "1.0.0", records: [], importedRecords: [] })
    );
    const { AppDataService } = await import("./app-data.service.js");
    const { BeepersService } = await import("./beeper.service.js");
    const service = new AppDataService({ beepersService: new BeepersService() });
    await service.ensureInitialFiles();

    const backupPath = path.join(testRoot, "profile", "backups");
    const outsidePath = path.join(testRoot, "outside");
    await fs.mkdir(outsidePath);
    await fs.rm(backupPath, { recursive: true });
    await fs.symlink(outsidePath, backupPath);

    await expect(service.importJsonFile(beepersPath)).rejects.toThrow("No se permiten enlaces simbólicos");
    expect(await fs.readdir(outsidePath)).toEqual([]);
  });

  it("retains only the configured number of beeper import backups", async () => {
    const beepersPath = path.join(fixtureRoot, "beepers.json");
    await fs.writeFile(
      beepersPath,
      JSON.stringify({ version: "1.0.0", records: [], importedRecords: [] })
    );
    const { AppDataService } = await import("./app-data.service.js");
    const { BeepersService } = await import("./beeper.service.js");
    const service = new AppDataService({ beepersService: new BeepersService() });
    await service.ensureInitialFiles();
    const defaults = service.getEditableSettingsDefaults();
    await service.saveSettings({
      ...defaults,
      ui: {
        ...defaults.ui,
        autoBackup: { ...defaults.ui.autoBackup, retentionCount: 2 }
      }
    });

    await service.importJsonFile(beepersPath);
    await service.importJsonFile(beepersPath);
    await service.importJsonFile(beepersPath);

    const backupNames = await fs.readdir(path.join(testRoot, "profile", "backups"));
    expect(backupNames.filter((name) => name.startsWith("beepers-before-import-"))).toHaveLength(2);
  });
});
