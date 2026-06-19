/**
 * Unit tests for spreadsheet-parsers.ts
 *
 * Covers:
 *   - blankRecord: full shape assertion (all expected fields, correct types)
 *   - buildStableExternalId: determinism, ASCII-fold/join behavior,
 *     accent normalization, order sensitivity, empty/edge inputs
 */

import { describe, expect, it } from "vitest";
import { blankRecord, buildStableExternalId } from "./spreadsheet-parsers.js";

// ---------------------------------------------------------------------------
// blankRecord
// ---------------------------------------------------------------------------

describe("blankRecord", () => {
  it("returns an object (not null, not array)", () => {
    const record = blankRecord();
    expect(record).toBeDefined();
    expect(typeof record).toBe("object");
    expect(Array.isArray(record)).toBe(false);
    expect(record).not.toBeNull();
  });

  it("has all scalar identity fields as empty strings", () => {
    const record = blankRecord();
    expect(record.externalId).toBe("");
    expect(record.type).toBe("");
    expect(record.displayName).toBe("");
    expect(record.firstName).toBe("");
    expect(record.lastName).toBe("");
  });

  it("has all categorization fields as empty strings", () => {
    const record = blankRecord();
    expect(record.area).toBe("");
    expect(record.department).toBe("");
    expect(record.service).toBe("");
    expect(record.specialty).toBe("");
  });

  it("has all location fields as empty strings", () => {
    const record = blankRecord();
    expect(record.building).toBe("");
    expect(record.floor).toBe("");
    expect(record.room).toBe("");
    expect(record.locationText).toBe("");
  });

  it("has all phone1 fields as empty strings", () => {
    const record = blankRecord();
    expect(record.phone1Label).toBe("");
    expect(record.phone1Number).toBe("");
    expect(record.phone1Extension).toBe("");
    expect(record.phone1Kind).toBe("");
    expect(record.phone1IsPrimary).toBe("");
    expect(record.phone1Confidential).toBe("");
    expect(record.phone1NoPatientSharing).toBe("");
    expect(record.phone1Notes).toBe("");
  });

  it("has all phone2 fields as empty strings", () => {
    const record = blankRecord();
    expect(record.phone2Label).toBe("");
    expect(record.phone2Number).toBe("");
    expect(record.phone2Extension).toBe("");
    expect(record.phone2Kind).toBe("");
    expect(record.phone2IsPrimary).toBe("");
    expect(record.phone2Confidential).toBe("");
    expect(record.phone2NoPatientSharing).toBe("");
    expect(record.phone2Notes).toBe("");
  });

  it("has all email fields as empty strings", () => {
    const record = blankRecord();
    expect(record.email1).toBe("");
    expect(record.email1Label).toBe("");
    expect(record.email1IsPrimary).toBe("");
    expect(record.email2).toBe("");
    expect(record.email2Label).toBe("");
    expect(record.email2IsPrimary).toBe("");
  });

  it("has metadata/annotation fields as empty strings", () => {
    const record = blankRecord();
    expect(record.tags).toBe("");
    expect(record.aliases).toBe("");
    expect(record.notes).toBe("");
    expect(record.status).toBe("");
  });

  it("has all field values as strings (not undefined, not null, not boolean)", () => {
    const record = blankRecord();
    for (const [key, value] of Object.entries(record)) {
      expect(typeof value, `field '${key}' should be a string`).toBe("string");
    }
  });

  it("returns a fresh object on each call (not a shared reference)", () => {
    const r1 = blankRecord();
    const r2 = blankRecord();
    expect(r1).not.toBe(r2);
    r1.displayName = "mutated";
    expect(r2.displayName).toBe("");
  });

  it("has exactly the expected set of keys (full shape lock)", () => {
    const record = blankRecord();
    const keys = Object.keys(record).sort();
    expect(keys).toEqual([
      "aliases",
      "area",
      "building",
      "department",
      "displayName",
      "email1",
      "email1IsPrimary",
      "email1Label",
      "email2",
      "email2IsPrimary",
      "email2Label",
      "externalId",
      "firstName",
      "floor",
      "lastName",
      "locationText",
      "notes",
      "phone1Confidential",
      "phone1Extension",
      "phone1IsPrimary",
      "phone1Kind",
      "phone1Label",
      "phone1NoPatientSharing",
      "phone1Notes",
      "phone1Number",
      "phone2Confidential",
      "phone2Extension",
      "phone2IsPrimary",
      "phone2Kind",
      "phone2Label",
      "phone2NoPatientSharing",
      "phone2Notes",
      "phone2Number",
      "room",
      "service",
      "specialty",
      "status",
      "tags",
      "type",
    ]);
  });
});

// ---------------------------------------------------------------------------
// buildStableExternalId
// ---------------------------------------------------------------------------

describe("buildStableExternalId", () => {
  // Determinism

  it("returns the same id on repeated calls with the same input (determinism)", () => {
    const parts = ["urgencias", "Triaje", "12345"];
    const first = buildStableExternalId(parts);
    const second = buildStableExternalId(parts);
    expect(first).toBe(second);
  });

  it("returns a non-empty string for any input", () => {
    expect(buildStableExternalId(["a"])).toBeTruthy();
    expect(buildStableExternalId([])).toBeTruthy();
    expect(buildStableExternalId(["", undefined, ""])).toBeTruthy();
  });

  // Fallback for fully-empty inputs

  it("falls back to 'row' only when the parts array is completely empty", () => {
    // The || "row" fallback triggers only when the joined result is an empty
    // string, which only happens when parts is an empty array.
    expect(buildStableExternalId([])).toBe("row");
  });

  it("empty-string and undefined parts normalise to 'sheet' (not filtered out)", () => {
    // normalizeAscii("") returns "sheet" as its own fallback, so an empty or
    // undefined part contributes the literal segment "sheet" to the joined id.
    // This documents the actual runtime behavior (golden capture).
    expect(buildStableExternalId([""])).toBe("sheet");
    expect(buildStableExternalId([undefined])).toBe("sheet");
    expect(buildStableExternalId(["", ""])).toBe("sheet-sheet");
  });

  it("whitespace-only parts normalise to 'sheet' (whitespace stripped then fallback)", () => {
    // Spaces become "-" then leading/trailing dashes are stripped, leaving ""
    // which falls back to "sheet".
    expect(buildStableExternalId(["   "])).toBe("sheet");
  });

  // Concrete expected values (ASCII-fold + join behavior)

  it("lowercases segments", () => {
    expect(buildStableExternalId(["Urgencias"])).toBe("urgencias");
    expect(buildStableExternalId(["TRIAJE"])).toBe("triaje");
  });

  it("strips accent diacritics from segments", () => {
    expect(buildStableExternalId(["Café"])).toBe("cafe");
    expect(buildStableExternalId(["Administración"])).toBe("administracion");
    expect(buildStableExternalId(["Núcleo"])).toBe("nucleo");
  });

  it("replaces non-alphanumeric characters with dashes in segments", () => {
    // Space and punctuation become dashes inside a segment, then segments are
    // joined with a dash between them.
    const result = buildStableExternalId(["hello world"]);
    expect(result).toBe("hello-world");
  });

  it("joins multiple segments with a dash separator", () => {
    expect(buildStableExternalId(["urgencias", "triaje", "12345"])).toBe(
      "urgencias-triaje-12345"
    );
  });

  it("empty/undefined parts become 'sheet' segments (not dropped)", () => {
    // Each part is individually normalised: "" → "sheet", undefined → "sheet".
    // The segments are then joined, so gaps become "sheet" placeholders.
    expect(buildStableExternalId(["urgencias", "", "12345"])).toBe(
      "urgencias-sheet-12345"
    );
    expect(buildStableExternalId([undefined, "triaje", undefined])).toBe(
      "sheet-triaje-sheet"
    );
  });

  // Order sensitivity

  it("produces different ids when segment order differs", () => {
    const ab = buildStableExternalId(["alfa", "beta"]);
    const ba = buildStableExternalId(["beta", "alfa"]);
    expect(ab).not.toBe(ba);
    expect(ab).toBe("alfa-beta");
    expect(ba).toBe("beta-alfa");
  });

  // Distinctness for distinct inputs

  it("produces distinct ids for distinct inputs", () => {
    const ids = [
      buildStableExternalId(["urgencias", "12345"]),
      buildStableExternalId(["rayos", "12345"]),
      buildStableExternalId(["urgencias", "99999"]),
    ];
    const unique = new Set(ids);
    expect(unique.size).toBe(3);
  });

  // Single-segment passthrough

  it("returns the normalized single segment directly (no trailing dash)", () => {
    expect(buildStableExternalId(["urgencias"])).toBe("urgencias");
  });

  // Phone-number segments (digits only) pass through unchanged

  it("preserves digit-only segments as-is", () => {
    expect(buildStableExternalId(["12345"])).toBe("12345");
    expect(buildStableExternalId(["urgencias", "12345"])).toBe("urgencias-12345");
  });

  // Real-world example matching service-sheet externalId construction

  it("matches the exact id the service-sheet parser would generate for Urgencias/Triaje/12345", () => {
    // normalizeServiceSheet constructs: `${slug}-${buildStableExternalId([dept, section, phone0, phone1])}`
    // For slug=urgencias, dept=Urgencias, section=Triaje (same as label), phone0=12345, phone1=undefined.
    // undefined → "sheet", so the suffix ends with "-sheet".
    const suffix = buildStableExternalId(["Urgencias", "Triaje", "12345", undefined]);
    expect(suffix).toBe("urgencias-triaje-12345-sheet");

    // When phone1 is also present (two phones), no undefined slot:
    const suffixTwo = buildStableExternalId(["Urgencias", "Triaje", "12345", "67890"]);
    expect(suffixTwo).toBe("urgencias-triaje-12345-67890");
  });
});
