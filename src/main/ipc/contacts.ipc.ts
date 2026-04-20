import type { EditableContactRecord } from "../../shared/types/contact.js";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { BrowserWindow, app, dialog, ipcMain } from "electron";
import { AppDataService } from "../services/app-data.service.js";

const CSV_IMPORT_TOKEN_TTL_MS = 5 * 60 * 1000;

const CHANNELS = {
  bootstrap: "contacts:get-bootstrap-data",
  createBackup: "contacts:create-backup",
  createRecord: "contacts:create-record",
  updateRecord: "contacts:update-record",
  listBackups: "contacts:list-backups",
  exportDataset: "contacts:export-dataset",
  importDataset: "contacts:import-dataset",
  previewCsvImport: "contacts:preview-csv-import",
  importCsvDataset: "contacts:import-csv-dataset"
};

export const registerContactsIpc = (service: AppDataService) => {
  const pendingCsvImports = new Map<string, { sourceFilePath: string; senderId: number; timeout: NodeJS.Timeout }>();
  const senderTokens = new Map<number, string>();
  const senderCleanupAttached = new Set<number>();

  const clearPendingCsvImport = (importToken: string) => {
    const pendingImport = pendingCsvImports.get(importToken);

    if (!pendingImport) {
      return;
    }

    clearTimeout(pendingImport.timeout);
    pendingCsvImports.delete(importToken);

    if (senderTokens.get(pendingImport.senderId) === importToken) {
      senderTokens.delete(pendingImport.senderId);
    }
  };

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
      defaultPath: path.join(app.getPath("downloads"), "contacts-export.json"),
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
  ipcMain.handle(CHANNELS.previewCsvImport, async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const senderId = event.sender.id;
    const openOptions = {
      title: "Preparar importación CSV",
      filters: [{ name: "CSV", extensions: ["csv"] }],
      properties: ["openFile"]
    } satisfies Electron.OpenDialogOptions;
    const { canceled, filePaths } = window
      ? await dialog.showOpenDialog(window, openOptions)
      : await dialog.showOpenDialog(openOptions);

    if (canceled || filePaths.length === 0) {
      return null;
    }

    const sourceFilePath = filePaths[0]!;
    const preview = await service.previewCsvImport(sourceFilePath);
    const importToken = randomUUID();
    const previousImportToken = senderTokens.get(senderId);

    if (previousImportToken) {
      clearPendingCsvImport(previousImportToken);
    }

    const timeout = setTimeout(() => {
      clearPendingCsvImport(importToken);
    }, CSV_IMPORT_TOKEN_TTL_MS);

    pendingCsvImports.set(importToken, {
      sourceFilePath,
      senderId,
      timeout
    });
    senderTokens.set(senderId, importToken);

    if (!senderCleanupAttached.has(senderId)) {
      senderCleanupAttached.add(senderId);
      event.sender.once("destroyed", () => {
        const activeImportToken = senderTokens.get(senderId);

        if (activeImportToken) {
          clearPendingCsvImport(activeImportToken);
        }

        senderCleanupAttached.delete(senderId);
      });
    }

    return {
      ...preview,
      importToken
    };
  });
  ipcMain.handle(CHANNELS.importCsvDataset, async (_event, importToken: string) => {
    const pendingImport = pendingCsvImports.get(importToken);

    if (!pendingImport) {
      throw new Error("La importación CSV ya no es válida. Vuelve a seleccionar el archivo.");
    }

    clearPendingCsvImport(importToken);
    return service.importCsvDataset(pendingImport.sourceFilePath);
  });
};

export type ContactsChannels = typeof CHANNELS;
