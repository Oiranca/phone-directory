/**
 * matching.ts — Pure shared helpers for phone normalization and dataset
 * metadata counting, extracted from duplicate-detection.service.ts and
 * csv-import.service.ts as part of OIR-119.
 *
 * All functions are PURE: no I/O, no side effects, no Node.js built-ins.
 *
 * ## What is shared here
 *
 * 1. `normalizePhoneForDedup` — strip all non-digit characters from a phone
 *    string. Logic is byte-identical across:
 *      - spreadsheet-normalize.ts `normalizeNumberForDedup`
 *      - duplicate-detection.service.ts `normalizePhoneNumber` (private method)
 *      - app-data.service.ts inline in `buildStableMergeKeys` / `mergeImportedRecordFields`
 *
 * 2. `computeMetadataCounts` — count records by type and area. Logic is
 *    byte-identical across:
 *      - csv-import.service.ts `buildDataset`
 *      - app-data.service.ts `buildNextDataset`
 *
 * ## What is deliberately NOT shared
 *
 * - `normalizeDisplayName` in duplicate-detection.service.ts uses NFD +
 *   character-range `[̀-ͯ]`.
 * - `normalizeDisplayNameForMerge` in spreadsheet-normalize.ts uses NFKD +
 *   `\p{Diacritic}`.
 *
 *   These differ in Unicode normalization form and diacritic removal regex.
 *   The divergence is intentional (different callers, different match semantics)
 *   and is locked by the parity test in matching.parity.test.ts.
 *
 * - `normalizePhoneNumber` in app-data.service.ts `mergeDuplicates` (line ~626)
 *   additionally applies `.slice(-9)` for the merge-dedup step. This variant is
 *   NOT the same as `normalizePhoneForDedup` and is intentionally kept inline
 *   inside `mergeDuplicates`.
 */

import type { AreaType, RecordType } from "../constants/catalogs.js";
import type { ContactRecord } from "../types/contact.js";

/**
 * Strips all non-digit characters from a phone string.
 *
 * Canonical shared form of the phone normalization used by:
 *   - duplicate-detection: `normalizePhoneNumber(phone)`
 *   - spreadsheet-normalize: `normalizeNumberForDedup(number)`
 *   - app-data buildStableMergeKeys: `phone.number.replace(/\D/g, "")`
 *   - app-data mergeImportedRecordFields: `phone.number.replace(/\D/g, "")`
 */
export const normalizePhoneForDedup = (phone: string): string => phone.replace(/\D/g, "");

/**
 * Counts records by `type` and by `organization.area`, returning the two
 * partial record-maps used in `DirectoryDataset.metadata`.
 *
 * Canonical shared form of the counting loop used by:
 *   - csv-import.service.ts `buildDataset`
 *   - app-data.service.ts `buildNextDataset`
 */
export const computeMetadataCounts = (
  records: ContactRecord[]
): {
  typeCounts: Partial<Record<RecordType, number>>;
  areaCounts: Partial<Record<AreaType, number>>;
} => {
  const typeCounts: Partial<Record<RecordType, number>> = {};
  const areaCounts: Partial<Record<AreaType, number>> = {};

  for (const record of records) {
    typeCounts[record.type] = (typeCounts[record.type] ?? 0) + 1;

    if (record.organization.area) {
      areaCounts[record.organization.area] = (areaCounts[record.organization.area] ?? 0) + 1;
    }
  }

  return { typeCounts, areaCounts };
};
