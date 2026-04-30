import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { ZodError } from "zod";
import { appSettingsSchema, contactRecordSchema, directoryDatasetSchema, editableAppSettingsSchema, editableContactRecordSchema } from "../../shared/schemas/contact.js";
import { defaultContacts } from "../../shared/fixtures/defaultContacts.js";
import { defaultSettings } from "../../shared/fixtures/defaultSettings.js";
import { buildSpreadsheetImportPreview } from "./spreadsheet-import.service.js";
import type {
  AppSettings,
  BackupListItem,
  BootstrapData,
  BootstrapResult,
  ContactRecord,
  CsvImportPreview,
  CsvImportResult,
  DirectoryDataset,
  EditableAppSettings,
  EditableContactRecord,
  ExportContactsResult,
  ImportContactsResult,
  RecoveryState,
  ResetContactsResult,
  SaveContactResult
} from "../../shared/types/contact.js";
import type { AreaType, RecordType } from "../../shared/constants/catalogs.js";
import { ensureDirectory, readJsonFile, writeJsonFile } from "../utils/fs-json.js";
import { getContactsFilePath, getManagedBackupDirectory, getManagedDataDirectory, getSettingsFilePath } from "../utils/paths.js";
import { normalizePrimaryEntries } from "../../shared/utils/contacts.js";

export class AppDataService {
  async ensureInitialFiles() {
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
    const nextSettings = {
      ...currentSettings,
      editorName: parsed.editorName,
      dataFilePath: path.normalize(normalizedDataFilePath),
      backupDirectoryPath: path.normalize(normalizedBackupDirectoryPath),
      ui: parsed.ui
    };

    await this.validateEditableSettings(nextSettings, currentSettings);

    if (
      !this.pathsMatch(nextSettings.dataFilePath, currentSettings.dataFilePath) &&
      !(await this.fileExists(nextSettings.dataFilePath))
    ) {
      const currentContacts = await this.readContacts(currentSettings);
      await this.writeDatasetToPath(nextSettings.dataFilePath, currentContacts);
    }

    await writeJsonFile(getSettingsFilePath(), nextSettings);
    return nextSettings;
  }

  getEditableSettingsDefaults(): EditableAppSettings {
    return this.toEditableSettings(this.getManagedSettingsDefaults());
  }

  async createBackup() {
    const settings = await this.readSettings(true);
    const backupFilePath = await this.createBackupFilePath(settings);
    await this.copyFileWithContext(
      settings.dataFilePath,
      backupFilePath,
      "No se pudo crear el backup del directorio."
    );
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
  }

  async importDataset(sourceFilePath: string): Promise<ImportContactsResult> {
    const importedContacts = directoryDatasetSchema.parse(
      await readJsonFile<DirectoryDataset>(sourceFilePath)
    );
    const backupPath = await this.createBackup();
    const settings = await this.readSettings(true);

    await this.writeDatasetToPath(settings.dataFilePath, importedContacts);

    return {
      contacts: importedContacts,
      settings: this.toEditableSettings(settings),
      backupPath,
      importedFilePath: sourceFilePath,
      recordCount: importedContacts.records.length
    };
  }

  async restoreBackup(sourceFilePath: string): Promise<ImportContactsResult> {
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

    const backupPath = await this.createBackup();

    await this.writeDatasetToPath(settings.dataFilePath, importedContacts);

    return {
      contacts: importedContacts,
      settings: this.toEditableSettings(settings),
      backupPath,
      importedFilePath: canonicalSourceFilePath,
      recordCount: importedContacts.records.length
    };
  }

  async resetDataset(): Promise<ResetContactsResult> {
    const settings = await this.readSettings(true);
    const contactsFilePath = settings.dataFilePath;
    const backupPath = (await this.fileExists(contactsFilePath))
      ? await this.createBackup()
      : null;
    const contacts = this.buildEmptyDataset(this.getEditorName(settings));

    await this.writeDatasetToPath(settings.dataFilePath, contacts);

    return {
      contacts,
      settings: this.toEditableSettings(settings),
      backupPath
    };
  }

  async previewCsvImport(sourceFilePath: string): Promise<CsvImportPreview> {
    const settings = await this.readSettings(true);
    const { dataset, preview } = await buildSpreadsheetImportPreview(
      sourceFilePath,
      this.getEditorName(settings)
    );
    const currentContacts = await this.readContacts(settings);
    const mergeSummary = this.mergeImportedDataset(currentContacts, dataset, this.getEditorName(settings));

    return {
      ...preview,
      mergedRecordCount: mergeSummary.contacts.records.length,
      createdCount: mergeSummary.createdCount,
      updatedCount: mergeSummary.updatedCount
    };
  }

  async importCsvDataset(sourceFilePath: string): Promise<CsvImportResult> {
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
    const merged = this.mergeImportedDataset(currentContacts, dataset, editorName);
    const backupPath = await this.createBackup();
    await this.writeDatasetToPath(settings.dataFilePath, merged.contacts);

    return {
      contacts: merged.contacts,
      settings: this.toEditableSettings(settings),
      backupPath,
      importedFilePath: sourceFilePath,
      recordCount: merged.contacts.records.length,
      warningCount: preview.warningCount,
      invalidRowCount: preview.invalidRowCount,
      createdCount: merged.createdCount,
      updatedCount: merged.updatedCount
    };
  }

  async createRecord(payload: EditableContactRecord): Promise<SaveContactResult> {
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
    return {
      contacts: nextContacts,
      settings: this.toEditableSettings(settings),
      savedRecordId
    };
  }

  async updateRecord(recordId: string, payload: EditableContactRecord): Promise<SaveContactResult> {
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
    return {
      contacts: nextContacts,
      settings: this.toEditableSettings(settings),
      savedRecordId: currentRecord.id
    };
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

  private async createBackupFilePath(settings: AppSettings) {
    const safeTimestamp = new Date().toISOString().replace(/[:.]/g, "-");
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
    return path.join(backupDirectory, `contacts-${safeTimestamp}.json`);
  }

  private async readSettings(validatePaths = false) {
    const settings = appSettingsSchema.parse(
      await readJsonFile<AppSettings>(getSettingsFilePath())
    );

    if (validatePaths) {
      await this.assertPersistedSettingsSafe(settings);
    }

    return settings;
  }

  private getManagedSettingsDefaults(): AppSettings {
    return defaultSettings(getContactsFilePath(), getManagedBackupDirectory());
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

    await this.assertPathChainIsNotSymlink(
      settings.dataFilePath,
      "No se pudo validar la ruta del archivo de datos.",
      true
    );
    await this.assertPathChainIsNotSymlink(
      settings.backupDirectoryPath,
      "No se pudo validar la carpeta de backups."
    );

    if (this.pathsMatch(settings.dataFilePath, settingsFilePath)) {
      throw new Error(
        `La ruta de datos no puede apuntar al archivo de configuración. Ruta afectada: ${settings.dataFilePath}. Usa un archivo JSON independiente para los contactos o restablece las rutas gestionadas.`
      );
    }

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
    const resolvedPath = path.resolve(targetPath);
    const parsedPath = path.parse(resolvedPath);
    const relativeSegments = resolvedPath.slice(parsedPath.root.length).split(path.sep).filter(Boolean);
    let currentPath = parsedPath.root;

    for (let index = 0; index < relativeSegments.length; index += 1) {
      currentPath = path.join(currentPath, relativeSegments[index]!);

      if (index === 0) {
        continue;
      }

      try {
        const stats = await fs.lstat(currentPath);

        if (stats.isSymbolicLink()) {
          throw new Error(
            `${message} Ruta afectada: ${currentPath}. No se permiten enlaces simbólicos en las rutas configuradas.`
          );
        }
      } catch (error) {
        if (error instanceof Error && error.message.includes("No se permiten enlaces simbólicos")) {
          throw error;
        }

        const filesystemError = this.getErrnoException(error);
        const isLeaf = index === relativeSegments.length - 1;

        if (allowMissingLeaf && isLeaf && filesystemError?.code === "ENOENT") {
          return;
        }

        throw this.toFilesystemError(error, message, { filePath: currentPath });
      }
    }
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

  private async writeDatasetToPath(filePath: string, dataset: DirectoryDataset) {
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
    editorName: string
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

    for (const importedRecord of importedDataset.records) {
      const externalIdMatchIndex = importedRecord.externalId
        ? currentIndexesByExternalId.get(importedRecord.externalId)
        : undefined;
      const stableMatchIndex = this.buildStableMergeKeys(importedRecord)
        .map((stableKey) => currentIndexesByStableKey.get(stableKey))
        .find((index): index is number => index !== undefined);
      const matchIndex = externalIdMatchIndex ?? stableMatchIndex;

      if (matchIndex !== undefined) {
        const currentRecord = mergedRecords[matchIndex]!;
        const mergedRecord = contactRecordSchema.parse({
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
      updatedCount
    };
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
    return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
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
      routeDetails.add(`Ruta afectada: ${(path.basename(filesystemError.path) || "<root>")}`);
    }

    if (typeof filesystemError?.dest === "string" && filesystemError.dest.trim() !== "") {
      routeDetails.add(`Ruta de destino: ${(path.basename(filesystemError.dest) || "<root>")}`);
    }

    if (routeDetails.size === 0 && context.filePath) {
      routeDetails.add(`Ruta afectada: ${(path.basename(context.filePath) || "<root>")}`);
    }

    if (context.sourceFilePath) {
      routeDetails.add(`Ruta de origen: ${(path.basename(context.sourceFilePath) || "<root>")}`);
    }

    if (context.targetFilePath && !filesystemError?.dest) {
      routeDetails.add(`Ruta de destino: ${(path.basename(context.targetFilePath) || "<root>")}`);
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
}
