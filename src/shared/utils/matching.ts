/**
 * matching.ts — Pure shared helpers for phone normalization, display-name
 * normalization, and dataset metadata counting, extracted from
 * duplicate-detection.service.ts and csv-import.service.ts as part of OIR-119.
 * OIR-134 superseded the OIR-119 display-name divergence — now unified to NFKD.
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
 * 2. `normalizeDisplayName` — canonical NFKD display-name normalizer:
 *    trim + NFKD + strip diacritics (\p{Diacritic}) + lowercase + collapse spaces.
 *    Used by:
 *      - duplicate-detection.service.ts (formerly NFD + char-range — unified here)
 *      - spreadsheet-normalize.ts `normalizeDisplayNameForMerge` (re-exported alias)
 *      - spreadsheet-parsers.ts cross-sheet merge key
 *
 * 3. `computeMetadataCounts` — count records by type and area. Logic is
 *    byte-identical across:
 *      - csv-import.service.ts `buildDataset`
 *      - app-data.service.ts `buildNextDataset`
 *
 * 4. `normalizePhoneForMergeDedup` — strip non-digits then keep the last 9
 *    digits. Canonical shared form of the phone normalization used in the
 *    merge step:
 *      - app-data.service.ts `mergeDuplicates` inline `normalizePhoneNumber`
 *      - renderer MergeLossPreview.tsx `computeMergeLossPreview`
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
 * Strips all non-digit characters from a phone string, then retains only the
 * last 9 digits.
 *
 * This is the merge-dedup variant: two phone entries are considered the same
 * contact method when their last 9 digits match, regardless of country prefix.
 *
 * Canonical shared form used by:
 *   - app-data.service.ts `mergeDuplicates` (was an inline `normalizePhoneNumber`)
 *   - renderer `MergeLossPreview.tsx` `computeMergeLossPreview`
 */
export const normalizePhoneForMergeDedup = (phone: string): string =>
  phone.replace(/\D/g, "").slice(-9);

/**
 * Canonical display-name normalizer (NFKD form).
 *
 * Applies: trim → NFKD normalize → strip all \p{Diacritic} code points →
 * lowercase → collapse internal whitespace.
 *
 * Two names that are equal after this transform are considered the same
 * contact for deduplication and cross-sheet merge purposes.
 *
 * OIR-134: supersedes the separate NFD+char-range form that lived in
 * duplicate-detection.service.ts (OIR-119 had deliberately kept them apart;
 * OIR-134 unifies both callers to NFKD). The NFKD form handles compatibility
 * characters (ligatures, halfwidth) that NFD does not decompose.
 *
 * Used by:
 *   - duplicate-detection.service.ts (was NFD + char-range, now points here)
 *   - spreadsheet-normalize.ts `normalizeDisplayNameForMerge` (re-exported alias)
 *   - spreadsheet-parsers.ts cross-sheet merge key (via normalizeDisplayNameForMerge)
 */
export const normalizeDisplayName = (name: string): string =>
  name
    .trim()
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/\s+/g, " ");

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
