import { app } from "electron";
import path from "node:path";

export const getAppDataRoot = () => app.getPath("userData");

export const getManagedPaths = (appDataRoot: string) => ({
  appDataRoot,
  dataDirectory: path.join(appDataRoot, "data"),
  backupDirectory: path.join(appDataRoot, "backups"),
  contactsFilePath: path.join(appDataRoot, "data", "contacts.json"),
  settingsFilePath: path.join(appDataRoot, "data", "settings.json"),
  auditLogFilePath: path.join(appDataRoot, "data", "audit-log.json"),
  beepersFilePath: path.join(appDataRoot, "data", "beepers.json"),
  // Legacy store name (pre-OIR-271 rename). Used only to migrate existing user data
  // on first load — never written to.
  legacyBeepersFilePath: path.join(appDataRoot, "data", "buscas.json"),
  crashLogFilePath: path.join(appDataRoot, "data", "crash-log.jsonl")
});

export const getManagedDataDirectory = () => getManagedPaths(getAppDataRoot()).dataDirectory;

export const getAuditLogFilePath = () => getManagedPaths(getAppDataRoot()).auditLogFilePath;

export const getManagedBackupDirectory = () => getManagedPaths(getAppDataRoot()).backupDirectory;

export const getContactsFilePath = () => getManagedPaths(getAppDataRoot()).contactsFilePath;

export const getBeepersFilePath = () => getManagedPaths(getAppDataRoot()).beepersFilePath;

export const getLegacyBeepersFilePath = () => getManagedPaths(getAppDataRoot()).legacyBeepersFilePath;

export const getSettingsFilePath = () => getManagedPaths(getAppDataRoot()).settingsFilePath;

export const getCrashLogFilePath = () => getManagedPaths(getAppDataRoot()).crashLogFilePath;
