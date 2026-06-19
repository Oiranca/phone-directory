/**
 * AppDataAuditFacade
 *
 * Owns the audit-log responsibility that was previously inlined in AppDataService.
 * It wraps AuditLogService and provides the three audit-facing operations that the
 * IPC layer (via AppDataService) needs:
 *
 *   - query   → getAuditLog
 *   - export  → exportAuditLog
 *   - append  → appendEntry  (called inside write-queue closures; no queue involvement here)
 *
 * AppDataService holds an instance of this class and delegates to it.  All public
 * method signatures and behaviors are preserved exactly — this is a seam extraction,
 * not a redesign.
 */

import path from "node:path";
import fs from "node:fs/promises";
import { ensureDirectory } from "../utils/fs-json.js";
import { AuditLogIntegrityError, AuditLogService } from "./audit-log.service.js";
import type {
  AuditLogEntry,
  AuditLogQueryParams,
  AuditLogResult,
  ExportAuditLogResult
} from "../../shared/types/contact.js";

export class AppDataAuditFacade {
  private readonly auditLog = new AuditLogService();
  /** Set to true after the integrity-error block has been logged once per process instance. */
  private integrityErrorLogged = false;

  async getAuditLog(params: AuditLogQueryParams): Promise<AuditLogResult> {
    return this.auditLog.query(params);
  }

  async exportAuditLog(targetFilePath: string, params: AuditLogQueryParams): Promise<ExportAuditLogResult> {
    const result = await this.auditLog.query(params);
    const csv = this.auditLog.toCsv(result.entries);
    const directory = path.dirname(targetFilePath);
    await ensureDirectory(directory);
    await fs.writeFile(targetFilePath, csv, "utf-8");
    return {
      filePath: targetFilePath,
      exportedAt: new Date().toISOString(),
      entryCount: result.entries.length
    };
  }

  /**
   * Append a single entry to the audit log.
   *
   * Audit failures are intentionally non-fatal: contact mutations must not be
   * blocked by an audit-log write error.  This matches the previous behavior
   * inlined in AppDataService.appendAuditEntry.
   */
  async appendEntry(entry: AuditLogEntry): Promise<void> {
    try {
      await this.auditLog.append(entry);
    } catch (error) {
      if (error instanceof AuditLogIntegrityError) {
        // The audit log is corrupt.  The service has already quarantined the
        // original bytes.  We surface a distinct log message so operators can
        // identify the quarantine sidecar and call recoverFromIntegrityError().
        //
        // One-shot latch: log the full details only on the FIRST occurrence.
        // Every subsequent call that re-enters this branch (while the underlying
        // AuditLogService keeps rejecting appends) is silently dropped to avoid
        // spamming the console once per contact mutation.
        if (!this.integrityErrorLogged) {
          this.integrityErrorLogged = true;
          // Full paths are logged exactly once so the operator can locate and
          // recover the quarantine sidecar.  The latch ensures they never repeat.
          console.error(
            "[AuditLog] INTEGRITY ERROR — audit log is corrupt and all further appends are blocked.",
            "Quarantine sidecar:", error.quarantineFilePath ?? "(quarantine failed)",
            "Log file:", error.logFilePath,
          );
        }
      } else {
        // FIX 4 (PR #67): log only the error code and message, not the full error
        // object, to avoid leaking absolute filesystem paths into the console.
        const errCode = (error as NodeJS.ErrnoException)?.code;
        const errMsg = error instanceof Error ? error.message : String(error);
        console.error(`[AuditLog] Failed to append entry — ${errCode ? errCode + ": " : ""}${errMsg}`);
      }
      // Audit failure does not block the contact mutation — intentional.
    }
  }

  /**
   * Clear the latched integrity-error state on the underlying AuditLogService so
   * that subsequent appends are attempted again.
   *
   * After an AuditLogIntegrityError the service stops accepting new entries for
   * the lifetime of the process.  Callers (e.g. an IPC entrypoint) can invoke
   * this to resume audit logging once the operator has resolved the underlying
   * file corruption.
   *
   * Note: an IPC entrypoint can call AppDataService.recoverAuditLog() which
   * delegates here — no new IPC channel is required for the current use-case.
   */
  async recoverFromIntegrityError(): Promise<void> {
    return this.auditLog.recoverFromIntegrityError();
  }
}
