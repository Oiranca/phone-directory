import fs from "node:fs/promises";
import { appSettingsSchema, directoryDatasetSchema } from "../../shared/schemas/contact.js";
import { defaultContacts } from "../../shared/fixtures/defaultContacts.js";
import { defaultSettings } from "../../shared/fixtures/defaultSettings.js";
import type { AppSettings, BootstrapData, DirectoryDataset } from "../../shared/types/contact.js";
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

    const settings = appSettingsSchema.parse(
      await readJsonFile<AppSettings>(getSettingsFilePath())
    );

    return { contacts, settings };
  }

  async saveSettings(settings: AppSettings) {
    const parsed = appSettingsSchema.parse(settings);
    await writeJsonFile(getSettingsFilePath(), parsed);
    return parsed;
  }

  async createBackup() {
    const source = await readJsonFile<DirectoryDataset>(getContactsFilePath());
    const safeTimestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupFilePath = `${getManagedBackupDirectory()}/contacts-${safeTimestamp}.json`;
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
}
