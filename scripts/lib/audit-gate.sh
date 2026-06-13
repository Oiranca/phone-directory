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

# Allow callers (and tests) to override the allowlist path via AUDIT_ALLOWLIST.
# If not already set, default to the standard location relative to REPO_ROOT.
AUDIT_ALLOWLIST="${AUDIT_ALLOWLIST:-$REPO_ROOT/scripts/audit-allowlist.json}"

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

  // Strict container type checks — the advisory container must be a PLAIN
  // OBJECT (not array, not string, not null).  Any other shape is a malformed
  // or inconsistent payload; we must never pass it silently.
  const advisoriesVal = data.advisories;
  const vulnerabilitiesVal = data.vulnerabilities;
  const advisoriesIsPlainObj = hasAdvisories &&
    advisoriesVal !== null && typeof advisoriesVal === "object" && !Array.isArray(advisoriesVal);
  const vulnerabilitiesIsPlainObj = hasVulnerabilities &&
    vulnerabilitiesVal !== null && typeof vulnerabilitiesVal === "object" && !Array.isArray(vulnerabilitiesVal);

  // Reject if the key is present but is not a plain object.
  if (hasAdvisories && !advisoriesIsPlainObj) {
    process.stderr.write(
      "[audit-gate] pnpm audit response has 'advisories' but it is not a plain object (got: " +
      (Array.isArray(advisoriesVal) ? "array" : typeof advisoriesVal) +
      ") — malformed or inconsistent payload.\n"
    );
    process.exit(3);
  }
  if (hasVulnerabilities && !vulnerabilitiesIsPlainObj) {
    process.stderr.write(
      "[audit-gate] pnpm audit response has 'vulnerabilities' but it is not a plain object (got: " +
      (Array.isArray(vulnerabilitiesVal) ? "array" : typeof vulnerabilitiesVal) +
      ") — malformed or inconsistent payload.\n"
    );
    process.exit(3);
  }

  // Reject AMBIGUOUS/MIXED shapes: both advisory container keys present.
  // A real pnpm audit uses one schema or the other — never both.
  if (advisoriesIsPlainObj && vulnerabilitiesIsPlainObj) {
    process.stderr.write(
      "[audit-gate] pnpm audit response has BOTH 'advisories' and 'vulnerabilities' containers — " +
      "ambiguous schema, cannot safely evaluate.\n"
    );
    process.exit(3);
  }

  if (!hasAdvisories && !hasVulnerabilities && !hasMetadata) {
    // No recognisable advisory container — could be an error envelope or
    // totally unknown shape.  Either way it is not a confirmed clean audit.
    const detail = hasError
      ? "error code: " + (data.error && data.error.code ? data.error.code : JSON.stringify(data.error))
      : "unrecognised response shape";
    process.stderr.write("[audit-gate] pnpm audit did not return a recognisable audit result (" + detail + ") — likely a network, lockfile, or registry error.\n");
    process.exit(3);
  }

  // For a PASS, require pnpm metadata: data.metadata.vulnerabilities must be a
  // plain object.  A real pnpm audit (both clean and with findings) always
  // emits it.  If the chosen advisory container is a valid empty object but
  // metadata.vulnerabilities is missing/null/non-object, the payload is
  // malformed — exit 3 so it can never silently pass.
  // We apply this check early (before iterating advisories) so that an empty
  // advisories:{} + pnpm exit 1 combo cannot sneak through as PASSED.
  if (advisoriesIsPlainObj && !hasVulnerabilities) {
    const mv = data.metadata ? data.metadata.vulnerabilities : undefined;
    if (mv === null || mv === undefined || typeof mv !== "object" || Array.isArray(mv)) {
      process.stderr.write(
        "[audit-gate] advisories container present but metadata.vulnerabilities missing/null — " +
        "inconsistent audit response (real pnpm always emits a vulnerabilities object in metadata).\n"
      );
      process.exit(3);
    }
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

  // Validate allowlist schema and enforce expiry.
  // Required fields: id (non-empty string), package, severity, reason, expires (YYYY-MM-DD).
  // Reject: malformed entries, duplicate GHSA ids, expired entries.
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const seenIds = new Set();
  for (let i = 0; i < allowlist.length; i++) {
    const entry = allowlist[i];
    const idx = "[allowlist entry " + i + "]";

    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      process.stderr.write("[audit-gate] " + idx + " is not an object — allowlist is malformed.\n");
      process.exit(3);
    }
    if (typeof entry.id !== "string" || entry.id.trim() === "") {
      process.stderr.write("[audit-gate] " + idx + " missing or empty 'id' field — allowlist is malformed.\n");
      process.exit(3);
    }
    if (typeof entry.package !== "string" || entry.package.trim() === "") {
      process.stderr.write("[audit-gate] " + idx + " (id: " + entry.id + ") missing or empty 'package' field — allowlist is malformed.\n");
      process.exit(3);
    }
    if (typeof entry.severity !== "string" || entry.severity.trim() === "") {
      process.stderr.write("[audit-gate] " + idx + " (id: " + entry.id + ") missing or empty 'severity' field — allowlist is malformed.\n");
      process.exit(3);
    }
    if (typeof entry.reason !== "string" || entry.reason.trim() === "") {
      process.stderr.write("[audit-gate] " + idx + " (id: " + entry.id + ") missing or empty 'reason' field — allowlist is malformed.\n");
      process.exit(3);
    }
    if (typeof entry.expires !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(entry.expires.trim())) {
      process.stderr.write("[audit-gate] " + idx + " (id: " + entry.id + ") missing or invalid 'expires' field (required: YYYY-MM-DD) — allowlist is malformed.\n");
      process.exit(3);
    }

    // Reject calendar-impossible dates that satisfy the regex but produce an
    // Invalid Date or silently roll over to a different month/day in JS.
    // Examples: "2026-13-40" → Invalid Date; "2026-02-30" → rolls to Mar 2.
    // We construct the date early here (before the expiry check) so that an
    // invalid date never reaches the `today > expiresDate` comparison, where
    // `NaN > anything` evaluates to false (i.e. silently treats the entry as
    // NOT expired, which is a fail-open).
    const _expiresRaw = entry.expires.trim();
    const _expiresDate = new Date(_expiresRaw + "T00:00:00Z");
    if (isNaN(_expiresDate.getTime())) {
      process.stderr.write(
        "[audit-gate] " + idx + " (id: " + entry.id + ") 'expires' value \"" + _expiresRaw +
        "\" is not a valid calendar date — allowlist is malformed.\n"
      );
      process.exit(3);
    }
    // Round-trip check: the parsed UTC year/month/day must equal the numbers
    // in the input string.  This catches JS date roll-over (e.g. Feb 30 → Mar 2).
    const _parsedY = _expiresDate.getUTCFullYear();
    const _parsedM = _expiresDate.getUTCMonth() + 1; // getUTCMonth is 0-based
    const _parsedD = _expiresDate.getUTCDate();
    const [_inputY, _inputM, _inputD] = _expiresRaw.split("-").map(Number);
    if (_parsedY !== _inputY || _parsedM !== _inputM || _parsedD !== _inputD) {
      process.stderr.write(
        "[audit-gate] " + idx + " (id: " + entry.id + ") 'expires' value \"" + _expiresRaw +
        "\" is not a valid calendar date (parsed date rolled over to " +
        _expiresDate.toISOString().slice(0, 10) + ") — allowlist is malformed.\n"
      );
      process.exit(3);
    }

    // Duplicate GHSA id check.
    if (seenIds.has(entry.id)) {
      process.stderr.write("[audit-gate] Duplicate GHSA id '" + entry.id + "' in allowlist — allowlist is malformed.\n");
      process.exit(3);
    }
    seenIds.add(entry.id);

    // Expiry check: current date > expires date → this entry is expired.
    // _expiresDate was validated above (not NaN, no roll-over); reuse it.
    const expiresDate = _expiresDate;
    if (today > expiresDate) {
      process.stderr.write(
        "[audit-gate] Allowlist entry '" + entry.id + "' (package: " + entry.package + ") expired on " +
        entry.expires + " — review and either re-accept (update expires) or remediate before releasing.\n"
      );
      process.exit(3);
    }
  }

  const allowedIds = new Set(allowlist.map(e => e.id));
  const allowlistCount = allowlist.length;

  const failures = [];
  let iteratedHighCrit = 0;

  // --- v6 schema: data.advisories -------------------------------------------
  if (advisoriesIsPlainObj) {
    const advisories = advisoriesVal;
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
  if (vulnerabilitiesIsPlainObj) {
    const vulns = vulnerabilitiesVal;
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

  // Belt-and-suspenders: when metadata is present but metadata.vulnerabilities
  // is absent, null, or not a plain object, the response is internally
  // inconsistent — real pnpm always emits a populated metadata.vulnerabilities
  // object (even on a fully clean tree it is an all-zeros object).
  // Fire regardless of whether an advisory container key was present, because
  // an empty advisories:{} alongside a null metadata.vulnerabilities is equally
  // malformed.  We do NOT fire when a non-empty advisory container was the
  // actual basis for a failure (failures.length > 0) — those follow exit 2
  // regardless, and the metadata state is irrelevant there.
  if (hasMetadata && failures.length === 0) {
    const mv = data.metadata ? data.metadata.vulnerabilities : undefined;
    if (mv === null || mv === undefined || typeof mv !== "object" || Array.isArray(mv)) {
      process.stderr.write(
        "[audit-gate] metadata present but metadata.vulnerabilities missing/null — " +
        "inconsistent audit response (real pnpm always emits a vulnerabilities object in metadata).\n"
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
    # Sanitize SKIP_AUDIT_REASON to prevent manifest injection.
    # A multiline or control-character value could inject fake manifest fields
    # (e.g. a second "Dependency audit: PASSED" line) into RELEASE_MANIFEST.txt.
    # Enforce: single line only (no \n or \r or other control chars), max 200 chars.
    local _reason_len="${#SKIP_AUDIT_REASON}"
    if [[ $_reason_len -gt 200 ]]; then
      printf '[audit-gate] ✗ SKIP_AUDIT_REASON exceeds 200 characters (%d). Provide a concise single-line reason.\n' "$_reason_len" >&2
      exit 1
    fi
    # Reject newlines and carriage returns using bash pattern matching (portable,
    # works on both GNU and macOS/BSD shells without relying on grep -P).
    if [[ "$SKIP_AUDIT_REASON" == *$'\n'* ]] || [[ "$SKIP_AUDIT_REASON" == *$'\r'* ]]; then
      printf '[audit-gate] ✗ SKIP_AUDIT_REASON contains newlines or carriage returns.\n' >&2
      printf '[audit-gate]   Provide a single-line reason (no newlines, no control characters).\n' >&2
      exit 1
    fi
    # Reject other control characters (0x00-0x1f, 0x7f) using tr — strip them and
    # compare length; any shrinkage means control chars were present.
    local _reason_stripped
    _reason_stripped="$(printf '%s' "$SKIP_AUDIT_REASON" | LC_ALL=C tr -d '\000-\037\177')"
    if [[ ${#_reason_stripped} -ne $_reason_len ]]; then
      printf '[audit-gate] ✗ SKIP_AUDIT_REASON contains control characters.\n' >&2
      printf '[audit-gate]   Provide a single-line reason (no newlines, no control characters).\n' >&2
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
