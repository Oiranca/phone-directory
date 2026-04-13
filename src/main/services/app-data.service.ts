import fs from "node:fs/promises";
import path from "node:path";
import { appSettingsSchema, directoryDatasetSchema, editableAppSettingsSchema } from "../../shared/schemas/contact.js";
import { defaultContacts } from "../../shared/fixtures/defaultContacts.js";
import { defaultSettings } from "../../shared/fixtures/defaultSettings.js";
import type { AppSettings, BootstrapData, DirectoryDataset, EditableAppSettings } from "../../shared/types/contact.js";
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
    const source = await readJsonFile<DirectoryDataset>(getContactsFilePath());
    const safeTimestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupDirectory = getManagedBackupDirectory();
    await ensureDirectory(backupDirectory);
    const backupFilePath = path.join(backupDirectory, `contacts-${safeTimestamp}.json`);
    await writeJsonFile(backupFilePath, source);
    return backupFilePath;
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

  private async readSettings() {
    return appSettingsSchema.parse(
      await readJsonFile<AppSettings>(getSettingsFilePath())
    );
  }
}
