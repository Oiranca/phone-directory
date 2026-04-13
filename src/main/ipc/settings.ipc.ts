import { ipcMain } from "electron";
import type { EditableAppSettings } from "../../shared/types/contact.js";
import { AppDataService } from "../services/app-data.service.js";

const CHANNELS = {
  save: "settings:save"
};

export const registerSettingsIpc = (service: AppDataService) => {
  ipcMain.handle(CHANNELS.save, async (_event, payload: EditableAppSettings) => {
    const saved = await service.saveSettings(payload);
    return service.toEditableSettings(saved);
  });
};

export type SettingsChannels = typeof CHANNELS;
