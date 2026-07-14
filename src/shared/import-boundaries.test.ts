/**
 * import-boundaries.test.ts — MANT-16 dependency-direction guard.
 *
 * `src/shared/**` is imported BY `src/main/**` and `src/renderer/**`; it must
 * never import FROM `src/main/**` (or `src/renderer/**`) itself, or the
 * dependency graph becomes circular / the "shared" layer stops being safely
 * shareable.
 *
 * This repo has no ESLint setup (no config, no lint script, no eslint
 * dependency — `pnpm run ci` / the pre-commit hook only run
 * typecheck+test+audit-gate+build), so a `no-restricted-imports` ESLint rule
 * would not actually be enforced anywhere. This vitest test is the
 * lighter-weight equivalent that runs automatically as part of the existing
 * `pnpm test` step already wired into both the pre-commit hook and CI,
 * giving the same guarantee without introducing a new toolchain.
 *
 * Originally, `matching.parity.test.ts` violated this by importing
 * `normalizeDisplayNameForMerge` from `main/services/spreadsheet-normalize.ts`
 * purely to assert it equals the shared function it re-exports (a tautology
 * — see that file's history). That import has been removed; this test
 * prevents the pattern from recurring anywhere else under src/shared.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SHARED_ROOT = path.resolve(__dirname, "..", "shared");
const FORBIDDEN_IMPORT_PATTERN = /from\s+["'](?:\.\.\/)+(?:main|renderer)\//;

const collectSourceFiles = (dir: string): string[] => {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(fullPath));
      continue;
    }

    // Intentionally includes *.test.ts(x) — this is exactly the kind of file
    // (matching.parity.test.ts) that previously violated the boundary.
    if (/\.(ts|tsx)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
};

describe("shared → main/renderer import boundary", () => {
  it("no file under src/shared imports from src/main or src/renderer", () => {
    const sourceFiles = collectSourceFiles(SHARED_ROOT);
    const violations: string[] = [];

    for (const filePath of sourceFiles) {
      const contents = fs.readFileSync(filePath, "utf8");
      if (FORBIDDEN_IMPORT_PATTERN.test(contents)) {
        violations.push(path.relative(SHARED_ROOT, filePath));
      }
    }

    expect(violations).toEqual([]);
  });
});
