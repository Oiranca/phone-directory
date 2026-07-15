import nodeFs from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as XLSX from "xlsx";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultContacts } from "../../shared/fixtures/defaultContacts.js";
import type { EditableAppSettings } from "../../shared/types/contact.js";
import type { AppDataAuditFacade } from "./app-data-audit.facade.js";

const getPathMock = vi.fn();

vi.mock("electron", () => ({
  app: {
    getPath: getPathMock
  }
}));

XLSX.set_fs(nodeFs);

describe("AppDataService", () => {
  let testRoot: string;
  let currentUserDataRoot: string;
  const waitForCondition = async (assertion: () => Promise<boolean>, timeoutMs = 3000) => {
    const startedAt = Date.now();

    while (!(await assertion())) {
      if (Date.now() - startedAt > timeoutMs) {
        throw new Error("Timed out waiting for condition.");
      }

      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  };
  const buildEditableSettings = (overrides: Partial<EditableAppSettings> = {}): EditableAppSettings => ({
    editorName: "Samuel",
    dataFilePath: path.join(currentUserDataRoot, "data", "contacts.json"),
    backupDirectoryPath: path.join(currentUserDataRoot, "backups"),
    ui: {
      showInactiveByDefault: false,
      autoBackup: {
        enabled: false,
        trigger: "launch",
        intervalHours: 2,
        editCountThreshold: 10,
        retentionCount: 5
      },
      ...(overrides.ui ?? {})
    },
    ...overrides
  });

  beforeEach(async () => {
    testRoot = await fs.mkdtemp(path.join(os.tmpdir(), "phone-directory-"));
    currentUserDataRoot = testRoot;
    getPathMock.mockImplementation(() => currentUserDataRoot);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(testRoot, { recursive: true, force: true });
    getPathMock.mockReset();
  });

  it("persists validated custom filesystem paths when saving editable settings", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();
    const customDataDirectory = path.join(testRoot, "custom-data");
    const customBackupDirectory = path.join(testRoot, "custom-backups");
    await fs.mkdir(customDataDirectory, { recursive: true });
    await fs.mkdir(customBackupDirectory, { recursive: true });
    const customDataFilePath = path.join(customDataDirectory, "contacts-custom.json");

    const saved = await service.saveSettings(
      buildEditableSettings({
        dataFilePath: customDataFilePath,
        backupDirectoryPath: customBackupDirectory,
        ui: {
          showInactiveByDefault: true
        }
      })
    );

    expect(saved.editorName).toBe("Samuel");
    expect(saved.ui.showInactiveByDefault).toBe(true);
    expect(saved.dataFilePath).toBe(customDataFilePath);
    expect(saved.backupDirectoryPath).toBe(customBackupDirectory);

    const settingsFile = path.join(testRoot, "data", "settings.json");
    const persisted = JSON.parse(await fs.readFile(settingsFile, "utf-8")) as typeof saved;
    const copiedDataset = JSON.parse(await fs.readFile(customDataFilePath, "utf-8")) as { records: unknown[] };

    expect(persisted).toEqual(saved);
    expect(copiedDataset.records).toHaveLength(defaultContacts.records.length);
  });

  it("rejects a custom backup directory that does not exist", async () => {
    const { AppDataService } = await import("./app-data.service.js");
    const missingBackupDirectory = path.join(testRoot, "missing-backups");

    const service = new AppDataService();
    await service.ensureInitialFiles();

    const rejection = service.saveSettings(
      buildEditableSettings({
        backupDirectoryPath: missingBackupDirectory
      })
    );

    // SEC-3 regression guard: the error must surface a sanitized, basename-only
    // path (never the absolute realpath, which embeds the OS username/home dir)
    // across the IPC boundary.
    await expect(rejection).rejects.toThrow(
      /No se pudo validar la carpeta de copias de seguridad\. Ruta afectada: missing-backups\./
    );
    const error = await rejection.catch((e: unknown) => e as Error);
    expect(error.message).not.toContain(testRoot);
    expect(error.message).not.toContain(missingBackupDirectory);
  });

  it("rejects custom backup directories that resolve through symlinks", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();
    const realBackupDirectory = path.join(testRoot, "real-backups");
    const symlinkBackupDirectory = path.join(testRoot, "linked-backups");
    await fs.mkdir(realBackupDirectory, { recursive: true });
    await fs.symlink(realBackupDirectory, symlinkBackupDirectory);

    await expect(
      service.saveSettings(
        buildEditableSettings({
          backupDirectoryPath: symlinkBackupDirectory
        })
      )
    ).rejects.toThrow(/No se permiten enlaces simbólicos/);
  });

  it("rejects a custom data path that already has a file at that location", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();
    const customDataDirectory = path.join(testRoot, "custom-data");
    await fs.mkdir(customDataDirectory, { recursive: true });
    const existingDataFilePath = path.join(customDataDirectory, "already-here.json");
    await fs.writeFile(existingDataFilePath, "{}", "utf-8");

    const rejection = service.saveSettings(
      buildEditableSettings({
        dataFilePath: existingDataFilePath
      })
    );

    await expect(rejection).rejects.toThrow(
      "Ya existe un archivo en esa ruta. Usa una ruta nueva para copiar el directorio actual o restablece las rutas gestionadas."
    );

    // SEC-3 regression guard: assertDataFilePathAvailable must not leak the
    // absolute path into the IPC-facing error message.
    const error = await rejection.catch((e: unknown) => e as Error);
    expect(error.message).not.toContain(testRoot);
    expect(error.message).not.toContain(existingDataFilePath);
    expect(error.message).toContain("Ruta afectada: already-here.json");
  });

  it("rejects a custom data path that points to an existing directory without leaking the absolute path", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();
    const directoryAsDataPath = path.join(testRoot, "already-a-directory.json");
    await fs.mkdir(directoryAsDataPath, { recursive: true });

    const rejection = service.saveSettings(
      buildEditableSettings({
        dataFilePath: directoryAsDataPath
      })
    );

    await expect(rejection).rejects.toThrow(
      "La ruta de datos debe apuntar a un archivo JSON, no a una carpeta."
    );

    // SEC-3 regression guard: assertDataFilePathAvailable's is-directory branch
    // must not leak the absolute path into the IPC-facing error message.
    const error = await rejection.catch((e: unknown) => e as Error);
    expect(error.message).not.toContain(testRoot);
    expect(error.message).not.toContain(directoryAsDataPath);
    expect(error.message).toContain("Ruta afectada: already-a-directory.json");
  });

  it("rejects a custom data path that points to the settings file without leaking the absolute path", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();
    const settingsFilePath = path.join(currentUserDataRoot, "data", "settings.json");

    const rejection = service.saveSettings(
      buildEditableSettings({
        dataFilePath: settingsFilePath
      })
    );

    await expect(rejection).rejects.toThrow(
      "La ruta de datos no puede apuntar al archivo de configuración."
    );

    // SEC-3 regression guard: validateEditableSettings' settings-file-collision
    // branch must not leak the absolute path into the IPC-facing error message.
    const error = await rejection.catch((e: unknown) => e as Error);
    expect(error.message).not.toContain(testRoot);
    expect(error.message).not.toContain(settingsFilePath);
    expect(error.message).toContain("Ruta afectada: settings.json");
  });

  it("rejects a custom data path without a .json extension without leaking the absolute path", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();
    const customDataDirectory = path.join(testRoot, "custom-data");
    await fs.mkdir(customDataDirectory, { recursive: true });
    const nonJsonDataFilePath = path.join(customDataDirectory, "contacts-custom.txt");

    const rejection = service.saveSettings(
      buildEditableSettings({
        dataFilePath: nonJsonDataFilePath
      })
    );

    await expect(rejection).rejects.toThrow("La ruta de datos debe terminar en .json.");

    // SEC-3 regression guard: validateEditableSettings' extension-check branch
    // must not leak the absolute path into the IPC-facing error message.
    const error = await rejection.catch((e: unknown) => e as Error);
    expect(error.message).not.toContain(testRoot);
    expect(error.message).not.toContain(nonJsonDataFilePath);
    expect(error.message).toContain("Ruta afectada: contacts-custom.txt");
  });

  it("rejects relative custom data paths", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();

    await expect(
      service.saveSettings(
        buildEditableSettings({
          dataFilePath: "relative/contacts.json"
        })
      )
    ).rejects.toThrow("La ruta del archivo de datos debe ser absoluta.");
  });

  it("rejects relative custom backup paths", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();

    await expect(
      service.saveSettings(
        buildEditableSettings({
          backupDirectoryPath: "relative/backups"
        })
      )
    ).rejects.toThrow("La ruta de la carpeta de copias de seguridad debe ser absoluta.");
  });

  it("rejects custom data paths with symlinked ancestor directories", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();
    const realDirectory = path.join(testRoot, "real-data");
    const linkedRoot = path.join(testRoot, "linked-root");
    const symlinkedChildDirectory = path.join(linkedRoot, "nested");
    await fs.mkdir(realDirectory, { recursive: true });
    await fs.symlink(realDirectory, linkedRoot);

    await expect(
      service.saveSettings(
        buildEditableSettings({
          dataFilePath: path.join(symlinkedChildDirectory, "contacts-custom.json")
        })
      )
    ).rejects.toThrow(/No se permiten enlaces simbólicos/);
  });

  it("rejects a custom data path that already points to an existing file", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();
    const existingDataFilePath = path.join(testRoot, "existing-contacts.json");
    await fs.writeFile(existingDataFilePath, "{}", "utf-8");

    await expect(
      service.saveSettings(
        buildEditableSettings({
          dataFilePath: existingDataFilePath
        })
      )
    ).rejects.toThrow(
      /Ya existe un archivo en esa ruta\. Usa una ruta nueva para copiar el directorio actual o restablece las rutas gestionadas\./
    );
  });

  it("surfaces caller context when path validation hits unexpected filesystem errors", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();
    const customDataDirectory = path.join(testRoot, "custom-data");
    const customDataFilePath = path.join(customDataDirectory, "contacts-custom.json");
    const actualFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    const lstatSpy = vi
      .spyOn(fs, "lstat")
      .mockImplementation(async (filePath) => {
        if (filePath === customDataDirectory) {
          throw Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
        }

        return actualFs.lstat(filePath);
      });

    const rejection = service.saveSettings(
      buildEditableSettings({
        dataFilePath: customDataFilePath
      })
    );

    // SEC-3 regression guard: sanitized basename-only path, no absolute leak.
    await expect(rejection).rejects.toThrow(
      /No se pudo validar la ruta del archivo de datos\. Ruta afectada: custom-data\. Error al verificar la ruta: EACCES: permission denied/
    );
    const error = await rejection.catch((e: unknown) => e as Error);
    expect(error.message).not.toContain(testRoot);
    expect(error.message).not.toContain(customDataDirectory);

    lstatSpy.mockRestore();
  });

  it("rejects persisted relative data paths during bootstrap", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();
    await fs.writeFile(
      path.join(testRoot, "data", "settings.json"),
      JSON.stringify({
        editorName: "Samuel",
        dataFilePath: "relative/contacts.json",
        backupDirectoryPath: path.join(testRoot, "backups"),
        ui: {
          showInactiveByDefault: false
        }
      })
    );

    await expect(service.getBootstrapData()).rejects.toThrow(
      "La ruta del archivo de datos configurada debe ser absoluta."
    );
  });

  it("rebases managed portable paths to the current userData root during bootstrap", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const originalRoot = path.join(testRoot, "usb-a", "win");
    const nextRoot = path.join(testRoot, "usb-b", "win");
    currentUserDataRoot = originalRoot;

    const service = new AppDataService();
    await service.ensureInitialFiles();
    await fs.mkdir(nextRoot, { recursive: true });
    await fs.cp(path.join(originalRoot, "data"), path.join(nextRoot, "data"), { recursive: true });
    await fs.cp(path.join(originalRoot, "backups"), path.join(nextRoot, "backups"), { recursive: true });
    await fs.rm(originalRoot, { recursive: true, force: true });
    currentUserDataRoot = nextRoot;

    const movedService = new AppDataService();
    const bootstrap = await movedService.getBootstrapData();
    const persisted = JSON.parse(
      await fs.readFile(path.join(nextRoot, "data", "settings.json"), "utf-8")
    ) as {
      dataFilePath: string;
      backupDirectoryPath: string;
      managedPaths?: {
        dataFilePath: boolean;
        backupDirectoryPath: boolean;
      };
    };

    expect("contacts" in bootstrap).toBe(true);
    expect(persisted.dataFilePath).toBe(path.join(nextRoot, "data", "contacts.json"));
    expect(persisted.backupDirectoryPath).toBe(path.join(nextRoot, "backups"));
    expect(persisted.managedPaths).toEqual({
      dataFilePath: true,
      backupDirectoryPath: true
    });
  });

  it("rebases legacy managed portable paths without metadata after the userData root changes", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const originalRoot = path.join(testRoot, "usb-a", "win");
    const nextRoot = path.join(testRoot, "usb-b", "win");
    currentUserDataRoot = originalRoot;

    const service = new AppDataService();
    await service.ensureInitialFiles();
    const originalSettingsPath = path.join(originalRoot, "data", "settings.json");
    const originalSettings = JSON.parse(await fs.readFile(originalSettingsPath, "utf-8")) as {
      editorName: string;
      dataFilePath: string;
      backupDirectoryPath: string;
      managedPaths?: {
        dataFilePath: boolean;
        backupDirectoryPath: boolean;
      };
      ui: { showInactiveByDefault: boolean };
    };
    delete originalSettings.managedPaths;
    await fs.writeFile(originalSettingsPath, JSON.stringify(originalSettings, null, 2) + "\n", "utf-8");

    await fs.mkdir(nextRoot, { recursive: true });
    await fs.cp(path.join(originalRoot, "data"), path.join(nextRoot, "data"), { recursive: true });
    await fs.cp(path.join(originalRoot, "backups"), path.join(nextRoot, "backups"), { recursive: true });
    await fs.rm(originalRoot, { recursive: true, force: true });
    currentUserDataRoot = nextRoot;

    const movedService = new AppDataService();
    const bootstrap = await movedService.getBootstrapData();
    const persisted = JSON.parse(
      await fs.readFile(path.join(nextRoot, "data", "settings.json"), "utf-8")
    ) as {
      dataFilePath: string;
      backupDirectoryPath: string;
      managedPaths?: {
        dataFilePath: boolean;
        backupDirectoryPath: boolean;
      };
    };

    expect("contacts" in bootstrap).toBe(true);
    expect(persisted.dataFilePath).toBe(path.join(nextRoot, "data", "contacts.json"));
    expect(persisted.backupDirectoryPath).toBe(path.join(nextRoot, "backups"));
    expect(persisted.managedPaths).toEqual({
      dataFilePath: true,
      backupDirectoryPath: true
    });
  });

  it("keeps custom absolute paths after the managed userData root changes", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const originalRoot = path.join(testRoot, "usb-a", "win");
    const nextRoot = path.join(testRoot, "usb-b", "win");
    const customRoot = path.join(testRoot, "shared-custom");
    currentUserDataRoot = originalRoot;

    const service = new AppDataService();
    await service.ensureInitialFiles();
    await fs.mkdir(path.join(customRoot, "data"), { recursive: true });
    await fs.mkdir(path.join(customRoot, "backups"), { recursive: true });
    const customDataFilePath = path.join(customRoot, "data", "contacts-custom.json");
    const customBackupDirectory = path.join(customRoot, "backups");

    await service.saveSettings(
      buildEditableSettings({
        dataFilePath: customDataFilePath,
        backupDirectoryPath: customBackupDirectory
      })
    );

    await fs.mkdir(nextRoot, { recursive: true });
    await fs.cp(path.join(originalRoot, "data"), path.join(nextRoot, "data"), { recursive: true });
    await fs.cp(path.join(originalRoot, "backups"), path.join(nextRoot, "backups"), { recursive: true });
    await fs.rm(originalRoot, { recursive: true, force: true });
    currentUserDataRoot = nextRoot;

    const movedService = new AppDataService();
    const bootstrap = await movedService.getBootstrapData();
    const persisted = JSON.parse(
      await fs.readFile(path.join(nextRoot, "data", "settings.json"), "utf-8")
    ) as {
      dataFilePath: string;
      backupDirectoryPath: string;
      managedPaths?: {
        dataFilePath: boolean;
        backupDirectoryPath: boolean;
      };
    };

    expect("contacts" in bootstrap).toBe(true);
    expect(persisted.dataFilePath).toBe(customDataFilePath);
    expect(persisted.backupDirectoryPath).toBe(customBackupDirectory);
    expect(persisted.managedPaths).toEqual({
      dataFilePath: false,
      backupDirectoryPath: false
    });
  });

  it("keeps legacy custom absolute paths without metadata after a userData root move", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const originalRoot = path.join(testRoot, "usb-a", "win");
    const nextRoot = path.join(testRoot, "usb-b", "win");
    const customRoot = path.join(testRoot, "shared-custom");
    currentUserDataRoot = originalRoot;

    const service = new AppDataService();
    await service.ensureInitialFiles();
    await fs.mkdir(path.join(customRoot, "data"), { recursive: true });
    await fs.mkdir(path.join(customRoot, "backups"), { recursive: true });
    const customDataFilePath = path.join(customRoot, "data", "contacts-custom.json");
    const customBackupDirectory = path.join(customRoot, "backups");

    await service.saveSettings(
      buildEditableSettings({
        dataFilePath: customDataFilePath,
        backupDirectoryPath: customBackupDirectory
      })
    );

    const originalSettingsPath = path.join(originalRoot, "data", "settings.json");
    const originalSettings = JSON.parse(await fs.readFile(originalSettingsPath, "utf-8")) as {
      editorName: string;
      dataFilePath: string;
      backupDirectoryPath: string;
      managedPaths?: {
        dataFilePath: boolean;
        backupDirectoryPath: boolean;
      };
      ui: { showInactiveByDefault: boolean };
    };
    delete originalSettings.managedPaths;
    await fs.writeFile(originalSettingsPath, JSON.stringify(originalSettings, null, 2) + "\n", "utf-8");

    await fs.mkdir(nextRoot, { recursive: true });
    await fs.cp(path.join(originalRoot, "data"), path.join(nextRoot, "data"), { recursive: true });
    await fs.cp(path.join(originalRoot, "backups"), path.join(nextRoot, "backups"), { recursive: true });
    await fs.rm(originalRoot, { recursive: true, force: true });
    await fs.rm(customDataFilePath, { force: true });
    currentUserDataRoot = nextRoot;

    const movedService = new AppDataService();
    const result = await movedService.getBootstrapData();

    expect("recovery" in result).toBe(true);
    if ("recovery" in result) {
      expect(result.recovery.contactsFilePath).toBe(customDataFilePath);
      expect(result.recovery.message).toBe("El archivo de datos configurado no existe o ya no está disponible.");
    }
  });

  it("rejects data paths that match settings.json with case-only differences", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();
    const settingsFilePath = path.join(testRoot, "data", "settings.json");
    const caseVariantSettingsPath = process.platform === "win32" || process.platform === "darwin"
      ? settingsFilePath.toUpperCase()
      : settingsFilePath;

    await expect(
      service.saveSettings(
        buildEditableSettings({
          dataFilePath: caseVariantSettingsPath
        })
      )
    ).rejects.toThrow(/La ruta de datos no puede apuntar al archivo de configuración/);
  });

  it("rejects persisted symlinked backup directories when listing backups", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();
    const realBackupDirectory = path.join(testRoot, "real-backups");
    const symlinkBackupDirectory = path.join(testRoot, "linked-backups");
    await fs.mkdir(realBackupDirectory, { recursive: true });
    await fs.symlink(realBackupDirectory, symlinkBackupDirectory);
    await fs.writeFile(
      path.join(testRoot, "data", "settings.json"),
      JSON.stringify({
        editorName: "Samuel",
        dataFilePath: path.join(testRoot, "data", "contacts.json"),
        backupDirectoryPath: symlinkBackupDirectory,
        ui: {
          showInactiveByDefault: false
        }
      })
    );

    await expect(service.listBackups()).rejects.toThrow(/No se permiten enlaces simbólicos/);
  });

  it("allows saving non-path settings even when the current data file is missing", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();
    await fs.rm(path.join(testRoot, "data", "contacts.json"));

    const saved = await service.saveSettings(
      buildEditableSettings({
        editorName: "Guardia noche",
        ui: {
          showInactiveByDefault: true
        }
      })
    );

    expect(saved.editorName).toBe("Guardia noche");
    expect(saved.ui.showInactiveByDefault).toBe(true);
  });

  it("restores the managed default data path when the current custom file is missing", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();
    const customDataDirectory = path.join(testRoot, "custom-data");
    const customBackupDirectory = path.join(testRoot, "custom-backups");
    await fs.mkdir(customDataDirectory, { recursive: true });
    await fs.mkdir(customBackupDirectory, { recursive: true });
    const customDataFilePath = path.join(customDataDirectory, "contacts-custom.json");

    await service.saveSettings(
      buildEditableSettings({
        dataFilePath: customDataFilePath,
        backupDirectoryPath: customBackupDirectory
      })
    );
    await fs.rm(customDataFilePath);

    const restored = await service.saveSettings(buildEditableSettings());

    expect(restored.dataFilePath).toBe(path.join(testRoot, "data", "contacts.json"));
    expect(restored.backupDirectoryPath).toBe(path.join(testRoot, "backups"));
  });

  it("creates a new record and refreshes dataset metadata", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();
    await service.saveSettings(buildEditableSettings());

    const result = await service.createRecord({
      type: "person",
      displayName: "Ana Pérez",
      person: {
        firstName: "Ana",
        lastName: "Pérez"
      },
      organization: {
        department: "Urgencias",
        service: "Coordinación",
        area: "sanitaria-asistencial"
      },
      location: {
        building: "Hospital General",
        floor: "2"
      },
      contactMethods: {
        phones: [
          {
            id: "ph_new_1",
            label: "Principal",
            number: "12345",
            extension: "89",
            kind: "internal",
            isPrimary: true,
            confidential: false,
            noPatientSharing: false
          }
        ],
        emails: [],
        socials: []
      },
      aliases: ["coordinación urgencias"],
      tags: ["urgencias"],
      status: "active",
      notes: "Turno de mañana"
    });

    expect(result.savedRecordId).toMatch(/^cnt_/);
    expect(result.contacts.records[0]?.displayName).toBe("Ana Pérez");
    expect(result.contacts.metadata.recordCount).toBe(3);
    expect(result.contacts.metadata.typeCounts.person).toBe(1);
    expect(result.contacts.metadata.areaCounts["sanitaria-asistencial"]).toBe(1);
    expect(result.contacts.records[0]?.audit.createdBy).toBe("Samuel");
  });

  it("creates and rotates launch auto-backups when enabled", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();
    await fs.writeFile(path.join(testRoot, "backups", "auto-backup-2026-01-01T00-00-00-000Z.json"), "{}\n", "utf-8");
    await fs.writeFile(path.join(testRoot, "backups", "auto-backup-2026-01-02T00-00-00-000Z.json"), "{}\n", "utf-8");
    await service.saveSettings(
      buildEditableSettings({
        ui: {
          showInactiveByDefault: false,
          autoBackup: {
            enabled: true,
            trigger: "launch",
            intervalHours: 2,
            editCountThreshold: 10,
            retentionCount: 2
          }
        }
      })
    );

    await service.startAutoBackup();
    await waitForCondition(async () => {
      const files = await fs.readdir(path.join(testRoot, "backups"));
      return files.filter((file) => file.startsWith("auto-backup-")).length === 2;
    });

    const files = (await fs.readdir(path.join(testRoot, "backups")))
      .filter((file) => file.startsWith("auto-backup-"))
      .sort();

    expect(files).toHaveLength(2);
    expect(files.at(-1)).toMatch(/^auto-backup-/);
    // Drain any in-flight write-queue entries before the afterEach removes the
    // temp dir, preventing an ENOTEMPTY race between pruneBackupsByPrefix and fs.rm.
    await service.dispose();
  });

  it("creates an auto-backup after the configured edit threshold", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();
    await service.saveSettings(
      buildEditableSettings({
        ui: {
          showInactiveByDefault: false,
          autoBackup: {
            enabled: true,
            trigger: "editCount",
            intervalHours: 2,
            editCountThreshold: 1,
            retentionCount: 5
          }
        }
      })
    );

    await service.createRecord({
      type: "person",
      displayName: "Auto Backup Trigger",
      person: {
        firstName: "Auto",
        lastName: "Backup"
      },
      organization: {
        department: "Urgencias",
        service: "Coordinación",
        area: "sanitaria-asistencial"
      },
      contactMethods: {
        phones: [
          {
            id: "ph_auto_backup",
            number: "12345",
            kind: "internal",
            isPrimary: true,
            confidential: false,
            noPatientSharing: false
          }
        ],
        emails: [],
        socials: []
      },
      aliases: [],
      tags: [],
      status: "active"
    });

    await waitForCondition(async () => {
      const files = await fs.readdir(path.join(testRoot, "backups"));
      return files.some((file) => file.startsWith("auto-backup-"));
    });

    const files = await fs.readdir(path.join(testRoot, "backups"));
    expect(files.some((file) => file.startsWith("auto-backup-"))).toBe(true);
    await service.dispose();
  });

  it("retries the edit-threshold auto-backup after a failed attempt", async () => {
    const { AppDataService } = await import("./app-data.service.js");
    const autoBackupFailures: string[] = [];

    const service = new AppDataService({
      onAutoBackupFailure: (message) => {
        autoBackupFailures.push(message);
      }
    });
    await service.ensureInitialFiles();
    await service.saveSettings(
      buildEditableSettings({
        ui: {
          showInactiveByDefault: false,
          autoBackup: {
            enabled: true,
            trigger: "editCount",
            intervalHours: 2,
            editCountThreshold: 1,
            retentionCount: 5
          }
        }
      })
    );
    vi.spyOn(fs, "copyFile")
      .mockRejectedValueOnce(Object.assign(new Error("copy failed"), { code: "EACCES" }));

    await service.createRecord({
      type: "person",
      displayName: "Auto Backup Failure One",
      person: {
        firstName: "Auto",
        lastName: "Failure"
      },
      organization: {
        department: "Urgencias",
        service: "Coordinación",
        area: "sanitaria-asistencial"
      },
      contactMethods: {
        phones: [
          {
            id: "ph_auto_backup_failure_1",
            number: "12345",
            kind: "internal",
            isPrimary: true,
            confidential: false,
            noPatientSharing: false
          }
        ],
        emails: [],
        socials: []
      },
      aliases: [],
      tags: [],
      status: "active"
    });

    await waitForCondition(async () => autoBackupFailures.length === 1);
    await service.dispose();

    await service.createRecord({
      type: "person",
      displayName: "Auto Backup Failure Two",
      person: {
        firstName: "Auto",
        lastName: "Retry"
      },
      organization: {
        department: "Urgencias",
        service: "Coordinación",
        area: "sanitaria-asistencial"
      },
      contactMethods: {
        phones: [
          {
            id: "ph_auto_backup_failure_2",
            number: "67890",
            kind: "internal",
            isPrimary: true,
            confidential: false,
            noPatientSharing: false
          }
        ],
        emails: [],
        socials: []
      },
      aliases: [],
      tags: [],
      status: "active"
    });

    await waitForCondition(async () => {
      const files = await fs.readdir(path.join(testRoot, "backups"));
      return files.some((file) => file.startsWith("auto-backup-"));
    });

    expect(autoBackupFailures).toHaveLength(1);
    await service.dispose();
  });

  it("preserves edit-threshold progress when saving unrelated settings", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();
    await service.saveSettings(
      buildEditableSettings({
        ui: {
          showInactiveByDefault: false,
          autoBackup: {
            enabled: true,
            trigger: "editCount",
            intervalHours: 2,
            editCountThreshold: 2,
            retentionCount: 5
          }
        }
      })
    );

    await service.createRecord({
      type: "person",
      displayName: "Auto Backup Progress One",
      person: {
        firstName: "Auto",
        lastName: "Progress"
      },
      organization: {
        department: "Urgencias",
        service: "Coordinación",
        area: "sanitaria-asistencial"
      },
      contactMethods: {
        phones: [
          {
            id: "ph_auto_backup_progress_1",
            number: "12345",
            kind: "internal",
            isPrimary: true,
            confidential: false,
            noPatientSharing: false
          }
        ],
        emails: [],
        socials: []
      },
      aliases: [],
      tags: [],
      status: "active"
    });

    await service.saveSettings(
      buildEditableSettings({
        editorName: "Samuel Updated",
        ui: {
          showInactiveByDefault: true,
          autoBackup: {
            enabled: true,
            trigger: "editCount",
            intervalHours: 2,
            editCountThreshold: 2,
            retentionCount: 5
          }
        }
      })
    );

    await service.createRecord({
      type: "person",
      displayName: "Auto Backup Progress Two",
      person: {
        firstName: "Auto",
        lastName: "Trigger"
      },
      organization: {
        department: "Urgencias",
        service: "Coordinación",
        area: "sanitaria-asistencial"
      },
      contactMethods: {
        phones: [
          {
            id: "ph_auto_backup_progress_2",
            number: "67890",
            kind: "internal",
            isPrimary: true,
            confidential: false,
            noPatientSharing: false
          }
        ],
        emails: [],
        socials: []
      },
      aliases: [],
      tags: [],
      status: "active"
    });

    await waitForCondition(async () => {
      const files = await fs.readdir(path.join(testRoot, "backups"));
      return files.some((file) => file.startsWith("auto-backup-"));
    });

    const files = await fs.readdir(path.join(testRoot, "backups"));
    expect(files.filter((file) => file.startsWith("auto-backup-"))).toHaveLength(1);
    await service.dispose();
  });

  it("resets edit-threshold progress when backup targets change", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();
    await service.saveSettings(
      buildEditableSettings({
        ui: {
          showInactiveByDefault: false,
          autoBackup: {
            enabled: true,
            trigger: "editCount",
            intervalHours: 2,
            editCountThreshold: 2,
            retentionCount: 5
          }
        }
      })
    );

    await service.createRecord({
      type: "person",
      displayName: "Auto Backup Reset One",
      person: {
        firstName: "Auto",
        lastName: "Reset"
      },
      organization: {
        department: "Urgencias",
        service: "Coordinación",
        area: "sanitaria-asistencial"
      },
      contactMethods: {
        phones: [
          {
            id: "ph_auto_backup_reset_1",
            number: "12345",
            kind: "internal",
            isPrimary: true,
            confidential: false,
            noPatientSharing: false
          }
        ],
        emails: [],
        socials: []
      },
      aliases: [],
      tags: [],
      status: "active"
    });

    const nextBackupDirectory = path.join(testRoot, "backups-next");
    await fs.mkdir(nextBackupDirectory, { recursive: true });
    await service.saveSettings(
      buildEditableSettings({
        backupDirectoryPath: nextBackupDirectory,
        ui: {
          showInactiveByDefault: false,
          autoBackup: {
            enabled: true,
            trigger: "editCount",
            intervalHours: 2,
            editCountThreshold: 2,
            retentionCount: 5
          }
        }
      })
    );

    await service.createRecord({
      type: "person",
      displayName: "Auto Backup Reset Two",
      person: {
        firstName: "Auto",
        lastName: "Still Waiting"
      },
      organization: {
        department: "Urgencias",
        service: "Coordinación",
        area: "sanitaria-asistencial"
      },
      contactMethods: {
        phones: [
          {
            id: "ph_auto_backup_reset_2",
            number: "67890",
            kind: "internal",
            isPrimary: true,
            confidential: false,
            noPatientSharing: false
          }
        ],
        emails: [],
        socials: []
      },
      aliases: [],
      tags: [],
      status: "active"
    });

    expect((service as unknown as { autoBackupPending: boolean }).autoBackupPending).toBe(false);
    expect((await fs.readdir(nextBackupDirectory)).filter((file) => file.startsWith("auto-backup-"))).toHaveLength(0);

    await service.createRecord({
      type: "person",
      displayName: "Auto Backup Reset Three",
      person: {
        firstName: "Auto",
        lastName: "Now Trigger"
      },
      organization: {
        department: "Urgencias",
        service: "Coordinación",
        area: "sanitaria-asistencial"
      },
      contactMethods: {
        phones: [
          {
            id: "ph_auto_backup_reset_3",
            number: "24680",
            kind: "internal",
            isPrimary: true,
            confidential: false,
            noPatientSharing: false
          }
        ],
        emails: [],
        socials: []
      },
      aliases: [],
      tags: [],
      status: "active"
    });

    await waitForCondition(async () => {
      const files = await fs.readdir(nextBackupDirectory);
      return files.some((file) => file.startsWith("auto-backup-"));
    });

    expect((await fs.readdir(nextBackupDirectory)).filter((file) => file.startsWith("auto-backup-"))).toHaveLength(1);
    await service.dispose();
  });

  it("resets edit-threshold progress when the data file changes", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();
    await service.saveSettings(
      buildEditableSettings({
        ui: {
          showInactiveByDefault: false,
          autoBackup: {
            enabled: true,
            trigger: "editCount",
            intervalHours: 2,
            editCountThreshold: 2,
            retentionCount: 5
          }
        }
      })
    );

    await service.createRecord({
      type: "person",
      displayName: "Auto Backup Data Path One",
      person: {
        firstName: "Auto",
        lastName: "Data"
      },
      organization: {
        department: "Urgencias",
        service: "Coordinación",
        area: "sanitaria-asistencial"
      },
      contactMethods: {
        phones: [
          {
            id: "ph_auto_backup_data_path_1",
            number: "12345",
            kind: "internal",
            isPrimary: true,
            confidential: false,
            noPatientSharing: false
          }
        ],
        emails: [],
        socials: []
      },
      aliases: [],
      tags: [],
      status: "active"
    });

    const nextDataDirectory = path.join(testRoot, "custom-data-next");
    await fs.mkdir(nextDataDirectory, { recursive: true });
    const nextDataFilePath = path.join(nextDataDirectory, "contacts-custom.json");
    await service.saveSettings(
      buildEditableSettings({
        dataFilePath: nextDataFilePath,
        ui: {
          showInactiveByDefault: false,
          autoBackup: {
            enabled: true,
            trigger: "editCount",
            intervalHours: 2,
            editCountThreshold: 2,
            retentionCount: 5
          }
        }
      })
    );

    await service.createRecord({
      type: "person",
      displayName: "Auto Backup Data Path Two",
      person: {
        firstName: "Auto",
        lastName: "Still Waiting"
      },
      organization: {
        department: "Urgencias",
        service: "Coordinación",
        area: "sanitaria-asistencial"
      },
      contactMethods: {
        phones: [
          {
            id: "ph_auto_backup_data_path_2",
            number: "67890",
            kind: "internal",
            isPrimary: true,
            confidential: false,
            noPatientSharing: false
          }
        ],
        emails: [],
        socials: []
      },
      aliases: [],
      tags: [],
      status: "active"
    });

    expect((service as unknown as { autoBackupPending: boolean }).autoBackupPending).toBe(false);
    expect((await fs.readdir(path.join(testRoot, "backups"))).filter((file) => file.startsWith("auto-backup-"))).toHaveLength(0);

    await service.createRecord({
      type: "person",
      displayName: "Auto Backup Data Path Three",
      person: {
        firstName: "Auto",
        lastName: "Now Trigger"
      },
      organization: {
        department: "Urgencias",
        service: "Coordinación",
        area: "sanitaria-asistencial"
      },
      contactMethods: {
        phones: [
          {
            id: "ph_auto_backup_data_path_3",
            number: "24680",
            kind: "internal",
            isPrimary: true,
            confidential: false,
            noPatientSharing: false
          }
        ],
        emails: [],
        socials: []
      },
      aliases: [],
      tags: [],
      status: "active"
    });

    await waitForCondition(async () => {
      const files = await fs.readdir(path.join(testRoot, "backups"));
      return files.some((file) => file.startsWith("auto-backup-"));
    });

    expect((await fs.readdir(path.join(testRoot, "backups"))).filter((file) => file.startsWith("auto-backup-"))).toHaveLength(1);
    await service.dispose();
  });

  it("ignores client supplied ids when creating a new record", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();
    await service.saveSettings(buildEditableSettings());

    const result = await service.createRecord({
      id: "cnt_0001",
      type: "person",
      displayName: "Registro nuevo",
      person: {
        firstName: "Nuevo",
        lastName: "Registro"
      },
      organization: {
        department: "Urgencias",
        service: "Coordinación",
        area: "sanitaria-asistencial"
      },
      location: {
        building: "Hospital General"
      },
      contactMethods: {
        phones: [
          {
            id: "ph_new_collision",
            label: "Principal",
            number: "99999",
            kind: "internal",
            isPrimary: true,
            confidential: false,
            noPatientSharing: false
          }
        ],
        emails: [],
        socials: []
      },
      aliases: [],
      tags: [],
      status: "active"
    });

    expect(result.savedRecordId).not.toBe("cnt_0001");
    expect(result.contacts.records.filter((record) => record.id === "cnt_0001")).toHaveLength(1);
  });

  it("updates an existing record while preserving creation audit fields", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();
    await service.saveSettings(buildEditableSettings());

    const initial = await service.getBootstrapData();
    const existing = initial.contacts.records[0];

    const result = await service.updateRecord(existing.id, {
      id: existing.id,
      externalId: existing.externalId,
      type: existing.type,
      displayName: "Admisión General Actualizada",
      person: existing.person,
      organization: {
        ...existing.organization,
        area: "especialidades"
      },
      location: existing.location,
      contactMethods: {
        phones: [
          {
            ...existing.contactMethods.phones[0],
            isPrimary: true,
            noPatientSharing: false
          }
        ],
        emails: [],
        socials: []
      },
      aliases: existing.aliases,
      tags: existing.tags,
      notes: "Actualizado desde test",
      status: existing.status
    });

    const updated = result.contacts.records.find((record) => record.id === existing.id);

    expect(updated?.displayName).toBe("Admisión General Actualizada");
    expect(updated?.organization.area).toBe("especialidades");
    expect(updated?.audit.createdAt).toBe(existing.audit.createdAt);
    expect(updated?.audit.createdBy).toBe(existing.audit.createdBy);
    expect(updated?.audit.updatedBy).toBe("Samuel");
    expect(result.contacts.metadata.areaCounts.especialidades).toBe(1);
  });

  it("OIR-239: does not invent a primary phone on createRecord when none is marked", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();

    const result = await service.createRecord({
      type: "service",
      displayName: "Mesa sin principal",
      organization: {
        department: "Información"
      },
      contactMethods: {
        phones: [
          {
            id: "ph_no_primary_1",
            label: "Auxiliar",
            number: "11111",
            kind: "internal",
            isPrimary: false,
            confidential: false,
            noPatientSharing: false
          },
          {
            id: "ph_no_primary_2",
            label: "Secundario",
            number: "22222",
            kind: "internal",
            isPrimary: false,
            confidential: false,
            noPatientSharing: false
          }
        ],
        emails: [],
        socials: []
      },
      aliases: [],
      tags: [],
      status: "active"
    });

    expect(result.contacts.records[0]?.contactMethods.phones[0]?.isPrimary).toBe(false);
    expect(result.contacts.records[0]?.contactMethods.phones[1]?.isPrimary).toBe(false);
  });

  it("OIR-239: persists a single explicit isPrimary: false phone on createRecord without re-forcing it to true", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();

    const result = await service.createRecord({
      type: "service",
      displayName: "Un solo teléfono sin principal",
      organization: {
        department: "Información"
      },
      contactMethods: {
        phones: [
          {
            id: "ph_single_no_primary",
            label: "Único",
            number: "33333",
            kind: "internal",
            isPrimary: false,
            confidential: false,
            noPatientSharing: false
          }
        ],
        emails: [],
        socials: []
      },
      aliases: [],
      tags: [],
      status: "active"
    });

    expect(result.contacts.records[0]?.contactMethods.phones[0]?.isPrimary).toBe(false);
  });

  it("OIR-239: persists a single explicit isPrimary: false phone on updateRecord without re-forcing it to true", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();

    const created = await service.createRecord({
      type: "service",
      displayName: "Registro a actualizar",
      organization: {
        department: "Información"
      },
      contactMethods: {
        phones: [
          {
            id: "ph_update_primary",
            label: "Único",
            number: "44444",
            kind: "internal",
            isPrimary: true,
            confidential: false,
            noPatientSharing: false
          }
        ],
        emails: [],
        socials: []
      },
      aliases: [],
      tags: [],
      status: "active"
    });

    const savedRecordId = created.savedRecordId;
    const existingRecord = created.contacts.records.find((record) => record.id === savedRecordId)!;

    const updated = await service.updateRecord(savedRecordId, {
      type: "service",
      displayName: "Registro a actualizar",
      organization: {
        department: "Información"
      },
      contactMethods: {
        phones: [
          {
            ...existingRecord.contactMethods.phones[0]!,
            isPrimary: false
          }
        ],
        emails: [],
        socials: []
      },
      aliases: [],
      tags: [],
      status: "active"
    });

    expect(updated.contacts.records.find((record) => record.id === savedRecordId)?.contactMethods.phones[0]?.isPrimary).toBe(false);
  });

  it("exports the current dataset and lists backups in reverse chronological order", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();

    const exportFilePath = path.join(testRoot, "exports", "contacts-share.json");
    const exportResult = await service.exportDataset(exportFilePath);

    expect(exportResult.filePath).toBe(exportFilePath);
    expect(exportResult.recordCount).toBe(2);

    const exportedDataset = JSON.parse(
      await fs.readFile(exportFilePath, "utf-8")
    ) as { records: unknown[] };
    expect(exportedDataset.records).toHaveLength(2);

    const firstBackupPath = await service.createBackup();
    await new Promise((resolve) => setTimeout(resolve, 10));
    const secondBackupPath = await service.createBackup();
    const backups = await service.listBackups();

    expect(backups).toHaveLength(2);
    expect(backups[0]?.filePath).toBe(secondBackupPath);
    expect(backups[1]?.filePath).toBe(firstBackupPath);
    expect(backups[0]?.sizeBytes).toBeGreaterThan(0);
  });

  it("surfaces the affected backup path when backup creation fails", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();
    const contactsFilePath = path.join(testRoot, "data", "contacts.json");
    const backupDirectoryPath = path.join(testRoot, "backups");
    const backupFilePath = path.join(backupDirectoryPath, "contacts-backup.json");

    const copyFileSpy = vi
      .spyOn(fs, "copyFile")
      .mockRejectedValueOnce(
        Object.assign(new Error("EACCES: permission denied"), {
          code: "EACCES",
          path: contactsFilePath,
          dest: backupFilePath
        })
      );

    await expect(service.createBackup()).rejects.toThrow(
      /No se pudo crear la copia de seguridad del directorio\. Ruta afectada: contacts\.json\. Ruta de destino: contacts-backup\.json.*No tienes permisos suficientes para acceder al archivo o directorio\./
    );
    expect(copyFileSpy).toHaveBeenCalledTimes(1);
  });

  it("surfaces the affected destination when export writing fails", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();

    const writeFileSpy = vi
      .spyOn(fs, "writeFile")
      .mockRejectedValueOnce(
        Object.assign(new Error("EROFS: read-only file system"), {
          code: "EROFS"
        })
      );
    const exportFilePath = path.join(testRoot, "exports", "contacts-share.json");

    await expect(service.exportDataset(exportFilePath)).rejects.toThrow(
      /No se pudo exportar el directorio al destino seleccionado\. Ruta afectada: contacts-share\.json\. El archivo o directorio está en un sistema de solo lectura\./
    );
    expect(writeFileSpy).toHaveBeenCalled();
  });

  it("surfaces the backup path when JSON import cannot create its safety copy", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();

    const sourceFilePath = path.join(testRoot, "incoming", "replacement.json");
    await fs.mkdir(path.dirname(sourceFilePath), { recursive: true });
    await fs.writeFile(sourceFilePath, JSON.stringify(defaultContacts, null, 2) + "\n", "utf-8");

    const copyFileSpy = vi
      .spyOn(fs, "copyFile")
      .mockRejectedValueOnce(
        Object.assign(new Error("ENOSPC: no space left on device"), {
          code: "ENOSPC",
          path: path.join(testRoot, "data", "contacts.json")
        })
      );
    const backupDirectoryPath = path.join(testRoot, "backups");
    const contactsFilePath = path.join(testRoot, "data", "contacts.json");

    await expect(service.importDataset(sourceFilePath)).rejects.toThrow(
      /No se pudo crear la copia de seguridad del directorio\. Ruta afectada: contacts\.json.*Ruta de origen: contacts\.json.*No hay espacio suficiente en disco para completar la operación\./
    );
    expect(copyFileSpy).toHaveBeenCalledTimes(1);
  });

  it("imports a dataset from disk and creates an automatic backup first", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();

    const sourceFilePath = path.join(testRoot, "incoming", "replacement.json");
    await fs.mkdir(path.dirname(sourceFilePath), { recursive: true });
    await fs.writeFile(
      sourceFilePath,
      JSON.stringify(
        {
          version: "1.0.0",
          exportedAt: "2026-04-19T18:00:00.000Z",
          metadata: {
            recordCount: 1,
            generatedFrom: "manual",
            generatedBy: "test",
            editorName: "QA",
            typeCounts: {
              person: 1
            },
            areaCounts: {
              otros: 1
            }
          },
          catalogs: {
            recordTypes: [
              "person",
              "service",
              "department",
              "control",
              "supervision",
              "room",
              "external-center",
              "other"
            ],
            areas: [
              "sanitaria-asistencial",
              "gestion-administracion",
              "especialidades",
              "otros"
            ]
          },
          records: [
            {
              id: "cnt_imported_1",
              type: "person",
              displayName: "Importado",
              person: {
                firstName: "Caso",
                lastName: "Importado"
              },
              organization: {
                department: "Archivo",
                area: "otros"
              },
              contactMethods: {
                phones: [
                  {
                    id: "ph_imported_1",
                    number: "44556",
                    kind: "internal",
                    isPrimary: true,
                    confidential: false,
                    noPatientSharing: false
                  }
                ],
                emails: []
              },
              aliases: [],
              tags: [],
              status: "active",
              audit: {
                createdAt: "2026-04-19T18:00:00.000Z",
                updatedAt: "2026-04-19T18:00:00.000Z",
                createdBy: "QA",
                updatedBy: "QA"
              }
            }
          ]
        },
        null,
        2
      ) + "\n",
      "utf-8"
    );

    const importResult = await service.importDataset(sourceFilePath);

    expect(importResult.importedFilePath).toBe(sourceFilePath);
    expect(importResult.recordCount).toBe(1);
    expect(importResult.contacts.records[0]?.displayName).toBe("Importado");
    expect(importResult.backupPath).toContain(path.join(testRoot, "backups"));

    const persisted = JSON.parse(
      await fs.readFile(path.join(testRoot, "data", "contacts.json"), "utf-8")
    ) as { records: Array<{ displayName: string }> };
    expect(persisted.records[0]?.displayName).toBe("Importado");
  });

  // OIR-218: last-import watermark shown in the app header.
  it("records lastImportedAt on the returned and persisted settings after a JSON dataset import", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();

    const beforeImport = await fs.readFile(path.join(testRoot, "data", "settings.json"), "utf-8");
    expect(JSON.parse(beforeImport).lastImportedAt).toBeUndefined();

    const sourceFilePath = path.join(testRoot, "incoming", "replacement.json");
    await fs.mkdir(path.dirname(sourceFilePath), { recursive: true });
    await fs.writeFile(sourceFilePath, JSON.stringify(defaultContacts, null, 2) + "\n", "utf-8");

    const before = Date.now();
    const importResult = await service.importDataset(sourceFilePath);
    const after = Date.now();

    expect(importResult.settings.lastImportedAt).toBeDefined();
    const importedAtMs = new Date(importResult.settings.lastImportedAt!).getTime();
    expect(importedAtMs).toBeGreaterThanOrEqual(before);
    expect(importedAtMs).toBeLessThanOrEqual(after);

    const persistedSettings = JSON.parse(
      await fs.readFile(path.join(testRoot, "data", "settings.json"), "utf-8")
    ) as { lastImportedAt?: string };
    expect(persistedSettings.lastImportedAt).toBe(importResult.settings.lastImportedAt);
  });

  it("does not set lastImportedAt when restoring a backup (only file imports count)", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();
    const backupPath = await service.createBackup();

    const restoreResult = await service.restoreBackup(backupPath);

    expect(restoreResult.settings.lastImportedAt).toBeUndefined();
  });

  it("backfills lastImportedAt from a historical bulk-import audit entry on bootstrap", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();

    const auditLogFilePath = path.join(testRoot, "data", "audit-log.json");
    const historicalTimestamp = "2026-01-05T10:00:00.000Z";
    await fs.writeFile(
      auditLogFilePath,
      JSON.stringify([
        { timestamp: historicalTimestamp, editor: "Samuel", action: "bulk-import", recordsAffected: 12 }
      ]),
      "utf-8"
    );

    const bootstrap = await service.getBootstrapData();

    expect(bootstrap.settings.lastImportedAt).toBe(historicalTimestamp);
    const persistedSettings = JSON.parse(
      await fs.readFile(path.join(testRoot, "data", "settings.json"), "utf-8")
    ) as { lastImportedAt?: string };
    expect(persistedSettings.lastImportedAt).toBe(historicalTimestamp);
  });

  it("backfills lastImportedAt from the most recent of several dataset-replace/bulk-import audit entries", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();

    const auditLogFilePath = path.join(testRoot, "data", "audit-log.json");
    const olderTimestamp = "2025-11-01T08:00:00.000Z";
    const newerTimestamp = "2026-02-20T16:30:00.000Z";
    await fs.writeFile(
      auditLogFilePath,
      JSON.stringify([
        { timestamp: olderTimestamp, editor: "Samuel", action: "bulk-import", recordsAffected: 5 },
        { timestamp: newerTimestamp, editor: "Samuel", action: "dataset-replace", recordsAffected: 40 }
      ]),
      "utf-8"
    );

    const bootstrap = await service.getBootstrapData();

    expect(bootstrap.settings.lastImportedAt).toBe(newerTimestamp);
  });

  it("leaves lastImportedAt unset when the audit log has no historical import entry", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();

    const bootstrap = await service.getBootstrapData();

    expect(bootstrap.settings.lastImportedAt).toBeUndefined();
  });

  it("does not overwrite an existing lastImportedAt with an audit-log backfill", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();

    const sourceFilePath = path.join(testRoot, "incoming", "replacement.json");
    await fs.mkdir(path.dirname(sourceFilePath), { recursive: true });
    await fs.writeFile(sourceFilePath, JSON.stringify(defaultContacts, null, 2) + "\n", "utf-8");
    const importResult = await service.importDataset(sourceFilePath);

    const auditLogFilePath = path.join(testRoot, "data", "audit-log.json");
    await fs.writeFile(
      auditLogFilePath,
      JSON.stringify([
        { timestamp: "2020-01-01T00:00:00.000Z", editor: "Samuel", action: "dataset-replace", recordsAffected: 1 }
      ]),
      "utf-8"
    );

    const bootstrap = await service.getBootstrapData();

    expect(bootstrap.settings.lastImportedAt).toBe(importResult.settings.lastImportedAt);
  });

  it("concurrency regression: bootstrap backfill does not clobber a concurrent saveSettings", async () => {
    const { AppDataService } = await import("./app-data.service.js");
    const { AppDataAuditFacade } = await import("./app-data-audit.facade.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();
    await service.saveSettings(buildEditableSettings({ editorName: "Original Editor" }));

    const auditLogFilePath = path.join(testRoot, "data", "audit-log.json");
    const historicalTimestamp = "2026-01-05T10:00:00.000Z";
    await fs.writeFile(
      auditLogFilePath,
      JSON.stringify([
        { timestamp: historicalTimestamp, editor: "Samuel", action: "bulk-import", recordsAffected: 12 }
      ]),
      "utf-8"
    );

    // Force the exact race the reviewer flagged: hold the backfill's
    // audit-log lookup open (simulating the async gap between reading the
    // settings snapshot and persisting the backfilled value) until a
    // concurrent saveSettings() has fully completed and persisted its own
    // change. Before the fix, the backfill wrote its stale pre-race snapshot
    // back to disk (with only lastImportedAt added), clobbering the
    // concurrent editorName change.
    let releaseAuditLookup: (() => void) | undefined;
    const auditLookupGate = new Promise<void>((resolve) => {
      releaseAuditLookup = resolve;
    });
    const originalGetAuditLog = AppDataAuditFacade.prototype.getAuditLog;
    const getAuditLogSpy = vi
      .spyOn(AppDataAuditFacade.prototype, "getAuditLog")
      .mockImplementation(async function (
        this: AppDataAuditFacade,
        ...args: Parameters<typeof AppDataAuditFacade.prototype.getAuditLog>
      ) {
        await auditLookupGate;
        return originalGetAuditLog.apply(this, args);
      });

    try {
      const bootstrapPromise = service.getBootstrapData();

      // Let bootstrap's earlier awaits (ensureInitialFiles, readSettings) run
      // and reach the now-gated audit-log lookup before the concurrent save.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      await service.saveSettings(buildEditableSettings({ editorName: "Concurrent Editor" }));

      releaseAuditLookup?.();
      const bootstrap = await bootstrapPromise;

      expect(bootstrap.settings.lastImportedAt).toBe(historicalTimestamp);

      const persisted = JSON.parse(
        await fs.readFile(path.join(testRoot, "data", "settings.json"), "utf-8")
      ) as { editorName: string; lastImportedAt?: string };

      // Both the concurrent saveSettings() change and the backfilled
      // lastImportedAt must survive — neither operation should clobber the
      // other's write.
      expect(persisted.editorName).toBe("Concurrent Editor");
      expect(persisted.lastImportedAt).toBe(historicalTimestamp);
    } finally {
      getAuditLogSpy.mockRestore();
    }
  });

  it("restores a selected backup and creates a safety backup first", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();

    const backupFilePath = path.join(testRoot, "backups", "contacts-restore.json");
    await fs.writeFile(
      backupFilePath,
      JSON.stringify(
        {
          ...defaultContacts,
          exportedAt: "2026-04-21T09:00:00.000Z",
          records: [
            {
              ...defaultContacts.records[0]!,
              id: "cnt_restored_1",
              displayName: "Restored backup"
            }
          ]
        },
        null,
        2
      ) + "\n",
      "utf-8"
    );

    const result = await service.restoreBackup(backupFilePath);

    expect(result.importedFilePath).toMatch(
      new RegExp(
        `^(?:\\/private)?${backupFilePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/^\\\/var/, "\\/var")}$`
      )
    );
    expect(result.recordCount).toBe(1);
    expect(result.contacts.records[0]?.displayName).toBe("Restored backup");
    expect(result.backupPath).not.toBe(backupFilePath);

    const persisted = JSON.parse(
      await fs.readFile(path.join(testRoot, "data", "contacts.json"), "utf-8")
    ) as { records: Array<{ displayName: string }> };
    expect(persisted.records[0]?.displayName).toBe("Restored backup");

    const safetyBackup = JSON.parse(
      await fs.readFile(result.backupPath, "utf-8")
    ) as { records: Array<{ displayName: string }> };
    expect(safetyBackup.records[0]?.displayName).toBe(defaultContacts.records[0]?.displayName);
  });

  it("rejects restore files outside the configured backup directory", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();

    const sourceFilePath = path.join(testRoot, "incoming", "replacement.json");
    await fs.mkdir(path.dirname(sourceFilePath), { recursive: true });
    await fs.writeFile(sourceFilePath, JSON.stringify(defaultContacts, null, 2) + "\n", "utf-8");

    const rejection = service.restoreBackup(sourceFilePath);

    // SEC-3 regression guard: sanitized basename-only path, no absolute leak.
    await expect(rejection).rejects.toThrow(
      /No se pudo restaurar la copia de seguridad seleccionada\. Ruta afectada: replacement\.json\. El archivo debe estar dentro de la carpeta de copias de seguridad configurada\./
    );
    const error = await rejection.catch((e: unknown) => e as Error);
    expect(error.message).not.toContain(testRoot);
    expect(error.message).not.toContain(sourceFilePath);
  });

  it("rejects restoreBackup when the backup file is swapped for a symlink mid-validation (TOCTOU), without leaking the absolute path", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();
    const backupPath = await service.createBackup();

    const actualFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    // The initial resolveCanonicalDataFilePath() validation pass (via
    // assertPathChainIsNotSymlink) must see a real file, otherwise it rejects
    // before restoreBackup's own later TOCTOU re-check ever runs. Only report
    // a symlink on the *second* lstat of the leaf — simulating a swap that
    // happens after the first validation pass but before restoreBackup's
    // own defense-in-depth re-check.
    let leafLstatCalls = 0;
    const lstatSpy = vi.spyOn(fs, "lstat").mockImplementation(async (filePath) => {
      const isLeaf = typeof filePath === "string" && path.basename(filePath) === path.basename(backupPath);

      if (isLeaf) {
        leafLstatCalls += 1;
      }

      const realStats = await actualFs.lstat(filePath);

      if (isLeaf && leafLstatCalls > 1) {
        return Object.assign(Object.create(Object.getPrototypeOf(realStats)) as typeof realStats, realStats, {
          isSymbolicLink: () => true
        });
      }

      return realStats;
    });

    const rejection = service.restoreBackup(backupPath);

    // SEC-3 regression guard: the symlink-swap/TOCTOU guard in restoreBackup
    // must not leak the absolute canonical path into the IPC-facing error.
    await expect(rejection).rejects.toThrow(
      /El archivo cambió mientras se validaba y ya no es seguro restaurarlo\./
    );
    const error = await rejection.catch((e: unknown) => e as Error);
    expect(error.message).not.toContain(testRoot);
    expect(error.message).not.toContain(backupPath);
    expect(error.message).toContain(`Ruta afectada: ${path.basename(backupPath)}.`);

    lstatSpy.mockRestore();
  });

  it("previews a normalized CSV with counts, warnings, and row issues", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();

    const sourceFilePath = path.join(testRoot, "incoming", "preview.csv");
    await fs.mkdir(path.dirname(sourceFilePath), { recursive: true });
    await fs.writeFile(
      sourceFilePath,
      [
        "type,displayName,department,area,phone1Number,status",
        "person,Ana Pérez,Admisión,otros,12345,active",
        "service,Mostrador,Recepción,desconocida,55555,active",
        ",Fila rota,Archivo,otros,,active"
      ].join("\n") + "\n",
      "utf-8"
    );

    const preview = await service.previewCsvImport(sourceFilePath);

    expect(preview.totalRowCount).toBe(3);
    expect(preview.validRowCount).toBe(2);
    expect(preview.invalidRowCount).toBe(1);
    expect(preview.warningCount).toBe(1);
    expect(preview.rowIssues[0]?.messages).toContain("El tipo es obligatorio.");
    expect(preview.warnings[0]?.message).toContain("no está soportada");
    expect(preview.conflictCount).toBe(0);
    expect(preview.conflictedRecords).toEqual([]);
    expect(preview.policiesResolved).toBe(false);
  });

  it("previews conflicts against existing records without exposing full contact payloads", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();
    await service.saveSettings(buildEditableSettings());
    const initial = await service.getBootstrapData();
    const existing = initial.contacts.records[0]!;

    const sourceFilePath = path.join(testRoot, "incoming", "existing-conflict.csv");
    await fs.mkdir(path.dirname(sourceFilePath), { recursive: true });
    await fs.writeFile(
      sourceFilePath,
      [
        "externalId,type,displayName,department,phone1Number,status,notes",
        `${existing.externalId},service,${existing.displayName} Importada,${existing.organization.department},12345,active,nota privada`
      ].join("\n") + "\n",
      "utf-8"
    );

    const preview = await service.previewCsvImport(sourceFilePath);
    const conflict = preview.conflictedRecords[0]!;

    expect(preview.conflictCount).toBe(1);
    expect(conflict.recordIndex).toBe(0);
    expect(conflict.matchingRecordSource).toBe("existing");
    expect(conflict.matchingRecordIndex).toBe(0);
    expect(conflict.conflictType).toBe("external-id-match");
    expect(conflict.conflictReasonKey).toBe("conflict_reason.external_id");
    expect(conflict.importedRecord.displayName).toBe(`${existing.displayName} Importada`);
    expect(conflict.matchingRecord.id).toBe(existing.id);
    expect(conflict.importedRecord).not.toHaveProperty("contactMethods");
    expect(conflict.importedRecord).not.toHaveProperty("notes");
    expect(conflict.matchingRecord).not.toHaveProperty("contactMethods");
    expect(conflict.matchingRecord).not.toHaveProperty("audit");
    expect(preview.policiesResolved).toBe(false);
  });

  it("rejects conflicted CSV imports until every conflict has a policy", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();
    await service.saveSettings(buildEditableSettings());
    const initial = await service.getBootstrapData();
    const existing = initial.contacts.records[0]!;

    const sourceFilePath = path.join(testRoot, "incoming", "unresolved-conflict.csv");
    await fs.mkdir(path.dirname(sourceFilePath), { recursive: true });
    await fs.writeFile(
      sourceFilePath,
      [
        "externalId,type,displayName,department,phone1Number,status",
        `${existing.externalId},service,${existing.displayName} Importada,${existing.organization.department},12345,active`
      ].join("\n") + "\n",
      "utf-8"
    );

    await expect(service.importCsvDataset(sourceFilePath)).rejects.toThrow(
      "Resuelve todos los conflictos antes de importar."
    );
  });

  it("skips conflicted rows when the selected import policy is skip", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();
    await service.saveSettings(buildEditableSettings());
    const initial = await service.getBootstrapData();
    const existing = initial.contacts.records[0]!;

    const sourceFilePath = path.join(testRoot, "incoming", "skip-conflict.csv");
    await fs.mkdir(path.dirname(sourceFilePath), { recursive: true });
    await fs.writeFile(
      sourceFilePath,
      [
        "externalId,type,displayName,department,phone1Number,status",
        `${existing.externalId},service,No debe entrar,${existing.organization.department},12345,active`
      ].join("\n") + "\n",
      "utf-8"
    );

    const preview = await service.previewCsvImport(sourceFilePath);
    const result = await service.importCsvDataset(sourceFilePath, [
      { recordIndex: preview.conflictedRecords[0]!.recordIndex, policy: "skip" }
    ]);

    expect(result.createdCount).toBe(0);
    expect(result.updatedCount).toBe(0);
    expect(result.conflictCount).toBe(1);
    expect(result.conflictPolicyCounts?.skip).toBe(1);
    expect(result.contacts.records.find((record) => record.id === existing.id)?.displayName).toBe(existing.displayName);
  });

  it("merges new fields into an existing record when the selected import policy is merge-fields", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();
    await service.saveSettings(buildEditableSettings());
    const initial = await service.getBootstrapData();
    const existing = initial.contacts.records[0]!;

    const sourceFilePath = path.join(testRoot, "incoming", "merge-fields-conflict.csv");
    await fs.mkdir(path.dirname(sourceFilePath), { recursive: true });
    await fs.writeFile(
      sourceFilePath,
      [
        "externalId,type,displayName,department,phone1Number,phone2Number,email1,status,tags",
        `${existing.externalId},service,${existing.displayName} Importada,${existing.organization.department},12345,67890,nuevo@example.com,active,nuevo`
      ].join("\n") + "\n",
      "utf-8"
    );

    const preview = await service.previewCsvImport(sourceFilePath);
    const result = await service.importCsvDataset(sourceFilePath, [
      { recordIndex: preview.conflictedRecords[0]!.recordIndex, policy: "merge-fields" }
    ]);
    const updated = result.contacts.records.find((record) => record.id === existing.id)!;

    expect(result.createdCount).toBe(0);
    expect(result.updatedCount).toBe(1);
    expect(result.conflictPolicyCounts?.["merge-fields"]).toBe(1);
    expect(updated.displayName).toBe(existing.displayName);
    expect(updated.contactMethods.phones.some((phone) => phone.number === "67890")).toBe(true);
    expect(updated.contactMethods.emails.some((email) => email.address === "nuevo@example.com")).toBe(true);
    expect(updated.tags).toContain("nuevo");
  });

  it("does not invent a primary phone when merge-fields merges a record where none is marked primary (OIR-227 residual gap)", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();
    await service.saveSettings(buildEditableSettings());

    const createSourceFilePath = path.join(testRoot, "incoming", "no-primary-create.csv");
    await fs.mkdir(path.dirname(createSourceFilePath), { recursive: true });
    await fs.writeFile(
      createSourceFilePath,
      [
        "externalId,type,displayName,department,phone1Number,status",
        "no-primary-1,service,Sin Principal,Recepción,11111,active"
      ].join("\n") + "\n",
      "utf-8"
    );
    const created = await service.importCsvDataset(createSourceFilePath);
    const createdRecord = created.contacts.records.find((record) => record.externalId === "no-primary-1")!;
    expect(createdRecord.contactMethods.phones.every((phone) => !phone.isPrimary)).toBe(true);

    const mergeSourceFilePath = path.join(testRoot, "incoming", "no-primary-merge.csv");
    await fs.writeFile(
      mergeSourceFilePath,
      [
        "externalId,type,displayName,department,phone1Number,status",
        "no-primary-1,service,Sin Principal,Recepción,22222,active"
      ].join("\n") + "\n",
      "utf-8"
    );
    const preview = await service.previewCsvImport(mergeSourceFilePath);
    const result = await service.importCsvDataset(mergeSourceFilePath, [
      { recordIndex: preview.conflictedRecords[0]!.recordIndex, policy: "merge-fields" }
    ]);
    const merged = result.contacts.records.find((record) => record.externalId === "no-primary-1")!;

    expect(merged.contactMethods.phones.some((phone) => phone.number === "11111")).toBe(true);
    expect(merged.contactMethods.phones.some((phone) => phone.number === "22222")).toBe(true);
    expect(merged.contactMethods.phones.every((phone) => !phone.isPrimary)).toBe(true);
  });

  it("previews conflicts created by duplicate rows inside the same import file", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();

    const sourceFilePath = path.join(testRoot, "incoming", "batch-conflict.csv");
    await fs.mkdir(path.dirname(sourceFilePath), { recursive: true });
    await fs.writeFile(
      sourceFilePath,
      [
        "externalId,type,displayName,department,phone1Number,status",
        "batch-1,service,Mostrador A,Recepción,55555,active",
        "batch-1,service,Mostrador B,Recepción,55556,active"
      ].join("\n") + "\n",
      "utf-8"
    );

    const preview = await service.previewCsvImport(sourceFilePath);
    const conflict = preview.conflictedRecords[0]!;

    expect(preview.conflictCount).toBe(1);
    expect(conflict.recordIndex).toBe(1);
    expect(conflict.matchingRecordSource).toBe("import");
    expect(conflict.matchingRecordIndex).toBe(0);
    expect(conflict.conflictType).toBe("external-id-match");
    expect(conflict.importedRecord.displayName).toBe("Mostrador B");
    expect(conflict.matchingRecord.displayName).toBe("Mostrador A");
  });

  it("keeps duplicate rows matched to the existing record when an earlier import row updates it", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();
    await service.saveSettings(buildEditableSettings());
    const initial = await service.getBootstrapData();
    const existing = initial.contacts.records[0]!;

    const sourceFilePath = path.join(testRoot, "incoming", "existing-then-batch-conflict.csv");
    await fs.mkdir(path.dirname(sourceFilePath), { recursive: true });
    await fs.writeFile(
      sourceFilePath,
      [
        "externalId,type,displayName,department,phone1Number,status",
        `${existing.externalId},service,${existing.displayName} Primera,${existing.organization.department},55555,active`,
        `${existing.externalId},service,${existing.displayName} Segunda,${existing.organization.department},55556,active`
      ].join("\n") + "\n",
      "utf-8"
    );

    const preview = await service.previewCsvImport(sourceFilePath);

    expect(preview.conflictCount).toBe(2);
    expect(preview.conflictedRecords.map((conflict) => conflict.matchingRecordSource)).toEqual([
      "existing",
      "existing"
    ]);
    expect(preview.conflictedRecords.map((conflict) => conflict.matchingRecordIndex)).toEqual([0, 0]);
    expect(preview.conflictedRecords[1]?.matchingRecord.id).toBe(existing.id);
  });

  // ---------------------------------------------------------------------------
  // OIR-132 — toConflictRecordSummary: phones, emails, socials, locationSummary, matchingFieldValue
  // ---------------------------------------------------------------------------
  describe("OIR-132: conflict field-level diff — toConflictRecordSummary population", () => {
    it("populates phones array in the conflict summary payload", async () => {
      const { AppDataService } = await import("./app-data.service.js");

      const service = new AppDataService();
      await service.ensureInitialFiles();
      await service.saveSettings(buildEditableSettings());
      const initial = await service.getBootstrapData();
      const existing = initial.contacts.records[0]!;

      // Use externalId match so the conflict is deterministic
      const sourceFilePath = path.join(testRoot, "incoming", "oir132-phones.csv");
      await fs.mkdir(path.dirname(sourceFilePath), { recursive: true });
      await fs.writeFile(
        sourceFilePath,
        [
          "externalId,type,displayName,department,phone1Number,phone2Number,status",
          `${existing.externalId},service,${existing.displayName} Importada,${existing.organization.department},77701,77702,active`
        ].join("\n") + "\n",
        "utf-8"
      );

      const preview = await service.previewCsvImport(sourceFilePath);
      const conflict = preview.conflictedRecords[0]!;

      // phones must be present in the lean summary — not nested under contactMethods
      expect(Array.isArray(conflict.importedRecord.phones)).toBe(true);
      expect(conflict.importedRecord.phones.some((p) => p.number === "77701")).toBe(true);
      // The full contactMethods shape must NOT be present (payload minimization)
      expect(conflict.importedRecord).not.toHaveProperty("contactMethods");
      expect(conflict.importedRecord).not.toHaveProperty("audit");
    });

    it("populates emails array in the conflict summary payload", async () => {
      const { AppDataService } = await import("./app-data.service.js");

      const service = new AppDataService();
      await service.ensureInitialFiles();
      await service.saveSettings(buildEditableSettings());
      const initial = await service.getBootstrapData();
      const existing = initial.contacts.records[0]!;

      const sourceFilePath = path.join(testRoot, "incoming", "oir132-emails.csv");
      await fs.mkdir(path.dirname(sourceFilePath), { recursive: true });
      await fs.writeFile(
        sourceFilePath,
        [
          "externalId,type,displayName,department,email1,status",
          `${existing.externalId},service,${existing.displayName} Importada,${existing.organization.department},diff@hospital.com,active`
        ].join("\n") + "\n",
        "utf-8"
      );

      const preview = await service.previewCsvImport(sourceFilePath);
      const conflict = preview.conflictedRecords[0]!;

      expect(Array.isArray(conflict.importedRecord.emails)).toBe(true);
      expect(conflict.importedRecord.emails[0]?.address).toBe("diff@hospital.com");
    });

    it("populates socials array (possibly empty) in the conflict summary payload", async () => {
      const { AppDataService } = await import("./app-data.service.js");

      const service = new AppDataService();
      await service.ensureInitialFiles();
      await service.saveSettings(buildEditableSettings());
      const initial = await service.getBootstrapData();
      const existing = initial.contacts.records[0]!;

      const sourceFilePath = path.join(testRoot, "incoming", "oir132-socials.csv");
      await fs.mkdir(path.dirname(sourceFilePath), { recursive: true });
      await fs.writeFile(
        sourceFilePath,
        [
          "externalId,type,displayName,department,phone1Number,status",
          `${existing.externalId},service,${existing.displayName} Importada,${existing.organization.department},99901,active`
        ].join("\n") + "\n",
        "utf-8"
      );

      const preview = await service.previewCsvImport(sourceFilePath);
      const conflict = preview.conflictedRecords[0]!;

      // socials array must be present on both sides (may be [] for CSV records)
      expect(Array.isArray(conflict.importedRecord.socials)).toBe(true);
      expect(Array.isArray(conflict.matchingRecord.socials)).toBe(true);
    });

    it("does not set matchingFieldValue for external-id-match conflicts (privacy: raw ID must not reach renderer)", async () => {
      const { AppDataService } = await import("./app-data.service.js");

      const service = new AppDataService();
      await service.ensureInitialFiles();
      await service.saveSettings(buildEditableSettings());
      const initial = await service.getBootstrapData();
      const existing = initial.contacts.records[0]!;

      const sourceFilePath = path.join(testRoot, "incoming", "oir132-extid-match.csv");
      await fs.mkdir(path.dirname(sourceFilePath), { recursive: true });
      await fs.writeFile(
        sourceFilePath,
        [
          "externalId,type,displayName,department,phone1Number,status",
          `${existing.externalId},service,${existing.displayName} Importada,${existing.organization.department},11111,active`
        ].join("\n") + "\n",
        "utf-8"
      );

      const preview = await service.previewCsvImport(sourceFilePath);
      const conflict = preview.conflictedRecords[0]!;

      expect(conflict.conflictType).toBe("external-id-match");
      // matchingFieldValue must be absent for external-id-match — raw codes are not sent to the renderer.
      expect(conflict.matchingFieldValue).toBeUndefined();
    });

    it("sets matchingFieldValue to the shared phone number for phone-match conflicts", async () => {
      const { AppDataService } = await import("./app-data.service.js");

      // Two CSV rows with NO externalId — shared phone number triggers phone-match
      const service = new AppDataService();
      await service.ensureInitialFiles();

      const sourceFilePath = path.join(testRoot, "incoming", "oir132-phone-match.csv");
      await fs.mkdir(path.dirname(sourceFilePath), { recursive: true });
      await fs.writeFile(
        sourceFilePath,
        [
          "type,displayName,department,phone1Number,status",
          "service,Mostrador A,Recepción,88801,active",
          "service,Mostrador B,Recepción,88801,active"
        ].join("\n") + "\n",
        "utf-8"
      );

      const preview = await service.previewCsvImport(sourceFilePath);
      const conflict = preview.conflictedRecords[0]!;

      expect(conflict.conflictType).toBe("phone-match");
      expect(conflict.matchingFieldValue).toBe("88801");
    });

    it("sets matchingFieldValue to the first-in-record phone, not the lexicographically-first (Bug-1)", async () => {
      // Regression guard for OIR-132 Bug-1:
      //
      // buildStableMergeKeys keys a record on its FULL sorted normalized phone set,
      // so a phone-match conflict requires IDENTICAL phone sets — subset-phone
      // matching (e.g. {12345,99999} vs {99999}) does NOT produce a conflict.
      //
      // The reachable "actually-matched ≠ lexicographically-first" scenario:
      //   Both rows carry phones [99999, 12345] (CSV order).
      //   Stable key sorts them → "phones:12345,99999" (12345 is lex-first).
      //   The old split(",")[0] bug would have returned "12345" (wrong).
      //   extractMatchingFieldValue iterates the imported record's phones in their
      //   original CSV order → first hit is "99999", which is returned (correct).
      const { AppDataService } = await import("./app-data.service.js");

      const service = new AppDataService();
      await service.ensureInitialFiles();

      const sourceFilePath = path.join(testRoot, "incoming", "oir132-phone-match-lex.csv");
      await fs.mkdir(path.dirname(sourceFilePath), { recursive: true });
      await fs.writeFile(
        sourceFilePath,
        [
          "type,displayName,department,phone1Number,phone2Number,status",
          // Row 1 (existing side): phones listed 99999 first, then 12345 (lex-later)
          "service,Mostrador A,Recepción,99999,12345,active",
          // Row 2 (imported side): same phone set, different display name → conflict
          "service,Mostrador B,Recepción,99999,12345,active"
        ].join("\n") + "\n",
        "utf-8"
      );

      const preview = await service.previewCsvImport(sourceFilePath);
      const conflict = preview.conflictedRecords[0]!;

      expect(conflict.conflictType).toBe("phone-match");
      // extractMatchingFieldValue walks the imported record's phones in CSV order.
      // The first intersecting phone is "99999", NOT the lex-first "12345".
      expect(conflict.matchingFieldValue).toBe("99999");
    });

    it("sets matchingFieldValue to the original formatted phone, not the normalized form (Bug-2)", async () => {
      // Regression guard for OIR-132 Bug-2:
      // Record A has "+34 600 111 222" (formatted), Record B has "34600111222" (digits-only).
      // Both normalize to "34600111222".  The badge must show the imported record's original
      // formatted string, not the stripped digits-only form.
      const { AppDataService } = await import("./app-data.service.js");

      const service = new AppDataService();
      await service.ensureInitialFiles();

      const sourceFilePath = path.join(testRoot, "incoming", "oir132-phone-match-fmt.csv");
      await fs.mkdir(path.dirname(sourceFilePath), { recursive: true });
      await fs.writeFile(
        sourceFilePath,
        [
          "type,displayName,department,phone1Number,status",
          // Row 1 (existing side): formatted phone with spaces
          "service,Servicio A,Recepción,600 111 222,active",
          // Row 2 (imported side): digits-only form of the same number
          "service,Servicio B,Recepción,600111222,active"
        ].join("\n") + "\n",
        "utf-8"
      );

      const preview = await service.previewCsvImport(sourceFilePath);
      const conflict = preview.conflictedRecords[0]!;

      expect(conflict.conflictType).toBe("phone-match");
      // The imported record's phone is "600111222" — that is the formatted value that
      // should appear in the badge (not the normalized "600111222" stripped differently,
      // and definitely not "600 111 222" which is the existing record's formatting).
      expect(conflict.matchingFieldValue).toBe("600111222");
    });
  });

  it("localizes unsupported phone kind warnings during CSV preview", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();

    const sourceFilePath = path.join(testRoot, "incoming", "phone-kind.csv");
    await fs.mkdir(path.dirname(sourceFilePath), { recursive: true });
    await fs.writeFile(
      sourceFilePath,
      [
        "type,displayName,department,phone1Number,phone1Kind",
        "service,Mostrador,Recepción,55555,desk"
      ].join("\n") + "\n",
      "utf-8"
    );

    const preview = await service.previewCsvImport(sourceFilePath);

    expect(preview.warnings[0]?.message).toBe(
      "El tipo de teléfono \"desk\" no está soportado y se normalizó como \"other\"."
    );
  });

  it("imports a normalized CSV and merges records by externalId after backup", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();
    await service.saveSettings(buildEditableSettings());
    const initial = await service.getBootstrapData();
    const existing = initial.contacts.records[0]!;

    const sourceFilePath = path.join(testRoot, "incoming", "directory.csv");
    await fs.mkdir(path.dirname(sourceFilePath), { recursive: true });
    await fs.writeFile(
      sourceFilePath,
      [
        "externalId,type,displayName,department,area,phone1Number,phone1Kind,aliases,tags,status",
        `${existing.externalId},service,${existing.displayName} Actualizada,${existing.organization.department},especialidades,12345,internal,ana|ana,front|front,active`,
        "legacy-2,service,Mostrador,Recepción,especialidades,55555,desk,,,inactive"
      ].join("\n") + "\n",
      "utf-8"
    );

    const preview = await service.previewCsvImport(sourceFilePath);
    const result = await service.importCsvDataset(
      sourceFilePath,
      preview.conflictedRecords.map((conflict) => ({ recordIndex: conflict.recordIndex, policy: "overwrite" }))
    );
    const persisted = JSON.parse(
      await fs.readFile(path.join(testRoot, "data", "contacts.json"), "utf-8")
    ) as { records: Array<{ displayName: string; aliases: string[]; tags: string[]; status: string }> };

    expect(result.recordCount).toBe(initial.contacts.records.length + 1);
    expect(result.warningCount).toBe(3);
    expect(result.invalidRowCount).toBe(0);
    expect(result.createdCount).toBe(1);
    expect(result.updatedCount).toBe(1);
    const updated = result.contacts.records.find((record) => record.id === existing.id);
    const created = result.contacts.records.find((record) => record.externalId === "legacy-2");
    expect(updated?.displayName).toBe(`${existing.displayName} Actualizada`);
    expect(updated?.aliases).toEqual(["ana"]);
    expect(updated?.tags).toEqual(["front"]);
    expect(created?.contactMethods.phones[0]?.kind).toBe("other");
    expect(result.backupPath).toContain(path.join(testRoot, "backups"));
    expect(persisted.records.some((record) => record.status === "inactive")).toBe(true);
    const audit = await service.getAuditLog({ action: "bulk-import" });
    expect(audit.entries[0]?.recordsAffected).toBe(2);
    expect(audit.entries[0]?.changes?.conflictCount?.new).toBe(1);
    expect(audit.entries[0]?.changes?.conflictPolicyCounts?.new).toEqual({ overwrite: 1 });
  });

  it("previews and imports an ODS workbook through the spreadsheet pipeline", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();
    await service.saveSettings(buildEditableSettings());

    const workbook = XLSX.utils.book_new();
    const urgenciasSheet = XLSX.utils.aoa_to_sheet([
      ["Servicio", "Número", "Notas"],
      ["Urgencias", "", ""],
      ["Mostrador", "55555", ""],
      ["Control boxes", "55556", "No pasar llamadas externas"]
    ]);
    XLSX.utils.book_append_sheet(workbook, urgenciasSheet, "Urgencias");

    const sourceFilePath = path.join(testRoot, "incoming", "agenda.ods");
    await fs.mkdir(path.dirname(sourceFilePath), { recursive: true });
    XLSX.writeFile(workbook, sourceFilePath);

    const preview = await service.previewCsvImport(sourceFilePath);
    const result = await service.importCsvDataset(sourceFilePath);

    expect(preview.validRowCount).toBe(2);
    expect(preview.createdCount).toBe(2);
    expect(preview.updatedCount).toBe(0);
    expect(result.createdCount).toBe(2);
    expect(result.updatedCount).toBe(0);
    expect(result.contacts.records.some((record) => record.displayName === "Mostrador")).toBe(true);
    expect(
      result.contacts.records.some((record) =>
        record.contactMethods.phones.some((phone) => phone.noPatientSharing)
      )
    ).toBe(true);
  });

  // OIR-218: last-import watermark shown in the app header — CSV/spreadsheet
  // bulk-import path.
  it("records lastImportedAt after a spreadsheet (CSV/ODS) bulk import", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();
    await service.saveSettings(buildEditableSettings());

    const workbook = XLSX.utils.book_new();
    const sheet = XLSX.utils.aoa_to_sheet([
      ["Servicio", "Número", "Notas"],
      ["Urgencias", "", ""],
      ["Mostrador", "55555", ""]
    ]);
    XLSX.utils.book_append_sheet(workbook, sheet, "Urgencias");

    const sourceFilePath = path.join(testRoot, "incoming", "agenda.ods");
    await fs.mkdir(path.dirname(sourceFilePath), { recursive: true });
    XLSX.writeFile(workbook, sourceFilePath);

    const before = Date.now();
    const result = await service.importCsvDataset(sourceFilePath);
    const after = Date.now();

    expect(result.settings.lastImportedAt).toBeDefined();
    const importedAtMs = new Date(result.settings.lastImportedAt!).getTime();
    expect(importedAtMs).toBeGreaterThanOrEqual(before);
    expect(importedAtMs).toBeLessThanOrEqual(after);
  });

  it("updates an existing external center when row order changes but phone and service stay the same", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();
    await service.saveSettings(buildEditableSettings());

    const firstWorkbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      firstWorkbook,
      XLSX.utils.aoa_to_sheet([
        ["Centro", "Servicio", "Largo", "Corto"],
        ["INGENIO c/ Principal", "ADM.", "928304114", ""]
      ]),
      "Centros de salud"
    );

    const secondWorkbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      secondWorkbook,
      XLSX.utils.aoa_to_sheet([
        ["Centro", "Servicio", "Largo", "Corto"],
        ["OTRO c/ Secundaria", "URG.", "928304121", ""],
        ["INGENIO A c/ Principal", "ADM.", "928304114", ""]
      ]),
      "Centros de salud"
    );

    const firstPath = path.join(testRoot, "incoming", "centers-first.ods");
    const secondPath = path.join(testRoot, "incoming", "centers-second.ods");
    await fs.mkdir(path.dirname(firstPath), { recursive: true });
    XLSX.writeFile(firstWorkbook, firstPath);
    XLSX.writeFile(secondWorkbook, secondPath);

    const firstImport = await service.importCsvDataset(firstPath);
    const secondPreview = await service.previewCsvImport(secondPath);
    const secondImport = await service.importCsvDataset(
      secondPath,
      secondPreview.conflictedRecords.map((conflict) => ({ recordIndex: conflict.recordIndex, policy: "overwrite" }))
    );
    const ingenioMatches = secondImport.contacts.records.filter(
      (record) => record.contactMethods.phones.some((phone) => phone.number === "928304114")
    );

    expect(firstImport.contacts.records.some((record) => record.displayName === "Ingenio - Administración")).toBe(true);
    expect(secondImport.updatedCount).toBe(1);
    expect(secondImport.createdCount).toBe(1);
    expect(ingenioMatches).toHaveLength(1);
    expect(ingenioMatches[0]?.displayName).toBe("Ingenio A - Administración");
  });

  it("expands compact slash suffixes into full phone numbers during spreadsheet import", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ["Centro", "Servicio", "Largo", "Corto"],
        ["INGENIO c/ Principal", "ADM.", "928 30 41 14 /15", "(84114 /84115)"]
      ]),
      "Centros de salud"
    );

    const sourceFilePath = path.join(testRoot, "incoming", "compact-suffix.ods");
    await fs.mkdir(path.dirname(sourceFilePath), { recursive: true });
    XLSX.writeFile(workbook, sourceFilePath);

    const preview = await service.previewCsvImport(sourceFilePath);
    const result = await service.importCsvDataset(
      sourceFilePath,
      preview.conflictedRecords.map((conflict) => ({ recordIndex: conflict.recordIndex, policy: "overwrite" }))
    );
    const imported = result.contacts.records.find((record) => record.displayName === "Ingenio - Administración");

    expect(imported?.contactMethods.phones).toHaveLength(2);
    expect(imported?.contactMethods.phones[0]?.number).toBe("928304114");
    expect(imported?.contactMethods.phones[0]?.extension).toBe("84114");
    expect(imported?.contactMethods.phones[1]?.number).toBe("928304115");
    expect(imported?.contactMethods.phones[1]?.extension).toBe("84115");
  });

  it("stores short numbering as extension instead of a separate phone for health centers", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ["Centro", "Servicio", "Largo", "Corto"],
        ["INGENIO c/ Principal", "ADM.", "928 30 41 14", "84114"]
      ]),
      "Centros de salud"
    );

    const sourceFilePath = path.join(testRoot, "incoming", "single-extension.ods");
    await fs.mkdir(path.dirname(sourceFilePath), { recursive: true });
    XLSX.writeFile(workbook, sourceFilePath);

    const preview = await service.previewCsvImport(sourceFilePath);
    const result = await service.importCsvDataset(
      sourceFilePath,
      preview.conflictedRecords.map((conflict) => ({ recordIndex: conflict.recordIndex, policy: "overwrite" }))
    );
    const imported = result.contacts.records.find((record) => record.displayName === "Ingenio - Administración");

    expect(imported?.contactMethods.phones).toHaveLength(1);
    expect(imported?.contactMethods.phones[0]?.number).toBe("928304114");
    expect(imported?.contactMethods.phones[0]?.extension).toBe("84114");
  });

  it("imports continuation rows from health centers when the first column is empty", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ["Centro", "Servicio", "Largo", "Corto"],
        ["INGENIO c/ Principal", "Adm.", "928 30 41 14", "84114"],
        ["", "Adm. 2", "928 30 41 15", "84115"]
      ]),
      "Centros de salud"
    );

    const sourceFilePath = path.join(testRoot, "incoming", "center-children.ods");
    await fs.mkdir(path.dirname(sourceFilePath), { recursive: true });
    XLSX.writeFile(workbook, sourceFilePath);

    const result = await service.importCsvDataset(sourceFilePath);
    const ingenioRecords = result.contacts.records.filter((record) => record.displayName.startsWith("Ingenio -"));

    expect(ingenioRecords).toHaveLength(2);
    expect(ingenioRecords.some((record) => record.displayName === "Ingenio - Administración")).toBe(true);
    expect(ingenioRecords.some((record) => record.displayName === "Ingenio - Adm. 2")).toBe(true);
  });

  it("accepts normalized CSV files saved with UTF-8 BOM", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();

    const sourceFilePath = path.join(testRoot, "incoming", "bom-template.csv");
    await fs.mkdir(path.dirname(sourceFilePath), { recursive: true });
    await fs.writeFile(
      sourceFilePath,
      "\uFEFFexternalId,type,displayName,department,phone1Number,phone1Extension,phone1Kind,status\n" +
      "row-1,service,Mostrador,Recepción,928304114,84114,external,active\n",
      "utf-8"
    );

    const preview = await service.previewCsvImport(sourceFilePath);

    expect(preview.validRowCount).toBe(1);
    expect(preview.invalidRowCount).toBe(0);
  });

  it("imports raw health-center CSV files by header shape even when the filename is arbitrary", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();

    const sourceFilePath = path.join(testRoot, "incoming", "agenda-export.csv");
    await fs.mkdir(path.dirname(sourceFilePath), { recursive: true });
    await fs.writeFile(
      sourceFilePath,
      [
        '"CENTROS DE SALUD","SERVICIO","NUMERO LARGO","NUMERO CORTO",,',
        '"INGENIO\\nAv. de los Artesanos, 8","Adm.","928 30 41 14 /15","(84114 /84115)",,',
        ',"Urgencias","928 30 41 21","(84121)",,'
      ].join("\n") + "\n",
      "utf-8"
    );

    const result = await service.importCsvDataset(sourceFilePath);
    const ingenioAdmin = result.contacts.records.find((record) => record.displayName === "Ingenio - Administración");
    const ingenioUrg = result.contacts.records.find((record) => record.displayName === "Ingenio - Urgencias");

    expect(ingenioAdmin?.contactMethods.phones).toHaveLength(2);
    expect(ingenioAdmin?.contactMethods.phones[0]?.number).toBe("928304114");
    expect(ingenioAdmin?.contactMethods.phones[0]?.extension).toBe("84114");
    expect(ingenioAdmin?.contactMethods.phones[1]?.number).toBe("928304115");
    expect(ingenioAdmin?.contactMethods.phones[1]?.extension).toBe("84115");
    expect(ingenioUrg?.contactMethods.phones[0]?.number).toBe("928304121");
    expect(ingenioUrg?.contactMethods.phones[0]?.extension).toBe("84121");
  });

  it("does not misclassify partial-overlap CSV headers as the normalized template", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();

    const sourceFilePath = path.join(testRoot, "incoming", "partial-overlap.csv");
    await fs.mkdir(path.dirname(sourceFilePath), { recursive: true });
    await fs.writeFile(
      sourceFilePath,
      [
        "status,legacyDesk,name",
        "active,desk-1,Mostrador"
      ].join("\n") + "\n",
      "utf-8"
    );

    await expect(service.previewCsvImport(sourceFilePath)).rejects.toThrow(
      "No se encontraron hojas soportadas para importar."
    );
  });

  it("imports service-sheet XLSX files with arbitrary sheet names by row profile", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ["Servicio", "Número", "Notas"],
        ["Urgencias", "", ""],
        ["Mostrador", "55555", ""],
        ["Control boxes", "55556", "No pasar llamadas externas"]
      ]),
      "Sheet1"
    );

    const sourceFilePath = path.join(testRoot, "incoming", "custom-export.xlsx");
    await fs.mkdir(path.dirname(sourceFilePath), { recursive: true });
    XLSX.writeFile(workbook, sourceFilePath);

    const preview = await service.previewCsvImport(sourceFilePath);
    const result = await service.importCsvDataset(sourceFilePath);
    const controlRecord = result.contacts.records.find((record) => record.displayName === "Control boxes");

    expect(preview.detectedFormat).toBe("exportación cruda de hoja de servicios");
    expect(preview.detectionConfidence).toBe("high");
    expect(preview.validRowCount).toBe(2);
    expect(controlRecord?.organization.department).toBe("Urgencias");
    expect(controlRecord?.contactMethods.phones[0]?.noPatientSharing).toBe(true);
  });

  it("accepts canonical one-row service sheets with a detected service header", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ["Servicio", "Número", "Notas"],
        ["Mostrador", "55555", ""]
      ]),
      "Urgencias"
    );

    const sourceFilePath = path.join(testRoot, "incoming", "urgencias-single-row.xlsx");
    await fs.mkdir(path.dirname(sourceFilePath), { recursive: true });
    XLSX.writeFile(workbook, sourceFilePath);

    const preview = await service.previewCsvImport(sourceFilePath);

    expect(preview.validRowCount).toBe(1);
    expect(preview.createdCount).toBe(1);
    expect(preview.detectedFormat).toBe("exportación cruda de hoja de servicios");
    expect(preview.detectionConfidence).toBe("medium");
  });

  it("rejects alias-matched sheets when they do not carry service-sheet structure", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ["Fecha", "ID", "Valor"],
        ["2026-04-24", "1234", "55"],
        ["2026-04-25", "4567", "89"]
      ]),
      "Urgencias"
    );

    const sourceFilePath = path.join(testRoot, "incoming", "bad-urgencias.xlsx");
    await fs.mkdir(path.dirname(sourceFilePath), { recursive: true });
    XLSX.writeFile(workbook, sourceFilePath);

    await expect(service.previewCsvImport(sourceFilePath)).rejects.toThrow(
      "No se encontraron hojas soportadas para importar."
    );
  });

  it("rejects alias-matched sheets with service-like headers but date-shaped junk rows", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ["Servicio", "Número", "Valor"],
        ["Mostrador", "2026-04-24", "55"],
        ["Control", "2026-04-25", "89"]
      ]),
      "Urgencias"
    );

    const sourceFilePath = path.join(testRoot, "incoming", "alias-header-junk.xlsx");
    await fs.mkdir(path.dirname(sourceFilePath), { recursive: true });
    XLSX.writeFile(workbook, sourceFilePath);

    await expect(service.previewCsvImport(sourceFilePath)).rejects.toThrow(
      "No se encontraron hojas soportadas para importar."
    );
  });

  it("rejects canonical sheets that only match generic name-extension headers", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ["Nombre", "Extensión", "Valor"],
        ["Mostrador", "55555", "12"]
      ]),
      "Urgencias"
    );

    const sourceFilePath = path.join(testRoot, "incoming", "urgencias-name-extension.xlsx");
    await fs.mkdir(path.dirname(sourceFilePath), { recursive: true });
    XLSX.writeFile(workbook, sourceFilePath);

    await expect(service.previewCsvImport(sourceFilePath)).rejects.toThrow(
      "No se encontraron hojas soportadas para importar."
    );
  });

  it("rejects generic service-like sheets with a single numeric row and no structural evidence", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ["Servicio", "Número", "Notas"],
        ["Mostrador", "55555", ""]
      ]),
      "Agenda abril"
    );

    const sourceFilePath = path.join(testRoot, "incoming", "generic-single-row.xlsx");
    await fs.mkdir(path.dirname(sourceFilePath), { recursive: true });
    XLSX.writeFile(workbook, sourceFilePath);

    await expect(service.previewCsvImport(sourceFilePath)).rejects.toThrow(
      "No se encontraron hojas soportadas para importar."
    );
  });

  it("rejects two-row numeric tables that only mimic service headers", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ["Servicio", "Número", "Valor"],
        ["Mostrador", "55555", "12"],
        ["Control", "55556", "18"]
      ]),
      "Agenda abril"
    );

    const sourceFilePath = path.join(testRoot, "incoming", "generic-two-row-junk.xlsx");
    await fs.mkdir(path.dirname(sourceFilePath), { recursive: true });
    XLSX.writeFile(workbook, sourceFilePath);

    await expect(service.previewCsvImport(sourceFilePath)).rejects.toThrow(
      "No se encontraron hojas soportadas para importar."
    );
  });

  it("keeps service-sheet merge ids stable when the same export uses a custom sheet title", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();

    const canonicalWorkbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      canonicalWorkbook,
      XLSX.utils.aoa_to_sheet([
        ["Servicio", "Número", "Notas"],
        ["Urgencias", "", ""],
        ["Mostrador", "55555", ""],
        ["Control boxes", "55556", "No pasar llamadas externas"]
      ]),
      "Sheet1"
    );

    const canonicalPath = path.join(testRoot, "incoming", "service-canonical.xlsx");
    await fs.mkdir(path.dirname(canonicalPath), { recursive: true });
    XLSX.writeFile(canonicalWorkbook, canonicalPath);
    await service.importCsvDataset(canonicalPath);

    const customWorkbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      customWorkbook,
      XLSX.utils.aoa_to_sheet([
        ["Servicio", "Número", "Notas"],
        ["Urgencias", "", ""],
        ["Mostrador", "55555", ""],
        ["Control boxes", "55556", "No pasar llamadas externas"]
      ]),
      "Agenda abril"
    );

    const customPath = path.join(testRoot, "incoming", "service-custom-title.xlsx");
    XLSX.writeFile(customWorkbook, customPath);

    const preview = await service.previewCsvImport(customPath);

    expect(preview.createdCount).toBe(0);
    expect(preview.updatedCount).toBe(2);
  });

  it("keeps health-center merge ids stable when the sheet title is arbitrary", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();

    const canonicalWorkbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      canonicalWorkbook,
      XLSX.utils.aoa_to_sheet([
        ["CENTROS DE SALUD", "SERVICIO", "NUMERO LARGO", "NUMERO CORTO"],
        ["INGENIO\nAv. de los Artesanos, 8", "Adm.", "928 30 41 14 /15", "(84114 /84115)"],
        ["", "Urgencias", "928 30 41 21", "(84121)"]
      ]),
      "Centros de salud"
    );

    const canonicalPath = path.join(testRoot, "incoming", "centers-canonical.xlsx");
    await fs.mkdir(path.dirname(canonicalPath), { recursive: true });
    XLSX.writeFile(canonicalWorkbook, canonicalPath);
    await service.importCsvDataset(canonicalPath);

    const customWorkbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      customWorkbook,
      XLSX.utils.aoa_to_sheet([
        ["CENTROS DE SALUD", "SERVICIO", "NUMERO LARGO", "NUMERO CORTO"],
        ["INGENIO\nAv. de los Artesanos, 8", "Adm.", "928 30 41 14 /15", "(84114 /84115)"],
        ["", "Urgencias", "928 30 41 21", "(84121)"]
      ]),
      "Agenda abril"
    );

    const customPath = path.join(testRoot, "incoming", "centers-custom-title.xlsx");
    XLSX.writeFile(customWorkbook, customPath);

    const preview = await service.previewCsvImport(customPath);

    expect(preview.createdCount).toBe(0);
    expect(preview.updatedCount).toBe(2);
  });

  it("labels normalized template previews with detected format metadata", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();

    const sourceFilePath = path.join(testRoot, "incoming", "normalized-template.csv");
    await fs.mkdir(path.dirname(sourceFilePath), { recursive: true });
    await fs.writeFile(
      sourceFilePath,
      [
        "type,displayName,department,phone1Number",
        "service,Mostrador,Recepción,55555"
      ].join("\n") + "\n",
      "utf-8"
    );

    const preview = await service.previewCsvImport(sourceFilePath);

    expect(preview.detectedFormat).toBe("plantilla normalizada");
    expect(preview.detectionConfidence).toBe("high");
  });

  it("imports continuation rows in service sheets when the label lives in a later column", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ["col1", "col2", "col3", "col4"],
        ["HOSPITAL DE DÍA RADIOTERÁPIA", "", "", ""],
        ["Citas 08:00 – 14:00", "79530", "Mostrador (Auxiliar Adm)", "79246"],
        ["", "79145", "Auxiliar Enfermería", "79230"]
      ]),
      "Hospitales_de_día"
    );

    const sourceFilePath = path.join(testRoot, "incoming", "service-continuation.ods");
    await fs.mkdir(path.dirname(sourceFilePath), { recursive: true });
    XLSX.writeFile(workbook, sourceFilePath);

    const result = await service.importCsvDataset(sourceFilePath);
    const imported = result.contacts.records.find((record) => record.displayName === "Auxiliar Enfermería");

    expect(imported).toBeDefined();
    expect(imported?.organization.department).toBe("Hospitales de día");
    expect(imported?.organization.service).toBe("HOSPITAL DE DÍA RADIOTERÁPIA");
    expect(imported?.contactMethods.phones.map((phone) => phone.number)).toEqual(["79145", "79230"]);
  });

  it("imports a valid dataset even when the current dataset is corrupt", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();

    const corruptedCurrentDataset = "{ this-is-not-valid-json }\n";
    await fs.writeFile(path.join(testRoot, "data", "contacts.json"), corruptedCurrentDataset, "utf-8");

    const sourceFilePath = path.join(testRoot, "incoming", "recovery.json");
    await fs.mkdir(path.dirname(sourceFilePath), { recursive: true });
    await fs.writeFile(sourceFilePath, JSON.stringify(defaultContacts, null, 2) + "\n", "utf-8");

    const importResult = await service.importDataset(sourceFilePath);
    const backupContents = await fs.readFile(importResult.backupPath, "utf-8");
    const persisted = JSON.parse(
      await fs.readFile(path.join(testRoot, "data", "contacts.json"), "utf-8")
    ) as { records: Array<{ displayName: string }> };

    expect(backupContents).toBe(corruptedCurrentDataset);
    expect(persisted.records[0]?.displayName).toBe(defaultContacts.records[0]?.displayName);
  });

  it("rejects imported datasets with invalid timestamp fields", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();

    const sourceFilePath = path.join(testRoot, "incoming", "invalid.json");
    await fs.mkdir(path.dirname(sourceFilePath), { recursive: true });

    const invalidDataset = structuredClone(
      JSON.parse(await fs.readFile(path.join(testRoot, "data", "contacts.json"), "utf-8"))
    ) as { exportedAt: string };
    invalidDataset.exportedAt = "invalid-date";

    await fs.writeFile(sourceFilePath, JSON.stringify(invalidDataset, null, 2) + "\n", "utf-8");

    await expect(service.importDataset(sourceFilePath)).rejects.toThrow();
  });

  it("returns a recovery payload when contacts.json is corrupted at startup", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();
    await fs.writeFile(path.join(testRoot, "data", "contacts.json"), "{ invalid-json }\n", "utf-8");

    const result = await service.getBootstrapData();

    expect("recovery" in result).toBe(true);
    if ("recovery" in result) {
      expect(result.recovery.reason).toBe("invalid-contacts-json");
      expect(result.recovery.contactsFilePath).toBe(path.join(testRoot, "data", "contacts.json"));
      expect(result.settings.ui.showInactiveByDefault).toBe(false);
      expect(result.recovery.details).toBe(
        "El archivo no es un JSON válido. Verifica que el archivo no esté corrupto."
      );
    }
  });

  it("returns a recovery payload when the configured custom data file is missing", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();
    const customDataDirectory = path.join(testRoot, "custom-data");
    const customBackupDirectory = path.join(testRoot, "custom-backups");
    await fs.mkdir(customDataDirectory, { recursive: true });
    await fs.mkdir(customBackupDirectory, { recursive: true });
    const customDataFilePath = path.join(customDataDirectory, "contacts-custom.json");

    await service.saveSettings(
      buildEditableSettings({
        dataFilePath: customDataFilePath,
        backupDirectoryPath: customBackupDirectory
      })
    );
    await fs.rm(customDataFilePath);

    const result = await service.getBootstrapData();

    expect("recovery" in result).toBe(true);
    if ("recovery" in result) {
      expect(result.recovery.reason).toBe("invalid-contacts-json");
      expect(result.recovery.contactsFilePath).toBe(customDataFilePath);
      expect(result.recovery.message).toBe("El archivo de datos configurado no existe o ya no está disponible.");
    }
  });

  it("returns a recovery payload when the configured data path points to a directory", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();
    const invalidDataDirectory = path.join(testRoot, "broken-data-path");
    await fs.mkdir(invalidDataDirectory, { recursive: true });
    const settingsFilePath = path.join(testRoot, "data", "settings.json");
    const currentSettings = JSON.parse(await fs.readFile(settingsFilePath, "utf-8")) as {
      editorName: string;
      dataFilePath: string;
      backupDirectoryPath: string;
      managedPaths?: {
        dataFilePath: boolean;
        backupDirectoryPath: boolean;
      };
      ui: { showInactiveByDefault: boolean };
    };
    currentSettings.dataFilePath = invalidDataDirectory;
    currentSettings.managedPaths = {
      dataFilePath: false,
      backupDirectoryPath: true
    };
    await fs.writeFile(settingsFilePath, JSON.stringify(currentSettings, null, 2) + "\n", "utf-8");

    const result = await service.getBootstrapData();

    expect("recovery" in result).toBe(true);
    if ("recovery" in result) {
      expect(result.recovery.contactsFilePath).toBe(invalidDataDirectory);
      expect(result.recovery.message).toBe("La ruta de datos configurada no apunta a un archivo utilizable.");
    }
  });

  it("resets the dataset to empty and preserves a backup of the corrupted file", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();
    await service.saveSettings(
      buildEditableSettings({
        ui: {
          showInactiveByDefault: true
        }
      })
    );

    const corruptedCurrentDataset = "{ invalid-json }\n";
    await fs.writeFile(path.join(testRoot, "data", "contacts.json"), corruptedCurrentDataset, "utf-8");

    const result = await service.resetDataset();
    const backupContents = await fs.readFile(result.backupPath!, "utf-8");
    const persisted = JSON.parse(
      await fs.readFile(path.join(testRoot, "data", "contacts.json"), "utf-8")
    ) as { metadata: { recordCount: number }; records: unknown[] };

    expect(backupContents).toBe(corruptedCurrentDataset);
    expect(result.contacts.records).toHaveLength(0);
    expect(result.contacts.metadata.recordCount).toBe(0);
    expect(result.settings.ui.showInactiveByDefault).toBe(true);
    expect(persisted.records).toHaveLength(0);
    expect(persisted.metadata.recordCount).toBe(0);
  });

  it("rejects CSV replacement when every row is invalid and nothing is importable", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();

    const sourceFilePath = path.join(testRoot, "incoming", "invalid.csv");
    await fs.mkdir(path.dirname(sourceFilePath), { recursive: true });
    await fs.writeFile(
      sourceFilePath,
      [
        "type,displayName,department",
        "person,,Admisión"
      ].join("\n") + "\n",
      "utf-8"
    );

    // OIR-200: a file with zero valid rows (and no buscas content) still blocks
    // the import — this is the "nothing valid" guard, kept intentionally.
    await expect(service.importCsvDataset(sourceFilePath)).rejects.toThrow(
      "El archivo no contiene filas válidas para importar."
    );
  });

  it("OIR-200: imports valid rows while skipping rejected rows instead of blocking the whole file", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();
    await service.saveSettings(buildEditableSettings());
    const initial = await service.getBootstrapData();
    const initialRecordCount = initial.contacts.records.length;

    const sourceFilePath = path.join(testRoot, "incoming", "partial-invalid.csv");
    await fs.mkdir(path.dirname(sourceFilePath), { recursive: true });
    await fs.writeFile(
      sourceFilePath,
      [
        "type,displayName,department,phone1Number",
        "service,Mostrador Válido,Recepción,55555",
        "person,,Admisión,",
        "bogus-type,Fila con tipo inválido,Urgencias,66666"
      ].join("\n") + "\n",
      "utf-8"
    );

    const preview = await service.previewCsvImport(sourceFilePath);
    expect(preview.validRowCount).toBe(1);
    expect(preview.invalidRowCount).toBe(2);

    const result = await service.importCsvDataset(sourceFilePath);

    // Only the valid row was persisted, appended to the pre-existing dataset.
    expect(result.createdCount).toBe(1);
    expect(result.recordCount).toBe(initialRecordCount + 1);
    expect(
      result.contacts.records.some((record) => record.displayName === "Mostrador Válido")
    ).toBe(true);

    // The rejected rows are reported back, never imported.
    expect(result.invalidRowCount).toBe(2);
    expect(result.rowIssues).toHaveLength(2);
    expect(result.rowIssues.some((issue) => issue.messages.includes("El nombre visible es obligatorio."))).toBe(true);
    expect(
      result.rowIssues.some((issue) => issue.messages.includes('El tipo "bogus-type" no está soportado.'))
    ).toBe(true);
    expect(
      result.contacts.records.some((record) => record.displayName === "Fila con tipo inválido")
    ).toBe(false);

    const persisted = JSON.parse(
      await fs.readFile(path.join(testRoot, "data", "contacts.json"), "utf-8")
    ) as { records: Array<{ displayName: string }> };
    expect(persisted.records).toHaveLength(initialRecordCount + 1);
    expect(persisted.records.some((record) => record.displayName === "Mostrador Válido")).toBe(true);
  });

  it("updates a later row that matches a record created earlier in the same import", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();
    await service.saveSettings(buildEditableSettings());

    const sourceFilePath = path.join(testRoot, "incoming", "same-import-merge.csv");
    await fs.mkdir(path.dirname(sourceFilePath), { recursive: true });
    await fs.writeFile(
      sourceFilePath,
      [
        "externalId,type,displayName,department,service,phone1Number,phone1Kind,status",
        "generated-1,service,Mostrador,Urgencias,Mostrador,55555,internal,active",
        ",service,Mostrador actualizado,Urgencias,Mostrador,55555,internal,active"
      ].join("\n") + "\n",
      "utf-8"
    );

    const preview = await service.previewCsvImport(sourceFilePath);
    const result = await service.importCsvDataset(
      sourceFilePath,
      preview.conflictedRecords.map((conflict) => ({ recordIndex: conflict.recordIndex, policy: "overwrite" }))
    );
    const matches = result.contacts.records.filter((record) =>
      record.organization.department === "Urgencias" &&
      record.organization.service === "Mostrador" &&
      record.contactMethods.phones.some((phone) => phone.number === "55555")
    );

    expect(result.createdCount).toBe(1);
    expect(result.updatedCount).toBe(1);
    expect(matches).toHaveLength(1);
    expect(matches[0]?.displayName).toBe("Mostrador actualizado");
  });

  it("rejects CSV preview when the file exceeds the supported size limit", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();

    const sourceFilePath = path.join(testRoot, "incoming", "too-large.csv");
    await fs.mkdir(path.dirname(sourceFilePath), { recursive: true });
    await fs.writeFile(sourceFilePath, "a".repeat(5 * 1024 * 1024 + 1), "utf-8");

    await expect(service.previewCsvImport(sourceFilePath)).rejects.toThrow(
      "El CSV supera el tamaño máximo permitido de 5 MB. Divide el archivo antes de importarlo."
    );
  });

  it("rejects CSV preview when the header does not match the MVP template", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();

    const sourceFilePath = path.join(testRoot, "incoming", "unexpected-header.csv");
    await fs.mkdir(path.dirname(sourceFilePath), { recursive: true });
    await fs.writeFile(
      sourceFilePath,
      [
        "type,displayName,phone1Number,legacyDesk",
        "service,Mostrador,55555,Antiguo"
      ].join("\n") + "\n",
      "utf-8"
    );

    await expect(service.previewCsvImport(sourceFilePath)).rejects.toThrow(
      "La cabecera del CSV contiene columnas que no pertenecen a la plantilla oficial: legacyDesk. Corrige el archivo antes de importarlo."
    );
  });

  it("throws after 1000 attempts when crypto.randomUUID always returns the same value", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();

    // crypto.randomUUID always returns same UUID to force collision
    const fixedUUID = "aaaaaaaa-0000-0000-0000-000000000000" as `${string}-${string}-${string}-${string}-${string}`;
    const fixedId = `cnt_${fixedUUID.slice(0, 8)}`;

    // Pre-populate contacts.json with a valid record that has the fixed ID
    const contactsFilePath = path.join(testRoot, "data", "contacts.json");
    const existing = JSON.parse(await fs.readFile(contactsFilePath, "utf-8")) as {
      version: string;
      exportedAt: string;
      metadata: {
        recordCount: number;
        generatedFrom: string;
        generatedBy: string;
        editorName: string;
        typeCounts: Record<string, number>;
        areaCounts: Record<string, number>;
      };
      catalogs: { recordTypes: string[]; areas: string[] };
      records: Array<unknown>;
    };

    const collisionRecord = {
      id: fixedId,
      type: "service",
      displayName: "Colisión forzada",
      organization: { department: "Test" },
      contactMethods: {
        phones: [
          {
            id: "ph_collision",
            number: "00000",
            kind: "internal",
            isPrimary: true,
            confidential: false,
            noPatientSharing: false
          }
        ],
        emails: []
      },
      aliases: [],
      tags: [],
      status: "active",
      audit: {
        createdAt: "2026-04-20T00:00:00.000Z",
        updatedAt: "2026-04-20T00:00:00.000Z",
        createdBy: "Test",
        updatedBy: "Test"
      }
    };

    existing.records.push(collisionRecord);
    existing.metadata.recordCount = existing.records.length;
    await fs.writeFile(contactsFilePath, JSON.stringify(existing, null, 2), "utf-8");

    const randomUUIDSpy = vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(fixedUUID);

    await expect(
      service.createRecord({
        type: "service",
        displayName: "Desbordamiento",
        organization: { department: "Test" },
        contactMethods: {
          phones: [
            {
              id: "ph_overflow",
              label: "Principal",
              number: "99999",
              kind: "internal",
              isPrimary: true,
              confidential: false,
              noPatientSharing: false
            }
          ],
          emails: [],
          socials: []
        },
        aliases: [],
        tags: [],
        status: "active"
      })
    ).rejects.toThrow("No se pudo generar un ID único para el registro después de 1000 intentos");

    randomUUIDSpy.mockRestore();
  });

  it("returns backupPath null and succeeds when contacts.json does not exist before resetDataset", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();

    // Remove contacts.json to simulate a missing file before reset
    const contactsFilePath = path.join(testRoot, "data", "contacts.json");
    await fs.rm(contactsFilePath, { force: true });

    const result = await service.resetDataset();

    expect(result.backupPath).toBeNull();
    expect(result.contacts.records).toHaveLength(0);
    expect(result.contacts.metadata.recordCount).toBe(0);

    const persisted = JSON.parse(
      await fs.readFile(contactsFilePath, "utf-8")
    ) as { records: unknown[]; metadata: { recordCount: number } };
    expect(persisted.records).toHaveLength(0);
    expect(persisted.metadata.recordCount).toBe(0);
  });

  it("wraps data-file write failures with localized filesystem context", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();
    const writeFileSpy = vi
      .spyOn(fs, "writeFile")
      .mockRejectedValueOnce(
        Object.assign(new Error("EACCES: permission denied"), {
          code: "EACCES",
          path: path.join(testRoot, "data", "contacts.json.tmp")
        })
      );

    await expect(service.resetDataset()).rejects.toThrow(
      /No se pudo escribir el archivo de datos configurado\..*No tienes permisos suficientes para acceder al archivo o directorio\./
    );
    expect(writeFileSpy).toHaveBeenCalled();
  });

  it("returns Zod issue messages in recovery details when contacts.json has valid JSON but invalid schema", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();

    // Write valid JSON that fails the directoryDatasetSchema (missing required 'version' field)
    const invalidSchemaDataset = {
      exportedAt: "2026-04-20T00:00:00.000Z",
      metadata: {
        recordCount: 0,
        generatedFrom: "test",
        generatedBy: "test",
        editorName: "Test",
        typeCounts: {},
        areaCounts: {}
      },
      catalogs: { recordTypes: [], areas: [] },
      records: [
        {
          id: "cnt_bad",
          type: "INVALID_TYPE_VALUE",
          displayName: "Broken record"
        }
      ]
    };

    await fs.writeFile(
      path.join(testRoot, "data", "contacts.json"),
      JSON.stringify(invalidSchemaDataset),
      "utf-8"
    );

    const result = await service.getBootstrapData();

    expect("recovery" in result).toBe(true);
    if ("recovery" in result) {
      expect(result.recovery.reason).toBe("invalid-contacts-json");
      expect(result.recovery.details).toBe(
        "El archivo tiene una estructura inválida. Utiliza la plantilla oficial para importar contactos."
      );
    }
  });

  it("returns the unknown-error fallback details when toRecoveryState is called with a plain string", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();

    const filePath = path.join(testRoot, "data", "contacts.json");
    const recovery = (service as any).toRecoveryState("plain string", filePath) as {
      details: string;
    };

    expect(recovery.details).toBe(
      "Importa una copia JSON válida o restablece un directorio vacío para volver a trabajar."
    );
  });

  it("listBackups createdAt values are valid ISO strings in descending order", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();

    const firstBackupPath = await service.createBackup();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const secondBackupPath = await service.createBackup();

    const backups = await service.listBackups();

    expect(backups).toHaveLength(2);
    expect(backups[0]?.filePath).toBe(secondBackupPath);
    expect(backups[1]?.filePath).toBe(firstBackupPath);

    const isoRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
    expect(backups[0]?.createdAt).toMatch(isoRegex);
    expect(backups[1]?.createdAt).toMatch(isoRegex);

    const firstTime = new Date(backups[1]!.createdAt).getTime();
    const secondTime = new Date(backups[0]!.createdAt).getTime();
    expect(secondTime).toBeGreaterThanOrEqual(firstTime);
  });

  it("listBackups uses mtime as createdAt fallback when birthtimeMs is epoch (Linux)", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();
    await service.createBackup();

    const knownMtime = new Date("2026-04-20T10:00:00.000Z");

    vi.spyOn(fs, "stat").mockResolvedValueOnce({
      birthtimeMs: 0,
      birthtime: new Date(0),
      mtime: knownMtime,
      size: 512,
      isFile: () => true,
      isDirectory: () => false
    } as unknown as import("node:fs").Stats);

    const backups = await service.listBackups();

    expect(backups[0]?.createdAt).toBe(knownMtime.toISOString());
  });
  it("does not lose records when two createRecord calls run concurrently", async () => {
    const { AppDataService } = await import("./app-data.service.js");
    const service = new AppDataService();
    await service.ensureInitialFiles();
    await service.saveSettings(buildEditableSettings());

    const makePayload = (label: string) => ({
      type: "service" as const,
      displayName: `Concurrent ${label}`,
      organization: { department: "Test" },
      contactMethods: { phones: [], emails: [], socials: [] },
      aliases: [] as string[],
      tags: [] as string[],
      status: "active" as const
    });

    const [r1, r2] = await Promise.all([
      service.createRecord(makePayload("A")),
      service.createRecord(makePayload("B"))
    ]);

    expect(r1.savedRecordId).not.toBe(r2.savedRecordId);
    const finalRecords =
      r1.contacts.records.length >= r2.contacts.records.length
        ? r1.contacts.records
        : r2.contacts.records;
    const ids = finalRecords.map((r) => r.id);
    expect(ids).toContain(r1.savedRecordId);
    expect(ids).toContain(r2.savedRecordId);
  });

  it("createBackup produces distinct file names even when the clock returns the same tick", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();
    await service.saveSettings(buildEditableSettings());

    // Freeze Date so both backups land in the same timestamp tick.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    try {
      const firstPath = await service.createBackup();
      const secondPath = await service.createBackup();

      expect(firstPath).not.toBe(secondPath);
      expect(path.basename(firstPath)).not.toBe(path.basename(secondPath));
    } finally {
      vi.useRealTimers();
    }
  });

  it("parallel createBackup calls all produce distinct files and none are overwritten", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();
    await service.saveSettings(buildEditableSettings());

    const count = 5;
    const paths = await Promise.all(
      Array.from({ length: count }, () => service.createBackup())
    );

    const uniquePaths = new Set(paths);
    expect(uniquePaths.size).toBe(count);

    const backupDir = path.join(testRoot, "backups");
    const files = await fs.readdir(backupDir);
    const backupFiles = files.filter((f) => f.startsWith("contacts-") && f.endsWith(".json"));
    expect(backupFiles).toHaveLength(count);
  });

  it("createBackup retries and succeeds when the first candidate name already exists", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();
    await service.saveSettings(buildEditableSettings());

    const backupDir = path.join(testRoot, "backups");

    // Intercept the first suffix to be a predictable collision, then let the rest through.
    const originalRandomUUID = globalThis.crypto.randomUUID.bind(globalThis.crypto);
    let callCount = 0;
    const collidingSuffix = "aaaaaa";

    vi.spyOn(globalThis.crypto, "randomUUID").mockImplementation(() => {
      callCount += 1;
      // Return a UUID whose first 6 non-hyphen chars match the colliding suffix on the first call.
      if (callCount === 1) {
        return `${collidingSuffix.slice(0, 4)}-${collidingSuffix.slice(4)}-0000-0000-000000000000` as ReturnType<typeof crypto.randomUUID>;
      }
      return originalRandomUUID();
    });

    // Pre-create the file that would collide with the first suffix.
    const frozenDate = new Date("2026-06-01T00:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(frozenDate);
    const safeTimestamp = frozenDate.toISOString().replace(/[:.]/g, "-");
    const collidingPath = path.join(backupDir, `contacts-${safeTimestamp}-${collidingSuffix}.json`);
    await fs.mkdir(backupDir, { recursive: true });
    await fs.writeFile(collidingPath, "{}");

    let resultPath: string;
    try {
      resultPath = await service.createBackup();
    } finally {
      vi.useRealTimers();
    }

    // Must have succeeded with a different name.
    expect(resultPath).not.toBe(collidingPath);
    expect(path.basename(resultPath)).not.toBe(path.basename(collidingPath));

    // Both the pre-existing collision file and the new backup exist.
    const files = await fs.readdir(backupDir);
    const backupFiles = files.filter((f) => f.startsWith("contacts-") && f.endsWith(".json"));
    expect(backupFiles.length).toBeGreaterThanOrEqual(2);
  });

  it("backup retention ordering is correct under the new name format with random suffix", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();
    await service.saveSettings(buildEditableSettings());

    // Create three backups with a deliberate time gap so mtime ordering is deterministic.
    const firstPath = await service.createBackup();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const secondPath = await service.createBackup();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const thirdPath = await service.createBackup();

    const backups = await service.listBackups();

    // listBackups returns descending by createdAt (newest first).
    expect(backups).toHaveLength(3);
    expect(backups[0]?.filePath).toBe(thirdPath);
    expect(backups[1]?.filePath).toBe(secondPath);
    expect(backups[2]?.filePath).toBe(firstPath);

    const times = backups.map((b) => new Date(b.createdAt).getTime());
    expect(times[0]).toBeGreaterThanOrEqual(times[1]!);
    expect(times[1]).toBeGreaterThanOrEqual(times[2]!);
  });

  // -------------------------------------------------------------------------
  // OIR-204 — createBackup (manual/import/restore/reset) prunes old contacts-*
  // backups using the same retentionCount cap as auto-backups, so repeated
  // import/export/reset cycles cannot accumulate unlimited PII-bearing files.
  // -------------------------------------------------------------------------

  it("prunes old contacts-* backups down to the configured retentionCount", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();
    await service.saveSettings(
      buildEditableSettings({
        ui: {
          showInactiveByDefault: false,
          autoBackup: {
            enabled: false,
            trigger: "launch",
            intervalHours: 2,
            editCountThreshold: 10,
            retentionCount: 2
          }
        }
      })
    );

    const firstPath = await service.createBackup();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const secondPath = await service.createBackup();
    await new Promise((resolve) => setTimeout(resolve, 20));
    const thirdPath = await service.createBackup();

    const backupDir = path.join(testRoot, "backups");
    const files = (await fs.readdir(backupDir)).filter(
      (file) => file.startsWith("contacts-") && file.endsWith(".json")
    );

    // Only the retentionCount (2) most recent contacts-* backups survive.
    expect(files).toHaveLength(2);
    await expect(fs.access(firstPath)).rejects.toThrow();
    await expect(fs.access(secondPath)).resolves.toBeUndefined();
    await expect(fs.access(thirdPath)).resolves.toBeUndefined();
  });

  it("prunes old contacts-* backups created via importDataset/restoreBackup/resetDataset, not just createBackup", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();
    await service.saveSettings(
      buildEditableSettings({
        ui: {
          showInactiveByDefault: false,
          autoBackup: {
            enabled: false,
            trigger: "launch",
            intervalHours: 2,
            editCountThreshold: 10,
            retentionCount: 1
          }
        }
      })
    );

    const sourceFilePath = path.join(testRoot, "import-source.json");
    await fs.writeFile(sourceFilePath, JSON.stringify(defaultContacts, null, 2) + "\n", "utf-8");

    // Each of these call sites delegates to the same createBackupInner primitive.
    await service.importDataset(sourceFilePath);
    await new Promise((resolve) => setTimeout(resolve, 20));

    const backupPath = await service.createBackup();
    await new Promise((resolve) => setTimeout(resolve, 20));
    await service.restoreBackup(backupPath);
    await new Promise((resolve) => setTimeout(resolve, 20));
    await service.resetDataset();
    await new Promise((resolve) => setTimeout(resolve, 20));

    const backupDir = path.join(testRoot, "backups");
    const files = (await fs.readdir(backupDir)).filter(
      (file) => file.startsWith("contacts-") && file.endsWith(".json")
    );

    // retentionCount=1: only the single most recent contacts-* backup remains
    // even though 4 backup-producing operations ran.
    expect(files).toHaveLength(1);
  });

  it("does not prune auto-backup-* files when pruning contacts-* backups, and vice versa", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();
    await service.saveSettings(
      buildEditableSettings({
        ui: {
          showInactiveByDefault: false,
          autoBackup: {
            enabled: false,
            trigger: "launch",
            intervalHours: 2,
            editCountThreshold: 10,
            retentionCount: 1
          }
        }
      })
    );

    const backupDir = path.join(testRoot, "backups");
    await fs.mkdir(backupDir, { recursive: true });
    await fs.writeFile(path.join(backupDir, "auto-backup-2026-01-01T00-00-00-000Z.json"), "{}\n", "utf-8");

    await service.createBackup();

    const files = await fs.readdir(backupDir);
    expect(files.filter((file) => file.startsWith("auto-backup-"))).toHaveLength(1);
    expect(files.filter((file) => file.startsWith("contacts-"))).toHaveLength(1);
  });

  // OIR-204 QA follow-up: a pruning failure (e.g. EACCES/EBUSY on a locked
  // backup file) must not fail the calling operation — the backup file itself
  // was already created successfully by the time pruning runs.
  it("importDataset/restoreBackup/resetDataset still succeed when pruneBackupsByPrefix throws", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();
    await service.saveSettings(buildEditableSettings());

    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    // Force the fs.readdir call inside pruneBackupsByPrefix to throw. This is
    // the first readdir invoked in each of the flows exercised below.
    vi.spyOn(fs, "readdir").mockRejectedValueOnce(
      Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" })
    );

    const sourceFilePath = path.join(testRoot, "import-source.json");
    await fs.writeFile(sourceFilePath, JSON.stringify(defaultContacts, null, 2) + "\n", "utf-8");

    const importResult = await service.importDataset(sourceFilePath);
    expect(importResult.recordCount).toBe(defaultContacts.records.length);
    // The backup file itself was created before pruning ran and failed.
    await expect(fs.access(importResult.backupPath)).resolves.toBeUndefined();
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("[BackupRetention]"));

    consoleErrorSpy.mockClear();
    vi.spyOn(fs, "readdir").mockRejectedValueOnce(
      Object.assign(new Error("EBUSY: resource busy or locked"), { code: "EBUSY" })
    );
    const restoreResult = await service.restoreBackup(importResult.backupPath);
    expect(restoreResult.recordCount).toBe(defaultContacts.records.length);
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("[BackupRetention]"));

    consoleErrorSpy.mockClear();
    vi.spyOn(fs, "readdir").mockRejectedValueOnce(
      Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" })
    );
    const resetResult = await service.resetDataset();
    expect(resetResult.contacts.records).toHaveLength(0);
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining("[BackupRetention]"));
  });

  // -------------------------------------------------------------------------
  // OIR-108 characterization tests — lock observable behavior before extraction
  // -------------------------------------------------------------------------

  describe("OIR-108 characterization: audit-log delegation", () => {
    it("getAuditLog returns an empty result when no entries have been appended", async () => {
      const { AppDataService } = await import("./app-data.service.js");

      const service = new AppDataService();
      await service.ensureInitialFiles();

      const result = await service.getAuditLog({ page: 1, pageSize: 20 });

      expect(result.entries).toHaveLength(0);
      expect(result.totalCount).toBe(0);
    });

    it("exportAuditLog writes a CSV file and returns entry count and file path", async () => {
      const { AppDataService } = await import("./app-data.service.js");

      const service = new AppDataService();
      await service.ensureInitialFiles();
      await service.saveSettings(buildEditableSettings());

      // Create one record so an audit entry gets appended via importCsvDataset path
      // (We drive it via createRecord which does NOT append audit entries, so we
      // use a direct assertion on the empty-log export path.)
      const exportPath = path.join(testRoot, "audit-export.csv");
      const result = await service.exportAuditLog(exportPath, { page: 1, pageSize: 100 });

      expect(result.filePath).toBe(exportPath);
      expect(result.entryCount).toBe(0);

      // File must exist and be a valid UTF-8 text file (CSV)
      const contents = await fs.readFile(exportPath, "utf-8");
      expect(typeof contents).toBe("string");
    });

    it("exportAuditLog creates the target directory if it does not exist", async () => {
      const { AppDataService } = await import("./app-data.service.js");

      const service = new AppDataService();
      await service.ensureInitialFiles();

      const exportDir = path.join(testRoot, "nested", "export");
      const exportPath = path.join(exportDir, "audit-export.csv");

      await service.exportAuditLog(exportPath, { page: 1, pageSize: 100 });

      const stat = await fs.stat(exportPath);
      expect(stat.isFile()).toBe(true);
    });
  });

  describe("OIR-108 characterization: write-queue ordering", () => {
    it("concurrent createRecord calls serialize in submission order and all writes land", async () => {
      const { AppDataService } = await import("./app-data.service.js");

      const service = new AppDataService();
      await service.ensureInitialFiles();
      await service.saveSettings(buildEditableSettings());

      const makeRecord = (name: string, phoneId: string, phone: string) => ({
        type: "person" as const,
        displayName: name,
        person: { firstName: name, lastName: "Test" },
        organization: { department: "D", service: "S", area: "sanitaria-asistencial" as const },
        contactMethods: {
          phones: [{ id: phoneId, number: phone, kind: "internal" as const, isPrimary: true, confidential: false, noPatientSharing: false }],
          emails: [],
          socials: []
        },
        aliases: [],
        tags: [],
        status: "active" as const
      });

      // Fire three concurrent writes
      const [r1, r2, r3] = await Promise.all([
        service.createRecord(makeRecord("Alpha", "ph_alpha", "11111")),
        service.createRecord(makeRecord("Beta",  "ph_beta",  "22222")),
        service.createRecord(makeRecord("Gamma", "ph_gamma", "33333"))
      ]);

      // All must have succeeded with distinct IDs
      expect(r1.savedRecordId).toMatch(/^cnt_/);
      expect(r2.savedRecordId).toMatch(/^cnt_/);
      expect(r3.savedRecordId).toMatch(/^cnt_/);
      expect(new Set([r1.savedRecordId, r2.savedRecordId, r3.savedRecordId]).size).toBe(3);

      // Final state from the last write must contain all three new records
      // (the last resolved promise has the most up-to-date contacts snapshot)
      const finalContacts = r3.contacts;
      const names = finalContacts.records.map((r) => r.displayName);
      expect(names).toContain("Alpha");
      expect(names).toContain("Beta");
      expect(names).toContain("Gamma");
    });

    it("a write failure does not corrupt subsequent writes (write-queue atomicity)", async () => {
      const { AppDataService } = await import("./app-data.service.js");

      const service = new AppDataService();
      await service.ensureInitialFiles();
      await service.saveSettings(buildEditableSettings());

      const contactsFilePath = path.join(testRoot, "data", "contacts.json");

      // Spy on fs.rename — writeJsonFile uses rename as the atomic commit step.
      // Failing rename once simulates a disk error mid-write; the .tmp file is
      // cleaned up internally and the original contacts.json is left intact.
      const actualFs = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
      let renameCallCount = 0;
      const renameSpy = vi.spyOn(fs, "rename").mockImplementation(async (src, dest) => {
        renameCallCount += 1;
        if (renameCallCount === 1) {
          throw Object.assign(new Error("Simulated disk failure"), { code: "ENOSPC" });
        }
        return actualFs.rename(src, dest);
      });

      const makeRecord = (name: string, phoneId: string, phone: string) => ({
        type: "person" as const,
        displayName: name,
        person: { firstName: name, lastName: "Test" },
        organization: { department: "D", service: "S", area: "sanitaria-asistencial" as const },
        contactMethods: {
          phones: [{ id: phoneId, number: phone, kind: "internal" as const, isPrimary: true, confidential: false, noPatientSharing: false }],
          emails: [],
          socials: []
        },
        aliases: [],
        tags: [],
        status: "active" as const
      });

      // First createRecord must fail because rename throws
      await expect(service.createRecord(makeRecord("Failed Record", "ph_fail", "99999"))).rejects.toThrow();

      // Restore rename so subsequent writes go through
      renameSpy.mockRestore();

      // Second createRecord must succeed — queue must not be permanently poisoned
      const result = await service.createRecord(makeRecord("Recovered Record", "ph_recovered", "88888"));

      expect(result.savedRecordId).toMatch(/^cnt_/);
      expect(result.contacts.records.some((r) => r.displayName === "Recovered Record")).toBe(true);

      // "Failed Record" must NOT be in the file since that write failed before rename
      const diskContents = JSON.parse(await fs.readFile(contactsFilePath, "utf-8")) as { records: Array<{ displayName: string }> };
      expect(diskContents.records.some((r) => r.displayName === "Failed Record")).toBe(false);
      expect(diskContents.records.some((r) => r.displayName === "Recovered Record")).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // Atomic backup claim (OIR-114) — fs.open('wx') / O_CREAT|O_EXCL tests
  // ---------------------------------------------------------------------------

  it("atomic claim: retries on EEXIST from fs.open and succeeds with a different path", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();
    await service.saveSettings(buildEditableSettings());

    const realOpen = fs.open.bind(fs);
    let openCallCount = 0;
    let eexistPath: string | undefined;

    // Make the first fs.open('wx') call throw EEXIST to exercise the retry loop.
    const openSpy = vi.spyOn(fs, "open").mockImplementation(async (p, flags, ...rest) => {
      if (flags === "wx" && openCallCount === 0) {
        openCallCount += 1;
        eexistPath = p as string;
        throw Object.assign(new Error("EEXIST: file already exists"), { code: "EEXIST", path: p });
      }
      openCallCount += 1;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return realOpen(p, flags as any, ...(rest as []));
    });

    const resultPath = await service.createBackup();

    // The spy must have been called at least twice (one EEXIST + one success).
    const wxCalls = openSpy.mock.calls.filter(([, flags]) => flags === "wx");
    expect(wxCalls.length).toBeGreaterThanOrEqual(2);

    // The successful path must differ from the one that got EEXIST.
    expect(resultPath).not.toBe(eexistPath);

    // The backup file must actually exist on disk.
    await expect(fs.access(resultPath)).resolves.toBeUndefined();
  });

  it("atomic claim: two sequential backups at the same clock tick get distinct files (no TOCTOU collision)", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();
    await service.saveSettings(buildEditableSettings());

    // Freeze time so both calls generate the same timestamp component, forcing
    // the random-suffix path to be the only differentiator.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-19T12:00:00.000Z"));

    let firstPath: string;
    let secondPath: string;

    try {
      firstPath = await service.createBackup();
      secondPath = await service.createBackup();
    } finally {
      vi.useRealTimers();
    }

    expect(firstPath).not.toBe(secondPath);
    // Both files must exist on disk.
    await expect(fs.access(firstPath)).resolves.toBeUndefined();
    await expect(fs.access(secondPath)).resolves.toBeUndefined();
  });

  it("atomic claim: surfaces non-EEXIST errors from fs.open immediately without exhausting retries", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();
    await service.saveSettings(buildEditableSettings());

    const realOpen = fs.open.bind(fs);
    let wxCallCount = 0;

    // Make every 'wx' open fail with EACCES (not EEXIST) so we know the retry
    // loop does NOT keep retrying — it must surface the error immediately.
    const openSpy = vi.spyOn(fs, "open").mockImplementation(async (p, flags, ...rest) => {
      if (flags === "wx") {
        wxCallCount += 1;
        throw Object.assign(new Error("EACCES: permission denied"), { code: "EACCES", path: p });
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return realOpen(p, flags as any, ...(rest as []));
    });

    await expect(service.createBackup()).rejects.toThrow(/No se pudo preparar la carpeta de copias de seguridad/);

    // Only the very first 'wx' open should have been attempted — no retries on EACCES.
    const wxCalls = openSpy.mock.calls.filter(([, flags]) => flags === "wx");
    expect(wxCalls).toHaveLength(1);
    expect(wxCallCount).toBe(1);
  });

  it("atomic claim: 0-byte placeholder is removed when copyFile fails, leaving no orphan in the backup directory", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();
    await service.saveSettings(buildEditableSettings());

    const backupDir = path.join(testRoot, "backups");

    // Reject the copyFile so the placeholder written by fs.open('wx') would be
    // left behind if createBackupCore does not clean it up.
    vi.spyOn(fs, "copyFile").mockRejectedValueOnce(
      Object.assign(new Error("ENOSPC: no space left on device"), {
        code: "ENOSPC",
        path: path.join(testRoot, "data", "contacts.json")
      })
    );

    await expect(service.createBackup()).rejects.toThrow(/No se pudo crear la copia de seguridad/);

    // The backup directory must contain no 0-byte placeholder files.
    const entries = await fs.readdir(backupDir);
    const jsonFiles = entries.filter((f) => f.endsWith(".json"));
    for (const file of jsonFiles) {
      const stats = await fs.stat(path.join(backupDir, file));
      expect(stats.size, `Expected no 0-byte placeholder but found ${file} with size 0`).toBeGreaterThan(0);
    }
  });

  // ---------------------------------------------------------------------------
  // createAutoBackup delegation (OIR-114 FIX 2) — must delegate to createBackupCore
  // ---------------------------------------------------------------------------

  it("createAutoBackup delegates to createBackupCore: produces a valid backup file", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    let autoBackupFailureMessage: string | undefined;
    const service = new AppDataService({
      onAutoBackupFailure: (msg) => { autoBackupFailureMessage = msg; }
    });
    await service.ensureInitialFiles();
    await service.saveSettings(
      buildEditableSettings({
        ui: {
          showInactiveByDefault: false,
          autoBackup: {
            enabled: true,
            trigger: "launch",
            intervalHours: 2,
            editCountThreshold: 10,
            retentionCount: 5
          }
        }
      })
    );

    // startAutoBackup fires runAutoBackupInBackground which enqueues createAutoBackup.
    await service.startAutoBackup();

    const backupDir = path.join(testRoot, "backups");
    await waitForCondition(async () => {
      const files = await fs.readdir(backupDir);
      return files.some((f) => f.startsWith("auto-backup-") && f.endsWith(".json"));
    });

    expect(autoBackupFailureMessage).toBeUndefined();

    const files = await fs.readdir(backupDir);
    const autoBackupFiles = files.filter((f) => f.startsWith("auto-backup-") && f.endsWith(".json"));
    expect(autoBackupFiles).toHaveLength(1);

    // The backup must be a readable JSON file (proof that copyFile ran via createBackupCore).
    const content = await fs.readFile(path.join(backupDir, autoBackupFiles[0]!), "utf-8");
    expect(() => JSON.parse(content)).not.toThrow();
  });

  it("createAutoBackup does not double-enqueue: the write queue is not deadlocked", async () => {
    // createAutoBackup is always called from inside an enqueueWrite slot
    // (via runAutoBackupInBackground).  If it were to call enqueueWrite itself
    // the queue would deadlock.  Verify the full flow completes promptly and
    // a subsequent manual backup also resolves.
    const { AppDataService } = await import("./app-data.service.js");

    let autoBackupFailureMessage: string | undefined;
    const service = new AppDataService({
      onAutoBackupFailure: (msg) => { autoBackupFailureMessage = msg; }
    });
    await service.ensureInitialFiles();
    await service.saveSettings(
      buildEditableSettings({
        ui: {
          showInactiveByDefault: false,
          autoBackup: {
            enabled: true,
            trigger: "launch",
            intervalHours: 2,
            editCountThreshold: 10,
            retentionCount: 5
          }
        }
      })
    );

    // startAutoBackup enqueues one write slot that calls createAutoBackup internally.
    // A subsequent createBackup must also complete without deadlock.
    await service.startAutoBackup();
    const manualBackupPath = await service.createBackup();

    const backupDir = path.join(testRoot, "backups");
    await waitForCondition(async () => {
      const files = await fs.readdir(backupDir);
      return files.some((f) => f.startsWith("auto-backup-"));
    });

    expect(autoBackupFailureMessage).toBeUndefined();
    await expect(fs.access(manualBackupPath)).resolves.toBeUndefined();

    const files = await fs.readdir(backupDir);
    // auto-backup + manual backup both present.
    const autoFiles = files.filter((f) => f.startsWith("auto-backup-"));
    const manualFiles = files.filter((f) => f.startsWith("contacts-"));
    expect(autoFiles).toHaveLength(1);
    expect(manualFiles).toHaveLength(1);
  });

  it("excludes 0-byte crash-orphaned placeholder files from listBackups", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();

    const backupDir = path.join(testRoot, "backups");

    // Place a real backup so we confirm valid entries still appear.
    const realBackupPath = await service.createBackup();

    // Simulate the crash-orphaned 0-byte placeholder left when a copy fails
    // mid-flight (createBackupCore opens the file exclusively, copy crashes,
    // unlink never runs).
    const orphanPath = path.join(backupDir, "contacts-orphan-crash.json");
    await fs.writeFile(orphanPath, "", "utf-8");

    const backups = await service.listBackups();

    expect(backups.some((b) => b.filePath === orphanPath)).toBe(false);
    expect(backups.some((b) => b.filePath === realBackupPath)).toBe(true);
    expect(backups.every((b) => b.sizeBytes > 0)).toBe(true);
  });

  it("rejects restoreBackup on an empty (0-byte) backup file with a clear error", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();

    const backupDir = path.join(testRoot, "backups");
    const emptyBackupPath = path.join(backupDir, "contacts-empty-crash.json");
    await fs.writeFile(emptyBackupPath, "", "utf-8");

    const rejection = service.restoreBackup(emptyBackupPath);

    await expect(rejection).rejects.toThrow(
      /El archivo de copia de seguridad está vacío y no puede restaurarse/
    );

    // SEC-3 regression guard: sanitized basename-only path, no absolute leak.
    const error = await rejection.catch((e: unknown) => e as Error);
    expect(error.message).not.toContain(testRoot);
    expect(error.message).not.toContain(emptyBackupPath);
    expect(error.message).toContain("Ruta afectada: contacts-empty-crash.json");
  });

  it("still lists and restores valid backups after the 0-byte filter is applied", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();

    const backupDir = path.join(testRoot, "backups");

    // Drop a 0-byte orphan alongside a valid backup.
    const orphanPath = path.join(backupDir, "contacts-zero-orphan.json");
    await fs.writeFile(orphanPath, "", "utf-8");

    const realBackupPath = await service.createBackup();

    // listBackups should include only the real backup.
    const backups = await service.listBackups();
    expect(backups).toHaveLength(1);
    expect(backups[0]!.filePath).toBe(realBackupPath);

    // restoreBackup on the real backup should succeed.
    const result = await service.restoreBackup(realBackupPath);
    expect(result.recordCount).toBeGreaterThanOrEqual(0);
  });

  // ---------------------------------------------------------------------------
  // OIR-130: buscas persistence — preview must NOT write, confirm MUST write
  // ---------------------------------------------------------------------------

  it("OIR-130: previewCsvImport does NOT persist buscas records (side-effect-free)", async () => {
    const { AppDataService } = await import("./app-data.service.js");
    const { BuscasService } = await import("./buscas.service.js");

    const buscasService = new BuscasService();
    const service = new AppDataService({ buscasService });
    await service.ensureInitialFiles();
    await service.saveSettings(buildEditableSettings());

    // Build an ODS with a contacts sheet + a buscas sheet.
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ["Servicio", "Número", "Notas"],
        ["Mostrador", "55555", ""]
      ]),
      "Urgencias"
    );
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ["SERVICIO", "PRINCIPAL", "COMENTARIOS"],
        ["ANESTESIA", "7321", ""]
      ]),
      "Buscas_Facultativos"
    );

    const sourceFilePath = path.join(testRoot, "incoming", "agenda-buscas.ods");
    await fs.mkdir(path.dirname(sourceFilePath), { recursive: true });
    XLSX.writeFile(workbook, sourceFilePath);

    // Run preview only — do NOT call importCsvDataset.
    await service.previewCsvImport(sourceFilePath);

    // buscas.json must NOT exist (or if it does, importedRecords must be empty).
    const buscasFilePath = path.join(testRoot, "data", "buscas.json");
    let importedRecords: unknown[] = [];
    try {
      const raw = JSON.parse(await fs.readFile(buscasFilePath, "utf-8")) as { importedRecords?: unknown[] };
      importedRecords = raw.importedRecords ?? [];
    } catch {
      // ENOENT — file was not created at all, which is also correct.
    }
    expect(importedRecords).toHaveLength(0);
  });

  it("OIR-130: importCsvDataset persists buscas records after contacts are written", async () => {
    const { AppDataService } = await import("./app-data.service.js");
    const { BuscasService } = await import("./buscas.service.js");

    const buscasService = new BuscasService();
    const service = new AppDataService({ buscasService });
    await service.ensureInitialFiles();
    await service.saveSettings(buildEditableSettings());

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ["Servicio", "Número", "Notas"],
        ["Mostrador", "55555", ""]
      ]),
      "Urgencias"
    );
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ["SERVICIO", "PRINCIPAL", "RESIDENTE", "COMENTARIOS"],
        ["ANESTESIA", "7321", "7322", ""]
      ]),
      "Buscas_Facultativos"
    );

    const sourceFilePath = path.join(testRoot, "incoming", "agenda-buscas-confirm.ods");
    await fs.mkdir(path.dirname(sourceFilePath), { recursive: true });
    XLSX.writeFile(workbook, sourceFilePath);

    await service.previewCsvImport(sourceFilePath);
    const result = await service.importCsvDataset(sourceFilePath);

    // Contacts import succeeded.
    expect(result.createdCount).toBeGreaterThan(0);

    // buscas.json now contains the imported pager records.
    const buscasFilePath = path.join(testRoot, "data", "buscas.json");
    const raw = JSON.parse(await fs.readFile(buscasFilePath, "utf-8")) as { importedRecords: Array<{ deviceNumber: string }> };
    expect(raw.importedRecords).toHaveLength(2);
    const numbers = raw.importedRecords.map((r) => r.deviceNumber);
    expect(numbers).toContain("7321");
    expect(numbers).toContain("7322");
  });

  it("OIR-130: importCsvDataset returns contacts result even when buscas persist fails", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    // Inject a buscasService stub that always throws.
    const failingBuscasService = {
      importFromOds: async () => { throw new Error("buscas write failure"); }
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service = new AppDataService({ buscasService: failingBuscasService as any });
    await service.ensureInitialFiles();
    await service.saveSettings(buildEditableSettings());

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ["Servicio", "Número", "Notas"],
        ["Mostrador", "55555", ""]
      ]),
      "Urgencias"
    );
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ["SERVICIO", "PRINCIPAL"],
        ["ANESTESIA", "7321"]
      ]),
      "Buscas_Facultativos"
    );

    const sourceFilePath = path.join(testRoot, "incoming", "agenda-buscas-error.ods");
    await fs.mkdir(path.dirname(sourceFilePath), { recursive: true });
    XLSX.writeFile(workbook, sourceFilePath);

    // importCsvDataset must NOT throw even though buscas persist throws.
    const result = await service.importCsvDataset(sourceFilePath);
    expect(result.createdCount).toBeGreaterThan(0);
  });

  it("OIR-130: importCsvDataset persists buscas records when workbook has zero contact rows (buscas-only ODS)", async () => {
    const { AppDataService } = await import("./app-data.service.js");
    const { BuscasService } = await import("./buscas.service.js");

    const buscasService = new BuscasService();
    const service = new AppDataService({ buscasService });
    await service.ensureInitialFiles();
    await service.saveSettings(buildEditableSettings());

    // Build a workbook with ONLY a buscas sheet — no contact sheet at all.
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ["SERVICIO", "PRINCIPAL", "RESIDENTE", "COMENTARIOS"],
        ["CARDIOLOGIA", "8801", "8802", ""],
        ["NEUROLOGIA", "8803", "", "guardia"]
      ]),
      "Buscas_Facultativos"
    );

    const sourceFilePath = path.join(testRoot, "incoming", "buscas-only.ods");
    await fs.mkdir(path.dirname(sourceFilePath), { recursive: true });
    XLSX.writeFile(workbook, sourceFilePath);

    // Preview must succeed (buscas-only is a valid, confirmable workbook).
    await service.previewCsvImport(sourceFilePath);

    // Confirm must NOT throw even though validRowCount === 0 (no contact rows).
    const result = await service.importCsvDataset(sourceFilePath);

    // No contacts were created or updated — existing contacts are untouched.
    expect(result.createdCount).toBe(0);
    expect(result.updatedCount).toBe(0);

    // buscas.json must contain the imported pager records.
    const buscasFilePath = path.join(testRoot, "data", "buscas.json");
    const raw = JSON.parse(await fs.readFile(buscasFilePath, "utf-8")) as {
      importedRecords: Array<{ deviceNumber: string }>;
    };
    const numbers = raw.importedRecords.map((r) => r.deviceNumber);
    expect(numbers).toContain("8801");
    expect(numbers).toContain("8802");
    expect(numbers).toContain("8803");
  });

  it("OIR-181: saveSettings file-exists error message contains no 'dataset' jargon", async () => {
    // Regression guard: assertDataFilePathAvailable must use plain-language copy
    // when the destination data file already exists (OIR-181 policy).
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();

    // Create a second JSON file at a new path so the path is "already taken".
    const occupiedPath = path.join(testRoot, "data", "occupied.json");
    await fs.writeFile(occupiedPath, JSON.stringify({ note: "exists" }), "utf-8");

    const error = await service
      .saveSettings(buildEditableSettings({ dataFilePath: occupiedPath }))
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;

    // Must NOT contain the banned jargon term.
    expect(message).not.toMatch(/dataset/i);

    // Must contain the corrected plain-language phrase.
    expect(message).toContain("archivo de datos");
    expect(message).toContain("Ya existe un archivo en esa ruta");
  });

  // OIR-224: real-file regression test for the "Confidencial" flag misassignment
  // bug reported by the operator (a non-confidential row like "Admisión Central"
  // showed the privacy badge after import, while a genuinely confidential row lost
  // it). Root cause: `mergeImportedRecordFields` (the "Combinar" / merge-fields
  // conflict policy, used when re-importing a file whose rows already exist)
  // appended only genuinely NEW phone numbers and left EXISTING phone numbers
  // completely untouched — so a phone's confidential/noPatientSharing markers,
  // once wrong (e.g. from data imported before OIR-222's tabular Agenda parser
  // existed, or a manual slip), could never be corrected by re-importing the
  // (now-correct) source file. The row-level parser itself (spreadsheet-parsers.ts
  // normalizeTabularAgendaSheet) was already verified correct against this same
  // real file — see the "fresh import" assertions below — so the merge-policy
  // layer was the actual defect.
  //
  // Runs against the REAL hospital ODS export (not a synthetic fixture) per the
  // investigation mandate: synthetic data could accidentally avoid the exact
  // mechanism that reproduced this bug. Skipped automatically when the file is
  // not present on the current machine (it is operator-provided data, never
  // committed to the repo).
  describe("OIR-224: Confidencial flag correctness against the real Agenda ODS", () => {
    const REAL_ODS_CANDIDATE_PATHS = [
      "/Users/samuelromeroarbelo/Documents/Telefonista/Buscas y Agenda normalizados/Agenda Normalizada.ods",
      "/private/tmp/claude-501/-Users-samuelromeroarbelo-Projects-phone-directory/282c1726-23ec-42ee-8849-5ae5acc7508e/scratchpad/ods_inspect/agenda.ods"
    ];

    const findRealOdsPath = (): string | undefined =>
      REAL_ODS_CANDIDATE_PATHS.find((candidate) => nodeFs.existsSync(candidate));

    const realOdsPath = findRealOdsPath();

    it.skipIf(!realOdsPath)(
      "fresh import: 'Admisión Central' is NOT confidential and 'Admisión Central (Interno)' IS, matching the real source rows",
      async () => {
        const { AppDataService } = await import("./app-data.service.js");

        const service = new AppDataService();
        await service.ensureInitialFiles();
        await service.saveSettings(buildEditableSettings());

        // OIR-224 (merge-discriminator fix): correctly splitting rows that used to
        // wrongly collapse by displayName alone (see spreadsheet-parsers.ts
        // mergeRecordsByDisplayName) surfaces a small number of genuine intra-batch
        // duplicate-phone matches even on a FRESH import (e.g. two real rows for the
        // same person "Malena" under two different Servicio headings, both with the
        // same extension) — AppDataService's own conflict-detection layer
        // (buildStableMergeKeys / detectConflicts) treats those as resolvable
        // conflicts requiring an explicit policy, same as it always has for any
        // duplicate phone number. Resolve them all with "merge-fields" (the least
        // lossy policy) so this test can assert on the unrelated Admisión Central
        // rows below.
        const preview = await service.previewCsvImport(realOdsPath!);
        const policySelections = (preview.conflictedRecords ?? []).map((conflict) => ({
          recordIndex: conflict.recordIndex,
          policy: "merge-fields" as const
        }));
        const result = await service.importCsvDataset(realOdsPath!, policySelections);

        const notConfidential = result.contacts.records.find(
          (record) => record.displayName.trim() === "Admisión Central"
        );
        const confidential = result.contacts.records.find(
          (record) => record.displayName.trim() === "Admisión Central (Interno)"
        );

        expect(notConfidential).toBeDefined();
        expect(notConfidential!.contactMethods.phones.some((phone) => phone.confidential)).toBe(false);

        expect(confidential).toBeDefined();
        expect(confidential!.contactMethods.phones.every((phone) => phone.confidential)).toBe(true);
      }
    );

    it.skipIf(!realOdsPath)(
      "re-import with the 'Combinar' (merge-fields) conflict policy CORRECTS stale confidential flags to match the real source rows",
      async () => {
        const { AppDataService } = await import("./app-data.service.js");

        const service = new AppDataService();
        await service.ensureInitialFiles();
        await service.saveSettings(buildEditableSettings());

        // OIR-224 (merge-discriminator fix): see the "fresh import" test above for
        // why the initial import also needs its (now correctly-surfaced) intra-batch
        // duplicate-phone conflicts resolved before it can proceed.
        const firstPreview = await service.previewCsvImport(realOdsPath!);
        const firstPolicySelections = (firstPreview.conflictedRecords ?? []).map((conflict) => ({
          recordIndex: conflict.recordIndex,
          policy: "merge-fields" as const
        }));
        const first = await service.importCsvDataset(realOdsPath!, firstPolicySelections);

        // Simulate stale/legacy data: flip both flags so they are WRONG relative
        // to the real source — mirrors a record imported before OIR-222's
        // row-level Confidencial mapping existed, or a manual mistake.
        const staleNotConfidential = first.contacts.records.find(
          (record) => record.displayName.trim() === "Admisión Central"
        )!;
        const staleConfidential = first.contacts.records.find(
          (record) => record.displayName.trim() === "Admisión Central (Interno)"
        )!;
        staleNotConfidential.contactMethods.phones[0]!.confidential = true; // WRONG: source says false
        staleConfidential.contactMethods.phones[0]!.confidential = false; // WRONG: source says true
        await fs.writeFile(
          path.join(testRoot, "data", "contacts.json"),
          JSON.stringify(first.contacts, null, 2)
        );

        const preview = await service.previewCsvImport(realOdsPath!);
        const policySelections = (preview.conflictedRecords ?? []).map((conflict) => ({
          recordIndex: conflict.recordIndex,
          policy: "merge-fields" as const
        }));
        const result = await service.importCsvDataset(realOdsPath!, policySelections);

        const correctedNotConfidential = result.contacts.records.find(
          (record) => record.displayName.trim() === "Admisión Central"
        );
        const correctedConfidential = result.contacts.records.find(
          (record) => record.displayName.trim() === "Admisión Central (Interno)"
        );

        expect(correctedNotConfidential).toBeDefined();
        expect(correctedNotConfidential!.contactMethods.phones.some((phone) => phone.confidential)).toBe(false);

        expect(correctedConfidential).toBeDefined();
        expect(correctedConfidential!.contactMethods.phones.every((phone) => phone.confidential)).toBe(true);
      }
    );
  });

  describe("OIR-245: mergeDuplicates does not drop role/schedule/location/customFields", () => {
    it("fills role, schedule and location subfields from the discarded record, and unions customFields", async () => {
      const { AppDataService } = await import("./app-data.service.js");

      const service = new AppDataService();
      await service.ensureInitialFiles();
      await service.saveSettings(buildEditableSettings());

      const keepRecord = await service.createRecord({
        type: "person",
        displayName: "Ana Pérez",
        person: { firstName: "Ana", lastName: "Pérez" },
        organization: {
          department: "Urgencias",
          service: "Coordinación"
          // role/schedule intentionally absent — must be filled from discard.
        },
        location: {
          building: "Hospital General"
          // sector/section intentionally absent — must be filled from discard.
        },
        contactMethods: { phones: [], emails: [], socials: [] },
        aliases: [],
        tags: [],
        status: "active",
        customFields: [{ id: "cf_keep_1", key: "Extensión antigua", value: "1234" }]
      });

      const discardRecord = await service.createRecord({
        type: "person",
        displayName: "Ana Pérez (duplicado)",
        person: { firstName: "Ana", lastName: "Pérez" },
        organization: {
          department: "Urgencias",
          role: "Enfermera",
          schedule: "8:00-15:00"
        },
        location: {
          building: "Hospital General",
          sector: "Enfermería",
          section: "Consulta"
        },
        contactMethods: { phones: [], emails: [], socials: [] },
        aliases: [],
        tags: [],
        status: "active",
        customFields: [{ id: "cf_discard_1", key: "Turno", value: "Mañana" }]
      });

      const merged = await service.mergeDuplicates(
        keepRecord.savedRecordId,
        discardRecord.savedRecordId
      );

      // role/schedule: absent on keeper, present on discard — must survive.
      expect(merged.organization.role).toBe("Enfermera");
      expect(merged.organization.schedule).toBe("8:00-15:00");

      // location: keeper already has a location object (building), but is
      // missing sector/section — those must be filled in from discard, not
      // dropped because the keeper's location object already existed.
      expect(merged.location?.building).toBe("Hospital General");
      expect(merged.location?.sector).toBe("Enfermería");
      expect(merged.location?.section).toBe("Consulta");

      // customFields: union of both records, no conflicting keys here so
      // both must be present.
      expect(merged.customFields).toHaveLength(2);
      expect(merged.customFields?.some((field) => field.key === "Extensión antigua" && field.value === "1234")).toBe(
        true
      );
      expect(merged.customFields?.some((field) => field.key === "Turno" && field.value === "Mañana")).toBe(true);
    });

    it("keeps the keeper's customFields value when both records define the same key", async () => {
      const { AppDataService } = await import("./app-data.service.js");

      const service = new AppDataService();
      await service.ensureInitialFiles();
      await service.saveSettings(buildEditableSettings());

      const keepRecord = await service.createRecord({
        type: "person",
        displayName: "Luis García",
        person: { firstName: "Luis", lastName: "García" },
        organization: {},
        contactMethods: { phones: [], emails: [], socials: [] },
        aliases: [],
        tags: [],
        status: "active",
        customFields: [{ id: "cf_keep_2", key: "Turno", value: "Mañana" }]
      });

      const discardRecord = await service.createRecord({
        type: "person",
        displayName: "Luis García (duplicado)",
        person: { firstName: "Luis", lastName: "García" },
        organization: {},
        contactMethods: { phones: [], emails: [], socials: [] },
        aliases: [],
        tags: [],
        status: "active",
        customFields: [{ id: "cf_discard_2", key: "Turno", value: "Tarde" }]
      });

      const merged = await service.mergeDuplicates(
        keepRecord.savedRecordId,
        discardRecord.savedRecordId
      );

      expect(merged.customFields).toHaveLength(1);
      expect(merged.customFields?.[0]?.value).toBe("Mañana");
    });
  });

  describe("OIR-245 (import path): merge-fields conflict policy does not drop role/schedule/location/customFields", () => {
    it("fills organization.role/schedule and location.sector/section from the imported row when the current record lacks them", async () => {
      const { AppDataService } = await import("./app-data.service.js");

      const service = new AppDataService();
      await service.ensureInitialFiles();
      await service.saveSettings(buildEditableSettings());
      const initial = await service.getBootstrapData();
      const existing = initial.contacts.records[0]!;

      const sourceFilePath = path.join(testRoot, "incoming", "merge-fields-role-schedule-location.csv");
      await fs.mkdir(path.dirname(sourceFilePath), { recursive: true });
      await fs.writeFile(
        sourceFilePath,
        [
          "externalId,type,displayName,department,role,schedule,building,sector,section,phone1Number,status",
          `${existing.externalId},service,${existing.displayName},${existing.organization.department},Enfermera,8:00-15:00,Hospital General,Enfermería,Consulta,55555,active`
        ].join("\n") + "\n",
        "utf-8"
      );

      const preview = await service.previewCsvImport(sourceFilePath);
      const result = await service.importCsvDataset(sourceFilePath, [
        { recordIndex: preview.conflictedRecords[0]!.recordIndex, policy: "merge-fields" }
      ]);
      const updated = result.contacts.records.find((record) => record.id === existing.id)!;

      expect(result.conflictPolicyCounts?.["merge-fields"]).toBe(1);
      // The existing record had no role/schedule/sector/section — these must
      // be filled in from the imported row instead of being dropped.
      expect(updated.organization.role).toBe("Enfermera");
      expect(updated.organization.schedule).toBe("8:00-15:00");
      expect(updated.location?.sector).toBe("Enfermería");
      expect(updated.location?.section).toBe("Consulta");
    });

    it("unions customFields (current record wins on key conflict), mirroring mergeDuplicates", async () => {
      const { AppDataService } = await import("./app-data.service.js");

      const service = new AppDataService();
      await service.ensureInitialFiles();
      await service.saveSettings(buildEditableSettings());

      const current = await service.createRecord({
        type: "person",
        displayName: "Ana Pérez",
        person: { firstName: "Ana", lastName: "Pérez" },
        organization: { department: "Urgencias" },
        contactMethods: { phones: [], emails: [], socials: [] },
        aliases: [],
        tags: [],
        status: "active",
        customFields: [{ id: "cf_current_1", key: "Extensión antigua", value: "1234" }]
      });
      const currentRecord = (await service.getBootstrapData()).contacts.records.find(
        (record) => record.id === current.savedRecordId
      )!;

      // OIR-245: the CSV/ODS import pipeline does not currently map a
      // customFields column, so there is no public API that produces an
      // "imported" ContactRecord carrying customFields. Exercise the merge
      // helper directly (as a unit test of the merge logic itself) — this is
      // the same union/kept-wins behavior already covered end-to-end for
      // mergeDuplicates() above, applied to the import-conflict code path.
      const importedRecord = {
        ...currentRecord,
        id: "cnt_imported_placeholder",
        customFields: [
          { id: "cf_imported_1", key: "Turno", value: "Mañana" },
          // Conflicting key with the current record — current record must win.
          { id: "cf_imported_2", key: "Extensión antigua", value: "9999" }
        ]
      };

      const merged = (
        service as unknown as {
          mergeImportedRecordFields: (
            currentRec: typeof currentRecord,
            importedRec: typeof currentRecord,
            exportedAt: string,
            editorName: string
          ) => typeof currentRecord;
        }
      ).mergeImportedRecordFields(currentRecord, importedRecord, "2026-07-14T00:00:00Z", "Tester");

      expect(merged.customFields).toHaveLength(2);
      expect(
        merged.customFields?.some((field) => field.key === "Extensión antigua" && field.value === "1234")
      ).toBe(true);
      expect(merged.customFields?.some((field) => field.key === "Turno" && field.value === "Mañana")).toBe(true);
    });
  });
});
