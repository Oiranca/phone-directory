import { describe, expect, it } from "vitest";
import { selectVisibleRecords } from "./useAppStore";
import { defaultContacts } from "../../shared/fixtures/defaultContacts";

describe("selectVisibleRecords", () => {
  it("matches operational search fields beyond the display name", () => {
    const record = defaultContacts.records[0];
    record.person = { firstName: "Ana", lastName: "Pérez" };
    record.location = { building: "Hospital General", floor: "Planta 2", room: "Sala 12", text: "Control norte" };
    record.notes = "Cobertura de noche";
    record.tags = ["triaje"];
    record.contactMethods.phones[0].extension = "1234";
    record.contactMethods.phones[0].notes = "Solo uso interno";
    record.contactMethods.emails = [{ id: "email_1", address: "ana.perez@hospital.local", label: "Laboral", isPrimary: true }];

    expect(selectVisibleRecords([record], "1234", true)).toHaveLength(1);
    expect(selectVisibleRecords([record], "control norte", true)).toHaveLength(1);
    expect(selectVisibleRecords([record], "triaje", true)).toHaveLength(1);
    expect(selectVisibleRecords([record], "ana.perez@hospital.local", true)).toHaveLength(1);
    expect(selectVisibleRecords([record], "ana", true)).toHaveLength(1);
  });
});
