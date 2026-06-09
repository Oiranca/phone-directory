import fs from "node:fs/promises";
import { buscaRecordSchema, buscasDatasetSchema, editableBuscaRecordSchema } from "../../shared/schemas/busca.schema.js";
import type { BuscaRecord, BuscasDataset, EditableBuscaRecord } from "../../shared/schemas/busca.schema.js";
import { ensureDirectory, readJsonFile, writeJsonFile } from "../utils/fs-json.js";
import { getBuscasFilePath, getManagedDataDirectory } from "../utils/paths.js";

const BUSCAS_VERSION = "1.0.0";

const emptyDataset = (): BuscasDataset => ({
  version: BUSCAS_VERSION,
  records: []
});

const createEntityId = () => `bsc_${globalThis.crypto.randomUUID().slice(0, 8)}`;

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
      await fs.access(filePath);
    } catch {
      return emptyDataset();
    }
    return buscasDatasetSchema.parse(await readJsonFile<BuscasDataset>(filePath));
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
