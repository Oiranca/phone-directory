import fs from "node:fs/promises";
import { beeperRecordSchema, beepersDatasetSchema, editableBeeperRecordSchema, importedBeeperRecordSchema } from "../../shared/schemas/beeper.schema.js";
import type { BeeperRecord, BeepersDataset, EditableBeeperRecord, ImportedBeeperRecord } from "../../shared/schemas/beeper.schema.js";
import { ensureDirectory, readJsonFile, writeJsonFile } from "../utils/fs-json.js";
import { getBeepersFilePath, getLegacyBeepersFilePath, getManagedDataDirectory } from "../utils/paths.js";
import type { BeepersSheetParseResult } from "./spreadsheet-beeper-parser.js";
import { MAX_SPREADSHEET_IMPORT_ROWS } from "./spreadsheet-import.service.js";

const BEEPERS_VERSION = "1.0.0";

const emptyDataset = (): BeepersDataset => ({
  version: BEEPERS_VERSION,
  records: [],
  importedRecords: []
});

const normalizeDeviceNumber = (value: string): string => value.trim().toLowerCase();

const assertUniqueDeviceNumber = (records: BeeperRecord[], deviceNumber: string, excludeId?: string): void => {
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

const createUniqueId = (records: BeeperRecord[]): string => {
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

// NOTE: beepers.json is stored in the managed data directory alongside contacts.json but is
// currently outside the backup/restore scope. AppDataService backups only cover contacts.json.
// If backup coverage for pager-registry data is needed in the future, this service will need
// to be wired into the backup pipeline.
export class BeepersService {
  private writeQueue: Promise<void> = Promise.resolve();

  private enqueueWrite<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.writeQueue.then(fn);
    this.writeQueue = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }

  /**
   * OIR-271: the on-disk store was renamed from buscas.json to beepers.json.
   * If the new file does not exist yet but the legacy file does, migrate the
   * legacy data to the new path (atomic write, dual-fsync) so existing user
   * data is never lost. The legacy file is left in place afterwards.
   */
  private async migrateLegacyStoreIfNeeded(): Promise<void> {
    const filePath = getBeepersFilePath();
    const legacyFilePath = getLegacyBeepersFilePath();

    try {
      await fs.access(filePath);
      return;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        // A real access error (e.g. EACCES/EPERM) must not be masked as "no records" —
        // rethrow instead of silently falling through to the legacy path.
        throw err;
      }
      // beepers.json does not exist yet — fall through to check for legacy data.
    }

    let legacyDataset: BeepersDataset;
    try {
      legacyDataset = beepersDatasetSchema.parse(await readJsonFile<BeepersDataset>(legacyFilePath));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return;
      }
      throw err;
    }

    await ensureDirectory(getManagedDataDirectory());
    await writeJsonFile(filePath, legacyDataset);
  }

  private async readDataset(): Promise<BeepersDataset> {
    await this.migrateLegacyStoreIfNeeded();
    const filePath = getBeepersFilePath();
    try {
      return beepersDatasetSchema.parse(await readJsonFile<BeepersDataset>(filePath));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return emptyDataset();
      }
      throw err;
    }
  }

  private async writeDataset(dataset: BeepersDataset): Promise<void> {
    const filePath = getBeepersFilePath();
    await ensureDirectory(getManagedDataDirectory());
    await writeJsonFile(filePath, dataset);
  }

  async list(): Promise<BeeperRecord[]> {
    const dataset = await this.readDataset();
    return dataset.records;
  }

  async add(payload: EditableBeeperRecord): Promise<BeeperRecord> {
    return this.enqueueWrite(async () => {
      const parsed = editableBeeperRecordSchema.parse(payload);
      const dataset = await this.readDataset();
      assertUniqueDeviceNumber(dataset.records, parsed.deviceNumber);
      const id = createUniqueId(dataset.records);
      const newRecord = beeperRecordSchema.parse({ ...parsed, id });
      const nextDataset = beepersDatasetSchema.parse({
        ...dataset,
        records: [newRecord, ...dataset.records]
      });
      await this.writeDataset(nextDataset);
      return newRecord;
    });
  }

  async update(id: string, payload: EditableBeeperRecord): Promise<BeeperRecord> {
    return this.enqueueWrite(async () => {
      const parsed = editableBeeperRecordSchema.parse(payload);
      const dataset = await this.readDataset();
      const index = dataset.records.findIndex((r) => r.id === id);
      if (index === -1) {
        throw new Error("No se encontró la busca solicitada.");
      }
      assertUniqueDeviceNumber(dataset.records, parsed.deviceNumber, id);
      const updatedRecord = beeperRecordSchema.parse({ ...parsed, id });
      const nextRecords = dataset.records.map((r, i) => (i === index ? updatedRecord : r));
      const nextDataset = beepersDatasetSchema.parse({ ...dataset, records: nextRecords });
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
      const nextDataset = beepersDatasetSchema.parse({ ...dataset, records: nextRecords });
      await this.writeDataset(nextDataset);
    });
  }

  async listImported(): Promise<ImportedBeeperRecord[]> {
    const dataset = await this.readDataset();
    return dataset.importedRecords ?? [];
  }

  /**
   * Replaces all ODS-imported beeper records with the result of a fresh parse.
   * Existing manually-managed records (in `records`) are untouched.
   *
   * The incoming `parseResult` is the output of parseBeepersSheets() — records
   * have no IDs yet. This method assigns ibsc_ IDs and writes the dataset
   * atomically via the serialised write queue.
   *
   * Returns the number of imported records written.
   */
  async importFromOds(parseResult: BeepersSheetParseResult): Promise<number> {
    return this.enqueueWrite(async () => {
      if (parseResult.records.length > MAX_SPREADSHEET_IMPORT_ROWS) {
        throw new Error(`El archivo supera el límite máximo de ${MAX_SPREADSHEET_IMPORT_ROWS} filas. Divide el archivo e importa en lotes.`);
      }

      const dataset = await this.readDataset();
      const existingIds = new Set<string>();

      const importedRecords: ImportedBeeperRecord[] = parseResult.records.map((raw) => {
        const id = createUniqueImportedId(existingIds);
        return importedBeeperRecordSchema.parse({ ...raw, id });
      });

      const nextDataset = beepersDatasetSchema.parse({
        ...dataset,
        importedRecords
      });

      await this.writeDataset(nextDataset);
      return importedRecords.length;
    });
  }
}
