/**
 * import-boundaries.test.ts —  dependency-direction guard.
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

// Matches every import form that can pull code from src/main or src/renderer
// into src/shared, not just static `import ... from "../main/...";`:
//   - static named/default imports: `import { x } from "../main/foo"`
//   - side-effect-only imports:     `import "../main/foo"`
//   - dynamic imports:              `import("../main/foo")`, `await import("../renderer/foo")`
//   - CommonJS require:             `require("../main/foo")`
// All four share the same "quoted relative-path specifier that resolves into
// main/renderer" shape once the `from`/`import(`/`require(` keyword is
// stripped away, so a single pattern anchored on the specifier itself (rather
// than the keyword introducing it) catches all of them.
const FORBIDDEN_IMPORT_PATTERN =
  /(?:\bfrom\s+|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)["'](?:\.\.\/)+(?:main|renderer)\//m;

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

// Deliberate, narrowly-scoped exceptions to the boundary — every entry here
// must document exactly why it's safe, so the allowlist can't silently grow.
const ALLOWED_EXCEPTIONS: ReadonlyMap<string, string> = new Map([
  [
    "import-boundaries.test.ts",
    "This file's own FORBIDDEN_IMPORT_PATTERN fixture tests below intentionally " +
      'contain literal strings shaped like forbidden imports (e.g. `import "../main/foo"`) ' +
      "to prove the guard catches them — they are not real imports, so scanning this file " +
      "against its own pattern would always self-flag."
  ],
  [
    "ipc/api.contract.test.ts",
    ": uses `await import(\"../../main/ipc/*.ipc.js\")` (dynamic, behind a " +
      'mocked "electron" module) to assert every renderer-invokable channel has a ' +
      "registered ipcMain handler. This is a dev-time-only contract test — it is never " +
      "bundled into the shipped renderer or main output — so it does not create the " +
      "runtime circular-dependency problem this guard exists to prevent. Broadening " +
      "FORBIDDEN_IMPORT_PATTERN to catch dynamic import() ( review) surfaced this " +
      "pre-existing, intentional case; see that file's module doc-comment for the full " +
      "rationale for why it must reach into src/main at all."
  ]
]);

describe("shared → main/renderer import boundary", () => {
  it("no file under src/shared imports from src/main or src/renderer", () => {
    const sourceFiles = collectSourceFiles(SHARED_ROOT);
    const violations: string[] = [];

    for (const filePath of sourceFiles) {
      const relativePath = path.relative(SHARED_ROOT, filePath);
      if (ALLOWED_EXCEPTIONS.has(relativePath)) {
        continue;
      }

      const contents = fs.readFileSync(filePath, "utf8");
      if (FORBIDDEN_IMPORT_PATTERN.test(contents)) {
        violations.push(relativePath);
      }
    }

    expect(violations).toEqual([]);
  });

  it("ALLOWED_EXCEPTIONS only lists files that actually exist under src/shared", () => {
    for (const relativePath of ALLOWED_EXCEPTIONS.keys()) {
      expect(fs.existsSync(path.join(SHARED_ROOT, relativePath))).toBe(true);
    }
  });
});

describe("FORBIDDEN_IMPORT_PATTERN — detects every import form, not just static `from`", () => {
  // Reviewer finding: the guard originally only matched
  // `from "../main/..."` style static imports, silently letting
  // side-effect-only imports, dynamic imports, and require() calls targeting
  // main/renderer slip past undetected. These are fixture strings only — no
  // real file under src/shared actually contains any of these imports.
  it("catches a static named import (pre-existing case, kept as a regression guard)", () => {
    expect(
      FORBIDDEN_IMPORT_PATTERN.test(`import { foo } from "../main/services/foo";`)
    ).toBe(true);
    expect(
      FORBIDDEN_IMPORT_PATTERN.test(`import { foo } from "../../renderer/store/foo";`)
    ).toBe(true);
  });

  it("catches a side-effect-only import", () => {
    expect(FORBIDDEN_IMPORT_PATTERN.test(`import "../main/services/foo";`)).toBe(true);
    expect(FORBIDDEN_IMPORT_PATTERN.test(`import "../renderer/store/foo";`)).toBe(true);
  });

  it("catches a dynamic import()", () => {
    expect(FORBIDDEN_IMPORT_PATTERN.test(`const mod = import("../main/services/foo");`)).toBe(true);
  });

  it("catches an awaited dynamic import()", () => {
    expect(
      FORBIDDEN_IMPORT_PATTERN.test(`const mod = await import("../renderer/store/foo");`)
    ).toBe(true);
  });

  it("catches a CommonJS require()", () => {
    expect(FORBIDDEN_IMPORT_PATTERN.test(`const foo = require("../main/services/foo");`)).toBe(true);
  });

  it("does not flag imports from within src/shared itself or from third-party packages", () => {
    expect(FORBIDDEN_IMPORT_PATTERN.test(`import { foo } from "./sibling";`)).toBe(false);
    expect(FORBIDDEN_IMPORT_PATTERN.test(`import { z } from "zod";`)).toBe(false);
    expect(FORBIDDEN_IMPORT_PATTERN.test(`const path = require("node:path");`)).toBe(false);
  });
});
