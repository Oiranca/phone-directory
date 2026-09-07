import path from "node:path";
import { fileURLToPath } from "node:url";
import type { IpcRenderer } from "electron";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { HospitalDirectoryApi } from "../shared/ipc/api.js";
import {
  BEEPERS_CHANNELS,
  CONTACTS_CHANNELS,
  PUSH_CHANNELS,
  SETTINGS_CHANNELS
} from "../shared/ipc/channels.js";

type BuildApi = (ipcRenderer: IpcRenderer) => HospitalDirectoryApi;
type InvokeMethod = Exclude<keyof HospitalDirectoryApi, "onAutoBackupFailure">;

const apiCjsPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../dist-electron/preload/api.cjs"
);

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
  let buildApi: BuildApi;
  const ipcRenderer = {
    invoke: vi.fn(),
    on: vi.fn(),
    removeListener: vi.fn()
  };

  beforeAll(async () => {
    const compiled = await import(apiCjsPath).catch(() => {
      throw new Error("Falta dist-electron/preload/api.cjs; ejecute pnpm build:electron antes de los tests.");
    }) as { buildApi?: BuildApi };
    if (typeof compiled.buildApi !== "function") {
      throw new Error("El preload compilado no exporta buildApi.");
    }
    buildApi = compiled.buildApi;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it.each(Object.entries(ROUTES))("routes %s to its public IPC channel", async (method, route) => {
    ipcRenderer.invoke.mockResolvedValueOnce(undefined);
    const api = buildApi(ipcRenderer as unknown as IpcRenderer) as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;

    await api[method]!(...(route.args ?? []));

    expect(ipcRenderer.invoke).toHaveBeenCalledWith(route.channel, ...(route.args ?? []));
  });

  it.each(Object.keys(ROUTES))("propagates %s IPC failures", async (method) => {
    const failure = new Error("IPC failure");
    ipcRenderer.invoke.mockRejectedValueOnce(failure);
    const api = buildApi(ipcRenderer as unknown as IpcRenderer) as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;

    await expect(api[method]!(...(ROUTES[method as InvokeMethod].args ?? []))).rejects.toBe(failure);
  });

  it("defaults importCsvDataset policies to an empty list", async () => {
    ipcRenderer.invoke.mockResolvedValueOnce(undefined);
    const api = buildApi(ipcRenderer as unknown as IpcRenderer);

    await api.importCsvDataset("token");

    expect(ipcRenderer.invoke).toHaveBeenCalledWith(CONTACTS_CHANNELS.importCsvDataset, "token", []);
  });

  it("forwards auto-backup failures and removes the same wrapped listener", () => {
    const api = buildApi(ipcRenderer as unknown as IpcRenderer);
    const listener = vi.fn();

    const unsubscribe = api.onAutoBackupFailure(listener);
    const wrapped = ipcRenderer.on.mock.calls[0]?.[1] as ((event: unknown, payload: unknown) => void);
    wrapped({}, { message: "Backup failed" });
    unsubscribe();

    expect(ipcRenderer.on).toHaveBeenCalledWith(PUSH_CHANNELS.autoBackupFailed, wrapped);
    expect(listener).toHaveBeenCalledWith({ message: "Backup failed" });
    expect(ipcRenderer.removeListener).toHaveBeenCalledWith(PUSH_CHANNELS.autoBackupFailed, wrapped);
  });
});
