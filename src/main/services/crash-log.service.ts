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

export const MAX_CRASH_LOG_MESSAGE_LENGTH = 1_000;
export const MAX_CRASH_LOG_STACK_LENGTH = 4_000;
export const MAX_CRASH_LOG_ENTRIES = 100;

const DIAGNOSTIC_SUFFIX_PATTERNS = [
  /\s+Ruta afectada:.*$/u,
  /\s+Ruta de origen:.*$/u,
  /\s+Ruta de destino:.*$/u,
  /\s+Archivo afectado:.*$/u
];

// Matches absolute POSIX paths (leading `/`) and Windows paths (`C:\...`).
// Spaces are allowed because user profiles, share names, and hospital folders
// often include them and can carry PII.
const WINDOWS_ABSOLUTE_PATH_PATTERN = /[A-Za-z]:[\\/][^\r\n"'<>]+/gu;
const POSIX_ABSOLUTE_PATH_PATTERN = /\/[^\r\n"'<>]+/gu;

export interface CrashLogEntry {
  timestamp: string;
  source: CrashSource;
  message: string;
  stack?: string;
}

export type CrashLogInput = Omit<CrashLogEntry, "timestamp"> & { timestamp?: string };

export const redactCrashLogText = (text: string): string => {
  const withoutDiagnosticSuffixes = DIAGNOSTIC_SUFFIX_PATTERNS.reduce(
    (current, pattern) => current.replace(pattern, ""),
    text
  );

  const replaceWithBasename = (match: string, win32Path = false) => {
    try {
      const basename = win32Path ? path.win32.basename(match) : path.posix.basename(match);
      return basename || "<ruta oculta>";
    } catch {
      return "<ruta oculta>";
    }
  };

  return withoutDiagnosticSuffixes
    .replace(WINDOWS_ABSOLUTE_PATH_PATTERN, (match) => replaceWithBasename(match, true))
    .replace(POSIX_ABSOLUTE_PATH_PATTERN, (match) => replaceWithBasename(match));
};

const truncateCrashLogText = (text: string, maxLength: number): string =>
  text.length > maxLength ? `${text.slice(0, maxLength)}... [truncated]` : text;

const sanitizeCrashLogText = (text: string, maxLength: number): string =>
  truncateCrashLogText(redactCrashLogText(text), maxLength);

const sanitizeExistingCrashLogEntry = (line: string): string | null => {
  try {
    const parsed = JSON.parse(line) as Partial<CrashLogEntry>;
    if (
      typeof parsed.timestamp !== "string" ||
      !["uncaughtException", "unhandledRejection", "render-process-gone"].includes(String(parsed.source)) ||
      typeof parsed.message !== "string"
    ) {
      return null;
    }

    const record: CrashLogEntry = {
      timestamp: parsed.timestamp,
      source: parsed.source as CrashSource,
      message: sanitizeCrashLogText(parsed.message, MAX_CRASH_LOG_MESSAGE_LENGTH),
      ...(typeof parsed.stack === "string"
        ? { stack: sanitizeCrashLogText(parsed.stack, MAX_CRASH_LOG_STACK_LENGTH) }
        : {})
    };

    return JSON.stringify(record);
  } catch {
    return null;
  }
};

const sanitizeAndRotateCrashLogIfNeeded = (filePath: string): void => {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const contents = fs.readFileSync(filePath, "utf-8");
  const sanitizedLines = contents
    .split("\n")
    .filter(Boolean)
    .map(sanitizeExistingCrashLogEntry)
    .filter((line): line is string => Boolean(line));

  const retainedLines = sanitizedLines.slice(-(MAX_CRASH_LOG_ENTRIES - 1));
  const tempFilePath = `${filePath}.tmp`;
  fs.writeFileSync(tempFilePath, retainedLines.length > 0 ? `${retainedLines.join("\n")}\n` : "", "utf-8");
  fs.renameSync(tempFilePath, filePath);
};

/**
 * Appends a single crash record as a JSON line to the crash log file.
 * Best-effort: any failure (unwritable disk, missing userData path, etc.)
 * is swallowed so it can never mask the original crash being reported.
 */
export const logCrash = (entry: CrashLogInput): void => {
  try {
    const filePath = getCrashLogFilePath();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    sanitizeAndRotateCrashLogIfNeeded(filePath);

    const record: CrashLogEntry = {
      timestamp: entry.timestamp ?? new Date().toISOString(),
      source: entry.source,
      message: sanitizeCrashLogText(entry.message, MAX_CRASH_LOG_MESSAGE_LENGTH),
      ...(entry.stack ? { stack: sanitizeCrashLogText(entry.stack, MAX_CRASH_LOG_STACK_LENGTH) } : {})
    };

    fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`, "utf-8");
  } catch {
    // Never let a broken crash-log write mask the original crash.
  }
};
