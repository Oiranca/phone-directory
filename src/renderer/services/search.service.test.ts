import { describe, expect, it } from "vitest";
import { searchRecords, fuseCache, getPreferredResultPhone, getPhonePrivacyFlags } from "./search.service";
import { defaultContacts } from "../../shared/fixtures/defaultContacts";
import type { ContactRecord } from "../../shared/types/contact";
import type { DirectoryFilters } from "./search.service";

const records = defaultContacts.records as ContactRecord[];

const defaultFilters: DirectoryFilters = {
  selectedType: "all",
  selectedArea: "all",
  showInactive: true
};

describe("searchRecords", () => {
  it("returns all records when the query is empty", () => {
    const result = searchRecords(records, "", defaultFilters);
    expect(result).toHaveLength(records.length);
  });

  it("returns all records when the query is whitespace only", () => {
    const result = searchRecords(records, "   ", defaultFilters);
    expect(result).toHaveLength(records.length);
  });

  it("finds a record by display name", () => {
    const result = searchRecords(records, "Admisión General", defaultFilters);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]?.displayName).toBe("Admisión General");
  });

  it("finds a record by alias", () => {
    const result = searchRecords(records, "mostrador admisión", defaultFilters);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]?.displayName).toBe("Admisión General");
  });

  it("filters inactive records when showInactive is false", () => {
    const recordsWithInactive = structuredClone(records);
    recordsWithInactive[1]!.status = "inactive";

    const result = searchRecords(recordsWithInactive, "", { ...defaultFilters, showInactive: false });
    expect(result).toHaveLength(1);
    expect(result[0]?.status).toBe("active");
  });

  it("filters by record type", () => {
    const result = searchRecords(records, "", { ...defaultFilters, selectedType: "service" });
    expect(result.every((r) => r.type === "service")).toBe(true);
  });

  it("filters by area", () => {
    const result = searchRecords(records, "", { ...defaultFilters, selectedArea: "gestion-administracion" });
    expect(result.every((r) => r.organization.area === "gestion-administracion")).toBe(true);
  });

  it("reuses the Fuse instance for the same records array reference", () => {
    searchRecords(records, "Ana", defaultFilters);
    const fuseInstanceAfterFirst = fuseCache.get(records);

    searchRecords(records, "Mostrador", defaultFilters);
    const fuseInstanceAfterSecond = fuseCache.get(records);

    expect(fuseInstanceAfterFirst).toBeDefined();
    expect(fuseInstanceAfterSecond).toBeDefined();
    expect(fuseInstanceAfterFirst).toBe(fuseInstanceAfterSecond);
  });

  it("creates a new Fuse instance for a different records array reference", () => {
    const recordsCopy = structuredClone(records) as ContactRecord[];

    searchRecords(records, "Admisión", defaultFilters);
    searchRecords(recordsCopy, "Admisión", defaultFilters);

    expect(fuseCache.has(records)).toBe(true);
    expect(fuseCache.has(recordsCopy)).toBe(true);
    expect(fuseCache.get(records)).not.toBe(fuseCache.get(recordsCopy));
  });
});

describe("getPreferredResultPhone", () => {
  it("returns the first non-confidential, non-noPatientSharing phone", () => {
    const record = structuredClone(records[0]) as ContactRecord;
    record.contactMethods.phones = [
      { id: "ph1", number: "11111", kind: "internal", isPrimary: false, confidential: true, noPatientSharing: false },
      { id: "ph2", number: "22222", kind: "internal", isPrimary: false, confidential: false, noPatientSharing: true },
      { id: "ph3", number: "33333", kind: "internal", isPrimary: true, confidential: false, noPatientSharing: false }
    ];
    const preferred = getPreferredResultPhone(record);
    expect(preferred?.number).toBe("33333");
  });

  it("falls back to the primary phone when all phones have sharing restrictions", () => {
    const record = structuredClone(records[0]) as ContactRecord;
    record.contactMethods.phones = [
      { id: "ph1", number: "11111", kind: "internal", isPrimary: false, confidential: true, noPatientSharing: true },
      { id: "ph2", number: "22222", kind: "internal", isPrimary: true, confidential: true, noPatientSharing: true }
    ];
    const preferred = getPreferredResultPhone(record);
    expect(preferred?.number).toBe("22222");
  });

  it("falls back to the first phone when no phone matches any preference", () => {
    const record = structuredClone(records[0]) as ContactRecord;
    record.contactMethods.phones = [
      { id: "ph1", number: "55555", kind: "internal", isPrimary: false, confidential: true, noPatientSharing: true }
    ];
    const preferred = getPreferredResultPhone(record);
    expect(preferred?.number).toBe("55555");
  });
});

describe("getPhonePrivacyFlags", () => {
  it("returns an empty array when no phones have privacy flags", () => {
    const record = structuredClone(records[0]) as ContactRecord;
    record.contactMethods.phones = [
      { id: "ph1", number: "11111", kind: "internal", isPrimary: true, confidential: false, noPatientSharing: false }
    ];
    expect(getPhonePrivacyFlags(record)).toEqual([]);
  });

  it("returns Confidencial when a phone is confidential", () => {
    const record = structuredClone(records[0]) as ContactRecord;
    record.contactMethods.phones = [
      { id: "ph1", number: "11111", kind: "internal", isPrimary: true, confidential: true, noPatientSharing: false }
    ];
    const flags = getPhonePrivacyFlags(record);
    expect(flags).toContain("Confidencial");
    expect(flags).not.toContain("No facilitar a pacientes");
  });

  it("returns No facilitar a pacientes when a phone has noPatientSharing", () => {
    const record = structuredClone(records[0]) as ContactRecord;
    record.contactMethods.phones = [
      { id: "ph1", number: "11111", kind: "internal", isPrimary: true, confidential: false, noPatientSharing: true }
    ];
    const flags = getPhonePrivacyFlags(record);
    expect(flags).toContain("No facilitar a pacientes");
    expect(flags).not.toContain("Confidencial");
  });

  it("returns both flags when applicable", () => {
    const record = structuredClone(records[0]) as ContactRecord;
    record.contactMethods.phones = [
      { id: "ph1", number: "11111", kind: "internal", isPrimary: true, confidential: true, noPatientSharing: true }
    ];
    const flags = getPhonePrivacyFlags(record);
    expect(flags).toContain("Confidencial");
    expect(flags).toContain("No facilitar a pacientes");
  });
});
