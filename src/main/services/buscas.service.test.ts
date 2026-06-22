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

describe("BuscasService", () => {
  let testRoot: string;

  beforeEach(async () => {
    testRoot = await fs.mkdtemp(path.join(os.tmpdir(), "buscas-service-test-"));
    getPathMock.mockImplementation(() => testRoot);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(testRoot, { recursive: true, force: true });
    getPathMock.mockReset();
  });

  it("cold start — returns empty array when buscas.json is missing", async () => {
    const { BuscasService } = await import("./buscas.service.js");
    const service = new BuscasService();

    const records = await service.list();

    expect(records).toEqual([]);
  });

  it("readDataset — propagates non-ENOENT fs errors (e.g. EACCES)", async () => {
    const buscasFilePath = path.join(testRoot, "data", "buscas.json");
    await fs.mkdir(path.dirname(buscasFilePath), { recursive: true });
    await fs.writeFile(
      buscasFilePath,
      JSON.stringify({ version: "1.0.0", records: [] }),
      "utf-8"
    );

    const accessError = Object.assign(new Error("permission denied"), { code: "EACCES" });
    const readFileSpy = vi.spyOn(fs, "readFile").mockRejectedValueOnce(accessError);

    const { BuscasService } = await import("./buscas.service.js");
    const service = new BuscasService();

    await expect(service.list()).rejects.toThrow("permission denied");

    readFileSpy.mockRestore();
  });

  it("add → list round-trip — persists new record and returns it from list", async () => {
    const { BuscasService } = await import("./buscas.service.js");
    const service = new BuscasService();

    const created = await service.add({
      deviceNumber: "B-101",
      assignedTo: "Ana García",
      department: "Urgencias",
      role: "Enfermera",
      shift: "mañana"
    });

    expect(created.id).toMatch(/^bsc_[0-9a-f]{8}$/);
    expect(created.deviceNumber).toBe("B-101");
    expect(created.assignedTo).toBe("Ana García");
    expect(created.department).toBe("Urgencias");
    expect(created.role).toBe("Enfermera");
    expect(created.shift).toBe("mañana");

    const listed = await service.list();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe(created.id);
    expect(listed[0]?.deviceNumber).toBe("B-101");

    // Verify file was persisted to disk
    const buscasFilePath = path.join(testRoot, "data", "buscas.json");
    const raw = JSON.parse(await fs.readFile(buscasFilePath, "utf-8")) as { records: unknown[] };
    expect(raw.records).toHaveLength(1);
  });

  it("update existing record — changes only the updated fields", async () => {
    const { BuscasService } = await import("./buscas.service.js");
    const service = new BuscasService();

    const created = await service.add({
      deviceNumber: "B-200",
      assignedTo: "Luis Pérez",
      department: "UCI",
      role: "Médico",
      shift: "tarde"
    });

    const updated = await service.update(created.id, {
      deviceNumber: "B-200",
      assignedTo: "Luis Pérez Actualizado",
      department: "UCI",
      role: "Médico Jefe",
      shift: "noche",
      group: "Turno C"
    });

    expect(updated.id).toBe(created.id);
    expect(updated.assignedTo).toBe("Luis Pérez Actualizado");
    expect(updated.role).toBe("Médico Jefe");
    expect(updated.shift).toBe("noche");
    expect(updated.group).toBe("Turno C");

    const listed = await service.list();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.assignedTo).toBe("Luis Pérez Actualizado");
  });

  it("update throws when record ID does not exist", async () => {
    const { BuscasService } = await import("./buscas.service.js");
    const service = new BuscasService();

    await expect(
      service.update("bsc_nonexist", {
        deviceNumber: "B-999",
        assignedTo: "Nadie",
        department: "Vacío",
        role: "Sin rol",
        shift: "mañana"
      })
    ).rejects.toThrow("No se encontró la busca solicitada.");
  });

  it("remove record — record is gone after remove", async () => {
    const { BuscasService } = await import("./buscas.service.js");
    const service = new BuscasService();

    const first = await service.add({
      deviceNumber: "B-301",
      assignedTo: "Pedro Martín",
      department: "Planta 3",
      role: "Auxiliar",
      shift: "noche"
    });
    const second = await service.add({
      deviceNumber: "B-302",
      assignedTo: "Sofía López",
      department: "Planta 3",
      role: "Enfermera",
      shift: "mañana"
    });

    await service.remove(first.id);

    const listed = await service.list();
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe(second.id);
    expect(listed.find((r) => r.id === first.id)).toBeUndefined();
  });

  it("remove throws when record ID does not exist", async () => {
    const { BuscasService } = await import("./buscas.service.js");
    const service = new BuscasService();

    await expect(service.remove("bsc_nonexist")).rejects.toThrow(
      "No se encontró la busca solicitada."
    );
  });

  it("add — rejects duplicate deviceNumber (exact match)", async () => {
    const { BuscasService } = await import("./buscas.service.js");
    const service = new BuscasService();

    await service.add({
      deviceNumber: "B-101",
      assignedTo: "Ana García",
      department: "Urgencias",
      role: "Enfermera",
      shift: "mañana"
    });

    await expect(
      service.add({
        deviceNumber: "B-101",
        assignedTo: "Otro Usuario",
        department: "UCI",
        role: "Médico",
        shift: "tarde"
      })
    ).rejects.toThrow("ya está registrado");
  });

  it("add — rejects duplicate deviceNumber (case/whitespace variant)", async () => {
    const { BuscasService } = await import("./buscas.service.js");
    const service = new BuscasService();

    await service.add({
      deviceNumber: "B-101",
      assignedTo: "Ana García",
      department: "Urgencias",
      role: "Enfermera",
      shift: "mañana"
    });

    await expect(
      service.add({
        deviceNumber: "b-101",
        assignedTo: "Otro Usuario",
        department: "UCI",
        role: "Médico",
        shift: "tarde"
      })
    ).rejects.toThrow("ya está registrado");

    await expect(
      service.add({
        deviceNumber: " B-101 ",
        assignedTo: "Otro Usuario",
        department: "UCI",
        role: "Médico",
        shift: "tarde"
      })
    ).rejects.toThrow("ya está registrado");
  });

  it("update — rejects deviceNumber collision with another record", async () => {
    const { BuscasService } = await import("./buscas.service.js");
    const service = new BuscasService();

    await service.add({
      deviceNumber: "B-101",
      assignedTo: "Ana García",
      department: "Urgencias",
      role: "Enfermera",
      shift: "mañana"
    });
    const second = await service.add({
      deviceNumber: "B-102",
      assignedTo: "Luis Pérez",
      department: "UCI",
      role: "Médico",
      shift: "tarde"
    });

    await expect(
      service.update(second.id, {
        deviceNumber: "B-101",
        assignedTo: "Luis Pérez",
        department: "UCI",
        role: "Médico",
        shift: "tarde"
      })
    ).rejects.toThrow("ya está registrado");
  });

  it("update — allows keeping the same deviceNumber for the current record", async () => {
    const { BuscasService } = await import("./buscas.service.js");
    const service = new BuscasService();

    const created = await service.add({
      deviceNumber: "B-101",
      assignedTo: "Ana García",
      department: "Urgencias",
      role: "Enfermera",
      shift: "mañana"
    });

    // Updating only assignedTo while keeping same deviceNumber must not throw
    const updated = await service.update(created.id, {
      deviceNumber: "B-101",
      assignedTo: "Ana García Actualizada",
      department: "Urgencias",
      role: "Enfermera",
      shift: "mañana"
    });

    expect(updated.assignedTo).toBe("Ana García Actualizada");
  });

  it("unique ID generation — IDs are unique across many adds", async () => {
    const { BuscasService } = await import("./buscas.service.js");
    const service = new BuscasService();

    const created = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        service.add({
          deviceNumber: `B-${String(i).padStart(3, "0")}`,
          assignedTo: `Usuario ${i}`,
          department: "Test",
          role: "Rol",
          shift: "mañana"
        })
      )
    );

    const ids = created.map((r) => r.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
    ids.forEach((id) => {
      expect(id).toMatch(/^bsc_[0-9a-f]{8}$/);
    });
  });

  it("unique ID generation — retries on collision and resolves to a unique ID", async () => {
    const { BuscasService } = await import("./buscas.service.js");
    const service = new BuscasService();

    // Add a record that will hold the "colliding" UUID slot
    const first = await service.add({
      deviceNumber: "B-C01",
      assignedTo: "Usuario A",
      department: "Test",
      role: "Rol",
      shift: "mañana"
    });

    // Extract the 8 hex chars from the first record's ID to use as the colliding value
    const collidingHex = first.id.slice(4); // "bsc_XXXXXXXX" → "XXXXXXXX"

    // Simulate randomUUID returning the colliding value once, then a unique value
    const uniqueHex = "deadbeef";
    const uuidSpy = vi
      .spyOn(globalThis.crypto, "randomUUID")
      .mockReturnValueOnce(`${collidingHex}-0000-0000-0000-000000000000` as `${string}-${string}-${string}-${string}-${string}`)
      .mockReturnValueOnce(`${uniqueHex}-0000-0000-0000-000000000000` as `${string}-${string}-${string}-${string}-${string}`);

    const second = await service.add({
      deviceNumber: "B-C02",
      assignedTo: "Usuario B",
      department: "Test",
      role: "Rol",
      shift: "mañana"
    });

    expect(second.id).toBe(`bsc_${uniqueHex}`);
    expect(uuidSpy).toHaveBeenCalledTimes(2);
    uuidSpy.mockRestore();
  });

  it("unique ID generation — throws after 1000 exhausted attempts", async () => {
    const { BuscasService } = await import("./buscas.service.js");
    const service = new BuscasService();

    // Add a record whose hex will be the permanently colliding value
    const existing = await service.add({
      deviceNumber: "B-X01",
      assignedTo: "Usuario X",
      department: "Test",
      role: "Rol",
      shift: "mañana"
    });

    const collidingHex = existing.id.slice(4);

    // Every randomUUID call returns the same colliding UUID → exhaustion
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(
      `${collidingHex}-0000-0000-0000-000000000000` as `${string}-${string}-${string}-${string}-${string}`
    );

    await expect(
      service.add({
        deviceNumber: "B-X02",
        assignedTo: "Usuario Y",
        department: "Test",
        role: "Rol",
        shift: "mañana"
      })
    ).rejects.toThrow("No se pudo generar un ID único");

    vi.restoreAllMocks();
  });
});

// ---------------------------------------------------------------------------
// OIR-130: importFromOds + listImported
// ---------------------------------------------------------------------------

describe("BuscasService — importFromOds + listImported", () => {
  let testRoot: string;

  beforeEach(async () => {
    testRoot = await fs.mkdtemp(path.join(os.tmpdir(), "buscas-service-import-test-"));
    getPathMock.mockImplementation(() => testRoot);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(testRoot, { recursive: true, force: true });
    getPathMock.mockReset();
  });

  it("listImported — returns empty array before any ODS import", async () => {
    const { BuscasService } = await import("./buscas.service.js");
    const service = new BuscasService();

    const imported = await service.listImported();

    expect(imported).toEqual([]);
  });

  it("importFromOds — persists imported records with ibsc_ IDs and returns count", async () => {
    const { BuscasService } = await import("./buscas.service.js");
    const service = new BuscasService();

    const parseResult = {
      records: [
        {
          deviceNumber: "7321",
          department: "Anestesia",
          holderType: "Principal / Residente",
          sourceSheet: "Buscas_Facultativos",
          sourceRow: 0
        },
        {
          deviceNumber: "7580",
          department: "Cardiología",
          holderType: "Adjunto 1",
          sourceSheet: "Buscas_Facultativos",
          sourceRow: 1
        }
      ],
      parsedCellCount: 2,
      skippedRowCount: 0
    };

    const count = await service.importFromOds(parseResult);

    expect(count).toBe(2);

    const imported = await service.listImported();
    expect(imported).toHaveLength(2);

    // IDs must use ibsc_ prefix + 8 hex chars
    for (const rec of imported) {
      expect(rec.id).toMatch(/^ibsc_[0-9a-f]{8}$/);
    }

    const first = imported.find((r) => r.deviceNumber === "7321");
    expect(first?.department).toBe("Anestesia");
    expect(first?.holderType).toBe("Principal / Residente");
    expect(first?.sourceSheet).toBe("Buscas_Facultativos");
    expect(first?.sourceRow).toBe(0);
  });

  it("importFromOds — replaces all previously-imported records on second call", async () => {
    const { BuscasService } = await import("./buscas.service.js");
    const service = new BuscasService();

    const firstResult = {
      records: [
        { deviceNumber: "7321", department: "Anestesia", holderType: "Principal", sourceSheet: "Sheet1", sourceRow: 0 },
        { deviceNumber: "7322", department: "Cardiología", holderType: "Principal", sourceSheet: "Sheet1", sourceRow: 1 }
      ],
      parsedCellCount: 2,
      skippedRowCount: 0
    };

    await service.importFromOds(firstResult);
    expect(await service.listImported()).toHaveLength(2);

    const secondResult = {
      records: [
        { deviceNumber: "8001", department: "Planta 1", holderType: "Residente", sourceSheet: "Sheet2", sourceRow: 0 }
      ],
      parsedCellCount: 1,
      skippedRowCount: 0
    };

    const count = await service.importFromOds(secondResult);
    expect(count).toBe(1);

    const imported = await service.listImported();
    expect(imported).toHaveLength(1);
    expect(imported[0]?.deviceNumber).toBe("8001");
  });

  it("importFromOds — does not disturb manually-managed records", async () => {
    const { BuscasService } = await import("./buscas.service.js");
    const service = new BuscasService();

    const manual = await service.add({
      deviceNumber: "B-MANUAL",
      assignedTo: "María García",
      department: "UCI",
      role: "Enfermera",
      shift: "mañana"
    });

    await service.importFromOds({
      records: [
        { deviceNumber: "7999", department: "Urgencias", holderType: "Principal", sourceSheet: "Buscas_Test", sourceRow: 0 }
      ],
      parsedCellCount: 1,
      skippedRowCount: 0
    });

    const manualRecords = await service.list();
    expect(manualRecords).toHaveLength(1);
    expect(manualRecords[0]?.id).toBe(manual.id);
    expect(manualRecords[0]?.deviceNumber).toBe("B-MANUAL");

    const imported = await service.listImported();
    expect(imported).toHaveLength(1);
    expect(imported[0]?.deviceNumber).toBe("7999");
  });

  it("importFromOds — generates unique IDs across all imported records in a single call", async () => {
    const { BuscasService } = await import("./buscas.service.js");
    const service = new BuscasService();

    const parseResult = {
      records: Array.from({ length: 10 }, (_, i) => ({
        deviceNumber: `${7000 + i}`,
        department: `Departamento ${i}`,
        holderType: "Principal",
        sourceSheet: "Buscas_Test",
        sourceRow: i
      })),
      parsedCellCount: 10,
      skippedRowCount: 0
    };

    const count = await service.importFromOds(parseResult);
    expect(count).toBe(10);

    const imported = await service.listImported();
    const ids = imported.map((r) => r.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(10);
    ids.forEach((id) => {
      expect(id).toMatch(/^ibsc_[0-9a-f]{8}$/);
    });
  });

  it("importFromOds — persists to buscas.json with importedRecords field", async () => {
    const { BuscasService } = await import("./buscas.service.js");
    const service = new BuscasService();

    await service.importFromOds({
      records: [
        { deviceNumber: "7321", department: "Anestesia", holderType: "Principal", sourceSheet: "Buscas_Facultativos", sourceRow: 0 }
      ],
      parsedCellCount: 1,
      skippedRowCount: 0
    });

    const buscasFilePath = path.join(testRoot, "data", "buscas.json");
    const raw = JSON.parse(await fs.readFile(buscasFilePath, "utf-8")) as {
      version: string;
      records: unknown[];
      importedRecords: unknown[];
    };
    expect(raw.version).toBe("1.0.0");
    expect(raw.records).toHaveLength(0);
    expect(raw.importedRecords).toHaveLength(1);
  });

  it("importFromOds — empty parse result writes zero importedRecords", async () => {
    const { BuscasService } = await import("./buscas.service.js");
    const service = new BuscasService();

    // Pre-populate with some imported records
    await service.importFromOds({
      records: [
        { deviceNumber: "7001", department: "A", holderType: "Principal", sourceSheet: "S1", sourceRow: 0 }
      ],
      parsedCellCount: 1,
      skippedRowCount: 0
    });

    // Re-import with empty result (e.g. buscas sheets removed from workbook)
    const count = await service.importFromOds({ records: [], parsedCellCount: 0, skippedRowCount: 0 });

    expect(count).toBe(0);
    const imported = await service.listImported();
    expect(imported).toHaveLength(0);
  });

  it("importFromOds — rejects parse result exceeding MAX_SPREADSHEET_IMPORT_ROWS with the same error as the contacts path", async () => {
    const { BuscasService } = await import("./buscas.service.js");
    const { MAX_SPREADSHEET_IMPORT_ROWS } = await import("./spreadsheet-import.service.js");
    const service = new BuscasService();

    const oversizedRecords = Array.from({ length: MAX_SPREADSHEET_IMPORT_ROWS + 1 }, (_, i) => ({
      deviceNumber: String(7000 + i),
      department: "Test",
      holderType: "Principal",
      sourceSheet: "S1",
      sourceRow: i
    }));

    await expect(
      service.importFromOds({ records: oversizedRecords, parsedCellCount: oversizedRecords.length, skippedRowCount: 0 })
    ).rejects.toThrow(`El archivo supera el límite máximo de ${MAX_SPREADSHEET_IMPORT_ROWS} filas. Divide el archivo e importa en lotes.`);

    // Nothing should have been persisted
    const imported = await service.listImported();
    expect(imported).toHaveLength(0);
  });
});
