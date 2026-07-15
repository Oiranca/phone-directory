import { describe, expect, it } from "vitest";
import { mergeContactsOverridesSchema, mergeContactsSchema } from "./merge-contacts.schema.js";

const validPhone = {
  id: "ph_1",
  number: "70001",
  kind: "internal",
  isPrimary: true,
  confidential: false,
  noPatientSharing: false
};

describe("mergeContactsSchema — overrides", () => {
  it("accepts a request with no overrides at all (default/fast path)", () => {
    const result = mergeContactsSchema.safeParse({
      keepId: "cnt_a",
      discardId: "cnt_b"
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.overrides).toBeUndefined();
    }
  });

  it("accepts a request with an empty overrides object", () => {
    const result = mergeContactsSchema.safeParse({
      keepId: "cnt_a",
      discardId: "cnt_b",
      overrides: {}
    });

    expect(result.success).toBe(true);
  });

  it("accepts valid displayName/type/phones overrides", () => {
    const result = mergeContactsSchema.safeParse({
      keepId: "cnt_a",
      discardId: "cnt_b",
      overrides: {
        displayName: "Admisión General (corregido)",
        type: "service",
        contactMethods: {
          phones: [validPhone]
        }
      }
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.overrides?.displayName).toBe("Admisión General (corregido)");
      expect(result.data.overrides?.type).toBe("service");
      expect(result.data.overrides?.contactMethods?.phones).toHaveLength(1);
    }
  });

  it("rejects an override with an empty displayName", () => {
    const result = mergeContactsSchema.safeParse({
      keepId: "cnt_a",
      discardId: "cnt_b",
      overrides: { displayName: "   " }
    });

    expect(result.success).toBe(false);
  });

  it("rejects an override with an invalid record type", () => {
    const result = mergeContactsSchema.safeParse({
      keepId: "cnt_a",
      discardId: "cnt_b",
      overrides: { type: "not-a-real-type" }
    });

    expect(result.success).toBe(false);
  });

  it("rejects a malformed phone override (missing required number field)", () => {
    const result = mergeContactsSchema.safeParse({
      keepId: "cnt_a",
      discardId: "cnt_b",
      overrides: {
        contactMethods: {
          phones: [{ id: "ph_1", kind: "internal", isPrimary: true, confidential: false, noPatientSharing: false }]
        }
      }
    });

    expect(result.success).toBe(false);
  });

  it("rejects unknown top-level keys inside overrides (e.g. attempting to smuggle id/audit)", () => {
    const result = mergeContactsOverridesSchema.safeParse({
      id: "cnt_attacker_controlled",
      displayName: "Fine value"
    });

    expect(result.success).toBe(false);
  });

  it("rejects an attempt to override status via overrides", () => {
    const result = mergeContactsOverridesSchema.safeParse({
      status: "inactive"
    });

    expect(result.success).toBe(false);
  });

  it("still enforces the keepId !== discardId guard when overrides are present", () => {
    const result = mergeContactsSchema.safeParse({
      keepId: "cnt_same",
      discardId: "cnt_same",
      overrides: { displayName: "Nombre" }
    });

    expect(result.success).toBe(false);
  });
});
