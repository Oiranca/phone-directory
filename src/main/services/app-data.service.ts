import fs from "node:fs/promises";
import path from "node:path";
import { appSettingsSchema, contactRecordSchema, directoryDatasetSchema, editableAppSettingsSchema, editableContactRecordSchema } from "../../shared/schemas/contact.js";
import { defaultContacts } from "../../shared/fixtures/defaultContacts.js";
import { defaultSettings } from "../../shared/fixtures/defaultSettings.js";
import { buildCsvImportPreview } from "./csv-import.service.js";
import type {
  AppSettings,
  BackupListItem,
  BootstrapData,
  ContactRecord,
  CsvImportPreview,
  CsvImportResult,
  DirectoryDataset,
  EditableAppSettings,
  EditableContactRecord,
  ExportContactsResult,
  ImportContactsResult,
  SaveContactResult
} from "../../shared/types/contact.js";
import { ensureDirectory, readJsonFile, writeJsonFile } from "../utils/fs-json.js";
import { getContactsFilePath, getManagedBackupDirectory, getManagedDataDirectory, getSettingsFilePath } from "../utils/paths.js";

export class AppDataService {
  async ensureInitialFiles() {
    const dataDirectory = getManagedDataDirectory();
    const backupDirectory = getManagedBackupDirectory();
    const contactsFilePath = getContactsFilePath();
    const settingsFilePath = getSettingsFilePath();

    await ensureDirectory(dataDirectory);
    await ensureDirectory(backupDirectory);

    if (!(await this.fileExists(contactsFilePath))) {
      await writeJsonFile(contactsFilePath, defaultContacts);
    }

    if (!(await this.fileExists(settingsFilePath))) {
      await writeJsonFile(settingsFilePath, defaultSettings(contactsFilePath, backupDirectory));
    }
  }

  async getBootstrapData(): Promise<BootstrapData> {
    await this.ensureInitialFiles();

    const contacts = directoryDatasetSchema.parse(
      await readJsonFile<DirectoryDataset>(getContactsFilePath())
    );

    const settings = await this.readSettings();

    return { contacts, settings: this.toEditableSettings(settings) };
  }

  async saveSettings(settings: EditableAppSettings) {
    const parsed = editableAppSettingsSchema.parse(settings);
    const currentSettings = await this.readSettings();
    const nextSettings = {
      ...currentSettings,
      editorName: parsed.editorName,
      ui: parsed.ui
    };

    await writeJsonFile(getSettingsFilePath(), nextSettings);
    return nextSettings;
  }

  async createBackup() {
    const backupFilePath = await this.createBackupFilePath();
    await this.copyFileWithContext(
      getContactsFilePath(),
      backupFilePath,
      "No se pudo crear el backup automático del directorio."
    );
    return backupFilePath;
  }

  async listBackups(): Promise<BackupListItem[]> {
    const backupDirectory = getManagedBackupDirectory();
    try {
      await ensureDirectory(backupDirectory);
      const entries = await fs.readdir(backupDirectory, { withFileTypes: true });
      const backupFiles = await Promise.all(
        entries
          .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
          .map(async (entry) => {
            const filePath = path.join(backupDirectory, entry.name);
            const stats = await fs.stat(filePath);

            return {
              fileName: entry.name,
              filePath,
              createdAt: stats.mtime.toISOString(),
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
        backupDirectory
      );
    }
  }

  async exportDataset(targetFilePath: string): Promise<ExportContactsResult> {
    const contacts = await this.readContacts();
    const directory = path.dirname(targetFilePath);

    try {
      await ensureDirectory(directory);
      await writeJsonFile(targetFilePath, contacts);
    } catch (error) {
      throw this.toFilesystemError(
        error,
        "No se pudo exportar el directorio al destino seleccionado.",
        targetFilePath
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
    const settings = await this.readSettings();

    await writeJsonFile(getContactsFilePath(), importedContacts);

    return {
      contacts: importedContacts,
      settings: this.toEditableSettings(settings),
      backupPath,
      importedFilePath: sourceFilePath,
      recordCount: importedContacts.records.length
    };
  }

  async previewCsvImport(sourceFilePath: string): Promise<CsvImportPreview> {
    const settings = await this.readSettings();
    const { preview } = await buildCsvImportPreview(
      sourceFilePath,
      this.getEditorName(settings)
    );
    return preview;
  }

  async importCsvDataset(sourceFilePath: string): Promise<CsvImportResult> {
    const settings = await this.readSettings();
    const { dataset, preview } = await buildCsvImportPreview(
      sourceFilePath,
      this.getEditorName(settings)
    );

    if (preview.invalidRowCount > 0) {
      throw new Error("El CSV contiene filas inválidas. Corrige el archivo antes de importarlo.");
    }

    if (preview.validRowCount === 0) {
      throw new Error("El CSV no contiene filas válidas para importar.");
    }

    const backupPath = await this.createBackup();
    await writeJsonFile(getContactsFilePath(), dataset);

    return {
      contacts: dataset,
      settings: this.toEditableSettings(settings),
      backupPath,
      importedFilePath: sourceFilePath,
      recordCount: dataset.records.length,
      warningCount: preview.warningCount,
      invalidRowCount: preview.invalidRowCount
    };
  }

  async createRecord(payload: EditableContactRecord): Promise<SaveContactResult> {
    const parsed = editableContactRecordSchema.parse(payload);
    const contacts = await this.readContacts();
    const settings = await this.readSettings();
    const now = new Date().toISOString();
    const editorName = this.getEditorName(settings);
    const savedRecordId = this.createUniqueRecordId(contacts.records);

    const nextRecord = contactRecordSchema.parse({
      ...parsed,
      id: savedRecordId,
      contactMethods: {
        phones: this.normalizePrimaryEntries(parsed.contactMethods.phones),
        emails: this.normalizePrimaryEntries(parsed.contactMethods.emails)
      },
      audit: {
        createdAt: now,
        updatedAt: now,
        createdBy: editorName,
        updatedBy: editorName
      }
    });

    const nextContacts = this.buildNextDataset([nextRecord, ...contacts.records], contacts, editorName, now);
    await writeJsonFile(getContactsFilePath(), nextContacts);
    return {
      contacts: nextContacts,
      settings: this.toEditableSettings(settings),
      savedRecordId
    };
  }

  async updateRecord(recordId: string, payload: EditableContactRecord): Promise<SaveContactResult> {
    const parsed = editableContactRecordSchema.parse(payload);
    const contacts = await this.readContacts();
    const settings = await this.readSettings();
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
        phones: this.normalizePrimaryEntries(parsed.contactMethods.phones),
        emails: this.normalizePrimaryEntries(parsed.contactMethods.emails)
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
    await writeJsonFile(getContactsFilePath(), nextContacts);
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

  toEditableSettings(settings: AppSettings): EditableAppSettings {
    return {
      editorName: settings.editorName,
      ui: settings.ui
    };
  }

  private async readContacts() {
    return directoryDatasetSchema.parse(
      await readJsonFile<DirectoryDataset>(getContactsFilePath())
    );
  }

  private async createBackupFilePath() {
    const safeTimestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupDirectory = getManagedBackupDirectory();
    try {
      await ensureDirectory(backupDirectory);
    } catch (error) {
      throw this.toFilesystemError(
        error,
        "No se pudo preparar la carpeta de backups del directorio.",
        backupDirectory
      );
    }
    return path.join(backupDirectory, `contacts-${safeTimestamp}.json`);
  }

  private async readSettings() {
    return appSettingsSchema.parse(
      await readJsonFile<AppSettings>(getSettingsFilePath())
    );
  }

  private buildNextDataset(
    records: ContactRecord[],
    currentDataset: DirectoryDataset,
    editorName: string,
    exportedAt: string
  ): DirectoryDataset {
    const typeCounts: Record<string, number> = {};
    const areaCounts: Record<string, number> = {};

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

  private createEntityId(prefix: string) {
    return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
  }

  private createUniqueRecordId(records: ContactRecord[]) {
    let candidate = this.createEntityId("cnt");

    while (records.some((record) => record.id === candidate)) {
      candidate = this.createEntityId("cnt");
    }

    return candidate;
  }

  private getEditorName(settings: AppSettings) {
    return settings.editorName.trim() || "Editor local";
  }

  private normalizePrimaryEntries<T extends { isPrimary: boolean }>(entries: T[]) {
    let primaryAssigned = false;

    const normalizedEntries = entries.map((entry) => {
      if (entry.isPrimary && !primaryAssigned) {
        primaryAssigned = true;
        return entry;
      }

      if (entry.isPrimary && primaryAssigned) {
        return {
          ...entry,
          isPrimary: false
        };
      }

      return entry;
    });

    if (primaryAssigned || normalizedEntries.length === 0) {
      return normalizedEntries;
    }

    return normalizedEntries.map((entry, index) =>
      index === 0
        ? {
            ...entry,
            isPrimary: true
          }
        : entry
    );
  }

  private async copyFileWithContext(sourceFilePath: string, targetFilePath: string, message: string) {
    try {
      await fs.copyFile(sourceFilePath, targetFilePath);
    } catch (error) {
      throw this.toFilesystemError(error, message, targetFilePath);
    }
  }

  private toFilesystemError(error: unknown, message: string, filePath: string) {
    if (error instanceof Error) {
      const detail = error.message.trim();
      return new Error(`${message} Ruta afectada: ${filePath}. ${detail}`);
    }

    return new Error(`${message} Ruta afectada: ${filePath}.`);
  }
}
