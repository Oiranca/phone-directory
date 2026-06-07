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

describe("contacts:merge-duplicates — AppDataService.mergeDuplicates", () => {
  let testRoot: string;

  beforeEach(async () => {
    testRoot = await fs.mkdtemp(path.join(os.tmpdir(), "phone-directory-merge-"));
    getPathMock.mockImplementation(() => testRoot);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(testRoot, { recursive: true, force: true });
    getPathMock.mockReset();
  });

  it("merges phones, emails, and tags from discard into keep, deduplicating by value", async () => {
    const { AppDataService } = await import("../services/app-data.service.js");
    const service = new AppDataService();
    await service.ensureInitialFiles();

    const bootstrap = await service.getBootstrapData();
    if ("recovery" in bootstrap) throw new Error("recovery mode unexpected");

    const keepRecord = await service.createRecord({
      type: "service",
      displayName: "Admisión General",
      organization: { department: "Admisión", area: "gestion-administracion" },
      contactMethods: {
        phones: [{ id: "ph_k1", label: "Principal", number: "70001", kind: "internal", isPrimary: true, confidential: false, noPatientSharing: false }],
        emails: [{ id: "em_k1", address: "admision@hospital.es", isPrimary: true }]
      },
      aliases: [],
      tags: ["admisión"],
      notes: undefined,
      status: "active"
    });

    const discardRecord = await service.createRecord({
      type: "service",
      displayName: "Admisión General (duplicado)",
      organization: { department: "Admisión", area: "gestion-administracion" },
      contactMethods: {
        phones: [
          { id: "ph_d1", label: "Secundario", number: "70002", kind: "internal", isPrimary: true, confidential: false, noPatientSharing: false },
          { id: "ph_d2", label: "Duplicado", number: "70001", kind: "internal", isPrimary: false, confidential: false, noPatientSharing: false }
        ],
        emails: [
          { id: "em_d1", address: "admision2@hospital.es", isPrimary: true },
          { id: "em_d2", address: "admision@hospital.es", isPrimary: false }
        ]
      },
      aliases: [],
      tags: ["admisión", "urgencias"],
      notes: undefined,
      status: "active"
    });

    const merged = await service.mergeDuplicates(keepRecord.savedRecordId, discardRecord.savedRecordId);

    const phoneNumbers = merged.contactMethods.phones.map((p) => p.number);
    expect(phoneNumbers).toContain("70001");
    expect(phoneNumbers).toContain("70002");
    expect(phoneNumbers.filter((n) => n === "70001")).toHaveLength(1);

    const emailAddresses = merged.contactMethods.emails.map((e) => e.address);
    expect(emailAddresses).toContain("admision@hospital.es");
    expect(emailAddresses).toContain("admision2@hospital.es");
    expect(emailAddresses.filter((a) => a === "admision@hospital.es")).toHaveLength(1);

    expect(merged.tags).toContain("admisión");
    expect(merged.tags).toContain("urgencias");
    expect(merged.tags.filter((t) => t === "admisión")).toHaveLength(1);

    const afterBootstrap = await service.getBootstrapData();
    if ("recovery" in afterBootstrap) throw new Error("recovery mode unexpected");
    const discardStillExists = afterBootstrap.contacts.records.some(
      (r) => r.id === discardRecord.savedRecordId
    );
    expect(discardStillExists).toBe(false);
  });

  it("throws if the keep record is not found", async () => {
    const { AppDataService } = await import("../services/app-data.service.js");
    const service = new AppDataService();
    await service.ensureInitialFiles();

    const discardRecord = await service.createRecord({
      type: "service",
      displayName: "Registro existente",
      organization: {},
      contactMethods: { phones: [], emails: [] },
      aliases: [],
      tags: [],
      notes: undefined,
      status: "active"
    });

    await expect(
      service.mergeDuplicates("nonexistent-id", discardRecord.savedRecordId)
    ).rejects.toThrow("Contact not found: nonexistent-id");
  });

  it("throws if the discard record is not found", async () => {
    const { AppDataService } = await import("../services/app-data.service.js");
    const service = new AppDataService();
    await service.ensureInitialFiles();

    const keepRecord = await service.createRecord({
      type: "service",
      displayName: "Registro existente",
      organization: {},
      contactMethods: { phones: [], emails: [] },
      aliases: [],
      tags: [],
      notes: undefined,
      status: "active"
    });

    await expect(
      service.mergeDuplicates(keepRecord.savedRecordId, "nonexistent-discard-id")
    ).rejects.toThrow("Contact not found: nonexistent-discard-id");
  });
});
