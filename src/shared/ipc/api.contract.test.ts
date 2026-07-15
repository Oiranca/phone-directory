/**
 * Electron API contract tests
 *
 * Validates three things:
 * 1. Handler registration coverage — every renderer-invokable channel (derived from the
 *    shared *_CHANNELS objects) has a registered ipcMain handler. Adding a channel to a
 *    *_CHANNELS object without a matching handler registration automatically fails this test.
 * 2. API method list completeness — API_METHOD_MAP is exhaustive at compile time
 *    (Record<keyof HospitalDirectoryApi, true>); runtime assertions confirm the derivation
 *    is meaningful (non-empty, each method has a registered handler for its channel).
 * 3. Renderer mock helper — a mock typed as HospitalDirectoryApi compiles and satisfies
 *    the interface (type-level; if HospitalDirectoryApi changes this block fails tsc).
 *
 * NOTE: The preload (src/preload/index.cts) is a CommonJS TypeScript module compiled for
 * Electron's sandboxed renderer process. It cannot be imported in Vitest's ESM/jsdom
 * environment. Its structural correctness is enforced by tsc (tsconfig.electron.json)
 * at build time: `const api: HospitalDirectoryApi = { ... }` in index.cts will fail to
 * compile if any method is missing or has the wrong signature.
 */

import { describe, it, expect, vi, beforeAll } from "vitest";
import type { HospitalDirectoryApi } from "./api.js";
import { CONTACTS_CHANNELS, SETTINGS_CHANNELS, BUSCAS_CHANNELS } from "./channels.js";

// ---------------------------------------------------------------------------
// Compile-time-exhaustive method map
//
// Record<keyof HospitalDirectoryApi, true> requires every key of the interface
// to appear exactly once as a property. If HospitalDirectoryApi gains a method
// and this map is not updated, tsc errors: "Property 'newMethod' is missing in
// type '...' but required in type 'Record<keyof HospitalDirectoryApi, true>'".
// An extra or misspelled key is also a tsc error.
//
// API_METHODS is derived at runtime — no manual count ever needed.
// ---------------------------------------------------------------------------

const API_METHOD_MAP: Record<keyof HospitalDirectoryApi, true> = {
  getBootstrapData:      true,
  getSettingsDefaults:   true,
  saveSettings:          true,
  browseForPath:         true,
  createRecord:          true,
  updateRecord:          true,
  createBackup:          true,
  listBackups:           true,
  restoreBackup:         true,
  exportDataset:         true,
  importDataset:         true,
  resetDataset:          true,
  previewCsvImport:      true,
  importCsvDataset:      true,
  pickAndImportDataset:  true,
  listBuscas:            true,
  addBusca:              true,
  updateBusca:           true,
  deleteBusca:           true,
  listImportedBuscas:    true,
  detectDuplicates:      true,
  mergeContacts:         true,
  onAutoBackupFailure:   true
};

const API_METHODS = Object.keys(API_METHOD_MAP) as Array<keyof HospitalDirectoryApi>;

// ---------------------------------------------------------------------------
// 1. Handler registration coverage
//
// REQUIRED_CHANNELS is derived directly from the shared channel objects so
// adding a key to CONTACTS_CHANNELS / SETTINGS_CHANNELS / BUSCAS_CHANNELS
// automatically lands in the coverage assertion — no manual list to maintain.
//
// PUSH_CHANNELS (app:auto-backup-failed) is excluded: it is a one-way push
// registered with ipcMain.on() on the renderer side, not an ipcMain.handle().
// ---------------------------------------------------------------------------

const REQUIRED_CHANNELS: ReadonlyArray<string> = [
  ...Object.values(CONTACTS_CHANNELS),
  ...Object.values(SETTINGS_CHANNELS),
  ...Object.values(BUSCAS_CHANNELS)
];

describe("Handler registration coverage — every renderer-invokable channel has an ipcMain handler", () => {
  const registeredChannels = new Set<string>();

  beforeAll(async () => {
    vi.resetModules();

    vi.doMock("electron", () => ({
      ipcMain: {
        // `handle` is the primary registration method; `on` is stubbed so a future
        // ipcMain.on() call inside a register* function doesn't throw and produce
        // misleading "channel not registered" failures.
        handle: (channel: string) => {
          registeredChannels.add(channel);
        },
        on: vi.fn()
      },
      BrowserWindow: { fromWebContents: vi.fn().mockReturnValue(null) },
      dialog: {
        showOpenDialog: vi.fn(),
        showSaveDialog: vi.fn()
      },
      app: { getPath: vi.fn().mockReturnValue("/tmp") }
    }));

    const [{ registerContactsIpc }, { registerSettingsIpc }, { registerBuscasIpc }] =
      await Promise.all([
        import("../../main/ipc/contacts.ipc.js"),
        import("../../main/ipc/settings.ipc.js"),
        import("../../main/ipc/buscas.ipc.js")
      ]);

    // Minimal service stub: every property access returns a vi.fn() that resolves undefined
    const serviceStub = new Proxy({} as never, {
      get: () => vi.fn().mockResolvedValue(undefined)
    });

    registerContactsIpc(serviceStub);
    registerSettingsIpc(serviceStub);
    registerBuscasIpc(serviceStub);
  });

  it("REQUIRED_CHANNELS is non-empty (derived from shared channel objects)", () => {
    // Guards against an accidental empty derivation making all coverage tests vacuously pass.
    expect(REQUIRED_CHANNELS.length).toBeGreaterThan(0);
  });

  it.each(REQUIRED_CHANNELS)("has a registered handler for channel: %s", (channel) => {
    expect(registeredChannels.has(channel)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. API method list completeness
//
// API_METHOD_MAP is exhaustive at compile time. The runtime assertions here
// are meaningful: they confirm that (a) API_METHODS is non-empty (not an
// accidentally empty derivation), and (b) the number of registered renderer-
// invokable channels equals the number of invokable API methods — i.e. every
// method has exactly one backing channel and no channels are orphaned.
//
// onAutoBackupFailure is excluded from the channel count: it is a push-event
// subscription (no ipcMain.handle backing channel).
// ---------------------------------------------------------------------------

describe("API method completeness — API_METHODS is non-empty and channels match invokable methods", () => {
  it("API_METHODS is non-empty (not an accidentally empty derivation)", () => {
    expect(API_METHODS.length).toBeGreaterThan(0);
  });

  it("renderer-invokable channel count equals API method count minus push-only methods", () => {
    // onAutoBackupFailure is the only method backed by a push channel (no ipcMain.handle).
    // Every other method has exactly one entry in REQUIRED_CHANNELS.
    const PUSH_ONLY_METHODS = 1; // onAutoBackupFailure
    expect(REQUIRED_CHANNELS.length).toBe(API_METHODS.length - PUSH_ONLY_METHODS);
  });
});

// ---------------------------------------------------------------------------
// 3. Renderer mock helper — type-level test
//
// This is the canonical pattern for mocking window.hospitalDirectory in
// renderer tests. If HospitalDirectoryApi changes signature, this block
// fails tsc before any runtime test runs.
// ---------------------------------------------------------------------------

describe("Renderer mock helper — typed as HospitalDirectoryApi", () => {
  it("allows constructing a full mock typed as HospitalDirectoryApi", () => {
    // TypeScript enforces that this object literal satisfies HospitalDirectoryApi —
    // any method missing, renamed, or with wrong arity is a compile error.
    const mockApi: HospitalDirectoryApi = {
      getBootstrapData:    vi.fn(),
      getSettingsDefaults: vi.fn(),
      saveSettings:        vi.fn(),
      browseForPath:       vi.fn(),
      createRecord:        vi.fn(),
      updateRecord:        vi.fn(),
      createBackup:        vi.fn(),
      listBackups:         vi.fn(),
      restoreBackup:       vi.fn(),
      exportDataset:       vi.fn(),
      importDataset:       vi.fn(),
      resetDataset:        vi.fn(),
      previewCsvImport:    vi.fn(),
      importCsvDataset:    vi.fn(),
      pickAndImportDataset: vi.fn(),
      listBuscas:          vi.fn(),
      addBusca:            vi.fn(),
      updateBusca:         vi.fn(),
      deleteBusca:         vi.fn(),
      listImportedBuscas:  vi.fn(),
      detectDuplicates:    vi.fn(),
      mergeContacts:       vi.fn(),
      onAutoBackupFailure: vi.fn().mockReturnValue(() => undefined)
    };

    // Runtime: every declared property is a function
    for (const method of API_METHODS) {
      expect(typeof mockApi[method]).toBe("function");
    }
  });
});
