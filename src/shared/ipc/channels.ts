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
  getAuditLog:      "contacts:get-audit-log",
  exportAuditLog:   "contacts:export-audit-log",
  recoverAuditLog:  "contacts:recover-audit-log",
  detectDuplicates: "contacts:detect-duplicates",
  mergeDuplicates:  "contacts:merge-duplicates"
} as const;

export const SETTINGS_CHANNELS = {
  save:       "settings:save",
  defaults:   "settings:defaults",
  browsePath: "settings:browse-path"
} as const;

export const BUSCAS_CHANNELS = {
  list:   "buscas:list",
  add:    "buscas:add",
  update: "buscas:update",
  remove: "buscas:delete"
} as const;

export const PUSH_CHANNELS = {
  autoBackupFailed: "app:auto-backup-failed"
} as const;

/**
 * Server-only channels — used exclusively by ipcMain handlers inside the main
 * process. These are NOT exposed to the renderer via contextBridge and are NOT
 * part of HospitalDirectoryApi. They must NOT appear in REQUIRED_CHANNELS.
 */
export const SERVER_CHANNELS = {
  buscasSearch: "buscas:search"
} as const;
