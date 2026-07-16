/**
 * Decision (2026-06-23): The audit log is an internal JSON record only.
 * The renderer audit UI (AuditLogPage) and its renderer-facing IPC boundary
 * (getAuditLog / exportAuditLog / recoverAuditLog channels + HospitalDirectoryApi
 * methods) were removed. Backend capture (appendEntry on every
 * create/update/merge) and the service-layer recovery path
 * (recoverFromIntegrityError / AppDataService.recoverAuditLog) are retained so
 * future operator tooling can wire recovery without touching this layer.
 * The integrityError latch remains deliberately fail-closed: once set, all
 * appends are blocked until an explicit recoverFromIntegrityError() call clears it.
 *
 * Rotation decision (2026-07-14): the active log file has no size bound on its
 * own, so `append()` now rotates it once it accumulates
 * `DEFAULT_ROTATION_THRESHOLD_ENTRIES` entries — the full active history is
 * archived to a timestamped `audit-log.archived-<ISO timestamp>.json`
 * sidecar (via the same atomic `writeJsonFile` helper) and the active log
 * restarts fresh. `query()`/`exportAuditLog()` intentionally still only READ
 * entries from the active log, not archived sidecars — archived files remain
 * cold storage for manual/operator recovery, consistent with this being a
 * lightweight rotation scheme rather than a database migration. However
 * (security review follow-up, same day), `query()`'s result now also reports
 * `hasArchivedHistory` / `archivedFileCount` — a cheap directory-listing check,
 * not a content read — so callers/exports are never silently unaware that
 * older, rotated-out history exists elsewhere.
 */
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
      opts.quarantineFilePath
        ? "Audit log integrity error: the file is corrupt or unreadable. Original bytes preserved in quarantine sidecar."
        : "Audit log integrity error: the file is corrupt or unreadable. Quarantine of the original bytes failed — manual recovery required."
    );
    this.name = "AuditLogIntegrityError";
    this.logFilePath = opts.logFilePath;
    this.quarantineFilePath = opts.quarantineFilePath;
    this.cause = opts.cause;
  }
}

export interface AuditLogServiceOptions {
  /**
   * Override the entry-count rotation threshold. Defaults to
   * `AuditLogService.DEFAULT_ROTATION_THRESHOLD_ENTRIES` (5000).
   * Intended for unit tests that need to exercise rotation without appending
   * thousands of entries.
   */
  rotationThresholdEntries?: number;
}

export class AuditLogService {
  /**
   * Rotation threshold for the active audit log.
   *
   * Once the active log accumulates this many entries, the NEXT append
   * archives the full active history to a uniquely named, timestamped
   * sidecar file and restarts the active log fresh (containing only the
   * entry that triggered rotation).
   *
   * This is a deliberately simple entry-count trigger — not age-based
   * bucketing, not a SQLite migration. For a single shared workstation
   * generating on the order of tens of edits per day, 5,000 entries
   * represents several months of accumulated history, so rotation stays
   * infrequent while still putting a firm, testable upper bound on the cost
   * of the read + Zod-validate + rewrite cycle that `append()` performs on
   * every single call — that cycle can no longer grow unbounded with the
   * app's total lifetime audit history.
   */
  private static readonly DEFAULT_ROTATION_THRESHOLD_ENTRIES = 5000;

  private readonly rotationThresholdEntries: number;

  private writeQueue: Promise<void> = Promise.resolve();

  /**
   * Tracks whether a read/parse failure has been detected for this service
   * instance.  Once set, appends are refused until
   * `recoverFromIntegrityError()` is called.
   */
  private integrityError: AuditLogIntegrityError | null = null;

  constructor(options: AuditLogServiceOptions = {}) {
    this.rotationThresholdEntries =
      options.rotationThresholdEntries ?? AuditLogService.DEFAULT_ROTATION_THRESHOLD_ENTRIES;
  }

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
    } catch (accessErr) {
      // Only create a fresh empty log when the file genuinely does not exist.
      // Any other error (EACCES, EMFILE, …) means the file may exist but is
      // transiently unreadable — silently overwriting it with [] would destroy
      // audit history with no quarantine.  Rethrow and let the caller handle it.
      if ((accessErr as NodeJS.ErrnoException)?.code !== "ENOENT") {
        throw accessErr;
      }
      await writeJsonFile(filePath, []);
    }
  }

  /**
   * Transient OS error codes that should NOT latch `integrityError`.
   *
   * These four codes are safe-transient because they are purely resource
   * exhaustion or scheduling signals — they carry no information about the
   * file's contents and resolve automatically once the kernel releases the
   * resource.  The service self-heals on the next call.
   *
   * EACCES is intentionally excluded: a file that is both corrupt AND has its
   * permissions set to 0o000 would escape quarantine permanently if we treated
   * EACCES as transient.  EACCES therefore falls through to the existing
   * quarantine-and-latch path, preserving the fail-closed guarantee.
   */
  private static readonly TRANSIENT_FS_CODES = new Set([
    "EMFILE",  // process fd table exhausted
    "ENFILE",  // system-wide fd table exhausted
    "EAGAIN",  // resource temporarily unavailable (non-blocking fd)
    "EBUSY",   // device or resource busy (e.g. Windows file lock analogue)
  ]);

  /**
   * Attempt to read and parse the audit-log file.
   *
   * On success: returns the parsed entries array.
   * On ENOENT: returns an empty array (no quarantine needed).
   * On a transient OS error (EMFILE, ENFILE, EAGAIN, EBUSY): rethrows
   *   the original error as-is WITHOUT latching `integrityError` so the service
   *   self-heals on the next call.
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
      const code = (readErr as NodeJS.ErrnoException)?.code ?? "";

      // File simply does not exist — return empty, no quarantine needed.
      if (code === "ENOENT") {
        return [];
      }

      // Transient OS error — rethrow without latching integrityError.
      // The service will self-heal once the OS condition resolves.
      if (AuditLogService.TRANSIENT_FS_CODES.has(code)) {
        throw readErr;
      }

      // Unreadable file (unknown IO error) — quarantine & fail closed.
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
   * Returns the sidecar path on success, `null` on failure or when bytes are
   * unavailable (e.g. the file was unreadable — there is nothing to preserve).
   * Never throws.  The original file is NOT modified.
   */
  private async quarantine(originalFilePath: string, bytes: Buffer | undefined): Promise<string | null> {
    if (bytes === undefined) {
      // No bytes to preserve (file was unreadable before we could read it).
      return null;
    }
    try {
      const safeTs = new Date().toISOString().replace(/[:.]/g, "-");
      const dir = path.dirname(originalFilePath);
      const base = path.basename(originalFilePath, ".json");
      const sidecar = path.join(dir, `${base}.corrupt-${safeTs}.json`);
      await ensureDirectory(dir);
      // Write exactly the original bytes — faithful copy of what was on disk.
      await fs.writeFile(sidecar, bytes);
      return sidecar;
    } catch {
      return null;
    }
  }

  /**
   * Archive `entries` (the full active history at the moment rotation is
   * triggered) to a uniquely named, timestamped sidecar next to the active
   * log file — e.g. `audit-log.archived-2026-07-14T10-00-00-000Z.json`.
   *
   * A full timestamp (mirroring the existing `quarantine()` sidecar naming
   * convention above), not just a year-month, is used so the archive
   * filename can never collide even if rotation is triggered more than once
   * within the same calendar month — no merge/append-to-archive logic is
   * needed as a result, keeping this a genuinely simple rotation scheme.
   *
   * Uses the same atomic dual-fsync `writeJsonFile` helper as the active
   * log — no new I/O primitive is introduced for archiving.
   */
  private async archive(filePath: string, entries: AuditLogEntry[]): Promise<void> {
    const safeTs = new Date().toISOString().replace(/[:.]/g, "-");
    const dir = path.dirname(filePath);
    const base = path.basename(filePath, ".json");
    const archivePath = path.join(dir, `${base}.archived-${safeTs}.json`);
    await ensureDirectory(dir);
    await writeJsonFile(archivePath, entries);
  }

  /**
   * Follow-up (security review, 2026-07-14): count the archived
   * sidecar files (`<base>.archived-<timestamp>.json`) sitting next to the
   * active log, WITHOUT reading/parsing their contents — a `fs.readdir` +
   * filename filter is all that's needed to tell callers that older history
   * exists elsewhere. This keeps `query()`/`exportAuditLog()` cheap: they
   * still only read the active log, but no longer do so silently when
   * archived history is present.
   *
   * Never throws: if the directory cannot be listed (e.g. it does not exist
   * yet, or a transient permission error), archived-file visibility is
   * best-effort and falls back to 0 rather than failing the query/export.
   */
  private async countArchivedFiles(filePath: string): Promise<number> {
    const dir = path.dirname(filePath);
    const base = path.basename(filePath, ".json");
    try {
      const entries = await fs.readdir(dir);
      return entries.filter((name) => name.startsWith(`${base}.archived-`) && name.endsWith(".json")).length;
    } catch {
      return 0;
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

      let activeEntries = entries;
      if (activeEntries.length >= this.rotationThresholdEntries) {
        // Bound the cost of every future append by archiving
        // the accumulated history now and continuing with a clean active log.
        //
        // Security review follow-up (2026-07-14) — accepted non-atomicity:
        // `archive()` and the `activeEntries = []` reset below are two
        // separate operations, not one atomic transaction. If the process
        // crashes in the window AFTER `archive()`'s writeJsonFile has fully
        // committed the sidecar but BEFORE the next line's `writeJsonFile`
        // call persists the reset active log, the active log on disk still
        // holds the same entries that were just archived. On the next
        // `append()` call (post-restart), those entries would be re-archived
        // into a second, distinctly-named sidecar the next time the
        // threshold is hit — producing a *duplicate* copy of that batch of
        // entries across two archive files, never a loss of entries.
        //
        // This is a deliberate, accepted tradeoff for this simple
        // (non-SQLite, no two-phase-commit) rotation design: duplication is
        // recoverable (an operator/future dedup tool can diff timestamps),
        // whereas losing audit entries is not. Building real two-phase-commit
        // semantics here would be over-engineering for a local single-user
        // app with an already-tiny crash window (two fast sequential atomic
        // writes). Do not "fix" this without discussing the tradeoff first.
        await this.archive(filePath, activeEntries);
        activeEntries = [];
      }

      activeEntries.push(validated);
      await writeJsonFile(filePath, activeEntries);
    });
  }

  /**
   * Query the audit log.  Unlike the old implementation, corruption now
   * surfaces as a thrown `AuditLogIntegrityError` rather than silently
   * returning an empty result set, so callers can distinguish "no entries"
   * from "log is damaged".
   *
   * Symmetrical with `append()`: if an integrity error has already been cached
   * on this instance, short-circuit immediately without re-reading the file.
   * This prevents repeated quarantine sidecar proliferation on every query.
   */
  async query(params: AuditLogQueryParams): Promise<AuditLogResult> {
    if (this.integrityError !== null) {
      throw this.integrityError;
    }

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

    // Follow-up (security review): surface archived-history visibility
    // rather than silently reading only the active log with no indication that
    // older, rotated-out entries exist elsewhere.
    const archivedFileCount = await this.countArchivedFiles(filePath);

    return {
      entries: filtered.slice().reverse(),
      totalCount: filtered.length,
      hasArchivedHistory: archivedFileCount > 0,
      archivedFileCount
    };
  }

  /**
   * Explicit recovery path.
   *
   * After a corruption event the service refuses all appends.  Call this
   * method deliberately (after reviewing the quarantine sidecar) to clear the
   * integrity-error state and start a fresh, empty audit log.
   *
   * The write is enqueued so it cannot race any already-queued append on the
   * same `.tmp` path.  `this.integrityError` is cleared only after the atomic
   * write succeeds, so a failed recovery write leaves the service still blocked
   * and retryable.
   *
   * The quarantine sidecar produced during the corruption detection is NOT
   * deleted here — it must be removed by the operator.
   */
  async recoverFromIntegrityError(): Promise<void> {
    return this.enqueueWrite(async () => {
      // No-op guard: do not destroy a healthy log when there is no active
      // integrity error.  Calling this method on a healthy service is a
      // programming mistake, not a recovery event.
      if (this.integrityError === null) {
        return;
      }

      const filePath = this.getFilePath();
      await ensureDirectory(path.dirname(filePath));
      await writeJsonFile(filePath, []);
      // Only clear the error state once the write has succeeded atomically.
      this.integrityError = null;
    });
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

      // Neutralize CSV formula injection (CWE-1236): if the first character is a
      // formula trigger, prepend an apostrophe so spreadsheet apps treat the cell
      // as text rather than executing it as a formula.
      const neutralized = /^[=+\-@\t\r]/.test(str) ? `'${str}` : str;

      if (neutralized.includes(",") || neutralized.includes('"') || neutralized.includes("\n") || neutralized.includes("\r")) {
        return `"${neutralized.replace(/"/g, '""')}"`;
      }

      return neutralized;
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
