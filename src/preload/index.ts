import { contextBridge, ipcRenderer } from "electron";
import type {
  BackupListItem,
  BootstrapData,
  EditableAppSettings,
  EditableContactRecord,
  ExportContactsResult,
  ImportContactsResult,
  SaveContactResult
} from "../shared/types/contact.js";

const api = {
  getBootstrapData: () => ipcRenderer.invoke("contacts:get-bootstrap-data") as Promise<BootstrapData>,
  saveSettings: (settings: EditableAppSettings) =>
    ipcRenderer.invoke("settings:save", settings) as Promise<EditableAppSettings>,
  createBackup: () => ipcRenderer.invoke("contacts:create-backup") as Promise<string>,
  createRecord: (record: EditableContactRecord) =>
    ipcRenderer.invoke("contacts:create-record", record) as Promise<SaveContactResult>,
  updateRecord: (recordId: string, record: EditableContactRecord) =>
    ipcRenderer.invoke("contacts:update-record", recordId, record) as Promise<SaveContactResult>,
  listBackups: () => ipcRenderer.invoke("contacts:list-backups") as Promise<BackupListItem[]>,
  exportDataset: () => ipcRenderer.invoke("contacts:export-dataset") as Promise<ExportContactsResult | null>,
  importDataset: () => ipcRenderer.invoke("contacts:import-dataset") as Promise<ImportContactsResult | null>
};

contextBridge.exposeInMainWorld("hospitalDirectory", api);
