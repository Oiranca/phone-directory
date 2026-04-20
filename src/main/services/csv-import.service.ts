import fs from "node:fs/promises";
import path from "node:path";
import Papa from "papaparse";
import { AREAS, RECORD_TYPES } from "../../shared/constants/catalogs.js";
import type { AreaType, RecordType } from "../../shared/constants/catalogs.js";
import { contactRecordSchema, directoryDatasetSchema } from "../../shared/schemas/contact.js";
import type {
  ContactRecord,
  CsvImportIssue,
  CsvImportPreview,
  CsvImportWarning,
  DirectoryDataset,
  PhoneContact,
  EmailContact
} from "../../shared/types/contact.js";

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

type CsvRow = Record<string, string>;

const validateCsvHeaders = (rawSource: string) => {
  const headerResult = Papa.parse<string[]>(rawSource, {
    preview: 1,
    skipEmptyLines: "greedy",
    transform: (value: string) => value.trim()
  });

  if (headerResult.errors.length > 0) {
    throw new Error(`No se pudo leer la cabecera del CSV: ${headerResult.errors[0]?.message ?? "error desconocido"}.`);
  }

  const rawHeaders = headerResult.data[0]?.map((header) => header.trim()) ?? [];

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
  row: CsvRow,
  rowNumber: number,
  displayName: string | undefined,
  warnings: CsvImportWarning[]
) => {
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
  row: CsvRow,
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
  const typeCounts: Partial<Record<RecordType, number>> = {};
  const areaCounts: Partial<Record<AreaType, number>> = {};

  for (const record of records) {
    typeCounts[record.type] = (typeCounts[record.type] ?? 0) + 1;

    if (record.organization.area) {
      areaCounts[record.organization.area] = (areaCounts[record.organization.area] ?? 0) + 1;
    }
  }

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
): Promise<{ dataset: DirectoryDataset; preview: CsvImportPreview }> => {
  const sourceStats = await fs.stat(sourceFilePath);

  if (sourceStats.size > MAX_CSV_IMPORT_SIZE_BYTES) {
    throw new Error("El CSV supera el tamaño máximo permitido de 5 MB. Divide el archivo antes de importarlo.");
  }

  const rawSource = await fs.readFile(sourceFilePath, "utf-8");
  validateCsvHeaders(rawSource);
  const parseResult = Papa.parse<CsvRow>(rawSource, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (value: string) => value.trim(),
    transform: (value: string) => value.trim()
  });

  if (parseResult.errors.length > 0) {
    throw new Error(`No se pudo leer el CSV: ${parseResult.errors[0]?.message ?? "error desconocido"}.`);
  }
  const records: ContactRecord[] = [];
  const rowIssues: CsvImportIssue[] = [];
  const warnings: CsvImportWarning[] = [];

  parseResult.data.forEach((row: CsvRow, index: number) => {
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
          createdBy: editorName,
          updatedBy: editorName
        }
      });

      records.push(record);
      warnings.push(...rowWarnings);
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
    }
  });

  const dataset = buildDataset(records, editorName);

  return {
    dataset,
    preview: {
      importToken: "",
      sourceFilePath,
      fileName: path.basename(sourceFilePath),
      totalRowCount: parseResult.data.length,
      validRowCount: records.length,
      invalidRowCount: rowIssues.length,
      warningCount: warnings.length,
      recordCount: dataset.records.length,
      typeCounts: dataset.metadata.typeCounts,
      areaCounts: dataset.metadata.areaCounts,
      rowIssues,
      warnings
    }
  };
};
