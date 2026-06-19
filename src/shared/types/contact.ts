import type { AreaType, RecordType } from "../constants/catalogs.js";

export interface PhoneContact {
  id: string;
  label?: string;
  number: string;
  extension?: string;
  kind: string;
  isPrimary: boolean;
  /** Advisory presentation marker only — not an enforced access control. See audit plan §4 P1-03 resolution (OIR-105). */
  confidential: boolean;
  /** Advisory presentation marker only — not an enforced access control. See audit plan §4 P1-03 resolution (OIR-105). */
  noPatientSharing: boolean;
  notes?: string;
}

export interface EmailContact {
  id: string;
  address: string;
  label?: string;
  isPrimary: boolean;
}

export interface ContactRecord {
  id: string;
  externalId?: string;
  type: RecordType;
  displayName: string;
  person?: {
    firstName?: string;
    lastName?: string;
  };
  organization: {
    department?: string;
    service?: string;
    area?: AreaType;
    specialty?: string;
  };
  location?: {
    building?: string;
    floor?: string;
    room?: string;
    text?: string;
  };
  contactMethods: {
    phones: PhoneContact[];
    emails: EmailContact[];
  };
  aliases: string[];
  tags: string[];
  notes?: string;
  status: "active" | "inactive";
  source?: {
    externalId?: string;
    sheetSlug?: string;
    sheetRow?: string;
  };
  audit: {
    createdAt: string;
    updatedAt: string;
    createdBy: string;
    updatedBy: string;
  };
}

export interface DirectoryDataset {
  version: string;
  exportedAt: string;
  metadata: {
    recordCount: number;
    generatedFrom: string;
    generatedBy: string;
    editorName: string;
    typeCounts: Partial<Record<RecordType, number>>;
    areaCounts: Partial<Record<AreaType, number>>;
  };
  catalogs: {
    recordTypes: RecordType[];
    areas: AreaType[];
  };
  records: ContactRecord[];
}

export interface AppSettings {
  editorName: string;
  dataFilePath: string;
  backupDirectoryPath: string;
  managedPaths?: {
    dataFilePath: boolean;
    backupDirectoryPath: boolean;
  };
  ui: {
    showInactiveByDefault: boolean;
    autoBackup: AutoBackupSettings;
  };
}

export type AutoBackupTrigger = "launch" | "intervalHours" | "editCount";

export interface AutoBackupSettings {
  enabled: boolean;
  trigger: AutoBackupTrigger;
  intervalHours: number;
  editCountThreshold: number;
  retentionCount: number;
}

export interface AutoBackupFailureEvent {
  message: string;
}

// EditableAppSettings is structurally derived from AppSettings so that adding a
// field to AppSettings.ui forces a review of this type. If AppSettings.ui gains
// new fields they will automatically appear here too.
export type EditableAppSettings = Pick<
  AppSettings,
  "editorName" | "dataFilePath" | "backupDirectoryPath" | "ui"
>;

export interface BootstrapData {
  contacts: DirectoryDataset;
  settings: EditableAppSettings;
}

export interface RecoveryState {
  reason: "invalid-contacts-json";
  contactsFilePath: string;
  message: string;
  details?: string;
}

export interface RecoveryBootstrapData {
  recovery: RecoveryState;
  settings: EditableAppSettings;
}

export type BootstrapResult = BootstrapData | RecoveryBootstrapData;

export const isRecoveryBootstrap = (payload: BootstrapResult): payload is RecoveryBootstrapData =>
  "recovery" in payload;

export interface EditablePhoneContact {
  id: string;
  label?: string;
  number: string;
  extension?: string;
  kind: string;
  isPrimary: boolean;
  /** Advisory presentation marker only — not an enforced access control. See audit plan §4 P1-03 resolution (OIR-105). */
  confidential: boolean;
  /** Advisory presentation marker only — not an enforced access control. See audit plan §4 P1-03 resolution (OIR-105). */
  noPatientSharing: boolean;
  notes?: string;
}

export interface EditableEmailContact {
  id: string;
  address: string;
  label?: string;
  isPrimary: boolean;
}

export interface EditableContactRecord {
  id?: string;
  externalId?: string;
  type: RecordType;
  displayName: string;
  person?: {
    firstName?: string;
    lastName?: string;
  };
  organization: {
    department?: string;
    service?: string;
    area?: AreaType;
    specialty?: string;
  };
  location?: {
    building?: string;
    floor?: string;
    room?: string;
    text?: string;
  };
  contactMethods: {
    phones: EditablePhoneContact[];
    emails: EditableEmailContact[];
  };
  aliases: string[];
  tags: string[];
  notes?: string;
  status: "active" | "inactive";
}

export interface SaveContactResult extends BootstrapData {
  savedRecordId: string;
}

export interface BackupListItem {
  fileName: string;
  filePath: string;
  createdAt: string;
  sizeBytes: number;
}

export interface ExportContactsResult {
  filePath: string;
  exportedAt: string;
  recordCount: number;
}

export interface ImportContactsResult extends BootstrapData {
  backupPath: string;
  importedFilePath: string;
  recordCount: number;
}

export interface ResetContactsResult extends BootstrapData {
  backupPath: string | null;
}

export interface CsvImportIssue {
  rowNumber: number;
  displayName?: string;
  messages: string[];
}

export interface CsvImportWarning {
  rowNumber: number;
  displayName?: string;
  message: string;
}

export type CsvImportRowStatus = "accepted" | "warning" | "rejected";

export interface CsvImportPreviewRow {
  rowNumber: number;
  status: CsvImportRowStatus;
  displayName?: string;
  type?: string;
  department?: string;
  area?: string;
  phone1Number?: string;
  email1?: string;
  errorMessages?: string[];
  warningMessages?: string[];
}

export interface CsvImportPreview {
  importToken: string;
  sourceFilePath: string;
  fileName: string;
  detectedFormat?: string;
  detectionConfidence?: "high" | "medium" | "low";
  totalRowCount: number;
  validRowCount: number;
  invalidRowCount: number;
  warningCount: number;
  recordCount: number;
  mergedRecordCount: number;
  createdCount: number;
  updatedCount: number;
  /**
   * INTERIM (OIR-102): Number of rows silently skipped because they belong to
   * a deferred feature (Buscas pager sheets or social-media handle rows).
   * Not contacts, do not block import, but operators should know they were omitted.
   * Always 0 for the CSV import path.
   */
  deferredSkippedRowCount: number;
  typeCounts: Partial<Record<RecordType, number>>;
  areaCounts: Partial<Record<AreaType, number>>;
  rowIssues: CsvImportIssue[];
  warnings: CsvImportWarning[];
  previewRows: CsvImportPreviewRow[];
}

/** The mechanism by which a conflict was detected between an imported record and an existing one. */
export type ConflictType = "external-id-match" | "phone-match" | "email-match";

/** How to resolve a conflict between an imported record and an existing record during bulk import. */
export type MergePolicy = "overwrite" | "skip" | "merge-fields";

export interface CsvImportPolicySelection {
  recordIndex: number;
  policy: MergePolicy;
}

/** Minimal record data safe to expose in import conflict previews. */
export interface ConflictRecordSummary {
  id?: string;
  externalId?: string;
  type: RecordType;
  displayName: string;
  department?: string;
  service?: string;
  area?: AreaType;
  status: ContactRecord["status"];
}

/** Represents a single imported record that collides with an existing record in the directory. */
export interface ConflictedImportRecord {
  /** Zero-based index of the imported record in the dataset (used internally; not the CSV row number shown to users). */
  recordIndex: number;
  /** Minimal summary of the record parsed from the import file. */
  importedRecord: ConflictRecordSummary;
  /** Minimal summary of the record that caused the collision. */
  matchingRecord: ConflictRecordSummary;
  /** Zero-based index of the matching existing/imported record in its source dataset. */
  matchingRecordIndex: number;
  /** Whether the match came from saved data or an earlier imported row. */
  matchingRecordSource: "existing" | "import";
  /** How the conflict was detected. */
  conflictType: ConflictType;
  /** I18n key for conflict reason (e.g., "conflict_reason.phone_match"). Resolved in the renderer for localization. */
  conflictReasonKey: string;
  /** Resolution policy chosen by the user; undefined until the user selects one. */
  selectedPolicy?: MergePolicy;
}

/** Extends CsvImportPreview with per-record conflict information for the conflict-resolution UI. */
export interface CsvImportPreviewWithConflicts extends CsvImportPreview {
  /** Total number of conflicting rows detected. */
  conflictCount: number;
  /** Detail of each conflicting row, including the matched existing record. */
  conflictedRecords: ConflictedImportRecord[];
  /** True once every conflict has a selectedPolicy assigned. */
  policiesResolved: boolean;
}

export interface CsvImportResult extends ImportContactsResult {
  warningCount: number;
  invalidRowCount: number;
  createdCount: number;
  updatedCount: number;
  conflictCount: number;
  conflictPolicyCounts?: Partial<Record<MergePolicy, number>>;
}

export type AuditAction = "create" | "update" | "delete" | "bulk-import" | "restore-from-backup" | "reset";

export interface AuditLogEntry {
  timestamp: string;
  editor: string;
  action: AuditAction;
  recordId?: string;
  recordName?: string;
  changes?: Record<string, { old?: unknown; new?: unknown }> | null;
  reason?: string | null;
  recordsAffected?: number;
  importSource?: string;
}

export interface AuditLogQueryParams {
  fromDate?: string;
  toDate?: string;
  editor?: string;
  action?: AuditAction;
  recordName?: string;
}

export interface AuditLogResult {
  entries: AuditLogEntry[];
  totalCount: number;
}

export interface ExportAuditLogResult {
  filePath: string;
  exportedAt: string;
  entryCount: number;
}
