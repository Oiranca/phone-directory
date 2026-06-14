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

# Resolve the allowlist path from the gate script's own directory so that an
# operator cannot redirect the gate to an arbitrary allowlist by setting
# AUDIT_ALLOWLIST in the environment before invoking release-usb.sh.
#
# In normal (release) use the path is always fixed to:
#   <script_dir>/../audit-allowlist.json
#
# Test-only override: AUDIT_ALLOWLIST may be set to an alternate path ONLY when
# AUDIT_GATE_TEST_MODE=1 is also set.  The real release-usb.sh never sets
# AUDIT_GATE_TEST_MODE, so this bypass is unreachable from a production release.
_AUDIT_GATE_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ "${AUDIT_GATE_TEST_MODE:-0}" == "1" && -n "${AUDIT_ALLOWLIST:-}" ]]; then
  # Test mode: honour the caller-supplied override ONLY when it resolves to a
  # path inside the repo's scripts/ directory (i.e. inside _AUDIT_GATE_SCRIPT_DIR
  # itself).  Any path that resolves outside — including /tmp/... or absolute
  # paths in other trees — is silently ignored and the pinned repo allowlist is
  # used instead.  This closes the two-var attack
  #   AUDIT_GATE_TEST_MODE=1 AUDIT_ALLOWLIST=/tmp/evil.json pnpm run release:usb
  # even if the caller forgot to unset the sentinels.
  # _AUDIT_GATE_SCRIPT_DIR is scripts/lib/; the allowed scope is its parent
  # (scripts/), so test fixtures written anywhere under scripts/ are accepted.
  _AUDIT_SCRIPTS_DIR="$(cd "$_AUDIT_GATE_SCRIPT_DIR/.." && pwd)"
  # Canonicalize the PARENT DIR of the override (catches paths that escape via ..)
  _AUDIT_OVERRIDE_REAL="$(cd "$(dirname "${AUDIT_ALLOWLIST}")" 2>/dev/null && pwd)" || _AUDIT_OVERRIDE_REAL=""
  # Also canonicalize the FILE TARGET ITSELF (catches symlinks under scripts/ that
  # point outside — e.g. scripts/.test-x/al.json → /tmp/evil.json).
  # Portable realpath: try realpath(1), then python3 -c os.path.realpath, then
  # fall back to the parent-dir resolution (symlink escapes rejected by the
  # _AUDIT_OVERRIDE_FILE_REAL check below defaulting to "").
  _AUDIT_OVERRIDE_FILE_REAL=""
  if command -v realpath >/dev/null 2>&1; then
    _AUDIT_OVERRIDE_FILE_REAL="$(realpath "${AUDIT_ALLOWLIST}" 2>/dev/null)" || _AUDIT_OVERRIDE_FILE_REAL=""
  elif command -v python3 >/dev/null 2>&1; then
    _AUDIT_OVERRIDE_FILE_REAL="$(python3 -c "import os,sys; print(os.path.realpath(sys.argv[1]))" "${AUDIT_ALLOWLIST}" 2>/dev/null)" || _AUDIT_OVERRIDE_FILE_REAL=""
  fi
  # Derive the real parent dir of the resolved file path (if resolution succeeded).
  _AUDIT_OVERRIDE_FILE_DIR=""
  if [[ -n "$_AUDIT_OVERRIDE_FILE_REAL" ]]; then
    _AUDIT_OVERRIDE_FILE_DIR="$(dirname "$_AUDIT_OVERRIDE_FILE_REAL")"
  fi
  # Accept the override only when ALL of the following hold:
  #   1. The parent dir of the literal path is inside scripts/  (catches .. escapes)
  #   2. The real file target is also inside scripts/            (catches symlink escapes)
  #      OR realpath was not available (fall back to parent-dir check only)
  if [[ -n "$_AUDIT_OVERRIDE_REAL" && "$_AUDIT_OVERRIDE_REAL/" == "$_AUDIT_SCRIPTS_DIR/"* ]] && \
     { [[ -z "$_AUDIT_OVERRIDE_FILE_REAL" ]] || [[ "$_AUDIT_OVERRIDE_FILE_DIR/" == "$_AUDIT_SCRIPTS_DIR/"* ]]; }; then
    : # Override resolves inside scripts/ — honour it.
  else
    AUDIT_ALLOWLIST="$_AUDIT_GATE_SCRIPT_DIR/../audit-allowlist.json"
  fi
else
  # Production path (or test mode without an override): always use the
  # repo-relative allowlist, ignore any env value.
  AUDIT_ALLOWLIST="$_AUDIT_GATE_SCRIPT_DIR/../audit-allowlist.json"
fi

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
      "[audit-gate] pnpm audit response has advisories but it is not a plain object (got: " +
      (Array.isArray(advisoriesVal) ? "array" : typeof advisoriesVal) +
      ") — malformed or inconsistent payload.\n"
    );
    process.exit(3);
  }
  if (hasVulnerabilities && !vulnerabilitiesIsPlainObj) {
    process.stderr.write(
      "[audit-gate] pnpm audit response has vulnerabilities but it is not a plain object (got: " +
      (Array.isArray(vulnerabilitiesVal) ? "array" : typeof vulnerabilitiesVal) +
      ") — malformed or inconsistent payload.\n"
    );
    process.exit(3);
  }

  // Reject AMBIGUOUS/MIXED shapes: both advisory container keys present.
  // A real pnpm audit uses one schema or the other — never both.
  if (advisoriesIsPlainObj && vulnerabilitiesIsPlainObj) {
    process.stderr.write(
      "[audit-gate] pnpm audit response has BOTH advisories and vulnerabilities containers — " +
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

  // Require at least one advisory container key (advisories or vulnerabilities)
  // for any PASS.  A payload that has ONLY metadata (e.g.
  // {"metadata":{"vulnerabilities":{"high":0,"critical":0}}}) is malformed:
  // real pnpm always emits an advisory container alongside metadata.
  // Without this guard a metadata-only payload (all-zero counts) returns exit 0
  // even though no advisory container was parsed — a fail-open.
  if (!hasAdvisories && !hasVulnerabilities && hasMetadata) {
    process.stderr.write(
      "[audit-gate] pnpm audit response has metadata but no advisory container " +
      "(advisories or vulnerabilities) — malformed or inconsistent payload " +
      "(real pnpm always emits an advisory container alongside metadata).\n"
    );
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

  // Mirror the same guard for the v7 schema: when vulnerabilities is the chosen
  // advisory container, metadata.vulnerabilities must also be a plain object.
  // Real pnpm v7 always emits it; a v7 response lacking it is malformed.
  if (vulnerabilitiesIsPlainObj && !hasAdvisories) {
    const mv = data.metadata ? data.metadata.vulnerabilities : undefined;
    if (mv === null || mv === undefined || typeof mv !== "object" || Array.isArray(mv)) {
      process.stderr.write(
        "[audit-gate] vulnerabilities container present but metadata.vulnerabilities missing/null — " +
        "inconsistent audit response (real pnpm always emits a vulnerabilities object in metadata).\n"
      );
      process.exit(3);
    }
  }

  // --- load allowlist -------------------------------------------------------
  const allowlistPath = process.argv[1];
  let allowlist;
  try {
    allowlist = JSON.parse(fs.readFileSync(allowlistPath, "utf8"));
  } catch (e) {
    process.stderr.write("[audit-gate] Could not read allowlist at: " + allowlistPath + "\n");
    process.stderr.write(e.message + "\n");
    process.exit(1);
  }
  // Allowlist top-level must be a JSON array — null, objects, and primitives
  // would cause an uncontrolled TypeError at allowlist.length or the for-loop.
  if (!Array.isArray(allowlist)) {
    process.stderr.write(
      "[audit-gate] Allowlist at " + allowlistPath + " is not a JSON array " +
      "(got: " + (allowlist === null ? "null" : typeof allowlist) + ") — allowlist is malformed.\n"
    );
    process.exit(3);
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
      process.stderr.write("[audit-gate] " + idx + " missing or empty id field — allowlist is malformed.\n");
      process.exit(3);
    }
    if (typeof entry.package !== "string" || entry.package.trim() === "") {
      process.stderr.write("[audit-gate] " + idx + " (id: " + entry.id + ") missing or empty package field — allowlist is malformed.\n");
      process.exit(3);
    }
    if (typeof entry.severity !== "string" || entry.severity.trim() === "") {
      process.stderr.write("[audit-gate] " + idx + " (id: " + entry.id + ") missing or empty severity field — allowlist is malformed.\n");
      process.exit(3);
    }
    // Allowlist entries may only suppress high/critical advisories (those are
    // the only severities the gate acts on).  Any other value is a malformed
    // entry — reject it with exit 3 so a miscategorised entry cannot silently
    // suppress a real vulnerability.
    const normalizedEntrySev = entry.severity.trim().toLowerCase();
    if (normalizedEntrySev !== "high" && normalizedEntrySev !== "critical") {
      process.stderr.write(
        "[audit-gate] " + idx + " (id: " + entry.id + ") severity must be exactly \"high\" or \"critical\" " +
        "(got: \"" + entry.severity + "\") — allowlist is malformed.\n"
      );
      process.exit(3);
    }
    // Validate GHSA id format: must match GHSA-[4 alphanumeric]-[4 alphanumeric]-[4 alphanumeric].
    // This prevents free-form strings (e.g. "not-a-ghsa", CVE ids) from being
    // used as allowlist keys, which would make the id-matching logic meaningless.
    if (!/^GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}$/i.test(entry.id.trim())) {
      process.stderr.write(
        "[audit-gate] " + idx + " (id: " + entry.id + ") id does not match GHSA format " +
        "(expected: GHSA-xxxx-xxxx-xxxx) — allowlist is malformed.\n"
      );
      process.exit(3);
    }
    if (typeof entry.reason !== "string" || entry.reason.trim() === "") {
      process.stderr.write("[audit-gate] " + idx + " (id: " + entry.id + ") missing or empty reason field — allowlist is malformed.\n");
      process.exit(3);
    }
    if (typeof entry.expires !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(entry.expires.trim())) {
      process.stderr.write("[audit-gate] " + idx + " (id: " + entry.id + ") missing or invalid expires field (required: YYYY-MM-DD) — allowlist is malformed.\n");
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
        "[audit-gate] " + idx + " (id: " + entry.id + ") expires value \"" + _expiresRaw +
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
        "[audit-gate] " + idx + " (id: " + entry.id + ") expires value \"" + _expiresRaw +
        "\" is not a valid calendar date (parsed date rolled over to " +
        _expiresDate.toISOString().slice(0, 10) + ") — allowlist is malformed.\n"
      );
      process.exit(3);
    }

    // Duplicate GHSA id check.
    if (seenIds.has(entry.id)) {
      process.stderr.write("[audit-gate] Duplicate GHSA id (id: " + entry.id + ") in allowlist — allowlist is malformed.\n");
      process.exit(3);
    }
    seenIds.add(entry.id);

    // Expiry check: current date > expires date → this entry is expired.
    // _expiresDate was validated above (not NaN, no roll-over); reuse it.
    const expiresDate = _expiresDate;
    if (today > expiresDate) {
      process.stderr.write(
        "[audit-gate] Allowlist entry (id: " + entry.id + ") (package: " + entry.package + ") expired on " +
        entry.expires + " — review and either re-accept (update expires) or remediate before releasing.\n"
      );
      process.exit(3);
    }
  }

  // Build a Map from GHSA id → { package, severity } so that suppression
  // requires all three fields to match (id AND package AND severity).
  // A Set of ids alone would let a bogus allowlist entry (wrong package or
  // severity) silently suppress a live advisory with the same GHSA id.
  // Key is lowercased so advisory GHSA ids in any case (GHSA-xxxx vs ghsa-xxxx)
  // match allowlist entries regardless of capitalisation differences.
  const allowedMap = new Map(
    allowlist.map(e => [e.id.trim().toLowerCase(), { pkg: e.package.trim(), sev: e.severity.trim().toLowerCase() }])
  );
  const allowlistCount = allowlist.length;

  const failures = [];
  let iteratedHigh     = 0;
  let iteratedCritical = 0;

  // Documented pnpm audit severity enum values (all known severities).
  // Any advisory whose normalised severity is not in this set is malformed —
  // we must abort rather than silently skip, to prevent a typo like "critcal"
  // from being treated as below-threshold and letting a critical advisory pass.
  const KNOWN_SEVERITIES = new Set(["info", "low", "moderate", "high", "critical"]);

  // --- v6 schema: data.advisories -------------------------------------------
  if (advisoriesIsPlainObj) {
    const advisories = advisoriesVal;
    for (const [advKey, adv] of Object.entries(advisories)) {
      // Each advisory entry must be a plain object (not null / array / primitive).
      if (adv === null || typeof adv !== "object" || Array.isArray(adv)) {
        process.stderr.write(
          "[audit-gate] advisories[" + JSON.stringify(advKey) + "] is not a plain object " +
          "(got: " + (adv === null ? "null" : Array.isArray(adv) ? "array" : typeof adv) +
          ") — malformed advisory payload.\n"
        );
        process.exit(3);
      }
      // Severity must be a non-null string; normalise then validate against enum.
      if (typeof adv.severity !== "string") {
        process.stderr.write(
          "[audit-gate] advisories[" + JSON.stringify(advKey) + "] severity is not a string " +
          "(got: " + (adv.severity === null ? "null" : typeof adv.severity) +
          ") — malformed advisory payload.\n"
        );
        process.exit(3);
      }
      // Normalize: trim whitespace and lowercase before classifying.
      // This ensures "critical " (trailing space) or "CRITICAL" are correctly
      // counted and not silently dropped as unrecognised severity values.
      const sev = adv.severity.trim().toLowerCase();
      if (!KNOWN_SEVERITIES.has(sev)) {
        process.stderr.write(
          "[audit-gate] advisories[" + JSON.stringify(advKey) + "] has unknown severity " +
          JSON.stringify(adv.severity) + " — malformed advisory payload " +
          "(expected one of: info, low, moderate, high, critical).\n"
        );
        process.exit(3);
      }
      // Legitimately below threshold — skip without error.
      if (sev !== "high" && sev !== "critical") continue;
      if (sev === "high") iteratedHigh++; else iteratedCritical++;
      const ghsa = (adv.github_advisory_id || "").trim().toLowerCase();
      // module_name MUST be a plain string — String() coercion would silently
      // accept an array (["tmp"] → "tmp") and allow suppression via allowlist.
      if (typeof adv.module_name !== "string") {
        process.stderr.write(
          "[audit-gate] advisories[" + JSON.stringify(advKey) + "] module_name is not a string " +
          "(got: " + (Array.isArray(adv.module_name) ? "array" : typeof adv.module_name) +
          ") — malformed advisory payload.\n"
        );
        process.exit(3);
      }
      const livePkg = adv.module_name.trim();
      // A finding with no GHSA ID must NOT be silently allowlisted — it counts
      // as a failure because we cannot confirm its identity.
      // When a GHSA id IS present, suppression requires the allowlist entry to
      // also match on package name AND severity (not just the id).
      // GHSA id comparison is case-insensitive (allowedMap keys are lowercased).
      if (ghsa && allowedMap.has(ghsa)) {
        const entry = allowedMap.get(ghsa);
        if (entry.pkg === livePkg && entry.sev === sev) continue;
      }
      failures.push({ ghsa, severity: sev, package: adv.module_name, title: adv.title });
    }
  }

  // --- v7 schema: data.vulnerabilities --------------------------------------
  if (vulnerabilitiesIsPlainObj) {
    const vulns = vulnerabilitiesVal;
    for (const [pkgName, vuln] of Object.entries(vulns)) {
      // Each vulnerability entry must be a plain object.
      if (vuln === null || typeof vuln !== "object" || Array.isArray(vuln)) {
        process.stderr.write(
          "[audit-gate] vulnerabilities[" + JSON.stringify(pkgName) + "] is not a plain object " +
          "(got: " + (vuln === null ? "null" : Array.isArray(vuln) ? "array" : typeof vuln) +
          ") — malformed advisory payload.\n"
        );
        process.exit(3);
      }
      // Severity must be a non-null string; normalise then validate against enum.
      if (typeof vuln.severity !== "string") {
        process.stderr.write(
          "[audit-gate] vulnerabilities[" + JSON.stringify(pkgName) + "] severity is not a string " +
          "(got: " + (vuln.severity === null ? "null" : typeof vuln.severity) +
          ") — malformed advisory payload.\n"
        );
        process.exit(3);
      }
      const sev = vuln.severity.trim().toLowerCase();
      if (!KNOWN_SEVERITIES.has(sev)) {
        process.stderr.write(
          "[audit-gate] vulnerabilities[" + JSON.stringify(pkgName) + "] has unknown severity " +
          JSON.stringify(vuln.severity) + " — malformed advisory payload " +
          "(expected one of: info, low, moderate, high, critical).\n"
        );
        process.exit(3);
      }
      // Legitimately below threshold — skip without error.
      if (sev !== "high" && sev !== "critical") continue;
      if (sev === "high") iteratedHigh++; else iteratedCritical++;

      // Extract GHSA IDs from the "via" array (may contain string dep-names or
      // advisory objects with a ghsaId field).
      // via must be an array, null, or undefined — any other type (object, string,
      // number, boolean) is a malformed payload and must exit 3, not silently
      // be treated as empty (which would suppress the advisory as no-GHSA).
      if (vuln.via !== null && vuln.via !== undefined && !Array.isArray(vuln.via)) {
        process.stderr.write(
          "[audit-gate] vulnerabilities[" + JSON.stringify(pkgName) + "].via is not an array " +
          "(got: " + typeof vuln.via + ") — malformed advisory payload.\n"
        );
        process.exit(3);
      }
      const viaAdvisories = (vuln.via || []).filter(v => v && typeof v === "object");
      if (viaAdvisories.length === 0) {
        // No advisory objects in via — treat as no-GHSA failure (cannot allowlist).
        failures.push({ ghsa: "", severity: sev, package: pkgName, title: vuln.title || pkgName });
        continue;
      }

      for (const via of viaAdvisories) {
        // Normalize ghsa id to lowercase for case-insensitive allowlist lookup.
        const ghsa = (via.ghsaId || via.github_advisory_id || "").trim().toLowerCase();
        // pkgName is the v7 outer key (always a string — object key cannot be non-string).
        const livePkg = pkgName.trim();
        // A finding with no GHSA ID must NOT be silently allowlisted.
        // When a GHSA id IS present, suppression requires id + package + severity to match.
        // GHSA id comparison is case-insensitive (allowedMap keys are lowercased).
        if (ghsa && allowedMap.has(ghsa)) {
          const entry = allowedMap.get(ghsa);
          if (entry.pkg === livePkg && entry.sev === sev) continue;
        }
        failures.push({ ghsa, severity: sev, package: pkgName, title: via.title || pkgName });
      }
    }
  }

  // --- metadata reconciliation ----------------------------------------------
  // Cross-validate: if metadata.vulnerabilities reports high/critical counts
  // that exceed what we actually iterated from the advisory container, the
  // response is inconsistent (truncated, partially parsed, or malformed).
  // This closes the fail-open where metadata alone acts as a success signal.
  //
  // Strict integer validation: each present severity count in
  // metadata.vulnerabilities must be a non-negative integer.  Coercing a
  // string count with (|| 0) silently does string concatenation in arithmetic
  // contexts ("0" + "0" === "00"), which breaks the per-severity equality
  // check and allows the reconciliation check to be bypassed.
  if (hasMetadata && data.metadata && data.metadata.vulnerabilities) {
    const mv = data.metadata.vulnerabilities;
    const severityKeys = Object.keys(mv);
    for (const key of severityKeys) {
      const val = mv[key];
      if (typeof val !== "number" || !Number.isInteger(val) || val < 0) {
        process.stderr.write(
          "[audit-gate] metadata.vulnerabilities." + key + " is not a non-negative integer " +
          "(got: " + JSON.stringify(val) + ") — metadata is malformed.\n"
        );
        process.exit(3);
      }
    }
    // Require BOTH high and critical as own non-negative integer properties.
    // Defaulting an absent key to 0 would allow a payload that omits "high"
    // entirely to pass reconciliation — a missing key is a malformed payload.
    if (!Object.prototype.hasOwnProperty.call(mv, "high")) {
      process.stderr.write(
        "[audit-gate] metadata.vulnerabilities.high is missing — " +
        "malformed metadata (real pnpm always emits both high and critical).\n"
      );
      process.exit(3);
    }
    if (!Object.prototype.hasOwnProperty.call(mv, "critical")) {
      process.stderr.write(
        "[audit-gate] metadata.vulnerabilities.critical is missing — " +
        "malformed metadata (real pnpm always emits both high and critical).\n"
      );
      process.exit(3);
    }
    // Now safe to use integer arithmetic (no coercion needed — values validated above).
    const metaHigh     = mv.high;
    const metaCritical = mv.critical;
    // Require per-severity equality (not just combined totals).
    // A swapped-severity payload — e.g. an allowlisted critical advisory with
    // metadata reporting {high:1, critical:0} — has the same combined total (1)
    // but is internally inconsistent and must be rejected.
    if (metaHigh !== iteratedHigh || metaCritical !== iteratedCritical) {
      process.stderr.write(
        "[audit-gate] Metadata severity counts (high:" + metaHigh + " critical:" + metaCritical + ") " +
        "do not match iterated advisory counts (high:" + iteratedHigh + " critical:" + iteratedCritical + ") — " +
        "response is inconsistent (truncated, duplicated, severity mismatch, or registry error).\n"
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

  // --- non-zero pnpm exit with zero advisories is an infra error ------------
  // Real pnpm exits non-zero ONLY when it found vulnerabilities.  If pnpm
  // exited non-zero but we observed ZERO advisory objects in the container
  // (empty advisories:{} or empty vulnerabilities:{}), the payload is
  // structurally inconsistent — treat as an infra/registry error.
  // When pnpm exited non-zero AND we DID observe advisories (including fully
  // allowlisted ones), that is the expected behavior — continue normal logic.
  const pnpmExitCode = parseInt(process.argv[2], 10) || 0;
  if (pnpmExitCode !== 0 && failures.length === 0 && iteratedHigh === 0 && iteratedCritical === 0) {
    process.stderr.write(
      "[audit-gate] pnpm audit exited " + pnpmExitCode + " but no high/critical advisories were " +
      "observed in the advisory container — inconsistent result (infra/registry error).\n"
    );
    process.exit(3);
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

    # Trim leading and trailing whitespace (spaces and tabs) from the reason.
    # A whitespace-only reason is semantically empty and must be rejected — it
    # would produce a meaningless trace in the release manifest (e.g. "reason:    ").
    local _reason_trimmed
    _reason_trimmed="$(printf '%s' "${SKIP_AUDIT_REASON}" | LC_ALL=C sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
    if [[ -z "$_reason_trimmed" ]]; then
      printf '[audit-gate] ✗ SKIP_AUDIT_REASON is empty or whitespace-only.\n' >&2
      printf '[audit-gate]   Bypass requires a meaningful non-empty reason. Set SKIP_AUDIT_REASON="<why>" and re-run.\n' >&2
      exit 1
    fi

    local _reason_len="${#_reason_trimmed}"
    if [[ $_reason_len -gt 200 ]]; then
      printf '[audit-gate] ✗ SKIP_AUDIT_REASON exceeds 200 characters (%d). Provide a concise single-line reason.\n' "$_reason_len" >&2
      exit 1
    fi
    # Reject newlines and carriage returns using bash pattern matching (portable,
    # works on both GNU and macOS/BSD shells without relying on grep -P).
    if [[ "$_reason_trimmed" == *$'\n'* ]] || [[ "$_reason_trimmed" == *$'\r'* ]]; then
      printf '[audit-gate] ✗ SKIP_AUDIT_REASON contains newlines or carriage returns.\n' >&2
      printf '[audit-gate]   Provide a single-line reason (no newlines, no control characters).\n' >&2
      exit 1
    fi
    # Reject other control characters (0x00-0x1f, 0x7f) using tr — strip them and
    # compare length; any shrinkage means control chars were present.
    local _reason_stripped
    _reason_stripped="$(printf '%s' "$_reason_trimmed" | LC_ALL=C tr -d '\000-\037\177')"
    if [[ ${#_reason_stripped} -ne $_reason_len ]]; then
      printf '[audit-gate] ✗ SKIP_AUDIT_REASON contains control characters.\n' >&2
      printf '[audit-gate]   Provide a single-line reason (no newlines, no control characters).\n' >&2
      exit 1
    fi
    # Reject non-ASCII bytes (0x80–0xff) — this covers Unicode line separators
    # (U+2028 LINE SEPARATOR, U+2029 PARAGRAPH SEPARATOR, U+0085 NEL) whose
    # UTF-8 encodings are multi-byte sequences that pass the \n/\r and
    # tr '\000-\037\177' checks above.  A Unicode-aware manifest parser or
    # viewer could treat these codepoints as line breaks, allowing a spoofed
    # "Dependency audit: PASSED" line to be injected into RELEASE_MANIFEST.txt.
    # Enforce ASCII-only: strip all bytes > 0x7f and reject if anything is removed.
    local _reason_ascii
    _reason_ascii="$(printf '%s' "$_reason_trimmed" | LC_ALL=C tr -d '\200-\377')"
    if [[ ${#_reason_ascii} -ne $_reason_len ]]; then
      printf '[audit-gate] ✗ SKIP_AUDIT_REASON contains non-ASCII characters (including possible Unicode line separators).\n' >&2
      printf '[audit-gate]   Provide an ASCII-only single-line reason.\n' >&2
      exit 1
    fi
    printf '[audit-gate] ⚠️  SKIP_AUDIT=1 — dependency audit bypassed\n' >&2
    printf '[audit-gate]    Reason: %s\n' "$_reason_trimmed" >&2
    AUDIT_STATUS_LINE="Dependency audit: BYPASSED — reason: ${_reason_trimmed}"
    return 0
  fi

  # Run pnpm audit and capture JSON stdout; capture stderr separately so we can
  # echo it to the operator when the gate aborts on an infra error.
  #
  # Temp-file cleanup: we install function-scoped EXIT/INT/TERM traps that save
  # and restore any pre-existing traps set by the caller (this file is sourced
  # into release-usb.sh which may have its own traps).  The temp file is always
  # cleaned up before each exit/return path AND on interruption.
  local audit_json
  local pnpm_stderr
  local pnpm_exit=0
  local _pnpm_stderr_file
  _pnpm_stderr_file="$(mktemp)"

  # Save caller's traps (may be empty strings if none set).
  # Also decode the handler BODY from each saved trap string at save time, so
  # signal handlers can invoke it directly without re-parsing at signal time.
  #
  # `trap -p INT` format:
  #   macOS bash 3.2: "trap -- 'BODY' SIGINT"  (SIG-prefixed name)
  #   Linux bash 4/5: "trap -- 'BODY' INT"      (bare name, no SIG prefix)
  #
  # The body word uses shell quoting — embedded single quotes appear as '\''
  # (close-quote, literal apostrophe, reopen-quote).  We must NOT strip those
  # surrounding quotes via sed: that would leave a broken '\'' sequence that
  # causes eval to hit an "unexpected EOF" error, which || true silently swallows
  # — the caller's handler body would never run.
  #
  # Correct approach (three steps):
  #   1. Strip the "trap -- " prefix, leaving the shell-quoted body word(s)
  #      followed by a space and the signal name token.
  #   2. Strip the trailing " <SIGNAME>" token (last whitespace-delimited word).
  #      The BRE \(SIG\)\{0,1\}[A-Z][A-Z]* matches both SIGINT and INT.
  #   3. eval-assign the REMAINING QUOTED word into a plain variable — bash
  #      decodes the shell quoting (including '\'') into the raw body text.
  #
  # If no handler was set, trap -p emits nothing → all steps produce "" → the
  # :-true fallback in eval "${_prev_body_INT:-true}" makes it a no-op.
  local _prev_trap_EXIT _prev_trap_INT _prev_trap_TERM
  local _prev_body_INT _prev_body_TERM
  _prev_trap_EXIT="$(trap -p EXIT  2>/dev/null || true)"
  _prev_trap_INT="$( trap -p INT   2>/dev/null || true)"
  _prev_trap_TERM="$(trap -p TERM  2>/dev/null || true)"

  # Decode INT body: strip prefix, strip trailing signal-name token, eval-assign.
  if [[ -n "${_prev_trap_INT}" ]]; then
    local _int_rest _int_quoted
    _int_rest="${_prev_trap_INT#trap -- }"
    _int_quoted="$(printf '%s' "${_int_rest}" | sed "s/ \(SIG\)\{0,1\}[A-Z][A-Z]*$//" 2>/dev/null || true)"
    eval "_prev_body_INT=${_int_quoted}" 2>/dev/null || _prev_body_INT=""
  else
    _prev_body_INT=""
  fi

  # Decode TERM body: same approach.
  if [[ -n "${_prev_trap_TERM}" ]]; then
    local _term_rest _term_quoted
    _term_rest="${_prev_trap_TERM#trap -- }"
    _term_quoted="$(printf '%s' "${_term_rest}" | sed "s/ \(SIG\)\{0,1\}[A-Z][A-Z]*$//" 2>/dev/null || true)"
    eval "_prev_body_TERM=${_term_quoted}" 2>/dev/null || _prev_body_TERM=""
  else
    _prev_body_TERM=""
  fi

  # Install cleanup traps.
  #
  # EXIT trap: removes the temp file on any normal exit from the function
  # (belt-and-suspenders for paths where rm -f below might not be reached).
  # It restores all three of the caller's original traps before returning so
  # that the caller's own EXIT handler is not clobbered on the normal path.
  _audit_gate_cleanup_exit() {
    rm -f "$_pnpm_stderr_file" 2>/dev/null || true
    trap - EXIT INT TERM
    eval "${_prev_trap_EXIT:-true}" 2>/dev/null || true
    eval "${_prev_trap_INT:-true}"  2>/dev/null || true
    eval "${_prev_trap_TERM:-true}" 2>/dev/null || true
  }
  trap '_audit_gate_cleanup_exit' EXIT

  # INT/TERM signal handlers.
  #
  # Design: invoke the caller's handler BODY inline (directly, not via re-raise)
  # so it runs regardless of whether it exits or returns normally.  After the
  # body runs (or if there was no body), we always force-exit with the
  # signal-correct status (130 for INT, 143 for TERM).  This ensures:
  #   a) any pre-existing caller cleanup/handler executes, AND
  #   b) continuation past run_audit_gate is impossible even when the caller's
  #      handler returns normally without calling exit.
  #
  # Why inline instead of re-raise (kill -SIG $$)?
  # Bash masks a signal while its own handler for that signal is running, so
  # kill -INT $$ from within _audit_gate_signal_INT queues rather than delivers
  # the signal immediately.  When our handler subsequently calls exit 130, the
  # process terminates before the queued signal is delivered — the caller's
  # handler never runs.  Invoking the body directly avoids this masking.
  _audit_gate_signal_INT() {
    rm -f "$_pnpm_stderr_file" 2>/dev/null || true
    trap - EXIT INT TERM
    eval "${_prev_trap_EXIT:-true}" 2>/dev/null || true
    eval "${_prev_trap_TERM:-true}" 2>/dev/null || true
    # Run the caller's INT handler body inline (no-op if caller had none).
    eval "${_prev_body_INT:-true}" 2>/dev/null || true
    # Always terminate with signal-correct status; the caller cannot continue.
    exit 130
  }
  _audit_gate_signal_TERM() {
    rm -f "$_pnpm_stderr_file" 2>/dev/null || true
    trap - EXIT INT TERM
    eval "${_prev_trap_EXIT:-true}" 2>/dev/null || true
    eval "${_prev_trap_INT:-true}"  2>/dev/null || true
    # Run the caller's TERM handler body inline (no-op if caller had none).
    eval "${_prev_body_TERM:-true}" 2>/dev/null || true
    # Always terminate with signal-correct status; the caller cannot continue.
    exit 143
  }
  trap '_audit_gate_signal_INT'  INT
  trap '_audit_gate_signal_TERM' TERM

  audit_json="$(pnpm audit --json 2>"$_pnpm_stderr_file")" || pnpm_exit=$?
  pnpm_stderr="$(cat "$_pnpm_stderr_file")"

  # Remove the temp file immediately now that we have captured its contents.
  # The EXIT trap is a belt-and-suspenders for the interruption path.
  rm -f "$_pnpm_stderr_file"
  trap - EXIT INT TERM
  eval "${_prev_trap_EXIT:-true}"  2>/dev/null || true
  eval "${_prev_trap_INT:-true}"   2>/dev/null || true
  eval "${_prev_trap_TERM:-true}"  2>/dev/null || true

  # Feed JSON through the Node filter.
  # Pass pnpm_exit as a second CLI arg so the filter can detect the
  # structurally-clean-but-non-zero case (non-zero+empty advisory container).
  local filter_output
  local filter_exit=0
  filter_output="$(printf '%s' "$audit_json" | node -e "$_AUDIT_FILTER_SCRIPT" "$AUDIT_ALLOWLIST" "$pnpm_exit" 2>&1)" || filter_exit=$?

  # Separate stderr lines (errors) from the PASSED:N stdout token
  # Node writes advisory failures to stderr and PASSED:N to stdout.
  # Because we captured stderr+stdout together with 2>&1, parse them out.
  local status_token
  local error_lines
  status_token="$(printf '%s' "$filter_output" | grep '^PASSED:' | head -1)" || true
  error_lines="$(printf '%s' "$filter_output" | grep -v '^PASSED:')" || true

  # Belt-and-suspenders: if the filter exited 0 but produced no PASSED token,
  # the output is unrecognisable — treat as infra error regardless of pnpm_exit.
  if [[ $filter_exit -eq 0 && -z "$status_token" ]]; then
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
