import Module, { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { HospitalDirectoryApi } from "../shared/ipc/api.js";
import {
  BEEPERS_CHANNELS,
  CONTACTS_CHANNELS,
  PUSH_CHANNELS,
  SETTINGS_CHANNELS
} from "../shared/ipc/channels.js";

type InvokeMethod = Exclude<keyof HospitalDirectoryApi, "onAutoBackupFailure">;

const indexCjsPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../dist-electron/preload/index.cjs"
);

const electron = {
  exposeInMainWorld: vi.fn(),
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn()
};

type ModuleLoader = (request: string, parent: NodeModule | undefined, isMain: boolean) => unknown;
const nodeModule = Module as unknown as { _load: ModuleLoader };
const requireCompiled = createRequire(import.meta.url);

const ROUTES: Record<InvokeMethod, { channel: string; args?: unknown[] }> = {
  getBootstrapData: { channel: CONTACTS_CHANNELS.bootstrap },
  getSettingsDefaults: { channel: SETTINGS_CHANNELS.defaults },
  saveSettings: { channel: SETTINGS_CHANNELS.save, args: [{}] },
  browseForPath: { channel: SETTINGS_CHANNELS.browsePath, args: ["dataFile"] },
  createRecord: { channel: CONTACTS_CHANNELS.createRecord, args: [{}] },
  updateRecord: { channel: CONTACTS_CHANNELS.updateRecord, args: ["id-1", {}] },
  deleteRecord: { channel: CONTACTS_CHANNELS.deleteRecord, args: ["id-1"] },
  createBackup: { channel: CONTACTS_CHANNELS.createBackup },
  listBackups: { channel: CONTACTS_CHANNELS.listBackups },
  restoreBackup: { channel: CONTACTS_CHANNELS.restoreBackup, args: ["backup.json"] },
  exportDataset: { channel: CONTACTS_CHANNELS.exportDataset },
  importDataset: { channel: CONTACTS_CHANNELS.importDataset },
  resetDataset: { channel: CONTACTS_CHANNELS.resetDataset },
  previewCsvImport: { channel: CONTACTS_CHANNELS.previewCsvImport },
  cancelCsvImportPreview: { channel: CONTACTS_CHANNELS.cancelCsvImportPreview },
  importCsvDataset: { channel: CONTACTS_CHANNELS.importCsvDataset, args: ["token", []] },
  pickAndImportDataset: { channel: CONTACTS_CHANNELS.pickAndImportDataset },
  listBeepers: { channel: BEEPERS_CHANNELS.list },
  addBeeper: { channel: BEEPERS_CHANNELS.add, args: [{}] },
  updateBeeper: { channel: BEEPERS_CHANNELS.update, args: ["beeper-1", {}] },
  deleteBeeper: { channel: BEEPERS_CHANNELS.remove, args: ["beeper-1"] },
  listImportedBeepers: { channel: BEEPERS_CHANNELS.listImported },
  updateImportedBeeper: { channel: BEEPERS_CHANNELS.updateImported, args: ["imported-1", {}] },
  detectDuplicates: { channel: CONTACTS_CHANNELS.detectDuplicates },
  mergeContacts: { channel: CONTACTS_CHANNELS.mergeDuplicates, args: [{ keepId: "a", discardId: "b" }] }
};

describe("compiled preload API", () => {
  let api: HospitalDirectoryApi;

  beforeAll(async () => {
    const originalLoad = nodeModule._load;
    nodeModule._load = (request, parent, isMain) => request === "electron"
      ? {
          contextBridge: { exposeInMainWorld: electron.exposeInMainWorld },
          ipcRenderer: {
            invoke: electron.invoke,
            on: electron.on,
            removeListener: electron.removeListener
          }
        }
      : originalLoad(request, parent, isMain);
    try {
      delete requireCompiled.cache[indexCjsPath];
      requireCompiled(indexCjsPath);
    } catch (cause) {
      throw new Error(
        "No se pudo cargar dist-electron/preload/index.cjs; ejecute pnpm build:electron antes de los tests.",
        { cause }
      );
    } finally {
      nodeModule._load = originalLoad;
    }
    const exposure = electron.exposeInMainWorld.mock.calls[0];
    if (exposure?.[0] !== "hospitalDirectory") {
      throw new Error("El preload compilado no expone hospitalDirectory.");
    }
    api = exposure[1] as HospitalDirectoryApi;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it.each(Object.entries(ROUTES))("routes %s to its public IPC channel", async (method, route) => {
    electron.invoke.mockResolvedValueOnce(undefined);
    const methods = api as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;

    await methods[method]!(...(route.args ?? []));

    expect(electron.invoke).toHaveBeenCalledWith(route.channel, ...(route.args ?? []));
  });

  it.each(Object.keys(ROUTES))("propagates %s IPC failures", async (method) => {
    const failure = new Error("IPC failure");
    electron.invoke.mockRejectedValueOnce(failure);
    const methods = api as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;

    await expect(methods[method]!(...(ROUTES[method as InvokeMethod].args ?? []))).rejects.toBe(failure);
  });

  it("defaults importCsvDataset policies to an empty list", async () => {
    electron.invoke.mockResolvedValueOnce(undefined);

    await api.importCsvDataset("token");

    expect(electron.invoke).toHaveBeenCalledWith(CONTACTS_CHANNELS.importCsvDataset, "token", []);
  });

  it("forwards auto-backup failures and removes the same wrapped listener", () => {
    const listener = vi.fn();

    const unsubscribe = api.onAutoBackupFailure(listener);
    const wrapped = electron.on.mock.calls[0]?.[1] as ((event: unknown, payload: unknown) => void);
    wrapped({}, { message: "Backup failed" });
    unsubscribe();

    expect(electron.on).toHaveBeenCalledWith(PUSH_CHANNELS.autoBackupFailed, wrapped);
    expect(listener).toHaveBeenCalledWith({ message: "Backup failed" });
    expect(electron.removeListener).toHaveBeenCalledWith(PUSH_CHANNELS.autoBackupFailed, wrapped);
  });
});
