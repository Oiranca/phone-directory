import fs from "node:fs/promises";
import path from "node:path";
import Papa from "papaparse";
import { AREAS, RECORD_TYPES } from "../../shared/constants/catalogs.js";
import type { AreaType } from "../../shared/constants/catalogs.js";
import { contactRecordSchema, directoryDatasetSchema } from "../../shared/schemas/contact.js";
import type {
  ContactRecord,
  CsvImportIssue,
  CsvImportPreview,
  CsvImportPreviewRow,
  CsvImportWarning,
  DirectoryDataset,
  PhoneContact,
  EmailContact
} from "../../shared/types/contact.js";
import { computeMetadataCounts } from "../../shared/utils/matching.js";

/**
 * Internal-only extension of CsvImportPreview that carries the absolute
 * sourceFilePath.  This field is stripped at the IPC boundary (OIR-115) and
 * must never reach the renderer.
 */
export type CsvImportPreviewInternal = CsvImportPreview & { sourceFilePath: string };
import { isSerializedPhoneEntry } from "./spreadsheet-normalize.js";
import type { SerializedPhoneEntry } from "./spreadsheet-normalize.js";

const REQUIRED_COLUMNS = ["type", "displayName"] as const;
const SUPPORTED_COLUMNS = [
  "externalId",
  "type",
  "displayName",
  "firstName",
  "lastName",
  "area",
  "department",
  "service",
  "specialty",
  "building",
  "floor",
  "room",
  "locationText",
  "phone1Label",
  "phone1Number",
  "phone1Extension",
  "phone1Kind",
  "phone1IsPrimary",
  "phone1Confidential",
  "phone1NoPatientSharing",
  "phone1Notes",
  "phone2Label",
  "phone2Number",
  "phone2Extension",
  "phone2Kind",
  "phone2IsPrimary",
  "phone2Confidential",
  "phone2NoPatientSharing",
  "phone2Notes",
  "email1",
  "email1Label",
  "email1IsPrimary",
  "email2",
  "email2Label",
  "email2IsPrimary",
  "tags",
  "aliases",
  "notes",
  "status"
] as const;
const SUPPORTED_PHONE_KINDS = new Set(["internal", "external", "mobile", "fax", "other"]);
const SUPPORTED_STATUSES = new Set(["active", "inactive"]);
const MAX_CSV_IMPORT_SIZE_BYTES = 5 * 1024 * 1024;
const MAX_CSV_IMPORT_ROWS = 5000;

export type NormalizedImportRow = Record<string, string>;

const stripBom = (value: string) => value.replace(/^\uFEFF/, "");

const validateCsvHeaders = (rawSource: string) => {
  const headerResult = Papa.parse<string[]>(rawSource, {
    preview: 1,
    skipEmptyLines: "greedy",
    transform: (value: string) => stripBom(value).trim()
  });

  if (headerResult.errors.length > 0) {
    throw new Error(`No se pudo leer la cabecera del CSV: ${headerResult.errors[0]?.message ?? "error desconocido"}.`);
  }

  const rawHeaders = headerResult.data[0]?.map((header) => stripBom(header).trim()) ?? [];

  if (rawHeaders.length === 0) {
    throw new Error("El CSV no incluye una fila de cabecera válida.");
  }

  if (rawHeaders.some((header) => header.length === 0)) {
    throw new Error("La cabecera del CSV contiene columnas vacías. Corrige la plantilla antes de importarla.");
  }

  const duplicateHeaders = rawHeaders.filter((header, index) => rawHeaders.indexOf(header) !== index);

  if (duplicateHeaders.length > 0) {
    throw new Error(
      `La cabecera del CSV repite columnas: ${[...new Set(duplicateHeaders)].join(", ")}. Corrige la plantilla antes de importarla.`
    );
  }

  const missingColumns = REQUIRED_COLUMNS.filter((column) => !rawHeaders.includes(column));

  if (missingColumns.length > 0) {
    throw new Error(`El CSV no incluye las columnas obligatorias: ${missingColumns.join(", ")}.`);
  }

  const unsupportedColumns = rawHeaders.filter(
    (header) => !(SUPPORTED_COLUMNS as readonly string[]).includes(header)
  );

  if (unsupportedColumns.length > 0) {
    throw new Error(
      `La cabecera del CSV contiene columnas fuera de la plantilla MVP: ${unsupportedColumns.join(", ")}. Usa la plantilla oficial antes de importar.`
    );
  }
};

const maybe = (value: string | undefined) => {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : undefined;
};

const parseBoolean = (value: string | undefined) => (value?.trim().toLowerCase() ?? "") === "true";

const dedupeList = (value: string | undefined) => {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const part of (value ?? "").split("|").map((item) => item.trim()).filter(Boolean)) {
    const normalized = part.toLowerCase();

    if (seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    result.push(part);
  }

  return result;
};

const compactObject = <T extends Record<string, unknown>>(value: T) =>
  Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined && item !== "")
  ) as T;

const buildSource = (externalId: string | undefined) => {
  if (!externalId) {
    return undefined;
  }

  const separatorIndex = externalId.lastIndexOf("-");

  if (separatorIndex === -1) {
    return { externalId };
  }

  return compactObject({
    externalId,
    sheetSlug: externalId.slice(0, separatorIndex),
    sheetRow: externalId.slice(separatorIndex + 1)
  });
};

const ensureSinglePrimary = <T extends { isPrimary: boolean }>(
  items: T[],
  warningMessage: string,
  warnings: CsvImportWarning[],
  rowNumber: number,
  displayName: string | undefined
) => {
  const primaryIndexes = items
    .map((item, index) => (item.isPrimary ? index : -1))
    .filter((index) => index !== -1);

  if (primaryIndexes.length > 1) {
    warnings.push({
      rowNumber,
      displayName,
      message: warningMessage
    });
  }

  if (items.length === 0) {
    return items;
  }

  const primaryIndex = primaryIndexes[0] ?? 0;

  return items.map((item, index) => ({
    ...item,
    isPrimary: index === primaryIndex
  }));
};

const buildPhones = (
  row: NormalizedImportRow,
  rowNumber: number,
  displayName: string | undefined,
  warnings: CsvImportWarning[]
) => {
  // When the row carries the structured `phones` JSON field (emitted by the
  // spreadsheet normalizer), use it directly — it may contain more than two
  // numbers and each already carries its source-sheet label.  The CSV import
  // path does not set this field and continues to use phone1/phone2 columns.
  const rawPhonesJson = maybe(row.phones);

  if (rawPhonesJson) {
    let entries: SerializedPhoneEntry[] = [];

    try {
      const parsed = JSON.parse(rawPhonesJson);
      if (Array.isArray(parsed)) {
        // Bug 4 fix: validate each entry at runtime before use.
        // A crafted CSV with phones:[{"number":null}] would previously cause
        // normalizeNumberForDedup(entry.number) to throw on a non-string value.
        // Invalid entries are silently dropped; valid ones are kept.
        entries = (parsed as unknown[]).filter(isSerializedPhoneEntry);
      }
    } catch {
      // Malformed JSON: fall through to phone1/phone2 path below.
    }

    if (entries.length > 0) {
      const phones: PhoneContact[] = entries.map((entry, index) =>
        compactObject({
          id: `ph_${rowNumber}_${index + 1}`,
          label: entry.label || undefined,
          number: entry.number,
          kind: SUPPORTED_PHONE_KINDS.has(entry.kind) ? entry.kind : "internal",
          isPrimary: index === 0,
          confidential: entry.confidential,
          noPatientSharing: entry.noPatientSharing,
          notes: entry.notes || undefined
        }) as PhoneContact
      );

      // ensureSinglePrimary is a no-op here (we already set index 0 as
      // primary) but call it for invariant safety.
      return ensureSinglePrimary(
        phones,
        "Se marcaron varios teléfonos como principales. Solo el primero se conservará como principal.",
        warnings,
        rowNumber,
        displayName
      );
    }
  }

  // CSV import path: read phone1 / phone2 flat columns.
  const phones: PhoneContact[] = [];

  for (const prefix of ["phone1", "phone2"] as const) {
    const number = maybe(row[`${prefix}Number`]);

    if (!number) {
      continue;
    }

    const rawKind = maybe(row[`${prefix}Kind`])?.toLowerCase();
    let kind = rawKind ?? "other";

    if (!SUPPORTED_PHONE_KINDS.has(kind)) {
      warnings.push({
        rowNumber,
        displayName,
        message: `El tipo de teléfono "${rawKind}" no está soportado y se normalizó como "other".`
      });
      kind = "other";
    }

    phones.push(
      compactObject({
        id: `ph_${rowNumber}_${phones.length + 1}`,
        label: maybe(row[`${prefix}Label`]),
        number,
        extension: maybe(row[`${prefix}Extension`]),
        kind,
        isPrimary: parseBoolean(row[`${prefix}IsPrimary`]),
        confidential: parseBoolean(row[`${prefix}Confidential`]),
        noPatientSharing: parseBoolean(row[`${prefix}NoPatientSharing`]),
        notes: maybe(row[`${prefix}Notes`])
      }) as PhoneContact
    );
  }

  return ensureSinglePrimary(
    phones,
    "Se marcaron varios teléfonos como principales. Solo el primero se conservará como principal.",
    warnings,
    rowNumber,
    displayName
  );
};

const buildEmails = (
  row: NormalizedImportRow,
  rowNumber: number,
  displayName: string | undefined,
  warnings: CsvImportWarning[]
) => {
  const emails: EmailContact[] = [];

  for (const prefix of ["email1", "email2"] as const) {
    const address = maybe(row[prefix]);

    if (!address) {
      continue;
    }

    emails.push(
      compactObject({
        id: `em_${rowNumber}_${emails.length + 1}`,
        address,
        label: maybe(row[`${prefix}Label`]),
        isPrimary: parseBoolean(row[`${prefix}IsPrimary`])
      }) as EmailContact
    );
  }

  return ensureSinglePrimary(
    emails,
    "Se marcaron varios correos como principales. Solo el primero se conservará como principal.",
    warnings,
    rowNumber,
    displayName
  );
};

const buildDataset = (records: ContactRecord[], editorName: string) => {
  const exportedAt = new Date().toISOString();
  const { typeCounts, areaCounts } = computeMetadataCounts(records);

  return directoryDatasetSchema.parse({
    version: "1.0.0",
    exportedAt,
    metadata: {
      recordCount: records.length,
      generatedFrom: "csv-import",
      generatedBy: "app-csv-import",
      editorName,
      typeCounts,
      areaCounts
    },
    catalogs: {
      recordTypes: [...RECORD_TYPES],
      areas: [...AREAS]
    },
    records
  } satisfies DirectoryDataset);
};

export const buildCsvImportPreview = async (
  sourceFilePath: string,
  editorName: string
): Promise<{ dataset: DirectoryDataset; preview: CsvImportPreviewInternal }> => {
  const sourceStats = await fs.stat(sourceFilePath);

  if (sourceStats.size > MAX_CSV_IMPORT_SIZE_BYTES) {
    throw new Error("El CSV supera el tamaño máximo permitido de 5 MB. Divide el archivo antes de importarlo.");
  }

  const rawSource = await fs.readFile(sourceFilePath, "utf-8");
  validateCsvHeaders(rawSource);
  const parseResult = Papa.parse<NormalizedImportRow>(rawSource, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (value: string) => stripBom(value).trim(),
    transform: (value: string) => stripBom(value).trim()
  });

  if (parseResult.errors.length > 0) {
    throw new Error(`No se pudo leer el CSV: ${parseResult.errors[0]?.message ?? "error desconocido"}.`);
  }

  if (parseResult.data.length > MAX_CSV_IMPORT_ROWS) {
    throw new Error(`El CSV supera el límite máximo de ${MAX_CSV_IMPORT_ROWS} filas. Divide el archivo e importa en lotes.`);
  }

  return buildImportPreviewFromRows(parseResult.data, {
    sourceFilePath,
    fileName: path.basename(sourceFilePath),
    editorName
  });
};

export const buildImportPreviewFromRows = async (
  rows: NormalizedImportRow[],
  options: {
    sourceFilePath: string;
    fileName: string;
    editorName: string;
    detectedFormat?: string;
    detectionConfidence?: "high" | "medium" | "low";
    /** INTERIM (OIR-102/OIR-134): Buscas-sheet rows silently skipped. Default 0 (CSV path). */
    buscasSkippedRowCount?: number;
    /** INTERIM (OIR-102/OIR-134): Social-handle rows silently skipped. Default 0 (CSV path). */
    socialHandleSkippedRowCount?: number;
  }
): Promise<{ dataset: DirectoryDataset; preview: CsvImportPreviewInternal }> => {
  const records: ContactRecord[] = [];
  const rowIssues: CsvImportIssue[] = [];
  const warnings: CsvImportWarning[] = [];

  const previewRows: CsvImportPreviewRow[] = [];

  rows.forEach((row: NormalizedImportRow, index: number) => {
    const rowNumber = index + 2;
    const displayName = maybe(row.displayName);
    const issues: string[] = [];
    const rowWarnings: CsvImportWarning[] = [];
    const type = maybe(row.type)?.toLowerCase();

    if (!type) {
      issues.push("El tipo es obligatorio.");
    } else if (!RECORD_TYPES.includes(type as ContactRecord["type"])) {
      issues.push(`El tipo "${type}" no está soportado.`);
    }

    if (!displayName) {
      issues.push("El nombre visible es obligatorio.");
    }

    const rawArea = maybe(row.area)?.toLowerCase();
    const area = rawArea && AREAS.includes(rawArea as AreaType)
      ? (rawArea as AreaType)
      : undefined;

    if (rawArea && !area) {
      rowWarnings.push({
        rowNumber,
        displayName,
        message: `El área "${rawArea}" no está soportada y se omitirá.`
      });
    }

    const tags = dedupeList(row.tags);
    const aliases = dedupeList(row.aliases);

    if ((row.tags ?? "").includes("|") && tags.length !== row.tags.split("|").filter(Boolean).length) {
      rowWarnings.push({
        rowNumber,
        displayName,
        message: "Las etiquetas duplicadas se consolidaron."
      });
    }

    if ((row.aliases ?? "").includes("|") && aliases.length !== row.aliases.split("|").filter(Boolean).length) {
      rowWarnings.push({
        rowNumber,
        displayName,
        message: "Los alias duplicados se consolidaron."
      });
    }

    const phones = buildPhones(row, rowNumber, displayName, rowWarnings);
    const emails = buildEmails(row, rowNumber, displayName, rowWarnings);
    const location = compactObject({
      building: maybe(row.building),
      floor: maybe(row.floor),
      room: maybe(row.room),
      text: maybe(row.locationText)
    });

    if (phones.length === 0 && emails.length === 0 && Object.keys(location).length === 0) {
      issues.push("Cada fila necesita al menos un teléfono, un correo o un dato de ubicación.");
    }

    const rawStatus = maybe(row.status)?.toLowerCase();
    const status = rawStatus ?? "active";

    if (rawStatus && !SUPPORTED_STATUSES.has(rawStatus)) {
      issues.push(`El estado "${rawStatus}" no está soportado.`);
    }

    if (issues.length > 0) {
      rowIssues.push({
        rowNumber,
        displayName,
        messages: issues
      });
      warnings.push(...rowWarnings);
      previewRows.push({
        rowNumber,
        status: "rejected",
        displayName,
        type: maybe(row.type),
        department: maybe(row.department),
        area: maybe(row.area),
        phone1Number: maybe(row.phone1Number),
        email1: maybe(row.email1),
        errorMessages: issues,
        warningMessages: rowWarnings.length > 0 ? rowWarnings.map((w) => w.message) : undefined
      });
      return;
    }

    try {
      const now = new Date().toISOString();
      const record = contactRecordSchema.parse({
        id: `cnt_csv_${String(records.length + 1).padStart(4, "0")}`,
        externalId: maybe(row.externalId),
        type,
        displayName,
        person: compactObject({
          firstName: maybe(row.firstName),
          lastName: maybe(row.lastName)
        }),
        organization: compactObject({
          department: maybe(row.department),
          service: maybe(row.service),
          area,
          specialty: maybe(row.specialty)
        }),
        location: Object.keys(location).length > 0 ? location : undefined,
        contactMethods: {
          phones,
          emails
        },
        aliases,
        tags,
        notes: maybe(row.notes),
        status,
        source: buildSource(maybe(row.externalId)),
        audit: {
          createdAt: now,
          updatedAt: now,
          createdBy: options.editorName,
          updatedBy: options.editorName
        }
      });

      records.push(record);
      warnings.push(...rowWarnings);
      previewRows.push({
        rowNumber,
        status: rowWarnings.length > 0 ? "warning" : "accepted",
        displayName,
        type: record.type,
        department: record.organization.department,
        area: record.organization.area,
        phone1Number: record.contactMethods.phones[0]?.number,
        email1: record.contactMethods.emails[0]?.address,
        warningMessages: rowWarnings.length > 0 ? rowWarnings.map((w) => w.message) : undefined
      });
    } catch (error) {
      const messages =
        error instanceof Error
          ? ["La fila no se pudo convertir en un registro válido."]
          : ["La fila no se pudo convertir en un registro válido."];

      rowIssues.push({
        rowNumber,
        displayName,
        messages
      });
      warnings.push(...rowWarnings);
      previewRows.push({
        rowNumber,
        status: "rejected",
        displayName,
        type: maybe(row.type),
        department: maybe(row.department),
        area: maybe(row.area),
        phone1Number: maybe(row.phone1Number),
        email1: maybe(row.email1),
        errorMessages: messages,
        warningMessages: rowWarnings.length > 0 ? rowWarnings.map((w) => w.message) : undefined
      });
    }
  });

  const dataset = buildDataset(records, options.editorName);

  return {
    dataset,
    preview: {
      importToken: "",
      sourceFilePath: options.sourceFilePath,
      fileName: options.fileName,
      detectedFormat: options.detectedFormat,
      detectionConfidence: options.detectionConfidence,
      totalRowCount: rows.length,
      validRowCount: records.length,
      invalidRowCount: rowIssues.length,
      warningCount: warnings.length,
      recordCount: dataset.records.length,
      mergedRecordCount: dataset.records.length,
      createdCount: dataset.records.length,
      updatedCount: 0,
      buscasSkippedRowCount: options.buscasSkippedRowCount ?? 0,
      socialHandleSkippedRowCount: options.socialHandleSkippedRowCount ?? 0,
      typeCounts: dataset.metadata.typeCounts,
      areaCounts: dataset.metadata.areaCounts,
      rowIssues,
      warnings,
      previewRows
    }
  };
};
