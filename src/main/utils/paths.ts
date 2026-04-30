import { app } from "electron";
import path from "node:path";

export const getAppDataRoot = () => app.getPath("userData");

export const getManagedPaths = (appDataRoot: string) => ({
  appDataRoot,
  dataDirectory: path.join(appDataRoot, "data"),
  backupDirectory: path.join(appDataRoot, "backups"),
  contactsFilePath: path.join(appDataRoot, "data", "contacts.json"),
  settingsFilePath: path.join(appDataRoot, "data", "settings.json")
});

export const getManagedDataDirectory = () => getManagedPaths(getAppDataRoot()).dataDirectory;

export const getManagedBackupDirectory = () => getManagedPaths(getAppDataRoot()).backupDirectory;

export const getContactsFilePath = () => getManagedPaths(getAppDataRoot()).contactsFilePath;

export const getSettingsFilePath = () => getManagedPaths(getAppDataRoot()).settingsFilePath;
