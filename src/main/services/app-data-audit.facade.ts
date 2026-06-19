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
        console.error(
          "[AuditLog] INTEGRITY ERROR — audit log is corrupt and all further appends are blocked.",
          "Quarantine sidecar:", error.quarantineFilePath ?? "(quarantine failed)",
          "Log file:", error.logFilePath,
        );
      } else {
        console.error("[AuditLog] Failed to append entry:", error);
      }
      // Audit failure does not block the contact mutation — intentional.
    }
  }
}
