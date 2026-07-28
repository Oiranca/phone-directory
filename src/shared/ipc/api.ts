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
  ImportContactsResult,
  PickAndImportDatasetResult,
  ResetContactsResult,
  SaveContactResult
} from "../types/contact.js";
import type { BeeperRecord, EditableBeeperRecord, ImportedBeeperRecord } from "../schemas/beeper.schema.js";
import type { MergeContactsOverrides } from "../schemas/merge-contacts.schema.js";
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

  // Unified single-picker import entry point. Opens one native
  // dialog and dispatches by extension to importDataset()/previewCsvImport().
  pickAndImportDataset: () => Promise<PickAndImportDatasetResult>;

  // Beepers — manual registry
  listBeepers: () => Promise<BeeperRecord[]>;
  addBeeper: (record: EditableBeeperRecord) => Promise<BeeperRecord>;
  updateBeeper: (id: string, record: EditableBeeperRecord) => Promise<BeeperRecord>;
  deleteBeeper: (id: string) => Promise<void>;

  // Beepers — ODS-imported (read-only from renderer side)
  listImportedBeepers: () => Promise<ImportedBeeperRecord[]>;

  // Duplicate detection & merge
  detectDuplicates: () => Promise<DuplicateDetectionResult>;
  mergeContacts: (req: {
    keepId: string;
    discardId: string;
    overrides?: MergeContactsOverrides;
  }) => Promise<ContactRecord>;

  // Push events from main → renderer
  onAutoBackupFailure: (listener: (event: AutoBackupFailureEvent) => void) => () => void;
}
