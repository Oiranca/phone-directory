import { randomUUID } from "node:crypto";
import { buscaDatasetSchema, buscaRecordSchema } from "../../shared/schemas/busca.js";
import type { BuscaRecord, EditableBuscaRecord, BuscaDataset } from "../../shared/types/busca.js";
import { defaultBuscas } from "../../shared/fixtures/defaultBuscas.js";
import { readJsonFile, writeJsonFile } from "../utils/fs-json.js";
import { getBuscasFilePath } from "../utils/paths.js";

export class BuscaService {
  private filePath: string;

  constructor() {
    this.filePath = getBuscasFilePath();
  }

  async ensureFile(): Promise<void> {
    try {
      await readJsonFile<BuscaDataset>(this.filePath);
    } catch {
      await writeJsonFile(this.filePath, defaultBuscas);
    }
  }

  async listBuscas(): Promise<BuscaRecord[]> {
    const dataset = buscaDatasetSchema.parse(
      await readJsonFile<BuscaDataset>(this.filePath)
    );
    return dataset.records;
  }

  async createBusca(payload: EditableBuscaRecord): Promise<BuscaRecord> {
    const dataset = buscaDatasetSchema.parse(
      await readJsonFile<BuscaDataset>(this.filePath)
    );
    const now = new Date().toISOString();
    const record = buscaRecordSchema.parse({
      id: randomUUID(),
      ...payload,
      createdAt: now,
      updatedAt: now
    });

    dataset.records.push(record);
    await writeJsonFile(this.filePath, dataset);
    return record;
  }

  async updateBusca(id: string, payload: EditableBuscaRecord): Promise<BuscaRecord> {
    const dataset = buscaDatasetSchema.parse(
      await readJsonFile<BuscaDataset>(this.filePath)
    );
    const index = dataset.records.findIndex((r) => r.id === id);

    if (index === -1) {
      throw new Error("No se encontró el registro de busca solicitado.");
    }

    const now = new Date().toISOString();
    const updated = buscaRecordSchema.parse({
      ...dataset.records[index],
      ...payload,
      id,
      updatedAt: now
    });

    dataset.records[index] = updated;
    await writeJsonFile(this.filePath, dataset);
    return updated;
  }

  async deleteBusca(id: string): Promise<void> {
    const dataset = buscaDatasetSchema.parse(
      await readJsonFile<BuscaDataset>(this.filePath)
    );
    const index = dataset.records.findIndex((r) => r.id === id);

    if (index === -1) {
      throw new Error("No se encontró el registro de busca solicitado.");
    }

    dataset.records.splice(index, 1);
    await writeJsonFile(this.filePath, dataset);
  }
}
