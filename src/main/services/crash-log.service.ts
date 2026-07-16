/**
 * Dedicated, best-effort crash log for main-process-level
 * failures (uncaughtException / unhandledRejection / render-process-gone).
 *
 * This deliberately does NOT reuse AuditLogService:
 *   - AuditLogService's schema (auditLogEntrySchema) requires an `editor`
 *     field and a closed `action` enum tied to contact-record mutations
 *     (create/update/delete/bulk-import/...) — a system-level crash event
 *     does not fit that shape without abusing it.
 *   - AuditLogService's append() is async, queued, and does an atomic
 *     rename+fsync — appropriate for normal operation, but a poor fit for a
 *     crash handler that may run while the process is already in the middle
 *     of exiting: an in-flight async write could simply never complete.
 *
 * logCrash() is therefore synchronous and never throws — a broken or
 * unwritable crash log must never prevent the crash dialog or process exit
 * from happening.
 */
import fs from "node:fs";
import path from "node:path";
import { getCrashLogFilePath } from "../utils/paths.js";

export type CrashSource = "uncaughtException" | "unhandledRejection" | "render-process-gone";

export interface CrashLogEntry {
  timestamp: string;
  source: CrashSource;
  message: string;
  stack?: string;
}

export type CrashLogInput = Omit<CrashLogEntry, "timestamp"> & { timestamp?: string };

/**
 * Appends a single crash record as a JSON line to the crash log file.
 * Best-effort: any failure (unwritable disk, missing userData path, etc.)
 * is swallowed so it can never mask the original crash being reported.
 */
export const logCrash = (entry: CrashLogInput): void => {
  try {
    const filePath = getCrashLogFilePath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });

    const record: CrashLogEntry = {
      timestamp: entry.timestamp ?? new Date().toISOString(),
      source: entry.source,
      message: entry.message,
      ...(entry.stack ? { stack: entry.stack } : {})
    };

    fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`, "utf-8");
  } catch {
    // Never let a broken crash-log write mask the original crash.
  }
};
