import type { ContactRecord } from "../../shared/types/contact.js";
import type { DuplicatePair, DuplicateDetectionResult } from "../../shared/types/duplicate.js";

export class DuplicateDetectionService {
  /**
   * Detect potential duplicate ContactRecord entries in dataset.
   * O(n²) comparison with early-exit optimization: skips pairs with zero matching signals.
   * Performance: filters impossible pairs before expensive string operations.
   * At scale > 10k records, add name-prefix indexing for ~90% reduction in comparisons.
   */
  detectDuplicates(records: ContactRecord[]): DuplicateDetectionResult {
    const pairs: DuplicatePair[] = [];
    const seenPairKeys = new Set<string>();

    // Precompute signals for each record (cheap cache to skip impossible pairs)
    const signals = records.map((r) => ({
      record: r,
      hasExternalId: !!r.externalId,
      hasPhones: r.contactMethods.phones.length > 0,
      namePrefix: this.normalizeDisplayName(r.displayName).slice(0, 3)
    }));

    for (let i = 0; i < signals.length; i++) {
      const signalA = signals[i]!;

      for (let j = i + 1; j < signals.length; j++) {
        const signalB = signals[j]!;

        // Fast pre-check: skip pairs with zero possible matches
        // A pair can match on: externalId, phone, displayName, or dept+name
        // Note: namePrefix is heuristic only - Levenshtein matches may cross prefix boundaries
        const hasExternalIdChance =
          signalA.hasExternalId && signalB.hasExternalId;
        const hasPhoneChance =
          signalA.hasPhones && signalB.hasPhones;
        const hasNameChance =
          signalA.record.displayName && signalB.record.displayName;
        const hasDeptChance =
          signalA.record.organization.department &&
          signalB.record.organization.department &&
          signalA.record.organization.department === signalB.record.organization.department;

        const canMatch =
          hasExternalIdChance || hasPhoneChance || hasNameChance || hasDeptChance;

        if (!canMatch) continue; // Skip impossible pairs

        const matchResult = this.matchRecords(signalA.record, signalB.record);

        if (matchResult.reasons.length > 0) {
          const pairKey = this.canonicalPairKey(signalA.record.id, signalB.record.id);

          if (!seenPairKeys.has(pairKey)) {
            seenPairKeys.add(pairKey);
            pairs.push({
              id: pairKey,
              recordA: signalA.record,
              recordB: signalB.record,
              reasons: matchResult.reasons,
              score: matchResult.score
            });
          }
        }
      }
    }

    // Sort by score descending (highest = most likely duplicate)
    pairs.sort((a, b) => b.score - a.score);

    return {
      pairs,
      checkedCount: records.length,
      pairCount: pairs.length
    };
  }

  private matchRecords(
    recordA: ContactRecord,
    recordB: ContactRecord
  ): { reasons: string[]; score: number } {
    const reasons: string[] = [];
    let maxScore = 0;

    // 1. ExternalId match (score: 1.0)
    if (recordA.externalId && recordB.externalId && recordA.externalId === recordB.externalId) {
      reasons.push("externalId");
      maxScore = Math.max(maxScore, 1.0);
    }

    // 2. Phone match (score: 0.95)
    const phoneMatches = this.findMatchingPhones(recordA, recordB);
    if (phoneMatches.length > 0) {
      reasons.push(...phoneMatches.map((phone) => `phone:${phone}`));
      maxScore = Math.max(maxScore, 0.95);
    }

    // 3. Exact displayName match (score: 0.9)
    const normalizedA = this.normalizeDisplayName(recordA.displayName);
    const normalizedB = this.normalizeDisplayName(recordB.displayName);

    if (normalizedA && normalizedB && normalizedA === normalizedB) {
      reasons.push("displayName");
      maxScore = Math.max(maxScore, 0.9);
    }

    // 4. Fuzzy displayName match (score: 0.6–0.85)
    if (normalizedA && normalizedB && normalizedA !== normalizedB) {
      const similarity = this.bigramSimilarity(normalizedA, normalizedB);
      if (similarity >= 0.85) {
        reasons.push("displayName:fuzzy");
        maxScore = Math.max(maxScore, similarity * 0.85); // scale to 0.6–0.85 range
      }
    }

    // 5. Levenshtein signal (score: 0.75)
    // Length-aware threshold: reject short names (< 3 chars) to avoid false positives like Ana/Eva
    if (normalizedA && normalizedB && normalizedA.length >= 3 && normalizedB.length >= 3) {
      const lev = this.levenshtein(normalizedA, normalizedB);
      const maxLev = Math.ceil(normalizedA.length * 0.2); // 20% of length, min 1
      if (lev > 0 && lev <= maxLev && normalizedA !== normalizedB) {
        reasons.push("displayName:levenshtein");
        maxScore = Math.max(maxScore, 0.75);
      }
    }

    // 6. Same-department + similar-name signal (score: 0.65)
    const deptA = (recordA.organization.department ?? "").trim().toLowerCase();
    const deptB = (recordB.organization.department ?? "").trim().toLowerCase();
    if (
      deptA &&
      deptA === deptB &&
      normalizedA &&
      normalizedB &&
      this.bigramSimilarity(normalizedA, normalizedB) >= 0.7
    ) {
      reasons.push("dept+name");
      maxScore = Math.max(maxScore, 0.65);
    }

    return { reasons, score: maxScore };
  }

  private findMatchingPhones(recordA: ContactRecord, recordB: ContactRecord): string[] {
    const phonesA = recordA.contactMethods.phones.map((p) => this.normalizePhoneNumber(p.number));
    const phonesB = recordB.contactMethods.phones.map((p) => this.normalizePhoneNumber(p.number));

    const matches: string[] = [];

    for (const phoneA of phonesA) {
      if (!phoneA) continue;

      for (const phoneB of phonesB) {
        if (!phoneB) continue;

        // Compare last 9 digits (handles country code variations)
        const suffixA = phoneA.slice(-9);
        const suffixB = phoneB.slice(-9);

        if (suffixA === suffixB && suffixA.length === 9) {
          matches.push(phoneA);
          break; // only record each phoneA once
        }
      }
    }

    return matches;
  }

  private normalizePhoneNumber(phone: string): string {
    // Strip all non-digit chars (matches app-data.service.ts pattern)
    return phone.replace(/\D/g, "");
  }

  private normalizeDisplayName(name: string): string {
    return name
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/\s+/g, " ");
  }

  /**
   * Jaccard similarity on character bigrams.
   * Returns 0.0–1.0 (1.0 = identical).
   */
  private bigramSimilarity(a: string, b: string): number {
    const bigramsA = this.extractBigrams(a);
    const bigramsB = this.extractBigrams(b);

    if (bigramsA.size === 0 && bigramsB.size === 0) return 1.0;
    if (bigramsA.size === 0 || bigramsB.size === 0) return 0.0;

    const intersection = new Set([...bigramsA].filter((bg) => bigramsB.has(bg)));
    const union = new Set([...bigramsA, ...bigramsB]);

    return intersection.size / union.size;
  }

  private extractBigrams(str: string): Set<string> {
    const bigrams = new Set<string>();
    for (let i = 0; i < str.length - 1; i++) {
      bigrams.add(str.slice(i, i + 2));
    }
    return bigrams;
  }

  /**
   * Standard Levenshtein edit distance using dynamic programming.
   */
  private levenshtein(a: string, b: string): number {
    const m = a.length,
      n = b.length;
    const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
      Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
    );
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        dp[i][j] =
          a[i - 1] === b[j - 1]
            ? dp[i - 1][j - 1]
            : 1 + Math.min(dp[i - 1][j - 1]!, dp[i - 1][j]!, dp[i][j - 1]!);
      }
    }
    return dp[m][n]!;
  }

  private canonicalPairKey(idA: string, idB: string): string {
    return idA < idB ? `${idA}:${idB}` : `${idB}:${idA}`;
  }
}
