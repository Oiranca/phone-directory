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
