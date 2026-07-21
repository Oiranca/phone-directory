/**
 * Builds the HospitalDirectoryApi implementation object.
 *
 * This is the single source of truth for the preload bridge implementation.
 * src/preload/index.cts imports this factory and passes the result to
 * contextBridge.exposeInMainWorld.
 *
 * Compiled to CommonJS (api.cjs) by tsconfig.electron.json (module: NodeNext,
 * .cts extension forces CJS output). index.cts requires api.cjs at runtime —
 * CJS→CJS works with no ESM/CJS boundary issue.
 *
 * Channel constants are inlined here (not imported from channels.ts) for the
 * same reason as the original index.cts: src/shared/ipc/channels.ts is ESM
 * (package.json "type":"module") and a sandboxed CJS preload cannot require()
 * ESM files at runtime. Type-only imports (erased before .cjs emit) are used
 * for compile-time parity assertions via `satisfies` — see each map below.
 */
import type { IpcRenderer } from "electron";
import type { HospitalDirectoryApi } from "../shared/ipc/api.js";
import type {
  CONTACTS_CHANNELS as _CanonicalContacts,
  SETTINGS_CHANNELS as _CanonicalSettings,
  BEEPERS_CHANNELS as _CanonicalBeepers,
  PUSH_CHANNELS     as _CanonicalPush
} from "../shared/ipc/channels.js";

export const CONTACTS_CHANNELS = {
  bootstrap:        "contacts:get-bootstrap-data",
  createBackup:     "contacts:create-backup",
  resetDataset:     "contacts:reset-dataset",
  createRecord:     "contacts:create-record",
  updateRecord:     "contacts:update-record",
  listBackups:      "contacts:list-backups",
  restoreBackup:    "contacts:restore-backup",
  exportDataset:    "contacts:export-dataset",
  importDataset:    "contacts:import-dataset",
  previewCsvImport: "contacts:preview-csv-import",
  importCsvDataset: "contacts:import-csv-dataset",
  detectDuplicates: "contacts:detect-duplicates",
  mergeDuplicates:  "contacts:merge-duplicates",
  pickAndImportDataset: "contacts:pick-and-import-dataset"
} as const satisfies typeof _CanonicalContacts;

export const SETTINGS_CHANNELS = {
  save:       "settings:save",
  defaults:   "settings:defaults",
  browsePath: "settings:browse-path"
} as const satisfies typeof _CanonicalSettings;

export const BEEPERS_CHANNELS = {
  list:         "beepers:list",
  add:          "beepers:add",
  update:       "beepers:update",
  remove:       "beepers:delete",
  listImported: "beepers:list-imported"
} as const satisfies typeof _CanonicalBeepers;

export const PUSH_CHANNELS = {
  autoBackupFailed: "app:auto-backup-failed"
} as const satisfies typeof _CanonicalPush;

export const buildApi = (ipcRenderer: IpcRenderer): HospitalDirectoryApi => {
  // Type assertion: api must satisfy HospitalDirectoryApi exactly.
  // If a method is missing, renamed, or has the wrong signature, tsc
  // (tsconfig.electron.json) will error here before the code ever runs.
  const api: HospitalDirectoryApi = {
    getBootstrapData: () => ipcRenderer.invoke(CONTACTS_CHANNELS.bootstrap) as ReturnType<HospitalDirectoryApi["getBootstrapData"]>,
    getSettingsDefaults: () => ipcRenderer.invoke(SETTINGS_CHANNELS.defaults) as ReturnType<HospitalDirectoryApi["getSettingsDefaults"]>,
    saveSettings: (settings) =>
      ipcRenderer.invoke(SETTINGS_CHANNELS.save, settings) as ReturnType<HospitalDirectoryApi["saveSettings"]>,
    createBackup: () => ipcRenderer.invoke(CONTACTS_CHANNELS.createBackup) as ReturnType<HospitalDirectoryApi["createBackup"]>,
    createRecord: (record) =>
      ipcRenderer.invoke(CONTACTS_CHANNELS.createRecord, record) as ReturnType<HospitalDirectoryApi["createRecord"]>,
    updateRecord: (recordId, record) =>
      ipcRenderer.invoke(CONTACTS_CHANNELS.updateRecord, recordId, record) as ReturnType<HospitalDirectoryApi["updateRecord"]>,
    listBackups: () => ipcRenderer.invoke(CONTACTS_CHANNELS.listBackups) as ReturnType<HospitalDirectoryApi["listBackups"]>,
    restoreBackup: (backupFilePath) =>
      ipcRenderer.invoke(CONTACTS_CHANNELS.restoreBackup, backupFilePath) as ReturnType<HospitalDirectoryApi["restoreBackup"]>,
    exportDataset: () => ipcRenderer.invoke(CONTACTS_CHANNELS.exportDataset) as ReturnType<HospitalDirectoryApi["exportDataset"]>,
    importDataset: () => ipcRenderer.invoke(CONTACTS_CHANNELS.importDataset) as ReturnType<HospitalDirectoryApi["importDataset"]>,
    resetDataset: () => ipcRenderer.invoke(CONTACTS_CHANNELS.resetDataset) as ReturnType<HospitalDirectoryApi["resetDataset"]>,
    previewCsvImport: () => ipcRenderer.invoke(CONTACTS_CHANNELS.previewCsvImport) as ReturnType<HospitalDirectoryApi["previewCsvImport"]>,
    importCsvDataset: (importToken, policies = []) =>
      ipcRenderer.invoke(CONTACTS_CHANNELS.importCsvDataset, importToken, policies) as ReturnType<HospitalDirectoryApi["importCsvDataset"]>,
    pickAndImportDataset: () =>
      ipcRenderer.invoke(CONTACTS_CHANNELS.pickAndImportDataset) as ReturnType<HospitalDirectoryApi["pickAndImportDataset"]>,
    browseForPath: (type) =>
      ipcRenderer.invoke(SETTINGS_CHANNELS.browsePath, type) as ReturnType<HospitalDirectoryApi["browseForPath"]>,
    listBeepers: () => ipcRenderer.invoke(BEEPERS_CHANNELS.list) as ReturnType<HospitalDirectoryApi["listBeepers"]>,
    addBeeper: (record) =>
      ipcRenderer.invoke(BEEPERS_CHANNELS.add, record) as ReturnType<HospitalDirectoryApi["addBeeper"]>,
    updateBeeper: (id, record) =>
      ipcRenderer.invoke(BEEPERS_CHANNELS.update, id, record) as ReturnType<HospitalDirectoryApi["updateBeeper"]>,
    deleteBeeper: (id) => ipcRenderer.invoke(BEEPERS_CHANNELS.remove, id) as ReturnType<HospitalDirectoryApi["deleteBeeper"]>,
    listImportedBeepers: () => ipcRenderer.invoke(BEEPERS_CHANNELS.listImported) as ReturnType<HospitalDirectoryApi["listImportedBeepers"]>,
    detectDuplicates: () =>
      ipcRenderer.invoke(CONTACTS_CHANNELS.detectDuplicates) as ReturnType<HospitalDirectoryApi["detectDuplicates"]>,
    mergeContacts: (req) =>
      ipcRenderer.invoke(CONTACTS_CHANNELS.mergeDuplicates, req) as ReturnType<HospitalDirectoryApi["mergeContacts"]>,
    onAutoBackupFailure: (listener) => {
      const wrappedListener = (_event: unknown, payload: Parameters<typeof listener>[0]) => {
        listener(payload);
      };

      ipcRenderer.on(PUSH_CHANNELS.autoBackupFailed, wrappedListener);

      return () => {
        ipcRenderer.removeListener(PUSH_CHANNELS.autoBackupFailed, wrappedListener);
      };
    }
  };

  return api;
};
