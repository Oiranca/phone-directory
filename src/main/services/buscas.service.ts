import fs from "node:fs/promises";
import { buscaRecordSchema, buscasDatasetSchema, editableBuscaRecordSchema, importedBuscaRecordSchema } from "../../shared/schemas/busca.schema.js";
import type { BuscaRecord, BuscasDataset, EditableBuscaRecord, ImportedBuscaRecord } from "../../shared/schemas/busca.schema.js";
import { ensureDirectory, readJsonFile, writeJsonFile } from "../utils/fs-json.js";
import { getBuscasFilePath, getManagedDataDirectory } from "../utils/paths.js";
import type { BuscasSheetParseResult } from "./spreadsheet-buscas-parser.js";
import { MAX_SPREADSHEET_IMPORT_ROWS } from "./spreadsheet-import.service.js";

const BUSCAS_VERSION = "1.0.0";

const emptyDataset = (): BuscasDataset => ({
  version: BUSCAS_VERSION,
  records: [],
  importedRecords: []
});

const normalizeDeviceNumber = (value: string): string => value.trim().toLowerCase();

const assertUniqueDeviceNumber = (records: BuscaRecord[], deviceNumber: string, excludeId?: string): void => {
  const normalized = normalizeDeviceNumber(deviceNumber);
  const conflict = records.find(
    (r) => normalizeDeviceNumber(r.deviceNumber) === normalized && r.id !== excludeId
  );
  if (conflict) {
    throw new Error(`El número de busca "${conflict.deviceNumber}" ya está registrado.`);
  }
};

const createEntityId = () => `bsc_${globalThis.crypto.randomUUID().slice(0, 8)}`;
const createImportedEntityId = () => `ibsc_${globalThis.crypto.randomUUID().slice(0, 8)}`;

const createUniqueId = (records: BuscaRecord[]): string => {
  const maxAttempts = 1000;
  let attempts = 0;
  let candidate = createEntityId();

  while (records.some((r) => r.id === candidate)) {
    attempts += 1;
    if (attempts >= maxAttempts) {
      throw new Error("No se pudo generar un ID único para la busca después de 1000 intentos.");
    }
    candidate = createEntityId();
  }

  return candidate;
};

const createUniqueImportedId = (existingIds: Set<string>): string => {
  const maxAttempts = 1000;
  let attempts = 0;
  let candidate = createImportedEntityId();

  while (existingIds.has(candidate)) {
    attempts += 1;
    if (attempts >= maxAttempts) {
      throw new Error("No se pudo generar un ID único para la busca importada después de 1000 intentos.");
    }
    candidate = createImportedEntityId();
  }

  existingIds.add(candidate);
  return candidate;
};

// NOTE: buscas.json is stored in the managed data directory alongside contacts.json but is
// currently outside the backup/restore scope. AppDataService backups only cover contacts.json.
// If backup coverage for pager-registry data is needed in the future, this service will need
// to be wired into the backup pipeline (see OIR-93 for context).
export class BuscasService {
  private writeQueue: Promise<void> = Promise.resolve();

  private enqueueWrite<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.writeQueue.then(fn);
    this.writeQueue = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }

  private async readDataset(): Promise<BuscasDataset> {
    const filePath = getBuscasFilePath();
    try {
      return buscasDatasetSchema.parse(await readJsonFile<BuscasDataset>(filePath));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return emptyDataset();
      }
      throw err;
    }
  }

  private async writeDataset(dataset: BuscasDataset): Promise<void> {
    const filePath = getBuscasFilePath();
    await ensureDirectory(getManagedDataDirectory());
    await writeJsonFile(filePath, dataset);
  }

  async list(): Promise<BuscaRecord[]> {
    const dataset = await this.readDataset();
    return dataset.records;
  }

  async add(payload: EditableBuscaRecord): Promise<BuscaRecord> {
    return this.enqueueWrite(async () => {
      const parsed = editableBuscaRecordSchema.parse(payload);
      const dataset = await this.readDataset();
      assertUniqueDeviceNumber(dataset.records, parsed.deviceNumber);
      const id = createUniqueId(dataset.records);
      const newRecord = buscaRecordSchema.parse({ ...parsed, id });
      const nextDataset = buscasDatasetSchema.parse({
        ...dataset,
        records: [newRecord, ...dataset.records]
      });
      await this.writeDataset(nextDataset);
      return newRecord;
    });
  }

  async update(id: string, payload: EditableBuscaRecord): Promise<BuscaRecord> {
    return this.enqueueWrite(async () => {
      const parsed = editableBuscaRecordSchema.parse(payload);
      const dataset = await this.readDataset();
      const index = dataset.records.findIndex((r) => r.id === id);
      if (index === -1) {
        throw new Error("No se encontró la busca solicitada.");
      }
      assertUniqueDeviceNumber(dataset.records, parsed.deviceNumber, id);
      const updatedRecord = buscaRecordSchema.parse({ ...parsed, id });
      const nextRecords = dataset.records.map((r, i) => (i === index ? updatedRecord : r));
      const nextDataset = buscasDatasetSchema.parse({ ...dataset, records: nextRecords });
      await this.writeDataset(nextDataset);
      return updatedRecord;
    });
  }

  async remove(id: string): Promise<void> {
    return this.enqueueWrite(async () => {
      const dataset = await this.readDataset();
      const index = dataset.records.findIndex((r) => r.id === id);
      if (index === -1) {
        throw new Error("No se encontró la busca solicitada.");
      }
      const nextRecords = dataset.records.filter((r) => r.id !== id);
      const nextDataset = buscasDatasetSchema.parse({ ...dataset, records: nextRecords });
      await this.writeDataset(nextDataset);
    });
  }

  async listImported(): Promise<ImportedBuscaRecord[]> {
    const dataset = await this.readDataset();
    return dataset.importedRecords ?? [];
  }

  /**
   * Replaces all ODS-imported buscas records with the result of a fresh parse.
   * Existing manually-managed records (in `records`) are untouched.
   *
   * The incoming `parseResult` is the output of parseBuscasSheets() — records
   * have no IDs yet. This method assigns ibsc_ IDs and writes the dataset
   * atomically via the serialised write queue.
   *
   * Returns the number of imported records written.
   */
  async importFromOds(parseResult: BuscasSheetParseResult): Promise<number> {
    return this.enqueueWrite(async () => {
      if (parseResult.records.length > MAX_SPREADSHEET_IMPORT_ROWS) {
        throw new Error(`El archivo supera el límite máximo de ${MAX_SPREADSHEET_IMPORT_ROWS} filas. Divide el archivo e importa en lotes.`);
      }

      const dataset = await this.readDataset();
      const existingIds = new Set<string>();

      const importedRecords: ImportedBuscaRecord[] = parseResult.records.map((raw) => {
        const id = createUniqueImportedId(existingIds);
        return importedBuscaRecordSchema.parse({ ...raw, id });
      });

      const nextDataset = buscasDatasetSchema.parse({
        ...dataset,
        importedRecords
      });

      await this.writeDataset(nextDataset);
      return importedRecords.length;
    });
  }

  async search(query: string): Promise<BuscaRecord[]> {
    const dataset = await this.readDataset();
    const q = query.trim().toLowerCase();
    if (!q) {
      return dataset.records;
    }
    return dataset.records.filter(
      (r) =>
        r.deviceNumber.toLowerCase().includes(q) ||
        r.assignedTo.toLowerCase().includes(q) ||
        r.department.toLowerCase().includes(q) ||
        r.role.toLowerCase().includes(q)
    );
  }
}
