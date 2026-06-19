import type { CsvImportPolicySelection, EditableContactRecord, MergePolicy } from "../../shared/types/contact.js";
import { auditLogQueryParamsSchema } from "../../shared/schemas/contact.js";
import { mergeContactsSchema } from "../../shared/schemas/merge-contacts.schema.js";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { BrowserWindow, app, dialog, ipcMain } from "electron";
import type { WebContents } from "electron";
import { AppDataService } from "../services/app-data.service.js";
import { DuplicateDetectionService, DuplicateDetectionAbortError } from "../services/duplicate-detection.service.js";
import { env } from "../config/env.js";

const CSV_IMPORT_TOKEN_TTL_MS = 5 * 60 * 1000;
const CSV_IMPORT_MAX_WRONG_SENDER_ATTEMPTS = 3;
const MERGE_POLICIES = new Set<MergePolicy>(["overwrite", "skip", "merge-fields"]);

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
  importCsvDataset: "contacts:import-csv-dataset",
  getAuditLog: "contacts:get-audit-log",
  exportAuditLog: "contacts:export-audit-log",
  detectDuplicates: "contacts:detect-duplicates",
  mergeDuplicates: "contacts:merge-duplicates"
};

export const registerContactsIpc = (service: AppDataService) => {
  // sourceFilePath and senderId identify the import; sender/navListener are held so
  // cleanup can detach the navigation listener without a secondary lookup.
  const pendingCsvImports = new Map<
    string,
    {
      sourceFilePath: string;
      senderId: number;
      sender: WebContents;
      navListener: () => void;
      timeout: NodeJS.Timeout;
      wrongSenderAttempts: number;
    }
  >();
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

    // Detach the navigation listener — sender may already be destroyed, so guard.
    try {
      pendingImport.sender.removeListener("did-start-navigation", pendingImport.navListener);
    } catch {
      // sender destroyed before cleanup; nothing to remove.
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
    // previewCsvImport declares { sourceFilePath: string } in its return type so
    // TypeScript proves the field exists here; we destructure it out before the
    // renderer payload is assembled (OIR-115 — no cast needed).
    const preview = await service.previewCsvImport(sourceFilePath);
    const importToken = randomUUID();
    const previousImportToken = senderTokens.get(senderId);

    if (previousImportToken) {
      clearPendingCsvImport(previousImportToken);
    }

    const timeout = setTimeout(() => {
      clearPendingCsvImport(importToken);
    }, CSV_IMPORT_TOKEN_TTL_MS);

    // Invalidate the token when the sender navigates away — a navigation means the
    // import preview UI is gone and any pending confirmation would be from a stale tab.
    const navListener = () => {
      clearPendingCsvImport(importToken);
    };

    event.sender.on("did-start-navigation", navListener);

    pendingCsvImports.set(importToken, {
      sourceFilePath,
      senderId,
      sender: event.sender,
      navListener,
      timeout,
      wrongSenderAttempts: 0
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

    // Strip the absolute sourceFilePath before sending to the renderer (OIR-115).
    // The path is retained server-side in pendingCsvImports; the renderer
    // identifies the import by importToken only.
    const { sourceFilePath: _stripped, ...safePreview } = preview;
    return {
      ...safePreview,
      importToken
    };
  });
  ipcMain.handle(CHANNELS.importCsvDataset, async (event, importToken: string, rawPolicies: unknown = []) => {
    // Atomically take the token before any await — a second concurrent confirmation
    // will find nothing in the map and be rejected immediately.
    const pendingImport = pendingCsvImports.get(importToken);

    if (!pendingImport) {
      throw new Error("La importación CSV ya no es válida. Vuelve a seleccionar el archivo.");
    }

    // Reject if the confirming sender is not the one that requested the preview.
    // This prevents another renderer in the same process from consuming a foreign token.
    // To prevent indefinite token-validity probing by an adversarial renderer that knows
    // or guesses a token, we bound the number of wrong-sender attempts. Once the cap is
    // reached the token is invalidated so further probes fail with the same opaque error.
    if (event.sender.id !== pendingImport.senderId) {
      pendingImport.wrongSenderAttempts += 1;
      if (pendingImport.wrongSenderAttempts >= CSV_IMPORT_MAX_WRONG_SENDER_ATTEMPTS) {
        clearPendingCsvImport(importToken);
      }
      throw new Error("La importación CSV ya no es válida. Vuelve a seleccionar el archivo.");
    }

    if (!Array.isArray(rawPolicies)) {
      throw new Error("Las políticas de conflicto no tienen un formato válido.");
    }

    const policies = rawPolicies.map((item) => {
      if (
        typeof item !== "object" ||
        item === null ||
        !Number.isInteger((item as CsvImportPolicySelection).recordIndex) ||
        !MERGE_POLICIES.has((item as CsvImportPolicySelection).policy)
      ) {
        throw new Error("Las políticas de conflicto no tienen un formato válido.");
      }

      return item as CsvImportPolicySelection;
    });

    // Synchronously consume the token before the first await so concurrent
    // confirmations cannot race past this point with the same token.
    clearPendingCsvImport(importToken);
    return service.importCsvDataset(pendingImport.sourceFilePath, policies);
  });

  ipcMain.handle(CHANNELS.getAuditLog, async (_event, rawParams: unknown) => {
    const parsed = auditLogQueryParamsSchema.safeParse(rawParams ?? {});
    if (!parsed.success) {
      throw new Error("Invalid query parameters");
    }
    try {
      return await service.getAuditLog(parsed.data);
    } catch (err) {
      console.error("[contacts:get-audit-log]", err);
      throw new Error("Internal server error");
    }
  });

  ipcMain.handle(CHANNELS.exportAuditLog, async (event, rawParams: unknown) => {
    const parsed = auditLogQueryParamsSchema.safeParse(rawParams ?? {});
    if (!parsed.success) {
      throw new Error("Invalid query parameters");
    }
    try {
      const e2eFilePath = consumeE2eSaveDialogPath();

      if (e2eFilePath) {
        return await service.exportAuditLog(e2eFilePath, parsed.data);
      }

      const browserWindow = BrowserWindow.fromWebContents(event.sender);
      const saveOptions = {
        title: "Exportar registro de auditoría",
        defaultPath: path.join(app.getPath("downloads"), "audit-log-export.csv"),
        filters: [{ name: "CSV", extensions: ["csv"] }]
      };
      const { canceled, filePath } = browserWindow
        ? await dialog.showSaveDialog(browserWindow, saveOptions)
        : await dialog.showSaveDialog(saveOptions);

      if (canceled || !filePath) {
        return null;
      }

      return await service.exportAuditLog(filePath, parsed.data);
    } catch (err) {
      console.error("[contacts:export-audit-log]", err);
      throw new Error("Internal server error");
    }
  });

  ipcMain.handle(CHANNELS.detectDuplicates, async () => {
    const bootstrapData = await service.getBootstrapData();

    if ("recovery" in bootstrapData) {
      throw new Error("Cannot detect duplicates — contacts data is in recovery state");
    }

    const records = bootstrapData.contacts.records;
    const duplicateService = new DuplicateDetectionService();

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30_000);

    try {
      return await duplicateService.detectDuplicates(records, { signal: controller.signal });
    } catch (err) {
      if (err instanceof DuplicateDetectionAbortError) {
        throw new Error("La detección de duplicados tardó demasiado. Inténtelo de nuevo.");
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  });

  ipcMain.handle(CHANNELS.mergeDuplicates, async (_event, rawPayload: unknown) => {
    const parsed = mergeContactsSchema.safeParse(rawPayload);

    if (!parsed.success) {
      throw new Error("Invalid merge request");
    }

    return service.mergeDuplicates(parsed.data.keepId, parsed.data.discardId);
  });
};

export type ContactsChannels = typeof CHANNELS;
