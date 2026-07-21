import { describe, expect, it } from "vitest";
import { beeperRecordSchema, beepersDatasetSchema, editableBeeperRecordSchema } from "./beeper.schema";

const validRecord = {
  id: "bsc_abc12345",
  deviceNumber: "B-001",
  assignedTo: "Ana García",
  department: "Urgencias",
  role: "Enfermera",
  shift: "mañana" as const,
  group: "Equipo A"
};

const validEditable = {
  deviceNumber: "B-002",
  assignedTo: "Luis Pérez",
  department: "UCI",
  role: "Médico",
  shift: "tarde" as const
};

describe("beeperRecordSchema", () => {
  it("parses a valid record", () => {
    const result = beeperRecordSchema.parse(validRecord);
    expect(result.deviceNumber).toBe("B-001");
    expect(result.shift).toBe("mañana");
    expect(result.group).toBe("Equipo A");
  });

  it("accepts an optional group field", () => {
    const result = beeperRecordSchema.parse({ ...validRecord, group: undefined });
    expect(result.group).toBeUndefined();
  });

  it("rejects an invalid shift value", () => {
    expect(() =>
      beeperRecordSchema.parse({ ...validRecord, shift: "mediodía" })
    ).toThrow();
  });

  it("rejects missing required fields", () => {
    expect(() =>
      beeperRecordSchema.parse({ id: "bsc_abc12345", deviceNumber: "" })
    ).toThrow();
  });

  it("rejects IDs that do not match the bsc_ + 8 hex chars format", () => {
    expect(() => beeperRecordSchema.parse({ ...validRecord, id: "bsc_abc123" })).toThrow();
    expect(() => beeperRecordSchema.parse({ ...validRecord, id: "bsc_abc123456" })).toThrow();
    expect(() => beeperRecordSchema.parse({ ...validRecord, id: "cnt_abc12345" })).toThrow();
    expect(() => beeperRecordSchema.parse({ ...validRecord, id: "bsc_GGGGGGGG" })).toThrow();
  });

  it("accepts a valid bsc_ + 8 hex chars ID", () => {
    const result = beeperRecordSchema.parse({ ...validRecord, id: "bsc_deadbeef" });
    expect(result.id).toBe("bsc_deadbeef");
  });

  it("rejects empty deviceNumber", () => {
    expect(() =>
      beeperRecordSchema.parse({ ...validRecord, deviceNumber: "" })
    ).toThrow();
  });

  it("rejects empty assignedTo", () => {
    expect(() =>
      beeperRecordSchema.parse({ ...validRecord, assignedTo: "" })
    ).toThrow();
  });

  it("rejects empty department", () => {
    expect(() =>
      beeperRecordSchema.parse({ ...validRecord, department: "" })
    ).toThrow();
  });

  it("rejects empty role", () => {
    expect(() =>
      beeperRecordSchema.parse({ ...validRecord, role: "" })
    ).toThrow();
  });

  it("rejects deviceNumber longer than 255 characters", () => {
    expect(() =>
      beeperRecordSchema.parse({ ...validRecord, deviceNumber: "B".repeat(256) })
    ).toThrow();
  });

  it("rejects assignedTo longer than 255 characters", () => {
    expect(() =>
      beeperRecordSchema.parse({ ...validRecord, assignedTo: "A".repeat(256) })
    ).toThrow();
  });

  it("rejects department longer than 255 characters", () => {
    expect(() =>
      beeperRecordSchema.parse({ ...validRecord, department: "D".repeat(256) })
    ).toThrow();
  });

  it("rejects role longer than 255 characters", () => {
    expect(() =>
      beeperRecordSchema.parse({ ...validRecord, role: "R".repeat(256) })
    ).toThrow();
  });

  it("rejects group longer than 255 characters", () => {
    expect(() =>
      beeperRecordSchema.parse({ ...validRecord, group: "G".repeat(256) })
    ).toThrow();
  });

  it("accepts fields at exactly 255 characters", () => {
    const at255 = "X".repeat(255);
    const result = beeperRecordSchema.parse({
      ...validRecord,
      deviceNumber: at255,
      assignedTo: at255,
      department: at255,
      role: at255,
      group: at255
    });
    expect(result.deviceNumber).toHaveLength(255);
  });
});

describe("editableBeeperRecordSchema", () => {
  it("parses a valid editable record", () => {
    const result = editableBeeperRecordSchema.parse(validEditable);
    expect(result.deviceNumber).toBe("B-002");
    expect(result.shift).toBe("tarde");
    expect(result.group).toBeUndefined();
  });

  it("trims whitespace from string fields", () => {
    const result = editableBeeperRecordSchema.parse({
      ...validEditable,
      deviceNumber: "  B-003  ",
      assignedTo: "  Juan  "
    });
    expect(result.deviceNumber).toBe("B-003");
    expect(result.assignedTo).toBe("Juan");
  });

  it("transforms empty group string to undefined", () => {
    const result = editableBeeperRecordSchema.parse({ ...validEditable, group: "" });
    expect(result.group).toBeUndefined();
  });

  it("preserves non-empty group", () => {
    const result = editableBeeperRecordSchema.parse({ ...validEditable, group: "Equipo B" });
    expect(result.group).toBe("Equipo B");
  });

  it("rejects invalid shift enum", () => {
    expect(() =>
      editableBeeperRecordSchema.parse({ ...validEditable, shift: "madrugada" })
    ).toThrow();
  });

  it("accepts all valid shift values", () => {
    for (const shift of ["mañana", "tarde", "noche"] as const) {
      const result = editableBeeperRecordSchema.parse({ ...validEditable, shift });
      expect(result.shift).toBe(shift);
    }
  });
});

describe("beepersDatasetSchema", () => {
  it("parses a valid dataset", () => {
    const dataset = { version: "1.0.0", records: [validRecord] };
    const result = beepersDatasetSchema.parse(dataset);
    expect(result.records).toHaveLength(1);
    expect(result.version).toBe("1.0.0");
  });

  it("accepts an empty records array", () => {
    const result = beepersDatasetSchema.parse({ version: "1.0.0", records: [] });
    expect(result.records).toHaveLength(0);
  });

  it("rejects records with invalid data", () => {
    expect(() =>
      beepersDatasetSchema.parse({
        version: "1.0.0",
        records: [{ ...validRecord, shift: "bad-shift" }]
      })
    ).toThrow();
  });

  it("rejects a version string other than 1.0.0", () => {
    expect(() =>
      beepersDatasetSchema.parse({ version: "2.0.0", records: [] })
    ).toThrow();
  });

  it("rejects a missing version field", () => {
    expect(() =>
      beepersDatasetSchema.parse({ records: [] })
    ).toThrow();
  });

  it("BUG-3: coerces explicit null importedRecords to [] (prevents parse crash on stored null)", () => {
    const result = beepersDatasetSchema.parse({
      version: "1.0.0",
      records: [],
      importedRecords: null
    });
    expect(result.importedRecords).toEqual([]);
  });

  it("BUG-3: coerces missing importedRecords to [] (undefined → default)", () => {
    const result = beepersDatasetSchema.parse({ version: "1.0.0", records: [] });
    expect(result.importedRecords).toEqual([]);
  });

  it("BUG-3: preserves existing importedRecords when present", () => {
    const importedRecord = {
      id: "ibsc_abcd1234",
      deviceNumber: "7321",
      department: "Anestesia",
      holderType: "Principal",
      sourceSheet: "Buscas_Facultativos",
      sourceRow: 0
    };
    const result = beepersDatasetSchema.parse({
      version: "1.0.0",
      records: [],
      importedRecords: [importedRecord]
    });
    expect(result.importedRecords).toHaveLength(1);
    expect(result.importedRecords[0]!.deviceNumber).toBe("7321");
  });
});
