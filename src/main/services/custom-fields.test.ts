/**
 * Custom key-value fields on a contact.
 *
 * Integration test: confirms customFields round-trips through the existing
 * generic create/update-contact IPC flow (AppDataService.createRecord /
 * updateRecord) without any field-specific persistence code, mirroring the
 * H-01 socials regression test in social-contact-methods.test.ts.
 */

import nodeFs from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import XLSX from "xlsx";

XLSX.set_fs(nodeFs);

const getPathMock = vi.fn();

vi.mock("electron", () => ({
  app: {
    getPath: getPathMock
  }
}));

describe("customFields survive createRecord + updateRecord", () => {
  let testRoot: string;

  beforeEach(async () => {
    testRoot = await fs.mkdtemp(path.join(os.tmpdir(), "customfields-"));
    getPathMock.mockImplementation(() => testRoot);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    getPathMock.mockReset();
    await fs.rm(testRoot, { recursive: true, force: true });
  });

  it("a custom field survives createRecord and a subsequent updateRecord", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();
    await service.saveSettings({
      editorName: "Test",
      dataFilePath: path.join(testRoot, "data", "contacts.json"),
      backupDirectoryPath: path.join(testRoot, "backups"),
      ui: {
        showInactiveByDefault: false,
        autoBackup: {
          enabled: false,
          trigger: "launch",
          intervalHours: 2,
          editCountThreshold: 10,
          retentionCount: 5
        }
      }
    });

    // Step 1: create a contact WITH a custom field.
    const created = await service.createRecord({
      beepers: [],
      type: "person",
      displayName: "Contacto Demo",
      organization: {},
      contactMethods: { phones: [], emails: [], socials: [] },
      aliases: [],
      tags: [],
      customFields: [{ id: "cf_001", key: "Número extranjero", value: "+34 600 000 000" }],
      status: "active"
    });

    const createdRecord = created.contacts.records.find((r) => r.id === created.savedRecordId);
    expect(createdRecord?.customFields).toHaveLength(1);
    expect(createdRecord?.customFields?.[0]).toEqual({
      id: "cf_001",
      key: "Número extranjero",
      value: "+34 600 000 000"
    });

    // Step 2: updateRecord — change only displayName; the custom field must survive.
    const updated = await service.updateRecord(created.savedRecordId, {
      beepers: [],
      type: "person",
      displayName: "Contacto Demo (actualizado)",
      organization: {},
      contactMethods: { phones: [], emails: [], socials: [] },
      aliases: [],
      tags: [],
      customFields: [{ id: "cf_001", key: "Número extranjero", value: "+34 600 000 000" }],
      status: "active"
    });

    const updatedRecord = updated.contacts.records.find((r) => r.id === created.savedRecordId);
    expect(updatedRecord?.displayName).toBe("Contacto Demo (actualizado)");
    expect(updatedRecord?.customFields).toHaveLength(1);
    expect(updatedRecord?.customFields?.[0]).toEqual({
      id: "cf_001",
      key: "Número extranjero",
      value: "+34 600 000 000"
    });
  });

  it("a contact created without customFields has no customFields on the persisted record", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();
    await service.saveSettings({
      editorName: "Test",
      dataFilePath: path.join(testRoot, "data", "contacts.json"),
      backupDirectoryPath: path.join(testRoot, "backups"),
      ui: {
        showInactiveByDefault: false,
        autoBackup: {
          enabled: false,
          trigger: "launch",
          intervalHours: 2,
          editCountThreshold: 10,
          retentionCount: 5
        }
      }
    });

    const created = await service.createRecord({
      beepers: [],
      type: "person",
      displayName: "Sin campos personalizados",
      organization: {},
      contactMethods: { phones: [], emails: [], socials: [] },
      aliases: [],
      tags: [],
      status: "active"
    });

    const createdRecord = created.contacts.records.find((r) => r.id === created.savedRecordId);
    expect(createdRecord?.customFields).toBeUndefined();
  });
});
