import type { AppSettings } from "../types/contact.js";

export const defaultSettings = (
  dataFilePath: string,
  backupDirectoryPath: string
): AppSettings => ({
  editorName: "",
  dataFilePath,
  backupDirectoryPath,
  managedPaths: {
    dataFilePath: true,
    backupDirectoryPath: true
  },
  ui: {
    showInactiveByDefault: false
  }
});
