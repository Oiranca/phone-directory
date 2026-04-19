import { contextBridge, ipcRenderer } from "electron";
import type { BootstrapData, EditableAppSettings, EditableContactRecord, SaveContactResult } from "../shared/types/contact.js";

const api = {
  getBootstrapData: () => ipcRenderer.invoke("contacts:get-bootstrap-data") as Promise<BootstrapData>,
  saveSettings: (settings: EditableAppSettings) =>
    ipcRenderer.invoke("settings:save", settings) as Promise<EditableAppSettings>,
  createBackup: () => ipcRenderer.invoke("contacts:create-backup") as Promise<void>,
  createRecord: (record: EditableContactRecord) =>
    ipcRenderer.invoke("contacts:create-record", record) as Promise<SaveContactResult>,
  updateRecord: (recordId: string, record: EditableContactRecord) =>
    ipcRenderer.invoke("contacts:update-record", recordId, record) as Promise<SaveContactResult>
};

contextBridge.exposeInMainWorld("hospitalDirectory", api);
