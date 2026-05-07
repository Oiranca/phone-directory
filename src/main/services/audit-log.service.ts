import path from "node:path";
import fs from "node:fs/promises";
import { auditLogEntrySchema, auditLogSchema } from "../../shared/schemas/contact.js";
import type { AuditLogEntry, AuditLogQueryParams, AuditLogResult } from "../../shared/types/contact.js";
import { ensureDirectory, readJsonFile, writeJsonFile } from "../utils/fs-json.js";
import { getAuditLogFilePath } from "../utils/paths.js";

export class AuditLogService {
  private writeQueue: Promise<void> = Promise.resolve();

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

  async append(entry: AuditLogEntry): Promise<void> {
    return this.enqueueWrite(async () => {
      const validated = auditLogEntrySchema.parse(entry);
      const filePath = this.getFilePath();
      let entries: AuditLogEntry[] = [];

      try {
        entries = auditLogSchema.parse(await readJsonFile(filePath));
      } catch {
        entries = [];
      }

      entries.push(validated);
      await writeJsonFile(filePath, entries);
    });
  }

  async query(params: AuditLogQueryParams): Promise<AuditLogResult> {
    const filePath = this.getFilePath();
    let entries: AuditLogEntry[] = [];

    try {
      entries = auditLogSchema.parse(await readJsonFile(filePath));
    } catch {
      return { entries: [], totalCount: 0 };
    }

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
