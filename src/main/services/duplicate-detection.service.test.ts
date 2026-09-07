import { describe, expect, it } from "vitest";
import type { ContactRecord } from "../../shared/types/contact.js";
import { DuplicateDetectionService, DuplicateDetectionAbortError } from "./duplicate-detection.service.js";

describe("DuplicateDetectionService", () => {
  const service = new DuplicateDetectionService();

  const buildMinimalContact = (overrides: Partial<ContactRecord> = {}): ContactRecord => ({
    beepers: [],
    id: "id-1",
    type: "person",
    displayName: "Test Person",
    organization: {},
    contactMethods: { phones: [], emails: [], socials: [] },
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
    it("returns empty result for empty input", async () => {
      const result = await service.detectDuplicates([]);

      expect(result).toEqual({
        pairs: [],
        records: {},
        checkedCount: 0,
        pairCount: 0
      });
    });

    it("detects identical displayName as duplicate", async () => {
      const recordA = buildMinimalContact({ id: "a", displayName: "Juan García" });
      const recordB = buildMinimalContact({ id: "b", displayName: "Juan García" });

      const result = await service.detectDuplicates([recordA, recordB]);

      expect(result.checkedCount).toBe(2);
      expect(result.pairCount).toBe(1);
      expect(result.pairs).toHaveLength(1);
      expect(result.pairs[0]?.reasons).toContain("displayName");
      expect(result.pairs[0]?.score).toBe(0.9);
    });

    it("detects matching phone numbers with different formats", async () => {
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

      const result = await service.detectDuplicates([recordA, recordB]);

      expect(result.pairCount).toBe(1);
      expect(result.pairs[0]?.reasons.some((r) => r.startsWith("phone:"))).toBe(true);
      expect(result.pairs[0]?.score).toBe(0.95);
    });

    it("returns no pairs for records with no overlap", async () => {
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

      const result = await service.detectDuplicates([recordA, recordB]);

      expect(result.pairCount).toBe(0);
      expect(result.pairs).toHaveLength(0);
    });

    it("detects fuzzy displayName match (accent difference)", async () => {
      const recordA = buildMinimalContact({ id: "a", displayName: "Juan García" });
      const recordB = buildMinimalContact({ id: "b", displayName: "Juan Garcia" });

      const result = await service.detectDuplicates([recordA, recordB]);

      expect(result.pairCount).toBe(1);
      // Accent normalization makes García→Garcia an exact displayName match
      const reasons = result.pairs[0]?.reasons ?? [];
      expect(
        reasons.includes("displayName") ||
          reasons.includes("displayName:fuzzy") ||
          reasons.includes("displayName:levenshtein")
      ).toBe(true);
      // Tightened: García→Garcia normalizes to exact displayName match → score 0.9
      expect(result.pairs[0]?.score).toBe(0.9);
    });

    it("detects externalId match with highest score", async () => {
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

      const result = await service.detectDuplicates([recordA, recordB]);

      expect(result.pairCount).toBe(1);
      expect(result.pairs[0]?.reasons).toContain("externalId");
      expect(result.pairs[0]?.score).toBe(1.0);
    });

    it("sorts pairs by score descending (highest score first)", async () => {
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

      const result = await service.detectDuplicates([recordA, recordB, recordC, recordD]);

      expect(result.pairCount).toBe(2);
      // First pair should have externalId match (score 1.0)
      expect(result.pairs[0]?.score).toBe(1.0);
      expect(result.pairs[0]?.reasons).toContain("externalId");
      // Second pair should have displayName match (score 0.9)
      expect(result.pairs[1]?.score).toBe(0.9);
      expect(result.pairs[1]?.reasons).toContain("displayName");
    });

    it("handles records with multiple matching signals", async () => {
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

      const result = await service.detectDuplicates([recordA, recordB]);

      expect(result.pairCount).toBe(1);
      // Should have both displayName and phone reasons
      expect(result.pairs[0]?.reasons).toContain("displayName");
      expect(result.pairs[0]?.reasons.some((r) => r.startsWith("phone:"))).toBe(true);
      // Score should be max of all signals (phone = 0.95)
      expect(result.pairs[0]?.score).toBe(0.95);
    });

    it("detects Levenshtein near-match (1-char difference)", async () => {
      const recordA = buildMinimalContact({ id: "a", displayName: "John Smith" });
      const recordB = buildMinimalContact({ id: "b", displayName: "Jon Smith" });

      const result = await service.detectDuplicates([recordA, recordB]);

      expect(result.pairCount).toBe(1);
      expect(result.pairs[0]?.reasons).toContain("displayName:levenshtein");
      // Tightened: Levenshtein signal has a deterministic score of 0.75.
      expect(result.pairs[0]?.score).toBe(0.75);
    });

    it("does not detect Levenshtein signal for far-apart names (5+ char difference)", async () => {
      const recordA = buildMinimalContact({ id: "a", displayName: "John Smith" });
      const recordB = buildMinimalContact({ id: "b", displayName: "Maria Lopez" });

      const result = await service.detectDuplicates([recordA, recordB]);

      const reasons = result.pairs.flatMap((p) => p.reasons);
      expect(reasons).not.toContain("displayName:levenshtein");
    });

    it("detects same-department + similar-name signal", async () => {
      // Edit distance = 13 chars (title prefix + surname), maxLev = ceil(45*0.2) = 9.
      // 13 > 9 → Levenshtein does NOT fire.
      // Bigram Jaccard ≈ 0.757 >= 0.7 → dept+name fires at score 0.65.
      const recordA = buildMinimalContact({
        id: "a",
        displayName: "Dra. María Carmen Rodríguez Fernández Álvarez",
        organization: { department: "Cardiology" }
      });
      const recordB = buildMinimalContact({
        id: "b",
        displayName: "María Carmen Rodríguez Fernández",
        organization: { department: "Cardiology" }
      });

      const result = await service.detectDuplicates([recordA, recordB]);

      expect(result.pairCount).toBe(1);
      expect(result.pairs[0]?.reasons).toContain("dept+name");
      expect(result.pairs[0]?.reasons).not.toContain("displayName:levenshtein");
      // Only dept+name fires → deterministic score of 0.65.
      expect(result.pairs[0]?.score).toBe(0.65);
    });

    it("does not trigger dept+name signal when departments differ", async () => {
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

      const result = await service.detectDuplicates([recordA, recordB]);

      const reasons = result.pairs.flatMap((p) => p.reasons);
      expect(reasons).not.toContain("dept+name");
    });

    it("rejects short-name false positives (Ana/Eva)", async () => {
      // Ana vs Eva: both 3 chars, Levenshtein distance is 2, but should NOT match
      const recordA = buildMinimalContact({ id: "a", displayName: "Ana" });
      const recordB = buildMinimalContact({ id: "b", displayName: "Eva" });

      const result = await service.detectDuplicates([recordA, recordB]);

      expect(result.pairCount).toBe(0);
      const reasons = result.pairs.flatMap((p) => p.reasons);
      expect(reasons).not.toContain("displayName:levenshtein");
    });

    it("accepts longer-name Levenshtein matches (John/Jon)", async () => {
      // John vs Jon: 4-5 chars, distance 1, should match (1 <= 1 char = 5*0.2)
      const recordA = buildMinimalContact({ id: "a", displayName: "John Smith" });
      const recordB = buildMinimalContact({ id: "b", displayName: "Jon Smith" });

      const result = await service.detectDuplicates([recordA, recordB]);

      expect(result.pairCount).toBe(1);
      expect(result.pairs[0]?.reasons).toContain("displayName:levenshtein");
    });

    it("populates records map with DuplicateRecordSummary for each unique record in a pair", async () => {
      const recordA = buildMinimalContact({
        id: "x",
        displayName: "Ana López",
        organization: { department: "Urgencias" },
        contactMethods: {
          phones: [{ id: "ph-1", number: "612345678", label: "work", isPrimary: true, kind: "direct", confidential: false, noPatientSharing: false }],
          emails: [],
          socials: []
        }
      });
      const recordB = buildMinimalContact({
        id: "y",
        displayName: "Ana Lopez",
        organization: { department: "Urgencias" }
      });

      const result = await service.detectDuplicates([recordA, recordB]);

      // Tightened: Ana López vs Ana Lopez → exact displayName match after normalization → 1 pair.
      expect(result.pairCount).toBe(1);

      // Both records present in map
      expect(result.records["x"]).toBeDefined();
      expect(result.records["y"]).toBeDefined();

      // Summary only contains display fields — not full ContactRecord fields
      const summaryX = result.records["x"]!;
      expect(summaryX.id).toBe("x");
      expect(summaryX.displayName).toBe("Ana López");
      expect(summaryX.department).toBe("Urgencias");
      expect(summaryX.phones).toHaveLength(1);
      expect(summaryX.phones[0]?.number).toBe("612345678");
      expect(summaryX.phones[0]?.label).toBe("work");

      // Must NOT contain ContactRecord-only fields
      expect((summaryX as Record<string, unknown>)["organization"]).toBeUndefined();
      expect((summaryX as Record<string, unknown>)["contactMethods"]).toBeUndefined();
      expect((summaryX as Record<string, unknown>)["tags"]).toBeUndefined();
      expect((summaryX as Record<string, unknown>)["aliases"]).toBeUndefined();
    });

    it("deduplicates records in map when same record appears in multiple pairs", async () => {
      // Record A matches both B and C → A appears in two pairs but map has only one entry
      const recordA = buildMinimalContact({ id: "a", displayName: "Shared Name" });
      const recordB = buildMinimalContact({ id: "b", displayName: "Shared Name" });
      const recordC = buildMinimalContact({ id: "c", displayName: "Shared Name" });

      const result = await service.detectDuplicates([recordA, recordB, recordC]);

      // All three pairs found
      expect(result.pairCount).toBe(3);

      // records map has exactly one entry per unique id
      const recordIds = Object.keys(result.records);
      expect(recordIds).toHaveLength(3);
      expect(recordIds).toContain("a");
      expect(recordIds).toContain("b");
      expect(recordIds).toContain("c");
    });

    it("pairs reference the same summary objects that are in the records map", async () => {
      const recordA = buildMinimalContact({ id: "p", displayName: "María García" });
      const recordB = buildMinimalContact({ id: "q", displayName: "Maria García" });

      const result = await service.detectDuplicates([recordA, recordB]);

      expect(result.pairCount).toBeGreaterThan(0);
      const pair = result.pairs[0]!;

      // pair.recordA and pair.recordB are identical references to what's in the map
      expect(pair.recordA).toBe(result.records[pair.recordA.id]);
      expect(pair.recordB).toBe(result.records[pair.recordB.id]);
    });
  });

  // ---------------------------------------------------------------------------
  // Baseline parity: exact snapshot of all existing signals, captured before
  // the async refactor so the cooperative impl can be diff'd against them.
  // ---------------------------------------------------------------------------
  describe("parity baselines (async result matches pre-refactor sync semantics)", () => {
    it("exact phone dup — parity baseline", async () => {
      const a = buildMinimalContact({
        id: "parity-phone-a",
        displayName: "Baseline Phone A",
        contactMethods: { phones: [{ number: "612000001", label: "work", isPrimary: true }], emails: [] }
      });
      const b = buildMinimalContact({
        id: "parity-phone-b",
        displayName: "Baseline Phone B",
        contactMethods: { phones: [{ number: "612 000 001", label: "mobile", isPrimary: true }], emails: [] }
      });

      const result = await service.detectDuplicates([a, b]);

      expect(result.checkedCount).toBe(2);
      expect(result.pairCount).toBe(1);
      expect(result.pairs[0]!.score).toBe(0.95);
      expect(result.pairs[0]!.reasons.some((r) => r.startsWith("phone:"))).toBe(true);
      expect(result.pairs[0]!.recordA.id).toBe("parity-phone-a");
      expect(result.pairs[0]!.recordB.id).toBe("parity-phone-b");
    });

    it("fuzzy-name-only dup via bigram — parity baseline", async () => {
      // "john smithson" vs "jon smithson": bigram Jaccard below 0.85, lev=1 ≤ ceil(13*0.2)=3 → levenshtein fires
      const a = buildMinimalContact({ id: "parity-fuzzy-a", displayName: "John Smithson" });
      const b = buildMinimalContact({ id: "parity-fuzzy-b", displayName: "Jon Smithson" });

      const result = await service.detectDuplicates([a, b]);

      expect(result.pairCount).toBe(1);
      expect(result.pairs[0]!.reasons).toContain("displayName:levenshtein");
      expect(result.pairs[0]!.score).toBe(0.75);
    });

    it("no-dup pair — parity baseline", async () => {
      const a = buildMinimalContact({ id: "parity-nodup-a", displayName: "Álvaro Jiménez" });
      const b = buildMinimalContact({ id: "parity-nodup-b", displayName: "Sofía Castellano" });

      const result = await service.detectDuplicates([a, b]);

      expect(result.pairCount).toBe(0);
      expect(result.pairs).toHaveLength(0);
    });

    it("multi-match (externalId + phone + displayName) — parity baseline", async () => {
      const a = buildMinimalContact({
        id: "parity-multi-a",
        displayName: "Pedro Alonso",
        externalId: "EXT-MULTI",
        contactMethods: { phones: [{ number: "699000001", label: "work", isPrimary: true }], emails: [] }
      });
      const b = buildMinimalContact({
        id: "parity-multi-b",
        displayName: "Pedro Alonso",
        externalId: "EXT-MULTI",
        contactMethods: { phones: [{ number: "699000001", label: "mobile", isPrimary: true }], emails: [] }
      });

      const result = await service.detectDuplicates([a, b]);

      expect(result.pairCount).toBe(1);
      const reasons = result.pairs[0]!.reasons;
      expect(reasons).toContain("externalId");
      expect(reasons).toContain("displayName");
      expect(reasons.some((r) => r.startsWith("phone:"))).toBe(true);
      // externalId is the highest signal (1.0)
      expect(result.pairs[0]!.score).toBe(1.0);
    });
  });

  describe("abort and failure behavior", () => {
    it("already-aborted signal throws immediately for a 1-record dataset", async () => {
      const controller = new AbortController();
      controller.abort();

      const records = [buildMinimalContact({ id: "abort", displayName: "Abort" })];

      await expect(
        service.detectDuplicates(records, { signal: controller.signal })
      ).rejects.toThrow(DuplicateDetectionAbortError);
    });

    it("stops when cancellation arrives during a scan", async () => {
      let reads = 0;
      const signal = new Proxy({} as AbortSignal, {
        get(_, property) {
          if (property === "aborted") {
            reads += 1;
            return reads > 1;
          }
          return undefined;
        }
      });
      const records = Array.from({ length: 600 }, (_, index) =>
        buildMinimalContact({ id: `abort-${index}`, displayName: `Contact ${index}` })
      );

      await expect(service.detectDuplicates(records, { signal })).rejects.toThrow(
        DuplicateDetectionAbortError
      );
    });

    it("error inside detection propagates cleanly (not swallowed)", async () => {
      // Inject a record with a getter that throws to simulate internal failure
      const badRecord = buildMinimalContact({ id: "bad", displayName: "Trigger" });
      const goodRecord = buildMinimalContact({ id: "good", displayName: "Normal" });

      // Override contactMethods on badRecord to throw when accessed during matchRecords
      Object.defineProperty(badRecord, "contactMethods", {
        get() { throw new Error("disk read error"); }
      });

      await expect(
        service.detectDuplicates([badRecord, goodRecord])
      ).rejects.toThrow("disk read error");
    });
  });
});
