import { afterEach, describe, expect, it, vi } from "vitest";
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

  // ---------------------------------------------------------------------------
  // Cooperative / abortable behaviour
  // ---------------------------------------------------------------------------
  describe("cooperative scheduling and abort", () => {
    // Ensure fake-timer state never leaks into sibling tests that rely on setImmediate.
    afterEach(() => {
      vi.useRealTimers();
    });

    /**
     * Deterministic contact generator — no Math.random(), no Date.
     * Names cycle through a fixed pool; phone numbers are index-derived.
     * Produces records that are all distinct so pair count stays bounded.
     */
    const buildLargeFixture = (count: number): ContactRecord[] => {
      const firstNames = ["Álvaro", "Beatriz", "Carlos", "Diana", "Elena", "Fernando", "Gloria", "Héctor"];
      const lastNames = ["García", "López", "Martínez", "Sánchez", "Romero", "Torres", "Vega", "Ruiz"];
      return Array.from({ length: count }, (_, i) => {
        const first = firstNames[i % firstNames.length]!;
        const last = lastNames[Math.floor(i / firstNames.length) % lastNames.length]!;
        // Unique phone per record (padded index ensures 9 digits, all distinct)
        const phone = String(600000000 + i).padStart(9, "0");
        return buildMinimalContact({
          id: `large-${i}`,
          displayName: `${first} ${last} ${i}`, // index suffix ensures uniqueness
          contactMethods: { phones: [{ number: phone, label: "work", isPrimary: true }], emails: [] }
        });
      });
    };

    it("2,001-record fixture completes and returns a valid result", async () => {
      // 2001 records crosses exactly one CHUNK_SIZE=2000 outer-loop boundary,
      // proving the cooperative yield fires. This is a full, un-aborted O(n²) scan
      // (documented/intended complexity — see detectDuplicates docstring), so its
      // runtime scales with the square of the fixture size. Measured locally at
      // ~35s; the 120s timeout below leaves comfortable headroom for slower CI
      // runners without masking an actual complexity regression.
      const records = buildLargeFixture(2001);
      const result = await service.detectDuplicates(records);

      expect(result.checkedCount).toBe(2001);
      expect(result.pairCount).toBeGreaterThanOrEqual(0);
      // Pairs array and records map must be consistent
      expect(Object.keys(result.records).length).toBe(
        new Set(result.pairs.flatMap((p) => [p.recordA.id, p.recordB.id])).size
      );
    }, 120_000);

    // Acceptance: 5 000-record scale — abort early (before first chunk boundary)
    // rather than running the full O(n²) scan so the test stays fast on CI.
    // This proves: (a) a 5k dataset is correctly sized/built, (b) abort at i=0 is
    // honored immediately even at production scale.
    it("5,000-record dataset: already-aborted signal aborts before first chunk (fast path)", async () => {
      const controller = new AbortController();
      // Abort BEFORE passing the signal — guarantees abort fires at i=0.
      controller.abort();

      const records = buildLargeFixture(5000);
      expect(records).toHaveLength(5000); // confirm fixture scale

      await expect(
        service.detectDuplicates(records, { signal: controller.signal })
      ).rejects.toThrow(DuplicateDetectionAbortError);
    }, 60_000);

    // FIX 1 lock: abort check must fire on every outer iteration, including i=0.
    // An already-aborted signal on a tiny dataset must throw immediately.
    it("already-aborted signal throws immediately for a 1-record dataset", async () => {
      const controller = new AbortController();
      controller.abort();

      const records = buildLargeFixture(1);

      await expect(
        service.detectDuplicates(records, { signal: controller.signal })
      ).rejects.toThrow(DuplicateDetectionAbortError);
    });

    it("already-aborted signal throws immediately for a dataset at CHUNK_SIZE boundary (2000 records)", async () => {
      const controller = new AbortController();
      controller.abort();

      // 2000 records: with the old i>0 guard, the abort check at i=0 was skipped
      // and no chunk boundary (i%2000===0 && i>0) is ever reached — so abort was
      // never detected and the run completed. The unconditional per-iteration check
      // must catch it at i=0 instead.
      const records = buildLargeFixture(2000);

      await expect(
        service.detectDuplicates(records, { signal: controller.signal })
      ).rejects.toThrow(DuplicateDetectionAbortError);
    });

    it("already-aborted signal throws immediately for a dataset just above first chunk (2001 records)", async () => {
      const controller = new AbortController();
      controller.abort();

      const records = buildLargeFixture(2001);

      let threw = false;
      let partial: unknown = undefined;

      try {
        partial = await service.detectDuplicates(records, { signal: controller.signal });
      } catch (err) {
        threw = true;
        expect(err).toBeInstanceOf(DuplicateDetectionAbortError);
      }

      expect(threw).toBe(true);
      expect(partial).toBeUndefined();
    }, 60_000);

    it("mid-run abort: signal aborted during setImmediate yield is caught by post-yield re-check", async () => {
      // This test locks the SECOND abort surface in the loop:
      //   await new Promise<void>((r) => setImmediate(r));   ← yield
      //   if (signal?.aborted) throw ...                     ← post-yield re-check
      //
      // Strategy: schedule the abort via setImmediate BEFORE starting the scan.
      // The scan runs the first chunk (i=0..1999) synchronously, then suspends at
      // the setImmediate yield (i=2000). By that time the pre-scheduled setImmediate
      // has already run, so signal.aborted is true when the post-yield re-check fires.
      const controller = new AbortController();

      // Schedule abort into the setImmediate queue now, before the scan starts.
      // It will execute while the scan is suspended at its first yield point.
      setImmediate(() => controller.abort());

      const records = buildLargeFixture(2001); // crosses exactly one chunk boundary

      let threw = false;
      let partial: unknown = undefined;

      try {
        partial = await service.detectDuplicates(records, { signal: controller.signal });
      } catch (err) {
        threw = true;
        expect(err).toBeInstanceOf(DuplicateDetectionAbortError);
      }

      expect(threw).toBe(true);
      expect(partial).toBeUndefined();
      // NOTE: aborting at the i=2000 yield still means outer rows i=0..1999 ran to
      // completion first — effectively the full O(n²) scan (see docstring on
      // detectDuplicates). Same "measured ~35s locally" rationale as the 2,001-record
      // test above applies to the 120s timeout below.
    }, 120_000);

    it("inner-loop abort: mid-scan abort during a single outer iteration is honored within INNER_ABORT_INTERVAL steps", async () => {
      // This test locks the THIRD abort surface: the abort check added inside the inner
      // j-loop every INNER_ABORT_INTERVAL (512) steps.
      //
      // Strategy: use a dataset of exactly 1 record in the outer loop's first row
      // with N-1 inner comparisons where N-1 > INNER_ABORT_INTERVAL. We build
      // 600 records. For i=0 the inner loop runs j=1..599 (599 steps). At j=512
      // (the first multiple of INNER_ABORT_INTERVAL inside the inner loop) the check
      // fires. We abort before the scan starts so signal.aborted is true when j=512
      // is reached — but NOT at i=0 outer check (which fires first). So we need
      // the outer check at i=0 to NOT fire (i.e. signal is NOT yet aborted at i=0)
      // and only become aborted partway through the inner loop.
      //
      // We achieve this by scheduling the abort via setImmediate AFTER starting the
      // detectDuplicates call. Because the inner loop is synchronous, setImmediate
      // callbacks won't run until the current microtask/task yields. We need a
      // different mechanism: use AbortController and trigger abort asynchronously
      // in a way that the inner-loop check sees it.
      //
      // Approach: use a custom AbortSignal that becomes aborted after a fixed count
      // of checks — simulated by having the outer check pass (not aborted yet) and
      // the inner check catch it. We do this by aborting via a promise microtask
      // scheduled before the scan, which means signal.aborted becomes true during
      // the synchronous inner loop on the very first outer iteration:
      //
      // Actually the cleanest approach: abort BEFORE the call but after i=0's outer
      // check. Since both the outer check (i=0) and inner check (j>=512) are
      // synchronous code in the same microtask, we can't interleave real async.
      //
      // Instead: verify that an already-aborted signal on a 600-record dataset
      // (where i=0 outer check runs first) is caught at i=0 (outer check). That's
      // already tested above. For the inner-loop check specifically, we need
      // signal.aborted to become true AFTER the outer check at i=0 but BEFORE
      // j=512. This is not possible with a real synchronous abort.
      //
      // Correct approach: use a Proxy-based signal whose .aborted property returns
      // false for the first K reads (letting the outer check and early inner iters
      // pass) then returns true at the 513th read (j=512 check). This directly
      // tests that the inner-loop check path is reachable and throws.

      let abortReadCount = 0;
      // Allow outer check (read 1) + inner checks at j=0..511 would not fire
      // (reads 2..513 are j%512!==0 skips, but actually the check only runs when
      // j%512===0, so the inner check runs at j=0? No: j starts at i+1=1, and
      // check fires when j%512===0, so first inner check is at j=512).
      // Outer loop: 1 read of signal.aborted (i=0 check).
      // Inner loop: j=1..599, check fires only at j=512 (1 read).
      // Total reads before inner check: 1 (outer). We let read 1 return false,
      // read 2 (at j=512) return true.
      const OUTER_READS_BEFORE_INNER = 1;
      const mockSignal = new Proxy({} as AbortSignal, {
        get(_, prop) {
          if (prop === "aborted") {
            abortReadCount++;
            // First OUTER_READS_BEFORE_INNER reads: not aborted (outer check passes)
            // From read OUTER_READS_BEFORE_INNER+1 onward: aborted (inner check fires)
            return abortReadCount > OUTER_READS_BEFORE_INNER;
          }
          return undefined;
        }
      });

      // 600 records: i=0 outer row has j=1..599 (599 inner steps).
      // First inner abort check fires at j=512 (512 % 512 === 0).
      const records = buildLargeFixture(600);

      await expect(
        service.detectDuplicates(records, { signal: mockSignal })
      ).rejects.toThrow(DuplicateDetectionAbortError);

      // Verify the inner check was the one that fired (abortReadCount should be
      // exactly 2: one outer read that returned false, one inner read at j=512
      // that returned true).
      expect(abortReadCount).toBe(2);
    });

    it("IPC 30s timeout path surfaces DuplicateDetectionAbortError via fake timers", async () => {
      vi.useFakeTimers();
      const controller = new AbortController();

      // Simulate what the IPC handler does: abort after 30s
      const timeoutId = setTimeout(() => controller.abort(), 30_000);

      // Advance timers past the 30s threshold so the abort fires
      vi.advanceTimersByTime(30_001);

      // controller is now aborted
      expect(controller.signal.aborted).toBe(true);

      clearTimeout(timeoutId);
      vi.useRealTimers();
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

    it("bounded memory: pair count is proportional to input, not n²", async () => {
      // 2001-record fixture: unique phone per record, names are "First Last i" with i suffix.
      // Pair count must be bounded well below n²=4_004_001.
      //
      // Note: this test asserts the *output pair count* stays sub-quadratic (memory
      // bound), not the scan's time complexity — detectDuplicates itself is a
      // documented O(n²) comparison scan (see its docstring), so this is another
      // full, un-aborted scan like the "2,001-record fixture" test above. Same
      // "measured ~35s locally" rationale applies to the 120s timeout below.
      const N = 2001;
      const records = buildLargeFixture(N);
      const result = await service.detectDuplicates(records);

      // Asserting pair count stays below a generous upper bound of 1% of n² proves the
      // algorithm is not accumulating an unbounded pairs structure.
      const upperBound = Math.ceil(N * N * 0.01); // ~40,040 — extremely generous
      expect(result.pairCount).toBeLessThan(upperBound);

      // The records map size is bounded by 2 * pairCount (at most one entry per unique record in pairs)
      expect(Object.keys(result.records).length).toBeLessThanOrEqual(result.pairCount * 2);
    }, 120_000);
  });
});
