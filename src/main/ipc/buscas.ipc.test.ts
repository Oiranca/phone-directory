import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// Minimal stub for ipcMain that collects handler registrations
const handlers = new Map<string, (...args: unknown[]) => unknown>();
const ipcMainStub = {
  handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
    handlers.set(channel, fn);
  }
};

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

describe("registerBuscasIpc", () => {
  // Register the handlers once for all tests
  const serviceMock = {
    list: vi.fn().mockResolvedValue([]),
    add: vi.fn(),
    update: vi.fn(),
    remove: vi.fn(),
    search: vi.fn().mockResolvedValue([])
  };

  // Dynamic import so the vi.mock above is applied before the module loads
  beforeAll(async () => {
    const { registerBuscasIpc } = await import("./buscas.ipc.js");
    registerBuscasIpc(serviceMock as never);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("update channel — buscas:update", () => {
    it("rejects a non-string ID", async () => {
      await expect(invoke("buscas:update", 42, {
        deviceNumber: "B-001",
        assignedTo: "Ana",
        department: "Urgencias",
        role: "Enfermera",
        shift: "mañana"
      })).rejects.toThrow("ID de busca inválido.");
    });

    it("rejects an empty string ID", async () => {
      await expect(invoke("buscas:update", "   ", {
        deviceNumber: "B-001",
        assignedTo: "Ana",
        department: "Urgencias",
        role: "Enfermera",
        shift: "mañana"
      })).rejects.toThrow("ID de busca inválido.");
    });

    it("rejects a null ID", async () => {
      await expect(invoke("buscas:update", null, {
        deviceNumber: "B-001",
        assignedTo: "Ana",
        department: "Urgencias",
        role: "Enfermera",
        shift: "mañana"
      })).rejects.toThrow("ID de busca inválido.");
    });

    it("rejects a malformed payload — missing required fields", async () => {
      await expect(invoke("buscas:update", "bsc_abc12345", {
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

      await invoke("buscas:update", "bsc_abc12345", {
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

  describe("remove channel — buscas:delete", () => {
    it("rejects a non-string ID", async () => {
      await expect(invoke("buscas:delete", 99)).rejects.toThrow("ID de busca inválido.");
    });

    it("rejects an empty string ID", async () => {
      await expect(invoke("buscas:delete", "")).rejects.toThrow("ID de busca inválido.");
    });

    it("rejects undefined ID", async () => {
      await expect(invoke("buscas:delete", undefined)).rejects.toThrow("ID de busca inválido.");
    });

    it("passes valid ID through to service", async () => {
      serviceMock.remove.mockResolvedValue(undefined);

      await invoke("buscas:delete", "bsc_abc12345");

      expect(serviceMock.remove).toHaveBeenCalledWith("bsc_abc12345");
    });
  });

  describe("add channel — buscas:add", () => {
    it("rejects a malformed payload — missing required field", async () => {
      // Missing assignedTo, department, role, shift — Zod should throw
      await expect(invoke("buscas:add", {
        deviceNumber: "B-001"
      })).rejects.toThrow();
    });

    it("rejects a payload with invalid shift enum", async () => {
      await expect(invoke("buscas:add", {
        deviceNumber: "B-001",
        assignedTo: "Ana",
        department: "Urgencias",
        role: "Enfermera",
        shift: "mediodía"  // invalid enum value
      })).rejects.toThrow();
    });

    it("rejects a completely non-object payload", async () => {
      await expect(invoke("buscas:add", "not-an-object")).rejects.toThrow();
    });

    it("rejects null payload", async () => {
      await expect(invoke("buscas:add", null)).rejects.toThrow();
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

      await invoke("buscas:add", {
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
      const err = await invoke("buscas:add", {
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

      const err = await invoke("buscas:add", {
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

      const err = await invoke("buscas:delete", "bsc_abc12345").catch((e: unknown) => e);

      expect((err as Error).message).toContain("Error inesperado");
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("buscas:delete"),
        "raw string rejection"
      );
      consoleSpy.mockRestore();
    });
  });

  describe("search channel — buscas:search", () => {
    it("coerces non-string query to empty string and calls service.search", async () => {
      serviceMock.search.mockResolvedValue([]);

      await invoke("buscas:search", 42);

      expect(serviceMock.search).toHaveBeenCalledWith("");
    });

    it("coerces null query to empty string", async () => {
      serviceMock.search.mockResolvedValue([]);

      await invoke("buscas:search", null);

      expect(serviceMock.search).toHaveBeenCalledWith("");
    });

    it("coerces undefined query to empty string", async () => {
      serviceMock.search.mockResolvedValue([]);

      await invoke("buscas:search");

      expect(serviceMock.search).toHaveBeenCalledWith("");
    });

    it("passes through a valid string query unchanged", async () => {
      serviceMock.search.mockResolvedValue([]);

      await invoke("buscas:search", "urgencias");

      expect(serviceMock.search).toHaveBeenCalledWith("urgencias");
    });
  });
});
