import { contextBridge, ipcRenderer } from "electron";
import type {
  BackupListItem,
  BootstrapResult,
  CsvImportPreview,
  CsvImportResult,
  EditableAppSettings,
  EditableContactRecord,
  ExportContactsResult,
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
  previewCsvImport: () => ipcRenderer.invoke("contacts:preview-csv-import") as Promise<CsvImportPreview | null>,
  importCsvDataset: (importToken: string) =>
    ipcRenderer.invoke("contacts:import-csv-dataset", importToken) as Promise<CsvImportResult>,
  browseForPath: (type: "dataFile" | "backupDirectory") =>
    ipcRenderer.invoke("settings:browse-path", type) as Promise<string | null>
};

contextBridge.exposeInMainWorld("hospitalDirectory", api);
