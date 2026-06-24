/**
 * matching.parity.test.ts — OIR-119 / OIR-134 shared fixture matrix.
 *
 * Two purposes:
 *   1. Prove that the shared helpers produce the same output as the original
 *      inline logic in each consumer (import / conflict-detection / duplicate-
 *      detection).
 *   2. Pin the canonical NFKD display-name normalizer behavior introduced by
 *      OIR-134, which superseded the OIR-119 intentional divergence between
 *      `normalizeDisplayName` (NFD + char-range) in duplicate-detection and
 *      `normalizeDisplayNameForMerge` (NFKD + \p{Diacritic}) in
 *      spreadsheet-normalize. Both callers now use the single canonical NFKD
 *      form exported from this module.
 */

import { describe, expect, it } from "vitest";
import { normalizePhoneForDedup, computeMetadataCounts, normalizeDisplayName } from "./matching.js";
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
// normalizeDisplayName — canonical NFKD behavior (OIR-134)
// ---------------------------------------------------------------------------

describe("normalizeDisplayName — canonical NFKD form", () => {
  /**
   * OIR-134 unified the two formerly-separate display-name normalizers:
   *   - duplicate-detection.service.ts used NFD + char-range [̀-ͯ]
   *   - spreadsheet-normalize.ts used NFKD + \p{Diacritic}
   *
   * Both now delegate to this single canonical NFKD implementation.
   * These tests pin the canonical behavior and verify that
   * normalizeDisplayNameForMerge (the spreadsheet alias) is identical.
   */

  const COMMON_INPUTS: [input: string, expected: string][] = [
    ["Juan García", "juan garcia"],
    ["María José", "maria jose"],
    ["Pérez López", "perez lopez"],
    ["Nurse O'Brien", "nurse o'brien"],
    ["Dr. Smith", "dr. smith"],
    ["áéíóú", "aeiou"],
    ["ÁÉÍÓÚ", "aeiou"],
    ["ñoño", "nono"],
    ["Montserrat", "montserrat"],
    ["  MARÍA  ", "maria"],
    ["Juan   Luis", "juan luis"],
  ];

  it.each(COMMON_INPUTS)("normalizeDisplayName(%j) === %j", (input, expected) => {
    expect(normalizeDisplayName(input)).toBe(expected);
  });

  it("normalizeDisplayNameForMerge is an alias for the same canonical NFKD function", () => {
    const inputs = ["Juan García", "María José", "áéíóú", "ÁÉÍÓÚ", "ñoño", "  MARÍA  "];
    for (const input of inputs) {
      expect(normalizeDisplayName(input)).toBe(normalizeDisplayNameForMerge(input));
    }
  });

  it("strips compatibility characters (NFKD decomposes ligatures, halfwidth, etc.)", () => {
    // NFKD decomposes ﬁ (U+FB01 LATIN SMALL LIGATURE FI) → fi
    expect(normalizeDisplayName("ﬁle")).toBe("file");
    // NFKD decomposes ＡＢＣ (fullwidth letters) → ABC → abc
    expect(normalizeDisplayName("ＡＢＣ")).toBe("abc");
  });

  it("strips Spanish diacritics via \\p{Diacritic}", () => {
    expect(normalizeDisplayName("Ángeles")).toBe("angeles");
    expect(normalizeDisplayName("Díaz")).toBe("diaz");
    expect(normalizeDisplayName("Núñez")).toBe("nunez");
    expect(normalizeDisplayName("Güell")).toBe("guell");
  });

  it("trims leading/trailing whitespace and collapses internal whitespace", () => {
    expect(normalizeDisplayName("  Foo   Bar  ")).toBe("foo bar");
  });

  it("lowercases the result", () => {
    expect(normalizeDisplayName("BANCO DE SANGRE")).toBe("banco de sangre");
  });
});
