import { contextBridge, ipcRenderer } from "electron";
import type { HospitalDirectoryApi } from "../shared/ipc/api.js";

// Channel constants are inlined here — they cannot be required from a
// separate module because Electron's sandboxed preload (sandbox: true) only
// allows requiring built-in Node/Electron modules, not relative file paths.
// This is the same constraint that prevented importing channels.ts (ESM) in
// OIR-103. The sister module src/preload/api.cts holds the same constants and
// buildApi() factory for unit testing; the source-guard tests in
// src/preload/index.test.ts verify that this file and api.cts stay in sync.
// Any rename here must also be reflected in src/shared/ipc/channels.ts and
// in src/preload/api.cts — tsc (tsconfig.electron.json) catches drift via the
// HospitalDirectoryApi type assertion on `api` below.
const CONTACTS_CHANNELS = {
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
  mergeDuplicates:  "contacts:merge-duplicates"
} as const;

const SETTINGS_CHANNELS = {
  save:       "settings:save",
  defaults:   "settings:defaults",
  browsePath: "settings:browse-path"
} as const;

const BUSCAS_CHANNELS = {
  list:         "buscas:list",
  add:          "buscas:add",
  update:       "buscas:update",
  remove:       "buscas:delete",
  listImported: "buscas:list-imported"
} as const;

const PUSH_CHANNELS = {
  autoBackupFailed: "app:auto-backup-failed"
} as const;

// Type assertion: `api` must satisfy HospitalDirectoryApi exactly.
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

contextBridge.exposeInMainWorld("hospitalDirectory", api);
