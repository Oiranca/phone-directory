import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { HospitalDirectoryApi } from "../../shared/ipc/api.js";
import type { AutoBackupFailureEvent } from "../../shared/types/contact.js";

type InvokeMethod = Exclude<keyof HospitalDirectoryApi, "onAutoBackupFailure">;

type TauriEvent<T> = { payload: T };

export interface TauriTransport {
  invoke: <T>(command: string, args?: Record<string, unknown>) => Promise<T>;
  listen: <T>(event: string, listener: (event: TauriEvent<T>) => void) => Promise<() => void>;
}

// These command names are the Rust boundary for #548–#552. They deliberately
// remain separate from Electron's private IPC channel names.
export const TAURI_COMMANDS = {
  getBootstrapData: "get_bootstrap_data",
  getSettingsDefaults: "get_settings_defaults",
  saveSettings: "save_settings",
  browseForPath: "browse_for_path",
  createRecord: "create_record",
  updateRecord: "update_record",
  deleteRecord: "delete_record",
  createBackup: "create_backup",
  listBackups: "list_backups",
  restoreBackup: "restore_backup",
  exportDataset: "export_dataset",
  resetDataset: "reset_dataset",
  recoverAuditLog: "recover_audit_log",
  previewCsvImport: "preview_csv_import",
  cancelCsvImportPreview: "cancel_csv_import_preview",
  importCsvDataset: "import_csv_dataset",
  resolveCsvImportCounts: "resolve_csv_import_counts",
  pickAndImportDataset: "pick_and_import_dataset",
  confirmJsonImport: "confirm_json_import",
  cancelJsonImport: "cancel_json_import",
  listBeepers: "list_beepers",
  addBeeper: "add_beeper",
  updateBeeper: "update_beeper",
  deleteBeeper: "delete_beeper",
  listImportedBeepers: "list_imported_beepers",
  updateImportedBeeper: "update_imported_beeper",
  listBeeperTeams: "list_beeper_teams",
  listBeeperTeamMemberships: "list_beeper_team_memberships",
  addBeeperTeam: "add_beeper_team",
  updateBeeperTeam: "update_beeper_team",
  deleteBeeperTeam: "delete_beeper_team",
  setBeeperTeamMembers: "set_beeper_team_members",
  detectDuplicates: "detect_duplicates",
  mergeContacts: "merge_contacts"
} as const satisfies Record<InvokeMethod, string>;

const AUTO_BACKUP_FAILURE_EVENT = "auto_backup_failure";

const defaultTransport: TauriTransport = {
  invoke,
  listen: (event, listener) => listen(event, listener)
};

const command = <Method extends InvokeMethod>(
  transport: TauriTransport,
  method: Method,
  args?: Record<string, unknown>
): ReturnType<HospitalDirectoryApi[Method]> =>
  transport.invoke(TAURI_COMMANDS[method], args) as ReturnType<HospitalDirectoryApi[Method]>;

export const createTauriHospitalDirectoryApi = (
  transport: TauriTransport = defaultTransport
): HospitalDirectoryApi => ({
  getBootstrapData: () => command(transport, "getBootstrapData"),
  getSettingsDefaults: () => command(transport, "getSettingsDefaults"),
  saveSettings: (settings) => command(transport, "saveSettings", { settings }),
  browseForPath: (type) => command(transport, "browseForPath", { type }),
  createRecord: (record) => command(transport, "createRecord", { record }),
  updateRecord: (recordId, record) => command(transport, "updateRecord", { recordId, record }),
  deleteRecord: (recordId) => command(transport, "deleteRecord", { recordId }),
  createBackup: () => command(transport, "createBackup"),
  listBackups: () => command(transport, "listBackups"),
  restoreBackup: (backupFileName) => command(transport, "restoreBackup", { backupFileName }),
  exportDataset: () => command(transport, "exportDataset"),
  resetDataset: () => command(transport, "resetDataset"),
  recoverAuditLog: () => command(transport, "recoverAuditLog"),
  previewCsvImport: () => command(transport, "previewCsvImport"),
  cancelCsvImportPreview: (importToken) =>
    command(transport, "cancelCsvImportPreview", importToken === undefined ? undefined : { importToken }),
  importCsvDataset: (importToken, policies = []) => command(transport, "importCsvDataset", { importToken, policies }),
  resolveCsvImportCounts: (importToken, policies = []) =>
    command(transport, "resolveCsvImportCounts", { importToken, policies }),
  pickAndImportDataset: () => command(transport, "pickAndImportDataset"),
  confirmJsonImport: (importToken) => command(transport, "confirmJsonImport", { importToken }),
  cancelJsonImport: (importToken) => command(transport, "cancelJsonImport", { importToken }),
  listBeepers: () => command(transport, "listBeepers"),
  addBeeper: (record) => command(transport, "addBeeper", { record }),
  updateBeeper: (id, record) => command(transport, "updateBeeper", { id, record }),
  deleteBeeper: (id) => command(transport, "deleteBeeper", { id }),
  listImportedBeepers: () => command(transport, "listImportedBeepers"),
  updateImportedBeeper: (id, record) => command(transport, "updateImportedBeeper", { id, record }),
  listBeeperTeams: () => command(transport, "listBeeperTeams"),
  listBeeperTeamMemberships: () => command(transport, "listBeeperTeamMemberships"),
  addBeeperTeam: (team) => command(transport, "addBeeperTeam", { team }),
  updateBeeperTeam: (id, team) => command(transport, "updateBeeperTeam", { id, team }),
  deleteBeeperTeam: (id) => command(transport, "deleteBeeperTeam", { id }),
  setBeeperTeamMembers: (teamId, beeperIds) => command(transport, "setBeeperTeamMembers", { teamId, beeperIds }),
  detectDuplicates: () => command(transport, "detectDuplicates"),
  mergeContacts: (request) => command(transport, "mergeContacts", { request }),
  onAutoBackupFailure: (listener) => subscribeToAutoBackupFailure(transport, listener)
});

const subscribeToAutoBackupFailure = (
  transport: TauriTransport,
  listener: (event: AutoBackupFailureEvent) => void
) => {
  let unsubscribed = false;
  let unlisten: (() => void) | undefined;

  void transport.listen<AutoBackupFailureEvent>(AUTO_BACKUP_FAILURE_EVENT, (event) => {
    if (!unsubscribed) listener(event.payload);
  }).then((nextUnlisten) => {
    if (unsubscribed) {
      nextUnlisten();
      return;
    }

    unlisten = nextUnlisten;
  }, () => undefined);

  return () => {
    unsubscribed = true;
    unlisten?.();
  };
};
