import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultContacts } from "../../shared/fixtures/defaultContacts.js";

const getPathMock = vi.fn();

vi.mock("electron", () => ({
  app: {
    getPath: getPathMock
  }
}));

describe("AppDataService", () => {
  let testRoot: string;

  beforeEach(async () => {
    testRoot = await fs.mkdtemp(path.join(os.tmpdir(), "phone-directory-"));
    getPathMock.mockReturnValue(testRoot);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(testRoot, { recursive: true, force: true });
    getPathMock.mockReset();
  });

  it("preserves managed filesystem paths when saving editable settings", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();

    const saved = await service.saveSettings({
      editorName: "Samuel",
      ui: {
        showInactiveByDefault: true
      }
    });

    expect(saved.editorName).toBe("Samuel");
    expect(saved.ui.showInactiveByDefault).toBe(true);
    expect(saved.dataFilePath).toBe(path.join(testRoot, "data", "contacts.json"));
    expect(saved.backupDirectoryPath).toBe(path.join(testRoot, "backups"));

    const settingsFile = path.join(testRoot, "data", "settings.json");
    const persisted = JSON.parse(await fs.readFile(settingsFile, "utf-8")) as typeof saved;

    expect(persisted).toEqual(saved);
  });

  it("creates a new record and refreshes dataset metadata", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();
    await service.saveSettings({
      editorName: "Samuel",
      ui: {
        showInactiveByDefault: false
      }
    });

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
        emails: []
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

  it("ignores client supplied ids when creating a new record", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();
    await service.saveSettings({
      editorName: "Samuel",
      ui: {
        showInactiveByDefault: false
      }
    });

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
        emails: []
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
    await service.saveSettings({
      editorName: "Samuel",
      ui: {
        showInactiveByDefault: false
      }
    });

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
        emails: []
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

  it("promotes the first phone to primary when none is marked on save", async () => {
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
        emails: []
      },
      aliases: [],
      tags: [],
      status: "active"
    });

    expect(result.contacts.records[0]?.contactMethods.phones[0]?.isPrimary).toBe(true);
    expect(result.contacts.records[0]?.contactMethods.phones[1]?.isPrimary).toBe(false);
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
      new RegExp(
        `No se pudo crear el backup del directorio\\. Ruta afectada: ${contactsFilePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\. Ruta de destino: ${backupFilePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}.*No tienes permisos suficientes para acceder al archivo o directorio\\.`
      )
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
      new RegExp(
        `No se pudo exportar el directorio al destino seleccionado\\. Ruta afectada: ${exportFilePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\. El archivo o directorio está en un sistema de solo lectura\\.`
      )
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
      new RegExp(
        `No se pudo crear el backup del directorio\\. Ruta afectada: ${contactsFilePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\. Ruta de origen: ${contactsFilePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\. Ruta de destino: ${backupDirectoryPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}.*No hay espacio suficiente en disco para completar la operación\\.`
      )
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

  it("imports a normalized CSV and replaces the dataset after backup", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();
    await service.saveSettings({
      editorName: "Samuel",
      ui: {
        showInactiveByDefault: false
      }
    });

    const sourceFilePath = path.join(testRoot, "incoming", "directory.csv");
    await fs.mkdir(path.dirname(sourceFilePath), { recursive: true });
    await fs.writeFile(
      sourceFilePath,
      [
        "type,displayName,department,area,phone1Number,phone1Kind,aliases,tags,status",
        "person,Ana Pérez,Admisión,otros,12345,internal,ana|ana,front|front,active",
        "service,Mostrador,Recepción,especialidades,55555,desk,,,inactive"
      ].join("\n") + "\n",
      "utf-8"
    );

    const result = await service.importCsvDataset(sourceFilePath);
    const persisted = JSON.parse(
      await fs.readFile(path.join(testRoot, "data", "contacts.json"), "utf-8")
    ) as { records: Array<{ displayName: string; aliases: string[]; tags: string[]; status: string }> };

    expect(result.recordCount).toBe(2);
    expect(result.warningCount).toBe(3);
    expect(result.invalidRowCount).toBe(0);
    expect(result.contacts.records[0]?.displayName).toBe("Ana Pérez");
    expect(result.contacts.records[0]?.aliases).toEqual(["ana"]);
    expect(result.contacts.records[0]?.tags).toEqual(["front"]);
    expect(result.contacts.records[1]?.contactMethods.phones[0]?.kind).toBe("other");
    expect(result.backupPath).toContain(path.join(testRoot, "backups"));
    expect(persisted.records[1]?.status).toBe("inactive");
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

  it("rejects CSV replacement when the preview still contains invalid rows", async () => {
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

    await expect(service.importCsvDataset(sourceFilePath)).rejects.toThrow(
      "El CSV contiene filas inválidas. Corrige el archivo antes de importarlo."
    );
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
});
