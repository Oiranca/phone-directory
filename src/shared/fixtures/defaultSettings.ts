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
    showInactiveByDefault: false,
    autoBackup: {
      enabled: false,
      trigger: "launch",
      intervalHours: 2,
      editCountThreshold: 10,
      retentionCount: 5
    }
  }
});
