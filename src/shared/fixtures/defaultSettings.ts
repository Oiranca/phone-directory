import type { AppSettings } from "../types/contact.js";

export const defaultSettings = (dataFilePath: string, backupDirectoryPath: string): AppSettings => ({
  editorName: "",
  dataFilePath,
  backupDirectoryPath,
  ui: {
    showInactiveByDefault: false
  }
});
