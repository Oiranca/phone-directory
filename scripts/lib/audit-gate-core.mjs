// @ts-check
// audit-gate-core.mjs — pure advisory-evaluation logic, extracted from audit-gate.sh.
//
// Exported API:
//   evaluateAudit(rawJsonString, allowlistEntries, pnpmExitCode)
//     → { exitCode: 0 | 2 | 3, stdout: string, stderr: string }
//
// Exit-code contract (identical to the old inline node -e script):
//   0  — no non-allowlisted high/critical advisories (PASSED:<N> written to stdout)
//   2  — non-allowlisted high/critical advisories found (printed to stderr)
//   3  — JSON is unparseable, payload is malformed, or infra/registry error
//
// CLI shim (when run directly):
//   node audit-gate-core.mjs <allowlist-path> <pnpm-exit-code>
//   Reads pnpm-audit JSON from stdin, writes stdout/stderr, exits with the code above.
//
// Note: the old inline node -e script received argv as:
//   argv[0] = "node", argv[1] = allowlist-path, argv[2] = pnpm-exit-code
// When invoked as a standalone file the argv shift is the same because node sets
// argv[1] to the script path — so argv[2] and argv[3] are the caller's args.

import { readFileSync } from "fs";
import { fileURLToPath } from "url";

// ---------------------------------------------------------------------------
// Pure evaluation function
// ---------------------------------------------------------------------------

/**
 * Evaluate a pnpm audit JSON payload against an allowlist.
 *
 * @param {string} rawJsonString     - The raw string from `pnpm audit --json`
 * @param {unknown} allowlistEntries - Parsed allowlist (expected: array from audit-allowlist.json)
 * @param {number|unknown} pnpmExitCode - The numeric exit code that pnpm itself produced
 * @returns {{ exitCode: 0 | 2 | 3, stdout: string, stderr: string }}
 */
export function evaluateAudit(rawJsonString, allowlistEntries, pnpmExitCode) {
  let out = "";
  let err = "";

  // --- parse JSON -----------------------------------------------------------
  let data;
  try {
    data = JSON.parse(rawJsonString);
  } catch (e) {
    err += "[audit-gate] Could not parse pnpm audit output as JSON — likely a network or registry error.\n";
    return { exitCode: 3, stdout: out, stderr: err };
  }

  // Guard: JSON.parse("null") succeeds but returns null, not an object.
  // Any non-object result is an infra error — never a clean pass.
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    err += "[audit-gate] pnpm audit output is not a JSON object (got: " +
      (data === null ? "null" : typeof data) +
      ") — likely a network or registry error.\n";
    return { exitCode: 3, stdout: out, stderr: err };
  }

  // --- require a positive success signal ------------------------------------
  // A real pnpm audit response must have EITHER:
  //   • data.advisories  (pnpm/npm v6 schema)
  //   • data.vulnerabilities  (npm v7+ schema)
  //   • data.metadata  (present on real v6 responses even when empty)
  // If NONE of those are present but data.error IS present, it is an error
  // envelope that JSON.parse accepted — treat it as infra error, not a pass.
  const hasAdvisories      = Object.prototype.hasOwnProperty.call(data, "advisories");
  const hasVulnerabilities = Object.prototype.hasOwnProperty.call(data, "vulnerabilities");
  const hasMetadata        = Object.prototype.hasOwnProperty.call(data, "metadata");
  const hasError           = Object.prototype.hasOwnProperty.call(data, "error");

  // Strict container type checks — the advisory container must be a PLAIN
  // OBJECT (not array, not string, not null). Any other shape is malformed.
  const advisoriesVal      = data.advisories;
  const vulnerabilitiesVal = data.vulnerabilities;
  const advisoriesIsPlainObj = hasAdvisories &&
    advisoriesVal !== null && typeof advisoriesVal === "object" && !Array.isArray(advisoriesVal);
  const vulnerabilitiesIsPlainObj = hasVulnerabilities &&
    vulnerabilitiesVal !== null && typeof vulnerabilitiesVal === "object" && !Array.isArray(vulnerabilitiesVal);

  // Reject if the key is present but is not a plain object.
  if (hasAdvisories && !advisoriesIsPlainObj) {
    err += "[audit-gate] pnpm audit response has advisories but it is not a plain object (got: " +
      (Array.isArray(advisoriesVal) ? "array" : typeof advisoriesVal) +
      ") — malformed or inconsistent payload.\n";
    return { exitCode: 3, stdout: out, stderr: err };
  }
  if (hasVulnerabilities && !vulnerabilitiesIsPlainObj) {
    err += "[audit-gate] pnpm audit response has vulnerabilities but it is not a plain object (got: " +
      (Array.isArray(vulnerabilitiesVal) ? "array" : typeof vulnerabilitiesVal) +
      ") — malformed or inconsistent payload.\n";
    return { exitCode: 3, stdout: out, stderr: err };
  }

  // Reject AMBIGUOUS/MIXED shapes: both advisory container keys present.
  // A real pnpm audit uses one schema or the other — never both.
  if (advisoriesIsPlainObj && vulnerabilitiesIsPlainObj) {
    err += "[audit-gate] pnpm audit response has BOTH advisories and vulnerabilities containers — " +
      "ambiguous schema, cannot safely evaluate.\n";
    return { exitCode: 3, stdout: out, stderr: err };
  }

  if (!hasAdvisories && !hasVulnerabilities && !hasMetadata) {
    // No recognisable advisory container — could be an error envelope or
    // totally unknown shape.  Either way it is not a confirmed clean audit.
    const detail = hasError
      ? "error code: " + (data.error && data.error.code ? data.error.code : JSON.stringify(data.error))
      : "unrecognised response shape";
    err += "[audit-gate] pnpm audit did not return a recognisable audit result (" + detail +
      ") — likely a network, lockfile, or registry error.\n";
    return { exitCode: 3, stdout: out, stderr: err };
  }

  // Require at least one advisory container key (advisories or vulnerabilities)
  // for any PASS.  A payload that has ONLY metadata is malformed:
  // real pnpm always emits an advisory container alongside metadata.
  if (!hasAdvisories && !hasVulnerabilities && hasMetadata) {
    err += "[audit-gate] pnpm audit response has metadata but no advisory container " +
      "(advisories or vulnerabilities) — malformed or inconsistent payload " +
      "(real pnpm always emits an advisory container alongside metadata).\n";
    return { exitCode: 3, stdout: out, stderr: err };
  }

  // For a PASS, require pnpm metadata: data.metadata.vulnerabilities must be a
  // plain object.  We apply this check early so that an empty advisories:{} +
  // pnpm exit 1 combo cannot sneak through as PASSED.
  if (advisoriesIsPlainObj && !hasVulnerabilities) {
    const mv = data.metadata ? data.metadata.vulnerabilities : undefined;
    if (mv === null || mv === undefined || typeof mv !== "object" || Array.isArray(mv)) {
      err += "[audit-gate] advisories container present but metadata.vulnerabilities missing/null — " +
        "inconsistent audit response (real pnpm always emits a vulnerabilities object in metadata).\n";
      return { exitCode: 3, stdout: out, stderr: err };
    }
  }

  // Mirror the same guard for the v7 schema.
  if (vulnerabilitiesIsPlainObj && !hasAdvisories) {
    const mv = data.metadata ? data.metadata.vulnerabilities : undefined;
    if (mv === null || mv === undefined || typeof mv !== "object" || Array.isArray(mv)) {
      err += "[audit-gate] vulnerabilities container present but metadata.vulnerabilities missing/null — " +
        "inconsistent audit response (real pnpm always emits a vulnerabilities object in metadata).\n";
      return { exitCode: 3, stdout: out, stderr: err };
    }
  }

  // --- validate the allowlist -----------------------------------------------
  const allowlist = allowlistEntries;

  // Allowlist top-level must be a JSON array.
  if (!Array.isArray(allowlist)) {
    err += "[audit-gate] Allowlist is not a JSON array " +
      "(got: " + (allowlist === null ? "null" : typeof allowlist) + ") — allowlist is malformed.\n";
    return { exitCode: 3, stdout: out, stderr: err };
  }

  // Validate allowlist schema and enforce expiry.
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const seenIds = new Set();
  for (let i = 0; i < allowlist.length; i++) {
    const entry = allowlist[i];
    const idx = "[allowlist entry " + i + "]";

    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      err += "[audit-gate] " + idx + " is not an object — allowlist is malformed.\n";
      return { exitCode: 3, stdout: out, stderr: err };
    }
    if (typeof entry.id !== "string" || entry.id.trim() === "") {
      err += "[audit-gate] " + idx + " missing or empty id field — allowlist is malformed.\n";
      return { exitCode: 3, stdout: out, stderr: err };
    }
    if (typeof entry.package !== "string" || entry.package.trim() === "") {
      err += "[audit-gate] " + idx + " (id: " + entry.id + ") missing or empty package field — allowlist is malformed.\n";
      return { exitCode: 3, stdout: out, stderr: err };
    }
    if (typeof entry.severity !== "string" || entry.severity.trim() === "") {
      err += "[audit-gate] " + idx + " (id: " + entry.id + ") missing or empty severity field — allowlist is malformed.\n";
      return { exitCode: 3, stdout: out, stderr: err };
    }
    // Allowlist entries may only suppress high/critical advisories.
    const normalizedEntrySev = entry.severity.trim().toLowerCase();
    if (normalizedEntrySev !== "high" && normalizedEntrySev !== "critical") {
      err += "[audit-gate] " + idx + " (id: " + entry.id + ") severity must be exactly \"high\" or \"critical\" " +
        "(got: \"" + entry.severity + "\") — allowlist is malformed.\n";
      return { exitCode: 3, stdout: out, stderr: err };
    }
    // Validate GHSA id format: GHSA-[4 alphanumeric]-[4 alphanumeric]-[4 alphanumeric].
    if (!/^GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}$/i.test(entry.id.trim())) {
      err += "[audit-gate] " + idx + " (id: " + entry.id + ") id does not match GHSA format " +
        "(expected: GHSA-xxxx-xxxx-xxxx) — allowlist is malformed.\n";
      return { exitCode: 3, stdout: out, stderr: err };
    }
    if (typeof entry.reason !== "string" || entry.reason.trim() === "") {
      err += "[audit-gate] " + idx + " (id: " + entry.id + ") missing or empty reason field — allowlist is malformed.\n";
      return { exitCode: 3, stdout: out, stderr: err };
    }
    if (typeof entry.expires !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(entry.expires.trim())) {
      err += "[audit-gate] " + idx + " (id: " + entry.id + ") missing or invalid expires field (required: YYYY-MM-DD) — allowlist is malformed.\n";
      return { exitCode: 3, stdout: out, stderr: err };
    }

    // Reject calendar-impossible dates (Invalid Date or roll-over).
    const _expiresRaw  = entry.expires.trim();
    const _expiresDate = new Date(_expiresRaw + "T00:00:00Z");
    if (isNaN(_expiresDate.getTime())) {
      err += "[audit-gate] " + idx + " (id: " + entry.id + ") expires value \"" + _expiresRaw +
        "\" is not a valid calendar date — allowlist is malformed.\n";
      return { exitCode: 3, stdout: out, stderr: err };
    }
    // Round-trip check: catches JS date roll-over (e.g. Feb 30 → Mar 2).
    const _parsedY = _expiresDate.getUTCFullYear();
    const _parsedM = _expiresDate.getUTCMonth() + 1; // getUTCMonth is 0-based
    const _parsedD = _expiresDate.getUTCDate();
    const [_inputY, _inputM, _inputD] = _expiresRaw.split("-").map(Number);
    if (_parsedY !== _inputY || _parsedM !== _inputM || _parsedD !== _inputD) {
      err += "[audit-gate] " + idx + " (id: " + entry.id + ") expires value \"" + _expiresRaw +
        "\" is not a valid calendar date (parsed date rolled over to " +
        _expiresDate.toISOString().slice(0, 10) + ") — allowlist is malformed.\n";
      return { exitCode: 3, stdout: out, stderr: err };
    }

    // Duplicate IDENTITY check — composite of GHSA id (lowercased) + package (NUL-separated).
    const _normalizedId  = entry.id.trim().toLowerCase();
    const _normalizedPkg = entry.package.trim();
    const _identityKey   = _normalizedId + "\x00" + _normalizedPkg;
    if (seenIds.has(_identityKey)) {
      err += "[audit-gate] Duplicate allowlist identity (id: " + entry.id +
        ", package: " + entry.package + ") — allowlist is malformed.\n";
      return { exitCode: 3, stdout: out, stderr: err };
    }
    seenIds.add(_identityKey);

    // Expiry check.
    if (today > _expiresDate) {
      err += "[audit-gate] Allowlist entry (id: " + entry.id + ") (package: " + entry.package +
        ") expired on " + entry.expires +
        " — review and either re-accept (update expires) or remediate before releasing.\n";
      return { exitCode: 3, stdout: out, stderr: err };
    }
  }

  // Build a Map from COMPOSITE identity "<ghsa>\x00<package>" → { sev }.
  // NUL separator prevents crafted ghsaId/package from colliding with a legitimate key.
  const allowedMap = new Map(
    allowlist.map(e => [
      e.id.trim().toLowerCase() + "\x00" + e.package.trim(),
      { sev: e.severity.trim().toLowerCase() }
    ])
  );
  const allowlistCount = allowlist.length;

  const failures = [];
  let iteratedHigh     = 0;
  let iteratedCritical = 0;
  // Count EVERY advisory entry observed, regardless of severity (info, low, moderate, high, critical).
  // Used to decide whether a non-zero pnpm exit is "trustworthy".
  let observedAdvisories = 0;

  // Documented pnpm audit severity enum values (all known severities).
  const KNOWN_SEVERITIES = new Set(["info", "low", "moderate", "high", "critical"]);

  // GHSA advisory ID format: GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}
  const GHSA_FORMAT_RE = /^ghsa-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}$/;

  // --- v6 schema: data.advisories -------------------------------------------
  if (advisoriesIsPlainObj) {
    const advisories = advisoriesVal;
    for (const [advKey, adv] of Object.entries(advisories)) {
      // Each advisory entry must be a plain object (not null / array / primitive).
      if (adv === null || typeof adv !== "object" || Array.isArray(adv)) {
        err += "[audit-gate] advisories[" + JSON.stringify(advKey) + "] is not a plain object " +
          "(got: " + (adv === null ? "null" : Array.isArray(adv) ? "array" : typeof adv) +
          ") — malformed advisory payload.\n";
        return { exitCode: 3, stdout: out, stderr: err };
      }
      // A valid advisory entry was observed (any severity).
      observedAdvisories++;
      // Severity must be a non-null string; normalise then validate against enum.
      if (typeof adv.severity !== "string") {
        err += "[audit-gate] advisories[" + JSON.stringify(advKey) + "] severity is not a string " +
          "(got: " + (adv.severity === null ? "null" : typeof adv.severity) +
          ") — malformed advisory payload.\n";
        return { exitCode: 3, stdout: out, stderr: err };
      }
      // Normalize: trim whitespace and lowercase before classifying.
      const sev = adv.severity.trim().toLowerCase();
      if (!KNOWN_SEVERITIES.has(sev)) {
        err += "[audit-gate] advisories[" + JSON.stringify(advKey) + "] has unknown severity " +
          JSON.stringify(adv.severity) + " — malformed advisory payload " +
          "(expected one of: info, low, moderate, high, critical).\n";
        return { exitCode: 3, stdout: out, stderr: err };
      }
      // Legitimately below threshold — skip without error.
      if (sev !== "high" && sev !== "critical") continue;
      if (sev === "high") iteratedHigh++; else iteratedCritical++;
      // Validate live ghsaId against canonical GHSA format before using as composite key.
      const _rawGhsa = (adv.github_advisory_id || "").trim().toLowerCase();
      const ghsa = GHSA_FORMAT_RE.test(_rawGhsa) ? _rawGhsa : "";
      // module_name MUST be a plain string — String() coercion would silently
      // accept an array (["tmp"] → "tmp") and allow suppression via allowlist.
      if (typeof adv.module_name !== "string") {
        err += "[audit-gate] advisories[" + JSON.stringify(advKey) + "] module_name is not a string " +
          "(got: " + (Array.isArray(adv.module_name) ? "array" : typeof adv.module_name) +
          ") — malformed advisory payload.\n";
        return { exitCode: 3, stdout: out, stderr: err };
      }
      const livePkg = adv.module_name.trim();
      // A finding with no GHSA ID must NOT be silently allowlisted.
      const _identityKey = ghsa + "\x00" + livePkg;
      if (ghsa && allowedMap.has(_identityKey)) {
        const allowEntry = allowedMap.get(_identityKey);
        if (allowEntry.sev === sev) continue;
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
        err += "[audit-gate] vulnerabilities[" + JSON.stringify(pkgName) + "] is not a plain object " +
          "(got: " + (vuln === null ? "null" : Array.isArray(vuln) ? "array" : typeof vuln) +
          ") — malformed advisory payload.\n";
        return { exitCode: 3, stdout: out, stderr: err };
      }
      // A valid vulnerability entry was observed (any severity).
      observedAdvisories++;
      // Severity must be a non-null string; normalise then validate against enum.
      if (typeof vuln.severity !== "string") {
        err += "[audit-gate] vulnerabilities[" + JSON.stringify(pkgName) + "] severity is not a string " +
          "(got: " + (vuln.severity === null ? "null" : typeof vuln.severity) +
          ") — malformed advisory payload.\n";
        return { exitCode: 3, stdout: out, stderr: err };
      }
      const sev = vuln.severity.trim().toLowerCase();
      if (!KNOWN_SEVERITIES.has(sev)) {
        err += "[audit-gate] vulnerabilities[" + JSON.stringify(pkgName) + "] has unknown severity " +
          JSON.stringify(vuln.severity) + " — malformed advisory payload " +
          "(expected one of: info, low, moderate, high, critical).\n";
        return { exitCode: 3, stdout: out, stderr: err };
      }
      // Legitimately below threshold — skip without error.
      if (sev !== "high" && sev !== "critical") continue;
      if (sev === "high") iteratedHigh++; else iteratedCritical++;

      // via must be an array, null, or undefined — any other type is malformed.
      if (vuln.via !== null && vuln.via !== undefined && !Array.isArray(vuln.via)) {
        err += "[audit-gate] vulnerabilities[" + JSON.stringify(pkgName) + "].via is not an array " +
          "(got: " + typeof vuln.via + ") — malformed advisory payload.\n";
        return { exitCode: 3, stdout: out, stderr: err };
      }
      const viaAdvisories = (vuln.via || []).filter(v => v && typeof v === "object");
      if (viaAdvisories.length === 0) {
        // No advisory objects in via — treat as no-GHSA failure (cannot allowlist).
        failures.push({ ghsa: "", severity: sev, package: pkgName, title: vuln.title || pkgName });
        continue;
      }

      // DECOUPLED CLASSIFICATION:
      //   • iteratedHigh/iteratedCritical counted PER NODE (vuln.severity = package-wide max)
      //     to reconcile against metadata, which buckets vulnerability NODES by their max severity.
      //   • Block/allowlist decision classifies EACH via advisory by its OWN severity.
      //
      // CONSISTENCY ASSERTION (severity-laundering prevention):
      //   In real npm/pnpm v7 output, vuln.severity is always the MAX of its via advisory
      //   severities. A payload where the node claims high/critical but ALL via objects carry
      //   only low/moderate is inconsistent — reject with exit 3.
      let _maxViaSev = "";
      for (const via of viaAdvisories) {
        // Classify by the via advisory OWN severity; fall back to node severity if absent.
        let viaSev;
        if (via.severity === undefined || via.severity === null) {
          viaSev = sev;
        } else {
          if (typeof via.severity !== "string") {
            err += "[audit-gate] vulnerabilities[" + JSON.stringify(pkgName) + "].via severity is not a string " +
              "(got: " + typeof via.severity + ") — malformed advisory payload.\n";
            return { exitCode: 3, stdout: out, stderr: err };
          }
          viaSev = via.severity.trim().toLowerCase();
          if (!KNOWN_SEVERITIES.has(viaSev)) {
            err += "[audit-gate] vulnerabilities[" + JSON.stringify(pkgName) + "].via has unknown severity " +
              JSON.stringify(via.severity) + " — malformed advisory payload " +
              "(expected one of: info, low, moderate, high, critical).\n";
            return { exitCode: 3, stdout: out, stderr: err };
          }
        }
        // Track max via severity for the consistency assertion below.
        const _SEV_RANK = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };
        if (_maxViaSev === "" || _SEV_RANK[viaSev] > _SEV_RANK[_maxViaSev]) {
          _maxViaSev = viaSev;
        }
        // Only high/critical via advisories can block (policy is high/critical-only).
        if (viaSev !== "high" && viaSev !== "critical") continue;

        // Validate live ghsaId against the canonical GHSA format.
        const _rawGhsa = (via.ghsaId || via.github_advisory_id || "").trim().toLowerCase();
        const ghsa = GHSA_FORMAT_RE.test(_rawGhsa) ? _rawGhsa : "";
        const livePkg = pkgName.trim();
        // A finding with no GHSA ID must NOT be silently allowlisted.
        const _identityKey = ghsa + "\x00" + livePkg;
        if (ghsa && allowedMap.has(_identityKey)) {
          const allowEntry = allowedMap.get(_identityKey);
          if (allowEntry.sev === viaSev) continue;
        }
        failures.push({ ghsa, severity: viaSev, package: pkgName, title: via.title || pkgName });
      }
      // Consistency assertion: node severity must be reachable by at least one via advisory.
      if (_maxViaSev !== "" && sev !== _maxViaSev) {
        const _SEV_RANK2 = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };
        if (_SEV_RANK2[sev] > _SEV_RANK2[_maxViaSev]) {
          err += "[audit-gate] vulnerabilities[" + JSON.stringify(pkgName) + "] node severity " +
            JSON.stringify(sev) + " exceeds max via advisory severity " +
            JSON.stringify(_maxViaSev) + " — payload is inconsistent (severity-laundering " +
            "or malformed registry response). Real npm/pnpm v7 node severity is always " +
            "the max of its via advisory severities.\n";
          return { exitCode: 3, stdout: out, stderr: err };
        }
      }
    }
  }

  // --- metadata reconciliation ----------------------------------------------
  // Cross-validate: if metadata.vulnerabilities reports high/critical counts
  // that exceed what we actually iterated, the response is inconsistent.
  // Strict integer validation: each present severity count must be a non-negative integer.
  if (hasMetadata && data.metadata && data.metadata.vulnerabilities) {
    const mv = data.metadata.vulnerabilities;
    const severityKeys = Object.keys(mv);
    for (const key of severityKeys) {
      const val = mv[key];
      if (typeof val !== "number" || !Number.isInteger(val) || val < 0) {
        err += "[audit-gate] metadata.vulnerabilities." + key + " is not a non-negative integer " +
          "(got: " + JSON.stringify(val) + ") — metadata is malformed.\n";
        return { exitCode: 3, stdout: out, stderr: err };
      }
    }
    // Require BOTH high and critical as own non-negative integer properties.
    if (!Object.prototype.hasOwnProperty.call(mv, "high")) {
      err += "[audit-gate] metadata.vulnerabilities.high is missing — " +
        "malformed metadata (real pnpm always emits both high and critical).\n";
      return { exitCode: 3, stdout: out, stderr: err };
    }
    if (!Object.prototype.hasOwnProperty.call(mv, "critical")) {
      err += "[audit-gate] metadata.vulnerabilities.critical is missing — " +
        "malformed metadata (real pnpm always emits both high and critical).\n";
      return { exitCode: 3, stdout: out, stderr: err };
    }
    const metaHigh     = mv.high;
    const metaCritical = mv.critical;
    // Require per-severity equality (not just combined totals).
    if (metaHigh !== iteratedHigh || metaCritical !== iteratedCritical) {
      err += "[audit-gate] Metadata severity counts (high:" + metaHigh + " critical:" + metaCritical + ") " +
        "do not match iterated advisory counts (high:" + iteratedHigh + " critical:" + iteratedCritical + ") — " +
        "response is inconsistent (truncated, duplicated, severity mismatch, or registry error).\n";
      return { exitCode: 3, stdout: out, stderr: err };
    }
  }

  // Belt-and-suspenders: when metadata is present but metadata.vulnerabilities
  // is absent, null, or not a plain object, the response is internally inconsistent.
  // Fire regardless of whether an advisory container key was present.
  // Do NOT fire when there are non-allowlisted failures (they follow exit 2 regardless).
  if (hasMetadata && failures.length === 0) {
    const mv = data.metadata ? data.metadata.vulnerabilities : undefined;
    if (mv === null || mv === undefined || typeof mv !== "object" || Array.isArray(mv)) {
      err += "[audit-gate] metadata present but metadata.vulnerabilities missing/null — " +
        "inconsistent audit response (real pnpm always emits a vulnerabilities object in metadata).\n";
      return { exitCode: 3, stdout: out, stderr: err };
    }
  }

  // --- non-zero pnpm exit with an EMPTY advisory container is an infra error -
  // Real pnpm exits non-zero ONLY when it found vulnerabilities.  A non-zero
  // exit is "trustworthy" (explained) when any advisory entry of any severity was observed.
  // The infra-error abort fires ONLY when pnpm exited non-zero AND the advisory
  // container was completely EMPTY (zero entries of any severity).
  //
  // pnpmExitCode MUST be a non-negative integer; anything else is a caller bug — fail closed.
  if (typeof pnpmExitCode !== "number" || !Number.isInteger(pnpmExitCode) || pnpmExitCode < 0) {
    err += "[audit-gate] Internal error: pnpm exit code argument (argv[3]) is missing or non-numeric " +
      "(got: " + JSON.stringify(pnpmExitCode) + ") — this is a bug in the gate caller.\n";
    return { exitCode: 3, stdout: out, stderr: err };
  }
  if (pnpmExitCode !== 0 && observedAdvisories === 0) {
    err += "[audit-gate] pnpm audit exited " + pnpmExitCode + " but no advisories of any severity were " +
      "observed in the advisory container — inconsistent result (infra/registry error).\n";
    return { exitCode: 3, stdout: out, stderr: err };
  }

  // --- result ---------------------------------------------------------------
  if (failures.length === 0) {
    out += "PASSED:" + allowlistCount + "\n";
    return { exitCode: 0, stdout: out, stderr: err };
  }

  for (const f of failures) {
    err += "[audit-gate] NON-ALLOWLISTED " + f.severity.toUpperCase() +
      ": " + f.package + " (" + (f.ghsa || "no GHSA") + ") — " + f.title + "\n";
  }
  return { exitCode: 2, stdout: out, stderr: err };
}

// ---------------------------------------------------------------------------
// CLI shim: run directly as `node audit-gate-core.mjs <allowlist-path> <pnpm-exit-code>`
//
// argv layout when run as a file:
//   process.argv[0] = node
//   process.argv[1] = /path/to/audit-gate-core.mjs
//   process.argv[2] = allowlist-path
//   process.argv[3] = pnpm-exit-code
//
// This matches the old inline node -e convention because that script used:
//   node -e "$_AUDIT_FILTER_SCRIPT" "$AUDIT_ALLOWLIST" "$pnpm_exit"
// where argv[0]=node, argv[1]=-e-script, argv[2]=allowlist, argv[3]=pnpm_exit.
// The shell caller in audit-gate.sh is updated to pass the same two arguments.
// ---------------------------------------------------------------------------

// Detect whether this module is being run directly (not imported).
// ESM does not have require.main; we compare the resolved file URL to process.argv[1].
let _isDirectRun = false;
try {
  _isDirectRun = process.argv[1] === fileURLToPath(import.meta.url);
} catch {
  // fileURLToPath may throw on some edge-case platforms; default to not running shim.
  _isDirectRun = false;
}

if (_isDirectRun) {
  const allowlistPath = process.argv[2];
  const pnpmExitArg   = process.argv[3];

  // Validate pnpm exit code argument before reading stdin.
  if (pnpmExitArg === undefined || pnpmExitArg === null || !/^\d+$/.test(pnpmExitArg)) {
    process.stderr.write(
      "[audit-gate] Internal error: pnpm exit code argument (argv[3]) is missing or non-numeric " +
      "(got: " + JSON.stringify(pnpmExitArg) + ") — this is a bug in the gate caller.\n"
    );
    process.exit(3);
  }
  const pnpmExitCode = parseInt(pnpmExitArg, 10);

  // Load allowlist from file.
  let allowlistEntries;
  try {
    allowlistEntries = JSON.parse(readFileSync(allowlistPath, "utf8"));
  } catch (e) {
    process.stderr.write("[audit-gate] Could not read allowlist at: " + allowlistPath + "\n");
    process.stderr.write(e.message + "\n");
    process.exit(1);
  }

  // Read pnpm-audit JSON from stdin.
  let raw = "";
  process.stdin.on("data", d => { raw += d; });
  process.stdin.on("end", () => {
    const result = evaluateAudit(raw, allowlistEntries, pnpmExitCode);
    if (result.stdout) process.stdout.write(result.stdout);
    if (result.stderr) process.stderr.write(result.stderr);
    process.exit(result.exitCode);
  });
}
