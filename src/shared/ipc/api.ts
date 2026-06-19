/**
 * HospitalDirectoryApi — single source of truth for the Electron context-bridge public API.
 *
 * This interface is the authoritative contract between the preload script and the renderer.
 * - The preload implementation is typed against this interface so any missing or mis-typed
 *   method fails `tsc` immediately (tsconfig.electron.json).
 * - The renderer ambient declaration derives `window.hospitalDirectory` from this interface
 *   (tsconfig.app.json) so any renderer call-site that diverges also fails typecheck.
 *
 * IPC channel-name strings are intentionally kept out of this file — they are private to
 * the main/preload side only (src/shared/ipc/channels.ts).
 *
 * Do NOT import channel names or Electron internals here. Only shared payload types.
 */
import type {
  AutoBackupFailureEvent,
  BackupListItem,
  BootstrapResult,
  ContactRecord,
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
} from "../types/contact.js";
import type { BuscaRecord, EditableBuscaRecord } from "../schemas/busca.schema.js";
import type { DuplicateDetectionResult } from "../types/duplicate.js";

export interface HospitalDirectoryApi {
  // Bootstrap & data
  getBootstrapData: () => Promise<BootstrapResult>;

  // Settings
  getSettingsDefaults: () => Promise<EditableAppSettings>;
  saveSettings: (settings: EditableAppSettings) => Promise<EditableAppSettings>;
  browseForPath: (type: "dataFile" | "backupDirectory") => Promise<string | null>;

  // Contacts — CRUD
  createRecord: (record: EditableContactRecord) => Promise<SaveContactResult>;
  updateRecord: (recordId: string, record: EditableContactRecord) => Promise<SaveContactResult>;

  // Backups
  createBackup: () => Promise<string>;
  listBackups: () => Promise<BackupListItem[]>;
  restoreBackup: (backupFilePath: string) => Promise<ImportContactsResult>;

  // Dataset import/export
  exportDataset: () => Promise<ExportContactsResult | null>;
  importDataset: () => Promise<ImportContactsResult | null>;
  resetDataset: () => Promise<ResetContactsResult>;

  // CSV import
  previewCsvImport: () => Promise<CsvImportPreviewWithConflicts | null>;
  importCsvDataset: (importToken: string, policies?: CsvImportPolicySelection[]) => Promise<CsvImportResult>;

  // Audit log
  getAuditLog: (params: AuditLogQueryParams) => Promise<AuditLogResult>;
  exportAuditLog: (params: AuditLogQueryParams) => Promise<ExportAuditLogResult | null>;
  recoverAuditLog: () => Promise<void>;

  // Buscas
  listBuscas: () => Promise<BuscaRecord[]>;
  addBusca: (record: EditableBuscaRecord) => Promise<BuscaRecord>;
  updateBusca: (id: string, record: EditableBuscaRecord) => Promise<BuscaRecord>;
  deleteBusca: (id: string) => Promise<void>;

  // Duplicate detection & merge
  detectDuplicates: () => Promise<DuplicateDetectionResult>;
  mergeContacts: (req: { keepId: string; discardId: string }) => Promise<ContactRecord>;

  // Push events from main → renderer
  onAutoBackupFailure: (listener: (event: AutoBackupFailureEvent) => void) => () => void;
}
