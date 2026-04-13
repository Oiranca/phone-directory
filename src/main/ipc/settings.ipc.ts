import { ipcMain } from "electron";
import type { AppSettings } from "../../shared/types/contact.js";
import { AppDataService } from "../services/app-data.service.js";

const CHANNELS = {
  save: "settings:save"
};

export const registerSettingsIpc = (service: AppDataService) => {
  ipcMain.handle(CHANNELS.save, (_event, payload: AppSettings) => service.saveSettings(payload));
};

export type SettingsChannels = typeof CHANNELS;
