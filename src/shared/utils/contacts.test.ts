import { describe, expect, it } from "vitest";
import { normalizePrimaryEntries, reconcilePrimaryEntries } from "./contacts";

type Entry = { id: string; isPrimary: boolean };

describe("normalizePrimaryEntries", () => {
  it("returns an empty array unchanged", () => {
    expect(normalizePrimaryEntries<Entry>([])).toEqual([]);
  });

  it("invents a primary on the first entry when none is marked", () => {
    const entries: Entry[] = [
      { id: "a", isPrimary: false },
      { id: "b", isPrimary: false }
    ];

    const result = normalizePrimaryEntries(entries);

    expect(result[0]!.isPrimary).toBe(true);
    expect(result[1]!.isPrimary).toBe(false);
  });

  it("demotes every extra entry when more than one claims primary", () => {
    const entries: Entry[] = [
      { id: "a", isPrimary: true },
      { id: "b", isPrimary: true }
    ];

    const result = normalizePrimaryEntries(entries);

    expect(result[0]!.isPrimary).toBe(true);
    expect(result[1]!.isPrimary).toBe(false);
  });
});

describe("reconcilePrimaryEntries (never invents a primary)", () => {
  it("returns an empty array unchanged", () => {
    expect(reconcilePrimaryEntries<Entry>([])).toEqual([]);
  });

  it("leaves zero marked entries as zero — does not invent a primary", () => {
    const entries: Entry[] = [
      { id: "a", isPrimary: false },
      { id: "b", isPrimary: false }
    ];

    const result = reconcilePrimaryEntries(entries);

    expect(result[0]!.isPrimary).toBe(false);
    expect(result[1]!.isPrimary).toBe(false);
    expect(result).toEqual(entries);
  });

  it("leaves a single marked entry unchanged", () => {
    const entries: Entry[] = [
      { id: "a", isPrimary: false },
      { id: "b", isPrimary: true }
    ];

    const result = reconcilePrimaryEntries(entries);

    expect(result[0]!.isPrimary).toBe(false);
    expect(result[1]!.isPrimary).toBe(true);
  });

  it("demotes every extra entry after the first when multiple are marked primary", () => {
    const entries: Entry[] = [
      { id: "a", isPrimary: true },
      { id: "b", isPrimary: true },
      { id: "c", isPrimary: true }
    ];

    const result = reconcilePrimaryEntries(entries);

    expect(result[0]!.isPrimary).toBe(true);
    expect(result[1]!.isPrimary).toBe(false);
    expect(result[2]!.isPrimary).toBe(false);
  });

  it("does not mutate the input array", () => {
    const entries: Entry[] = [
      { id: "a", isPrimary: true },
      { id: "b", isPrimary: true }
    ];
    const snapshot = JSON.parse(JSON.stringify(entries));

    reconcilePrimaryEntries(entries);

    expect(entries).toEqual(snapshot);
  });
});
