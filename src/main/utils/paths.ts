import { app } from "electron";
import path from "node:path";

export const getAppDataRoot = () => app.getPath("userData");

export const getManagedDataDirectory = () => path.join(getAppDataRoot(), "data");

export const getManagedBackupDirectory = () => path.join(getAppDataRoot(), "backups");

export const getContactsFilePath = () => path.join(getManagedDataDirectory(), "contacts.json");

export const getSettingsFilePath = () => path.join(getManagedDataDirectory(), "settings.json");
