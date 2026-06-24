// @vitest-environment node
// audit-gate-core.test.mjs — table-driven Vitest tests for evaluateAudit()
//
// These tests exercise the pure JS logic extracted into audit-gate-core.mjs.
// The shell smoke harness (release-usb.audit.test.sh) remains the end-to-end
// parity check for the full shell entrypoint; this suite covers the decision
// logic exhaustively without spawning processes.
//
// Fixtures are derived from the JSON payloads in release-usb.audit.test.sh
// and the JSON files under scripts/lib/fixtures/audit/.

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import path from "path";
import { evaluateAudit } from "./audit-gate-core.mjs";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(__dirname, "fixtures", "audit");
const SCRIPTS_DIR  = path.dirname(__dirname); // scripts/

/** Read a fixture JSON file as a raw string (not parsed). */
function fixture(name) {
  return readFileSync(path.join(FIXTURES_DIR, name), "utf8").trimEnd();
}

/** Load the real audit allowlist from the repo. */
function realAllowlist() {
  return JSON.parse(readFileSync(path.join(SCRIPTS_DIR, "audit-allowlist.json"), "utf8"));
}

/** A future expiry date (1 year from the fixed reference date). */
const FUTURE_EXPIRES = "2099-12-31";
/** A past expiry date. */
const PAST_EXPIRES   = "2020-01-01";

/** Minimal valid allowlist entry for GHSA-w7jw-789q-3m8p / shell-quote / critical. */
function shellQuoteEntry(overrides = {}) {
  return {
    id: "GHSA-w7jw-789q-3m8p",
    package: "shell-quote",
    severity: "critical",
    reason: "test entry",
    expires: FUTURE_EXPIRES,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Fixture JSON strings (matching the payloads in release-usb.audit.test.sh)
// ---------------------------------------------------------------------------

// Read from fixture files where they exist; define inline for variants
// that are too small to warrant a separate file.

const CLEAN_JSON          = fixture("clean.json");
const ALLOWLISTED_JSON    = fixture("allowlisted.json");
const NEW_CRITICAL_JSON   = fixture("non-allowlisted-critical.json");
const NEW_HIGH_JSON       = fixture("non-allowlisted-high.json");
const V7_CRITICAL_JSON    = fixture("v7-non-allowlisted-critical.json");
const V7_ALLOWLISTED_JSON = fixture("v7-allowlisted.json");
const V7_CLEAN_JSON       = fixture("v7-clean.json");
const ERROR_ENVELOPE_JSON = fixture("error-envelope.json");
const MALFORMED_ARR_JSON  = fixture("malformed-advisories-array.json");
const BOTH_CONTAINERS_JSON = fixture("malformed-both-containers.json");
const METADATA_ONLY_JSON  = fixture("metadata-only.json");
const LOWMOD_ONLY_JSON    = fixture("low-moderate-only.json");

// Inline variants (too small / too dynamic to store as files)
const NULL_JSON             = "null";
const EMPTY_OBJ_JSON        = "{}";
const EMPTY_BODY            = "";
const UNPARSEABLE_JSON      = "Error: ECONNREFUSED connect ECONNREFUSED 127.0.0.1:4873";
const META_ONLY_ALLZERO_JSON = '{"metadata":{"vulnerabilities":{"high":0,"critical":0}}}';
const CLEAN_V6_JSON          = '{"advisories":{},"metadata":{"vulnerabilities":{"info":0,"low":0,"moderate":0,"high":0,"critical":0}}}';
const VULN_NO_META_JSON      = '{"vulnerabilities":{}}';
const ADVISORIES_NO_META_JSON = '{"advisories":{}}';
const ADVISORIES_META_NULL   = '{"advisories":{},"metadata":{"vulnerabilities":null}}';
const STRING_COUNTS_JSON     = '{"advisories":{},"metadata":{"vulnerabilities":{"high":"0","critical":"0"}}}';
const NEGATIVE_COUNT_JSON    = '{"advisories":{},"metadata":{"vulnerabilities":{"high":-1,"critical":0}}}';
const TRAILING_SEV_JSON      = '{"advisories":{"99":{"findings":[],"id":99,"severity":"critical ","module_name":"some-pkg","title":"Trailing space sev","github_advisory_id":"GHSA-zzzz-zzzz-zzzz","vulnerable_versions":"<1.0.0","cves":[]}},"muted":[],"metadata":{"vulnerabilities":{"high":0,"critical":1}}}';
const ALLZERO_META_JSON      = '{"actions":[],"advisories":{},"muted":[],"metadata":{"vulnerabilities":{"info":0,"low":0,"moderate":0,"high":0,"critical":0},"dependencies":0}}';
const LOWMOD_V7_JSON         = '{"vulnerabilities":{"low-pkg":{"name":"low-pkg","severity":"low","via":[{"ghsaId":"GHSA-low2-low2-low2","title":"low vuln","severity":"low"}],"effects":[],"range":"*","nodes":[],"fixAvailable":false},"mod-pkg":{"name":"mod-pkg","severity":"moderate","via":[{"ghsaId":"GHSA-mod2-mod2-mod2","title":"mod vuln","severity":"moderate"}],"effects":[],"range":"*","nodes":[],"fixAvailable":false}},"metadata":{"vulnerabilities":{"info":0,"low":1,"moderate":1,"high":0,"critical":0}}}';
const SHELL_QUOTE_ONLY_JSON  = '{"advisories":{"1":{"findings":[],"id":1,"severity":"critical","module_name":"shell-quote","title":"shell-quote vuln","github_advisory_id":"GHSA-w7jw-789q-3m8p","vulnerable_versions":"<=1.8.3","cves":[]}},"muted":[],"metadata":{"vulnerabilities":{"high":0,"critical":1}}}';
const ADVISORIES_ARRAY_JSON  = '{"advisories":[],"metadata":{"vulnerabilities":{"info":0,"low":0,"moderate":0,"high":0,"critical":0}}}';
const ADVISORIES_STRING_JSON = '{"advisories":"corrupt","metadata":{"vulnerabilities":{"info":0,"low":0,"moderate":0,"high":0,"critical":0}}}';
const VULNS_ARRAY_JSON       = '{"vulnerabilities":[]}';
const EMPTY_ADVISORIES_META_CRIT_JSON = '{"advisories":{},"metadata":{"vulnerabilities":{"info":0,"low":0,"moderate":0,"high":0,"critical":5}}}';

// ---------------------------------------------------------------------------
// Table-driven test cases
// ---------------------------------------------------------------------------

describe("evaluateAudit — clean / pass cases", () => {
  /**
   * @type {Array<[string, string, unknown[], number, { exitCode: number, stdoutContains?: string }]>}
   * [label, rawJson, allowlist, pnpmExitCode, expected]
   */
  const cases = [
    [
      "clean v6 audit (empty advisories, all-zero metadata) → exit 0, PASSED token",
      CLEAN_JSON, [], 0,
      { exitCode: 0, stdoutContains: "PASSED:" },
    ],
    [
      "clean v6 (minimal advisories:{} + metadata all zeros) → exit 0",
      CLEAN_V6_JSON, [], 0,
      { exitCode: 0, stdoutContains: "PASSED:" },
    ],
    [
      "clean v7 (vulnerabilities:{} + metadata) → exit 0",
      V7_CLEAN_JSON, [], 0,
      { exitCode: 0, stdoutContains: "PASSED:" },
    ],
    [
      "allowlisted-only advisories (v6) with real allowlist → exit 0",
      ALLOWLISTED_JSON, realAllowlist(), 1,
      { exitCode: 0, stdoutContains: "PASSED:" },
    ],
    [
      "allowlisted-only advisories (v7) with real allowlist → exit 0",
      V7_ALLOWLISTED_JSON, realAllowlist(), 1,
      { exitCode: 0, stdoutContains: "PASSED:" },
    ],
    [
      "all-allowlisted with non-zero pnpm exit → still exit 0",
      ALLOWLISTED_JSON, realAllowlist(), 1,
      { exitCode: 0, stdoutContains: "PASSED:" },
    ],
    [
      "low/moderate-only advisories + non-zero pnpm exit → exit 0 (not blocked, not infra error)",
      LOWMOD_ONLY_JSON, [], 1,
      { exitCode: 0, stdoutContains: "PASSED:" },
    ],
    [
      "low/moderate-only advisories v7 + non-zero pnpm exit → exit 0",
      LOWMOD_V7_JSON, [], 1,
      { exitCode: 0, stdoutContains: "PASSED:" },
    ],
    [
      "correctly matching allowlist entry (id+package+severity) suppresses advisory → exit 0",
      SHELL_QUOTE_ONLY_JSON, [shellQuoteEntry()], 1,
      { exitCode: 0, stdoutContains: "PASSED:" },
    ],
    [
      "real allowlist + 3 known advisories → exit 0 (regression guard after allowlist changes)",
      ALLOWLISTED_JSON, realAllowlist(), 1,
      { exitCode: 0, stdoutContains: "PASSED:" },
    ],
    [
      "PASSED token contains allowlist count",
      CLEAN_JSON, [], 0,
      { exitCode: 0, stdoutContains: "PASSED:0" },
    ],
    [
      "allzero metadata + empty advisories + pnpm exit 0 → exit 0 (genuinely clean)",
      ALLZERO_META_JSON, [], 0,
      { exitCode: 0, stdoutContains: "PASSED:" },
    ],
  ];

  it.each(cases)("%s", (label, rawJson, allowlist, pnpmExit, expected) => {
    const result = evaluateAudit(rawJson, allowlist, pnpmExit);
    expect(result.exitCode).toBe(expected.exitCode);
    if (expected.stdoutContains) {
      expect(result.stdout).toContain(expected.stdoutContains);
    }
  });
});

describe("evaluateAudit — non-allowlisted advisory cases → exit 2", () => {
  const cases = [
    [
      "non-allowlisted critical advisory (v6) → exit 2, NON-ALLOWLISTED in stderr",
      NEW_CRITICAL_JSON, [], 1,
      { exitCode: 2, stderrContains: "NON-ALLOWLISTED" },
    ],
    [
      "non-allowlisted high advisory (v6) → exit 2, NON-ALLOWLISTED in stderr",
      NEW_HIGH_JSON, [], 1,
      { exitCode: 2, stderrContains: "NON-ALLOWLISTED" },
    ],
    [
      "non-allowlisted critical advisory (v7) → exit 2, NON-ALLOWLISTED in stderr",
      V7_CRITICAL_JSON, [], 1,
      { exitCode: 2, stderrContains: "NON-ALLOWLISTED" },
    ],
    [
      "advisory failure does NOT print infra-error message",
      NEW_CRITICAL_JSON, [], 1,
      { exitCode: 2, stderrNotContains: "non-advisory error" },
    ],
    [
      "allowlist entry wrong package → advisory NOT suppressed, exit 2",
      SHELL_QUOTE_ONLY_JSON,
      [shellQuoteEntry({ package: "not-shell-quote" })],
      1,
      { exitCode: 2, stderrContains: "NON-ALLOWLISTED" },
    ],
    [
      "advisory severity trailing space 'critical ' → correctly normalised and blocked (exit 2)",
      TRAILING_SEV_JSON, [], 1,
      { exitCode: 2, stderrContains: "NON-ALLOWLISTED" },
    ],
  ];

  it.each(cases)("%s", (label, rawJson, allowlist, pnpmExit, expected) => {
    const result = evaluateAudit(rawJson, allowlist, pnpmExit);
    expect(result.exitCode).toBe(expected.exitCode);
    if (expected.stderrContains) {
      expect(result.stderr).toContain(expected.stderrContains);
    }
    if (expected.stderrNotContains) {
      expect(result.stderr).not.toContain(expected.stderrNotContains);
    }
  });
});

describe("evaluateAudit — infra / malformed payload → exit 3", () => {
  const cases = [
    [
      "unparseable JSON (network error text) → exit 3",
      UNPARSEABLE_JSON, [], 1,
      { exitCode: 3, stderrContains: "Could not parse" },
    ],
    [
      "bare null output → exit 3, no unhandled TypeError",
      NULL_JSON, [], 0,
      { exitCode: 3, stderrNotContains: "TypeError" },
    ],
    [
      "empty body → exit 3",
      EMPTY_BODY, [], 1,
      { exitCode: 3 },
    ],
    [
      "empty JSON object (no advisory container) → exit 3",
      EMPTY_OBJ_JSON, [], 0,
      { exitCode: 3 },
    ],
    [
      "valid-JSON error envelope (EAUDITNOLOCK) → exit 3, unrecognised audit result message",
      // Note: the shell layer prints 'non-advisory error'; evaluateAudit itself
      // prints 'recognisable audit result' from the no-advisory-container path.
      ERROR_ENVELOPE_JSON, [], 1,
      { exitCode: 3, stderrContains: "recognisable audit result" },
    ],
    [
      "metadata-only payload (no advisory container) → exit 3",
      METADATA_ONLY_JSON, [], 0,
      { exitCode: 3, stderrContains: "advisory container" },
    ],
    [
      "metadata-only all-zero payload (no advisory container) → exit 3",
      META_ONLY_ALLZERO_JSON, [], 0,
      { exitCode: 3 },
    ],
    [
      "both advisories AND vulnerabilities containers present → exit 3 (ambiguous schema)",
      BOTH_CONTAINERS_JSON, [], 0,
      { exitCode: 3, stderrContains: "ambiguous" },
    ],
    [
      "advisories key is an array (not plain object) → exit 3",
      ADVISORIES_ARRAY_JSON, [], 0,
      { exitCode: 3, stderrContains: "not a plain object" },
    ],
    [
      "advisories key is a string → exit 3",
      ADVISORIES_STRING_JSON, [], 0,
      { exitCode: 3, stderrContains: "not a plain object" },
    ],
    [
      "vulnerabilities key is an array → exit 3",
      VULNS_ARRAY_JSON, [], 0,
      { exitCode: 3, stderrContains: "not a plain object" },
    ],
    [
      "advisories:{} with no metadata → exit 3",
      ADVISORIES_NO_META_JSON, [], 0,
      { exitCode: 3, stderrContains: "inconsistent" },
    ],
    [
      "advisories:{} with metadata.vulnerabilities:null → exit 3",
      ADVISORIES_META_NULL, [], 0,
      { exitCode: 3, stderrContains: "inconsistent" },
    ],
    [
      "vulnerabilities:{} (no metadata) → exit 3",
      VULN_NO_META_JSON, [], 0,
      { exitCode: 3, stderrContains: "inconsistent" },
    ],
    [
      "metadata reports critical:5 but advisories container is empty → exit 3",
      EMPTY_ADVISORIES_META_CRIT_JSON, [], 0,
      { exitCode: 3, stderrContains: "inconsistent" },
    ],
    [
      "metadata.vulnerabilities counts as strings → exit 3 (malformed metadata)",
      STRING_COUNTS_JSON, [], 0,
      { exitCode: 3, stderrContains: "not a non-negative integer" },
    ],
    [
      "metadata.vulnerabilities.high:-1 (negative) → exit 3",
      NEGATIVE_COUNT_JSON, [], 0,
      { exitCode: 3 },
    ],
    [
      "non-zero pnpm exit + empty advisories (all-zero metadata) → exit 3 (infra inconsistency)",
      CLEAN_JSON, [], 1,
      { exitCode: 3, stderrContains: "inconsistent" },
    ],
    [
      "non-zero pnpm exit + all-zero metadata + empty advisories → exit 3",
      ALLZERO_META_JSON, [], 1,
      { exitCode: 3, stderrContains: "inconsistent" },
    ],
    [
      "pnpmExitCode is not a number → exit 3",
      CLEAN_JSON, [], /** @type {any} */ ("notanumber"),
      { exitCode: 3, stderrContains: "argv[3]" },
    ],
    [
      "pnpmExitCode is undefined → exit 3",
      CLEAN_JSON, [], /** @type {any} */ (undefined),
      { exitCode: 3, stderrContains: "argv[3]" },
    ],
  ];

  it.each(cases)("%s", (label, rawJson, allowlist, pnpmExit, expected) => {
    const result = evaluateAudit(rawJson, allowlist, pnpmExit);
    expect(result.exitCode).toBe(expected.exitCode);
    if (expected.stderrContains) {
      expect(result.stderr).toContain(expected.stderrContains);
    }
    if (expected.stderrNotContains) {
      expect(result.stderr).not.toContain(expected.stderrNotContains);
    }
  });
});

describe("evaluateAudit — allowlist schema validation → exit 3", () => {
  const goodEntry = shellQuoteEntry();

  const cases = [
    [
      "allowlist is not an array (null) → exit 3",
      CLEAN_JSON, /** @type {any} */ (null), 0,
      { exitCode: 3, stderrContains: "malformed" },
    ],
    [
      "allowlist is not an array (object) → exit 3",
      CLEAN_JSON, /** @type {any} */ ({}), 0,
      { exitCode: 3, stderrContains: "malformed" },
    ],
    [
      "allowlist entry missing id field → exit 3",
      CLEAN_JSON,
      [{ package: "shell-quote", severity: "critical", reason: "x", expires: FUTURE_EXPIRES }],
      0,
      { exitCode: 3, stderrContains: "malformed" },
    ],
    [
      "allowlist entry missing expires field → exit 3",
      CLEAN_JSON,
      [{ id: "GHSA-w7jw-789q-3m8p", package: "shell-quote", severity: "critical", reason: "x" }],
      0,
      { exitCode: 3, stderrContains: "malformed" },
    ],
    [
      "allowlist entry severity 'low' (invalid enum) → exit 3",
      CLEAN_JSON,
      [{ id: "GHSA-w7jw-789q-3m8p", package: "shell-quote", severity: "low", reason: "x", expires: FUTURE_EXPIRES }],
      0,
      { exitCode: 3, stderrContains: "malformed" },
    ],
    [
      "allowlist entry id 'not-a-ghsa' (invalid GHSA format) → exit 3",
      CLEAN_JSON,
      [{ id: "not-a-ghsa", package: "shell-quote", severity: "critical", reason: "x", expires: FUTURE_EXPIRES }],
      0,
      { exitCode: 3, stderrContains: "malformed" },
    ],
    [
      "duplicate GHSA id + package in allowlist → exit 3",
      CLEAN_JSON,
      [goodEntry, { ...goodEntry, reason: "dup" }],
      0,
      { exitCode: 3, stderrContains: "Duplicate" },
    ],
    [
      "case-variant duplicate GHSA id (upper+lower) → exit 3",
      CLEAN_JSON,
      [
        shellQuoteEntry({ id: "GHSA-w7jw-789q-3m8p" }),
        shellQuoteEntry({ id: "ghsa-w7jw-789q-3m8p", reason: "case dup" }),
      ],
      0,
      { exitCode: 3, stderrContains: "Duplicate" },
    ],
    [
      "expired allowlist entry → exit 3",
      CLEAN_JSON,
      [shellQuoteEntry({ expires: PAST_EXPIRES })],
      0,
      { exitCode: 3, stderrContains: "expired" },
    ],
    [
      "allowlist entry expires '2026-13-40' (impossible month) → exit 3",
      CLEAN_JSON,
      [shellQuoteEntry({ expires: "2026-13-40" })],
      0,
      { exitCode: 3, stderrContains: "malformed" },
    ],
    [
      "allowlist entry expires '2026-02-30' (roll-over date) → exit 3",
      CLEAN_JSON,
      [shellQuoteEntry({ expires: "2026-02-30" })],
      0,
      { exitCode: 3, stderrContains: "malformed" },
    ],
    [
      "expired entry diagnostic message contains the actual GHSA id",
      CLEAN_JSON,
      [shellQuoteEntry({ id: "GHSA-aaaa-bbbb-cccc", expires: PAST_EXPIRES })],
      0,
      { exitCode: 3, stderrContains: "GHSA-aaaa-bbbb-cccc" },
    ],
    [
      "duplicate entry diagnostic message contains the actual GHSA id",
      CLEAN_JSON,
      [
        shellQuoteEntry({ id: "GHSA-aaaa-bbbb-cccc" }),
        shellQuoteEntry({ id: "GHSA-aaaa-bbbb-cccc", reason: "dup" }),
      ],
      0,
      { exitCode: 3, stderrContains: "GHSA-aaaa-bbbb-cccc" },
    ],
  ];

  it.each(cases)("%s", (label, rawJson, allowlist, pnpmExit, expected) => {
    const result = evaluateAudit(rawJson, allowlist, pnpmExit);
    expect(result.exitCode).toBe(expected.exitCode);
    if (expected.stderrContains) {
      expect(result.stderr).toContain(expected.stderrContains);
    }
  });
});

describe("evaluateAudit — v7 schema specifics", () => {
  it("v7 per-via severity fallback: via advisory with no own severity falls back to node severity", () => {
    // Node severity is critical; via advisory has no severity field → viaSev falls back to "critical".
    // GHSA not in allowlist → exit 2.
    const payload = JSON.stringify({
      vulnerabilities: {
        "some-pkg": {
          name: "some-pkg",
          severity: "critical",
          via: [{ ghsaId: "GHSA-zzzz-zzzz-zzzz", title: "vuln" }], // no severity field
          effects: [],
          range: "*",
          nodes: [],
          fixAvailable: false,
        },
      },
      metadata: { vulnerabilities: { high: 0, critical: 1 } },
    });
    const result = evaluateAudit(payload, [], 1);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("NON-ALLOWLISTED");
  });

  it("v7 pure-string via (transitive dep reference, no advisory objects) → no-GHSA failure, exit 2", () => {
    const payload = JSON.stringify({
      vulnerabilities: {
        "dep-pkg": {
          name: "dep-pkg",
          severity: "high",
          via: ["source-pkg"], // pure string, no advisory object
          effects: [],
          range: "*",
          nodes: [],
          fixAvailable: false,
        },
      },
      metadata: { vulnerabilities: { high: 1, critical: 0 } },
    });
    const result = evaluateAudit(payload, [], 1);
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain("no GHSA");
  });

  it("v7 severity-laundering: node claims critical but all via objects are low → exit 3", () => {
    const payload = JSON.stringify({
      vulnerabilities: {
        "bad-pkg": {
          name: "bad-pkg",
          severity: "critical",
          via: [{ ghsaId: "GHSA-test-test-test", title: "low vuln", severity: "low" }],
          effects: [],
          range: "*",
          nodes: [],
          fixAvailable: false,
        },
      },
      metadata: { vulnerabilities: { high: 0, critical: 1 } },
    });
    const result = evaluateAudit(payload, [], 1);
    expect(result.exitCode).toBe(3);
    expect(result.stderr).toContain("inconsistent");
  });

  it("v7 v6-allowlisted advisories pass with real allowlist + matching ghsaId field", () => {
    // V7_ALLOWLISTED_JSON uses ghsaId field (not github_advisory_id).
    const result = evaluateAudit(V7_ALLOWLISTED_JSON, realAllowlist(), 1);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("PASSED:");
  });
});

describe("evaluateAudit — metadata reconciliation specifics", () => {
  it("metadata reports critical:5 but no advisory container → exit 3 (metadata-only with counts)", () => {
    const payload = JSON.stringify({ metadata: { vulnerabilities: { critical: 5, high: 3 } } });
    const result = evaluateAudit(payload, [], 0);
    expect(result.exitCode).toBe(3);
  });

  it("metadata high count mismatch with iterated → exit 3", () => {
    // metadata says high:2 but advisory container has 0 high advisories
    const payload = JSON.stringify({
      advisories: {},
      metadata: { vulnerabilities: { high: 2, critical: 0 } },
    });
    const result = evaluateAudit(payload, [], 0);
    expect(result.exitCode).toBe(3);
    expect(result.stderr).toContain("inconsistent");
  });

  it("metadata missing 'high' key → exit 3", () => {
    const payload = JSON.stringify({
      advisories: {},
      metadata: { vulnerabilities: { critical: 0 } }, // 'high' absent
    });
    const result = evaluateAudit(payload, [], 0);
    expect(result.exitCode).toBe(3);
    expect(result.stderr).toContain("missing");
  });

  it("metadata missing 'critical' key → exit 3", () => {
    const payload = JSON.stringify({
      advisories: {},
      metadata: { vulnerabilities: { high: 0 } }, // 'critical' absent
    });
    const result = evaluateAudit(payload, [], 0);
    expect(result.exitCode).toBe(3);
    expect(result.stderr).toContain("missing");
  });

  it("genuine clean with all-zero integer metadata counts → exit 0 (regression guard)", () => {
    const result = evaluateAudit(CLEAN_JSON, [], 0);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("PASSED:");
  });
});
