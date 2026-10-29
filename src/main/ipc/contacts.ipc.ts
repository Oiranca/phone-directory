import type {
  EditableContactRecord,
  BackupListItem,
  BackupListItemInternal,
  ExportContactsResult,
  ExportContactsResultInternal,
  ResetContactsResultInternal
} from "../../shared/types/contact.js";
import { mergeContactsSchema } from "../../shared/schemas/merge-contacts.schema.js";
import { csvImportPolicySelectionListSchema } from "../../shared/schemas/csv-import-policy.schema.js";
import { CONTACTS_CHANNELS as CHANNELS } from "../../shared/ipc/channels.js";
import path from "node:path";
import fs from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { BrowserWindow, app, dialog } from "electron";
import type { IpcMain, WebContents } from "electron";
import { AppDataService } from "../services/app-data.service.js";
import type { JsonImportPreviewInternal } from "../services/app-data.service.js";
import { JsonDataError } from "../services/json-data-reader.js";
import { DuplicateDetectionService, DuplicateDetectionAbortError } from "../services/duplicate-detection.service.js";
import { ImportPreviewAbortError } from "../services/import-preview-control.js";
import { MAX_CSV_IMPORT_SIZE_BYTES } from "../services/csv-import.service.js";
import { MAX_JSON_FILE_SIZE_BYTES, MAX_JSON_FILE_SIZE_MB } from "../../shared/constants/json-limits.js";
import { env } from "../config/env.js";

const CSV_IMPORT_TOKEN_TTL_MS = 5 * 60 * 1000;
const CSV_IMPORT_PREVIEW_TIMEOUT_MS = 10_000;
const CSV_IMPORT_MAX_WRONG_SENDER_ATTEMPTS = 3;
const STALE_IMPORT_SNAPSHOT_MS = CSV_IMPORT_TOKEN_TTL_MS * 2;
// Defensive global cap on concurrent pending CSV imports; see
// pendingCsvImports below.
const MAX_PENDING_CSV_IMPORTS = 30;
const MAX_PENDING_JSON_IMPORTS = 30;
// Extensions accepted by the unified pickAndImportDataset dialog filter.
const CSV_LIKE_EXTENSIONS = new Set(["csv", "ods", "xls", "xlsx"]);
const isFilesystemError = (error: unknown) => error instanceof Error && (
  ("code" in error && typeof error.code === "string" && /^E[A-Z0-9]+$/.test(error.code)) ||
  ("path" in error && typeof error.path === "string") ||
  ("dest" in error && typeof error.dest === "string")
);
const sourceFileAccessError = () => new Error("No se pudo acceder al archivo seleccionado.");
const sourceFingerprint = async (sourceFilePath: string) => {
  try {
    return createHash("sha256").update(await fs.readFile(sourceFilePath)).digest("hex");
  } catch (error) {
    if (isFilesystemError(error)) throw sourceFileAccessError();
    throw error;
  }
};
const removeImportSnapshot = async (snapshotPath: string) => {
  try {
    await fs.rm(path.dirname(snapshotPath), { recursive: true, force: true });
  } catch (error) {
    console.error("[contacts.ipc] Could not remove import snapshot:", error);
  }
};
const cleanupStaleImportSnapshots = async () => {
  try {
    const tempDirectory = app.getPath("temp");
    const entries = await fs.readdir(tempDirectory, { withFileTypes: true });
    const oldestAllowed = Date.now() - STALE_IMPORT_SNAPSHOT_MS;
    await Promise.all(entries.map(async (entry) => {
      if (!entry.isDirectory() || !entry.name.startsWith("hospiagenda-import-")) return;
      const snapshotDirectory = path.join(tempDirectory, entry.name);
      const stats = await fs.stat(snapshotDirectory);
      if (stats.mtimeMs < oldestAllowed) await fs.rm(snapshotDirectory, { recursive: true, force: true });
    }));
  } catch (error) {
    console.error("[contacts.ipc] Could not clean stale import snapshots:", error);
  }
};
const createImportSnapshot = async (sourceFilePath: string) => {
  let directory: string | null = null;
  try {
    const sourceStats = await fs.stat(sourceFilePath);
    const extension = path.extname(sourceFilePath).toLowerCase();

    if (extension === ".json" && sourceStats.size > MAX_JSON_FILE_SIZE_BYTES) {
      throw new JsonDataError(
        "too-large",
        `El archivo JSON supera el tamaño máximo permitido de ${MAX_JSON_FILE_SIZE_MB} MB.`
      );
    }

    if (CSV_LIKE_EXTENSIONS.has(extension.slice(1)) && sourceStats.size > MAX_CSV_IMPORT_SIZE_BYTES) {
      throw new Error("El CSV supera el tamaño máximo permitido de 5 MB. Divide el archivo antes de importarlo.");
    }

    const fingerprint = await sourceFingerprint(sourceFilePath);
    directory = await fs.mkdtemp(path.join(app.getPath("temp"), "hospiagenda-import-"));
    const snapshotPath = path.join(directory, path.basename(sourceFilePath));
    await fs.copyFile(sourceFilePath, snapshotPath);
    if (
      await sourceFingerprint(snapshotPath) !== fingerprint ||
      await sourceFingerprint(sourceFilePath) !== fingerprint
    ) {
      throw new Error("El archivo seleccionado cambió durante la vista previa. Vuelve a seleccionarlo.");
    }
    return { fingerprint, snapshotPath };
  } catch (error) {
    if (directory) await removeImportSnapshot(path.join(directory, "snapshot"));
    if (isFilesystemError(error)) throw sourceFileAccessError();
    throw error;
  }
};

// ---------------------------------------------------------------------------
// Renderer-safe result mappers (OIR-276)
//
// AppDataService's import/restore/reset/export/listBackups methods return
// "Internal" result types that carry absolute filesystem paths
// (backupPath/importedFilePath/filePath) — needed main-process-side (tests,
// restoreBackup chaining). These helpers strip those fields immediately
// before a result crosses the IPC boundary into the renderer, mirroring the
// existing sourceFilePath-stripping pattern already used for CSV preview
// payloads (see runCsvImportPreview below).
// ---------------------------------------------------------------------------

const stripImportPaths = <T extends { backupPath: unknown; importedFilePath: unknown }>(
  result: T
): Omit<T, "backupPath" | "importedFilePath"> => {
  const { backupPath: _backupPath, importedFilePath: _importedFilePath, ...safe } = result;
  return safe;
};

const stripCombinedImportPaths = <
  T extends { backupPath: unknown; beeperBackupPath: unknown; importedFilePath: unknown }
>(result: T): Omit<T, "backupPath" | "beeperBackupPath" | "importedFilePath"> => {
  const {
    backupPath: _backupPath,
    beeperBackupPath: _beeperBackupPath,
    importedFilePath: _importedFilePath,
    ...safe
  } = result;
  return safe;
};

const toSafeResetResult = (result: ResetContactsResultInternal) => {
  const { backupPath: _backupPath, ...safe } = result;
  return safe;
};

const toSafeBackupListItem = ({ filePath: _filePath, ...safe }: BackupListItemInternal): BackupListItem => safe;

// OIR-276: listBackups() no longer returns filePath to the renderer, so
// restoreBackup() must accept a bare fileName (as returned by listBackups()'s
// fileName field) instead of an absolute path. Reject anything that looks
// like a path — separators or traversal segments — before it is ever joined
// against the real backup directory. path.basename(name) !== name is the
// belt-and-braces check: it also catches platform-specific separators
// (e.g. a literal "\\" on a POSIX host) that the explicit checks below list
// individually for clarity.
const isSafeBackupFileName = (fileName: unknown): fileName is string =>
  typeof fileName === "string" &&
  fileName.length > 0 &&
  !fileName.includes("/") &&
  !fileName.includes("\\") &&
  !fileName.includes("..") &&
  path.basename(fileName) === fileName;

// Reused verbatim across every invalid-restore-request rejection in this
// codebase (see AppDataService.restoreBackup's own defense-in-depth checks)
// so a renderer-supplied fileName never leaks into the error copy.
const RESTORE_BACKUP_ERROR_MESSAGE = "No se pudo restaurar la copia de seguridad seleccionada.";
const AUDIT_LOG_RECOVERY_ERROR_MESSAGE = "No se pudo restablecer el registro de auditoría.";

const toSafeExportResult = (result: ExportContactsResultInternal): ExportContactsResult => ({
  fileName: path.basename(result.filePath),
  exportedAt: result.exportedAt,
  recordCount: result.recordCount,
  beeperRecordCount: result.beeperRecordCount,
  importedBeeperRecordCount: result.importedBeeperRecordCount
});

export const registerContactsIpc = (service: AppDataService, handle: IpcMain["handle"]) => {
  void cleanupStaleImportSnapshots();
  setInterval(() => void cleanupStaleImportSnapshots(), STALE_IMPORT_SNAPSHOT_MS).unref();
  // sourceFilePath and senderId identify the import; sender/navListener are held so
  // cleanup can detach the navigation listener without a secondary lookup.
  const pendingCsvImports = new Map<
    string,
    {
      sourceFilePath: string;
      selectedSourceFilePath: string;
      sourceFingerprint: string;
      senderId: number;
      sender: WebContents;
      navListener: (details?: { isSameDocument?: boolean }) => void;
      timeout: NodeJS.Timeout;
      wrongSenderAttempts: number;
    }
  >();
  const pendingJsonImports = new Map<string, {
    sourceFilePath: string;
    selectedSourceFilePath: string;
    sourceFingerprint: string;
    parsed: JsonImportPreviewInternal;
    senderId: number;
    sender: WebContents;
    navListener: (details?: { isSameDocument?: boolean }) => void;
    timeout: NodeJS.Timeout;
  }>();
  const activePreviewControllers = new Map<number, AbortController>();
  const senderTokens = new Map<number, string>();
  const senderJsonTokens = new Map<number, string>();
  const senderCleanupAttached = new Set<number>();
  const pendingE2eOpenDialogPaths = [...env.e2eOpenDialogPaths];
  const pendingE2eSaveDialogPaths = [...env.e2eSaveDialogPaths];

  const consumeE2eOpenDialogPath = () => pendingE2eOpenDialogPaths.shift() ?? null;
  const consumeE2eSaveDialogPath = () => pendingE2eSaveDialogPaths.shift() ?? null;

  const runJsonImport = async <T>(
    event: Electron.IpcMainInvokeEvent,
    importFile: (signal: AbortSignal) => Promise<T>
  ): Promise<T> => {
    const senderId = event.sender.id;
    activePreviewControllers.get(senderId)?.abort();
    const controller = new AbortController();
    const abort = () => controller.abort();
    activePreviewControllers.set(senderId, controller);
    event.sender.once("destroyed", abort);
    event.sender.on("did-start-navigation", abort);

    try {
      return await importFile(controller.signal);
    } catch (error) {
      const filesystemError = error instanceof Error && (
        ("code" in error && typeof error.code === "string" && /^E[A-Z0-9]+$/.test(error.code)) ||
        ("path" in error && typeof error.path === "string") ||
        ("dest" in error && typeof error.dest === "string")
      );
      if ((error instanceof JsonDataError && error.code === "worker") || filesystemError) {
        console.error("[contacts.ipc] JSON import failed:", error);
        const message = "No se pudo procesar el archivo JSON seleccionado.";
        throw error instanceof JsonDataError ? new JsonDataError(error.code, message) : new Error(message);
      }
      throw error;
    } finally {
      event.sender.removeListener("destroyed", abort);
      event.sender.removeListener("did-start-navigation", abort);
      if (activePreviewControllers.get(senderId) === controller) {
        activePreviewControllers.delete(senderId);
      }
    }
  };

  const clearPendingCsvImport = (importToken: string, removeSnapshot = true) => {
    const pendingImport = pendingCsvImports.get(importToken);

    if (!pendingImport) {
      return;
    }

    clearTimeout(pendingImport.timeout);
    pendingCsvImports.delete(importToken);
    if (removeSnapshot) void removeImportSnapshot(pendingImport.sourceFilePath);

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

  const clearPendingJsonImport = (importToken: string, removeSnapshot = true) => {
    const pendingImport = pendingJsonImports.get(importToken);
    if (!pendingImport) return;
    clearTimeout(pendingImport.timeout);
    pendingJsonImports.delete(importToken);
    if (removeSnapshot) void removeImportSnapshot(pendingImport.sourceFilePath);
    if (senderJsonTokens.get(pendingImport.senderId) === importToken) {
      senderJsonTokens.delete(pendingImport.senderId);
    }
    try {
      pendingImport.sender.removeListener("did-start-navigation", pendingImport.navListener);
    } catch {
      // The sender may already be destroyed.
    }
  };

  const ensureSenderCleanup = (sender: WebContents) => {
    if (senderCleanupAttached.has(sender.id)) return;
    senderCleanupAttached.add(sender.id);
    sender.once("destroyed", () => {
      const csvToken = senderTokens.get(sender.id);
      const jsonToken = senderJsonTokens.get(sender.id);
      if (csvToken) clearPendingCsvImport(csvToken);
      if (jsonToken) clearPendingJsonImport(jsonToken);
      senderCleanupAttached.delete(sender.id);
    });
  };

  handle(CHANNELS.bootstrap, () => service.getBootstrapData());
  // The resolved backup path is main-process-only — no renderer caller reads
  // it (DataManagementSection awaits and discards it), so it is never
  // forwarded across the IPC boundary. (OIR-276)
  handle(CHANNELS.createBackup, async (): Promise<void> => {
    await service.createBackup();
  });
  handle(CHANNELS.resetDataset, async () => toSafeResetResult(await service.resetDataset()));
  handle(CHANNELS.recoverAuditLog, async (): Promise<void> => {
    try {
      await service.recoverAuditLog();
    } catch (error) {
      console.error("[AuditLog] Recovery failed.", error);
      throw new Error(AUDIT_LOG_RECOVERY_ERROR_MESSAGE);
    }
  });
  handle(CHANNELS.createRecord, (_event, payload: EditableContactRecord) =>
    service.createRecord(payload)
  );
  handle(CHANNELS.updateRecord, (_event, recordId: string, payload: EditableContactRecord) =>
    service.updateRecord(recordId, payload)
  );
  handle(CHANNELS.deleteRecord, (_event, recordId: string) => service.deleteRecord(recordId));
  handle(CHANNELS.listBackups, async () => (await service.listBackups()).map(toSafeBackupListItem));
  // Renderer sends a bare fileName (never an absolute path — listBackups()
  // no longer returns one). Reject anything path-shaped before it is ever
  // joined against the real backup directory, then resolve it main-process
  // side. AppDataService.restoreBackup() still re-validates the resolved
  // path is inside the backup directory (symlink/dev-ino checks) as
  // defense-in-depth. (OIR-276)
  handle(CHANNELS.restoreBackup, async (_event, backupFileName: string) => {
    if (!isSafeBackupFileName(backupFileName)) {
      throw new Error(RESTORE_BACKUP_ERROR_MESSAGE);
    }

    const canonicalBackupDirectory = await service.resolveBackupDirectory();
    const backupFilePath = path.join(canonicalBackupDirectory, backupFileName);

    return stripImportPaths(await service.restoreBackup(backupFilePath));
  });
  handle(CHANNELS.exportDataset, async (event) => {
    const e2eFilePath = consumeE2eSaveDialogPath();

    if (e2eFilePath) {
      return toSafeExportResult(await service.exportDataset(e2eFilePath));
    }

    const browserWindow = BrowserWindow.fromWebContents(event.sender);
    const warningOptions = {
      type: "warning",
      buttons: ["Cancelar", "Continuar"],
      defaultId: 0,
      cancelId: 0,
      title: "Exportar datos sensibles",
      message: "El archivo exportado contiene datos sensibles de la agenda y las buscas.",
      detail: "Guárdalo solo en una ubicación protegida y elimínalo cuando ya no sea necesario."
    } satisfies Electron.MessageBoxOptions;
    const warningResult = browserWindow
      ? await dialog.showMessageBox(browserWindow, warningOptions)
      : await dialog.showMessageBox(warningOptions);

    if (warningResult.response !== 1) {
      return null;
    }

    const saveOptions = {
      title: "Exportar datos de HospiAgenda",
      defaultPath: path.join(app.getPath("downloads"), "hospiagenda-data.json"),
      filters: [{ name: "JSON", extensions: ["json"] }]
    };
    const { canceled, filePath } = browserWindow
      ? await dialog.showSaveDialog(browserWindow, saveOptions)
      : await dialog.showSaveDialog(saveOptions);

    if (canceled || !filePath) {
      return null;
    }

    return toSafeExportResult(await service.exportDataset(filePath));
  });
  // Shared by CHANNELS.previewCsvImport and CHANNELS.pickAndImportDataset —
  // both dispatch to the same normalize/validate/preview pipeline and the same
  // importToken bookkeeping once a source file path has been resolved.
  const runCsvImportPreview = async (event: Electron.IpcMainInvokeEvent, sourceFilePath: string) => {
    const senderId = event.sender.id;
    activePreviewControllers.get(senderId)?.abort();

    const controller = new AbortController();
    let timedOut = false;
    const timeoutId = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, CSV_IMPORT_PREVIEW_TIMEOUT_MS);
    const abortOnDestroyed = () => controller.abort();
    const abortOnNavigation = (details: { isSameDocument?: boolean } | undefined) => {
      if (!details?.isSameDocument) {
        controller.abort();
      }
    };

    activePreviewControllers.set(senderId, controller);
    event.sender.once("destroyed", abortOnDestroyed);
    event.sender.on("did-start-navigation", abortOnNavigation);

    // previewCsvImport declares { sourceFilePath: string } in its return type so
    // TypeScript proves the field exists here; we destructure it out before the
    // renderer payload is assembled (no cast needed).
    let snapshot: Awaited<ReturnType<typeof createImportSnapshot>> | null = null;
    let preview;
    try {
      snapshot = await createImportSnapshot(sourceFilePath);
      if (controller.signal.aborted) {
        throw new ImportPreviewAbortError();
      }
      preview = await service.previewCsvImport(snapshot.snapshotPath, { signal: controller.signal });
    } catch (error) {
      if (snapshot) await removeImportSnapshot(snapshot.snapshotPath);
      if (error instanceof ImportPreviewAbortError || controller.signal.aborted) {
        throw new Error(
          timedOut
            ? "La preparación de la importación tardó demasiado. Vuelve a intentarlo."
            : "La preparación de la importación se canceló. Vuelve a intentarlo."
        );
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
      event.sender.removeListener("destroyed", abortOnDestroyed);
      event.sender.removeListener("did-start-navigation", abortOnNavigation);
      if (activePreviewControllers.get(senderId) === controller) {
        activePreviewControllers.delete(senderId);
      }
    }
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
    //
    // Root-cause fix: `did-start-navigation` also fires for SAME-DOCUMENT
    // navigations — reference-fragment (hash) navigations, pushState/replaceState,
    // and same-page history navigation (see Electron's `isSameDocument` docs). This
    // app uses createHashRouter for all in-app routing, so those are routine and do
    // NOT mean the import preview UI is gone — the renderer document (and the
    // DataManagementSection component holding the preview state) is still mounted.
    // A same-document navigation can be triggered by something as innocuous as a
    // macOS trackpad two-finger swipe (Chromium's overscroll history navigation)
    // while the operator scrolls the (currently non-virtualized, horizontally
    // overflowing) preview table — which would silently
    // invalidate an otherwise-still-valid, still-visible pending import and only
    // surface as an opaque error on the LATER confirm click. Only invalidate on a
    // real cross-document navigation (the tab actually left the app UI).
    const navListener = (details: { isSameDocument?: boolean } | undefined) => {
      if (details && details.isSameDocument) {
        return;
      }
      clearPendingCsvImport(importToken);
    };

    event.sender.on("did-start-navigation", navListener);

    // Defensive global cap on concurrent pending CSV imports. Normal
    // desktop single-window usage never approaches this (each sender's
    // previous token is already invalidated above), but nothing previously
    // bounded the map across ALL senders — a renderer bug or a future
    // multi-window feature repeatedly calling previewCsvImport could grow it
    // until TTLs expire. Evict the oldest pending entry (Map iteration order
    // is insertion order) before admitting a new one once the cap is hit.
    if (pendingCsvImports.size >= MAX_PENDING_CSV_IMPORTS) {
      const oldestImportToken = pendingCsvImports.keys().next().value;

      if (oldestImportToken) {
        clearPendingCsvImport(oldestImportToken);
      }
    }

    if (!snapshot) {
      throw new Error("No se pudo preparar el archivo seleccionado.");
    }
    pendingCsvImports.set(importToken, {
      sourceFilePath: snapshot.snapshotPath,
      selectedSourceFilePath: sourceFilePath,
      sourceFingerprint: snapshot.fingerprint,
      senderId,
      sender: event.sender,
      navListener,
      timeout,
      wrongSenderAttempts: 0
    });
    senderTokens.set(senderId, importToken);

    ensureSenderCleanup(event.sender);

    // Strip the absolute sourceFilePath before sending to the renderer.
    // The path is retained server-side in pendingCsvImports; the renderer
    // identifies the import by importToken only.
    const { sourceFilePath: _stripped, ...safePreview } = preview;
    const currentBeeperRecordCount = await service.getSpreadsheetImportCurrentBeeperCount();
    return {
      ...safePreview,
      currentBeeperRecordCount,
      importToken
    };
  };

  handle(CHANNELS.previewCsvImport, async (event) => {
    const e2eFilePath = consumeE2eOpenDialogPath();
    const browserWindow = BrowserWindow.fromWebContents(event.sender);
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

    return runCsvImportPreview(event, sourceFilePath);
  });

  handle(CHANNELS.cancelCsvImportPreview, (event, importToken?: string) => {
    activePreviewControllers.get(event.sender.id)?.abort();
    const pendingImport = importToken ? pendingCsvImports.get(importToken) : undefined;
    if (importToken && pendingImport && pendingImport.senderId === event.sender.id) {
      clearPendingCsvImport(importToken);
    }
  });

  // Single unified "Importar" entry point. Opens ONE native dialog
  // filtered to .json/.csv/.ods/.xls/.xlsx and internally dispatches, by the
  // extension of whatever file the user picked, to the EXISTING pipelines:
  //   .json                → preview then confirm full replacement
  //   .csv/.ods/.xls/.xlsx → runCsvImportPreview() (normalize/validate/preview, unchanged)
  // The picked file path never crosses back to the renderer — main owns the
  // dialog, main reads the file, and only the discriminated-union result
  // (or the CSV importToken, per the existing previewCsvImport contract) is
  // returned. No renderer-supplied path is ever accepted here.
  handle(CHANNELS.pickAndImportDataset, async (event) => {
    const e2eFilePath = consumeE2eOpenDialogPath();
    const browserWindow = BrowserWindow.fromWebContents(event.sender);
    const openOptions = {
      title: "Importar directorio",
      filters: [{ name: "Archivos importables", extensions: ["json", "csv", "ods", "xls", "xlsx"] }],
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
      return { kind: "cancelled" } as const;
    }

    const extension = path.extname(sourceFilePath).toLowerCase().replace(/^\./, "");

    if (extension === "json") {
      const snapshot = await createImportSnapshot(sourceFilePath);
      let parsed: JsonImportPreviewInternal;
      try {
        parsed = await runJsonImport(
          event,
          (signal) => service.previewJsonFile(snapshot.snapshotPath, { signal })
        );
      } catch (error) {
        await removeImportSnapshot(snapshot.snapshotPath);
        throw error;
      }
      const importToken = randomUUID();
      const previousImportToken = senderJsonTokens.get(event.sender.id);
      if (previousImportToken) clearPendingJsonImport(previousImportToken);
      if (pendingJsonImports.size >= MAX_PENDING_JSON_IMPORTS) {
        const oldestImportToken = pendingJsonImports.keys().next().value;
        if (oldestImportToken) clearPendingJsonImport(oldestImportToken);
      }
      let currentCounts;
      try {
        currentCounts = await service.getJsonImportCurrentCounts();
      } catch (error) {
        await removeImportSnapshot(snapshot.snapshotPath);
        throw error;
      }
      const navListener = (details: { isSameDocument?: boolean } | undefined) => {
        if (!details?.isSameDocument) clearPendingJsonImport(importToken);
      };
      event.sender.on("did-start-navigation", navListener);
      pendingJsonImports.set(importToken, {
        sourceFilePath: snapshot.snapshotPath,
        selectedSourceFilePath: sourceFilePath,
        sourceFingerprint: snapshot.fingerprint,
        parsed,
        senderId: event.sender.id,
        sender: event.sender,
        navListener,
        timeout: setTimeout(() => clearPendingJsonImport(importToken), CSV_IMPORT_TOKEN_TTL_MS)
      });
      senderJsonTokens.set(event.sender.id, importToken);
      ensureSenderCleanup(event.sender);
      const fileName = path.basename(sourceFilePath);
      if (parsed.kind === "contacts") {
        const data = parsed.data as { records: unknown[] };
        return { kind: "json-preview", preview: { importToken, fileName, detectedType: "contacts", recordCount: data.records.length, currentRecordCount: currentCounts.contacts } } as const;
      }
      if (parsed.kind === "combined") {
        const data = parsed.data as { contacts: { records: unknown[] }; beepers: { records: unknown[]; importedRecords: unknown[] } };
        return { kind: "json-preview", preview: { importToken, fileName, detectedType: "combined", recordCount: data.contacts.records.length, beeperRecordCount: data.beepers.records.length, importedBeeperRecordCount: data.beepers.importedRecords.length, currentRecordCount: currentCounts.contacts, currentBeeperRecordCount: currentCounts.beepers } } as const;
      }
      if (parsed.kind === "beepers") {
        const data = parsed.data as { records: unknown[]; importedRecords: unknown[] };
        return { kind: "json-preview", preview: { importToken, fileName, detectedType: "beepers", recordCount: data.records.length, importedBeeperRecordCount: data.importedRecords.length, currentBeeperRecordCount: currentCounts.beepers } } as const;
      }
      if (parsed.kind === "imessage-beepers") {
        const data = parsed.data as { datos: { usuarios: Array<{ textEnabled: boolean }>; equipos: unknown[] } };
        const importedBeeperRecordCount = data.datos.usuarios.filter((user) => user.textEnabled).length;
        return { kind: "json-preview", preview: { importToken, fileName, detectedType: "beepers", recordCount: 0, importedBeeperRecordCount, teamCount: data.datos.equipos.length, currentBeeperRecordCount: currentCounts.beepers } } as const;
      }
      return { kind: "json-preview", preview: { importToken, fileName, detectedType: "settings" } } as const;
    }

    if (CSV_LIKE_EXTENSIONS.has(extension)) {
      const preview = await runCsvImportPreview(event, sourceFilePath);
      return { kind: "csv-preview", preview } as const;
    }

    // Defensive fallback — the dialog filter above should prevent this, but some
    // platforms/window managers allow bypassing open-dialog filters.
    return { kind: "unsupported-extension", extension } as const;
  });
  handle(CHANNELS.confirmJsonImport, async (event, importToken: string) => {
    const pendingImport = pendingJsonImports.get(importToken);
    if (!pendingImport || event.sender.id !== pendingImport.senderId) {
      throw new Error("La importación JSON ya no es válida. Vuelve a seleccionar el archivo.");
    }
    clearPendingJsonImport(importToken, false);
    try {
      if (await sourceFingerprint(pendingImport.selectedSourceFilePath) !== pendingImport.sourceFingerprint) {
        throw new Error("El archivo seleccionado cambió después de la vista previa. Vuelve a seleccionarlo.");
      }
      const result = await service.importPreviewedJson(pendingImport.parsed, pendingImport.sourceFilePath);
      if (result.kind === "combined-import") return { kind: result.kind, result: stripCombinedImportPaths(result.result) };
      if (result.kind === "contacts-import") return { kind: result.kind, result: stripImportPaths(result.result) };
      return result;
    } catch (error) {
      if (isFilesystemError(error)) throw sourceFileAccessError();
      throw error;
    } finally {
      await removeImportSnapshot(pendingImport.sourceFilePath);
    }
  });
  handle(CHANNELS.cancelJsonImport, (event, importToken: string) => {
    const pendingImport = pendingJsonImports.get(importToken);
    if (pendingImport && pendingImport.senderId === event.sender.id) clearPendingJsonImport(importToken);
  });
  handle(CHANNELS.importCsvDataset, async (event, importToken: string, rawPolicies: unknown = []) => {
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

    // Validated via Zod (csvImportPolicySelectionListSchema) instead of
    // hand-rolled typeof/Number.isInteger/Set.has checks, consistent with
    // every other IPC input in this codebase.
    let policies;

    try {
      policies = csvImportPolicySelectionListSchema.parse(rawPolicies);
    } catch {
      throw new Error("Las políticas de conflicto no tienen un formato válido.");
    }

    // Synchronously consume the token before the first await so concurrent
    // confirmations cannot race past this point with the same token.
    clearPendingCsvImport(importToken, false);
    try {
      if (await sourceFingerprint(pendingImport.selectedSourceFilePath) !== pendingImport.sourceFingerprint) {
        throw new Error("El archivo seleccionado cambió después de la vista previa. Vuelve a seleccionarlo.");
      }
      return stripImportPaths(await service.importCsvDataset(pendingImport.sourceFilePath, policies));
    } catch (error) {
      if (isFilesystemError(error)) throw sourceFileAccessError();
      throw error;
    } finally {
      await removeImportSnapshot(pendingImport.sourceFilePath);
    }
  });

  handle(CHANNELS.detectDuplicates, async () => {
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

  handle(CHANNELS.mergeDuplicates, async (_event, rawPayload: unknown) => {
    const parsed = mergeContactsSchema.safeParse(rawPayload);

    if (!parsed.success) {
      throw new Error("Invalid merge request");
    }

    return service.mergeDuplicates(parsed.data.keepId, parsed.data.discardId, parsed.data.overrides);
  });
};

export type ContactsChannels = typeof CHANNELS;
