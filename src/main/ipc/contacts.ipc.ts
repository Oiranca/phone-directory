import type { EditableContactRecord } from "../../shared/types/contact.js";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { BrowserWindow, app, dialog, ipcMain } from "electron";
import { AppDataService } from "../services/app-data.service.js";
import { env } from "../config/env.js";

const CSV_IMPORT_TOKEN_TTL_MS = 5 * 60 * 1000;

const CHANNELS = {
  bootstrap: "contacts:get-bootstrap-data",
  createBackup: "contacts:create-backup",
  resetDataset: "contacts:reset-dataset",
  createRecord: "contacts:create-record",
  updateRecord: "contacts:update-record",
  listBackups: "contacts:list-backups",
  restoreBackup: "contacts:restore-backup",
  exportDataset: "contacts:export-dataset",
  importDataset: "contacts:import-dataset",
  previewCsvImport: "contacts:preview-csv-import",
  importCsvDataset: "contacts:import-csv-dataset"
};

export const registerContactsIpc = (service: AppDataService) => {
  const pendingCsvImports = new Map<string, { sourceFilePath: string; senderId: number; timeout: NodeJS.Timeout }>();
  const senderTokens = new Map<number, string>();
  const senderCleanupAttached = new Set<number>();
  const pendingE2eOpenDialogPaths = [...env.e2eOpenDialogPaths];
  const pendingE2eSaveDialogPaths = [...env.e2eSaveDialogPaths];

  const consumeE2eOpenDialogPath = () => pendingE2eOpenDialogPaths.shift() ?? null;
  const consumeE2eSaveDialogPath = () => pendingE2eSaveDialogPaths.shift() ?? null;

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
  ipcMain.handle(CHANNELS.resetDataset, () => service.resetDataset());
  ipcMain.handle(CHANNELS.createRecord, (_event, payload: EditableContactRecord) =>
    service.createRecord(payload)
  );
  ipcMain.handle(CHANNELS.updateRecord, (_event, recordId: string, payload: EditableContactRecord) =>
    service.updateRecord(recordId, payload)
  );
  ipcMain.handle(CHANNELS.listBackups, () => service.listBackups());
  ipcMain.handle(CHANNELS.restoreBackup, (_event, backupFilePath: string) => service.restoreBackup(backupFilePath));
  ipcMain.handle(CHANNELS.exportDataset, async (event) => {
    const e2eFilePath = consumeE2eSaveDialogPath();

    if (e2eFilePath) {
      return service.exportDataset(e2eFilePath);
    }

    const browserWindow = BrowserWindow.fromWebContents(event.sender);
    const saveOptions = {
      title: "Exportar directorio",
      defaultPath: path.join(app.getPath("downloads"), "contacts-export.json"),
      filters: [{ name: "JSON", extensions: ["json"] }]
    };
    const { canceled, filePath } = browserWindow
      ? await dialog.showSaveDialog(browserWindow, saveOptions)
      : await dialog.showSaveDialog(saveOptions);

    if (canceled || !filePath) {
      return null;
    }

    return service.exportDataset(filePath);
  });
  ipcMain.handle(CHANNELS.importDataset, async (event) => {
    const e2eFilePath = consumeE2eOpenDialogPath();

    if (e2eFilePath) {
      return service.importDataset(e2eFilePath);
    }

    const browserWindow = BrowserWindow.fromWebContents(event.sender);
    const openOptions = {
      title: "Importar directorio JSON",
      filters: [{ name: "JSON", extensions: ["json"] }],
      properties: ["openFile"]
    } satisfies Electron.OpenDialogOptions;
    const { canceled, filePaths } = browserWindow
      ? await dialog.showOpenDialog(browserWindow, openOptions)
      : await dialog.showOpenDialog(openOptions);

    if (canceled || filePaths.length === 0) {
      return null;
    }

    return service.importDataset(filePaths[0]!);
  });
  ipcMain.handle(CHANNELS.previewCsvImport, async (event) => {
    const e2eFilePath = consumeE2eOpenDialogPath();
    const browserWindow = BrowserWindow.fromWebContents(event.sender);
    const senderId = event.sender.id;
    const openOptions = {
      title: "Preparar importación de agenda",
      filters: [{ name: "Hojas de cálculo", extensions: ["csv", "ods", "xlsx", "xls"] }],
      properties: ["openFile"]
    } satisfies Electron.OpenDialogOptions;
    const sourceFilePath = e2eFilePath
      ? e2eFilePath
      : await (async () => {
        const { canceled, filePaths } = browserWindow
          ? await dialog.showOpenDialog(browserWindow, openOptions)
          : await dialog.showOpenDialog(openOptions);

        if (canceled || filePaths.length === 0) {
          return null;
        }

        return filePaths[0]!;
      })();

    if (!sourceFilePath) {
      return null;
    }
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
