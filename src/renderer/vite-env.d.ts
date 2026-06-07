/// <reference types="vite/client" />

import type {
  AutoBackupFailureEvent,
  BackupListItem,
  BootstrapResult,
  CsvImportPolicySelection,
  CsvImportPreviewWithConflicts,
  CsvImportResult,
  EditableAppSettings,
  EditableContactRecord,
  ExportContactsResult,
  AuditLogQueryParams,
  AuditLogResult,
  ExportAuditLogResult,
  ImportContactsResult,
  ResetContactsResult,
  SaveContactResult
} from "../shared/types/contact";
import type { BuscaRecord, EditableBuscaRecord } from "../shared/schemas/busca.schema";

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
      restoreBackup: (backupFilePath: string) => Promise<ImportContactsResult>;
      exportDataset: () => Promise<ExportContactsResult | null>;
      importDataset: () => Promise<ImportContactsResult | null>;
      resetDataset: () => Promise<ResetContactsResult>;
      previewCsvImport: () => Promise<CsvImportPreviewWithConflicts | null>;
      importCsvDataset: (importToken: string, policies?: CsvImportPolicySelection[]) => Promise<CsvImportResult>;
      browseForPath: (type: "dataFile" | "backupDirectory") => Promise<string | null>;
      getAuditLog: (params: AuditLogQueryParams) => Promise<AuditLogResult>;
      exportAuditLog: (params: AuditLogQueryParams) => Promise<ExportAuditLogResult | null>;
      listBuscas: () => Promise<BuscaRecord[]>;
      addBusca: (record: EditableBuscaRecord) => Promise<BuscaRecord>;
      updateBusca: (id: string, record: EditableBuscaRecord) => Promise<BuscaRecord>;
      deleteBusca: (id: string) => Promise<void>;
      searchBuscas: (query: string) => Promise<BuscaRecord[]>;
      onAutoBackupFailure: (listener: (event: AutoBackupFailureEvent) => void) => () => void;
    };
  }
}

export {};
