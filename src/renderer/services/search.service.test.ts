import { describe, expect, it } from "vitest";
import { searchRecords, _getFuseCacheEntry, getPreferredResultPhone, getPhonePrivacyFlags } from "./search.service";
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

  it("finds a record by phone number", () => {
    const result = searchRecords(records, "928000000", defaultFilters);
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]?.displayName).toBe("Centro de Salud Demo - Información");
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
    const fuseInstanceAfterFirst = _getFuseCacheEntry(records);

    searchRecords(records, "Mostrador", defaultFilters);
    const fuseInstanceAfterSecond = _getFuseCacheEntry(records);

    expect(fuseInstanceAfterFirst).toBeDefined();
    expect(fuseInstanceAfterSecond).toBeDefined();
    expect(fuseInstanceAfterFirst).toBe(fuseInstanceAfterSecond);
  });

  it("creates a new Fuse instance for a different records array reference", () => {
    const recordsCopy = structuredClone(records) as ContactRecord[];

    searchRecords(records, "Admisión", defaultFilters);
    searchRecords(recordsCopy, "Admisión", defaultFilters);

    const fuseForOriginal = _getFuseCacheEntry(records);
    const fuseForCopy = _getFuseCacheEntry(recordsCopy);

    expect(fuseForOriginal).toBeDefined();
    expect(fuseForCopy).toBeDefined();
    expect(fuseForOriginal).not.toBe(fuseForCopy);
  });

  it("prioritizes display name matches over lower-weight service matches", () => {
    const rankingRecords: ContactRecord[] = [
      {
        ...structuredClone(records[0]),
        id: "display-name-match",
        displayName: "Urgencias",
        organization: {
          ...structuredClone(records[0]!.organization),
          department: "Admisión",
          service: "Información general"
        },
        aliases: [],
        tags: []
      },
      {
        ...structuredClone(records[1]),
        id: "service-match",
        displayName: "Mostrador principal",
        organization: {
          ...structuredClone(records[1]!.organization),
          department: "Atención",
          service: "Urgencias"
        },
        aliases: [],
        tags: []
      }
    ];

    const result = searchRecords(rankingRecords, "Urgencias", defaultFilters);

    expect(result[0]?.id).toBe("display-name-match");
  });

  it("prioritizes extension matches over service-only matches", () => {
    const rankingRecords: ContactRecord[] = [
      {
        ...structuredClone(records[0]),
        id: "extension-match",
        displayName: "Control interno",
        contactMethods: {
          ...structuredClone(records[0]!.contactMethods),
          phones: [
            {
              id: "phone-extension",
              label: "Interno",
              number: "70005",
              extension: "4455",
              kind: "internal",
              isPrimary: true,
              confidential: false,
              noPatientSharing: false
            }
          ]
        },
        organization: {
          ...structuredClone(records[0]!.organization),
          service: "Admisión"
        }
      },
      {
        ...structuredClone(records[1]),
        id: "service-only",
        displayName: "Central telefónica",
        organization: {
          ...structuredClone(records[1]!.organization),
          service: "4455"
        },
        contactMethods: {
          ...structuredClone(records[1]!.contactMethods),
          phones: [
            {
              id: "phone-main",
              label: "Principal",
              number: "928000001",
              kind: "external",
              isPrimary: true,
              confidential: false,
              noPatientSharing: false
            }
          ]
        }
      }
    ];

    const result = searchRecords(rankingRecords, "4455", defaultFilters);

    expect(result[0]?.id).toBe("extension-match");
  });

  it("finds records by location text and notes", () => {
    const rankingRecords: ContactRecord[] = [
      {
        ...structuredClone(records[0]),
        id: "location-match",
        displayName: "Consulta externa",
        location: {
          building: "Edificio sur",
          floor: "2",
          room: "205",
          text: "Pasillo azul"
        },
        notes: "Acceso por ascensor lateral"
      },
      {
        ...structuredClone(records[1]),
        id: "notes-match",
        displayName: "Archivo",
        location: undefined,
        notes: "Pasillo azul junto al archivo clínico"
      }
    ];

    const locationResult = searchRecords(rankingRecords, "Pasillo azul", defaultFilters);
    const notesResult = searchRecords(rankingRecords, "ascensor lateral", defaultFilters);

    expect(locationResult.map((record) => record.id)).toContain("location-match");
    expect(notesResult[0]?.id).toBe("location-match");
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
