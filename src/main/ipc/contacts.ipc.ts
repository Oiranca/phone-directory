import { ipcMain } from "electron";
import { AppDataService } from "../services/app-data.service.js";

const CHANNELS = {
  bootstrap: "contacts:get-bootstrap-data",
  createBackup: "contacts:create-backup"
};

export const registerContactsIpc = (service: AppDataService) => {
  ipcMain.handle(CHANNELS.bootstrap, () => service.getBootstrapData());
  ipcMain.handle(CHANNELS.createBackup, () => service.createBackup());
};

export type ContactsChannels = typeof CHANNELS;
