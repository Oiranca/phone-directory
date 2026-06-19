import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { ZodError } from "zod";
import { appSettingsSchema, contactRecordSchema, directoryDatasetSchema, editableAppSettingsSchema, editableContactRecordSchema } from "../../shared/schemas/contact.js";
import { defaultContacts } from "../../shared/fixtures/defaultContacts.js";
import { defaultSettings } from "../../shared/fixtures/defaultSettings.js";
import { buildSpreadsheetImportPreview } from "./spreadsheet-import.service.js";
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
import type { AreaType, RecordType } from "../../shared/constants/catalogs.js";
import { ensureDirectory, readJsonFile, writeJsonFile } from "../utils/fs-json.js";
import { getContactsFilePath, getManagedBackupDirectory, getSettingsFilePath } from "../utils/paths.js";
import { assertPathChainIsNotSymlink } from "../utils/path-safety.js";
import { normalizePrimaryEntries } from "../../shared/utils/contacts.js";

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

  async getBootstrapData(): Promise<BootstrapResult> {
    await this.ensureInitialFiles();
    const settings = await this.readSettings(true);
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
      throw new Error("La ruta de la carpeta de backups debe ser absoluta.");
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
    const backupFilePath = await this.createBackupCore(settings, "contacts", "No se pudo crear el backup del directorio.");
    this.autoBackupEditCount = 0;
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
      "No se pudo leer la carpeta de backups."
    );
    try {
      await ensureDirectory(backupDirectory);
      const entries = await fs.readdir(backupDirectory, { withFileTypes: true });
      const backupFiles = await Promise.all(
        entries
          .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
          .map(async (entry) => {
            const filePath = path.join(backupDirectory, entry.name);
            const stats = await fs.stat(filePath);

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
        "No se pudo leer la carpeta de backups.",
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
    // "bulk-import" matches importCsvDataset semantics: wholesale dataset replacement.
    await this.appendAuditEntry({
      timestamp: now,
      editor: this.getEditorName(settings),
      action: "bulk-import",
      recordsAffected: importedContacts.records.length,
      importSource: path.basename(sourceFilePath)
    });

    return {
      contacts: importedContacts,
      settings: this.toEditableSettings(settings),
      backupPath,
      importedFilePath: sourceFilePath,
      recordCount: importedContacts.records.length
    };
    });
  }

  async restoreBackup(sourceFilePath: string): Promise<ImportContactsResult> {
    return this.enqueueWrite(async () => {
    const settings = await this.readSettings(true);
    const message = "No se pudo restaurar el backup seleccionado.";
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
          `${message} Ruta afectada: ${canonicalSourceFilePath}. El archivo cambió mientras se validaba y ya no es seguro restaurarlo.`
        );
      }

      if (handleStats.dev !== pathStats.dev || handleStats.ino !== pathStats.ino) {
        throw new Error(
          `${message} Ruta afectada: ${canonicalSourceFilePath}. El archivo cambió mientras se validaba y ya no es seguro restaurarlo.`
        );
      }

      const rawContents = await backupHandle.readFile({ encoding: "utf-8" });
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

  async previewCsvImport(sourceFilePath: string): Promise<CsvImportPreviewWithConflicts> {
    const settings = await this.readSettings(true);
    const { dataset, preview } = await buildSpreadsheetImportPreview(
      sourceFilePath,
      this.getEditorName(settings)
    );
    const currentContacts = await this.readContacts(settings);
    const mergeSummary = this.mergeImportedDataset(currentContacts, dataset, this.getEditorName(settings));
    const conflictedRecords = this.detectConflicts(currentContacts, dataset);

    return {
      ...preview,
      mergedRecordCount: mergeSummary.contacts.records.length,
      createdCount: mergeSummary.createdCount,
      updatedCount: mergeSummary.updatedCount,
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
    const { dataset, preview } = await buildSpreadsheetImportPreview(
      sourceFilePath,
      editorName
    );

    if (preview.invalidRowCount > 0) {
      throw new Error("El archivo contiene filas inválidas. Corrige el origen antes de importarlo.");
    }

    if (preview.validRowCount === 0) {
      throw new Error("El archivo no contiene filas válidas para importar.");
    }

    const currentContacts = await this.readContacts(settings);
    const conflicts = this.detectConflicts(currentContacts, dataset);
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
        conflictCount: { new: conflicts.length },
        conflictPolicyCounts: { new: merged.conflictPolicyCounts }
      }
    });

    return {
      contacts: merged.contacts,
      settings: this.toEditableSettings(settings),
      backupPath,
      importedFilePath: sourceFilePath,
      recordCount: merged.contacts.records.length,
      warningCount: preview.warningCount,
      invalidRowCount: preview.invalidRowCount,
      createdCount: merged.createdCount,
      updatedCount: merged.updatedCount,
      conflictCount: conflicts.length,
      conflictPolicyCounts: merged.conflictPolicyCounts
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
        phones: normalizePrimaryEntries(parsed.contactMethods.phones),
        emails: normalizePrimaryEntries(parsed.contactMethods.emails)
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
        phones: normalizePrimaryEntries(parsed.contactMethods.phones),
        emails: normalizePrimaryEntries(parsed.contactMethods.emails)
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

  async mergeDuplicates(keepId: string, discardId: string): Promise<ContactRecord> {
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
    const normalizePhoneNumber = (phone: string): string =>
      phone.replace(/\D/g, "").slice(-9); // Last 9 digits, matches detector logic
    const normalizeEmail = (email: string): string =>
      email.trim().toLowerCase();
    const normalizeTag = (tag: string): string =>
      tag.trim().toLowerCase();

    const existingPhoneNumbers = new Set(
      keepRecord.contactMethods.phones.map((p) => normalizePhoneNumber(p.number))
    );
    const existingEmailAddresses = new Set(
      keepRecord.contactMethods.emails.map((e) => normalizeEmail(e.address))
    );
    const existingTags = new Set(
      keepRecord.tags.map((t) => normalizeTag(t))
    );

    const extraPhones = discardRecord.contactMethods.phones.filter(
      (p) => !existingPhoneNumbers.has(normalizePhoneNumber(p.number))
    );
    const extraEmails = discardRecord.contactMethods.emails.filter(
      (e) => !existingEmailAddresses.has(normalizeEmail(e.address))
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
        specialty: keepRecord.organization.specialty || discardRecord.organization.specialty
      },
      // Copy location from discard if keeper doesn't have one
      location: keepRecord.location || discardRecord.location,
      // Merge contact methods with deduplication
      contactMethods: {
        phones: normalizePrimaryEntries([...keepRecord.contactMethods.phones, ...extraPhones]),
        emails: normalizePrimaryEntries([...keepRecord.contactMethods.emails, ...extraEmails])
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

    const nextRecords = contacts.records
      .filter((r) => r.id !== discardId)
      .map((r) => (r.id === keepId ? mergedRecord : r));

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

    return mergedRecord;
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
      ui: settings.ui
    };
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
      "No se pudo preparar la carpeta de backups del directorio."
    );
    try {
      await ensureDirectory(backupDirectory);
    } catch (error) {
      throw this.toFilesystemError(
        error,
        "No se pudo preparar la carpeta de backups del directorio.",
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
          "No se pudo preparar la carpeta de backups del directorio.",
          { filePath: candidatePath }
        );
      }
    }

    throw new Error(
      `No se pudo generar un nombre único para el backup después de ${maxAttempts} intentos.`
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
      throw new Error("La ruta de la carpeta de backups configurada debe ser absoluta.");
    }

    await this.assertPathChainIsNotSymlink(
      settings.dataFilePath,
      "No se pudo validar la ruta del archivo de datos configurada.",
      true
    );
    await this.assertPathChainIsNotSymlink(
      settings.backupDirectoryPath,
      "No se pudo validar la carpeta de backups configurada."
    );
  }

  private async validateEditableSettings(settings: AppSettings, currentSettings: AppSettings) {
    const settingsFilePath = getSettingsFilePath();

    if (this.pathsMatch(settings.dataFilePath, settingsFilePath)) {
      throw new Error(
        `La ruta de datos no puede apuntar al archivo de configuración. Ruta afectada: ${settings.dataFilePath}. Usa un archivo JSON independiente para los contactos o restablece las rutas gestionadas.`
      );
    }

    await this.assertPathChainIsNotSymlink(
      settings.dataFilePath,
      "No se pudo validar la ruta del archivo de datos.",
      true
    );
    await this.assertPathChainIsNotSymlink(
      settings.backupDirectoryPath,
      "No se pudo validar la carpeta de backups."
    );

    if (path.extname(settings.dataFilePath).toLowerCase() !== ".json") {
      throw new Error(
        `La ruta de datos debe terminar en .json. Ruta afectada: ${settings.dataFilePath}.`
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
      "No se pudo validar la carpeta de backups."
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
          : "No se pudo crear el auto-backup.";
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
    await this.createBackupCore(settings, "auto-backup", "No se pudo crear el auto-backup del directorio.");
    await this.pruneAutoBackups(settings);
  }

  private async pruneAutoBackups(settings: AppSettings) {
    const backupDirectory = await this.resolveCanonicalDirectoryPath(
      settings.backupDirectoryPath,
      "No se pudo preparar la carpeta de backups del directorio."
    );
    const pruneErrorMessage = "No se pudo rotar los auto-backups del directorio.";

    try {
      const entries = await fs.readdir(backupDirectory, { withFileTypes: true });
      const autoBackupFiles = (
        await Promise.all(
          entries
            .filter((entry) => entry.isFile() && entry.name.startsWith("auto-backup-") && entry.name.endsWith(".json"))
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

      autoBackupFiles.sort((left, right) => right.createdAt - left.createdAt);

      await Promise.all(
        autoBackupFiles
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
        `${message} Ruta afectada: ${filePath}. El archivo debe estar dentro de la carpeta de backups configurada.`
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
          `${message} Ruta afectada: ${filePath}. Ya existe un archivo en esa ruta. Usa una ruta nueva para copiar el dataset actual o restablece las rutas gestionadas.`
        );
      }

      if (error instanceof Error && error.message === "is-directory") {
        throw new Error(
          `${message} Ruta afectada: ${filePath}. La ruta de datos debe apuntar a un archivo JSON, no a una carpeta.`
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
    const typeCounts: Partial<Record<RecordType, number>> = {};
    const areaCounts: Partial<Record<AreaType, number>> = {};

    for (const record of records) {
      typeCounts[record.type] = (typeCounts[record.type] ?? 0) + 1;

      if (record.organization.area) {
        areaCounts[record.organization.area] = (areaCounts[record.organization.area] ?? 0) + 1;
      }
    }

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
    const hasPhone = new Set(currentRecord.contactMethods.phones.map((phone) => phone.number.replace(/\D/g, "")));
    const hasEmail = new Set(currentRecord.contactMethods.emails.map((email) => email.address.trim().toLowerCase()));
    const nextPhones = [
      ...currentRecord.contactMethods.phones,
      ...importedRecord.contactMethods.phones.filter((phone) => {
        const key = phone.number.replace(/\D/g, "");
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

    return contactRecordSchema.parse({
      ...currentRecord,
      externalId: currentRecord.externalId ?? importedRecord.externalId,
      organization: {
        ...currentRecord.organization,
        department: currentRecord.organization.department ?? importedRecord.organization.department,
        service: currentRecord.organization.service ?? importedRecord.organization.service,
        area: currentRecord.organization.area ?? importedRecord.organization.area,
        specialty: currentRecord.organization.specialty ?? importedRecord.organization.specialty
      },
      location: currentRecord.location ?? importedRecord.location,
      contactMethods: {
        phones: normalizePrimaryEntries(nextPhones),
        emails: normalizePrimaryEntries(nextEmails)
      },
      aliases: Array.from(new Set([...currentRecord.aliases, ...importedRecord.aliases])),
      tags: Array.from(new Set([...currentRecord.tags, ...importedRecord.tags])),
      notes: currentRecord.notes ?? importedRecord.notes,
      audit: {
        ...currentRecord.audit,
        updatedAt: exportedAt,
        updatedBy: editorName
      }
    });
  }

  private buildStableMergeKeys(record: ContactRecord): string[] {
    const normalized = (value?: string) => (value ?? "").trim().toLowerCase();
    const phoneNumbers = record.contactMethods.phones
      .map((phone) => phone.number.replace(/\D/g, ""))
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
  ): ConflictedImportRecord[] {
    const conflicts: ConflictedImportRecord[] = [];
    type ConflictIndexEntry = {
      recordIndex: number;
      conflictType: ConflictType;
      record: ConflictRecordSummary;
      source: "existing" | "import";
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

    // Check each imported record for a collision with an existing record
    importedDataset.records.forEach((importedRecord, importRecordIndex) => {
      let match: ConflictIndexEntry | undefined;
      let conflictReasonKey = "";

      // Prefer externalId match (most precise)
      if (importedRecord.externalId) {
        const indexed = currentIndexesByExternalId.get(importedRecord.externalId);
        if (indexed !== undefined) {
          match = indexed;
          conflictReasonKey = this.conflictTypeToReasonKey("external-id-match");
        }
      }

      // Fall back to stable-key match when no externalId match was found
      if (match === undefined) {
        for (const key of this.buildStableMergeKeys(importedRecord)) {
          const indexed = currentIndexesByStableKey.get(key);
          if (indexed !== undefined) {
            match = indexed;
            conflictReasonKey = this.conflictTypeToReasonKey(indexed.conflictType);
            break;
          }
        }
      }

      if (match !== undefined) {
        conflicts.push({
          recordIndex: importRecordIndex,
          importedRecord: this.toConflictRecordSummary(importedRecord),
          matchingRecord: match.record,
          matchingRecordIndex: match.recordIndex,
          matchingRecordSource: match.source,
          conflictType: match.conflictType,
          conflictReasonKey,
          selectedPolicy: undefined
        });
      }

      const importedIndexEntry = match ?? {
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

    return conflicts;
  }

  private toConflictRecordSummary(record: ContactRecord): ConflictRecordSummary {
    return {
      id: record.id,
      externalId: record.externalId,
      type: record.type,
      displayName: record.displayName,
      department: record.organization.department,
      service: record.organization.service,
      area: record.organization.area,
      status: record.status
    };
  }

  private classifyConflictTypeByKey(stableKey: string): ConflictType {
    // All keys produced by buildStableMergeKeys contain either phones: or emails: or both
    // Classify based on which comes first or is present
    if (stableKey.includes("emails:") && !stableKey.includes("phones:")) {
      return "email-match";
    }
    // If phones: is present (or both), classify as phone-match
    // (keys with both typically prioritize phone matching)
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
    // FIX 3 (PR #67): use await so this frame appears in async stack traces and
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
