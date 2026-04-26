/// <reference types="vite/client" />

import type {
  BackupListItem,
  BootstrapResult,
  CsvImportPreview,
  CsvImportResult,
  EditableAppSettings,
  EditableContactRecord,
  ExportContactsResult,
  ImportContactsResult,
  ResetContactsResult,
  SaveContactResult
} from "../shared/types/contact";

declare global {
  interface Window {
    hospitalDirectory: {
      getBootstrapData: () => Promise<BootstrapResult>;
      getSettingsDefaults: () => Promise<EditableAppSettings>;
      saveSettings: (settings: EditableAppSettings) => Promise<EditableAppSettings>;
      createBackup: () => Promise<string>;
      createRecord: (record: EditableContactRecord) => Promise<SaveContactResult>;
      updateRecord: (recordId: string, record: EditableContactRecord) => Promise<SaveContactResult>;
      listBackups: () => Promise<BackupListItem[]>;
      exportDataset: () => Promise<ExportContactsResult | null>;
      importDataset: () => Promise<ImportContactsResult | null>;
      resetDataset: () => Promise<ResetContactsResult>;
      previewCsvImport: () => Promise<CsvImportPreview | null>;
      importCsvDataset: (importToken: string) => Promise<CsvImportResult>;
    };
  }
}

export {};
