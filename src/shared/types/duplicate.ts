/**
 * Minimal phone data needed to render the dedup UI.
 * Full PhoneContact has 8 fields; we only need 3 for display.
 */
export interface DuplicatePhoneSummary {
  id: string;
  label?: string;
  number: string;
}

/**
 * Minimal per-record data carried in DuplicateDetectionResult.records.
 * Includes ONLY the fields DeduplicatePage actually renders:
 *   - id (selection / merge dispatch)
 *   - displayName (primary label)
 *   - department (sub-label)
 *   - phones (phone list with label + number)
 */
export interface DuplicateRecordSummary {
  id: string;
  displayName: string;
  department?: string;
  phones: DuplicatePhoneSummary[];
}

/**
 * A detected duplicate pair using minimal record summaries.
 * recordA / recordB reference DuplicateRecordSummary objects
 * which are also present in DuplicateDetectionResult.records for dedup.
 */
export interface DuplicatePair {
  id: string;          // canonical key: min(idA,idB) + ':' + max(idA,idB)
  recordA: DuplicateRecordSummary;
  recordB: DuplicateRecordSummary;
  reasons: string[];
  score: number;
}

export interface DuplicateDetectionResult {
  /**
   * Lightweight pair summaries. Each pair's recordA / recordB reference
   * summaries that are also keyed in `records` to avoid double-sending
   * when the same record appears in multiple pairs.
   *
   * Payload target: < 5 KB for 50 pairs (vs ~200 KB for full ContactRecords).
   */
  pairs: DuplicatePair[];
  /**
   * Map from record id → minimal display summary.
   * All ids referenced by pairs[].recordA.id / recordB.id are guaranteed present.
   * Consumers can look up full record data via this map if needed.
   */
  records: Record<string, DuplicateRecordSummary>;
  checkedCount: number; // total records scanned
  pairCount: number;   // total pairs found
}
