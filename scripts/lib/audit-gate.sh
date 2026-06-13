#!/usr/bin/env bash
# audit-gate.sh — sourceable dependency-audit gate for release-usb.sh
#
# Usage (source this file, then call run_audit_gate):
#   source "$(dirname "${BASH_SOURCE[0]}")/lib/audit-gate.sh"
#   run_audit_gate          # sets AUDIT_STATUS_LINE on success; exits non-zero on failure
#
# Environment variables read:
#   SKIP_AUDIT        — set to exactly "1" to bypass the gate
#   SKIP_AUDIT_REASON — required non-empty string when SKIP_AUDIT=1
#   REPO_ROOT         — must be set by the caller (repo root directory)
#
# On return the caller can read:
#   AUDIT_STATUS_LINE — human-readable status line for the release manifest

AUDIT_ALLOWLIST="$REPO_ROOT/scripts/audit-allowlist.json"

# Node.js snippet that:
#   1. Reads pnpm audit --json from stdin
#   2. Loads the allowlist
#   3. Returns exit 0 if no non-allowlisted high/critical advisories remain
#   4. Returns exit 2 if non-allowlisted advisories exist (prints them)
#   5. Returns exit 3 if the JSON is not parseable (infra/network error)
_AUDIT_FILTER_SCRIPT='
const fs = require("fs");

let raw = "";
process.stdin.on("data", d => { raw += d; });
process.stdin.on("end", () => {
  // --- parse JSON -----------------------------------------------------------
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    process.stderr.write("[audit-gate] Could not parse pnpm audit output as JSON — likely a network or registry error.\n");
    process.exit(3);
  }

  // Guard: JSON.parse("null") succeeds but returns null, not an object.
  // Any non-object result is an infra error — never a clean pass.
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    process.stderr.write("[audit-gate] pnpm audit output is not a JSON object (got: " + (data === null ? "null" : typeof data) + ") — likely a network or registry error.\n");
    process.exit(3);
  }

  // --- require a positive success signal ------------------------------------
  // A real pnpm audit response must have EITHER:
  //   • data.advisories  (pnpm/npm v6 schema)
  //   • data.vulnerabilities  (npm v7+ schema)
  //   • data.metadata  (present on real v6 responses even when empty)
  // If NONE of those are present but data.error IS present, it is an error
  // envelope that JSON.parse accepted — treat it as infra error, not a pass.
  const hasAdvisories     = Object.prototype.hasOwnProperty.call(data, "advisories");
  const hasVulnerabilities = Object.prototype.hasOwnProperty.call(data, "vulnerabilities");
  const hasMetadata       = Object.prototype.hasOwnProperty.call(data, "metadata");
  const hasError          = Object.prototype.hasOwnProperty.call(data, "error");

  if (!hasAdvisories && !hasVulnerabilities && !hasMetadata) {
    // No recognisable advisory container — could be an error envelope or
    // totally unknown shape.  Either way it is not a confirmed clean audit.
    const detail = hasError
      ? "error code: " + (data.error && data.error.code ? data.error.code : JSON.stringify(data.error))
      : "unrecognised response shape";
    process.stderr.write("[audit-gate] pnpm audit did not return a recognisable audit result (" + detail + ") — likely a network, lockfile, or registry error.\n");
    process.exit(3);
  }

  // --- load allowlist -------------------------------------------------------
  const allowlistPath = process.argv[1];
  let allowlist = [];
  try {
    allowlist = JSON.parse(fs.readFileSync(allowlistPath, "utf8"));
  } catch (e) {
    process.stderr.write("[audit-gate] Could not read allowlist at: " + allowlistPath + "\n");
    process.stderr.write(e.message + "\n");
    process.exit(1);
  }

  const allowedIds = new Set(allowlist.map(e => e.id));
  const allowlistCount = allowlist.length;

  const failures = [];
  let iteratedHighCrit = 0;

  // --- v6 schema: data.advisories -------------------------------------------
  if (hasAdvisories) {
    const advisories = data.advisories || {};
    for (const [, adv] of Object.entries(advisories)) {
      const sev = (adv.severity || "").toLowerCase();
      if (sev !== "high" && sev !== "critical") continue;
      iteratedHighCrit++;
      const ghsa = adv.github_advisory_id || "";
      // A finding with no GHSA ID must NOT be silently allowlisted — it counts
      // as a failure because we cannot confirm its identity.
      if (ghsa && allowedIds.has(ghsa)) continue;
      failures.push({ ghsa, severity: sev, package: adv.module_name, title: adv.title });
    }
  }

  // --- v7 schema: data.vulnerabilities --------------------------------------
  if (hasVulnerabilities) {
    const vulns = data.vulnerabilities || {};
    for (const [pkgName, vuln] of Object.entries(vulns)) {
      const sev = (vuln.severity || "").toLowerCase();
      if (sev !== "high" && sev !== "critical") continue;
      iteratedHighCrit++;

      // Extract GHSA IDs from the "via" array (may contain string dep-names or
      // advisory objects with a ghsaId field).
      const viaAdvisories = (vuln.via || []).filter(v => v && typeof v === "object");
      if (viaAdvisories.length === 0) {
        // No advisory objects in via — treat as no-GHSA failure (cannot allowlist).
        failures.push({ ghsa: "", severity: sev, package: pkgName, title: vuln.title || pkgName });
        continue;
      }

      for (const via of viaAdvisories) {
        const ghsa = via.ghsaId || via.github_advisory_id || "";
        // A finding with no GHSA ID must NOT be silently allowlisted.
        if (ghsa && allowedIds.has(ghsa)) continue;
        failures.push({ ghsa, severity: sev, package: pkgName, title: via.title || pkgName });
      }
    }
  }

  // --- metadata reconciliation ----------------------------------------------
  // Cross-validate: if metadata.vulnerabilities reports high/critical counts
  // that exceed what we actually iterated from the advisory container, the
  // response is inconsistent (truncated, partially parsed, or malformed).
  // This closes the fail-open where metadata alone acts as a success signal.
  if (hasMetadata && data.metadata && data.metadata.vulnerabilities) {
    const mv = data.metadata.vulnerabilities;
    const metaHighCrit = ((mv.high || 0) + (mv.critical || 0));
    if (metaHighCrit > iteratedHighCrit) {
      process.stderr.write(
        "[audit-gate] Metadata reports " + metaHighCrit + " high/critical advisory/ies " +
        "but only " + iteratedHighCrit + " were found in the parsed advisory container — " +
        "response is inconsistent (truncated, schema mismatch, or registry error).\n"
      );
      process.exit(3);
    }
  }

  // --- result ---------------------------------------------------------------
  if (failures.length === 0) {
    process.stdout.write("PASSED:" + allowlistCount + "\n");
    process.exit(0);
  }

  for (const f of failures) {
    process.stderr.write(
      "[audit-gate] NON-ALLOWLISTED " + f.severity.toUpperCase() +
      ": " + f.package + " (" + (f.ghsa || "no GHSA") + ") — " + f.title + "\n"
    );
  }
  process.exit(2);
});
'

run_audit_gate() {
  if [[ "${SKIP_AUDIT:-0}" == "1" ]]; then
    if [[ -z "${SKIP_AUDIT_REASON:-}" ]]; then
      printf '[audit-gate] ✗ SKIP_AUDIT=1 is set but SKIP_AUDIT_REASON is empty.\n' >&2
      printf '[audit-gate]   Bypass requires an explicit reason. Set SKIP_AUDIT_REASON="<why>" and re-run.\n' >&2
      printf '[audit-gate]   Example: SKIP_AUDIT=1 SKIP_AUDIT_REASON="GHSA-xxx accepted per SECURITY.md §Accepted Risks" pnpm run release:usb\n' >&2
      exit 1
    fi
    printf '[audit-gate] ⚠️  SKIP_AUDIT=1 — dependency audit bypassed\n' >&2
    printf '[audit-gate]    Reason: %s\n' "$SKIP_AUDIT_REASON" >&2
    AUDIT_STATUS_LINE="Dependency audit: BYPASSED — reason: ${SKIP_AUDIT_REASON}"
    return 0
  fi

  # Run pnpm audit and capture JSON stdout; capture stderr separately so we can
  # echo it to the operator when the gate aborts on an infra error.
  local audit_json
  local pnpm_stderr
  local pnpm_exit=0
  local _pnpm_stderr_file
  _pnpm_stderr_file="$(mktemp)"
  audit_json="$(pnpm audit --json 2>"$_pnpm_stderr_file")" || pnpm_exit=$?
  pnpm_stderr="$(cat "$_pnpm_stderr_file")"
  rm -f "$_pnpm_stderr_file"

  # Feed JSON through the Node filter
  local filter_output
  local filter_exit=0
  filter_output="$(printf '%s' "$audit_json" | node -e "$_AUDIT_FILTER_SCRIPT" "$AUDIT_ALLOWLIST" 2>&1)" || filter_exit=$?

  # Separate stderr lines (errors) from the PASSED:N stdout token
  # Node writes advisory failures to stderr and PASSED:N to stdout.
  # Because we captured stderr+stdout together with 2>&1, parse them out.
  local status_token
  local error_lines
  status_token="$(printf '%s' "$filter_output" | grep '^PASSED:' | head -1)" || true
  error_lines="$(printf '%s' "$filter_output" | grep -v '^PASSED:')" || true

  # A non-zero pnpm exit that did NOT produce a parseable advisory result must
  # never pass.  If the filter already flagged it (exit 3) this branch handles
  # that; but also guard the case where filter_exit==0 despite pnpm_exit!=0
  # (e.g. empty output that somehow reached PASSED — belt-and-suspenders).
  if [[ $filter_exit -eq 0 && $pnpm_exit -ne 0 && -z "$status_token" ]]; then
    filter_exit=3
  fi

  if [[ $filter_exit -eq 3 ]]; then
    # Infra / network / registry error — not an advisory failure
    printf '%s\n' "$error_lines" >&2
    if [[ -n "$pnpm_stderr" ]]; then
      printf '[audit-gate] pnpm diagnostics:\n' >&2
      printf '%s\n' "$pnpm_stderr" >&2
    fi
    printf '[audit-gate] ✗ Dependency audit failed to complete (non-advisory error — check network/registry).\n' >&2
    exit 1
  fi

  if [[ $filter_exit -eq 2 ]]; then
    # Non-allowlisted advisory failures — print them
    printf '%s\n' "$error_lines" >&2
    printf '[audit-gate] ✗ Dependency audit found non-allowlisted high/critical advisories — release aborted.\n' >&2
    printf '[audit-gate]   Review the advisories above, resolve them, or add a documented entry to scripts/audit-allowlist.json.\n' >&2
    exit 1
  fi

  if [[ $filter_exit -ne 0 ]]; then
    # Unexpected filter error (e.g. allowlist read failure)
    printf '%s\n' "$error_lines" >&2
    printf '[audit-gate] ✗ Audit gate encountered an unexpected error (exit %d).\n' "$filter_exit" >&2
    exit 1
  fi

  # Success — extract allowlist count from PASSED:N
  local allowed_count=0
  if [[ -n "$status_token" ]]; then
    allowed_count="${status_token#PASSED:}"
  fi

  AUDIT_STATUS_LINE="Dependency audit: PASSED (allowlist ${allowed_count} entries)"
  return 0
}
