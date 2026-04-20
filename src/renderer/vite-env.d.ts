/// <reference types="vite/client" />

import type {
  BackupListItem,
  BootstrapData,
  CsvImportPreview,
  CsvImportResult,
  EditableAppSettings,
  EditableContactRecord,
  ExportContactsResult,
  ImportContactsResult,
  SaveContactResult
} from "../shared/types/contact";

declare global {
  interface Window {
    hospitalDirectory: {
      getBootstrapData: () => Promise<BootstrapData>;
      saveSettings: (settings: EditableAppSettings) => Promise<EditableAppSettings>;
      createBackup: () => Promise<string>;
      createRecord: (record: EditableContactRecord) => Promise<SaveContactResult>;
      updateRecord: (recordId: string, record: EditableContactRecord) => Promise<SaveContactResult>;
      listBackups: () => Promise<BackupListItem[]>;
      exportDataset: () => Promise<ExportContactsResult | null>;
      importDataset: () => Promise<ImportContactsResult | null>;
      previewCsvImport: () => Promise<CsvImportPreview | null>;
      importCsvDataset: (importToken: string) => Promise<CsvImportResult>;
    };
  }
}

export {};
