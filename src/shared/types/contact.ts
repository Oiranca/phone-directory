// ---------------------------------------------------------------------------
// Stable persisted/IPC domain types — derived from Zod schemas.
// Do NOT hand-write these; edit schemas/contact.ts instead.
// ---------------------------------------------------------------------------
export type {
  PhoneContact,
  EmailContact,
  SocialPlatform,
  SocialContact,
  ContactRecord,
  DirectoryDataset,
  AutoBackupTrigger,
  AutoBackupSettings,
  AppSettings,
  EditableAppSettings,
  AuditAction,
  AuditLogEntry,
  AuditLogQueryParams,
} from "../schemas/contact.js";

import type { AreaType, RecordType } from "../constants/catalogs.js";
import type { AuditLogEntry, ContactRecord, EditableAppSettings, DirectoryDataset } from "../schemas/contact.js";

// ---------------------------------------------------------------------------
// UX-only and composite types — not duplicated by any Zod schema.
// ---------------------------------------------------------------------------

export interface AutoBackupFailureEvent {
  message: string;
}

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

// ---------------------------------------------------------------------------
// Editable (form/IPC-input) types — intentionally kept separate from the
// persisted-schema derived types above. The editablePhoneContactSchema,
// editableEmailContactSchema, and editableContactRecordSchema apply string
// transforms (.trim(), empty→undefined) and stricter validators (.email(),
// .min(1)) so their z.infer outputs differ from these hand-written interfaces.
// Using the schema-inferred types here would constrain the IPC payload shape
// more than necessary and would propagate transform side-effects into callers
// that don't go through Zod parsing.
// ---------------------------------------------------------------------------

export interface EditablePhoneContact {
  id: string;
  label?: string;
  number: string;
  extension?: string;
  kind: string;
  isPrimary: boolean;
  /**
   * Advisory presentation marker only — not an enforced access control; records and flagged values
   * remain fully searchable. See audit plan §4 P1-03 resolution (OIR-105).
   * NOTE: getPreferredResultPhone() in search.service.ts intentionally deprioritizes confidential
   * phones when selecting the default displayed number — this is UI convenience, not a security gate.
   */
  confidential: boolean;
  /**
   * Advisory presentation marker only — not an enforced access control; records and flagged values
   * remain fully searchable. See audit plan §4 P1-03 resolution (OIR-105).
   * NOTE: getPreferredResultPhone() in search.service.ts intentionally deprioritizes noPatientSharing
   * phones when selecting the default displayed number — this is UI convenience, not a security gate.
   */
  noPatientSharing: boolean;
  notes?: string;
}

export interface EditableEmailContact {
  id: string;
  address: string;
  label?: string;
  isPrimary: boolean;
}

/** Editable social-media contact entry (OIR-131). Mirrors EditablePhoneContact pattern. */
export interface EditableSocialContact {
  id: string;
  platform: import("../schemas/contact.js").SocialPlatform;
  handle?: string;
  url?: string;
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
    socials: EditableSocialContact[];
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
   * INTERIM (OIR-102 / OIR-134): Rows silently skipped because they belong to
   * Buscas (pager) sheets — a deferred import path. Always 0 for the CSV path.
   */
  buscasSkippedRowCount: number;
  /**
   * INTERIM (OIR-102 / OIR-134): Rows silently skipped because they are
   * social-media handle rows inside service sheets. Always 0 for the CSV path.
   */
  socialHandleSkippedRowCount: number;
  /**
   * OIR-130: Number of buscas (pager) cells successfully parsed from buscas sheets.
   * A value > 0 means the workbook contained valid buscas content even if validRowCount === 0.
   * Used by the renderer confirm gate to allow confirming buscas-only workbooks.
   * Always 0 for the CSV path and for workbooks with no buscas sheets.
   */
  parsedBuscasCellCount: number;
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

/**
 * Lean phone entry for conflict diff display (OIR-132).
 * Carries only what the diff renderer needs: number, label, kind.
 */
export interface ConflictPhoneSummary {
  number: string;
  label?: string;
  kind: string;
}

/**
 * Lean email entry for conflict diff display (OIR-132).
 */
export interface ConflictEmailSummary {
  address: string;
  label?: string;
}

/**
 * Lean social-media entry for conflict diff display (OIR-132).
 */
export interface ConflictSocialSummary {
  platform: import("../schemas/contact.js").SocialPlatform;
  handle?: string;
  url?: string;
  label?: string;
}

/**
 * Minimal record data sent to the renderer for import conflict previews.
 * Contains only the fields the conflict diff card actually renders.
 * Fields not displayed in the UI (type, area, status) are intentionally
 * excluded to keep the IPC payload minimal.
 */
export interface ConflictRecordSummary {
  id?: string;
  displayName: string;
  department?: string;
  service?: string;
  specialty?: string;
  /** Compact single-line location string, e.g. "Edificio A · Planta 2 · Hab 301". */
  locationSummary?: string;
  /** Lean phone list for field-level diff (OIR-132). */
  phones: ConflictPhoneSummary[];
  /** Lean email list for field-level diff (OIR-132). */
  emails: ConflictEmailSummary[];
  /** Lean social list for field-level diff (OIR-132). */
  socials: ConflictSocialSummary[];
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
  /**
   * The specific value that triggered the match (OIR-132).
   * For phone-match: the normalized phone number. For email-match: the email address.
   * Not populated for external-id-match (raw IDs are not rendered to the user).
   */
  matchingFieldValue?: string;
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
  /**
   * OIR-200: Rejected rows are skipped rather than blocking the whole import.
   * This carries the same per-row reasons already surfaced in the preview
   * (CsvImportPreview.rowIssues) so the post-import summary can list exactly
   * which rows were skipped and why.
   */
  rowIssues: CsvImportIssue[];
}

/**
 * OIR-219 — discriminated-union response for pickAndImportDataset, the single
 * unified "Importar" entry point. Lets the renderer route to whichever
 * existing UI matches the flow that main actually dispatched to, without ever
 * receiving a file path back:
 *   - "json-import"           → reuse the existing JSON full-replace result handling
 *   - "csv-preview"           → reuse the existing CsvImportPreviewPanel/confirm flow
 *   - "unsupported-extension" → the OS dialog filter was somehow bypassed
 *   - "cancelled"             → the user closed the dialog without picking a file
 *
 * See src/shared/schemas/pick-and-import.schema.ts for the runtime envelope schema.
 */
export type PickAndImportDatasetResult =
  | { kind: "json-import"; result: ImportContactsResult }
  | { kind: "csv-preview"; preview: CsvImportPreviewWithConflicts }
  | { kind: "unsupported-extension"; extension: string }
  | { kind: "cancelled" };

export interface AuditLogResult {
  entries: AuditLogEntry[];
  totalCount: number;
}

export interface ExportAuditLogResult {
  filePath: string;
  exportedAt: string;
  entryCount: number;
}
