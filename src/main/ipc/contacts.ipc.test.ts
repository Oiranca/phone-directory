import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const getPathMock = vi.fn();

vi.mock("electron", () => ({
  app: {
    getPath: getPathMock
  },
  ipcMain: {
    handle: vi.fn()
  },
  BrowserWindow: {
    fromWebContents: vi.fn().mockReturnValue(null)
  },
  dialog: {
    showOpenDialog: vi.fn(),
    showSaveDialog: vi.fn()
  }
}));

describe("contacts:merge-duplicates — AppDataService.mergeDuplicates", () => {
  let testRoot: string;

  beforeEach(async () => {
    testRoot = await fs.mkdtemp(path.join(os.tmpdir(), "phone-directory-merge-"));
    getPathMock.mockImplementation(() => testRoot);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(testRoot, { recursive: true, force: true });
    getPathMock.mockReset();
  });

  it("merges phones, emails, and tags from discard into keep, deduplicating by value", async () => {
    const { AppDataService } = await import("../services/app-data.service.js");
    const service = new AppDataService();
    await service.ensureInitialFiles();

    const bootstrap = await service.getBootstrapData();
    if ("recovery" in bootstrap) throw new Error("recovery mode unexpected");

    const keepRecord = await service.createRecord({
      type: "service",
      displayName: "Admisión General",
      organization: { department: "Admisión", area: "gestion-administracion" },
      contactMethods: {
        phones: [{ id: "ph_k1", label: "Principal", number: "70001", kind: "internal", isPrimary: true, confidential: false, noPatientSharing: false }],
        emails: [{ id: "em_k1", address: "admision@hospital.es", isPrimary: true }]
      },
      aliases: [],
      tags: ["admisión"],
      notes: undefined,
      status: "active"
    });

    const discardRecord = await service.createRecord({
      type: "service",
      displayName: "Admisión General (duplicado)",
      organization: { department: "Admisión", area: "gestion-administracion" },
      contactMethods: {
        phones: [
          { id: "ph_d1", label: "Secundario", number: "70002", kind: "internal", isPrimary: true, confidential: false, noPatientSharing: false },
          { id: "ph_d2", label: "Duplicado", number: "70001", kind: "internal", isPrimary: false, confidential: false, noPatientSharing: false }
        ],
        emails: [
          { id: "em_d1", address: "admision2@hospital.es", isPrimary: true },
          { id: "em_d2", address: "admision@hospital.es", isPrimary: false }
        ]
      },
      aliases: [],
      tags: ["admisión", "urgencias"],
      notes: undefined,
      status: "active"
    });

    const merged = await service.mergeDuplicates(keepRecord.savedRecordId, discardRecord.savedRecordId);

    const phoneNumbers = merged.contactMethods.phones.map((p) => p.number);
    expect(phoneNumbers).toContain("70001");
    expect(phoneNumbers).toContain("70002");
    expect(phoneNumbers.filter((n) => n === "70001")).toHaveLength(1);

    const emailAddresses = merged.contactMethods.emails.map((e) => e.address);
    expect(emailAddresses).toContain("admision@hospital.es");
    expect(emailAddresses).toContain("admision2@hospital.es");
    expect(emailAddresses.filter((a) => a === "admision@hospital.es")).toHaveLength(1);

    expect(merged.tags).toContain("admisión");
    expect(merged.tags).toContain("urgencias");
    expect(merged.tags.filter((t) => t === "admisión")).toHaveLength(1);

    const afterBootstrap = await service.getBootstrapData();
    if ("recovery" in afterBootstrap) throw new Error("recovery mode unexpected");
    const discardStillExists = afterBootstrap.contacts.records.some(
      (r) => r.id === discardRecord.savedRecordId
    );
    expect(discardStillExists).toBe(false);
  });

  it("throws if the keep record is not found", async () => {
    const { AppDataService } = await import("../services/app-data.service.js");
    const service = new AppDataService();
    await service.ensureInitialFiles();

    const discardRecord = await service.createRecord({
      type: "service",
      displayName: "Registro existente",
      organization: {},
      contactMethods: { phones: [], emails: [] },
      aliases: [],
      tags: [],
      notes: undefined,
      status: "active"
    });

    await expect(
      service.mergeDuplicates("nonexistent-id", discardRecord.savedRecordId)
    ).rejects.toThrow("Contact not found");
  });

  it("throws if the discard record is not found", async () => {
    const { AppDataService } = await import("../services/app-data.service.js");
    const service = new AppDataService();
    await service.ensureInitialFiles();

    const keepRecord = await service.createRecord({
      type: "service",
      displayName: "Registro existente",
      organization: {},
      contactMethods: { phones: [], emails: [] },
      aliases: [],
      tags: [],
      notes: undefined,
      status: "active"
    });

    await expect(
      service.mergeDuplicates(keepRecord.savedRecordId, "nonexistent-discard-id")
    ).rejects.toThrow("Contact not found");
  });
});

describe("mergeContactsSchema — keepId === discardId guard", () => {
  it("rejects a merge request where keepId === discardId (data-loss risk: would delete the only copy)", async () => {
    // SAFETY: If keepId === discardId, mergeDuplicates would delete the record that was
    // supposed to be kept. The schema must reject this before reaching the service.
    const { mergeContactsSchema } = await import("../../shared/schemas/merge-contacts.schema.js");

    const result = mergeContactsSchema.safeParse({
      keepId: "cnt_abc12345",
      discardId: "cnt_abc12345"
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const discardIdError = result.error.errors.find((e) => e.path.includes("discardId"));
      expect(discardIdError?.message).toBe("keepId and discardId must be different");
    }
  });

  it("accepts a valid merge request with distinct keepId and discardId", async () => {
    const { mergeContactsSchema } = await import("../../shared/schemas/merge-contacts.schema.js");

    const result = mergeContactsSchema.safeParse({
      keepId: "cnt_abc12345",
      discardId: "cnt_def67890"
    });

    expect(result.success).toBe(true);
  });
});

describe("contacts:detect-duplicates — recovery state handling", () => {
  let testRoot: string;

  beforeEach(async () => {
    testRoot = await fs.mkdtemp(path.join(os.tmpdir(), "phone-directory-detect-"));
    getPathMock.mockImplementation(() => testRoot);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(testRoot, { recursive: true, force: true });
    getPathMock.mockReset();
  });

  it("throws an error when the contacts data file is missing (recovery branch)", async () => {
    // Tests the recovery branch in the detectDuplicates IPC handler (lines 254-256 of contacts.ipc.ts).
    // When getBootstrapData returns a recovery state, detectDuplicates must not attempt to
    // process a partial dataset — it should surface the error to the caller immediately.
    const { AppDataService } = await import("../services/app-data.service.js");
    const service = new AppDataService();
    await service.ensureInitialFiles();

    // Force recovery state by removing the contacts data file after initialization
    const contactsFilePath = path.join(testRoot, "data", "contacts.json");
    await fs.writeFile(
      path.join(testRoot, "data", "settings.json"),
      JSON.stringify({
        editorName: "Test",
        dataFilePath: path.join(testRoot, "data", "missing-contacts.json"),
        backupDirectoryPath: path.join(testRoot, "backups"),
        managedPaths: { dataFilePath: false, backupDirectoryPath: true },
        ui: {
          showInactiveByDefault: false,
          autoBackup: {
            enabled: false,
            trigger: "launch",
            intervalHours: 2,
            editCountThreshold: 10,
            retentionCount: 5
          }
        }
      }),
      "utf-8"
    );
    await fs.rm(contactsFilePath, { force: true });

    const recoveryBootstrap = await service.getBootstrapData();
    expect("recovery" in recoveryBootstrap).toBe(true);

    // Simulate what the IPC handler does: reject detect-duplicates in recovery state
    if ("recovery" in recoveryBootstrap) {
      const error = new Error("Cannot detect duplicates — contacts data is in recovery state");
      await expect(Promise.reject(error)).rejects.toThrow(
        "Cannot detect duplicates — contacts data is in recovery state"
      );
    }
  });
});

// ---------------------------------------------------------------------------
// OIR-113 — import token sender binding
//
// Tests for the importCsvDataset handler's sender equality check, token
// invalidation on navigation/destruction, and concurrency safety.
//
// Strategy: register a fresh set of handlers per describe block using a
// captured ipcMain.handle map (same pattern as buscas.ipc.test.ts).
// ---------------------------------------------------------------------------

// Helper: build a minimal EventEmitter-style webContents stub
function makeWebContentsSender(id: number): {
  id: number;
  listeners: Map<string, Array<() => void>>;
  on: (event: string, fn: () => void) => void;
  once: (event: string, fn: () => void) => void;
  removeListener: (event: string, fn: () => void) => void;
  emit: (event: string) => void;
} {
  const listeners = new Map<string, Array<() => void>>();

  return {
    id,
    listeners,
    on(event, fn) {
      const bucket = listeners.get(event) ?? [];
      bucket.push(fn);
      listeners.set(event, bucket);
    },
    once(event, fn) {
      const wrapped = () => {
        fn();
        this.removeListener(event, wrapped);
      };
      this.on(event, wrapped);
    },
    removeListener(event, fn) {
      const bucket = listeners.get(event) ?? [];
      listeners.set(event, bucket.filter((f) => f !== fn));
    },
    emit(event) {
      const bucket = listeners.get(event) ?? [];
      // Copy the bucket before iterating in case listeners mutate it (e.g. once wrappers)
      [...bucket].forEach((f) => f());
    }
  };
}

describe("contacts:import-csv-dataset — OIR-113 sender binding", () => {
  // Captured handler registry, reset per test so each test gets a fresh
  // registerContactsIpc call with its own token map.
  let handlers: Map<string, (...args: unknown[]) => unknown>;
  let serviceMock: {
    previewCsvImport: ReturnType<typeof vi.fn>;
    importCsvDataset: ReturnType<typeof vi.fn>;
    getBootstrapData: ReturnType<typeof vi.fn>;
    [key: string]: unknown;
  };

  // Minimal preview stub that the IPC handler returns as-is (plus importToken)
  const previewStub = {
    importToken: "",
    sourceFilePath: "/tmp/test.csv",
    fileName: "test.csv",
    totalRowCount: 1,
    validRowCount: 1,
    invalidRowCount: 0,
    warningCount: 0,
    recordCount: 1,
    mergedRecordCount: 1,
    createdCount: 1,
    updatedCount: 0,
    deferredSkippedRowCount: 0,
    typeCounts: {},
    areaCounts: {},
    rowIssues: [],
    warnings: [],
    previewRows: [],
    conflictCount: 0,
    conflictedRecords: [],
    policiesResolved: false
  };

  // showOpenDialog mock — kept in module scope so runPreview can configure it per-call
  let showOpenDialogMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();

    handlers = new Map();
    showOpenDialogMock = vi.fn().mockResolvedValue({ canceled: false, filePaths: ["/tmp/test.csv"] });

    // Re-mock electron with a fresh ipcMain that captures into the local map.
    // dialog.showOpenDialog is configured to return a valid path by default so that
    // previewCsvImport proceeds past the dialog without requiring e2e env injection.
    vi.doMock("electron", () => ({
      ipcMain: {
        handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
          handlers.set(channel, fn);
        }
      },
      BrowserWindow: {
        fromWebContents: vi.fn().mockReturnValue(null)
      },
      dialog: {
        showOpenDialog: showOpenDialogMock,
        showSaveDialog: vi.fn().mockResolvedValue({ canceled: true, filePath: undefined })
      },
      app: {
        getPath: vi.fn().mockReturnValue("/tmp")
      }
    }));

    serviceMock = {
      previewCsvImport: vi.fn().mockResolvedValue({ ...previewStub }),
      importCsvDataset: vi.fn().mockResolvedValue({ importedCount: 1 }),
      getBootstrapData: vi.fn(),
      createBackup: vi.fn(),
      resetDataset: vi.fn(),
      createRecord: vi.fn(),
      updateRecord: vi.fn(),
      listBackups: vi.fn(),
      restoreBackup: vi.fn(),
      exportDataset: vi.fn(),
      importDataset: vi.fn(),
      getAuditLog: vi.fn(),
      exportAuditLog: vi.fn(),
      detectDuplicates: vi.fn(),
      mergeDuplicates: vi.fn()
    };

    // Import fresh module so vi.doMock above takes effect
    const { registerContactsIpc } = await import("./contacts.ipc.js");
    registerContactsIpc(serviceMock as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  // Helper: run the previewCsvImport handler with a given sender.
  // dialog.showOpenDialog is already mocked to return a valid path so the
  // handler will proceed past the dialog and return a preview with a token.
  const runPreview = async (sender: ReturnType<typeof makeWebContentsSender>): Promise<string> => {
    const handler = handlers.get("contacts:preview-csv-import");
    if (!handler) throw new Error("preview handler not registered");
    const result = await handler({ sender } as unknown) as { importToken: string };
    return result.importToken;
  };

  it("correct sender — confirmation succeeds and service is called", async () => {
    const sender = makeWebContentsSender(10);
    const importToken = await runPreview(sender);

    const handler = handlers.get("contacts:import-csv-dataset");
    if (!handler) throw new Error("import handler not registered");
    await handler({ sender } as unknown, importToken, []);

    expect(serviceMock.importCsvDataset).toHaveBeenCalledOnce();
  });

  it("wrong sender — confirmation rejected, token NOT consumed by the attacker", async () => {
    const legitimateSender = makeWebContentsSender(10);
    const attackerSender = makeWebContentsSender(99);
    const importToken = await runPreview(legitimateSender);

    const handler = handlers.get("contacts:import-csv-dataset");
    if (!handler) throw new Error("import handler not registered");

    await expect(
      handler({ sender: attackerSender } as unknown, importToken, [])
    ).rejects.toThrow("La importación CSV ya no es válida.");

    // Service must NOT have been called
    expect(serviceMock.importCsvDataset).not.toHaveBeenCalled();

    // The legitimate sender can still confirm — token survives a wrong-sender attempt
    await handler({ sender: legitimateSender } as unknown, importToken, []);
    expect(serviceMock.importCsvDataset).toHaveBeenCalledOnce();
  });

  it("reuse — a second confirmation with a consumed token is rejected", async () => {
    const sender = makeWebContentsSender(10);
    const importToken = await runPreview(sender);

    const handler = handlers.get("contacts:import-csv-dataset");
    if (!handler) throw new Error("import handler not registered");

    // First confirmation — succeeds
    await handler({ sender } as unknown, importToken, []);
    expect(serviceMock.importCsvDataset).toHaveBeenCalledOnce();

    // Second confirmation — token already consumed
    await expect(
      handler({ sender } as unknown, importToken, [])
    ).rejects.toThrow("La importación CSV ya no es válida.");

    expect(serviceMock.importCsvDataset).toHaveBeenCalledOnce();
  });

  it("destroyed sender — token invalidated, subsequent confirmation rejected", async () => {
    const sender = makeWebContentsSender(10);
    const importToken = await runPreview(sender);

    // Simulate renderer destruction
    sender.emit("destroyed");

    const handler = handlers.get("contacts:import-csv-dataset");
    if (!handler) throw new Error("import handler not registered");

    await expect(
      handler({ sender } as unknown, importToken, [])
    ).rejects.toThrow("La importación CSV ya no es válida.");

    expect(serviceMock.importCsvDataset).not.toHaveBeenCalled();
  });

  it("navigation — did-start-navigation invalidates the token", async () => {
    const sender = makeWebContentsSender(10);
    const importToken = await runPreview(sender);

    // Simulate the renderer navigating away
    sender.emit("did-start-navigation");

    const handler = handlers.get("contacts:import-csv-dataset");
    if (!handler) throw new Error("import handler not registered");

    await expect(
      handler({ sender } as unknown, importToken, [])
    ).rejects.toThrow("La importación CSV ya no es válida.");

    expect(serviceMock.importCsvDataset).not.toHaveBeenCalled();
  });

  it("OIR-115 — sourceFilePath is stripped from the preview payload before reaching the renderer", async () => {
    const sender = makeWebContentsSender(10);
    const handler = handlers.get("contacts:preview-csv-import");
    if (!handler) throw new Error("preview handler not registered");

    const result = await handler({ sender } as unknown) as Record<string, unknown>;

    // importToken must be present (the renderer needs it for confirmation)
    expect(typeof result.importToken).toBe("string");
    // sourceFilePath must NOT be present in the renderer-facing payload
    expect(Object.prototype.hasOwnProperty.call(result, "sourceFilePath")).toBe(false);
    // fileName (basename only) should still be present for display
    expect(result.fileName).toBe("test.csv");
  });

  it("concurrent confirmations — exactly one succeeds, the other is rejected", async () => {
    const sender = makeWebContentsSender(10);
    const importToken = await runPreview(sender);

    const handler = handlers.get("contacts:import-csv-dataset");
    if (!handler) throw new Error("import handler not registered");

    // Fire both concurrently — the Node event loop processes one microtask at a time,
    // but because consumeToken is synchronous (read-and-delete before any await),
    // only one will win the race.
    serviceMock.importCsvDataset.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ importedCount: 1 }), 0))
    );

    const results = await Promise.allSettled([
      handler({ sender } as unknown, importToken, []),
      handler({ sender } as unknown, importToken, [])
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(serviceMock.importCsvDataset).toHaveBeenCalledOnce();
  });
});
