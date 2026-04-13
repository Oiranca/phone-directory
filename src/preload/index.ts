import { contextBridge, ipcRenderer } from "electron";
import type { AppSettings, BootstrapData } from "../shared/types/contact.js";

const api = {
  getBootstrapData: () => ipcRenderer.invoke("contacts:get-bootstrap-data") as Promise<BootstrapData>,
  saveSettings: (settings: AppSettings) => ipcRenderer.invoke("settings:save", settings) as Promise<AppSettings>,
  createBackup: () => ipcRenderer.invoke("contacts:create-backup") as Promise<string>
};

contextBridge.exposeInMainWorld("hospitalDirectory", api);
