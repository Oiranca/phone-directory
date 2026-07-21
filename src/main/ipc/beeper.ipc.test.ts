import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// handlers and ipcMainStub are hoisted via vi.hoisted() so the vi.mock factory
// below can reference them safely (vi.mock is hoisted to before all imports).
const { handlers, ipcMainStub } = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  const ipcMainStub = {
    handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
      handlers.set(channel, fn);
    }
  };
  return { handlers, ipcMainStub };
});

vi.mock("electron", () => ({
  ipcMain: ipcMainStub
}));

// Helper to invoke a registered handler as if called from the renderer
const invoke = async (channel: string, ...args: unknown[]): Promise<unknown> => {
  const fn = handlers.get(channel);
  if (!fn) throw new Error(`No handler registered for channel: ${channel}`);
  // IPC handlers receive (_event, ...args) — we pass a dummy event object
  return fn({} as unknown, ...args);
};

describe("registerBeepersIpc", () => {
  // Register the handlers once for all tests
  const serviceMock = {
    list: vi.fn().mockResolvedValue([]),
    add: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    listImported: vi.fn().mockResolvedValue([])
  };

  // Dynamic import so the vi.mock above is applied before the module loads
  beforeAll(async () => {
    const { registerBeepersIpc } = await import("./beeper.ipc.js");
    registerBeepersIpc(serviceMock as never);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ---------------------------------------------------------------------------
  // Handler-registration snapshot
  //
  // Asserts the EXACT set of channels registerBeepersIpc registers so that:
  // (a) beepers:search is provably absent, and
  // (b) any future dead handler addition is caught automatically.
  // ---------------------------------------------------------------------------
  describe("registered channel set", () => {
    it("registers exactly the expected channels and no others", () => {
      const registeredChannels = Array.from(handlers.keys()).sort();
      expect(registeredChannels).toEqual([
        "beepers:add",
        "beepers:delete",
        "beepers:list",
        "beepers:list-imported",
        "beepers:update"
      ]);
    });

    it("does NOT register the removed beepers:search channel", () => {
      expect(handlers.has("beepers:search")).toBe(false);
    });
  });

  describe("update channel — beepers:update", () => {
    it("rejects a non-string ID", async () => {
      await expect(invoke("beepers:update", 42, {
        deviceNumber: "B-001",
        assignedTo: "Ana",
        department: "Urgencias",
        role: "Enfermera",
        shift: "mañana"
      })).rejects.toThrow("ID de busca inválido.");
    });

    it("rejects an empty string ID", async () => {
      await expect(invoke("beepers:update", "   ", {
        deviceNumber: "B-001",
        assignedTo: "Ana",
        department: "Urgencias",
        role: "Enfermera",
        shift: "mañana"
      })).rejects.toThrow("ID de busca inválido.");
    });

    it("rejects a null ID", async () => {
      await expect(invoke("beepers:update", null, {
        deviceNumber: "B-001",
        assignedTo: "Ana",
        department: "Urgencias",
        role: "Enfermera",
        shift: "mañana"
      })).rejects.toThrow("ID de busca inválido.");
    });

    it("rejects a malformed payload — missing required fields", async () => {
      await expect(invoke("beepers:update", "bsc_abc12345", {
        deviceNumber: ""  // empty string fails min(1)
      })).rejects.toThrow();
    });

    it("passes valid ID and payload through to service", async () => {
      serviceMock.update.mockResolvedValue({
        id: "bsc_abc12345",
        deviceNumber: "B-001",
        assignedTo: "Ana",
        department: "Urgencias",
        role: "Enfermera",
        shift: "mañana"
      });

      await invoke("beepers:update", "bsc_abc12345", {
        deviceNumber: "B-001",
        assignedTo: "Ana",
        department: "Urgencias",
        role: "Enfermera",
        shift: "mañana"
      });

      expect(serviceMock.update).toHaveBeenCalledWith(
        "bsc_abc12345",
        expect.objectContaining({ deviceNumber: "B-001" })
      );
    });
  });

  describe("remove channel — beepers:delete", () => {
    it("rejects a non-string ID", async () => {
      await expect(invoke("beepers:delete", 99)).rejects.toThrow("ID de busca inválido.");
    });

    it("rejects an empty string ID", async () => {
      await expect(invoke("beepers:delete", "")).rejects.toThrow("ID de busca inválido.");
    });

    it("rejects undefined ID", async () => {
      await expect(invoke("beepers:delete", undefined)).rejects.toThrow("ID de busca inválido.");
    });

    it("passes valid ID through to service", async () => {
      serviceMock.remove.mockResolvedValue(undefined);

      await invoke("beepers:delete", "bsc_abc12345");

      expect(serviceMock.remove).toHaveBeenCalledWith("bsc_abc12345");
    });
  });

  describe("add channel — beepers:add", () => {
    it("rejects a malformed payload — missing required field", async () => {
      // Missing assignedTo, department, role, shift — Zod should throw
      await expect(invoke("beepers:add", {
        deviceNumber: "B-001"
      })).rejects.toThrow();
    });

    it("rejects a payload with invalid shift enum", async () => {
      await expect(invoke("beepers:add", {
        deviceNumber: "B-001",
        assignedTo: "Ana",
        department: "Urgencias",
        role: "Enfermera",
        shift: "mediodía"  // invalid enum value
      })).rejects.toThrow();
    });

    it("rejects a completely non-object payload", async () => {
      await expect(invoke("beepers:add", "not-an-object")).rejects.toThrow();
    });

    it("rejects null payload", async () => {
      await expect(invoke("beepers:add", null)).rejects.toThrow();
    });

    it("passes valid payload through to service after Zod validation", async () => {
      const record = {
        id: "bsc_abc12345",
        deviceNumber: "B-001",
        assignedTo: "Ana",
        department: "Urgencias",
        role: "Enfermera",
        shift: "mañana" as const
      };
      serviceMock.add.mockResolvedValue(record);

      await invoke("beepers:add", {
        deviceNumber: "B-001",
        assignedTo: "Ana",
        department: "Urgencias",
        role: "Enfermera",
        shift: "mañana"
      });

      expect(serviceMock.add).toHaveBeenCalledWith(
        expect.objectContaining({ deviceNumber: "B-001", shift: "mañana" })
      );
    });
  });

  describe("error mapping — toRendererError", () => {
    it("maps ZodError to the first issue message (no internal paths leaked)", async () => {
      // An invalid payload causes a ZodError; the handler must surface only the first issue message
      const err = await invoke("beepers:add", {
        deviceNumber: "",       // fails min(1) → "El número de busca es obligatorio."
        assignedTo: "Ana",
        department: "Urgencias",
        role: "Enfermera",
        shift: "mañana"
      }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toBe("El número de busca es obligatorio.");
    });

    it("passes domain Error messages from service through unchanged", async () => {
      serviceMock.add.mockRejectedValueOnce(new Error("El número de busca \"B-001\" ya está registrado."));

      const err = await invoke("beepers:add", {
        deviceNumber: "B-001",
        assignedTo: "Ana",
        department: "Urgencias",
        role: "Enfermera",
        shift: "mañana"
      }).catch((e: unknown) => e);

      expect((err as Error).message).toBe("El número de busca \"B-001\" ya está registrado.");
    });

    it("converts non-Error throws to a generic message and logs to console.error", async () => {
      serviceMock.remove.mockRejectedValueOnce("raw string rejection");

      const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

      const err = await invoke("beepers:delete", "bsc_abc12345").catch((e: unknown) => e);

      expect((err as Error).message).toContain("Error inesperado");
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("beepers:delete"),
        "raw string rejection"
      );
      consoleSpy.mockRestore();
    });
  });

  describe("listImported channel — beepers:list-imported", () => {
    it("returns empty array when no ODS import has occurred", async () => {
      serviceMock.listImported.mockResolvedValue([]);

      const result = await invoke("beepers:list-imported");

      expect(result).toEqual([]);
      expect(serviceMock.listImported).toHaveBeenCalledOnce();
    });

    it("returns imported records from the service", async () => {
      const importedRecords = [
        {
          id: "ibsc_aabbccdd",
          deviceNumber: "7321",
          department: "Anestesia",
          holderType: "Principal / Residente",
          sourceSheet: "Buscas_Facultativos",
          sourceRow: 0
        },
        {
          id: "ibsc_11223344",
          deviceNumber: "7580",
          department: "Cardiología",
          holderType: "Adjunto 1",
          sourceSheet: "Buscas_Facultativos",
          sourceRow: 1
        }
      ];
      serviceMock.listImported.mockResolvedValue(importedRecords);

      const result = await invoke("beepers:list-imported");

      expect(result).toEqual(importedRecords);
      expect(serviceMock.listImported).toHaveBeenCalledOnce();
    });

    it("propagates service errors through toRendererError", async () => {
      serviceMock.listImported.mockRejectedValueOnce(new Error("permiso denegado"));

      const err = await invoke("beepers:list-imported").catch((e: unknown) => e);

      expect(err).toBeInstanceOf(Error);
      expect((err as Error).message).toBe("permiso denegado");
    });
  });
});
