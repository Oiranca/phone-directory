import type { EditableContactRecord } from "../../shared/types/contact.js";
import path from "node:path";
import { BrowserWindow, dialog, ipcMain } from "electron";
import { AppDataService } from "../services/app-data.service.js";

const CHANNELS = {
  bootstrap: "contacts:get-bootstrap-data",
  createBackup: "contacts:create-backup",
  createRecord: "contacts:create-record",
  updateRecord: "contacts:update-record",
  listBackups: "contacts:list-backups",
  exportDataset: "contacts:export-dataset",
  importDataset: "contacts:import-dataset"
};

export const registerContactsIpc = (service: AppDataService) => {
  ipcMain.handle(CHANNELS.bootstrap, () => service.getBootstrapData());
  ipcMain.handle(CHANNELS.createBackup, () => service.createBackup());
  ipcMain.handle(CHANNELS.createRecord, (_event, payload: EditableContactRecord) =>
    service.createRecord(payload)
  );
  ipcMain.handle(CHANNELS.updateRecord, (_event, recordId: string, payload: EditableContactRecord) =>
    service.updateRecord(recordId, payload)
  );
  ipcMain.handle(CHANNELS.listBackups, () => service.listBackups());
  ipcMain.handle(CHANNELS.exportDataset, async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const saveOptions = {
      title: "Exportar directorio",
      defaultPath: path.join("contacts-export.json"),
      filters: [{ name: "JSON", extensions: ["json"] }]
    };
    const { canceled, filePath } = window
      ? await dialog.showSaveDialog(window, saveOptions)
      : await dialog.showSaveDialog(saveOptions);

    if (canceled || !filePath) {
      return null;
    }

    return service.exportDataset(filePath);
  });
  ipcMain.handle(CHANNELS.importDataset, async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const openOptions = {
      title: "Importar directorio JSON",
      filters: [{ name: "JSON", extensions: ["json"] }],
      properties: ["openFile"]
    } satisfies Electron.OpenDialogOptions;
    const { canceled, filePaths } = window
      ? await dialog.showOpenDialog(window, openOptions)
      : await dialog.showOpenDialog(openOptions);

    if (canceled || filePaths.length === 0) {
      return null;
    }

    return service.importDataset(filePaths[0]!);
  });
};

export type ContactsChannels = typeof CHANNELS;
