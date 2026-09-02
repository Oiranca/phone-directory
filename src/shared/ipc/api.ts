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
  BootstrapData,
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
import type { BeeperRecord, EditableBeeperRecord, EditableImportedBeeperRecord, ImportedBeeperRecord } from "../schemas/beeper.schema.js";
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
  deleteRecord: (recordId: string) => Promise<BootstrapData>;

  // Backups
  // The resolved absolute backup path is main-process-only — no renderer
  // caller needs it. See contacts.ipc.ts createBackup handler. (OIR-276)
  createBackup: () => Promise<void>;
  listBackups: () => Promise<BackupListItem[]>;
  // Takes a bare backup file name (as returned by listBackups()'s fileName
  // field) rather than an absolute path — the renderer never resolves or
  // sees the real backup directory location. The main process resolves the
  // fileName against the canonical backup directory and rejects any name
  // containing path separators or "..". (OIR-276)
  restoreBackup: (backupFileName: string) => Promise<ImportContactsResult>;

  // Dataset import/export
  exportDataset: () => Promise<ExportContactsResult | null>;
  importDataset: () => Promise<ImportContactsResult | null>;
  resetDataset: () => Promise<ResetContactsResult>;

  // CSV import
  previewCsvImport: () => Promise<CsvImportPreviewWithConflicts | null>;
  cancelCsvImportPreview: () => Promise<void>;
  importCsvDataset: (importToken: string, policies?: CsvImportPolicySelection[]) => Promise<CsvImportResult>;

  // Unified single-picker import entry point. Opens one native
  // dialog and dispatches by extension to importDataset()/previewCsvImport().
  pickAndImportDataset: () => Promise<PickAndImportDatasetResult>;

  // Beepers — manual registry
  listBeepers: () => Promise<BeeperRecord[]>;
  addBeeper: (record: EditableBeeperRecord) => Promise<BeeperRecord>;
  updateBeeper: (id: string, record: EditableBeeperRecord) => Promise<BeeperRecord>;
  deleteBeeper: (id: string) => Promise<void>;

  // Beepers — ODS-imported
  listImportedBeepers: () => Promise<ImportedBeeperRecord[]>;
  updateImportedBeeper: (id: string, record: EditableImportedBeeperRecord) => Promise<ImportedBeeperRecord>;

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
