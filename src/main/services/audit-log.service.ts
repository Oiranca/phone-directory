import path from "node:path";
import fs from "node:fs/promises";
import { auditLogEntrySchema, auditLogSchema } from "../../shared/schemas/contact.js";
import type { AuditLogEntry, AuditLogQueryParams, AuditLogResult } from "../../shared/types/contact.js";
import { ensureDirectory, writeJsonFile } from "../utils/fs-json.js";
import { getAuditLogFilePath } from "../utils/paths.js";

/**
 * Raised when the audit-log file cannot be parsed (malformed JSON, failed
 * schema validation, or unreadable file).  The original bytes are quarantined
 * before this error reaches callers.
 *
 * Callers MUST NOT silently swallow this error and write over the damaged file.
 * Explicit recovery (see `AuditLogService.recoverFromIntegrityError`) is
 * required before normal appends can resume.
 */
export class AuditLogIntegrityError extends Error {
  /** Absolute path to the original (damaged) audit-log file. */
  readonly logFilePath: string;
  /** Absolute path to the quarantine sidecar file, if quarantine succeeded. */
  readonly quarantineFilePath: string | null;
  /** Underlying parse / read error. */
  readonly cause: unknown;

  constructor(opts: {
    logFilePath: string;
    quarantineFilePath: string | null;
    cause: unknown;
  }) {
    super(
      `Audit log integrity error: the file at "${opts.logFilePath}" is corrupt or unreadable. ` +
        (opts.quarantineFilePath
          ? `Original bytes preserved at "${opts.quarantineFilePath}".`
          : "Quarantine of the original bytes failed — manual recovery required.")
    );
    this.name = "AuditLogIntegrityError";
    this.logFilePath = opts.logFilePath;
    this.quarantineFilePath = opts.quarantineFilePath;
    this.cause = opts.cause;
  }
}

export class AuditLogService {
  private writeQueue: Promise<void> = Promise.resolve();

  /**
   * Tracks whether a read/parse failure has been detected for this service
   * instance.  Once set, appends are refused until
   * `recoverFromIntegrityError()` is called.
   */
  private integrityError: AuditLogIntegrityError | null = null;

  private enqueueWrite<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.writeQueue.then(fn);
    this.writeQueue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private getFilePath() {
    return getAuditLogFilePath();
  }

  async ensureInitialized(): Promise<void> {
    const filePath = this.getFilePath();
    await ensureDirectory(path.dirname(filePath));

    try {
      await fs.access(filePath);
    } catch {
      await writeJsonFile(filePath, []);
    }
  }

  /**
   * Attempt to read and parse the audit-log file.
   *
   * On success: returns the parsed entries array.
   * On ENOENT: returns an empty array (no quarantine needed).
   * On any other failure (IO error, malformed JSON, schema mismatch):
   *   quarantines the original bytes to a timestamped sidecar in the same
   *   directory, records the integrity error on the instance, and throws an
   *   `AuditLogIntegrityError`.
   */
  private async readEntries(filePath: string): Promise<AuditLogEntry[]> {
    let rawBytes: Buffer;
    try {
      rawBytes = await fs.readFile(filePath);
    } catch (readErr) {
      // File simply does not exist — return empty, no quarantine needed.
      if ((readErr as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      // Unreadable file (permissions, device error, …) — quarantine & fail closed.
      const quarantineFilePath = await this.quarantine(filePath, undefined);
      const integrityError = new AuditLogIntegrityError({
        logFilePath: filePath,
        quarantineFilePath,
        cause: readErr,
      });
      this.integrityError = integrityError;
      throw integrityError;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBytes.toString("utf-8"));
    } catch (jsonErr) {
      const quarantineFilePath = await this.quarantine(filePath, rawBytes);
      const integrityError = new AuditLogIntegrityError({
        logFilePath: filePath,
        quarantineFilePath,
        cause: jsonErr,
      });
      this.integrityError = integrityError;
      throw integrityError;
    }

    let entries: AuditLogEntry[];
    try {
      entries = auditLogSchema.parse(parsed);
    } catch (zodErr) {
      const quarantineFilePath = await this.quarantine(filePath, rawBytes);
      const integrityError = new AuditLogIntegrityError({
        logFilePath: filePath,
        quarantineFilePath,
        cause: zodErr,
      });
      this.integrityError = integrityError;
      throw integrityError;
    }

    return entries;
  }

  /**
   * Copy `bytes` to a timestamped sidecar next to `originalFilePath`.
   * Returns the sidecar path on success, `null` on failure (never throws).
   * The original file is NOT modified.
   */
  private async quarantine(originalFilePath: string, bytes: Buffer | undefined): Promise<string | null> {
    try {
      const safeTs = new Date().toISOString().replace(/[:.]/g, "-");
      const dir = path.dirname(originalFilePath);
      const base = path.basename(originalFilePath, ".json");
      const sidecar = path.join(dir, `${base}.corrupt-${safeTs}.json`);
      await ensureDirectory(dir);
      // Write exactly the original bytes (even if empty) so the sidecar is
      // a faithful copy of what was on disk.
      await fs.writeFile(sidecar, bytes ?? Buffer.alloc(0));
      return sidecar;
    } catch {
      return null;
    }
  }

  async append(entry: AuditLogEntry): Promise<void> {
    return this.enqueueWrite(async () => {
      // Refuse append while in integrity-error state.  The caller must call
      // recoverFromIntegrityError() explicitly before writes can resume.
      if (this.integrityError !== null) {
        throw this.integrityError;
      }

      const validated = auditLogEntrySchema.parse(entry);
      const filePath = this.getFilePath();

      // readEntries will set this.integrityError and throw AuditLogIntegrityError
      // if the file is corrupt.  We never reach writeJsonFile in that case.
      const entries = await this.readEntries(filePath);

      entries.push(validated);
      await writeJsonFile(filePath, entries);
    });
  }

  /**
   * Query the audit log.  Unlike the old implementation, corruption now
   * surfaces as a thrown `AuditLogIntegrityError` rather than silently
   * returning an empty result set, so callers can distinguish "no entries"
   * from "log is damaged".
   */
  async query(params: AuditLogQueryParams): Promise<AuditLogResult> {
    const filePath = this.getFilePath();
    const entries = await this.readEntries(filePath);

    let filtered = entries;

    if (params.fromDate) {
      filtered = filtered.filter((e) => e.timestamp >= params.fromDate!);
    }

    if (params.toDate) {
      // Include the full end day by comparing prefix
      const toDatePrefix = params.toDate.slice(0, 10);
      filtered = filtered.filter((e) => e.timestamp.slice(0, 10) <= toDatePrefix);
    }

    if (params.editor) {
      const q = params.editor.toLowerCase();
      filtered = filtered.filter((e) => e.editor.toLowerCase().includes(q));
    }

    if (params.action) {
      filtered = filtered.filter((e) => e.action === params.action);
    }

    if (params.recordName) {
      const q = params.recordName.toLowerCase();
      filtered = filtered.filter((e) => e.recordName?.toLowerCase().includes(q));
    }

    return {
      entries: filtered.slice().reverse(),
      totalCount: filtered.length
    };
  }

  /**
   * Explicit recovery path.
   *
   * After a corruption event the service refuses all appends.  Call this
   * method deliberately (after reviewing the quarantine sidecar) to clear the
   * integrity-error state and start a fresh, empty audit log.
   *
   * The quarantine sidecar produced during the corruption detection is NOT
   * deleted here — it must be removed by the operator.
   *
   * Throws if writing the fresh file fails; the integrity-error state is then
   * preserved so a retry is possible.
   */
  async recoverFromIntegrityError(): Promise<void> {
    const filePath = this.getFilePath();
    await ensureDirectory(path.dirname(filePath));
    await writeJsonFile(filePath, []);
    // Only clear the error state once the write has succeeded atomically.
    this.integrityError = null;
  }

  toCsv(entries: AuditLogEntry[]): string {
    const headers = [
      "timestamp",
      "editor",
      "action",
      "recordId",
      "recordName",
      "changes",
      "reason",
      "recordsAffected",
      "importSource"
    ];

    const escapeCsv = (value: unknown): string => {
      if (value === undefined || value === null) {
        return "";
      }

      const str = typeof value === "object" ? JSON.stringify(value) : String(value);

      if (str.includes(",") || str.includes('"') || str.includes("\n")) {
        return `"${str.replace(/"/g, '""')}"`;
      }

      return str;
    };

    const rows = entries.map((entry) =>
      [
        escapeCsv(entry.timestamp),
        escapeCsv(entry.editor),
        escapeCsv(entry.action),
        escapeCsv(entry.recordId),
        escapeCsv(entry.recordName),
        escapeCsv(entry.changes ? JSON.stringify(entry.changes) : null),
        escapeCsv(entry.reason),
        escapeCsv(entry.recordsAffected),
        escapeCsv(entry.importSource)
      ].join(",")
    );

    return [headers.join(","), ...rows].join("\n");
  }
}
