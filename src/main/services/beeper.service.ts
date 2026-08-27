import fs from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { beeperRecordSchema, beepersDatasetSchema, editableBeeperRecordSchema, editableImportedBeeperRecordSchema, importedBeeperRecordSchema } from "../../shared/schemas/beeper.schema.js";
import type { BeeperRecord, BeepersDataset, EditableBeeperRecord, EditableImportedBeeperRecord, ImportedBeeperRecord } from "../../shared/schemas/beeper.schema.js";
import { ensurePrivateDirectory, readJsonFile, writeJsonFile } from "../utils/fs-json.js";
import { getBeepersFilePath, getLegacyBeepersFilePath, getManagedDataDirectory } from "../utils/paths.js";
import { assertPathChainIsNotSymlink } from "../utils/path-safety.js";
import type { BeepersSheetParseResult } from "./spreadsheet-beeper-parser.js";
import { MAX_SPREADSHEET_IMPORT_ROWS } from "./spreadsheet-import.service.js";

const BEEPERS_VERSION = "1.0.0";

const emptyDataset = (): BeepersDataset => ({
  version: BEEPERS_VERSION,
  records: [],
  importedRecords: []
});

const normalizeDeviceNumber = (value: string): string => value.trim().toLowerCase();

type ImportableBeeperRecord = Omit<ImportedBeeperRecord, "id">;

const preferNonBlank = (current: string | undefined, incoming: string | undefined): string | undefined =>
  current?.trim() ? current : incoming?.trim() ? incoming : undefined;

/**
 * Combines two references to the same pager without discarding information
 * already stored by the first record. Imported files frequently list the same
 * pager on complementary sheets, with different optional holder fields.
 */
const mergeImportedBeeperFields = (
  current: ImportableBeeperRecord,
  incoming: ImportableBeeperRecord
): ImportableBeeperRecord => ({
  ...incoming,
  ...current,
  deviceNumber: preferNonBlank(current.deviceNumber, incoming.deviceNumber)!,
  department: preferNonBlank(current.department, incoming.department)!,
  holderType: preferNonBlank(current.holderType, incoming.holderType),
  name: preferNonBlank(current.name, incoming.name),
  category: preferNonBlank(current.category, incoming.category),
  service: preferNonBlank(current.service, incoming.service),
  sourceSheet: preferNonBlank(current.sourceSheet, incoming.sourceSheet)!,
  sourceRow: current.sourceRow
});

const buildImportedSourceFingerprint = (record: Omit<ImportedBeeperRecord, "id">): string =>
  createHash("sha256")
    .update(JSON.stringify([
      record.sourceSheet.trim().toLowerCase(),
      record.sourceRow,
      normalizeDeviceNumber(record.deviceNumber),
      record.department.trim().toLowerCase(),
      record.holderType?.trim().toLowerCase() ?? "",
      record.name?.trim().toLowerCase() ?? "",
      record.category?.trim().toLowerCase() ?? "",
      record.service?.trim().toLowerCase() ?? ""
    ]))
    .digest("hex");

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

// beepers.json is stored beside contacts.json. Whole-dataset JSON imports create
// their own beepers-before-import backup; contact backups remain independent.
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

    await ensurePrivateDirectory(getManagedDataDirectory());
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
    await ensurePrivateDirectory(getManagedDataDirectory());
    await writeJsonFile(filePath, dataset);
  }

  async exportDataset(): Promise<BeepersDataset> {
    return this.enqueueWrite(() => this.readDataset());
  }

  async list(): Promise<BeeperRecord[]> {
    const dataset = await this.readDataset();
    return dataset.records;
  }

  private async createBackup(
    dataset: BeepersDataset,
    backupDirectoryPath: string,
    prefix: string
  ): Promise<string> {
    const errorMessage = "No se pudo crear la copia de seguridad de las buscas.";
    await assertPathChainIsNotSymlink(backupDirectoryPath, errorMessage, true);
    await ensurePrivateDirectory(backupDirectoryPath);
    await assertPathChainIsNotSymlink(backupDirectoryPath, errorMessage);
    const canonicalBackupDirectory = await fs.realpath(backupDirectoryPath);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const backupPath = path.join(
        canonicalBackupDirectory,
        `${prefix}-${timestamp}-${randomUUID().slice(0, 8)}.json`
      );
      let handle: fs.FileHandle | undefined;

      try {
        handle = await fs.open(backupPath, "wx", 0o600);
        await handle.writeFile(JSON.stringify(dataset, null, 2), "utf8");
        await handle.sync();
        await handle.close();
        return backupPath;
      } catch (error) {
        await handle?.close().catch(() => undefined);
        await fs.unlink(backupPath).catch(() => undefined);
        if ((error as NodeJS.ErrnoException).code === "EEXIST") {
          continue;
        }
        throw error;
      }
    }

    throw new Error("No se pudo generar un nombre único para la copia de seguridad de las buscas.");
  }

  private async pruneBackups(backupDirectoryPath: string, retentionCount: number, prefix: string): Promise<void> {
    const errorMessage = "No se pudieron rotar las copias de seguridad de las buscas.";
    await assertPathChainIsNotSymlink(backupDirectoryPath, errorMessage);
    const canonicalBackupDirectory = await fs.realpath(backupDirectoryPath);
    const entries = await fs.readdir(canonicalBackupDirectory, { withFileTypes: true });
    const backups = await Promise.all(
      entries
        .filter((entry) =>
          entry.isFile() && entry.name.startsWith(`${prefix}-`) && entry.name.endsWith(".json")
        )
        .map(async (entry) => {
          const filePath = path.join(canonicalBackupDirectory, entry.name);
          const stats = await fs.stat(filePath);
          return { filePath, createdAt: stats.birthtimeMs > 1000 ? stats.birthtimeMs : stats.mtimeMs };
        })
    );

    backups.sort((left, right) =>
      right.createdAt - left.createdAt || right.filePath.localeCompare(left.filePath)
    );
    await Promise.all(backups.slice(retentionCount).map((backup) => fs.unlink(backup.filePath)));
  }

  async importDataset(
    dataset: BeepersDataset,
    options: { backupDirectoryPath: string; retentionCount: number }
  ): Promise<{ recordCount: number; importedRecordCount: number }> {
    return this.enqueueWrite(async () => {
      const parsed = beepersDatasetSchema.parse(dataset);
      const totalRecords = parsed.records.length + parsed.importedRecords.length;

      if (totalRecords > MAX_SPREADSHEET_IMPORT_ROWS) {
        throw new Error(`El archivo supera el límite máximo de ${MAX_SPREADSHEET_IMPORT_ROWS} buscas.`);
      }

      const current = await this.readDataset();
      const backupDirectoryPath = options.backupDirectoryPath;
      await this.createBackup(current, backupDirectoryPath, "beepers-before-import");
      await this.writeDataset(parsed);

      try {
        await this.pruneBackups(backupDirectoryPath, options.retentionCount, "beepers-before-import");
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        console.error(`[BackupRetention] Failed to prune beepers-before-import-* backups — ${errMsg}`);
      }

      return {
        recordCount: parsed.records.length,
        importedRecordCount: parsed.importedRecords.length
      };
    });
  }

  async importDatasetWithPeerTransaction<T>(
    dataset: BeepersDataset,
    options: { backupDirectoryPath: string; retentionCount: number },
    peer: {
      createBackup: () => Promise<T>;
      replaceDataset: () => Promise<void>;
    }
  ): Promise<{
    recordCount: number;
    importedRecordCount: number;
    backupPath: string;
    peerBackup: T;
  }> {
    return this.enqueueWrite(async () => {
      const parsed = beepersDatasetSchema.parse(dataset);
      const totalRecords = parsed.records.length + parsed.importedRecords.length;

      if (totalRecords > MAX_SPREADSHEET_IMPORT_ROWS) {
        throw new Error(`El archivo supera el límite máximo de ${MAX_SPREADSHEET_IMPORT_ROWS} buscas.`);
      }

      const current = await this.readDataset();
      const backupPath = await this.createBackup(
        current,
        options.backupDirectoryPath,
        "beepers-before-import"
      );
      const peerBackup = await peer.createBackup();

      await this.writeDataset(parsed);
      try {
        await peer.replaceDataset();
      } catch (error) {
        try {
          await this.writeDataset(current);
        } catch (rollbackError) {
          const importMessage = error instanceof Error ? error.message : String(error);
          const rollbackMessage = rollbackError instanceof Error ? rollbackError.message : String(rollbackError);
          throw new Error(
            `No se pudo importar el archivo combinado ni restaurar las buscas anteriores. Importación: ${importMessage}. Restauración: ${rollbackMessage}.`
          );
        }
        throw error;
      }

      try {
        await this.pruneBackups(
          options.backupDirectoryPath,
          options.retentionCount,
          "beepers-before-import"
        );
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        console.error(`[BackupRetention] Failed to prune beepers-before-import-* backups — ${errMsg}`);
      }

      return {
        recordCount: parsed.records.length,
        importedRecordCount: parsed.importedRecords.length,
        backupPath,
        peerBackup
      };
    });
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

  async remove(id: string, options: { backupDirectoryPath: string; retentionCount: number }): Promise<void> {
    return this.enqueueWrite(async () => {
      const dataset = await this.readDataset();
      const index = dataset.records.findIndex((r) => r.id === id);
      if (index === -1) {
        throw new Error("No se encontró la busca solicitada.");
      }
      await this.createBackup(dataset, options.backupDirectoryPath, "beepers-before-delete");
      const nextRecords = dataset.records.filter((r) => r.id !== id);
      const nextDataset = beepersDatasetSchema.parse({ ...dataset, records: nextRecords });
      await this.writeDataset(nextDataset);
      try {
        await this.pruneBackups(options.backupDirectoryPath, options.retentionCount, "beepers-before-delete");
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        console.error(`[BackupRetention] Failed to prune beepers-before-delete-* backups — ${errMsg}`);
      }
    });
  }

  async listImported(): Promise<ImportedBeeperRecord[]> {
    const dataset = await this.readDataset();
    return dataset.importedRecords ?? [];
  }

  async updateImported(id: string, payload: EditableImportedBeeperRecord): Promise<ImportedBeeperRecord> {
    return this.enqueueWrite(async () => {
      const parsed = editableImportedBeeperRecordSchema.parse(payload);
      const dataset = await this.readDataset();
      const importedRecords = dataset.importedRecords ?? [];
      const index = importedRecords.findIndex((record) => record.id === id);

      if (index === -1) {
        throw new Error("No se encontró la busca importada solicitada.");
      }

      const current = importedRecords[index]!;
      const usesNamedLayout = current.name !== undefined || current.category !== undefined || current.holderType === undefined;

      if (!usesNamedLayout && !parsed.assignedTo) {
        throw new Error("El titular de la busca es obligatorio.");
      }

      const updatedRecord = importedBeeperRecordSchema.parse({
        ...current,
        deviceNumber: parsed.deviceNumber,
        department: parsed.department,
        sourceFingerprint: current.sourceFingerprint ?? buildImportedSourceFingerprint(current),
        manuallyEdited: true,
        ...(usesNamedLayout
          ? { name: parsed.assignedTo, category: parsed.role }
          : { holderType: parsed.assignedTo, category: parsed.role })
      });
      const nextImportedRecords = importedRecords.map((record, recordIndex) =>
        recordIndex === index ? updatedRecord : record
      );
      const nextDataset = beepersDatasetSchema.parse({ ...dataset, importedRecords: nextImportedRecords });

      await this.writeDataset(nextDataset);
      return updatedRecord;
    });
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
      const incomingByDeviceNumber = new Map<string, ImportableBeeperRecord>();

      for (const raw of parseResult.records) {
        const deviceNumberKey = normalizeDeviceNumber(raw.deviceNumber);
        const existing = incomingByDeviceNumber.get(deviceNumberKey);
        incomingByDeviceNumber.set(
          deviceNumberKey,
          existing ? mergeImportedBeeperFields(existing, raw) : raw
        );
      }

      const existingByDeviceNumber = new Map<string, ImportedBeeperRecord>();
      for (const record of dataset.importedRecords ?? []) {
        const deviceNumberKey = normalizeDeviceNumber(record.deviceNumber);
        if (!existingByDeviceNumber.has(deviceNumberKey)) {
          existingByDeviceNumber.set(deviceNumberKey, record);
        }
      }
      const editedBySource = new Map(
        (dataset.importedRecords ?? [])
          .filter((record): record is ImportedBeeperRecord & { sourceFingerprint: string } =>
            record.manuallyEdited === true && record.sourceFingerprint !== undefined
          )
          .map((record) => [record.sourceFingerprint, record] as const)
      );
      const existingIds = new Set((dataset.importedRecords ?? []).map((record) => record.id));

      const importedRecords: ImportedBeeperRecord[] = Array.from(incomingByDeviceNumber.values()).map((raw) => {
        const sourceFingerprint = buildImportedSourceFingerprint(raw);
        // Match by pager number first: a repeated or complementary import must
        // keep one record and only fill its blank columns. Source identity is
        // the fallback needed when a manually corrected pager number differs
        // from its original ODS value.
        const existing = existingByDeviceNumber.get(normalizeDeviceNumber(raw.deviceNumber));
        const edited = existing ?? editedBySource.get(sourceFingerprint);

        if (edited) {
          const merged = mergeImportedBeeperFields(edited, raw);
          return importedBeeperRecordSchema.parse({
            ...merged,
            id: edited.id,
            sourceFingerprint: edited.sourceFingerprint ?? sourceFingerprint,
            manuallyEdited: edited.manuallyEdited
          });
        }

        const id = createUniqueImportedId(existingIds);
        return importedBeeperRecordSchema.parse({ ...raw, id, sourceFingerprint });
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
