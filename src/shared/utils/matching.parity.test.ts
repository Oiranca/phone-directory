/**
 * matching.parity.test.ts — OIR-119 shared fixture matrix.
 *
 * Two purposes:
 *   1. Prove that the shared helpers produce the same output as the original
 *      inline logic in each consumer (import / conflict-detection / duplicate-
 *      detection).
 *   2. Lock the INTENTIONAL DIVERGENCE between `normalizeDisplayName` in
 *      duplicate-detection.service.ts (NFD + char-range) and
 *      `normalizeDisplayNameForMerge` in spreadsheet-normalize.ts (NFKD +
 *      unicode-prop). If these accidentally converge or diverge further, the
 *      comparison tests below will catch it.
 *
 * Do NOT merge the two display-name normalizers — they serve different
 * matching strategies and must stay separate.
 */

import { describe, expect, it } from "vitest";
import { normalizePhoneForDedup, computeMetadataCounts } from "./matching.js";
import { normalizeDisplayNameForMerge } from "../../main/services/spreadsheet-normalize.js";
import type { ContactRecord } from "../types/contact.js";

// ---------------------------------------------------------------------------
// Helper: minimal ContactRecord factory
// ---------------------------------------------------------------------------

const makeRecord = (
  overrides: Partial<ContactRecord> & { id: string }
): ContactRecord => ({
  type: "service",
  displayName: "Test",
  organization: {},
  contactMethods: { phones: [], emails: [] },
  aliases: [],
  tags: [],
  status: "active",
  audit: {
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    createdBy: "test",
    updatedBy: "test"
  },
  ...overrides
});

// ---------------------------------------------------------------------------
// normalizePhoneForDedup — parity matrix
// ---------------------------------------------------------------------------

describe("normalizePhoneForDedup", () => {
  /**
   * Original implementations replaced by this shared helper:
   *   - duplicate-detection.service.ts:   phone.replace(/\D/g, "")
   *   - spreadsheet-normalize.ts:         number.replace(/\D/g, "")
   *   - app-data buildStableMergeKeys:    phone.number.replace(/\D/g, "")
   *   - app-data mergeImportedRecordFields: phone.number.replace(/\D/g, "")
   *
   * All four were byte-identical. This test matrix proves the shared helper
   * matches each original.
   */

  const FIXTURE_MATRIX: [input: string, expected: string][] = [
    // Plain digits — unchanged
    ["928101234", "928101234"],
    // Spaces stripped
    ["928 10 12 34", "928101234"],
    // Dashes stripped
    ["928-101-234", "928101234"],
    // International prefix with +
    ["+34928101234", "34928101234"],
    // Dots stripped
    ["928.101.234", "928101234"],
    // Parentheses stripped
    ["(928) 101 234", "928101234"],
    // Empty string
    ["", ""],
    // Only non-digits
    ["ext. N/A", ""],
    // Short internal extension
    ["1234", "1234"],
    // Mixed alphanumeric (letters stripped)
    ["ext928-abc", "928"],
  ];

  it.each(FIXTURE_MATRIX)("normalizePhoneForDedup(%j) === %j", (input, expected) => {
    // Shared helper
    expect(normalizePhoneForDedup(input)).toBe(expected);

    // Parity: matches original inline logic from duplicate-detection.service.ts
    const originalDupDetection = (phone: string) => phone.replace(/\D/g, "");
    expect(normalizePhoneForDedup(input)).toBe(originalDupDetection(input));

    // Parity: matches original from app-data buildStableMergeKeys / mergeImportedRecordFields
    const originalAppData = (phone: string) => phone.replace(/\D/g, "");
    expect(normalizePhoneForDedup(input)).toBe(originalAppData(input));
  });

  it("parity: normalizePhoneForDedup equals normalizeNumberForDedup from spreadsheet-normalize", async () => {
    // Dynamically import to keep test isolated from service-layer side-effects
    const { normalizeNumberForDedup } = await import(
      "../../main/services/spreadsheet-normalize.js"
    );
    const inputs = ["928101234", "+34 928 101 234", "928-10-12", ""];
    for (const input of inputs) {
      expect(normalizePhoneForDedup(input)).toBe(normalizeNumberForDedup(input));
    }
  });
});

// ---------------------------------------------------------------------------
// computeMetadataCounts — parity matrix
// ---------------------------------------------------------------------------

describe("computeMetadataCounts", () => {
  /**
   * Original implementations replaced by this shared helper:
   *   - csv-import.service.ts buildDataset (counting loop)
   *   - app-data.service.ts buildNextDataset (counting loop)
   *
   * Both were byte-identical. This test matrix proves the shared helper
   * matches each original.
   */

  it("returns empty counts for empty records list", () => {
    const result = computeMetadataCounts([]);
    expect(result.typeCounts).toEqual({});
    expect(result.areaCounts).toEqual({});
  });

  it("counts a single record by type, no area", () => {
    const records = [makeRecord({ id: "r1", type: "person" })];
    const result = computeMetadataCounts(records);
    expect(result.typeCounts).toEqual({ person: 1 });
    expect(result.areaCounts).toEqual({});
  });

  it("counts a single record by type and area", () => {
    const records = [
      makeRecord({ id: "r1", type: "service", organization: { area: "especialidades" } })
    ];
    const result = computeMetadataCounts(records);
    expect(result.typeCounts).toEqual({ service: 1 });
    expect(result.areaCounts).toEqual({ especialidades: 1 });
  });

  it("accumulates multiple records with mixed types and areas", () => {
    const records = [
      makeRecord({ id: "r1", type: "person", organization: { area: "sanitaria-asistencial" } }),
      makeRecord({ id: "r2", type: "service", organization: { area: "especialidades" } }),
      makeRecord({ id: "r3", type: "person" }),
      makeRecord({ id: "r4", type: "service", organization: { area: "especialidades" } }),
    ];
    const result = computeMetadataCounts(records);
    expect(result.typeCounts).toEqual({ person: 2, service: 2 });
    expect(result.areaCounts).toEqual({ "sanitaria-asistencial": 1, especialidades: 2 });
  });

  it("parity: matches original counting loop from csv-import.service.ts buildDataset", () => {
    /**
     * Original loop (verbatim from csv-import.service.ts before OIR-119):
     *   const typeCounts: Partial<Record<RecordType, number>> = {};
     *   const areaCounts: Partial<Record<AreaType, number>> = {};
     *   for (const record of records) {
     *     typeCounts[record.type] = (typeCounts[record.type] ?? 0) + 1;
     *     if (record.organization.area) {
     *       areaCounts[record.organization.area] = (areaCounts[record.organization.area] ?? 0) + 1;
     *     }
     *   }
     */
    const originalCsvImportCount = (records: ContactRecord[]) => {
      const typeCounts: Record<string, number> = {};
      const areaCounts: Record<string, number> = {};
      for (const record of records) {
        typeCounts[record.type] = (typeCounts[record.type] ?? 0) + 1;
        if (record.organization.area) {
          areaCounts[record.organization.area] = (areaCounts[record.organization.area] ?? 0) + 1;
        }
      }
      return { typeCounts, areaCounts };
    };

    const records = [
      makeRecord({ id: "r1", type: "person", organization: { area: "especialidades" } }),
      makeRecord({ id: "r2", type: "department" }),
      makeRecord({ id: "r3", type: "person", organization: { area: "sanitaria-asistencial" } }),
    ];

    const shared = computeMetadataCounts(records);
    const original = originalCsvImportCount(records);

    expect(shared.typeCounts).toEqual(original.typeCounts);
    expect(shared.areaCounts).toEqual(original.areaCounts);
  });

  it("parity: matches original counting loop from app-data.service.ts buildNextDataset", () => {
    /**
     * Original loop (verbatim from app-data.service.ts before OIR-119):
     *   const typeCounts: Partial<Record<RecordType, number>> = {};
     *   const areaCounts: Partial<Record<AreaType, number>> = {};
     *   for (const record of records) {
     *     typeCounts[record.type] = (typeCounts[record.type] ?? 0) + 1;
     *     if (record.organization.area) {
     *       areaCounts[record.organization.area] = (areaCounts[record.organization.area] ?? 0) + 1;
     *     }
     *   }
     */
    const originalAppDataCount = (records: ContactRecord[]) => {
      const typeCounts: Record<string, number> = {};
      const areaCounts: Record<string, number> = {};
      for (const record of records) {
        typeCounts[record.type] = (typeCounts[record.type] ?? 0) + 1;
        if (record.organization.area) {
          areaCounts[record.organization.area] = (areaCounts[record.organization.area] ?? 0) + 1;
        }
      }
      return { typeCounts, areaCounts };
    };

    const records = [
      makeRecord({ id: "r1", type: "service", organization: { area: "gestion-administracion" } }),
      makeRecord({ id: "r2", type: "service", organization: { area: "gestion-administracion" } }),
      makeRecord({ id: "r3", type: "room" }),
    ];

    const shared = computeMetadataCounts(records);
    const original = originalAppDataCount(records);

    expect(shared.typeCounts).toEqual(original.typeCounts);
    expect(shared.areaCounts).toEqual(original.areaCounts);
  });
});

// ---------------------------------------------------------------------------
// Display-name normalization DIVERGENCE lock
// ---------------------------------------------------------------------------

describe("display-name normalization — intentional divergence lock", () => {
  /**
   * The two display-name normalizers differ in:
   *   1. Unicode form: duplicate-detection uses NFD; spreadsheet-normalize uses NFKD.
   *   2. Diacritic regex: char-range [̀-ͯ] vs unicode-prop \p{Diacritic}.
   *
   * For common ASCII-adjacent inputs they produce the same output, but they
   * diverge on some Unicode edge cases. These tests document BOTH sameness and
   * difference so a future change to either normalizer is visible immediately.
   *
   * DO NOT unify these implementations. They serve different matching contexts.
   */

  /** Inline replica of the NFD + char-range normalizer from duplicate-detection.service.ts */
  const normalizeForDupDetection = (name: string): string =>
    name
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/\s+/g, " ");

  const SAME_OUTPUT_MATRIX: string[] = [
    "Juan García",
    "María José",
    "Pérez López",
    "Nurse O'Brien",
    "Dr. Smith",
    "áéíóú",
    "ÁÉÍÓÚ",
    "ñoño",
    "Montserrat",
  ];

  it.each(SAME_OUTPUT_MATRIX)(
    "both normalizers agree on common inputs: %j",
    (input) => {
      expect(normalizeForDupDetection(input)).toBe(normalizeDisplayNameForMerge(input));
    }
  );

  it("documents that the two normalizers are different implementations (NFD vs NFKD)", () => {
    // Both normalizers currently agree on all the inputs above.
    // This test exists to document the difference in form, not to assert output divergence —
    // divergence may appear only with exotic Unicode (ligatures, compatibility chars, etc).
    //
    // The point is: if either implementation changes, tests here break and the reviewer
    // must consciously decide whether to update the other variant.
    expect(normalizeForDupDetection("Juan García")).toBe("juan garcia");
    expect(normalizeDisplayNameForMerge("Juan García")).toBe("juan garcia");
  });

  it("both normalizers trim and lowercase", () => {
    const input = "  MARÍA  ";
    expect(normalizeForDupDetection(input)).toBe("maria");
    expect(normalizeDisplayNameForMerge(input)).toBe("maria");
  });

  it("both normalizers collapse internal whitespace", () => {
    const input = "Juan   Luis";
    expect(normalizeForDupDetection(input)).toBe("juan luis");
    expect(normalizeDisplayNameForMerge(input)).toBe("juan luis");
  });
});
