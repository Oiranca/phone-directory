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

  it("imports a validated combined envelope after backing up both stores", async () => {
    const profileRoot = path.join(testRoot, "profile");
    const combinedPath = path.join(fixtureRoot, "combined.json");
    const importedContacts = {
      ...defaultContacts,
      records: [{ ...defaultContacts.records[0]!, displayName: "Agenda combinada" }],
      metadata: { ...defaultContacts.metadata, recordCount: 1 }
    };
    const importedBeepers = {
      version: "1.0.0" as const,
      records: [],
      importedRecords: [{
        id: "ibsc_aabbccdd",
        deviceNumber: "7182",
        department: "Esterilización",
        sourceSheet: "Buscas Todos",
        sourceRow: 2
      }]
    };
    await fs.writeFile(combinedPath, JSON.stringify({
      format: "hospiagenda-data",
      version: "1.0.0",
      exportedAt: "2026-08-27T10:00:00.000Z",
      contacts: importedContacts,
      beepers: importedBeepers
    }));

    const { AppDataService } = await import("./app-data.service.js");
    const { BeepersService } = await import("./beeper.service.js");
    const service = new AppDataService({ beepersService: new BeepersService() });
    await service.ensureInitialFiles();

    const result = await service.importJsonFile(combinedPath);

    expect(result.kind).toBe("combined-import");
    expect(JSON.parse(await fs.readFile(path.join(profileRoot, "data", "contacts.json"), "utf8")))
      .toMatchObject({ records: [{ displayName: "Agenda combinada" }] });
    expect(JSON.parse(await fs.readFile(path.join(profileRoot, "data", "beepers.json"), "utf8")))
      .toEqual(importedBeepers);
    const backupNames = await fs.readdir(path.join(profileRoot, "backups"));
    expect(backupNames.some((name) => name.startsWith("contacts-"))).toBe(true);
    expect(backupNames.some((name) => name.startsWith("beepers-before-import-"))).toBe(true);
  });

  it("rejects an invalid combined envelope before changing either store", async () => {
    const profileRoot = path.join(testRoot, "profile");
    const combinedPath = path.join(fixtureRoot, "invalid-combined.json");
    await fs.writeFile(combinedPath, JSON.stringify({
      format: "hospiagenda-data",
      version: "1.0.0",
      exportedAt: "2026-08-27T10:00:00.000Z",
      contacts: { ...defaultContacts, records: [{ invalid: true }] },
      beepers: { version: "1.0.0", records: [], importedRecords: [] }
    }));

    const { AppDataService } = await import("./app-data.service.js");
    const { BeepersService } = await import("./beeper.service.js");
    const service = new AppDataService({ beepersService: new BeepersService() });
    await service.ensureInitialFiles();
    const contactsBefore = await fs.readFile(path.join(profileRoot, "data", "contacts.json"), "utf8");

    await expect(service.importJsonFile(combinedPath)).rejects.toThrow("El JSON no es un archivo combinado");
    expect(await fs.readFile(path.join(profileRoot, "data", "contacts.json"), "utf8")).toBe(contactsBefore);
    await expect(fs.readFile(path.join(profileRoot, "data", "beepers.json"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    expect(await fs.readdir(path.join(profileRoot, "backups"))).toEqual([]);
  });

  it("leaves both stores unchanged when the contacts backup fails", async () => {
    const profileRoot = path.join(testRoot, "profile");
    const combinedPath = path.join(fixtureRoot, "combined-backup-failure.json");
    await fs.writeFile(combinedPath, JSON.stringify({
      format: "hospiagenda-data",
      version: "1.0.0",
      exportedAt: "2026-08-27T10:00:00.000Z",
      contacts: { ...defaultContacts, records: [] },
      beepers: { version: "1.0.0", records: [], importedRecords: [{
        id: "ibsc_aabbccdd",
        deviceNumber: "7182",
        department: "Esterilización",
        sourceSheet: "Buscas Todos",
        sourceRow: 2
      }] }
    }));

    const { AppDataService } = await import("./app-data.service.js");
    const { BeepersService } = await import("./beeper.service.js");
    const beepersService = new BeepersService();
    const service = new AppDataService({ beepersService });
    await service.ensureInitialFiles();
    const contactsBefore = await fs.readFile(path.join(profileRoot, "data", "contacts.json"), "utf8");
    const copySpy = vi.spyOn(fs, "copyFile").mockRejectedValueOnce(Object.assign(new Error("EACCES"), { code: "EACCES" }));

    await expect(service.importJsonFile(combinedPath)).rejects.toThrow("No se pudo crear la copia");
    expect(copySpy).toHaveBeenCalledTimes(1);
    expect(await fs.readFile(path.join(profileRoot, "data", "contacts.json"), "utf8")).toBe(contactsBefore);
    expect(await beepersService.list()).toEqual([]);
    expect(await beepersService.listImported()).toEqual([]);
  });

  it("restores beepers when replacing contacts fails after both backups", async () => {
    const profileRoot = path.join(testRoot, "profile");
    const combinedPath = path.join(fixtureRoot, "combined-contacts-write-failure.json");
    await fs.writeFile(combinedPath, JSON.stringify({
      format: "hospiagenda-data",
      version: "1.0.0",
      exportedAt: "2026-08-27T10:00:00.000Z",
      contacts: { ...defaultContacts, records: [] },
      beepers: { version: "1.0.0", records: [], importedRecords: [{
        id: "ibsc_aabbccdd",
        deviceNumber: "7182",
        department: "Esterilización",
        sourceSheet: "Buscas Todos",
        sourceRow: 2
      }] }
    }));

    const { AppDataService } = await import("./app-data.service.js");
    const { BeepersService } = await import("./beeper.service.js");
    const beepersService = new BeepersService();
    const service = new AppDataService({ beepersService });
    await service.ensureInitialFiles();
    const contactsPath = path.join(profileRoot, "data", "contacts.json");
    const contactsBefore = await fs.readFile(contactsPath, "utf8");
    const rename = fs.rename.bind(fs);
    const renameSpy = vi.spyOn(fs, "rename").mockImplementation(async (source, destination) => {
      if (path.basename(String(destination)) === "contacts.json") {
        throw Object.assign(new Error("EACCES"), { code: "EACCES" });
      }
      return rename(source, destination);
    });

    await expect(service.importJsonFile(combinedPath)).rejects.toThrow(
      "No se pudo escribir el archivo de datos configurado"
    );
    expect(renameSpy).toHaveBeenCalled();
    renameSpy.mockRestore();
    expect(await fs.readFile(contactsPath, "utf8")).toBe(contactsBefore);
    expect(await beepersService.list()).toEqual([]);
    expect(await beepersService.listImported()).toEqual([]);
  });

  it("rejects unknown JSON with a clear domain error", async () => {
    const unknownPath = path.join(fixtureRoot, "unknown.json");
    await fs.writeFile(unknownPath, JSON.stringify({ version: "unknown" }));
    const { AppDataService } = await import("./app-data.service.js");
    const service = new AppDataService();
    await service.ensureInitialFiles();

    await expect(service.importJsonFile(unknownPath)).rejects.toThrow(
      "El JSON no es un archivo combinado, una agenda, un archivo de buscas ni una configuración válida de HospiAgenda."
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
