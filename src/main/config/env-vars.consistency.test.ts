/**
 * Consistency test: env var references vs. docs/ENVIRONMENT.md
 *
 * Scans the repo source for `process.env.X` and `import.meta.env.X` references,
 * parses the documented variable names from docs/ENVIRONMENT.md (the single
 * source of truth), and asserts the two sets are equal.
 *
 * The test FAILS when:
 *   - A variable is referenced in source but missing from the docs (undocumented).
 *   - A variable is documented but no longer referenced anywhere (orphaned doc).
 *
 * Allowlist: variables that appear in source scans but are legitimately excluded
 * from the docs (e.g. generic Node.js builtins that are not project-specific).
 * Keep this list minimal and comment every entry.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PROJECT_ROOT = path.resolve(import.meta.dirname, "../../..");

/** Directories and file globs scanned for env var references. */
const SCAN_DIRS = [
  "src",
  "scripts",
  "tests/e2e",
  "playwright.config.ts",
  "vite.config.ts"
];

/**
 * File extensions considered when scanning directories.
 * Config files at root are added by name in SCAN_DIRS above.
 */
const SCAN_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts", ".mjs", ".cjs", ".js"]);

/**
 * Allowlist of var names found by the regex that should NOT be required in
 * docs/ENVIRONMENT.md. Add an entry only when the var is a standard Node.js /
 * OS / third-party built-in that this project does not own.
 *
 * Format: { name: "VAR_NAME", reason: "why it is excluded" }
 */
const SCAN_ALLOWLIST: Array<{ name: string; reason: string }> = [
  // No allowlisted entries — all vars currently referenced are project-owned.
];

/** Path to the env var registry (single source of truth). */
const REGISTRY_PATH = path.join(PROJECT_ROOT, "docs", "ENVIRONMENT.md");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Recursively collect files under `dir` matching SCAN_EXTENSIONS. */
function collectFiles(dir: string): string[] {
  const results: string[] = [];
  let entries: fs.Dirent[];

  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip generated/tool directories
      if (["node_modules", "dist", "dist-electron", ".claude", "worktrees"].includes(entry.name)) {
        continue;
      }
      results.push(...collectFiles(fullPath));
    } else if (entry.isFile() && SCAN_EXTENSIONS.has(path.extname(entry.name))) {
      results.push(fullPath);
    }
  }

  return results;
}

/** Extract all env var names referenced in the given source text. */
const ENV_REF_REGEX = /(?:process\.env|import\.meta\.env)\.([A-Z][A-Z0-9_]*)/g;

function extractReferencedVars(source: string): Set<string> {
  const vars = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = ENV_REF_REGEX.exec(source)) !== null) {
    vars.add(match[1]);
  }
  return vars;
}

/**
 * Parse documented var names from docs/ENVIRONMENT.md.
 * Each documented variable has a `### VAR_NAME` heading.
 */
const REGISTRY_HEADING_REGEX = /^###\s+([A-Z][A-Z0-9_]*)\s*$/gm;

function parseDocumentedVars(registrySource: string): Set<string> {
  const vars = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = REGISTRY_HEADING_REGEX.exec(registrySource)) !== null) {
    vars.add(match[1]);
  }
  return vars;
}

// ---------------------------------------------------------------------------
// Test
// ---------------------------------------------------------------------------

describe("env var registry consistency", () => {
  it("docs/ENVIRONMENT.md documents exactly the env vars referenced in source (no undocumented, no orphans)", () => {
    // 1. Collect source files to scan (exclude this test file itself).
    const thisFile = path.resolve(import.meta.filename);
    const files: string[] = [];

    for (const entry of SCAN_DIRS) {
      const fullEntry = path.join(PROJECT_ROOT, entry);
      const stat = fs.statSync(fullEntry, { throwIfNoEntry: false });
      if (!stat) continue;
      if (stat.isDirectory()) {
        files.push(...collectFiles(fullEntry));
      } else if (stat.isFile()) {
        files.push(fullEntry);
      }
    }

    // 2. Extract all referenced var names, skipping this test file.
    const referenced = new Set<string>();
    for (const file of files) {
      if (file === thisFile) continue;
      const source = fs.readFileSync(file, "utf-8");
      for (const name of extractReferencedVars(source)) {
        referenced.add(name);
      }
    }

    // 3. Apply allowlist.
    const allowlisted = new Set(SCAN_ALLOWLIST.map((e) => e.name));
    for (const name of allowlisted) {
      referenced.delete(name);
    }

    // 4. Parse documented vars from the registry.
    const registrySource = fs.readFileSync(REGISTRY_PATH, "utf-8");
    const documented = parseDocumentedVars(registrySource);

    // 5. Compute diffs.
    const undocumented = [...referenced].filter((v) => !documented.has(v)).sort();
    const orphaned = [...documented].filter((v) => !referenced.has(v)).sort();

    // 6. Assert.
    expect(undocumented, `Env vars referenced in source but missing from docs/ENVIRONMENT.md:\n  ${undocumented.join(", ")}\n\nAdd a ### <VAR_NAME> section to docs/ENVIRONMENT.md for each.`).toEqual([]);
    expect(orphaned, `Env vars documented in docs/ENVIRONMENT.md but no longer referenced in source:\n  ${orphaned.join(", ")}\n\nRemove the ### <VAR_NAME> section from docs/ENVIRONMENT.md, or restore the reference.`).toEqual([]);
  });
});
