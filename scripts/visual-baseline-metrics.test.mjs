import { describe, expect, it } from "vitest";
import { assertVisualBaseline } from "./visual-baseline-metrics.mjs";

const reference = [{
  route: "directory",
  viewport: { width: 320, height: 844 },
  border: { color: "rgb(226, 232, 240)" },
  focus: { visible: true, boxShadow: "rgb(0, 93, 168) 0px 0px 0px 2px" }
}];

describe("visual baseline metrics", () => {
  it.each([
    ["border", { border: { color: "rgb(0, 0, 0)" } }],
    ["focus ring", { focus: { visible: true, boxShadow: "none" } }]
  ])("rejects a changed %s even without overflow", (_, change) => {
    const current = [{ ...reference[0], ...change }];
    expect(() => assertVisualBaseline(current, reference)).toThrow("directory 320px");
  });

  it("accepts matching metrics", () => {
    expect(() => assertVisualBaseline(structuredClone(reference), reference)).not.toThrow();
  });
});
