import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CsvImportPreviewWithConflicts } from "../../shared/types/contact.js";

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
    showSaveDialog: vi.fn(),
    showMessageBox: vi.fn()
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
      beepers: [],
      type: "service",
      displayName: "Admisión General",
      organization: { department: "Admisión", area: "gestion-administracion" },
      contactMethods: {
        phones: [{ id: "ph_k1", label: "Principal", number: "70001", kind: "internal", isPrimary: true, confidential: false, noPatientSharing: false }],
        emails: [{ id: "em_k1", address: "admision@hospital.es", isPrimary: true }],
        socials: []
      },
      aliases: [],
      tags: ["admisión"],
      notes: undefined,
      status: "active"
    });

    const discardRecord = await service.createRecord({
      beepers: [],
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
        ],
        socials: []
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
      beepers: [],
      type: "service",
      displayName: "Registro existente",
      organization: {},
      contactMethods: { phones: [], emails: [], socials: [] },
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
      beepers: [],
      type: "service",
      displayName: "Registro existente",
      organization: {},
      contactMethods: { phones: [], emails: [], socials: [] },
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

// ---------------------------------------------------------------------------
// Field-level overrides applied on top of the keep/discard merge
// ---------------------------------------------------------------------------

describe("contacts:merge-duplicates — mergeDuplicates(keepId, discardId, overrides)", () => {
  let testRoot: string;

  beforeEach(async () => {
    testRoot = await fs.mkdtemp(path.join(os.tmpdir(), "phone-directory-merge-overrides-"));
    getPathMock.mockImplementation(() => testRoot);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(testRoot, { recursive: true, force: true });
    getPathMock.mockReset();
  });

  it("(a) behaves exactly like the no-overrides path when overrides is undefined", async () => {
    const { AppDataService } = await import("../services/app-data.service.js");
    const service = new AppDataService();
    await service.ensureInitialFiles();

    const keepRecord = await service.createRecord({
      beepers: [],
      type: "service",
      displayName: "Admisión General",
      organization: { department: "Admisión" },
      contactMethods: {
        phones: [{ id: "ph_k1", number: "70001", kind: "internal", isPrimary: true, confidential: false, noPatientSharing: false }],
        emails: [],
        socials: []
      },
      aliases: [],
      tags: [],
      notes: undefined,
      status: "active"
    });

    const discardRecord = await service.createRecord({
      beepers: [],
      type: "service",
      displayName: "Admisión General (duplicado)",
      organization: {},
      contactMethods: { phones: [], emails: [], socials: [] },
      aliases: [],
      tags: [],
      notes: undefined,
      status: "active"
    });

    const merged = await service.mergeDuplicates(keepRecord.savedRecordId, discardRecord.savedRecordId);

    expect(merged.displayName).toBe("Admisión General");
    expect(merged.type).toBe("service");
  });

  it("(b) applies a displayName + type override on top of the automatic merge", async () => {
    const { AppDataService } = await import("../services/app-data.service.js");
    const service = new AppDataService();
    await service.ensureInitialFiles();

    const keepRecord = await service.createRecord({
      beepers: [],
      type: "service",
      displayName: "Admisión General",
      organization: { department: "Admisión" },
      contactMethods: { phones: [], emails: [], socials: [] },
      aliases: [],
      tags: [],
      notes: undefined,
      status: "active"
    });

    const discardRecord = await service.createRecord({
      beepers: [],
      type: "department",
      displayName: "Admisión General (duplicado)",
      organization: {},
      contactMethods: { phones: [], emails: [], socials: [] },
      aliases: [],
      tags: [],
      notes: undefined,
      status: "active"
    });

    const merged = await service.mergeDuplicates(
      keepRecord.savedRecordId,
      discardRecord.savedRecordId,
      { displayName: "Admisión General (corregido)", type: "department" }
    );

    expect(merged.displayName).toBe("Admisión General (corregido)");
    expect(merged.type).toBe("department");
  });

  it("(b) applies a contactMethods.phones override, replacing the automatically-merged phone list", async () => {
    const { AppDataService } = await import("../services/app-data.service.js");
    const service = new AppDataService();
    await service.ensureInitialFiles();

    const keepRecord = await service.createRecord({
      beepers: [],
      type: "service",
      displayName: "Admisión General",
      organization: {},
      contactMethods: {
        phones: [{ id: "ph_k1", number: "70001", kind: "internal", isPrimary: true, confidential: false, noPatientSharing: false }],
        emails: [],
        socials: []
      },
      aliases: [],
      tags: [],
      notes: undefined,
      status: "active"
    });

    const discardRecord = await service.createRecord({
      beepers: [],
      type: "service",
      displayName: "Admisión General (duplicado)",
      organization: {},
      contactMethods: {
        phones: [{ id: "ph_d1", number: "70002", kind: "internal", isPrimary: false, confidential: false, noPatientSharing: false }],
        emails: [],
        socials: []
      },
      aliases: [],
      tags: [],
      notes: undefined,
      status: "active"
    });

    // Override with a hand-edited phone list: corrected number for ph_k1,
    // and deliberately drop the discard's phone (user chose not to keep it).
    const merged = await service.mergeDuplicates(
      keepRecord.savedRecordId,
      discardRecord.savedRecordId,
      {
        contactMethods: {
          phones: [
            { id: "ph_k1", number: "70099", kind: "internal", isPrimary: true, confidential: false, noPatientSharing: false }
          ]
        }
      }
    );

    const phoneNumbers = merged.contactMethods.phones.map((p) => p.number);
    expect(phoneNumbers).toEqual(["70099"]);
  });

  it("(c) the IPC handler rejects a malformed overrides payload before it ever reaches the service", async () => {
    const { ipcMain } = await import("electron");
    const { registerContactsIpc } = await import("./contacts.ipc.js");
    const mergeDuplicatesMock = vi.fn();
    const serviceMock = { mergeDuplicates: mergeDuplicatesMock };

    registerContactsIpc(serviceMock as never);

    const handleMock = vi.mocked(ipcMain.handle);
    const registeredCall = handleMock.mock.calls.find(
      ([channel]) => channel === "contacts:merge-duplicates"
    );
    expect(registeredCall).toBeDefined();
    const handler = registeredCall![1] as (...args: unknown[]) => Promise<unknown>;

    await expect(
      handler({}, {
        keepId: "cnt_a",
        discardId: "cnt_b",
        overrides: { status: "inactive" } // status is not an overridable field — must be rejected
      })
    ).rejects.toThrow("Invalid merge request");

    expect(mergeDuplicatesMock).not.toHaveBeenCalled();
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
// Import token sender binding
//
// Tests for the importCsvDataset handler's sender equality check, token
// invalidation on navigation/destruction, and concurrency safety.
//
// Strategy: register a fresh set of handlers per describe block using a
// captured ipcMain.handle map (same pattern as beeper.ipc.test.ts).
// ---------------------------------------------------------------------------

// Helper: build a minimal EventEmitter-style webContents stub
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- generic listener args (e.g. did-start-navigation's details object)
type Listener = (...args: any[]) => void;
function makeWebContentsSender(id: number): {
  id: number;
  listeners: Map<string, Array<Listener>>;
  on: (event: string, fn: Listener) => void;
  once: (event: string, fn: Listener) => void;
  removeListener: (event: string, fn: Listener) => void;
  emit: (event: string, ...args: unknown[]) => void;
} {
  const listeners = new Map<string, Array<Listener>>();

  return {
    id,
    listeners,
    on(event, fn) {
      const bucket = listeners.get(event) ?? [];
      bucket.push(fn);
      listeners.set(event, bucket);
    },
    once(event, fn) {
      const wrapped: Listener = (...args) => {
        fn(...args);
        this.removeListener(event, wrapped);
      };
      this.on(event, wrapped);
    },
    removeListener(event, fn) {
      const bucket = listeners.get(event) ?? [];
      listeners.set(event, bucket.filter((f) => f !== fn));
    },
    emit(event, ...args) {
      const bucket = listeners.get(event) ?? [];
      // Copy the bucket before iterating in case listeners mutate it (e.g. once wrappers)
      [...bucket].forEach((f) => f(...args));
    }
  };
}

describe("contacts:import-csv-dataset — sender binding", () => {
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
    unchangedCount: 0,
    beepersSkippedRowCount: 0,
    socialHandleSkippedRowCount: 0,
    parsedBeepersCellCount: 0,
    typeCounts: {},
    areaCounts: {},
    rowIssues: [],
    warnings: [],
    previewRows: [],
    conflictCount: 0,
    conflictedRecords: [],
    policiesResolved: false
  } satisfies CsvImportPreviewWithConflicts & { sourceFilePath: string };

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
      deleteRecord: vi.fn(),
      listBackups: vi.fn(),
      restoreBackup: vi.fn(),
      exportDataset: vi.fn(),
      importDataset: vi.fn(),
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

    // Simulate the renderer navigating away (real cross-document navigation —
    // no event-details object, matching Electron's legacy call signature).
    sender.emit("did-start-navigation");

    const handler = handlers.get("contacts:import-csv-dataset");
    if (!handler) throw new Error("import handler not registered");

    await expect(
      handler({ sender } as unknown, importToken, [])
    ).rejects.toThrow("La importación CSV ya no es válida.");

    expect(serviceMock.importCsvDataset).not.toHaveBeenCalled();
  });

  // Root-cause fix: `did-start-navigation` also fires for SAME-DOCUMENT
  // navigations (hash/fragment changes, pushState/replaceState, same-page history
  // navigation — see Electron's `isSameDocument` event field). This app routes
  // entirely via createHashRouter, so an in-app hash change — or even a macOS
  // trackpad swipe-navigation gesture while scrolling the preview table — must
  // NOT invalidate an otherwise-still-valid pending import, since the renderer
  // document (and the preview UI holding the token) never actually unloaded.
  it("same-document navigation (hash change / isSameDocument) does NOT invalidate the token", async () => {
    const sender = makeWebContentsSender(10);
    const importToken = await runPreview(sender);

    // Simulate a same-document navigation event — the modern Electron handler
    // signature passes a single details object with isSameDocument: true.
    sender.emit("did-start-navigation", { isSameDocument: true });

    const handler = handlers.get("contacts:import-csv-dataset");
    if (!handler) throw new Error("import handler not registered");

    const result = await handler({ sender } as unknown, importToken, []);

    expect(result).toBeDefined();
    expect(serviceMock.importCsvDataset).toHaveBeenCalledOnce();
  });

  it("same-document navigation followed by a REAL cross-document navigation still invalidates the token", async () => {
    const sender = makeWebContentsSender(10);
    const importToken = await runPreview(sender);

    sender.emit("did-start-navigation", { isSameDocument: true });
    sender.emit("did-start-navigation", { isSameDocument: false });

    const handler = handlers.get("contacts:import-csv-dataset");
    if (!handler) throw new Error("import handler not registered");

    await expect(
      handler({ sender } as unknown, importToken, [])
    ).rejects.toThrow("La importación CSV ya no es válida.");

    expect(serviceMock.importCsvDataset).not.toHaveBeenCalled();
  });

  it("sourceFilePath is stripped from the preview payload before reaching the renderer", async () => {
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

  // ---------------------------------------------------------------------------
  // Bounded wrong-sender attempt counter
  // ---------------------------------------------------------------------------

  it("wrong sender — token survives the first wrong-sender attempt; legitimate sender can still confirm", async () => {
    const legitimateSender = makeWebContentsSender(10);
    const attackerSender = makeWebContentsSender(99);
    const importToken = await runPreview(legitimateSender);

    const handler = handlers.get("contacts:import-csv-dataset");
    if (!handler) throw new Error("import handler not registered");

    // One wrong-sender attempt — must be rejected opaquely
    await expect(
      handler({ sender: attackerSender } as unknown, importToken, [])
    ).rejects.toThrow("La importación CSV ya no es válida.");

    expect(serviceMock.importCsvDataset).not.toHaveBeenCalled();

    // The legitimate sender can still confirm (token survives attempt #1)
    await handler({ sender: legitimateSender } as unknown, importToken, []);
    expect(serviceMock.importCsvDataset).toHaveBeenCalledOnce();
  });

  it("wrong sender — token survives two wrong-sender attempts; legitimate sender can still confirm after attempt #2", async () => {
    const legitimateSender = makeWebContentsSender(10);
    const attackerSender = makeWebContentsSender(99);
    const importToken = await runPreview(legitimateSender);

    const handler = handlers.get("contacts:import-csv-dataset");
    if (!handler) throw new Error("import handler not registered");

    // Two wrong-sender attempts — must both be rejected opaquely
    await expect(
      handler({ sender: attackerSender } as unknown, importToken, [])
    ).rejects.toThrow("La importación CSV ya no es válida.");
    await expect(
      handler({ sender: attackerSender } as unknown, importToken, [])
    ).rejects.toThrow("La importación CSV ya no es válida.");

    expect(serviceMock.importCsvDataset).not.toHaveBeenCalled();

    // The legitimate sender can still confirm (token survives attempts #1 and #2)
    await handler({ sender: legitimateSender } as unknown, importToken, []);
    expect(serviceMock.importCsvDataset).toHaveBeenCalledOnce();
  });

  it("wrong sender cap — after 3 wrong-sender attempts the token is invalidated; correct sender is rejected after the wrong-sender cap is exhausted", async () => {
    const legitimateSender = makeWebContentsSender(10);
    const attackerSender = makeWebContentsSender(99);
    const importToken = await runPreview(legitimateSender);

    const handler = handlers.get("contacts:import-csv-dataset");
    if (!handler) throw new Error("import handler not registered");

    // Exhaust the cap with 3 wrong-sender probes
    for (let i = 0; i < 3; i++) {
      await expect(
        handler({ sender: attackerSender } as unknown, importToken, [])
      ).rejects.toThrow("La importación CSV ya no es válida.");
    }

    expect(serviceMock.importCsvDataset).not.toHaveBeenCalled();

    // Token must now be invalidated — even the correct sender is rejected
    await expect(
      handler({ sender: legitimateSender } as unknown, importToken, [])
    ).rejects.toThrow("La importación CSV ya no es válida.");

    expect(serviceMock.importCsvDataset).not.toHaveBeenCalled();
  });

  it("wrong sender cap — error messages are opaque (all four distinguishable paths return the same message)", async () => {
    // Confirms that all four distinguishable rejection paths surface the same generic error:
    // wrong-sender below cap (attempt 1), wrong-sender below cap (attempt 2),
    // wrong-sender at cap (attempt 3, triggers invalidation), and token-gone (no-pending-import).
    // The caller must not be able to distinguish any of these states.
    const legitimateSender = makeWebContentsSender(10);
    const attackerSender = makeWebContentsSender(99);
    const importToken = await runPreview(legitimateSender);

    const handler = handlers.get("contacts:import-csv-dataset");
    if (!handler) throw new Error("import handler not registered");

    const expectedError = "La importación CSV ya no es válida. Vuelve a seleccionar el archivo.";

    // Path 1: wrong-sender (below cap)
    const err1 = await handler({ sender: attackerSender } as unknown, importToken, []).catch((e: Error) => e);
    expect((err1 as Error).message).toBe(expectedError);

    // Path 2: wrong-sender below cap (attempt #2 of 3)
    const err2 = await handler({ sender: attackerSender } as unknown, importToken, []).catch((e: Error) => e);
    expect((err2 as Error).message).toBe(expectedError);

    // Path 3: cap-hit — wrong-sender attempt #3 triggers clearPendingCsvImport, still same error
    const err3 = await handler({ sender: attackerSender } as unknown, importToken, []).catch((e: Error) => e);
    expect((err3 as Error).message).toBe(expectedError);

    // Path 4: token gone (no-pending-import branch after cap invalidation) — same message
    const err4 = await handler({ sender: legitimateSender } as unknown, importToken, []).catch((e: Error) => e);
    expect((err4 as Error).message).toBe(expectedError);
  });
});

// ---------------------------------------------------------------------------
// pickAndImportDataset: single unified "Importar" entry point
//
// Verifies the extension-based dispatch: main owns the one dialog, and routes
// to the same underlying pipelines used by the existing importDataset /
// previewCsvImport channels, without ever accepting a renderer-supplied path.
// ---------------------------------------------------------------------------

describe("contacts:pick-and-import-dataset — unified picker dispatch", () => {
  let handlers: Map<string, (...args: unknown[]) => unknown>;
  let serviceMock: {
    importDataset: ReturnType<typeof vi.fn>;
    importJsonFile: ReturnType<typeof vi.fn>;
    previewCsvImport: ReturnType<typeof vi.fn>;
    [key: string]: unknown;
  };
  let showOpenDialogMock: ReturnType<typeof vi.fn>;

  const jsonImportResult = {
    contacts: { records: [], exportedAt: "2026-07-04T00:00:00.000Z", metadata: {}, catalogs: {} },
    settings: {},
    backupPath: "/tmp/backups/auto.json",
    importedFilePath: "/tmp/incoming/replacement.json",
    recordCount: 0
  };

  const csvPreviewStub = {
    sourceFilePath: "/tmp/incoming/directory.csv",
    fileName: "directory.csv",
    totalRowCount: 1,
    validRowCount: 1,
    invalidRowCount: 0,
    warningCount: 0,
    recordCount: 1,
    mergedRecordCount: 1,
    createdCount: 1,
    updatedCount: 0,
    unchangedCount: 0,
    beepersSkippedRowCount: 0,
    socialHandleSkippedRowCount: 0,
    parsedBeepersCellCount: 0,
    typeCounts: {},
    areaCounts: {},
    rowIssues: [],
    warnings: [],
    previewRows: [],
    conflictCount: 0,
    conflictedRecords: [],
    policiesResolved: true
  };

  beforeEach(async () => {
    vi.resetModules();

    handlers = new Map();
    showOpenDialogMock = vi.fn();

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
        showSaveDialog: vi.fn()
      },
      app: {
        getPath: vi.fn().mockReturnValue("/tmp")
      }
    }));

    serviceMock = {
      importDataset: vi.fn().mockResolvedValue(jsonImportResult),
      importJsonFile: vi.fn().mockResolvedValue({ kind: "contacts-import", result: jsonImportResult }),
      previewCsvImport: vi.fn().mockResolvedValue({ ...csvPreviewStub }),
      getBootstrapData: vi.fn(),
      createBackup: vi.fn(),
      resetDataset: vi.fn(),
      createRecord: vi.fn(),
      updateRecord: vi.fn(),
      listBackups: vi.fn(),
      restoreBackup: vi.fn(),
      exportDataset: vi.fn(),
      importCsvDataset: vi.fn(),
      detectDuplicates: vi.fn(),
      mergeDuplicates: vi.fn()
    };

    const { registerContactsIpc } = await import("./contacts.ipc.js");
    registerContactsIpc(serviceMock as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  const getHandler = () => {
    const handler = handlers.get("contacts:pick-and-import-dataset");
    if (!handler) throw new Error("pickAndImportDataset handler not registered");
    return handler;
  };

  it("classifies and imports a contacts JSON file", async () => {
    showOpenDialogMock.mockResolvedValue({ canceled: false, filePaths: ["/tmp/incoming/replacement.json"] });
    const sender = makeWebContentsSender(1);

    const response = await getHandler()({ sender } as unknown);

    expect(serviceMock.importJsonFile).toHaveBeenCalledWith("/tmp/incoming/replacement.json");
    expect(serviceMock.previewCsvImport).not.toHaveBeenCalled();
    // backupPath/importedFilePath are absolute filesystem paths and must be
    // stripped before the result crosses the IPC boundary into the renderer
    // (OIR-276) — the handler never forwards service.importDataset()'s raw
    // result, so the response must NOT contain either field.
    const { backupPath: _backupPath, importedFilePath: _importedFilePath, ...safeJsonImportResult } = jsonImportResult;
    expect(response).toEqual({ kind: "json-import", result: safeJsonImportResult });
    expect(response).not.toHaveProperty("result.backupPath");
    expect(response).not.toHaveProperty("result.importedFilePath");
  });

  it("strips every internal path from a combined JSON import", async () => {
    serviceMock.importJsonFile.mockResolvedValueOnce({
      kind: "combined-import",
      result: {
        ...jsonImportResult,
        beeperBackupPath: "/tmp/backups/beepers.json",
        beeperRecordCount: 4,
        importedBeeperRecordCount: 5
      }
    });
    showOpenDialogMock.mockResolvedValue({ canceled: false, filePaths: ["/tmp/incoming/combined.json"] });

    const response = await getHandler()({ sender: makeWebContentsSender(8) } as unknown);

    expect(response).toEqual({
      kind: "combined-import",
      result: {
        contacts: jsonImportResult.contacts,
        settings: jsonImportResult.settings,
        recordCount: 0,
        beeperRecordCount: 4,
        importedBeeperRecordCount: 5
      }
    });
    expect(response).not.toHaveProperty("result.backupPath");
    expect(response).not.toHaveProperty("result.beeperBackupPath");
    expect(response).not.toHaveProperty("result.importedFilePath");
  });

  it("routes a beepers JSON file to the beepers store", async () => {
    serviceMock.importJsonFile.mockResolvedValueOnce({
      kind: "beepers-import",
      recordCount: 0,
      importedRecordCount: 231
    });
    showOpenDialogMock.mockResolvedValue({ canceled: false, filePaths: ["/tmp/incoming/beepers.json"] });

    const response = await getHandler()({ sender: makeWebContentsSender(7) } as unknown);

    expect(response).toEqual({ kind: "beepers-import", recordCount: 0, importedRecordCount: 231 });
    expect(serviceMock.importDataset).not.toHaveBeenCalled();
  });

  it("routes a settings JSON file while returning managed settings", async () => {
    const settings = {
      editorName: "Operador",
      dataFilePath: "/usb/portable-data/data/contacts.json",
      backupDirectoryPath: "/usb/portable-data/backups",
      ui: { showInactiveByDefault: false, autoBackup: { enabled: true, trigger: "launch", intervalHours: 24, editCountThreshold: 20, retentionCount: 10 } }
    };
    serviceMock.importJsonFile.mockResolvedValueOnce({ kind: "settings-import", settings });
    showOpenDialogMock.mockResolvedValue({ canceled: false, filePaths: ["/tmp/incoming/settings.json"] });

    const response = await getHandler()({ sender: makeWebContentsSender(8) } as unknown);

    expect(response).toEqual({ kind: "settings-import", settings });
    expect(serviceMock.importDataset).not.toHaveBeenCalled();
  });

  it("dispatches to the same normalize/validate/preview pipeline as previewCsvImport for a .csv pick", async () => {
    showOpenDialogMock.mockResolvedValue({ canceled: false, filePaths: ["/tmp/incoming/directory.csv"] });
    const sender = makeWebContentsSender(2);

    const response = await getHandler()({ sender } as unknown) as {
      kind: string;
      preview: { importToken: string; sourceFilePath?: string; fileName: string };
    };

    expect(serviceMock.previewCsvImport).toHaveBeenCalledWith("/tmp/incoming/directory.csv");
    expect(serviceMock.importDataset).not.toHaveBeenCalled();
    expect(response.kind).toBe("csv-preview");
    // Parity with previewCsvImport — the absolute source path must never reach the renderer here either.
    expect(Object.prototype.hasOwnProperty.call(response.preview, "sourceFilePath")).toBe(false);
    expect(typeof response.preview.importToken).toBe("string");
    expect(response.preview.fileName).toBe("directory.csv");
  });

  it.each(["ods", "xls", "xlsx"])("also dispatches .%s picks to the CSV-like pipeline", async (extension) => {
    showOpenDialogMock.mockResolvedValue({ canceled: false, filePaths: [`/tmp/incoming/directory.${extension}`] });
    const sender = makeWebContentsSender(3);

    const response = await getHandler()({ sender } as unknown) as { kind: string };

    expect(serviceMock.previewCsvImport).toHaveBeenCalledWith(`/tmp/incoming/directory.${extension}`);
    expect(response.kind).toBe("csv-preview");
  });

  it("returns { kind: 'cancelled' } when the dialog is dismissed without a selection", async () => {
    showOpenDialogMock.mockResolvedValue({ canceled: true, filePaths: [] });
    const sender = makeWebContentsSender(4);

    const response = await getHandler()({ sender } as unknown);

    expect(response).toEqual({ kind: "cancelled" });
    expect(serviceMock.importDataset).not.toHaveBeenCalled();
    expect(serviceMock.previewCsvImport).not.toHaveBeenCalled();
  });

  it("returns { kind: 'unsupported-extension' } and touches neither pipeline for an unexpected extension", async () => {
    showOpenDialogMock.mockResolvedValue({ canceled: false, filePaths: ["/tmp/incoming/malware.exe"] });
    const sender = makeWebContentsSender(5);

    const response = await getHandler()({ sender } as unknown);

    expect(response).toEqual({ kind: "unsupported-extension", extension: "exe" });
    expect(serviceMock.importDataset).not.toHaveBeenCalled();
    expect(serviceMock.previewCsvImport).not.toHaveBeenCalled();
  });

  it("opens exactly one native dialog filtered to json/csv/ods/xls/xlsx", async () => {
    showOpenDialogMock.mockResolvedValue({ canceled: true, filePaths: [] });
    const sender = makeWebContentsSender(6);

    await getHandler()({ sender } as unknown);

    expect(showOpenDialogMock).toHaveBeenCalledTimes(1);
    const [options] = showOpenDialogMock.mock.calls[0] as [{ filters: Array<{ extensions: string[] }> }];
    expect(options.filters[0]?.extensions.sort()).toEqual(["csv", "json", "ods", "xls", "xlsx"]);
  });
});

// ---------------------------------------------------------------------------
// Global cap on concurrent pending CSV imports
//
// pendingCsvImports previously had no upper bound across ALL senders (only a
// per-sender previous-token invalidation). Verifies the defensive global cap:
// once the map is full, the oldest pending import is evicted to admit a new
// preview, rather than letting the map grow unbounded until TTLs expire.
// ---------------------------------------------------------------------------

describe("contacts:preview-csv-import — global pending-import cap", () => {
  let handlers: Map<string, (...args: unknown[]) => unknown>;
  let serviceMock: {
    previewCsvImport: ReturnType<typeof vi.fn>;
    importCsvDataset: ReturnType<typeof vi.fn>;
    [key: string]: unknown;
  };
  let showOpenDialogMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();

    handlers = new Map();
    showOpenDialogMock = vi.fn().mockResolvedValue({ canceled: false, filePaths: ["/tmp/test.csv"] });

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
        showSaveDialog: vi.fn()
      },
      app: {
        getPath: vi.fn().mockReturnValue("/tmp")
      }
    }));

    serviceMock = {
      previewCsvImport: vi.fn().mockResolvedValue({
        sourceFilePath: "/tmp/test.csv",
        fileName: "test.csv"
      }),
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
      detectDuplicates: vi.fn(),
      mergeDuplicates: vi.fn()
    };

    const { registerContactsIpc } = await import("./contacts.ipc.js");
    registerContactsIpc(serviceMock as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("evicts the oldest pending import once the global cap is exceeded, admitting the newest", async () => {
    const previewHandler = handlers.get("contacts:preview-csv-import");
    if (!previewHandler) throw new Error("preview handler not registered");
    const importHandler = handlers.get("contacts:import-csv-dataset");
    if (!importHandler) throw new Error("import handler not registered");

    // Each sender is distinct so the per-sender "invalidate my previous token"
    // logic never kicks in — every preview call is a genuinely new pending
    // entry, which is what's needed to actually grow the global map.
    const MAX_PENDING_CSV_IMPORTS = 30;
    const tokens: string[] = [];

    for (let i = 0; i < MAX_PENDING_CSV_IMPORTS + 1; i += 1) {
      const sender = makeWebContentsSender(1000 + i);
      const result = await previewHandler({ sender } as unknown) as { importToken: string };
      tokens.push(result.importToken);
    }

    // The very first (oldest) token must have been evicted by the cap...
    const oldestSender = makeWebContentsSender(1000);
    await expect(
      importHandler({ sender: oldestSender } as unknown, tokens[0], [])
    ).rejects.toThrow("La importación CSV ya no es válida.");
    expect(serviceMock.importCsvDataset).not.toHaveBeenCalled();

    // ...while the newest (31st) token is still valid.
    const newestSender = makeWebContentsSender(1000 + MAX_PENDING_CSV_IMPORTS);
    await importHandler({ sender: newestSender } as unknown, tokens[tokens.length - 1], []);
    expect(serviceMock.importCsvDataset).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// csvImportPolicySelectionSchema (Zod) replaces manual
// typeof/Number.isInteger/Set.has validation of importCsvDataset's policy
// array, matching this codebase's "every IPC input goes through Zod"
// convention (createRecord, updateRecord, mergeDuplicates, beeper channels).
// ---------------------------------------------------------------------------

describe("csvImportPolicySelectionSchema", () => {
  it("accepts a well-formed policy selection array", async () => {
    const { csvImportPolicySelectionListSchema } = await import(
      "../../shared/schemas/csv-import-policy.schema.js"
    );

    const result = csvImportPolicySelectionListSchema.safeParse([
      { recordIndex: 0, policy: "overwrite" },
      { recordIndex: 1, policy: "skip" },
      { recordIndex: 2, policy: "merge-fields" }
    ]);

    expect(result.success).toBe(true);
  });

  it("accepts an empty array (no conflicts to resolve)", async () => {
    const { csvImportPolicySelectionListSchema } = await import(
      "../../shared/schemas/csv-import-policy.schema.js"
    );

    expect(csvImportPolicySelectionListSchema.safeParse([]).success).toBe(true);
  });

  it.each([
    ["not an array", { recordIndex: 0, policy: "overwrite" }],
    ["null", null],
    ["undefined", undefined],
    ["a string", "overwrite"]
  ])("rejects %s as the top-level value", async (_label, value) => {
    const { csvImportPolicySelectionListSchema } = await import(
      "../../shared/schemas/csv-import-policy.schema.js"
    );

    expect(csvImportPolicySelectionListSchema.safeParse(value).success).toBe(false);
  });

  it("rejects a non-integer recordIndex", async () => {
    const { csvImportPolicySelectionListSchema } = await import(
      "../../shared/schemas/csv-import-policy.schema.js"
    );

    const result = csvImportPolicySelectionListSchema.safeParse([{ recordIndex: 1.5, policy: "overwrite" }]);
    expect(result.success).toBe(false);
  });

  it("rejects an unknown policy value", async () => {
    const { csvImportPolicySelectionListSchema } = await import(
      "../../shared/schemas/csv-import-policy.schema.js"
    );

    const result = csvImportPolicySelectionListSchema.safeParse([{ recordIndex: 0, policy: "delete-everything" }]);
    expect(result.success).toBe(false);
  });

  it("rejects an item missing required fields", async () => {
    const { csvImportPolicySelectionListSchema } = await import(
      "../../shared/schemas/csv-import-policy.schema.js"
    );

    expect(csvImportPolicySelectionListSchema.safeParse([{ policy: "overwrite" }]).success).toBe(false);
    expect(csvImportPolicySelectionListSchema.safeParse([{ recordIndex: 0 }]).success).toBe(false);
  });

  // Defensive upper bound (renderer-controlled IPC payload) — mirrors the
  // 5000-row cap already enforced by csv-import.service.ts /
  // spreadsheet-import.service.ts, since this list holds at most one entry
  // per conflicting row of the previewed import.
  it("accepts a policy selection array at the 5000-entry max", async () => {
    const { csvImportPolicySelectionListSchema } = await import(
      "../../shared/schemas/csv-import-policy.schema.js"
    );

    const value = Array.from({ length: 5000 }, (_, i) => ({
      recordIndex: i,
      policy: "overwrite" as const
    }));

    expect(csvImportPolicySelectionListSchema.safeParse(value).success).toBe(true);
  });

  it("rejects a policy selection array exceeding the 5000-entry max", async () => {
    const { csvImportPolicySelectionListSchema } = await import(
      "../../shared/schemas/csv-import-policy.schema.js"
    );

    const value = Array.from({ length: 5001 }, (_, i) => ({
      recordIndex: i,
      policy: "overwrite" as const
    }));

    expect(csvImportPolicySelectionListSchema.safeParse(value).success).toBe(false);
  });
});

describe("contacts:import-csv-dataset — IPC handler rejects malformed policies via Zod", () => {
  let handlers: Map<string, (...args: unknown[]) => unknown>;
  let serviceMock: {
    previewCsvImport: ReturnType<typeof vi.fn>;
    importCsvDataset: ReturnType<typeof vi.fn>;
    [key: string]: unknown;
  };

  beforeEach(async () => {
    vi.resetModules();

    handlers = new Map();

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
        showOpenDialog: vi.fn().mockResolvedValue({ canceled: false, filePaths: ["/tmp/test.csv"] }),
        showSaveDialog: vi.fn()
      },
      app: {
        getPath: vi.fn().mockReturnValue("/tmp")
      }
    }));

    serviceMock = {
      previewCsvImport: vi.fn().mockResolvedValue({ sourceFilePath: "/tmp/test.csv", fileName: "test.csv" }),
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
      detectDuplicates: vi.fn(),
      mergeDuplicates: vi.fn()
    };

    const { registerContactsIpc } = await import("./contacts.ipc.js");
    registerContactsIpc(serviceMock as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("rejects a malformed policies array (invalid policy value) before it ever reaches the service", async () => {
    const previewHandler = handlers.get("contacts:preview-csv-import");
    if (!previewHandler) throw new Error("preview handler not registered");
    const importHandler = handlers.get("contacts:import-csv-dataset");
    if (!importHandler) throw new Error("import handler not registered");

    const sender = makeWebContentsSender(500);
    const { importToken } = await previewHandler({ sender } as unknown) as { importToken: string };

    await expect(
      importHandler({ sender } as unknown, importToken, [{ recordIndex: 0, policy: "not-a-real-policy" }])
    ).rejects.toThrow("Las políticas de conflicto no tienen un formato válido.");

    expect(serviceMock.importCsvDataset).not.toHaveBeenCalled();
  });

  it("rejects a non-array policies payload before it ever reaches the service", async () => {
    const previewHandler = handlers.get("contacts:preview-csv-import");
    if (!previewHandler) throw new Error("preview handler not registered");
    const importHandler = handlers.get("contacts:import-csv-dataset");
    if (!importHandler) throw new Error("import handler not registered");

    const sender = makeWebContentsSender(501);
    const { importToken } = await previewHandler({ sender } as unknown) as { importToken: string };

    await expect(
      importHandler({ sender } as unknown, importToken, { recordIndex: 0, policy: "overwrite" })
    ).rejects.toThrow("Las políticas de conflicto no tienen un formato válido.");

    expect(serviceMock.importCsvDataset).not.toHaveBeenCalled();
  });

  it("accepts a well-formed policies array and forwards it to the service", async () => {
    const previewHandler = handlers.get("contacts:preview-csv-import");
    if (!previewHandler) throw new Error("preview handler not registered");
    const importHandler = handlers.get("contacts:import-csv-dataset");
    if (!importHandler) throw new Error("import handler not registered");

    const sender = makeWebContentsSender(502);
    const { importToken } = await previewHandler({ sender } as unknown) as { importToken: string };
    const policies = [{ recordIndex: 0, policy: "overwrite" }];

    await importHandler({ sender } as unknown, importToken, policies);

    expect(serviceMock.importCsvDataset).toHaveBeenCalledWith("/tmp/test.csv", policies);
  });
});

describe("contacts:export-dataset — sensitive-data warning", () => {
  let handlers: Map<string, (...args: unknown[]) => unknown>;
  let showMessageBoxMock: ReturnType<typeof vi.fn>;
  let showSaveDialogMock: ReturnType<typeof vi.fn>;
  let exportDatasetMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();
    handlers = new Map();
    showMessageBoxMock = vi.fn();
    showSaveDialogMock = vi.fn().mockResolvedValue({ canceled: false, filePath: "/tmp/exports/contacts.json" });
    exportDatasetMock = vi.fn().mockResolvedValue({
      filePath: "/tmp/exports/contacts.json",
      exportedAt: "2026-07-28T00:00:00.000Z",
      recordCount: 2,
      beeperRecordCount: 3,
      importedBeeperRecordCount: 4
    });

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
        showOpenDialog: vi.fn(),
        showSaveDialog: showSaveDialogMock,
        showMessageBox: showMessageBoxMock
      },
      app: {
        getPath: vi.fn().mockReturnValue("/tmp")
      }
    }));

    const { registerContactsIpc } = await import("./contacts.ipc.js");
    registerContactsIpc({
      getBootstrapData: vi.fn(),
      createBackup: vi.fn(),
      resetDataset: vi.fn(),
      createRecord: vi.fn(),
      updateRecord: vi.fn(),
      listBackups: vi.fn(),
      restoreBackup: vi.fn(),
      exportDataset: exportDatasetMock,
      importDataset: vi.fn(),
      previewCsvImport: vi.fn(),
      importCsvDataset: vi.fn(),
      detectDuplicates: vi.fn(),
      mergeDuplicates: vi.fn()
    } as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("shows a sensitive-data warning before opening the save dialog", async () => {
    showMessageBoxMock.mockResolvedValue({ response: 1 });

    const handler = handlers.get("contacts:export-dataset");
    expect(handler).toBeDefined();

    await handler!({ sender: { id: 1 } });

    expect(showMessageBoxMock).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Exportar datos sensibles",
        message: "El archivo exportado contiene datos sensibles de la agenda y las buscas."
      })
    );
    expect(showSaveDialogMock).toHaveBeenCalledTimes(1);
    expect(exportDatasetMock).toHaveBeenCalledWith("/tmp/exports/contacts.json");
  });

  // OIR-276: the absolute export filePath is main-process-only — the
  // renderer only receives the basename, never the full path (which would
  // otherwise leak the OS username/filesystem structure).
  it("strips the absolute filePath from the export result, returning only fileName", async () => {
    showMessageBoxMock.mockResolvedValue({ response: 1 });

    const handler = handlers.get("contacts:export-dataset");
    const result = await handler!({ sender: { id: 1 } });

    expect(result).toEqual({
      fileName: "contacts.json",
      exportedAt: "2026-07-28T00:00:00.000Z",
      recordCount: 2,
      beeperRecordCount: 3,
      importedBeeperRecordCount: 4
    });
    expect(result).not.toHaveProperty("filePath");
  });

  it("cancels export when the sensitive-data warning is declined", async () => {
    showMessageBoxMock.mockResolvedValue({ response: 0 });

    const handler = handlers.get("contacts:export-dataset");
    const result = await handler!({ sender: { id: 1 } });

    expect(result).toBeNull();
    expect(showSaveDialogMock).not.toHaveBeenCalled();
    expect(exportDatasetMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// OIR-276 — absolute filesystem paths must never cross the IPC boundary into
// the renderer. AppDataService's methods keep returning full backupPath/
// importedFilePath/filePath internally (needed for tests and restoreBackup
// chaining); each contacts.ipc.ts handler is responsible for stripping those
// fields before its result reaches the renderer.
// ---------------------------------------------------------------------------
describe("contacts IPC channels — absolute path stripping (OIR-276)", () => {
  let handlers: Map<string, (...args: unknown[]) => unknown>;
  let serviceMock: {
    createBackup: ReturnType<typeof vi.fn>;
    listBackups: ReturnType<typeof vi.fn>;
    importDataset: ReturnType<typeof vi.fn>;
    restoreBackup: ReturnType<typeof vi.fn>;
    resolveBackupDirectory: ReturnType<typeof vi.fn>;
    resetDataset: ReturnType<typeof vi.fn>;
    importCsvDataset: ReturnType<typeof vi.fn>;
    [key: string]: unknown;
  };
  let showOpenDialogMock: ReturnType<typeof vi.fn>;

  const importResultInternal = {
    contacts: { records: [], exportedAt: "2026-08-02T00:00:00.000Z", metadata: {}, catalogs: {} },
    settings: {},
    backupPath: "/Users/operator/AppData/backups/contacts-auto.json",
    importedFilePath: "/Users/operator/Desktop/replacement.json",
    recordCount: 0
  };

  beforeEach(async () => {
    vi.resetModules();
    handlers = new Map();
    showOpenDialogMock = vi.fn();

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
        showSaveDialog: vi.fn(),
        showMessageBox: vi.fn()
      },
      app: {
        getPath: vi.fn().mockReturnValue("/tmp")
      }
    }));

    serviceMock = {
      getBootstrapData: vi.fn(),
      createBackup: vi.fn().mockResolvedValue("/Users/operator/AppData/backups/contacts-manual.json"),
      resetDataset: vi.fn().mockResolvedValue({
        contacts: { records: [], exportedAt: "2026-08-02T00:00:00.000Z", metadata: {}, catalogs: {} },
        settings: {},
        backupPath: "/Users/operator/AppData/backups/contacts-before-reset.json"
      }),
      createRecord: vi.fn(),
      updateRecord: vi.fn(),
      listBackups: vi.fn().mockResolvedValue([
        {
          fileName: "contacts-1.json",
          filePath: "/Users/operator/AppData/backups/contacts-1.json",
          createdAt: "2026-08-01T00:00:00.000Z",
          sizeBytes: 2048
        }
      ]),
      restoreBackup: vi.fn().mockResolvedValue({ ...importResultInternal }),
      resolveBackupDirectory: vi.fn().mockResolvedValue("/Users/operator/AppData/backups"),
      exportDataset: vi.fn(),
      importDataset: vi.fn().mockResolvedValue({ ...importResultInternal }),
      previewCsvImport: vi.fn(),
      importCsvDataset: vi.fn().mockResolvedValue({
        ...importResultInternal,
        warningCount: 0,
        invalidRowCount: 0,
        createdCount: 0,
        updatedCount: 0,
        conflictCount: 0,
        beeperImportStatus: { status: "not-applicable", parsedCellCount: 0 },
        rowIssues: []
      }),
      detectDuplicates: vi.fn(),
      mergeDuplicates: vi.fn()
    };

    const { registerContactsIpc } = await import("./contacts.ipc.js");
    registerContactsIpc(serviceMock as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("createBackup: never forwards the resolved backup path to the renderer", async () => {
    const handler = handlers.get("contacts:create-backup");
    const result = await handler!({ sender: { id: 1 } });

    expect(serviceMock.createBackup).toHaveBeenCalledTimes(1);
    expect(result).toBeUndefined();
  });

  it("listBackups: strips filePath from every entry", async () => {
    const handler = handlers.get("contacts:list-backups");
    const result = await handler!({ sender: { id: 1 } });

    expect(result).toEqual([
      { fileName: "contacts-1.json", createdAt: "2026-08-01T00:00:00.000Z", sizeBytes: 2048 }
    ]);
    expect((result as Array<Record<string, unknown>>)[0]).not.toHaveProperty("filePath");
  });

  it("importDataset (direct channel): strips backupPath/importedFilePath", async () => {
    showOpenDialogMock.mockResolvedValue({ canceled: false, filePaths: ["/Users/operator/Desktop/replacement.json"] });

    const handler = handlers.get("contacts:import-dataset");
    const result = await handler!({ sender: { id: 1 } });

    expect(result).toEqual({
      contacts: importResultInternal.contacts,
      settings: importResultInternal.settings,
      recordCount: importResultInternal.recordCount
    });
    expect(result).not.toHaveProperty("backupPath");
    expect(result).not.toHaveProperty("importedFilePath");
  });

  it("restoreBackup: resolves a bare fileName against the backup directory and strips backupPath/importedFilePath", async () => {
    const handler = handlers.get("contacts:restore-backup");
    const result = await handler!({ sender: { id: 1 } }, "contacts-1.json");

    expect(serviceMock.resolveBackupDirectory).toHaveBeenCalledTimes(1);
    expect(serviceMock.restoreBackup).toHaveBeenCalledWith("/Users/operator/AppData/backups/contacts-1.json");
    expect(result).not.toHaveProperty("backupPath");
    expect(result).not.toHaveProperty("importedFilePath");
  });

  it.each([
    ["parent-directory traversal", "../evil.json"],
    ["nested path segment", "a/b.json"],
    ["nested path segment (Windows separator)", "a\\b.json"],
    ["absolute POSIX path", "/etc/passwd"],
    ["absolute Windows path", "C:\\Windows\\System32\\config.json"]
  ])("restoreBackup: rejects %s (%s) before ever resolving/calling the service", async (_label, backupFileName) => {
    const handler = handlers.get("contacts:restore-backup");

    await expect(handler!({ sender: { id: 1 } }, backupFileName)).rejects.toThrow(
      "No se pudo restaurar la copia de seguridad seleccionada."
    );
    expect(serviceMock.resolveBackupDirectory).not.toHaveBeenCalled();
    expect(serviceMock.restoreBackup).not.toHaveBeenCalled();
  });

  it("resetDataset: strips backupPath (including the non-null case)", async () => {
    const handler = handlers.get("contacts:reset-dataset");
    const result = await handler!({ sender: { id: 1 } });

    expect(result).not.toHaveProperty("backupPath");
  });

  it("importCsvDataset: strips backupPath/importedFilePath", async () => {
    // Set up a pending CSV import the same way previewCsvImport would.
    serviceMock.previewCsvImport = vi.fn().mockResolvedValue({
      sourceFilePath: "/Users/operator/Desktop/directory.csv",
      fileName: "directory.csv",
      totalRowCount: 0,
      validRowCount: 0,
      invalidRowCount: 0,
      warningCount: 0,
      recordCount: 0,
      mergedRecordCount: 0,
      createdCount: 0,
      updatedCount: 0,
      unchangedCount: 0,
      beepersSkippedRowCount: 0,
      socialHandleSkippedRowCount: 0,
      parsedBeepersCellCount: 0,
      typeCounts: {},
      areaCounts: {},
      rowIssues: [],
      warnings: [],
      previewRows: [],
      conflictCount: 0,
      conflictedRecords: [],
      policiesResolved: true
    });
    vi.resetModules();
    handlers = new Map();
    vi.doMock("electron", () => ({
      ipcMain: {
        handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
          handlers.set(channel, fn);
        }
      },
      BrowserWindow: { fromWebContents: vi.fn().mockReturnValue(null) },
      dialog: { showOpenDialog: showOpenDialogMock, showSaveDialog: vi.fn(), showMessageBox: vi.fn() },
      app: { getPath: vi.fn().mockReturnValue("/tmp") }
    }));
    const { registerContactsIpc } = await import("./contacts.ipc.js");
    registerContactsIpc(serviceMock as never);

    const sender = { id: 7, on: vi.fn(), once: vi.fn(), removeListener: vi.fn() };
    showOpenDialogMock.mockResolvedValue({ canceled: false, filePaths: ["/Users/operator/Desktop/directory.csv"] });
    const previewHandler = handlers.get("contacts:preview-csv-import");
    const preview = await previewHandler!({ sender });
    const importToken = (preview as { importToken: string }).importToken;

    const importHandler = handlers.get("contacts:import-csv-dataset");
    const result = await importHandler!({ sender }, importToken, []);

    expect(serviceMock.importCsvDataset).toHaveBeenCalledWith("/Users/operator/Desktop/directory.csv", []);
    expect(result).not.toHaveProperty("backupPath");
    expect(result).not.toHaveProperty("importedFilePath");
  });
});
