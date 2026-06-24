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
  BUSCAS_CHANNELS   as _CanonicalBuscas,
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
  getAuditLog:      "contacts:get-audit-log",
  exportAuditLog:   "contacts:export-audit-log",
  recoverAuditLog:  "contacts:recover-audit-log",
  detectDuplicates: "contacts:detect-duplicates",
  mergeDuplicates:  "contacts:merge-duplicates"
} as const satisfies _CanonicalContacts;

export const SETTINGS_CHANNELS = {
  save:       "settings:save",
  defaults:   "settings:defaults",
  browsePath: "settings:browse-path"
} as const satisfies _CanonicalSettings;

export const BUSCAS_CHANNELS = {
  list:         "buscas:list",
  add:          "buscas:add",
  update:       "buscas:update",
  remove:       "buscas:delete",
  listImported: "buscas:list-imported"
} as const satisfies _CanonicalBuscas;

export const PUSH_CHANNELS = {
  autoBackupFailed: "app:auto-backup-failed"
} as const satisfies _CanonicalPush;

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
    browseForPath: (type) =>
      ipcRenderer.invoke(SETTINGS_CHANNELS.browsePath, type) as ReturnType<HospitalDirectoryApi["browseForPath"]>,
    getAuditLog: (params) =>
      ipcRenderer.invoke(CONTACTS_CHANNELS.getAuditLog, params) as ReturnType<HospitalDirectoryApi["getAuditLog"]>,
    exportAuditLog: (params) =>
      ipcRenderer.invoke(CONTACTS_CHANNELS.exportAuditLog, params) as ReturnType<HospitalDirectoryApi["exportAuditLog"]>,
    recoverAuditLog: () =>
      ipcRenderer.invoke(CONTACTS_CHANNELS.recoverAuditLog) as ReturnType<HospitalDirectoryApi["recoverAuditLog"]>,
    listBuscas: () => ipcRenderer.invoke(BUSCAS_CHANNELS.list) as ReturnType<HospitalDirectoryApi["listBuscas"]>,
    addBusca: (record) =>
      ipcRenderer.invoke(BUSCAS_CHANNELS.add, record) as ReturnType<HospitalDirectoryApi["addBusca"]>,
    updateBusca: (id, record) =>
      ipcRenderer.invoke(BUSCAS_CHANNELS.update, id, record) as ReturnType<HospitalDirectoryApi["updateBusca"]>,
    deleteBusca: (id) => ipcRenderer.invoke(BUSCAS_CHANNELS.remove, id) as ReturnType<HospitalDirectoryApi["deleteBusca"]>,
    listImportedBuscas: () => ipcRenderer.invoke(BUSCAS_CHANNELS.listImported) as ReturnType<HospitalDirectoryApi["listImportedBuscas"]>,
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
