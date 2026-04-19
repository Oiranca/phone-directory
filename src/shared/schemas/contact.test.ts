import { describe, expect, it } from "vitest";
import { directoryDatasetSchema } from "./contact";
import { defaultContacts } from "../fixtures/defaultContacts";

describe("directoryDatasetSchema", () => {
  it("parses the default dataset fixture", () => {
    const result = directoryDatasetSchema.parse(defaultContacts);
    expect(result.records).toHaveLength(2);
    expect(result.records[0]?.displayName).toBe("Admisión General");
  });

  it("rejects invalid timestamp fields", () => {
    const invalidDataset = structuredClone(defaultContacts);
    invalidDataset.exportedAt = "not-a-date";

    expect(() => directoryDatasetSchema.parse(invalidDataset)).toThrow();
  });
});
