import { describe, expect, it } from "vitest";
import { convertIMessageBeeperExport } from "./imessage-beeper-import.js";

describe("convertIMessageBeeperExport", () => {
  const source = {
    datos: {
      usuarios: [
        { id: "user-1", displayId: "7001", department: "Rayos", firstName: "Ana", surName: "Díaz", position: "Técnica", textEnabled: true, extra: "kept" },
        { id: "user-2", displayId: "7002", department: "UCI", firstName: "Inactiva", textEnabled: false }
      ],
      equipos: [{ id: "team-1", displayId: "9001", name: "Equipo UCI" }]
    }
  };

  it("imports active users and teams separately without inferred memberships", () => {
    const result = convertIMessageBeeperExport(source);
    expect(result.importedRecords).toHaveLength(1);
    expect(result.importedRecords[0]).toMatchObject({
      deviceNumber: "7001",
      department: "Rayos",
      name: "Ana Díaz",
      category: "Técnica",
      sourceId: "user-1"
    });
    expect(result.importedRecords[0]?.id).toMatch(/^ibsc_[0-9a-f]{8}$/);
    expect(result.importedRecords[0]).not.toHaveProperty("sourceRecord");
    expect(result.teams).toEqual([{ id: "team-1", displayId: "9001", name: "Equipo UCI" }]);
    expect(result.teamMemberships).toEqual([]);
  });

  it("keeps source identity stable across repeated conversions", () => {
    const first = convertIMessageBeeperExport(source);
    const second = convertIMessageBeeperExport(source);
    expect(first.importedRecords[0]?.id).toBe(second.importedRecords[0]?.id);
    expect(first.importedRecords[0]?.sourceFingerprint).toBe(second.importedRecords[0]?.sourceFingerprint);
  });
});
