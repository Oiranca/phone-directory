/**
 * IPC channel name constants — private to the main process and preload script.
 *
 * These strings are the wire-protocol identifiers used by ipcMain.handle() and
 * ipcRenderer.invoke(). They must NOT be imported by renderer-side code.
 * The renderer only sees the typed API surface defined in HospitalDirectoryApi.
 *
 * Centralising them here (shared between main and preload) means a channel rename
 * only needs to change in one place and both sides will fail tsc if the rename
 * is incomplete.
 *
 * Layout mirrors HospitalDirectoryApi method names so drift is obvious at a glance.
 */

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
  // Single unified "Importar" entry point. Opens ONE native dialog
  // (json/csv/ods/xls/xlsx filter) and dispatches internally by extension to
  // the existing importDataset()/previewCsvImport() pipelines. The old two
  // channels above are kept — this is additive, not a replacement.
  pickAndImportDataset: "contacts:pick-and-import-dataset",
  detectDuplicates: "contacts:detect-duplicates",
  mergeDuplicates:  "contacts:merge-duplicates"
} as const;

export const SETTINGS_CHANNELS = {
  save:       "settings:save",
  defaults:   "settings:defaults",
  browsePath: "settings:browse-path"
} as const;

export const BEEPERS_CHANNELS = {
  list:          "beepers:list",
  add:           "beepers:add",
  update:        "beepers:update",
  remove:        "beepers:delete",
  listImported:  "beepers:list-imported"
} as const;

export const PUSH_CHANNELS = {
  autoBackupFailed: "app:auto-backup-failed"
} as const;
