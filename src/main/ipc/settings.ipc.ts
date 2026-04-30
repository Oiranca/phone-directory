import { BrowserWindow, dialog, ipcMain } from "electron";
import type { EditableAppSettings } from "../../shared/types/contact.js";
import { AppDataService } from "../services/app-data.service.js";

const CHANNELS = {
  save: "settings:save",
  defaults: "settings:defaults",
  browsePath: "settings:browse-path"
};

export const registerSettingsIpc = (service: AppDataService) => {
  ipcMain.handle(CHANNELS.save, async (_event, payload: EditableAppSettings) => {
    const saved = await service.saveSettings(payload);
    return service.toEditableSettings(saved);
  });

  ipcMain.handle(CHANNELS.defaults, () => service.getEditableSettingsDefaults());

  ipcMain.handle(CHANNELS.browsePath, async (event, type: unknown): Promise<string | null> => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (type !== "dataFile" && type !== "backupDirectory") {
      return null;
    }
    if (type === "dataFile") {
      const result = win
        ? await dialog.showSaveDialog(win, {
            filters: [{ name: "JSON", extensions: ["json"] }],
            properties: ["createDirectory"]
          })
        : await dialog.showSaveDialog({
            filters: [{ name: "JSON", extensions: ["json"] }],
            properties: ["createDirectory"]
          });
      return result.canceled ? null : (result.filePath ?? null);
    }
    const result = win
      ? await dialog.showOpenDialog(win, {
          properties: ["openDirectory", "createDirectory"]
        })
      : await dialog.showOpenDialog({
          properties: ["openDirectory", "createDirectory"]
        });
    return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0];
  });
};

export type SettingsChannels = typeof CHANNELS;
