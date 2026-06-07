import { describe, expect, it } from "vitest";
import type { ContactRecord } from "../../shared/types/contact.js";
import { DuplicateDetectionService } from "./duplicate-detection.service.js";

describe("DuplicateDetectionService", () => {
  const service = new DuplicateDetectionService();

  const buildMinimalContact = (overrides: Partial<ContactRecord> = {}): ContactRecord => ({
    id: "id-1",
    type: "person",
    displayName: "Test Person",
    organization: {},
    contactMethods: { phones: [], emails: [] },
    aliases: [],
    tags: [],
    status: "active",
    audit: {
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy: "test",
      updatedBy: "test"
    },
    ...overrides
  });

  describe("detectDuplicates", () => {
    it("returns empty result for empty input", () => {
      const result = service.detectDuplicates([]);

      expect(result).toEqual({
        pairs: [],
        checkedCount: 0,
        pairCount: 0
      });
    });

    it("detects identical displayName as duplicate", () => {
      const recordA = buildMinimalContact({ id: "a", displayName: "Juan García" });
      const recordB = buildMinimalContact({ id: "b", displayName: "Juan García" });

      const result = service.detectDuplicates([recordA, recordB]);

      expect(result.checkedCount).toBe(2);
      expect(result.pairCount).toBe(1);
      expect(result.pairs).toHaveLength(1);
      expect(result.pairs[0]?.reasons).toContain("displayName");
      expect(result.pairs[0]?.score).toBe(0.9);
    });

    it("detects matching phone numbers with different formats", () => {
      const recordA = buildMinimalContact({
        id: "a",
        displayName: "Person A",
        contactMethods: {
          phones: [{ number: "612 345 678", label: "work", isPrimary: true }],
          emails: []
        }
      });
      const recordB = buildMinimalContact({
        id: "b",
        displayName: "Person B",
        contactMethods: {
          phones: [{ number: "612345678", label: "mobile", isPrimary: true }],
          emails: []
        }
      });

      const result = service.detectDuplicates([recordA, recordB]);

      expect(result.pairCount).toBe(1);
      expect(result.pairs[0]?.reasons.some((r) => r.startsWith("phone:"))).toBe(true);
      expect(result.pairs[0]?.score).toBe(0.95);
    });

    it("returns no pairs for records with no overlap", () => {
      const recordA = buildMinimalContact({
        id: "a",
        displayName: "John Smith",
        contactMethods: {
          phones: [{ number: "111111111", label: "work", isPrimary: true }],
          emails: []
        }
      });
      const recordB = buildMinimalContact({
        id: "b",
        displayName: "Jane Doe",
        contactMethods: {
          phones: [{ number: "222222222", label: "work", isPrimary: true }],
          emails: []
        }
      });

      const result = service.detectDuplicates([recordA, recordB]);

      expect(result.pairCount).toBe(0);
      expect(result.pairs).toHaveLength(0);
    });

    it("detects fuzzy displayName match (accent difference)", () => {
      const recordA = buildMinimalContact({ id: "a", displayName: "Juan García" });
      const recordB = buildMinimalContact({ id: "b", displayName: "Juan Garcia" });

      const result = service.detectDuplicates([recordA, recordB]);

      expect(result.pairCount).toBe(1);
      // Accent normalization makes García→Garcia an exact displayName match
      const reasons = result.pairs[0]?.reasons ?? [];
      expect(
        reasons.includes("displayName") ||
          reasons.includes("displayName:fuzzy") ||
          reasons.includes("displayName:levenshtein")
      ).toBe(true);
      expect(result.pairs[0]?.score).toBeGreaterThanOrEqual(0.6);
    });

    it("detects externalId match with highest score", () => {
      const recordA = buildMinimalContact({
        id: "a",
        displayName: "Person A",
        externalId: "EXT-123"
      });
      const recordB = buildMinimalContact({
        id: "b",
        displayName: "Person B",
        externalId: "EXT-123"
      });

      const result = service.detectDuplicates([recordA, recordB]);

      expect(result.pairCount).toBe(1);
      expect(result.pairs[0]?.reasons).toContain("externalId");
      expect(result.pairs[0]?.score).toBe(1.0);
    });

    it("sorts pairs by score descending (highest score first)", () => {
      const recordA = buildMinimalContact({
        id: "a",
        displayName: "Test",
        externalId: "EXT-1"
      });
      const recordB = buildMinimalContact({
        id: "b",
        displayName: "Test",
        externalId: "EXT-1"
      });
      const recordC = buildMinimalContact({
        id: "c",
        displayName: "Different Name"
      });
      const recordD = buildMinimalContact({
        id: "d",
        displayName: "Different Name"
      });

      const result = service.detectDuplicates([recordA, recordB, recordC, recordD]);

      expect(result.pairCount).toBe(2);
      // First pair should have externalId match (score 1.0)
      expect(result.pairs[0]?.score).toBe(1.0);
      expect(result.pairs[0]?.reasons).toContain("externalId");
      // Second pair should have displayName match (score 0.9)
      expect(result.pairs[1]?.score).toBe(0.9);
      expect(result.pairs[1]?.reasons).toContain("displayName");
    });

    it("handles records with multiple matching signals", () => {
      const recordA = buildMinimalContact({
        id: "a",
        displayName: "Juan García",
        contactMethods: {
          phones: [{ number: "612345678", label: "work", isPrimary: true }],
          emails: []
        }
      });
      const recordB = buildMinimalContact({
        id: "b",
        displayName: "Juan García",
        contactMethods: {
          phones: [{ number: "612 345 678", label: "mobile", isPrimary: true }],
          emails: []
        }
      });

      const result = service.detectDuplicates([recordA, recordB]);

      expect(result.pairCount).toBe(1);
      // Should have both displayName and phone reasons
      expect(result.pairs[0]?.reasons).toContain("displayName");
      expect(result.pairs[0]?.reasons.some((r) => r.startsWith("phone:"))).toBe(true);
      // Score should be max of all signals (phone = 0.95)
      expect(result.pairs[0]?.score).toBe(0.95);
    });

    it("detects Levenshtein near-match (1-char difference)", () => {
      const recordA = buildMinimalContact({ id: "a", displayName: "John Smith" });
      const recordB = buildMinimalContact({ id: "b", displayName: "Jon Smith" });

      const result = service.detectDuplicates([recordA, recordB]);

      expect(result.pairCount).toBe(1);
      expect(result.pairs[0]?.reasons).toContain("displayName:levenshtein");
      expect(result.pairs[0]?.score).toBeGreaterThanOrEqual(0.75);
    });

    it("does not detect Levenshtein signal for far-apart names (5+ char difference)", () => {
      const recordA = buildMinimalContact({ id: "a", displayName: "John Smith" });
      const recordB = buildMinimalContact({ id: "b", displayName: "Maria Lopez" });

      const result = service.detectDuplicates([recordA, recordB]);

      const reasons = result.pairs.flatMap((p) => p.reasons);
      expect(reasons).not.toContain("displayName:levenshtein");
    });

    it("detects same-department + similar-name signal", () => {
      // Names differ by 4+ chars (title prefix dropped) so levenshtein won't fire;
      // bigram similarity is high (>= 0.7) so dept+name should fire.
      const recordA = buildMinimalContact({
        id: "a",
        displayName: "Dr. Juan Antonio Morales",
        organization: { department: "Cardiology" }
      });
      const recordB = buildMinimalContact({
        id: "b",
        displayName: "Juan Antonio Morales",
        organization: { department: "Cardiology" }
      });

      const result = service.detectDuplicates([recordA, recordB]);

      expect(result.pairCount).toBe(1);
      expect(result.pairs[0]?.reasons).toContain("dept+name");
      expect(result.pairs[0]?.score).toBeGreaterThanOrEqual(0.65);
    });

    it("does not trigger dept+name signal when departments differ", () => {
      const recordA = buildMinimalContact({
        id: "a",
        displayName: "Dr. Juan Antonio Morales",
        organization: { department: "Cardiology" }
      });
      const recordB = buildMinimalContact({
        id: "b",
        displayName: "Juan Antonio Morales",
        organization: { department: "Neurology" }
      });

      const result = service.detectDuplicates([recordA, recordB]);

      const reasons = result.pairs.flatMap((p) => p.reasons);
      expect(reasons).not.toContain("dept+name");
    });
  });
});
