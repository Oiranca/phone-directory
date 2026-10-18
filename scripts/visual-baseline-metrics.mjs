import assert from "node:assert/strict";

export const assertVisualBaseline = (actual, reference) => {
  assert.equal(actual.length, reference.length, "Visual baseline capture count changed");
  for (const [index, metrics] of actual.entries()) {
    assert.deepStrictEqual(metrics, reference[index],
      `${metrics.route} ${metrics.viewport.width}px visual baseline changed`);
  }
};
