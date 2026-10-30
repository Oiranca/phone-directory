import { contextBridge, ipcRenderer } from "electron";
import type { HospitalDirectoryApi } from "../shared/ipc/api.js";
// Type-only imports from shared/ipc/channels.ts — erased completely at compile
// time so no require() is emitted in the CJS output. These are used solely for
// the compile-time parity assertions on the inline maps below.
//
// Why runtime import is not possible:
//   shared/ipc/channels.ts is ESM ("type":"module" in package.json). Electron's
//   sandboxed preload (sandbox: true) can only require() built-in Node/Electron
//   modules — relative file paths are blocked at runtime. A type-import is safe
//   because tsc strips all import type declarations before emitting .cjs output.
import type {
  CONTACTS_CHANNELS as _CanonicalContacts,
  SETTINGS_CHANNELS as _CanonicalSettings,
  BEEPERS_CHANNELS as _CanonicalBeepers,
  PUSH_CHANNELS     as _CanonicalPush
} from "../shared/ipc/channels.js";

// Channel constants are inlined here — they cannot be required from a
// separate module at runtime (see constraint above).
//
// Compile-time parity: each map below uses `satisfies` against the type of
// the corresponding export in shared/ipc/channels.ts. If a key is added,
// removed, or its string value changes in channels.ts, tsc errors here before
// any code runs — making channel renames compile-time safe without requiring
// runtime hand-syncing across duplicated maps.
//
const CONTACTS_CHANNELS = {
  bootstrap:        "contacts:get-bootstrap-data",
  createBackup:     "contacts:create-backup",
  resetDataset:     "contacts:reset-dataset",
  recoverAuditLog:  "contacts:recover-audit-log",
  createRecord:     "contacts:create-record",
  updateRecord:     "contacts:update-record",
  deleteRecord:     "contacts:delete-record",
  listBackups:      "contacts:list-backups",
  restoreBackup:    "contacts:restore-backup",
  exportDataset:    "contacts:export-dataset",
  previewCsvImport: "contacts:preview-csv-import",
  cancelCsvImportPreview: "contacts:cancel-csv-import-preview",
  importCsvDataset: "contacts:import-csv-dataset",
  detectDuplicates: "contacts:detect-duplicates",
  mergeDuplicates:  "contacts:merge-duplicates",
  pickAndImportDataset: "contacts:pick-and-import-dataset",
  confirmJsonImport: "contacts:confirm-json-import",
  cancelJsonImport: "contacts:cancel-json-import"
} as const satisfies typeof _CanonicalContacts;

const SETTINGS_CHANNELS = {
  save:       "settings:save",
  defaults:   "settings:defaults",
  browsePath: "settings:browse-path"
} as const satisfies typeof _CanonicalSettings;

const BEEPERS_CHANNELS = {
  list:         "beepers:list",
  add:          "beepers:add",
  update:       "beepers:update",
  remove:       "beepers:delete",
  listImported: "beepers:list-imported",
  updateImported: "beepers:update-imported",
  listTeams:     "beepers:list-teams",
  listMemberships: "beepers:list-team-memberships",
  addTeam:       "beepers:add-team",
  updateTeam:    "beepers:update-team",
  removeTeam:    "beepers:delete-team",
  setTeamMembers: "beepers:set-team-members"
} as const satisfies typeof _CanonicalBeepers;

const PUSH_CHANNELS = {
  autoBackupFailed: "app:auto-backup-failed"
} as const satisfies typeof _CanonicalPush;

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
    deleteRecord: (recordId) =>
      ipcRenderer.invoke(CONTACTS_CHANNELS.deleteRecord, recordId) as ReturnType<HospitalDirectoryApi["deleteRecord"]>,
    listBackups: () => ipcRenderer.invoke(CONTACTS_CHANNELS.listBackups) as ReturnType<HospitalDirectoryApi["listBackups"]>,
  restoreBackup: (backupFileName) =>
    ipcRenderer.invoke(CONTACTS_CHANNELS.restoreBackup, backupFileName) as ReturnType<HospitalDirectoryApi["restoreBackup"]>,
  exportDataset: () => ipcRenderer.invoke(CONTACTS_CHANNELS.exportDataset) as ReturnType<HospitalDirectoryApi["exportDataset"]>,
  resetDataset: () => ipcRenderer.invoke(CONTACTS_CHANNELS.resetDataset) as ReturnType<HospitalDirectoryApi["resetDataset"]>,
  recoverAuditLog: () => ipcRenderer.invoke(CONTACTS_CHANNELS.recoverAuditLog) as ReturnType<HospitalDirectoryApi["recoverAuditLog"]>,
  previewCsvImport: () => ipcRenderer.invoke(CONTACTS_CHANNELS.previewCsvImport) as ReturnType<HospitalDirectoryApi["previewCsvImport"]>,
  cancelCsvImportPreview: (importToken) => (
    importToken === undefined
      ? ipcRenderer.invoke(CONTACTS_CHANNELS.cancelCsvImportPreview)
      : ipcRenderer.invoke(CONTACTS_CHANNELS.cancelCsvImportPreview, importToken)
  ) as ReturnType<HospitalDirectoryApi["cancelCsvImportPreview"]>,
  importCsvDataset: (importToken, policies = []) =>
    ipcRenderer.invoke(CONTACTS_CHANNELS.importCsvDataset, importToken, policies) as ReturnType<HospitalDirectoryApi["importCsvDataset"]>,
  pickAndImportDataset: () =>
    ipcRenderer.invoke(CONTACTS_CHANNELS.pickAndImportDataset) as ReturnType<HospitalDirectoryApi["pickAndImportDataset"]>,
  confirmJsonImport: (importToken) =>
    ipcRenderer.invoke(CONTACTS_CHANNELS.confirmJsonImport, importToken) as ReturnType<HospitalDirectoryApi["confirmJsonImport"]>,
  cancelJsonImport: (importToken) =>
    ipcRenderer.invoke(CONTACTS_CHANNELS.cancelJsonImport, importToken) as ReturnType<HospitalDirectoryApi["cancelJsonImport"]>,
  browseForPath: (type) =>
    ipcRenderer.invoke(SETTINGS_CHANNELS.browsePath, type) as ReturnType<HospitalDirectoryApi["browseForPath"]>,
  listBeepers: () => ipcRenderer.invoke(BEEPERS_CHANNELS.list) as ReturnType<HospitalDirectoryApi["listBeepers"]>,
  addBeeper: (record) =>
    ipcRenderer.invoke(BEEPERS_CHANNELS.add, record) as ReturnType<HospitalDirectoryApi["addBeeper"]>,
  updateBeeper: (id, record) =>
    ipcRenderer.invoke(BEEPERS_CHANNELS.update, id, record) as ReturnType<HospitalDirectoryApi["updateBeeper"]>,
  deleteBeeper: (id) => ipcRenderer.invoke(BEEPERS_CHANNELS.remove, id) as ReturnType<HospitalDirectoryApi["deleteBeeper"]>,
  listImportedBeepers: () => ipcRenderer.invoke(BEEPERS_CHANNELS.listImported) as ReturnType<HospitalDirectoryApi["listImportedBeepers"]>,
  updateImportedBeeper: (id, record) =>
    ipcRenderer.invoke(BEEPERS_CHANNELS.updateImported, id, record) as ReturnType<HospitalDirectoryApi["updateImportedBeeper"]>,
  listBeeperTeams: () =>
    ipcRenderer.invoke(BEEPERS_CHANNELS.listTeams) as ReturnType<HospitalDirectoryApi["listBeeperTeams"]>,
  listBeeperTeamMemberships: () =>
    ipcRenderer.invoke(BEEPERS_CHANNELS.listMemberships) as ReturnType<HospitalDirectoryApi["listBeeperTeamMemberships"]>,
  addBeeperTeam: (team) =>
    ipcRenderer.invoke(BEEPERS_CHANNELS.addTeam, team) as ReturnType<HospitalDirectoryApi["addBeeperTeam"]>,
  updateBeeperTeam: (id, team) =>
    ipcRenderer.invoke(BEEPERS_CHANNELS.updateTeam, id, team) as ReturnType<HospitalDirectoryApi["updateBeeperTeam"]>,
  deleteBeeperTeam: (id) =>
    ipcRenderer.invoke(BEEPERS_CHANNELS.removeTeam, id) as ReturnType<HospitalDirectoryApi["deleteBeeperTeam"]>,
  setBeeperTeamMembers: (teamId, beeperIds) =>
    ipcRenderer.invoke(BEEPERS_CHANNELS.setTeamMembers, teamId, beeperIds) as ReturnType<HospitalDirectoryApi["setBeeperTeamMembers"]>,
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
