import { describe, expect, it } from "vitest";
import { selectVisibleRecords } from "./useAppStore";
import { defaultContacts } from "../../shared/fixtures/defaultContacts";
import { getPhonePrivacyFlags, getPreferredResultPhone } from "../services/search.service";

describe("selectVisibleRecords", () => {
  it("matches operational search fields beyond the display name", () => {
    const record = structuredClone(defaultContacts.records[0]);
    record.person = { firstName: "Ana", lastName: "Pérez" };
    record.location = { building: "Hospital General", floor: "Planta 2", room: "Sala 12", text: "Control norte" };
    record.notes = "Cobertura de noche";
    record.tags = ["triaje"];
    record.contactMethods.phones[0].extension = "1234";
    record.contactMethods.phones[0].notes = "Solo uso interno";
    record.contactMethods.emails = [{ id: "email_1", address: "ana.perez@hospital.local", label: "Laboral", isPrimary: true }];

    const filters = { selectedType: "all" as const, selectedArea: "all" as const, showInactive: true };

    expect(selectVisibleRecords([record], "1234", filters)).toHaveLength(1);
    expect(selectVisibleRecords([record], "admisión", filters)).toHaveLength(1);
    expect(selectVisibleRecords([record], "ana.perez@hospital.local", filters)).toHaveLength(1);
  });

  it("filters by type, area, and inactive visibility", () => {
    const active = structuredClone(defaultContacts.records[0]);
    const inactive = structuredClone(defaultContacts.records[1]);
    inactive.status = "inactive";

    expect(
      selectVisibleRecords([active, inactive], "", {
        selectedType: "all",
        selectedArea: "all",
        showInactive: false
      })
    ).toEqual([active]);

    expect(
      selectVisibleRecords([active, inactive], "", {
        selectedType: "external-center",
        selectedArea: "otros",
        showInactive: true
      })
    ).toEqual([inactive]);
  });
});

describe("search service helpers", () => {
  it("prefers a non-sensitive phone for result cards", () => {
    const record = structuredClone(defaultContacts.records[0]);
    record.contactMethods.phones = [
      {
        ...record.contactMethods.phones[0],
        id: "sensitive",
        number: "999",
        confidential: true,
        noPatientSharing: true,
        isPrimary: true
      },
      {
        ...record.contactMethods.phones[0],
        id: "safe",
        number: "111",
        confidential: false,
        noPatientSharing: false,
        isPrimary: false
      }
    ];

    expect(getPreferredResultPhone(record)?.number).toBe("111");
    expect(getPhonePrivacyFlags(record)).toEqual(["Confidencial", "No facilitar a pacientes"]);
  });
});
