import type { AreaType, RecordType } from "../constants/catalogs.js";

export interface PhoneContact {
  id: string;
  label?: string;
  number: string;
  extension?: string;
  kind: string;
  isPrimary: boolean;
  confidential: boolean;
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
  ui: {
    showInactiveByDefault: boolean;
  };
}

export interface EditableAppSettings {
  editorName: string;
  ui: {
    showInactiveByDefault: boolean;
  };
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

export interface EditablePhoneContact {
  id: string;
  label?: string;
  number: string;
  extension?: string;
  kind: string;
  isPrimary: boolean;
  confidential: boolean;
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

export interface CsvImportPreview {
  importToken: string;
  sourceFilePath: string;
  fileName: string;
  totalRowCount: number;
  validRowCount: number;
  invalidRowCount: number;
  warningCount: number;
  recordCount: number;
  typeCounts: Partial<Record<RecordType, number>>;
  areaCounts: Partial<Record<AreaType, number>>;
  rowIssues: CsvImportIssue[];
  warnings: CsvImportWarning[];
}

export interface CsvImportResult extends ImportContactsResult {
  warningCount: number;
  invalidRowCount: number;
}
