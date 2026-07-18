import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { ZodError } from "zod";
import { appSettingsSchema, contactRecordSchema, directoryDatasetSchema, editableAppSettingsSchema, editableContactRecordSchema } from "../../shared/schemas/contact.js";
import type { MergeContactsOverrides } from "../../shared/schemas/merge-contacts.schema.js";
import { defaultContacts } from "../../shared/fixtures/defaultContacts.js";
import { defaultSettings } from "../../shared/fixtures/defaultSettings.js";
import { buildSpreadsheetImportPreview } from "./spreadsheet-import.service.js";
import type { BuscasService } from "./buscas.service.js";
import type { CsvImportPreviewInternal } from "./csv-import.service.js";
import { AppDataAuditFacade } from "./app-data-audit.facade.js";
import type {
  AutoBackupSettings,
  AppSettings,
  BackupListItem,
  BootstrapData,
  BootstrapResult,
  ContactRecord,
  CsvImportPolicySelection,
  ConflictType,
  ConflictRecordSummary,
  ConflictedImportRecord,
  CsvImportPreviewWithConflicts,
  CsvImportResult,
  DirectoryDataset,
  EditableAppSettings,
  EditableContactRecord,
  ExportContactsResult,
  AuditLogEntry,
  AuditLogQueryParams,
  AuditLogResult,
  ImportContactsResult,
  RecoveryState,
  ResetContactsResult,
  ExportAuditLogResult,
  SaveContactResult,
  MergePolicy
} from "../../shared/types/contact.js";
import { ensureDirectory, readJsonFile, writeJsonFile } from "../utils/fs-json.js";
import { getContactsFilePath, getManagedBackupDirectory, getSettingsFilePath } from "../utils/paths.js";
import { assertPathChainIsNotSymlink, formatPathForError } from "../utils/path-safety.js";
import { formatLocationFloor, formatLocationRoom, reconcilePrimaryEntries } from "../../shared/utils/contacts.js";
import { computeMetadataCounts, normalizePhoneForDedup, normalizePhoneForMergeDedup } from "../../shared/utils/matching.js";

/**
 * Union `customFields` from both records of a duplicate-merge pair.
 *
 * - Every custom field on the kept record is preserved as-is.
 * - Any custom field on the discarded record whose `key` doesn't already
 *   exist on the kept record is appended (union, not replace).
 * - On a `key` conflict, the kept record's value wins.
 * - Returns `undefined` when neither record has any custom fields, matching
 *   the optional shape of `contactRecordSchema.customFields`.
 */
const mergeCustomFields = (
  keepFields: ContactRecord["customFields"],
  discardFields: ContactRecord["customFields"]
): ContactRecord["customFields"] => {
  if (!keepFields?.length && !discardFields?.length) {
    return undefined;
  }

  const merged = [...(keepFields ?? [])];
  const keepKeys = new Set(merged.map((field) => field.key.trim().toLowerCase()));

  for (const field of discardFields ?? []) {
    const normalizedKey = field.key.trim().toLowerCase();
    if (!keepKeys.has(normalizedKey)) {
      merged.push(field);
      keepKeys.add(normalizedKey);
    }
  }

  return merged;
};

export class AppDataService {
  private writeQueue: Promise<void> = Promise.resolve();
  private readonly auditFacade = new AppDataAuditFacade();
  private autoBackupTimer: NodeJS.Timeout | null = null;
  private autoBackupPending = false;
  private autoBackupEditCount = 0;
  private autoBackupSettings: AutoBackupSettings = defaultSettings("", "").ui.autoBackup;

  constructor(
    private readonly options: {
      onAutoBackupFailure?: (message: string) => void;
      buscasService?: BuscasService;
    } = {}
  ) {}

  private enqueueWrite<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.writeQueue.then(fn);
    this.writeQueue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  async ensureInitialFiles() {
    return this.enqueueWrite(async () => {
    const managedDefaults = this.getManagedSettingsDefaults();
    const dataDirectory = path.dirname(managedDefaults.dataFilePath);
    const backupDirectory = managedDefaults.backupDirectoryPath;
    const contactsFilePath = managedDefaults.dataFilePath;
    const settingsFilePath = getSettingsFilePath();

    await ensureDirectory(dataDirectory);
    await ensureDirectory(backupDirectory);

    if (!(await this.fileExists(contactsFilePath))) {
      await writeJsonFile(contactsFilePath, defaultContacts);
    }

    if (!(await this.fileExists(settingsFilePath))) {
      await writeJsonFile(settingsFilePath, managedDefaults);
    }
    });
  }

  async startAutoBackup() {
    const settings = await this.readSettings(true);
    this.configureAutoBackup(settings.ui.autoBackup);
  }

  /**
   * Stop the auto-backup scheduler and drain any in-flight write-queue entries.
   * Call this during app teardown (or in test afterEach) to ensure no background
   * writes race with filesystem cleanup.
   */
  async dispose() {
    if (this.autoBackupTimer) {
      clearInterval(this.autoBackupTimer);
      this.autoBackupTimer = null;
    }
    // Drain the write queue: any enqueued write that is currently in-flight will
    // complete before this resolves.  New writes enqueued after dispose() returns
    // are not prevented — callers must stop triggering operations after dispose().
    await this.writeQueue;
  }

  async getBootstrapData(): Promise<BootstrapResult> {
    await this.ensureInitialFiles();
    const settings = await this.backfillLastImportedAtFromAuditLog(await this.readSettings(true));
    const contactsFilePath = settings.dataFilePath;

    try {
      const contacts = await this.readContacts(settings);

      return { contacts, settings: this.toEditableSettings(settings) };
    } catch (error) {
      if (!this.isRecoverableContactsError(error)) {
        throw error;
      }

      return {
        recovery: this.toRecoveryState(error, contactsFilePath),
        settings: this.toEditableSettings(settings)
      };
    }
  }

  async saveSettings(settings: EditableAppSettings) {
    return this.enqueueWrite(async () => {
    const parsed = editableAppSettingsSchema.parse(settings);
    const normalizedDataFilePath = parsed.dataFilePath.trim();
    const normalizedBackupDirectoryPath = parsed.backupDirectoryPath.trim();

    if (!path.isAbsolute(normalizedDataFilePath)) {
      throw new Error("La ruta del archivo de datos debe ser absoluta.");
    }

    if (!path.isAbsolute(normalizedBackupDirectoryPath)) {
      throw new Error("La ruta de la carpeta de copias de seguridad debe ser absoluta.");
    }

    const currentSettings = await this.readSettings();
    const nextSettings = this.normalizeManagedSettingsForPersistence({
      ...currentSettings,
      editorName: parsed.editorName,
      dataFilePath: path.normalize(normalizedDataFilePath),
      backupDirectoryPath: path.normalize(normalizedBackupDirectoryPath),
      ui: parsed.ui
    });

    await this.validateEditableSettings(nextSettings, currentSettings);

    if (
      !this.pathsMatch(nextSettings.dataFilePath, currentSettings.dataFilePath) &&
      !(await this.fileExists(nextSettings.dataFilePath))
    ) {
      const currentContacts = await this.readContacts(currentSettings);
      await this.writeDatasetToPath(nextSettings.dataFilePath, currentContacts);
    }

    await writeJsonFile(getSettingsFilePath(), nextSettings);
    this.configureAutoBackup(nextSettings.ui.autoBackup, {
      forceResetEditCount: (
        !this.pathsMatch(nextSettings.dataFilePath, currentSettings.dataFilePath) ||
        !this.pathsMatch(nextSettings.backupDirectoryPath, currentSettings.backupDirectoryPath)
      )
    });
    return nextSettings;
    });
  }

  getEditableSettingsDefaults(): EditableAppSettings {
    return this.toEditableSettings(this.getManagedSettingsDefaults());
  }

  async createBackup() {
    return this.enqueueWrite(() => this.createBackupInner());
  }

  private async createBackupInner() {
    const settings = await this.readSettings(true);
    const backupFilePath = await this.createBackupCore(settings, "contacts", "No se pudo crear la copia de seguridad del directorio.");
    this.autoBackupEditCount = 0;
    // Cap the number of manual/import/restore/reset backups just like auto-backups.
    // Without this, repeated import/export/reset cycles accumulate
    // unlimited "contacts-*" backup files, each a full PII copy, with no cap —
    // a real risk on the disk-constrained USB deployment this app targets.
    // Reuses the same retentionCount knob and pruning primitive as auto-backups
    // so retention behavior stays consistent between the two backup families.
    //
    // Follow-up: pruning failures (e.g. EACCES/EBUSY on a locked backup
    // file on Windows) must NOT fail the calling operation (importDataset /
    // restoreBackup / resetDataset) — the actual backup file above was already
    // created successfully. Non-fatal: log so operators can diagnose, matching
    // the console.error convention used for the non-fatal buscas import failure
    // in importCsvDataset below.
    try {
      await this.pruneBackupsByPrefix(
        settings,
        "contacts-",
        "No se pudo rotar las copias de seguridad del directorio."
      );
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      console.error(`[BackupRetention] Failed to prune contacts-* backups — ${errMsg}`);
    }
    return backupFilePath;
  }

  /**
   * Shared primitive: generates a unique path, atomically claims it, then
   * copies the contacts file to that path.  Used by both createBackupInner
   * (manual/import/reset backups) and createAutoBackup.
   *
   * Must only be called from inside an enqueueWrite slot.
   */
  private async createBackupCore(settings: AppSettings, prefix: string, errorMessage: string) {
    const backupFilePath = await this.createBackupFilePathUnique(settings, prefix);
    // The atomic open in createBackupFilePathUnique left a 0-byte placeholder
    // at backupFilePath.  If the copy fails we must remove that placeholder so
    // it does not appear in listBackups as a valid (but empty) backup file.
    try {
      await this.copyFileWithContext(settings.dataFilePath, backupFilePath, errorMessage);
    } catch (error) {
      await fs.unlink(backupFilePath).catch(() => undefined);
      throw error;
    }
    return backupFilePath;
  }

  async listBackups(): Promise<BackupListItem[]> {
    const settings = await this.readSettings(true);
    const backupDirectory = await this.resolveCanonicalDirectoryPath(
      settings.backupDirectoryPath,
      "No se pudo leer la carpeta de copias de seguridad."
    );
    try {
      await ensureDirectory(backupDirectory);
      const entries = await fs.readdir(backupDirectory, { withFileTypes: true });
      const backupEntries = await Promise.all(
        entries
          .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
          .map(async (entry) => {
            const filePath = path.join(backupDirectory, entry.name);
            const stats = await fs.stat(filePath);

            // Skip 0-byte placeholders left by a crash between the exclusive
            // open (O_EXCL) and the copyFile completing.  Restoring an empty
            // file would crash with JSON.parse('') → SyntaxError.
            if (stats.size === 0) {
              return null;
            }

            const createdAt = stats.birthtimeMs > 1000
              ? stats.birthtime.toISOString()
              : stats.mtime.toISOString();

            return {
              fileName: entry.name,
              filePath,
              createdAt,
              sizeBytes: stats.size
            } satisfies BackupListItem;
          })
      );

      const backupFiles = backupEntries.filter((item): item is BackupListItem => item !== null);

      return backupFiles.sort((left, right) => {
        const createdAtDelta = new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();

        if (createdAtDelta !== 0) {
          return createdAtDelta;
        }

        return right.fileName.localeCompare(left.fileName);
      });
    } catch (error) {
      throw this.toFilesystemError(
        error,
        "No se pudo leer la carpeta de copias de seguridad.",
        { filePath: backupDirectory }
      );
    }
  }

  async exportDataset(targetFilePath: string): Promise<ExportContactsResult> {
    return this.enqueueWrite(async () => {
    const settings = await this.readSettings(true);
    const contacts = await this.readContacts(settings);
    const directory = path.dirname(targetFilePath);

    try {
      await ensureDirectory(directory);
      await writeJsonFile(targetFilePath, contacts);
    } catch (error) {
      throw this.toFilesystemError(
        error,
        "No se pudo exportar el directorio al destino seleccionado.",
        { filePath: targetFilePath }
      );
    }

    return {
      filePath: targetFilePath,
      exportedAt: contacts.exportedAt,
      recordCount: contacts.records.length
    };
    });
  }

  async importDataset(sourceFilePath: string): Promise<ImportContactsResult> {
    return this.enqueueWrite(async () => {
    const importedContacts = directoryDatasetSchema.parse(
      await readJsonFile<DirectoryDataset>(sourceFilePath)
    );
    const backupPath = await this.createBackupInner();
    const settings = await this.readSettings(true);
    const now = new Date().toISOString();

    await this.writeDatasetToPath(settings.dataFilePath, importedContacts);
    // Audit: non-blocking — a failed audit write does NOT roll back the contact mutation.
    // importSource is the basename only (no absolute path). No PII in the entry.
    // "dataset-replace" (not "bulk-import") because this is a wholesale JSON replacement,
    // semantically distinct from importCsvDataset which is a row-by-row merge with conflict resolution.
    await this.appendAuditEntry({
      timestamp: now,
      editor: this.getEditorName(settings),
      action: "dataset-replace",
      recordsAffected: importedContacts.records.length,
      importSource: path.basename(sourceFilePath)
    });

    const updatedSettings = await this.recordLastImportedAt(settings, now);

    return {
      contacts: importedContacts,
      settings: this.toEditableSettings(updatedSettings),
      backupPath,
      importedFilePath: sourceFilePath,
      recordCount: importedContacts.records.length
    };
    });
  }

  async restoreBackup(sourceFilePath: string): Promise<ImportContactsResult> {
    return this.enqueueWrite(async () => {
    const settings = await this.readSettings(true);
    const message = "No se pudo restaurar la copia de seguridad seleccionada.";
    const canonicalBackupDirectory = await this.resolveCanonicalDirectoryPath(
      settings.backupDirectoryPath,
      message
    );
    const canonicalSourceFilePath = await this.resolveCanonicalDataFilePath(
      sourceFilePath,
      message,
      false
    );

    this.assertPathWithinDirectory(canonicalSourceFilePath, canonicalBackupDirectory, message);

    const backupHandle = await fs.open(canonicalSourceFilePath, fsConstants.O_RDONLY);
    let importedContacts: DirectoryDataset;

    try {
      const [handleStats, pathLstat, pathStats] = await Promise.all([
        backupHandle.stat(),
        fs.lstat(canonicalSourceFilePath),
        fs.stat(canonicalSourceFilePath)
      ]);

      if (pathLstat.isSymbolicLink()) {
        throw new Error(
          `${message} Ruta afectada: ${formatPathForError(canonicalSourceFilePath)}. El archivo cambió mientras se validaba y ya no es seguro restaurarlo.`
        );
      }

      if (handleStats.dev !== pathStats.dev || handleStats.ino !== pathStats.ino) {
        throw new Error(
          `${message} Ruta afectada: ${formatPathForError(canonicalSourceFilePath)}. El archivo cambió mientras se validaba y ya no es seguro restaurarlo.`
        );
      }

      const rawContents = await backupHandle.readFile({ encoding: "utf-8" });

      // Defense-in-depth: reject empty files so a crash-orphaned 0-byte
      // placeholder never reaches JSON.parse (which would throw SyntaxError).
      if (rawContents.trim().length === 0) {
        throw new Error(
          `${message} El archivo de copia de seguridad está vacío y no puede restaurarse. Ruta afectada: ${formatPathForError(canonicalSourceFilePath)}.`
        );
      }

      importedContacts = directoryDatasetSchema.parse(JSON.parse(rawContents) as DirectoryDataset);
    } finally {
      await backupHandle.close();
    }

    const backupPath = await this.createBackupInner();
    const now = new Date().toISOString();

    await this.writeDatasetToPath(settings.dataFilePath, importedContacts);
    // Audit: non-blocking — a failed audit write does NOT roll back the contact mutation.
    // importSource is the basename only (no absolute path). No PII in the entry.
    await this.appendAuditEntry({
      timestamp: now,
      editor: this.getEditorName(settings),
      action: "restore-from-backup",
      recordsAffected: importedContacts.records.length,
      importSource: path.basename(canonicalSourceFilePath)
    });

    return {
      contacts: importedContacts,
      settings: this.toEditableSettings(settings),
      backupPath,
      importedFilePath: canonicalSourceFilePath,
      recordCount: importedContacts.records.length
    };
    });
  }

  async resetDataset(): Promise<ResetContactsResult> {
    return this.enqueueWrite(async () => {
    const settings = await this.readSettings(true);
    const contactsFilePath = settings.dataFilePath;
    const backupPath = (await this.fileExists(contactsFilePath))
      ? await this.createBackupInner()
      : null;
    const now = new Date().toISOString();
    const contacts = this.buildEmptyDataset(this.getEditorName(settings));

    await this.writeDatasetToPath(settings.dataFilePath, contacts);
    // Audit: non-blocking — a failed audit write does NOT roll back the contact mutation.
    // No PII in the entry; recordsAffected=0 reflects the resulting empty dataset.
    await this.appendAuditEntry({
      timestamp: now,
      editor: this.getEditorName(settings),
      action: "reset",
      recordsAffected: 0
    });

    return {
      contacts,
      settings: this.toEditableSettings(settings),
      backupPath
    };
    });
  }

  // Return type carries sourceFilePath so the IPC handler can destructure it out
  // at the boundary. The renderer-facing CsvImportPreviewWithConflicts
  // intentionally omits sourceFilePath; this widens it with the internal field.
  async previewCsvImport(sourceFilePath: string): Promise<CsvImportPreviewWithConflicts & { sourceFilePath: string }> {
    const settings = await this.readSettings(true);
    const { dataset, preview } = await buildSpreadsheetImportPreview(
      sourceFilePath,
      this.getEditorName(settings)
    );

    // previewCsvImport is side-effect-free: buscas are NOT persisted here.
    // Buscas are persisted only when the user confirms via importCsvDataset.

    const currentContacts = await this.readContacts(settings);
    const mergeSummary = this.mergeImportedDataset(currentContacts, dataset, this.getEditorName(settings));
    const { conflicts: conflictedRecords } = this.detectConflicts(currentContacts, dataset);

    return {
      ...preview,
      mergedRecordCount: mergeSummary.contacts.records.length,
      createdCount: mergeSummary.createdCount,
      updatedCount: mergeSummary.updatedCount,
      // Sourced from mergeSummary (not detectConflicts' own count) so it
      // stays arithmetically consistent with createdCount/updatedCount,
      // which are also derived from mergeSummary — mirrors the existing
      // createdCount/updatedCount vs conflictedRecords split (see
      // mergeImportedDataset's doc comment: it keeps its own independent
      // match index from detectConflicts).
      unchangedCount: mergeSummary.unchangedCount,
      conflictCount: conflictedRecords.length,
      conflictedRecords,
      policiesResolved: false
    };
  }

  async importCsvDataset(
    sourceFilePath: string,
    policySelections: CsvImportPolicySelection[] = []
  ): Promise<CsvImportResult> {
    return this.enqueueWrite(async () => {
    const settings = await this.readSettings(true);
    const editorName = this.getEditorName(settings);
    const { dataset, preview, buscasParseResult } = await buildSpreadsheetImportPreview(
      sourceFilePath,
      editorName
    );

    // A partially-invalid file no longer blocks the whole import. Rejected
    // rows are already excluded from `dataset` — buildImportPreviewFromRows only
    // pushes a row into `dataset.records` after it passes Zod validation via
    // contactRecordSchema.parse — so proceeding here can never persist a rejected
    // row. Rejected rows (and their existing per-row reasons in preview.rowIssues)
    // are simply skipped and reported back in the result below.

    // A buscas-only ODS has validRowCount === 0 (no contact rows) but
    // parsedCellCount > 0.  Allow that through; only reject a truly empty workbook
    // that has nothing importable at all (no valid contact rows AND no buscas
    // content). This is the one case that must still block the import.
    if (preview.validRowCount === 0 && buscasParseResult.parsedCellCount === 0) {
      throw new Error("El archivo no contiene filas válidas para importar.");
    }

    const currentContacts = await this.readContacts(settings);
    const { conflicts } = this.detectConflicts(currentContacts, dataset);
    const policies = this.resolveImportPolicies(conflicts, policySelections);
    const merged = this.mergeImportedDataset(currentContacts, dataset, editorName, policies);
    const backupPath = await this.createBackupInner();
    const now = new Date().toISOString();
    await this.writeDatasetToPath(settings.dataFilePath, merged.contacts);
    this.noteAutoBackupEligibleEdit();
    await this.appendAuditEntry({
      timestamp: now,
      editor: editorName,
      action: "bulk-import",
      recordsAffected: merged.createdCount + merged.updatedCount,
      importSource: path.basename(sourceFilePath),
      changes: {
        createdCount: { new: merged.createdCount },
        updatedCount: { new: merged.updatedCount },
        unchangedCount: { new: merged.unchangedCount },
        conflictCount: { new: conflicts.length },
        conflictPolicyCounts: { new: merged.conflictPolicyCounts }
      }
    });

    // Persist buscas records after contacts are successfully written.
    // A buscas failure must NOT roll back or suppress the contacts import result.
    if (buscasParseResult.parsedCellCount > 0 && this.options.buscasService) {
      try {
        await this.options.buscasService.importFromOds(buscasParseResult);
      } catch (err) {
        // Non-fatal: contacts import succeeded; log so operators can diagnose.
        // Surfacing to the UI would require a contract change — out of scope here.
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(`[BuscasImport] Failed to persist buscas records — ${errMsg}`);
      }
    }

    const updatedSettings = await this.recordLastImportedAt(settings, now);

    return {
      contacts: merged.contacts,
      settings: this.toEditableSettings(updatedSettings),
      backupPath,
      importedFilePath: sourceFilePath,
      recordCount: merged.contacts.records.length,
      warningCount: preview.warningCount,
      invalidRowCount: preview.invalidRowCount,
      createdCount: merged.createdCount,
      updatedCount: merged.updatedCount,
      conflictCount: conflicts.length,
      conflictPolicyCounts: merged.conflictPolicyCounts,
      // Surface the same per-row rejection reasons already computed
      // for the preview so the renderer can report exactly what was skipped.
      rowIssues: preview.rowIssues
    };
    });
  }

  async createRecord(payload: EditableContactRecord): Promise<SaveContactResult> {
    return this.enqueueWrite(async () => {
    const parsed = editableContactRecordSchema.parse(payload);
    const settings = await this.readSettings(true);
    const contacts = await this.readContacts(settings);
    const now = new Date().toISOString();
    const editorName = this.getEditorName(settings);
    const savedRecordId = this.createUniqueRecordId(contacts.records);

    const nextRecord = contactRecordSchema.parse({
      ...parsed,
      id: savedRecordId,
      contactMethods: {
        // Use the non-inventing reconciler — "Principal" must stay a
        // manual, user-editable choice; a record with zero phones/emails/
        // socials marked primary must not have one silently forced on save.
        phones: reconcilePrimaryEntries(parsed.contactMethods.phones),
        emails: reconcilePrimaryEntries(parsed.contactMethods.emails),
        socials: reconcilePrimaryEntries(parsed.contactMethods.socials)
      },
      audit: {
        createdAt: now,
        updatedAt: now,
        createdBy: editorName,
        updatedBy: editorName
      }
    });

    const nextContacts = this.buildNextDataset([nextRecord, ...contacts.records], contacts, editorName, now);
    await this.writeDatasetToPath(settings.dataFilePath, nextContacts);
    this.noteAutoBackupEligibleEdit();
    // Audit: non-blocking — a failed audit write does NOT roll back the contact mutation.
    // Only stable identifiers are logged; no PII (name, phone, email) is written.
    await this.appendAuditEntry({
      timestamp: now,
      editor: editorName,
      action: "create",
      recordId: savedRecordId,
      recordsAffected: 1
    });
    return {
      contacts: nextContacts,
      settings: this.toEditableSettings(settings),
      savedRecordId
    };
    });
  }

  async updateRecord(recordId: string, payload: EditableContactRecord): Promise<SaveContactResult> {
    return this.enqueueWrite(async () => {
    const parsed = editableContactRecordSchema.parse(payload);
    const settings = await this.readSettings(true);
    const contacts = await this.readContacts(settings);
    const now = new Date().toISOString();
    const editorName = this.getEditorName(settings);
    const recordIndex = contacts.records.findIndex((record) => record.id === recordId);

    if (recordIndex === -1) {
      throw new Error("No se encontró el registro solicitado.");
    }

    const currentRecord = contacts.records[recordIndex];
    const updatedRecord = contactRecordSchema.parse({
      ...parsed,
      id: currentRecord.id,
      source: currentRecord.source,
      contactMethods: {
        // See createRecord above — never invent a primary here.
        phones: reconcilePrimaryEntries(parsed.contactMethods.phones),
        emails: reconcilePrimaryEntries(parsed.contactMethods.emails),
        socials: reconcilePrimaryEntries(parsed.contactMethods.socials)
      },
      audit: {
        ...currentRecord.audit,
        updatedAt: now,
        updatedBy: editorName
      }
    });

    const nextRecords = contacts.records.map((record, index) =>
      index === recordIndex ? updatedRecord : record
    );
    const nextContacts = this.buildNextDataset(nextRecords, contacts, editorName, now);
    await this.writeDatasetToPath(settings.dataFilePath, nextContacts);
    this.noteAutoBackupEligibleEdit();
    // Audit: non-blocking — a failed audit write does NOT roll back the contact mutation.
    // Only stable identifiers are logged; no PII (name, phone, email) is written.
    await this.appendAuditEntry({
      timestamp: now,
      editor: editorName,
      action: "update",
      recordId: currentRecord.id,
      recordsAffected: 1
    });
    return {
      contacts: nextContacts,
      settings: this.toEditableSettings(settings),
      savedRecordId: currentRecord.id
    };
    });
  }

  async mergeDuplicates(
    keepId: string,
    discardId: string,
    overrides?: MergeContactsOverrides
  ): Promise<ContactRecord> {
    return this.enqueueWrite(async () => {
    const settings = await this.readSettings(true);
    const contacts = await this.readContacts(settings);
    const now = new Date().toISOString();
    const editorName = this.getEditorName(settings);

    const keepRecord = contacts.records.find((r) => r.id === keepId);
    const discardRecord = contacts.records.find((r) => r.id === discardId);

    if (!keepRecord) {
      throw new Error("Contact not found");
    }

    if (!discardRecord) {
      throw new Error("Contact not found");
    }

    // Normalize for deduplication: use same normalization as detector
    const normalizeEmail = (email: string): string =>
      email.trim().toLowerCase();
    const normalizeTag = (tag: string): string =>
      tag.trim().toLowerCase();

    const existingPhoneNumbers = new Set(
      keepRecord.contactMethods.phones.map((p) => normalizePhoneForMergeDedup(p.number))
    );
    const existingEmailAddresses = new Set(
      keepRecord.contactMethods.emails.map((e) => normalizeEmail(e.address))
    );
    const existingTags = new Set(
      keepRecord.tags.map((t) => normalizeTag(t))
    );

    const extraPhones = discardRecord.contactMethods.phones.filter(
      (p) => !existingPhoneNumbers.has(normalizePhoneForMergeDedup(p.number))
    );
    const extraEmails = discardRecord.contactMethods.emails.filter(
      (e) => !existingEmailAddresses.has(normalizeEmail(e.address))
    );
    const socialContentKey = (s: { platform: string; handle?: string; url?: string }): string =>
      `${s.platform}|${(s.handle ?? "").trim().toLowerCase()}|${(s.url ?? "").trim().toLowerCase()}`;
    const existingSocialKeys = new Set(
      keepRecord.contactMethods.socials.map(socialContentKey)
    );
    const extraSocials = discardRecord.contactMethods.socials.filter(
      (s) => !existingSocialKeys.has(socialContentKey(s))
    );
    const extraTags = discardRecord.tags.filter(
      (t) => !existingTags.has(normalizeTag(t))
    );
    const extraAliases = discardRecord.aliases.filter((a) => !keepRecord.aliases.includes(a));

    const mergedRecord = contactRecordSchema.parse({
      ...keepRecord,
      // Copy externalId from discard if keeper doesn't have one
      externalId: keepRecord.externalId || discardRecord.externalId,
      // Merge person data: keep keeper's, add discard's missing parts
      person: {
        firstName: keepRecord.person?.firstName || discardRecord.person?.firstName,
        lastName: keepRecord.person?.lastName || discardRecord.person?.lastName
      },
      // Merge organization: keep keeper's, add discard's missing parts
      organization: {
        department: keepRecord.organization.department || discardRecord.organization.department,
        service: keepRecord.organization.service || discardRecord.organization.service,
        area: keepRecord.organization.area || discardRecord.organization.area,
        specialty: keepRecord.organization.specialty || discardRecord.organization.specialty,
        // Role/schedule were previously dropped entirely when the
        // keeper lacked them — fill in from the discarded record instead.
        role: keepRecord.organization.role || discardRecord.organization.role,
        schedule: keepRecord.organization.schedule || discardRecord.organization.schedule
      },
      // Merge location field-by-field instead of all-or-nothing —
      // a keeper that already has a location object but is missing a
      // subfield (e.g. sector/section) should still inherit it from the
      // discarded record's location.
      location:
        keepRecord.location || discardRecord.location
          ? {
              building: keepRecord.location?.building || discardRecord.location?.building,
              floor: keepRecord.location?.floor || discardRecord.location?.floor,
              room: keepRecord.location?.room || discardRecord.location?.room,
              text: keepRecord.location?.text || discardRecord.location?.text,
              sector: keepRecord.location?.sector || discardRecord.location?.sector,
              section: keepRecord.location?.section || discardRecord.location?.section
            }
          : undefined,
      // Union customFields from both records; kept record wins on
      // key conflicts.
      customFields: mergeCustomFields(keepRecord.customFields, discardRecord.customFields),
      // Merge contact methods with deduplication
      contactMethods: {
        // Never invent a primary when merging duplicates.
        phones: reconcilePrimaryEntries([...keepRecord.contactMethods.phones, ...extraPhones]),
        emails: reconcilePrimaryEntries([...keepRecord.contactMethods.emails, ...extraEmails]),
        socials: reconcilePrimaryEntries([...keepRecord.contactMethods.socials, ...extraSocials])
      },
      // Merge aliases
      aliases: [...keepRecord.aliases, ...extraAliases],
      // Merge tags
      tags: [...keepRecord.tags, ...extraTags],
      // Copy notes from discard if keeper doesn't have any
      notes: keepRecord.notes || discardRecord.notes,
      // Copy source metadata from discard if keeper doesn't have one
      source: keepRecord.source || discardRecord.source,
      // Keep keeper's status
      status: keepRecord.status,
      // Update audit trail
      audit: {
        ...keepRecord.audit,
        updatedAt: now,
        updatedBy: editorName
      }
    });

    // Apply user-supplied field overrides on top of the automatic
    // keep/discard merge result, AFTER the merge logic above has already run.
    // Explicit edits win over whatever the automatic union produced. Only the
    // top-level keys actually present in `overrides` are replaced; anything
    // omitted keeps the value `mergedRecord` already computed above.
    const finalRecord = overrides
      ? contactRecordSchema.parse({
          ...mergedRecord,
          ...(overrides.displayName !== undefined ? { displayName: overrides.displayName } : {}),
          ...(overrides.type !== undefined ? { type: overrides.type } : {}),
          ...(overrides.externalId !== undefined ? { externalId: overrides.externalId } : {}),
          ...(overrides.person !== undefined
            ? { person: { ...mergedRecord.person, ...overrides.person } }
            : {}),
          ...(overrides.organization !== undefined
            ? { organization: { ...mergedRecord.organization, ...overrides.organization } }
            : {}),
          ...(overrides.location !== undefined
            ? { location: { ...mergedRecord.location, ...overrides.location } }
            : {}),
          ...(overrides.contactMethods !== undefined
            ? {
                contactMethods: {
                  phones: reconcilePrimaryEntries(
                    overrides.contactMethods.phones ?? mergedRecord.contactMethods.phones
                  ),
                  emails: reconcilePrimaryEntries(
                    overrides.contactMethods.emails ?? mergedRecord.contactMethods.emails
                  ),
                  socials: reconcilePrimaryEntries(
                    overrides.contactMethods.socials ?? mergedRecord.contactMethods.socials
                  )
                }
              }
            : {}),
          ...(overrides.aliases !== undefined ? { aliases: overrides.aliases } : {}),
          ...(overrides.tags !== undefined ? { tags: overrides.tags } : {}),
          ...(overrides.notes !== undefined ? { notes: overrides.notes } : {})
        })
      : mergedRecord;

    const nextRecords = contacts.records
      .filter((r) => r.id !== discardId)
      .map((r) => (r.id === keepId ? finalRecord : r));

    const nextContacts = this.buildNextDataset(nextRecords, contacts, editorName, now);
    await this.writeDatasetToPath(settings.dataFilePath, nextContacts);
    this.noteAutoBackupEligibleEdit();
    // Audit: non-blocking — a failed audit write does NOT roll back the contact mutation.
    // Only stable identifiers are logged; no PII (name, phone, email) is written.
    // recordId = kept record; changes.discardedId records which record was removed.
    await this.appendAuditEntry({
      timestamp: now,
      editor: editorName,
      action: "update",
      recordId: keepId,
      recordsAffected: 1,
      changes: { discardedId: { old: discardId, new: null } }
    });

    return finalRecord;
    });
  }

  private async fileExists(filePath: string) {
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  // Public because settings.ipc.ts calls service.toEditableSettings() directly.
  toEditableSettings(settings: AppSettings): EditableAppSettings {
    return {
      editorName: settings.editorName,
      dataFilePath: settings.dataFilePath,
      backupDirectoryPath: settings.backupDirectoryPath,
      ui: settings.ui,
      lastImportedAt: settings.lastImportedAt
    };
  }

  /**
   * Persists the "last import" watermark shown in the app header.
   * Only called from importDataset / importCsvDataset — restoring an internal
   * backup or editing a single record does not count as "importing a file".
   * Reuses the standard atomic writeJsonFile path (dual-fsync); no parallel
   * write mechanism is introduced.
   */
  private async recordLastImportedAt(settings: AppSettings, timestamp: string): Promise<AppSettings> {
    const nextSettings: AppSettings = { ...settings, lastImportedAt: timestamp };
    await writeJsonFile(getSettingsFilePath(), nextSettings);
    return nextSettings;
  }

  /**
   * One-time backfill for datasets that were imported before
   * lastImportedAt existed. If the current settings have no lastImportedAt,
   * check the audit log for a historical "bulk-import" or "dataset-replace"
   * entry (both are written by importCsvDataset / importDataset respectively)
   * and, if one exists, persist the most recent such timestamp as
   * lastImportedAt so the header watermark can show it going forward.
   *
   * If the audit log has no such entry (e.g. the dataset predates audit
   * logging, or the log was reset), lastImportedAt is intentionally left
   * unset — we never fabricate a timestamp. The user only sees the watermark
   * after their next real import.
   *
   * Best-effort: any audit-log read failure (including a quarantined/corrupt
   * log) must not block bootstrap, so failures here are swallowed.
   */
  private async backfillLastImportedAtFromAuditLog(settings: AppSettings): Promise<AppSettings> {
    if (settings.lastImportedAt) {
      return settings;
    }

    try {
      const [bulkImportResult, datasetReplaceResult] = await Promise.all([
        this.auditFacade.getAuditLog({ action: "bulk-import" }),
        this.auditFacade.getAuditLog({ action: "dataset-replace" })
      ]);

      const candidateTimestamps = [bulkImportResult.entries[0]?.timestamp, datasetReplaceResult.entries[0]?.timestamp]
        .filter((timestamp): timestamp is string => Boolean(timestamp))
        .sort();
      const latestTimestamp = candidateTimestamps[candidateTimestamps.length - 1];

      if (!latestTimestamp) {
        return settings;
      }

      // Route the write through the shared write queue and re-read the
      // settings snapshot immediately before persisting. `settings` above was
      // read before the audit-log lookup, so writing it back directly here
      // (outside the queue) could race a concurrent saveSettings()/import and
      // clobber fields that operation changed with this stale snapshot.
      return await this.enqueueWrite(async () => {
        const latestSettings = await this.readSettings(true);
        if (latestSettings.lastImportedAt) {
          // A concurrent operation already set it (e.g. a real import
          // completed while this backfill was queued) — don't overwrite it
          // with our older best-effort guess.
          return latestSettings;
        }
        return await this.recordLastImportedAt(latestSettings, latestTimestamp);
      });
    } catch {
      return settings;
    }
  }

  private async readContacts(settings: AppSettings) {
    const canonicalFilePath = await this.resolveCanonicalDataFilePath(
      settings.dataFilePath,
      "No se pudo leer el archivo de datos configurado.",
      false
    );

    return directoryDatasetSchema.parse(
      await readJsonFile<DirectoryDataset>(canonicalFilePath)
    );
  }

  private createBackupSuffix() {
    return globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 6);
  }

  private async createBackupFilePathUnique(settings: AppSettings, prefix: string) {
    const backupDirectory = await this.resolveCanonicalDirectoryPath(
      settings.backupDirectoryPath,
      "No se pudo preparar la carpeta de copias de seguridad del directorio."
    );
    try {
      await ensureDirectory(backupDirectory);
    } catch (error) {
      throw this.toFilesystemError(
        error,
        "No se pudo preparar la carpeta de copias de seguridad del directorio.",
        { filePath: backupDirectory }
      );
    }

    const maxAttempts = 5;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      // Regenerate both timestamp and suffix on every attempt so that two
      // concurrent callers hitting the same millisecond can't race: the
      // O_CREAT|O_EXCL open is the atomic claim — whoever wins the open owns
      // the file name.
      const safeTimestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const suffix = this.createBackupSuffix();
      const candidatePath = path.join(backupDirectory, `${prefix}-${safeTimestamp}-${suffix}.json`);

      let fileHandle: fs.FileHandle | undefined;

      try {
        // 'wx' = O_CREAT | O_EXCL | O_WRONLY — fails with EEXIST if the file
        // already exists.  On success we atomically own this path.
        fileHandle = await fs.open(candidatePath, "wx");
        // Close immediately; the subsequent copyFile will overwrite the empty
        // placeholder we just created (which is safe because we hold the name).
        await fileHandle.close();
        return candidatePath;
      } catch (error) {
        await fileHandle?.close().catch(() => undefined);
        const errno = this.getErrnoException(error);
        if (errno?.code === "EEXIST") {
          // Name already taken — retry with a fresh timestamp + suffix.
          continue;
        }
        // Any other error (EACCES, ENOSPC, …) — surface it.
        throw this.toFilesystemError(
          error,
          "No se pudo preparar la carpeta de copias de seguridad del directorio.",
          { filePath: candidatePath }
        );
      }
    }

    throw new Error(
      `No se pudo generar un nombre único para la copia de seguridad después de ${maxAttempts} intentos.`
    );
  }

  private async readSettings(validatePaths = false) {
    const settings = await this.rebaseManagedSettingsToCurrentRoot(
      appSettingsSchema.parse(
        await readJsonFile<AppSettings>(getSettingsFilePath())
      )
    );

    if (validatePaths) {
      await this.assertPersistedSettingsSafe(settings);
    }

    return settings;
  }

  private async rebaseManagedSettingsToCurrentRoot(settings: AppSettings) {
    const managedDefaults = this.getManagedSettingsDefaults();
    const normalizedSettings = await this.normalizeManagedSettingsFromPersistence(settings);
    const rebasedSettings = {
      ...normalizedSettings,
      dataFilePath: normalizedSettings.managedPaths?.dataFilePath
        ? managedDefaults.dataFilePath
        : normalizedSettings.dataFilePath,
      backupDirectoryPath: normalizedSettings.managedPaths?.backupDirectoryPath
        ? managedDefaults.backupDirectoryPath
        : normalizedSettings.backupDirectoryPath
    };

    if (
      !this.pathsMatch(rebasedSettings.dataFilePath, settings.dataFilePath) ||
      !this.pathsMatch(rebasedSettings.backupDirectoryPath, settings.backupDirectoryPath) ||
      normalizedSettings.managedPaths?.dataFilePath !== settings.managedPaths?.dataFilePath ||
      normalizedSettings.managedPaths?.backupDirectoryPath !== settings.managedPaths?.backupDirectoryPath
    ) {
      await writeJsonFile(getSettingsFilePath(), rebasedSettings);
    }

    return rebasedSettings;
  }

  private async normalizeManagedSettingsFromPersistence(settings: AppSettings) {
    const managedDefaults = this.getManagedSettingsDefaults();
    const inferredLegacyManagedPaths = await this.inferLegacyManagedPaths(settings);

    return {
      ...settings,
      managedPaths: {
        dataFilePath: settings.managedPaths?.dataFilePath ??
          inferredLegacyManagedPaths?.dataFilePath ??
          this.pathsMatch(settings.dataFilePath, managedDefaults.dataFilePath),
        backupDirectoryPath: settings.managedPaths?.backupDirectoryPath ??
          inferredLegacyManagedPaths?.backupDirectoryPath ??
          this.pathsMatch(settings.backupDirectoryPath, managedDefaults.backupDirectoryPath)
      }
    };
  }

  private normalizeManagedSettingsForPersistence(settings: AppSettings) {
    const managedDefaults = this.getManagedSettingsDefaults();

    return {
      ...settings,
      managedPaths: {
        dataFilePath: this.pathsMatch(settings.dataFilePath, managedDefaults.dataFilePath),
        backupDirectoryPath: this.pathsMatch(settings.backupDirectoryPath, managedDefaults.backupDirectoryPath)
      }
    };
  }

  private getManagedSettingsDefaults(): AppSettings {
    return defaultSettings(getContactsFilePath(), getManagedBackupDirectory());
  }

  private async inferLegacyManagedPaths(settings: AppSettings) {
    if (settings.managedPaths) {
      return null;
    }

    const legacyDataDirectory = path.dirname(settings.dataFilePath);
    const legacyManagedRoot = path.dirname(legacyDataDirectory);
    const currentManagedRoot = path.dirname(path.dirname(this.getManagedSettingsDefaults().dataFilePath));
    const legacyRootName = path.basename(legacyManagedRoot).toLowerCase();

    if (
      path.basename(settings.dataFilePath).toLowerCase() !== "contacts.json" ||
      path.basename(legacyDataDirectory).toLowerCase() !== "data" ||
      path.basename(settings.backupDirectoryPath).toLowerCase() !== "backups" ||
      !["win", "linux", "mac"].includes(legacyRootName) ||
      legacyRootName !== path.basename(currentManagedRoot).toLowerCase() ||
      !this.pathsMatch(path.dirname(settings.backupDirectoryPath), legacyManagedRoot)
    ) {
      return null;
    }

    if (
      await this.fileExists(settings.dataFilePath) ||
      await this.fileExists(settings.backupDirectoryPath)
    ) {
      return null;
    }

    return {
      dataFilePath: true,
      backupDirectoryPath: true
    };
  }

  private pathsMatch(leftPath: string, rightPath: string) {
    const normalizeForComparison = (filePath: string) => {
      const resolvedPath = path.resolve(filePath);
      return process.platform === "win32" || process.platform === "darwin"
        ? resolvedPath.toLowerCase()
        : resolvedPath;
    };

    return normalizeForComparison(leftPath) === normalizeForComparison(rightPath);
  }

  private async assertPersistedSettingsSafe(settings: AppSettings) {
    if (!path.isAbsolute(settings.dataFilePath)) {
      throw new Error("La ruta del archivo de datos configurada debe ser absoluta.");
    }

    if (!path.isAbsolute(settings.backupDirectoryPath)) {
      throw new Error("La ruta de la carpeta de copias de seguridad configurada debe ser absoluta.");
    }

    await this.assertPathChainIsNotSymlink(
      settings.dataFilePath,
      "No se pudo validar la ruta del archivo de datos configurada.",
      true
    );
    await this.assertPathChainIsNotSymlink(
      settings.backupDirectoryPath,
      "No se pudo validar la carpeta de copias de seguridad configurada."
    );
  }

  private async validateEditableSettings(settings: AppSettings, currentSettings: AppSettings) {
    const settingsFilePath = getSettingsFilePath();

    if (this.pathsMatch(settings.dataFilePath, settingsFilePath)) {
      throw new Error(
        `La ruta de datos no puede apuntar al archivo de configuración. Ruta afectada: ${formatPathForError(settings.dataFilePath)}. Usa un archivo JSON independiente para los contactos o restablece las rutas gestionadas.`
      );
    }

    await this.assertPathChainIsNotSymlink(
      settings.dataFilePath,
      "No se pudo validar la ruta del archivo de datos.",
      true
    );
    await this.assertPathChainIsNotSymlink(
      settings.backupDirectoryPath,
      "No se pudo validar la carpeta de copias de seguridad."
    );

    if (path.extname(settings.dataFilePath).toLowerCase() !== ".json") {
      throw new Error(
        `La ruta de datos debe terminar en .json. Ruta afectada: ${formatPathForError(settings.dataFilePath)}.`
      );
    }

    await this.assertParentDirectoryWritable(
      settings.dataFilePath,
      "No se pudo validar la ruta del archivo de datos."
    );
    await this.assertDataFilePathAvailable(
      settings.dataFilePath,
      "No se pudo validar la ruta del archivo de datos.",
      this.pathsMatch(settings.dataFilePath, currentSettings.dataFilePath) ||
        (
          this.pathsMatch(settings.dataFilePath, this.getManagedSettingsDefaults().dataFilePath) &&
          await this.fileExists(settings.dataFilePath)
        )
    );
    await this.assertExistingWritableDirectory(
      settings.backupDirectoryPath,
      "No se pudo validar la carpeta de copias de seguridad."
    );
    await this.assertDataFilePathSafe(
      settings.dataFilePath,
      "No se pudo validar la ruta del archivo de datos.",
      true
    );
  }

  private async assertParentDirectoryWritable(filePath: string, message: string) {
    const directoryPath = path.dirname(filePath);

    try {
      const stats = await fs.stat(directoryPath);

      if (!stats.isDirectory()) {
        throw new Error("not-directory");
      }

      await fs.access(directoryPath, fsConstants.R_OK | fsConstants.W_OK);
    } catch (error) {
      throw this.toFilesystemError(error, message, { filePath: directoryPath });
    }
  }

  private async assertExistingWritableDirectory(directoryPath: string, message: string) {
    try {
      const stats = await fs.stat(directoryPath);

      if (!stats.isDirectory()) {
        throw new Error("not-directory");
      }

      await fs.access(directoryPath, fsConstants.R_OK | fsConstants.W_OK);
    } catch (error) {
      throw this.toFilesystemError(error, message, { filePath: directoryPath });
    }
  }

  private async assertPathChainIsNotSymlink(targetPath: string, message: string, allowMissingLeaf = false) {
    await assertPathChainIsNotSymlink(targetPath, message, allowMissingLeaf);
  }

  private async assertDataFilePathSafe(filePath: string, message: string, allowMissing: boolean) {
    await this.assertPathChainIsNotSymlink(filePath, message, allowMissing);

    if (!(await this.fileExists(filePath))) {
      if (allowMissing) {
        return;
      }

      throw this.toFilesystemError(
        Object.assign(new Error("ENOENT"), { code: "ENOENT", path: filePath }),
        message,
        { filePath }
      );
    }

  }

  private async assertBackupDirectorySafe(directoryPath: string, message: string) {
    await this.assertPathChainIsNotSymlink(directoryPath, message);
  }

  private async writeDatasetToPath(filePath: string, dataset: DirectoryDataset): Promise<void> {
    const canonicalFilePath = await this.resolveCanonicalDataFilePath(
      filePath,
      "No se pudo escribir el archivo de datos configurado.",
      true
    );
    try {
      await writeJsonFile(canonicalFilePath, dataset);
    } catch (error) {
      throw this.toFilesystemError(
        error,
        "No se pudo escribir el archivo de datos configurado.",
        { filePath: canonicalFilePath }
      );
    }
  }

  private configureAutoBackup(
    settings: AutoBackupSettings,
    options: { forceResetEditCount?: boolean } = {}
  ) {
    const shouldResetEditCount = (
      options.forceResetEditCount ||
      !settings.enabled ||
      settings.trigger !== "editCount" ||
      !this.autoBackupSettings.enabled ||
      this.autoBackupSettings.trigger !== "editCount" ||
      this.autoBackupSettings.editCountThreshold !== settings.editCountThreshold
    );

    this.autoBackupSettings = settings;
    if (shouldResetEditCount) {
      this.autoBackupEditCount = 0;
    }

    if (this.autoBackupTimer) {
      clearInterval(this.autoBackupTimer);
      this.autoBackupTimer = null;
    }

    if (!settings.enabled) {
      return;
    }

    if (settings.trigger === "launch") {
      this.runAutoBackupInBackground();
      return;
    }

    if (settings.trigger === "intervalHours") {
      this.autoBackupTimer = setInterval(() => {
        this.runAutoBackupInBackground();
      }, settings.intervalHours * 60 * 60 * 1000);
    }
  }

  private noteAutoBackupEligibleEdit() {
    if (!this.autoBackupSettings.enabled || this.autoBackupSettings.trigger !== "editCount") {
      return;
    }

    this.autoBackupEditCount += 1;

    if (this.autoBackupEditCount < this.autoBackupSettings.editCountThreshold) {
      return;
    }

    this.runAutoBackupInBackground({ resetEditCountOnSuccess: true });
  }

  private runAutoBackupInBackground(options: { resetEditCountOnSuccess?: boolean } = {}) {
    if (!this.autoBackupSettings.enabled || this.autoBackupPending) {
      return;
    }

    this.autoBackupPending = true;

    void this.enqueueWrite(async () => {
      try {
        await this.createAutoBackup();
        if (options.resetEditCountOnSuccess) {
          this.autoBackupEditCount = 0;
        }
      } catch (error) {
        if (options.resetEditCountOnSuccess) {
          this.autoBackupEditCount = Math.max(
            this.autoBackupEditCount,
            this.autoBackupSettings.editCountThreshold
          );
        }
        const message = error instanceof Error
          ? error.message
          : "No se pudo crear la copia de seguridad automática.";
        this.options.onAutoBackupFailure?.(message);
      } finally {
        this.autoBackupPending = false;
      }
    });
  }

  private async createAutoBackup() {
    const settings = await this.readSettings(true);
    // Delegates to the shared createBackupCore primitive (which calls
    // createBackupFilePathUnique + copyFileWithContext) instead of duplicating
    // that logic here.  This ensures the two code paths can never diverge.
    await this.createBackupCore(settings, "auto-backup", "No se pudo crear la copia de seguridad automática del directorio.");
    await this.pruneBackupsByPrefix(
      settings,
      "auto-backup-",
      "No se pudo rotar las copias de seguridad automáticas del directorio."
    );
  }

  /**
   * Shared retention primitive: keeps only the `settings.ui.autoBackup.retentionCount`
   * most recent backup files whose name starts with `filePrefix`, deleting the rest.
   * Used both for automatic backups ("auto-backup-") and for manual/import/restore/
   * reset backups ("contacts-") so the two backup families share a single
   * retention cap instead of drifting apart.
   */
  private async pruneBackupsByPrefix(settings: AppSettings, filePrefix: string, pruneErrorMessage: string) {
    const backupDirectory = await this.resolveCanonicalDirectoryPath(
      settings.backupDirectoryPath,
      "No se pudo preparar la carpeta de copias de seguridad del directorio."
    );

    try {
      const entries = await fs.readdir(backupDirectory, { withFileTypes: true });
      const prefixedBackupFiles = (
        await Promise.all(
          entries
            .filter((entry) => entry.isFile() && entry.name.startsWith(filePrefix) && entry.name.endsWith(".json"))
            .map(async (entry) => {
              const filePath = path.join(backupDirectory, entry.name);

              try {
                const stats = await fs.stat(filePath);

                return {
                  filePath,
                  createdAt: stats.birthtimeMs > 1000 ? stats.birthtimeMs : stats.mtimeMs
                };
              } catch (error) {
                const filesystemError = this.getErrnoException(error);

                if (filesystemError?.code === "ENOENT") {
                  return null;
                }

                throw this.toFilesystemError(error, pruneErrorMessage, { filePath });
              }
            })
        )
      ).filter((entry): entry is { filePath: string; createdAt: number } => entry !== null);

      prefixedBackupFiles.sort((left, right) => right.createdAt - left.createdAt);

      await Promise.all(
        prefixedBackupFiles
          .slice(settings.ui.autoBackup.retentionCount)
          .map(async (entry) => {
            try {
              await fs.unlink(entry.filePath);
            } catch (error) {
              const filesystemError = this.getErrnoException(error);

              if (filesystemError?.code === "ENOENT") {
                return;
              }

              throw this.toFilesystemError(error, pruneErrorMessage, { filePath: entry.filePath });
            }
          })
      );
    } catch (error) {
      throw this.toFilesystemError(error, pruneErrorMessage, { filePath: backupDirectory });
    }
  }

  private async resolveCanonicalDataFilePath(filePath: string, message: string, allowMissing: boolean) {
    await this.assertPathChainIsNotSymlink(filePath, message, true);

    const canonicalParentPath = await this.resolveCanonicalDirectoryPath(path.dirname(filePath), message);

    if (!(await this.fileExists(filePath))) {
      if (allowMissing) {
        return path.join(canonicalParentPath, path.basename(filePath));
      }

      throw this.toFilesystemError(
        Object.assign(new Error("ENOENT"), { code: "ENOENT", path: filePath }),
        message,
        { filePath }
      );
    }

    try {
      return await fs.realpath(filePath);
    } catch (error) {
      throw this.toFilesystemError(error, message, { filePath });
    }
  }

  private async resolveCanonicalDirectoryPath(directoryPath: string, message: string) {
    await this.assertBackupDirectorySafe(directoryPath, message);

    try {
      return await fs.realpath(directoryPath);
    } catch (error) {
      throw this.toFilesystemError(error, message, { filePath: directoryPath });
    }
  }

  private assertPathWithinDirectory(filePath: string, directoryPath: string, message: string) {
    const relativePath = path.relative(directoryPath, filePath);

    if (relativePath === "" || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
      throw new Error(
        `${message} Ruta afectada: ${formatPathForError(filePath)}. El archivo debe estar dentro de la carpeta de copias de seguridad configurada.`
      );
    }
  }

  private async assertDataFilePathAvailable(filePath: string, message: string, allowExisting: boolean) {
    try {
      const stats = await fs.stat(filePath);

      if (stats.isDirectory()) {
        throw new Error("is-directory");
      }

      throw new Error("file-exists");
    } catch (error) {
      const filesystemError = this.getErrnoException(error);

      if (filesystemError?.code === "ENOENT") {
        return;
      }

      if (error instanceof Error && error.message === "file-exists" && allowExisting) {
        return;
      }

      if (error instanceof Error && error.message === "file-exists") {
        throw new Error(
          `${message} Ruta afectada: ${formatPathForError(filePath)}. Ya existe un archivo en esa ruta. Usa una ruta nueva para copiar el directorio actual o restablece las rutas gestionadas.`
        );
      }

      if (error instanceof Error && error.message === "is-directory") {
        throw new Error(
          `${message} Ruta afectada: ${formatPathForError(filePath)}. La ruta de datos debe apuntar a un archivo JSON, no a una carpeta.`
        );
      }

      throw this.toFilesystemError(error, message, { filePath });
    }
  }

  private buildNextDataset(
    records: ContactRecord[],
    currentDataset: DirectoryDataset,
    editorName: string,
    exportedAt: string
  ): DirectoryDataset {
    const { typeCounts, areaCounts } = computeMetadataCounts(records);

    return directoryDatasetSchema.parse({
      ...currentDataset,
      exportedAt,
      metadata: {
        ...currentDataset.metadata,
        recordCount: records.length,
        editorName,
        typeCounts,
        areaCounts
      },
      records
    });
  }

  private mergeImportedDataset(
    currentDataset: DirectoryDataset,
    importedDataset: DirectoryDataset,
    editorName: string,
    conflictPolicies: Map<number, MergePolicy> = new Map()
  ) {
    const exportedAt = new Date().toISOString();
    const mergedRecords = [...currentDataset.records];
    const currentIndexesByExternalId = new Map<string, number>();
    const currentIndexesByStableKey = new Map<string, number>();

    mergedRecords.forEach((record, index) => {
      if (record.externalId && !currentIndexesByExternalId.has(record.externalId)) {
        currentIndexesByExternalId.set(record.externalId, index);
      }

      for (const stableKey of this.buildStableMergeKeys(record)) {
        if (!currentIndexesByStableKey.has(stableKey)) {
          currentIndexesByStableKey.set(stableKey, index);
        }
      }
    });

    let createdCount = 0;
    let updatedCount = 0;
    let unchangedCount = 0;
    const conflictPolicyCounts: Partial<Record<MergePolicy, number>> = {};

    for (const [importRecordIndex, importedRecord] of importedDataset.records.entries()) {
      const externalIdMatchIndex = importedRecord.externalId
        ? currentIndexesByExternalId.get(importedRecord.externalId)
        : undefined;
      const stableMatchIndex = this.buildStableMergeKeys(importedRecord)
        .map((stableKey) => currentIndexesByStableKey.get(stableKey))
        .find((index): index is number => index !== undefined);
      const matchIndex = externalIdMatchIndex ?? stableMatchIndex;

      if (matchIndex !== undefined) {
        // A matched row that is already field-for-field identical (ignoring
        // id/audit) to what's stored is a genuine no-op — never write it,
        // never bump audit timestamps, and don't count it as an "update".
        // This fast path only applies when the row was NOT surfaced as a
        // conflict in detectConflicts (i.e. it has no entry in
        // conflictPolicies): detectConflicts already proved those rows differ
        // from the ORIGINAL currentDataset, so a user policy was chosen and
        // must always be honored. Without this guard, an earlier row in the
        // same import batch that updates `mergedRecords[matchIndex]` in place
        // can make a later, still-unresolved conflict row look identical to
        // the (already-mutated) in-progress record, which would silently
        // skip applying the user's selected policy and under-report
        // conflictPolicyCounts/audit for that row.
        const hasSelectedPolicy = conflictPolicies.has(importRecordIndex);
        if (!hasSelectedPolicy && this.areMeaningfulFieldsIdentical(mergedRecords[matchIndex]!, importedRecord)) {
          unchangedCount += 1;
          continue;
        }

        const selectedPolicy = conflictPolicies.get(importRecordIndex) ?? "overwrite";
        conflictPolicyCounts[selectedPolicy] = (conflictPolicyCounts[selectedPolicy] ?? 0) + 1;

        if (selectedPolicy === "skip") {
          continue;
        }

        const currentRecord = mergedRecords[matchIndex]!;
        const mergedRecord = selectedPolicy === "merge-fields"
          ? this.mergeImportedRecordFields(currentRecord, importedRecord, exportedAt, editorName)
          : contactRecordSchema.parse({
            ...importedRecord,
            id: currentRecord.id,
            audit: {
              ...currentRecord.audit,
              updatedAt: exportedAt,
              updatedBy: editorName
            }
          });
        mergedRecords[matchIndex] = mergedRecord;

        if (mergedRecord.externalId && !currentIndexesByExternalId.has(mergedRecord.externalId)) {
          currentIndexesByExternalId.set(mergedRecord.externalId, matchIndex);
        }

        for (const stableKey of this.buildStableMergeKeys(mergedRecord)) {
          if (!currentIndexesByStableKey.has(stableKey)) {
            currentIndexesByStableKey.set(stableKey, matchIndex);
          }
        }

        updatedCount += 1;
        continue;
      }

      const createdRecord = contactRecordSchema.parse({
        ...importedRecord,
        id: this.createUniqueRecordId(mergedRecords),
        audit: {
          createdAt: exportedAt,
          updatedAt: exportedAt,
          createdBy: editorName,
          updatedBy: editorName
        }
      });
      mergedRecords.push(createdRecord);
      const createdIndex = mergedRecords.length - 1;

      if (createdRecord.externalId && !currentIndexesByExternalId.has(createdRecord.externalId)) {
        currentIndexesByExternalId.set(createdRecord.externalId, createdIndex);
      }

      for (const stableKey of this.buildStableMergeKeys(createdRecord)) {
        if (!currentIndexesByStableKey.has(stableKey)) {
          currentIndexesByStableKey.set(stableKey, createdIndex);
        }
      }

      createdCount += 1;
    }

    return {
      contacts: this.buildNextDataset(mergedRecords, currentDataset, editorName, exportedAt),
      createdCount,
      updatedCount,
      unchangedCount,
      conflictPolicyCounts
    };
  }

  private resolveImportPolicies(
    conflicts: ConflictedImportRecord[],
    policySelections: CsvImportPolicySelection[]
  ): Map<number, MergePolicy> {
    const conflictIndexes = new Set(conflicts.map((conflict) => conflict.recordIndex));
    const policies = new Map<number, MergePolicy>();

    for (const selection of policySelections) {
      if (!conflictIndexes.has(selection.recordIndex)) {
        throw new Error("Hay políticas de conflicto para filas que ya no tienen conflicto. Vuelve a preparar la importación.");
      }
      policies.set(selection.recordIndex, selection.policy);
    }

    const unresolved = conflicts.filter((conflict) => !policies.has(conflict.recordIndex));
    if (unresolved.length > 0) {
      throw new Error("Resuelve todos los conflictos antes de importar.");
    }

    return policies;
  }

  private mergeImportedRecordFields(
    currentRecord: ContactRecord,
    importedRecord: ContactRecord,
    exportedAt: string,
    editorName: string
  ): ContactRecord {
    const hasEmail = new Set(currentRecord.contactMethods.emails.map((email) => email.address.trim().toLowerCase()));
    const socialMergeKey = (s: { platform: string; handle?: string; url?: string }): string =>
      `${s.platform}|${(s.handle ?? "").trim().toLowerCase()}|${(s.url ?? "").trim().toLowerCase()}`;
    const hasSocialKey = new Set(currentRecord.contactMethods.socials.map(socialMergeKey));

    // Index imported phones by normalized number so phones that
    // already exist on the current record can have their PRIVACY MARKERS
    // (confidential / noPatientSharing) refreshed from the freshly re-imported
    // source row, instead of silently keeping whatever stale value the current
    // record happened to have. Before this fix, re-importing the same source
    // file with the "merge-fields" ("Combinar") conflict policy would append
    // only genuinely NEW phone numbers and leave existing ones completely
    // untouched — so a phone number that was previously imported with the
    // wrong confidential flag (e.g. from data predating an earlier row-level
    // Confidencial mapping, or a manual mistake) would keep showing the wrong
    // flag forever, no matter how many times the (now-correct) source file was
    // re-imported. The source ODS/CSV row is the authoritative statement of
    // whether a number is confidential, so it must win on every re-import.
    const importedPhoneByKey = new Map<string, (typeof importedRecord.contactMethods.phones)[number]>();
    for (const phone of importedRecord.contactMethods.phones) {
      const key = normalizePhoneForDedup(phone.number);
      if (key && !importedPhoneByKey.has(key)) {
        importedPhoneByKey.set(key, phone);
      }
    }

    const refreshedCurrentPhones = currentRecord.contactMethods.phones.map((phone) => {
      const key = normalizePhoneForDedup(phone.number);
      const importedMatch = key ? importedPhoneByKey.get(key) : undefined;

      if (!importedMatch) {
        return phone;
      }

      return {
        ...phone,
        confidential: importedMatch.confidential,
        noPatientSharing: importedMatch.noPatientSharing
      };
    });

    const hasPhone = new Set(refreshedCurrentPhones.map((phone) => normalizePhoneForDedup(phone.number)));
    const nextPhones = [
      ...refreshedCurrentPhones,
      ...importedRecord.contactMethods.phones.filter((phone) => {
        const key = normalizePhoneForDedup(phone.number);
        return key && !hasPhone.has(key);
      })
    ];
    const nextEmails = [
      ...currentRecord.contactMethods.emails,
      ...importedRecord.contactMethods.emails.filter((email) => {
        const key = email.address.trim().toLowerCase();
        return key && !hasEmail.has(key);
      })
    ];
    const nextSocials = [
      ...currentRecord.contactMethods.socials,
      ...importedRecord.contactMethods.socials.filter((s) => !hasSocialKey.has(socialMergeKey(s)))
    ];

    return contactRecordSchema.parse({
      ...currentRecord,
      externalId: currentRecord.externalId ?? importedRecord.externalId,
      organization: {
        ...currentRecord.organization,
        department: currentRecord.organization.department ?? importedRecord.organization.department,
        service: currentRecord.organization.service ?? importedRecord.organization.service,
        area: currentRecord.organization.area ?? importedRecord.organization.area,
        specialty: currentRecord.organization.specialty ?? importedRecord.organization.specialty,
        // Role/schedule were previously dropped
        // entirely whenever the current record lacked them — fill in from
        // the imported record instead, mirroring mergeDuplicates().
        role: currentRecord.organization.role ?? importedRecord.organization.role,
        schedule: currentRecord.organization.schedule ?? importedRecord.organization.schedule
      },
      // Merge location field-by-field instead of
      // all-or-nothing — a current record that already has a location object
      // but is missing a subfield (e.g. sector/section) must still inherit it
      // from the imported record's location, mirroring mergeDuplicates().
      location:
        currentRecord.location ?? importedRecord.location
          ? {
              building: currentRecord.location?.building ?? importedRecord.location?.building,
              floor: currentRecord.location?.floor ?? importedRecord.location?.floor,
              room: currentRecord.location?.room ?? importedRecord.location?.room,
              text: currentRecord.location?.text ?? importedRecord.location?.text,
              sector: currentRecord.location?.sector ?? importedRecord.location?.sector,
              section: currentRecord.location?.section ?? importedRecord.location?.section
            }
          : undefined,
      contactMethods: {
        // normalizePrimaryEntries invents
        // a primary when none is marked, which reintroduces the auto-assigned
        // "Principal" bug for any record touched by a merge-fields conflict
        // resolution. Only reconcile a genuine conflict (more than one
        // explicitly marked) via the shared, non-inventing reconciler.
        phones: reconcilePrimaryEntries(nextPhones),
        emails: reconcilePrimaryEntries(nextEmails),
        socials: reconcilePrimaryEntries(nextSocials)
      },
      aliases: Array.from(new Set([...currentRecord.aliases, ...importedRecord.aliases])),
      tags: Array.from(new Set([...currentRecord.tags, ...importedRecord.tags])),
      notes: currentRecord.notes ?? importedRecord.notes,
      // Union customFields from both records instead
      // of dropping the imported ones entirely; current record wins on key
      // conflicts, mirroring mergeDuplicates().
      customFields: mergeCustomFields(currentRecord.customFields, importedRecord.customFields),
      audit: {
        ...currentRecord.audit,
        updatedAt: exportedAt,
        updatedBy: editorName
      }
    });
  }

  /**
   * Canonicalize a value for meaningful-field comparison (see
   * `areMeaningfulFieldsIdentical`): trims strings and drops empty strings/
   * undefined so e.g. `""` from a spreadsheet cell and `undefined` on the
   * persisted record are treated as the same "no value" — otherwise a
   * byte-for-byte re-import would spuriously fail the identical check.
   * Objects have their keys sorted (order-independent); arrays are
   * canonicalized element-by-element without reordering (order IS meaningful
   * for arrays other than the entry lists handled by
   * `canonicalizeEntryListForComparison`).
   */
  private canonicalizeValueForComparison(value: unknown): unknown {
    if (typeof value === "string") {
      const trimmed = value.trim();
      return trimmed === "" ? undefined : trimmed;
    }
    if (Array.isArray(value)) {
      return value.map((entry) => this.canonicalizeValueForComparison(entry));
    }
    if (value !== null && typeof value === "object") {
      const result: Record<string, unknown> = {};
      for (const key of Object.keys(value as Record<string, unknown>).sort()) {
        const canonicalized = this.canonicalizeValueForComparison((value as Record<string, unknown>)[key]);
        if (canonicalized !== undefined) {
          result[key] = canonicalized;
        }
      }
      return result;
    }
    return value;
  }

  /**
   * Canonicalize a list of entries (phones/emails/socials) for
   * order-independent, id-independent comparison: each entry's own internal
   * `id` is stripped (it is a list-membership identifier, not meaningful
   * content — two entries with identical number/label/kind but different
   * `id`s are still the same phone), and the resulting list is sorted so
   * re-ordering the same set of entries does not count as a change.
   */
  private canonicalizeEntryListForComparison(entries: Array<{ id: string } & Record<string, unknown>>): string[] {
    return entries
      .map((entry) => {
        const { id: _id, ...rest } = entry;
        return JSON.stringify(this.canonicalizeValueForComparison(rest));
      })
      .sort();
  }

  /**
   * Build a comparable snapshot of every MEANINGFUL field of a contact
   * record — everything except `id`, `audit` (createdAt/updatedAt/
   * createdBy/updatedBy), and import-provenance metadata (`source`), which
   * are never user-visible content and would otherwise make an otherwise
   * byte-for-byte-identical re-import look "changed" purely because of
   * bookkeeping fields. `externalId` IS included since it is meaningful
   * (and, for a stable-key match rather than an externalId match, a
   * differing externalId is a real difference worth surfacing).
   */
  private buildComparableRecordSnapshot(record: ContactRecord) {
    return {
      externalId: this.canonicalizeValueForComparison(record.externalId),
      type: record.type,
      displayName: this.canonicalizeValueForComparison(record.displayName),
      status: record.status,
      person: this.canonicalizeValueForComparison(record.person),
      organization: this.canonicalizeValueForComparison(record.organization),
      location: this.canonicalizeValueForComparison(record.location),
      contactMethods: {
        phones: this.canonicalizeEntryListForComparison(record.contactMethods.phones),
        emails: this.canonicalizeEntryListForComparison(record.contactMethods.emails),
        socials: this.canonicalizeEntryListForComparison(record.contactMethods.socials)
      },
      aliases: [...record.aliases].map((alias) => alias.trim()).filter(Boolean).sort(),
      tags: [...record.tags].map((tag) => tag.trim()).filter(Boolean).sort(),
      notes: this.canonicalizeValueForComparison(record.notes),
      customFields: this.canonicalizeEntryListForComparison(record.customFields ?? [])
    };
  }

  /**
   * True when two matched contact records (an existing record and an
   * imported row that matched it via `buildStableMergeKeys`/externalId) are
   * identical in every MEANINGFUL field — i.e. importing `imported` over
   * `existing` would be a genuine no-op. Used by `detectConflicts` (skip
   * surfacing a no-op match as a conflict requiring manual resolution) and
   * `mergeImportedDataset` (skip writing/counting a no-op as an update).
   */
  private areMeaningfulFieldsIdentical(existing: ContactRecord, imported: ContactRecord): boolean {
    return (
      JSON.stringify(this.buildComparableRecordSnapshot(existing)) ===
      JSON.stringify(this.buildComparableRecordSnapshot(imported))
    );
  }

  /**
   * True when two matched records differ ONLY in `customFields` — every
   * other meaningful field (the ones actually rendered in the conflict diff
   * card: name, phones, emails, socials, location, etc.) is identical. Used
   * to flag a conflict as `customFieldsOnlyDiff` so the UI can surface a
   * notice explaining why a pair that otherwise looks identical still needs
   * manual resolution, instead of leaving the operator with no visible
   * evidence of the actual difference (see `ConflictedImportRecord.customFieldsOnlyDiff`).
   */
  private isCustomFieldsOnlyDifference(existing: ContactRecord, imported: ContactRecord): boolean {
    const { customFields: existingCustomFields, ...existingRest } = this.buildComparableRecordSnapshot(existing);
    const { customFields: importedCustomFields, ...importedRest } = this.buildComparableRecordSnapshot(imported);
    return (
      JSON.stringify(existingRest) === JSON.stringify(importedRest) &&
      JSON.stringify(existingCustomFields) !== JSON.stringify(importedCustomFields)
    );
  }

  private buildStableMergeKeys(record: ContactRecord): string[] {
    const normalized = (value?: string) => (value ?? "").trim().toLowerCase();
    const phoneNumbers = record.contactMethods.phones
      .map((phone) => normalizePhoneForDedup(phone.number))
      .filter(Boolean)
      .sort();
    const emailAddresses = record.contactMethods.emails
      .map((email) => normalized(email.address))
      .filter(Boolean)
      .sort();
    const keys = new Set<string>();
    const base = [
      normalized(record.type),
      normalized(record.organization.department),
      normalized(record.organization.service),
      normalized(record.location?.text)
    ].join("|");

    if (phoneNumbers.length > 0) {
      keys.add(`${base}|phones:${phoneNumbers.join(",")}`);
    }

    if (emailAddresses.length > 0) {
      keys.add(`${base}|emails:${emailAddresses.join(",")}`);
    }

    if (normalized(record.displayName) && phoneNumbers.length > 0) {
      keys.add(`${normalized(record.type)}|${normalized(record.displayName)}|phones:${phoneNumbers.join(",")}`);
    }

    return [...keys];
  }

  private detectConflicts(
    currentDataset: DirectoryDataset,
    importedDataset: DirectoryDataset
  ): { conflicts: ConflictedImportRecord[]; unchangedCount: number } {
    const conflicts: ConflictedImportRecord[] = [];
    let unchangedCount = 0;
    type ConflictIndexEntry = {
      recordIndex: number;
      conflictType: ConflictType;
      record: ConflictRecordSummary;
      source: "existing" | "import";
    };

    /**
     * Derive the human-readable match value from the actual intersection between
     * the imported record and the existing record (Bug-1 + Bug-2).
     *
     * Previously this extracted the first comma-delimited token from the stable key,
     * which was the lexicographically-smallest normalized value — not necessarily
     * the value that caused the match.  Now we compute the intersection explicitly
     * and return the original *formatted* phone/email string (Bug-2) so operators
     * see the value exactly as it appears in their records.
     */
    const extractMatchingFieldValue = (
      conflictType: ConflictType,
      imported: ContactRecord,
      existingSummary: ConflictRecordSummary
    ): string | undefined => {
      if (conflictType === "phone-match") {
        // Build a set of normalized phone values present in the existing record.
        const existingNorms = new Set<string>();
        for (const p of existingSummary.phones ?? []) {
          const norm = normalizePhoneForDedup(p.number);
          if (norm) existingNorms.add(norm);
        }
        // Return the first imported phone whose normalized form intersects.
        // Use the original formatted number from the imported record (Bug-2).
        for (const p of imported.contactMethods.phones) {
          const norm = normalizePhoneForDedup(p.number);
          if (norm && existingNorms.has(norm)) {
            return p.number;
          }
        }
        return undefined;
      }
      if (conflictType === "email-match") {
        const existingNorms = new Set(
          (existingSummary.emails ?? []).map((e) => e.address.trim().toLowerCase())
        );
        for (const e of imported.contactMethods.emails) {
          const norm = e.address.trim().toLowerCase();
          if (norm && existingNorms.has(norm)) {
            return e.address;
          }
        }
        return undefined;
      }
      return undefined;
    };

    // Build lookup indexes from the current dataset
    const currentIndexesByExternalId = new Map<string, ConflictIndexEntry>();
    const currentIndexesByStableKey = new Map<string, ConflictIndexEntry>();

    for (let i = 0; i < currentDataset.records.length; i++) {
      const record = currentDataset.records[i]!;
      if (record.externalId && !currentIndexesByExternalId.has(record.externalId)) {
        currentIndexesByExternalId.set(record.externalId, {
          recordIndex: i,
          conflictType: "external-id-match",
          record: this.toConflictRecordSummary(record),
          source: "existing"
        });
      }
      for (const stableKey of this.buildStableMergeKeys(record)) {
        if (!currentIndexesByStableKey.has(stableKey)) {
          const conflictType = this.classifyConflictTypeByKey(stableKey);
          currentIndexesByStableKey.set(stableKey, {
            recordIndex: i,
            conflictType,
            record: this.toConflictRecordSummary(record),
            source: "existing"
          });
        }
      }
    }

    // Check each imported record for a collision with an existing record.
    //
    // A "conflict" is only ever reported to the user when it matches a
    // PRE-EXISTING record (source: "existing"). Earlier this loop also indexed
    // every previously-processed imported record into the very same lookup
    // maps used for existing-record matching, so a later row in the same batch
    // that merely collided with an EARLIER row of the same import (an
    // "intra-batch" match, source: "import") was pushed into `conflicts`
    // exactly like a real conflict. The renderer surfaces that count with copy
    // like "Hay N registros que ya existen en la agenda" (CsvImportPreviewPanel),
    // which is simply false for an intra-batch match — the record does not
    // already exist anywhere. Against an empty/near-empty database this could
    // make the vast majority (or all) of a large import look like it was
    // colliding with existing data when nothing did. Intra-batch rows are still
    // tracked (`importOnlyMatch`) purely so later rows in the batch can still
    // resolve transitively back to a real existing record (see below), and so
    // `mergeImportedDataset` — which has its own independent index and is
    // unaffected by this method — keeps consolidating duplicate rows within a
    // single import file exactly as it always has.
    importedDataset.records.forEach((importedRecord, importRecordIndex) => {
      let existingMatch: ConflictIndexEntry | undefined;
      let importOnlyMatch: ConflictIndexEntry | undefined;
      let conflictReasonKey = "";
      let matchingFieldValue: string | undefined;

      // Prefer externalId match (most precise).
      // matchingFieldValue is intentionally not set for external-id-match:
      // raw internal codes are not rendered to the user (privacy).
      if (importedRecord.externalId) {
        const indexed = currentIndexesByExternalId.get(importedRecord.externalId);
        if (indexed !== undefined) {
          if (indexed.source === "existing") {
            existingMatch = indexed;
            conflictReasonKey = this.conflictTypeToReasonKey("external-id-match");
          } else {
            importOnlyMatch = indexed;
          }
        }
      }

      // Fall back to stable-key match when no genuine existing-record match was
      // found yet — an intra-batch externalId match must not shadow a real
      // phone/email collision against pre-existing data on a different key.
      if (existingMatch === undefined) {
        for (const key of this.buildStableMergeKeys(importedRecord)) {
          const indexed = currentIndexesByStableKey.get(key);
          if (indexed === undefined) {
            continue;
          }
          if (indexed.source === "existing") {
            existingMatch = indexed;
            conflictReasonKey = this.conflictTypeToReasonKey(indexed.conflictType);
            matchingFieldValue = extractMatchingFieldValue(indexed.conflictType, importedRecord, indexed.record);
            break;
          }
          if (importOnlyMatch === undefined) {
            importOnlyMatch = indexed;
          }
        }
      }

      if (existingMatch !== undefined) {
        // A match against a PRE-EXISTING record that is already
        // field-for-field identical (ignoring id/audit) to the imported row
        // is not a real conflict — nothing would actually change if it were
        // applied. Surfacing it for manual resolution anyway is what made a
        // re-import of an already-imported file look like it needed hundreds
        // of manual decisions even though almost none of them had any actual
        // difference. Count it separately instead of pushing it into
        // `conflicts`.
        const matchedExistingRecord = currentDataset.records[existingMatch.recordIndex];
        const isIdenticalToExisting = matchedExistingRecord !== undefined
          && this.areMeaningfulFieldsIdentical(matchedExistingRecord, importedRecord);

        if (isIdenticalToExisting) {
          unchangedCount += 1;
        } else {
          // A conflict whose ONLY meaningful difference is `customFields` looks,
          // in the visible diff card (name/phones/emails/socials/location), like
          // a genuinely identical pair — with no clue why it was flagged. Flag
          // it so the UI can surface a notice instead of leaving the operator to
          // guess (and possibly silently discard the existing custom field value
          // by picking "Sobrescribir").
          const customFieldsOnlyDiff = matchedExistingRecord !== undefined
            && this.isCustomFieldsOnlyDifference(matchedExistingRecord, importedRecord);

          conflicts.push({
            recordIndex: importRecordIndex,
            importedRecord: this.toConflictRecordSummary(importedRecord),
            matchingRecord: existingMatch.record,
            matchingRecordIndex: existingMatch.recordIndex,
            matchingRecordSource: existingMatch.source,
            conflictType: existingMatch.conflictType,
            conflictReasonKey,
            matchingFieldValue,
            selectedPolicy: undefined,
            customFieldsOnlyDiff
          });
        }
      }

      const importedIndexEntry = existingMatch ?? importOnlyMatch ?? {
        recordIndex: importRecordIndex,
        conflictType: "external-id-match" as const,
        record: this.toConflictRecordSummary(importedRecord),
        source: "import" as const
      };
      if (importedRecord.externalId && !currentIndexesByExternalId.has(importedRecord.externalId)) {
        currentIndexesByExternalId.set(importedRecord.externalId, importedIndexEntry);
      }
      for (const stableKey of this.buildStableMergeKeys(importedRecord)) {
        if (!currentIndexesByStableKey.has(stableKey)) {
          currentIndexesByStableKey.set(stableKey, {
            ...importedIndexEntry,
            conflictType: this.classifyConflictTypeByKey(stableKey)
          });
        }
      }
    });

    return { conflicts, unchangedCount };
  }

  private toConflictRecordSummary(record: ContactRecord): ConflictRecordSummary {
    // Build a compact single-line location summary string.
    const loc = record.location;
    const locationParts: string[] = [];
    if (loc?.building) locationParts.push(loc.building);
    const floorLabel = formatLocationFloor(loc?.floor);
    if (floorLabel) locationParts.push(floorLabel);
    const roomLabel = formatLocationRoom(loc?.room);
    if (roomLabel) locationParts.push(roomLabel);
    if (loc?.text && locationParts.length === 0) locationParts.push(loc.text);
    const locationSummary = locationParts.length > 0 ? locationParts.join(" · ") : undefined;

    return {
      id: record.id,
      displayName: record.displayName,
      department: record.organization.department,
      service: record.organization.service,
      specialty: record.organization.specialty,
      locationSummary,
      // Lean contact method lists for field-level diff.
      phones: record.contactMethods.phones.map((p) => ({
        number: p.number,
        label: p.label,
        kind: p.kind
      })),
      emails: record.contactMethods.emails.map((e) => ({
        address: e.address,
        label: e.label
      })),
      socials: (record.contactMethods.socials ?? []).map((s) => ({
        platform: s.platform,
        handle: s.handle,
        url: s.url,
        label: s.label
      }))
    };
  }

  private classifyConflictTypeByKey(stableKey: string): ConflictType {
    // All keys produced by buildStableMergeKeys contain either phones: or emails: or both.
    // Classify based on which comes first or is present.
    if (stableKey.includes("emails:") && !stableKey.includes("phones:")) {
      return "email-match";
    }
    // If phones: is present (or both), classify as phone-match.
    // Known limitation (Bug-4): when a key contains BOTH phones: and emails:,
    // collapsing to "phone-match" means the shared email is not highlighted in the UI.
    // Supporting a "dual-match" conflict type would require extending the ConflictType
    // union and updating the renderer — deferred to avoid scope creep.
    return "phone-match";
  }

  private conflictTypeToReasonKey(conflictType: ConflictType): string {
    const keys: Record<ConflictType, string> = {
      "external-id-match": "conflict_reason.external_id",
      "phone-match": "conflict_reason.phone_match",
      "email-match": "conflict_reason.email_match"
    };
    return keys[conflictType];
  }

  private buildEmptyDataset(editorName: string): DirectoryDataset {
    const exportedAt = new Date().toISOString();

    return directoryDatasetSchema.parse({
      version: defaultContacts.version,
      exportedAt,
      metadata: {
        recordCount: 0,
        generatedFrom: "recovery-reset",
        generatedBy: "app-recovery-reset",
        editorName,
        typeCounts: {},
        areaCounts: {}
      },
      catalogs: defaultContacts.catalogs,
      records: []
    });
  }

  private createEntityId(prefix: string) {
    return `${prefix}_${globalThis.crypto.randomUUID().slice(0, 8)}`;
  }

  private createUniqueRecordId(records: ContactRecord[]) {
    const maxAttempts = 1000;
    let attempts = 0;
    let candidate = this.createEntityId("cnt");

    while (records.some((record) => record.id === candidate)) {
      attempts += 1;

      if (attempts >= maxAttempts) {
        throw new Error("No se pudo generar un ID único para el registro después de 1000 intentos");
      }

      candidate = this.createEntityId("cnt");
    }

    return candidate;
  }

  private getEditorName(settings: AppSettings) {
    return settings.editorName.trim() || "Editor local";
  }

  private async copyFileWithContext(sourceFilePath: string, targetFilePath: string, message: string) {
    try {
      const canonicalSourceFilePath = await this.resolveCanonicalDataFilePath(sourceFilePath, message, false);
      const canonicalTargetFilePath = path.join(
        await this.resolveCanonicalDirectoryPath(path.dirname(targetFilePath), message),
        path.basename(targetFilePath)
      );

      await fs.copyFile(canonicalSourceFilePath, canonicalTargetFilePath);
    } catch (error) {
      throw this.toFilesystemError(error, message, {
        sourceFilePath,
        targetFilePath
      });
    }
  }

  private toFilesystemError(
    error: unknown,
    message: string,
    context: {
      filePath?: string;
      sourceFilePath?: string;
      targetFilePath?: string;
    }
  ) {
    const routeDetails = new Set<string>();
    const filesystemError = this.getErrnoException(error);

    if (typeof filesystemError?.path === "string" && filesystemError.path.trim() !== "") {
      routeDetails.add(`Ruta afectada: ${(path.basename(filesystemError.path) || "<raíz>")}`);
    }

    if (typeof filesystemError?.dest === "string" && filesystemError.dest.trim() !== "") {
      routeDetails.add(`Ruta de destino: ${(path.basename(filesystemError.dest) || "<raíz>")}`);
    }

    if (routeDetails.size === 0 && context.filePath) {
      routeDetails.add(`Ruta afectada: ${(path.basename(context.filePath) || "<raíz>")}`);
    }

    if (context.sourceFilePath) {
      routeDetails.add(`Ruta de origen: ${(path.basename(context.sourceFilePath) || "<raíz>")}`);
    }

    if (context.targetFilePath && !filesystemError?.dest) {
      routeDetails.add(`Ruta de destino: ${(path.basename(context.targetFilePath) || "<raíz>")}`);
    }

    const routeContext =
      routeDetails.size > 0 ? ` ${Array.from(routeDetails).join(". ")}.` : "";
    const detail = this.getFilesystemErrorDetail(filesystemError ?? undefined);

    return Object.assign(
      new Error(`${message}${routeContext} ${detail}`.trim()),
      {
        code: filesystemError?.code,
        path: filesystemError?.path ?? context.filePath,
        dest: filesystemError?.dest ?? context.targetFilePath
      }
    );
  }

  private getErrnoException(error: unknown): (NodeJS.ErrnoException & { dest?: string }) | null {
    if (
      typeof error === "object" &&
      error !== null &&
      ("code" in error || "message" in error)
    ) {
      return error as NodeJS.ErrnoException & { dest?: string };
    }
    return null;
  }

  private getFilesystemErrorDetail(error?: NodeJS.ErrnoException & { dest?: string }) {
    switch (error?.code) {
      case "EACCES":
        return "No tienes permisos suficientes para acceder al archivo o directorio.";
      case "ENOENT":
        return "El archivo o directorio no existe.";
      case "ENOTDIR":
        return "Alguno de los segmentos de la ruta no es una carpeta válida.";
      case "EROFS":
        return "El archivo o directorio está en un sistema de solo lectura.";
      case "ENOSPC":
        return "No hay espacio suficiente en disco para completar la operación.";
      default:
        return "Se produjo un error al acceder al sistema de archivos.";
    }
  }

  private isRecoverableContactsError(error: unknown) {
    const filesystemError = this.getErrnoException(error);

    return (
      error instanceof SyntaxError ||
      error instanceof ZodError ||
      filesystemError?.code === "ENOENT" ||
      filesystemError?.code === "ENOTDIR" ||
      filesystemError?.code === "EISDIR"
    );
  }

  private toRecoveryState(error: unknown, contactsFilePath: string): RecoveryState {
    let details: string;

    if (error instanceof ZodError) {
      details = "El archivo tiene una estructura inválida. Utiliza la plantilla oficial para importar contactos.";
    } else if (this.getErrnoException(error)?.code === "ENOENT") {
      details = "El archivo configurado no existe. Importa una copia JSON válida o restablece un directorio vacío para volver a trabajar.";
    } else if (this.getErrnoException(error)?.code === "ENOTDIR" || this.getErrnoException(error)?.code === "EISDIR") {
      details = "La ruta configurada no apunta a un archivo JSON válido. Corrige la ruta o restablece un directorio vacío para volver a trabajar.";
    } else if (error instanceof Error) {
      details = "El archivo no es un JSON válido. Verifica que el archivo no esté corrupto.";
    } else {
      details = "Importa una copia JSON válida o restablece un directorio vacío para volver a trabajar.";
    }

    return {
      reason: "invalid-contacts-json",
      contactsFilePath,
      message: this.getErrnoException(error)?.code === "ENOENT"
        ? "El archivo de datos configurado no existe o ya no está disponible."
        : (this.getErrnoException(error)?.code === "ENOTDIR" || this.getErrnoException(error)?.code === "EISDIR")
            ? "La ruta de datos configurada no apunta a un archivo utilizable."
        : "El archivo local contacts.json está dañado o tiene un formato no válido.",
      details
    };
  }

  async getAuditLog(params: AuditLogQueryParams): Promise<AuditLogResult> {
    return this.auditFacade.getAuditLog(params);
  }

  async exportAuditLog(targetFilePath: string, params: AuditLogQueryParams): Promise<ExportAuditLogResult> {
    return this.auditFacade.exportAuditLog(targetFilePath, params);
  }

  private async appendAuditEntry(entry: AuditLogEntry): Promise<void> {
    // Use await so this frame appears in async stack traces and
    // a future throw is caught by this method's own context rather than silently
    // escaping as an unhandled promise rejection.
    await this.auditFacade.appendEntry(entry);
  }

  /**
   * Clear the latched integrity-error state on the audit log so that subsequent
   * appends are attempted again.
   *
   * An IPC entrypoint can call this after the operator has resolved the
   * underlying file corruption (no new IPC channel is needed — wire the
   * existing audit-related IPC handler to this method if recovery is desired).
   */
  async recoverAuditLog(): Promise<void> {
    return this.auditFacade.recoverFromIntegrityError();
  }
}
