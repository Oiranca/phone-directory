import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
});
