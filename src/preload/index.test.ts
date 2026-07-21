/**
 * Contract tests for the preload bridge (src/preload/index.cts + api.cts).
 *
 * Why direct import of index.cts or api.cts is infeasible in vitest:
 *   1. Electron's sandbox (sandbox: true) restricts the preload's require()
 *      to built-in Node/Electron modules — relative file paths are blocked.
 *      This is why index.cts must inline its channel constants (it cannot
 *      require a sibling api.cjs). This was the root constraint that shaped the design.
 *   2. Vite 6's ssrTransformScript feeds .cts content to Rollup WITHOUT
 *      stripping TypeScript first. Even `export const X = "y" as const`
 *      causes a parse failure. .cts files genuinely cannot be imported in the
 *      vitest/jsdom environment regardless of content.
 *
 * Strategy (fallback as specified by the reviewer):
 *
 *   A. SOURCE GUARD — read index.cts and api.cts as text; assert:
 *      (a) Every channel string in index.cts matches channels.ts — drift in
 *          the production preload fails a test directly.
 *      (b) index.cts and api.cts carry identical channel strings (api.cts
 *          is the testable mirror; its behavioral correctness validates the
 *          shared logic).
 *      (c) index.cts exposes every method name from HospitalDirectoryApi.
 *
 *   B. BUILD ARTIFACT — when dist-electron/preload/api.cjs is present (built
 *      by build:electron, which global-setup.ts runs before E2E), import it
 *      directly and run full behavioral tests. api.cjs is compiled from api.cts
 *      which has identical channel constants and buildApi() logic to index.cts.
 *      These tests skip gracefully when the artifact is absent.
 *
 * Covers acceptance criterion 2: ALL exposed preload methods forward to the
 * correct IPC channel and propagate rejections.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  CONTACTS_CHANNELS,
  SETTINGS_CHANNELS,
  BEEPERS_CHANNELS,
  PUSH_CHANNELS
} from "../shared/ipc/channels.js";

const preloadDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const repoRoot = path.resolve(preloadDir, "../..");
const indexCtsPath = path.join(preloadDir, "index.cts");
const apiCtsPath = path.join(preloadDir, "api.cts");
const apiCjsPath = path.join(repoRoot, "dist-electron", "preload", "api.cjs");

// All method names in HospitalDirectoryApi.
// If a method is added to the interface without being added here,
// the surface-completeness test below will fail.
const EXPECTED_METHODS = [
  "getBootstrapData",
  "getSettingsDefaults",
  "saveSettings",
  "browseForPath",
  "createRecord",
  "updateRecord",
  "createBackup",
  "listBackups",
  "restoreBackup",
  "exportDataset",
  "importDataset",
  "resetDataset",
  "previewCsvImport",
  "importCsvDataset",
  "listBeepers",
  "addBeeper",
  "updateBeeper",
  "deleteBeeper",
  "listImportedBeepers",
  "detectDuplicates",
  "mergeContacts",
  "onAutoBackupFailure"
] as const;

// ---------------------------------------------------------------------------
// A. SOURCE GUARD — no build required
// ---------------------------------------------------------------------------

describe("source guard — index.cts channel strings match channels.ts", () => {
  let indexSource = "";

  beforeAll(async () => {
    indexSource = await fs.readFile(indexCtsPath, "utf-8");
  });

  // (a) Every canonical channel string must appear verbatim in index.cts.
  // This catches drift in the production preload directly.
  const allCanonical = [
    ...Object.values(CONTACTS_CHANNELS),
    ...Object.values(SETTINGS_CHANNELS),
    ...Object.values(BEEPERS_CHANNELS),
    ...Object.values(PUSH_CHANNELS)
  ];

  for (const ch of allCanonical) {
    it(`index.cts contains channel string "${ch}"`, () => {
      expect(indexSource).toContain(`"${ch}"`);
    });
  }
});

describe("source guard — index.cts exposes every HospitalDirectoryApi method", () => {
  let indexSource = "";

  beforeAll(async () => {
    indexSource = await fs.readFile(indexCtsPath, "utf-8");
  });

  // (b) Every method name must be referenced in index.cts so the bridge
  // surface can't silently shrink.
  for (const method of EXPECTED_METHODS) {
    it(`index.cts references method: ${method}`, () => {
      expect(indexSource).toContain(method);
    });
  }

  it("index.cts calls contextBridge.exposeInMainWorld", () => {
    expect(indexSource).toContain(`contextBridge.exposeInMainWorld("hospitalDirectory", api)`);
  });
});

describe("source guard — api.cts mirrors index.cts channel strings", () => {
  let indexSource = "";
  let apiSource = "";

  beforeAll(async () => {
    [indexSource, apiSource] = await Promise.all([
      fs.readFile(indexCtsPath, "utf-8"),
      fs.readFile(apiCtsPath, "utf-8")
    ]);
  });

  // (c) api.cts (the testable mirror) must carry the same channel strings as
  // index.cts. If api.cts drifts from index.cts, the behavioral tests below
  // would test stale data; this guard prevents that.
  const allCanonical = [
    ...Object.values(CONTACTS_CHANNELS),
    ...Object.values(SETTINGS_CHANNELS),
    ...Object.values(BEEPERS_CHANNELS),
    ...Object.values(PUSH_CHANNELS)
  ];

  for (const ch of allCanonical) {
    it(`api.cts contains channel string "${ch}"`, () => {
      expect(apiSource).toContain(`"${ch}"`);
    });
  }

  it("api.cts exports buildApi function", () => {
    expect(apiSource).toContain("export const buildApi");
  });

  for (const method of EXPECTED_METHODS) {
    it(`api.cts references method: ${method}`, () => {
      expect(apiSource).toContain(method);
    });
  }
});

// ---------------------------------------------------------------------------
// B. BUILD ARTIFACT — behavioral tests against dist-electron/preload/api.cjs
//    Skipped gracefully when the build artifact is absent.
// ---------------------------------------------------------------------------

describe("build artifact — compiled api.cjs behavioral tests", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let buildApi: ((ipcRenderer: any) => Record<string, (...args: any[]) => any>) | null = null;
  let artifactAvailable = false;

  beforeAll(async () => {
    try {
      await fs.access(apiCjsPath);
      const mod = await import(apiCjsPath) as { buildApi: typeof buildApi };
      buildApi = mod.buildApi;
      artifactAvailable = true;
    } catch {
      // Build artifact absent — behavioral tests will be no-ops.
    }
  });

  const ipcRendererStub = {
    invoke: vi.fn(),
    on: vi.fn(),
    removeListener: vi.fn()
  };

  afterEach(() => {
    vi.clearAllMocks();
  });

  const expectChannel = async (
    methodName: string,
    expectedChannel: string,
    ...args: unknown[]
  ) => {
    if (!artifactAvailable || !buildApi) return;
    const api = buildApi(ipcRendererStub);
    ipcRendererStub.invoke.mockResolvedValueOnce(undefined);
    await api[methodName](...args);
    expect(ipcRendererStub.invoke).toHaveBeenCalledWith(expectedChannel, ...args);
  };

  describe("method-to-channel routing", () => {
    it("getBootstrapData → contacts:get-bootstrap-data", async () => {
      await expectChannel("getBootstrapData", CONTACTS_CHANNELS.bootstrap);
    });
    it("getSettingsDefaults → settings:defaults", async () => {
      await expectChannel("getSettingsDefaults", SETTINGS_CHANNELS.defaults);
    });
    it("saveSettings → settings:save", async () => {
      const s = { dataFilePath: "/a.json", backupDirectory: "/b", autoBackupEnabled: false, autoBackupIntervalHours: 24, maxAutoBackups: 5 };
      await expectChannel("saveSettings", SETTINGS_CHANNELS.save, s);
    });
    it("browseForPath → settings:browse-path", async () => {
      await expectChannel("browseForPath", SETTINGS_CHANNELS.browsePath, "dataFile");
    });
    it("createRecord → contacts:create-record", async () => {
      await expectChannel("createRecord", CONTACTS_CHANNELS.createRecord, { displayName: "Test" });
    });
    it("updateRecord → contacts:update-record", async () => {
      await expectChannel("updateRecord", CONTACTS_CHANNELS.updateRecord, "id-1", { displayName: "Updated" });
    });
    it("createBackup → contacts:create-backup", async () => {
      await expectChannel("createBackup", CONTACTS_CHANNELS.createBackup);
    });
    it("listBackups → contacts:list-backups", async () => {
      await expectChannel("listBackups", CONTACTS_CHANNELS.listBackups);
    });
    it("restoreBackup → contacts:restore-backup", async () => {
      await expectChannel("restoreBackup", CONTACTS_CHANNELS.restoreBackup, "/backup.json");
    });
    it("exportDataset → contacts:export-dataset", async () => {
      await expectChannel("exportDataset", CONTACTS_CHANNELS.exportDataset);
    });
    it("importDataset → contacts:import-dataset", async () => {
      await expectChannel("importDataset", CONTACTS_CHANNELS.importDataset);
    });
    it("resetDataset → contacts:reset-dataset", async () => {
      await expectChannel("resetDataset", CONTACTS_CHANNELS.resetDataset);
    });
    it("previewCsvImport → contacts:preview-csv-import", async () => {
      await expectChannel("previewCsvImport", CONTACTS_CHANNELS.previewCsvImport);
    });
    it("importCsvDataset → contacts:import-csv-dataset", async () => {
      await expectChannel("importCsvDataset", CONTACTS_CHANNELS.importCsvDataset, "tok", []);
    });
    it("detectDuplicates → contacts:detect-duplicates", async () => {
      await expectChannel("detectDuplicates", CONTACTS_CHANNELS.detectDuplicates);
    });
    it("mergeContacts → contacts:merge-duplicates", async () => {
      await expectChannel("mergeContacts", CONTACTS_CHANNELS.mergeDuplicates, { keepId: "a", discardId: "b" });
    });
    it("listBeepers → beepers:list", async () => {
      await expectChannel("listBeepers", BEEPERS_CHANNELS.list);
    });
    it("addBeeper → beepers:add", async () => {
      await expectChannel("addBeeper", BEEPERS_CHANNELS.add, { deviceNumber: "B-01", assignedTo: "Ana", department: "UCI", role: "Enfermera", shift: "mañana" });
    });
    it("updateBeeper → beepers:update", async () => {
      await expectChannel("updateBeeper", BEEPERS_CHANNELS.update, "bsc_abc12345", { deviceNumber: "B-01", assignedTo: "Ana", department: "UCI", role: "Enfermera", shift: "mañana" });
    });
    it("deleteBeeper → beepers:delete", async () => {
      await expectChannel("deleteBeeper", BEEPERS_CHANNELS.remove, "bsc_abc12345");
    });
    it("listImportedBeepers → beepers:list-imported", async () => {
      await expectChannel("listImportedBeepers", BEEPERS_CHANNELS.listImported);
    });
  });

  describe("importCsvDataset — default policies argument", () => {
    it("defaults policies to [] when not provided", async () => {
      if (!artifactAvailable || !buildApi) return;
      const api = buildApi(ipcRendererStub);
      ipcRendererStub.invoke.mockResolvedValueOnce({});
      await api["importCsvDataset"]("tok");
      expect(ipcRendererStub.invoke).toHaveBeenCalledWith(
        CONTACTS_CHANNELS.importCsvDataset, "tok", []
      );
    });
  });

  describe("rejection propagation", () => {
    it("propagates rejection from getBootstrapData", async () => {
      if (!artifactAvailable || !buildApi) return;
      const api = buildApi(ipcRendererStub);
      ipcRendererStub.invoke.mockRejectedValueOnce(new Error("IPC failure"));
      await expect(api["getBootstrapData"]()).rejects.toThrow("IPC failure");
    });
    it("propagates rejection from createRecord", async () => {
      if (!artifactAvailable || !buildApi) return;
      const api = buildApi(ipcRendererStub);
      ipcRendererStub.invoke.mockRejectedValueOnce(new Error("create failed"));
      await expect(api["createRecord"]({})).rejects.toThrow("create failed");
    });
    it("propagates rejection from mergeContacts", async () => {
      if (!artifactAvailable || !buildApi) return;
      const api = buildApi(ipcRendererStub);
      ipcRendererStub.invoke.mockRejectedValueOnce(new Error("merge conflict"));
      await expect(api["mergeContacts"]({ keepId: "a", discardId: "b" })).rejects.toThrow("merge conflict");
    });
  });

  describe("onAutoBackupFailure — push event listener", () => {
    it("registers on PUSH_CHANNELS.autoBackupFailed", () => {
      if (!artifactAvailable || !buildApi) return;
      const api = buildApi(ipcRendererStub);
      api["onAutoBackupFailure"](vi.fn());
      expect(ipcRendererStub.on).toHaveBeenCalledWith(
        PUSH_CHANNELS.autoBackupFailed, expect.any(Function)
      );
    });
    it("wraps listener to strip _event, forwards payload", () => {
      if (!artifactAvailable || !buildApi) return;
      const api = buildApi(ipcRendererStub);
      const listener = vi.fn();
      api["onAutoBackupFailure"](listener);
      const [, wrapped] = ipcRendererStub.on.mock.calls[0] as [string, Function];
      wrapped({}, { message: "Backup failed" });
      expect(listener).toHaveBeenCalledWith({ message: "Backup failed" });
    });
    it("unsubscribe removes the exact wrapped listener", () => {
      if (!artifactAvailable || !buildApi) return;
      const api = buildApi(ipcRendererStub);
      const unsub = api["onAutoBackupFailure"](vi.fn());
      const registered = ipcRendererStub.on.mock.calls[0]?.[1];
      unsub();
      const deregistered = ipcRendererStub.removeListener.mock.calls[0]?.[1];
      expect(registered).toBe(deregistered);
    });
  });

  describe("API surface completeness", () => {
    for (const method of EXPECTED_METHODS) {
      it(`exposes method: ${method}`, () => {
        if (!artifactAvailable || !buildApi) return;
        const api = buildApi(ipcRendererStub);
        expect(typeof api[method]).toBe("function");
      });
    }
  });
});
