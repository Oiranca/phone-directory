import { contextBridge, ipcRenderer } from "electron";
import type { BootstrapData, EditableAppSettings } from "../shared/types/contact.js";

const api = {
  getBootstrapData: () => ipcRenderer.invoke("contacts:get-bootstrap-data") as Promise<BootstrapData>,
  saveSettings: (settings: EditableAppSettings) =>
    ipcRenderer.invoke("settings:save", settings) as Promise<EditableAppSettings>,
  createBackup: () => ipcRenderer.invoke("contacts:create-backup") as Promise<void>
};

contextBridge.exposeInMainWorld("hospitalDirectory", api);
