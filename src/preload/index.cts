import { contextBridge, ipcRenderer } from "electron";
import type {
  AutoBackupFailureEvent,
  BackupListItem,
  BootstrapResult,
  CsvImportPolicySelection,
  CsvImportPreviewWithConflicts,
  CsvImportResult,
  EditableAppSettings,
  EditableContactRecord,
  ExportContactsResult,
  AuditLogQueryParams,
  AuditLogResult,
  ExportAuditLogResult,
  ImportContactsResult,
  ResetContactsResult,
  SaveContactResult
} from "../shared/types/contact.js";

const api = {
  getBootstrapData: () => ipcRenderer.invoke("contacts:get-bootstrap-data") as Promise<BootstrapResult>,
  getSettingsDefaults: () => ipcRenderer.invoke("settings:defaults") as Promise<EditableAppSettings>,
  saveSettings: (settings: EditableAppSettings) =>
    ipcRenderer.invoke("settings:save", settings) as Promise<EditableAppSettings>,
  createBackup: () => ipcRenderer.invoke("contacts:create-backup") as Promise<string>,
  createRecord: (record: EditableContactRecord) =>
    ipcRenderer.invoke("contacts:create-record", record) as Promise<SaveContactResult>,
  updateRecord: (recordId: string, record: EditableContactRecord) =>
    ipcRenderer.invoke("contacts:update-record", recordId, record) as Promise<SaveContactResult>,
  listBackups: () => ipcRenderer.invoke("contacts:list-backups") as Promise<BackupListItem[]>,
  restoreBackup: (backupFilePath: string) =>
    ipcRenderer.invoke("contacts:restore-backup", backupFilePath) as Promise<ImportContactsResult>,
  exportDataset: () => ipcRenderer.invoke("contacts:export-dataset") as Promise<ExportContactsResult | null>,
  importDataset: () => ipcRenderer.invoke("contacts:import-dataset") as Promise<ImportContactsResult | null>,
  resetDataset: () => ipcRenderer.invoke("contacts:reset-dataset") as Promise<ResetContactsResult>,
  previewCsvImport: () => ipcRenderer.invoke("contacts:preview-csv-import") as Promise<CsvImportPreviewWithConflicts | null>,
  importCsvDataset: (importToken: string, policies: CsvImportPolicySelection[] = []) =>
    ipcRenderer.invoke("contacts:import-csv-dataset", importToken, policies) as Promise<CsvImportResult>,
  browseForPath: (type: "dataFile" | "backupDirectory") =>
    ipcRenderer.invoke("settings:browse-path", type) as Promise<string | null>,
  getAuditLog: (params: AuditLogQueryParams) =>
    ipcRenderer.invoke("contacts:get-audit-log", params) as Promise<AuditLogResult>,
  exportAuditLog: (params: AuditLogQueryParams) =>
    ipcRenderer.invoke("contacts:export-audit-log", params) as Promise<ExportAuditLogResult | null>,
  onAutoBackupFailure: (listener: (event: AutoBackupFailureEvent) => void) => {
    const wrappedListener = (_event: unknown, payload: AutoBackupFailureEvent) => {
      listener(payload);
    };

    ipcRenderer.on("app:auto-backup-failed", wrappedListener);

    return () => {
      ipcRenderer.removeListener("app:auto-backup-failed", wrappedListener);
    };
  }
};

contextBridge.exposeInMainWorld("hospitalDirectory", api);
