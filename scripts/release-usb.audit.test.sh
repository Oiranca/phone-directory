#!/usr/bin/env bash
# release-usb.audit.test.sh — isolated stubbed-pnpm tests for the audit gate
#
# Run standalone:
#   bash scripts/release-usb.audit.test.sh
#
# All tests use a fake 'pnpm' on PATH that emits canned JSON/exit codes.
# The real pnpm binary is never invoked.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GATE_SCRIPT="$REPO_ROOT/scripts/lib/audit-gate.sh"
ALLOWLIST="$REPO_ROOT/scripts/audit-allowlist.json"

# --- test infrastructure -------------------------------------------------------

PASS_COUNT=0
FAIL_COUNT=0
FAILURES=()

pass() { PASS_COUNT=$((PASS_COUNT + 1)); printf '  PASS: %s\n' "$1"; }
fail() { FAIL_COUNT=$((FAIL_COUNT + 1)); FAILURES+=("$1"); printf '  FAIL: %s\n' "$1"; }

assert_exit_0() {
  local desc="$1"; shift
  if env "$@" 2>/dev/null; then
    pass "$desc"
  else
    fail "$desc (expected exit 0, got $?)"
  fi
}

assert_exit_nonzero() {
  local desc="$1"; shift
  local rc=0
  env "$@" 2>/dev/null || rc=$?
  if [[ $rc -ne 0 ]]; then
    pass "$desc"
  else
    fail "$desc (expected non-zero exit, got 0)"
  fi
}

assert_stderr_contains() {
  local desc="$1"
  local pattern="$2"
  shift 2
  local stderr_out
  stderr_out="$(env "$@" 2>&1 >/dev/null)" || true
  if printf '%s' "$stderr_out" | grep -qF "$pattern"; then
    pass "$desc"
  else
    fail "$desc (expected stderr to contain: $pattern)"
    printf '    actual stderr: %s\n' "$stderr_out"
  fi
}

# Build a temporary directory with a fake pnpm on PATH
setup_fake_pnpm() {
  local tmpdir
  tmpdir="$(mktemp -d)"
  printf '%s' "$tmpdir"
}

write_fake_pnpm() {
  local bindir="$1"
  local json_output="$2"
  local exit_code="${3:-0}"
  cat > "$bindir/pnpm" <<STUB
#!/usr/bin/env bash
# Fake pnpm for audit gate tests
if [[ "\${1:-}" == "audit" ]]; then
  printf '%s' '${json_output}'
  exit ${exit_code}
fi
# Pass through any other pnpm commands (unused in gate tests)
exec pnpm-real "\$@"
STUB
  chmod +x "$bindir/pnpm"
}

# JSON payloads used across tests

# No advisories at all
CLEAN_JSON='{"actions":[],"advisories":{},"muted":[],"metadata":{"vulnerabilities":{"info":0,"low":0,"moderate":0,"high":0,"critical":0},"dependencies":584}}'

# Only advisories that ARE in the allowlist (shell-quote critical, tmp high, esbuild high)
ALLOWLISTED_JSON='{"actions":[],"advisories":{"1":{"findings":[],"id":1,"severity":"critical","module_name":"shell-quote","title":"shell-quote vuln","github_advisory_id":"GHSA-w7jw-789q-3m8p","vulnerable_versions":"<=1.8.3","cves":["CVE-2026-9277"]},"2":{"findings":[],"id":2,"severity":"high","module_name":"tmp","title":"tmp vuln","github_advisory_id":"GHSA-ph9p-34f9-6g65","vulnerable_versions":"<0.2.6","cves":["CVE-2026-44705"]},"3":{"findings":[],"id":3,"severity":"high","module_name":"esbuild","title":"esbuild vuln","github_advisory_id":"GHSA-gv7w-rqvm-qjhr","vulnerable_versions":"<0.28.1","cves":[]}},"muted":[],"metadata":{"vulnerabilities":{"high":2,"critical":1},"dependencies":584}}'

# A brand-new non-allowlisted critical advisory
NEW_CRITICAL_JSON='{"actions":[],"advisories":{"99":{"findings":[],"id":99,"severity":"critical","module_name":"some-pkg","title":"New unknown critical","github_advisory_id":"GHSA-zzzz-zzzz-zzzz","vulnerable_versions":"<1.0.0","cves":[]}},"muted":[],"metadata":{"vulnerabilities":{"critical":1},"dependencies":584}}'

# Non-allowlisted high advisory
NEW_HIGH_JSON='{"actions":[],"advisories":{"100":{"findings":[],"id":100,"severity":"high","module_name":"some-other-pkg","title":"New unknown high","github_advisory_id":"GHSA-aaaa-aaaa-aaaa","vulnerable_versions":"<2.0.0","cves":[]}},"muted":[],"metadata":{"vulnerabilities":{"high":1},"dependencies":584}}'

# Unparseable output simulates infra/registry error
INFRA_ERROR_OUTPUT='Error: ECONNREFUSED connect ECONNREFUSED 127.0.0.1:4873'

# run_gate_in_subshell <bindir> [extra env vars...]
# Sources the gate and calls run_audit_gate; returns its exit code.
run_gate_in_subshell() {
  local bindir="$1"; shift
  env PATH="$bindir:$PATH" REPO_ROOT="$REPO_ROOT" "$@" bash -c "
    set -euo pipefail
    source '$GATE_SCRIPT'
    AUDIT_STATUS_LINE=''
    run_audit_gate
    printf '%s\n' \"\$AUDIT_STATUS_LINE\"
  "
}

# --- tests ---------------------------------------------------------------------

printf '\nAudit gate tests\n'
printf '================\n\n'

# Test 1: Clean — no advisories at all → gate passes
printf 'Test 1: No advisories → gate passes\n'
TMP1="$(setup_fake_pnpm)"
write_fake_pnpm "$TMP1" "$CLEAN_JSON" 0
if out="$(run_gate_in_subshell "$TMP1" 2>/dev/null)"; then
  if printf '%s' "$out" | grep -q 'PASSED'; then
    pass "clean audit passes and reports PASSED status"
  else
    fail "clean audit passes but status line missing 'PASSED': $out"
  fi
else
  fail "clean audit exited non-zero (expected pass)"
fi
rm -rf "$TMP1"

# Test 2: Non-allowlisted advisory → non-zero exit; tests/build NOT executed
printf '\nTest 2: Non-allowlisted critical advisory → gate aborts\n'
TMP2="$(setup_fake_pnpm)"
write_fake_pnpm "$TMP2" "$NEW_CRITICAL_JSON" 1
rc=0
run_gate_in_subshell "$TMP2" 2>/dev/null || rc=$?
if [[ $rc -ne 0 ]]; then
  pass "non-allowlisted critical advisory causes non-zero exit"
else
  fail "non-allowlisted critical advisory did not abort (exit was 0)"
fi

# Also verify advisory failure message on stderr
stderr_out="$(env PATH="$TMP2:$PATH" REPO_ROOT="$REPO_ROOT" bash -c "
  source '$GATE_SCRIPT'
  AUDIT_STATUS_LINE=''
  run_audit_gate
" 2>&1 >/dev/null)" || true
if printf '%s' "$stderr_out" | grep -q 'NON-ALLOWLISTED'; then
  pass "non-allowlisted advisory prints NON-ALLOWLISTED message"
else
  fail "non-allowlisted advisory missing NON-ALLOWLISTED in stderr: $stderr_out"
fi

# Verify the advisory failure message does NOT say "infra" / "network"
if printf '%s' "$stderr_out" | grep -q 'non-advisory error'; then
  fail "advisory failure wrongly printed infra-error message"
else
  pass "advisory failure does not print infra-error message"
fi
rm -rf "$TMP2"

# Test 3: Only allowlisted advisories → gate passes
printf '\nTest 3: Allowlisted-only advisories → gate passes\n'
TMP3="$(setup_fake_pnpm)"
write_fake_pnpm "$TMP3" "$ALLOWLISTED_JSON" 1
if out="$(run_gate_in_subshell "$TMP3" 2>/dev/null)"; then
  if printf '%s' "$out" | grep -q 'PASSED'; then
    pass "all-allowlisted advisories pass the gate"
  else
    fail "all-allowlisted audit passed but status line missing 'PASSED': $out"
  fi
else
  fail "all-allowlisted audit exited non-zero (expected pass)"
fi
rm -rf "$TMP3"

# Test 4: Registry/network infra failure → fails safe with generic infra message
printf '\nTest 4: Registry/network infra error → fails safe with infra message\n'
TMP4="$(setup_fake_pnpm)"
# Emit unparseable text (not JSON) and non-zero exit
write_fake_pnpm "$TMP4" "$INFRA_ERROR_OUTPUT" 1
rc=0
stderr_out="$(env PATH="$TMP4:$PATH" REPO_ROOT="$REPO_ROOT" bash -c "
  source '$GATE_SCRIPT'
  AUDIT_STATUS_LINE=''
  run_audit_gate
" 2>&1 >/dev/null)" || rc=$?
if [[ $rc -ne 0 ]]; then
  pass "infra error causes non-zero exit (safe-fail)"
else
  fail "infra error did not cause non-zero exit"
fi
if printf '%s' "$stderr_out" | grep -q 'non-advisory error'; then
  pass "infra error prints generic non-advisory-error message"
else
  fail "infra error missing 'non-advisory error' in stderr: $stderr_out"
fi
if printf '%s' "$stderr_out" | grep -q 'NON-ALLOWLISTED'; then
  fail "infra error wrongly printed NON-ALLOWLISTED advisory message"
else
  pass "infra error does not print NON-ALLOWLISTED message"
fi
rm -rf "$TMP4"

# Test 5a: SKIP_AUDIT=1 without SKIP_AUDIT_REASON → aborts
printf '\nTest 5a: SKIP_AUDIT=1 without reason → aborts\n'
TMP5a="$(setup_fake_pnpm)"
write_fake_pnpm "$TMP5a" "$CLEAN_JSON" 0
rc=0
stderr_out="$(env PATH="$TMP5a:$PATH" REPO_ROOT="$REPO_ROOT" SKIP_AUDIT=1 SKIP_AUDIT_REASON="" bash -c "
  source '$GATE_SCRIPT'
  AUDIT_STATUS_LINE=''
  run_audit_gate
" 2>&1 >/dev/null)" || rc=$?
if [[ $rc -ne 0 ]]; then
  pass "SKIP_AUDIT=1 without reason aborts with non-zero exit"
else
  fail "SKIP_AUDIT=1 without reason did not abort"
fi
if printf '%s' "$stderr_out" | grep -q 'SKIP_AUDIT_REASON'; then
  pass "SKIP_AUDIT=1 without reason prints SKIP_AUDIT_REASON guidance"
else
  fail "SKIP_AUDIT=1 without reason missing guidance in stderr: $stderr_out"
fi
rm -rf "$TMP5a"

# Test 5b: SKIP_AUDIT=1 with SKIP_AUDIT_REASON → bypasses and records in status
printf '\nTest 5b: SKIP_AUDIT=1 with reason → bypasses, sets status line\n'
TMP5b="$(setup_fake_pnpm)"
write_fake_pnpm "$TMP5b" "$NEW_CRITICAL_JSON" 1
if out="$(env PATH="$TMP5b:$PATH" REPO_ROOT="$REPO_ROOT" SKIP_AUDIT=1 SKIP_AUDIT_REASON="accepted per SECURITY.md" bash -c "
  source '$GATE_SCRIPT'
  AUDIT_STATUS_LINE=''
  run_audit_gate
  printf '%s' \"\$AUDIT_STATUS_LINE\"
" 2>/dev/null)"; then
  pass "SKIP_AUDIT=1 with reason exits 0"
  if printf '%s' "$out" | grep -q 'BYPASSED'; then
    pass "bypass records BYPASSED in status line"
  else
    fail "bypass status line missing 'BYPASSED': $out"
  fi
  if printf '%s' "$out" | grep -q 'accepted per SECURITY.md'; then
    pass "bypass status line includes the provided reason"
  else
    fail "bypass status line missing reason text: $out"
  fi
else
  fail "SKIP_AUDIT=1 with reason exited non-zero"
fi
rm -rf "$TMP5b"

# Test 6: SKIP_AUDIT=true / yes / 2 → gate still runs (strict == "1")
printf '\nTest 6: SKIP_AUDIT=true/yes/2 → gate still runs (non-"1" values ignored)\n'
TMP6="$(setup_fake_pnpm)"
write_fake_pnpm "$TMP6" "$ALLOWLISTED_JSON" 1   # only allowlisted → should pass
for val in "true" "yes" "2" "TRUE"; do
  if out="$(env PATH="$TMP6:$PATH" REPO_ROOT="$REPO_ROOT" SKIP_AUDIT="$val" bash -c "
    source '$GATE_SCRIPT'
    AUDIT_STATUS_LINE=''
    run_audit_gate
    printf '%s' \"\$AUDIT_STATUS_LINE\"
  " 2>/dev/null)"; then
    if printf '%s' "$out" | grep -q 'PASSED'; then
      pass "SKIP_AUDIT=$val → gate runs and passes (allowlisted advisories)"
    else
      fail "SKIP_AUDIT=$val → gate ran but status line unexpected: $out"
    fi
  else
    fail "SKIP_AUDIT=$val → gate exited non-zero (should have run and passed)"
  fi
done
rm -rf "$TMP6"

# --- new edge-case tests (fail-open bug coverage) ------------------------------

# JSON payloads for new tests

# Valid-JSON pnpm error envelope (EAUDITNOLOCK) — no advisory container at all
ERROR_ENVELOPE_JSON='{"error":{"code":"EAUDITNOLOCK"}}'

# npm v7 vulnerabilities schema — non-allowlisted critical
VULN_SCHEMA_CRITICAL_JSON='{"vulnerabilities":{"some-pkg":{"name":"some-pkg","severity":"critical","via":[{"ghsaId":"GHSA-zzzz-zzzz-zzzz","title":"Bad pkg vuln","severity":"critical"}],"effects":[],"range":"*","nodes":[],"fixAvailable":false}}}'

# npm v7 vulnerabilities schema — only allowlisted advisories (all three from allowlist)
VULN_SCHEMA_ALLOWLISTED_JSON='{"vulnerabilities":{"shell-quote":{"name":"shell-quote","severity":"critical","via":[{"ghsaId":"GHSA-w7jw-789q-3m8p","title":"shell-quote vuln","severity":"critical"}],"effects":[],"range":"*","nodes":[],"fixAvailable":false},"esbuild":{"name":"esbuild","severity":"high","via":[{"ghsaId":"GHSA-gv7w-rqvm-qjhr","title":"esbuild vuln","severity":"high"}],"effects":[],"range":"*","nodes":[],"fixAvailable":false}}}'

# Test 7: Valid-JSON error envelope with non-zero pnpm exit → gate ABORTS (infra path)
printf '\nTest 7: Valid-JSON error envelope (EAUDITNOLOCK) + non-zero exit → aborts safe\n'
TMP7="$(setup_fake_pnpm)"
write_fake_pnpm "$TMP7" "$ERROR_ENVELOPE_JSON" 1
rc=0
stderr_out="$(env PATH="$TMP7:$PATH" REPO_ROOT="$REPO_ROOT" bash -c "
  source '$GATE_SCRIPT'
  AUDIT_STATUS_LINE=''
  run_audit_gate
" 2>&1 >/dev/null)" || rc=$?
if [[ $rc -ne 0 ]]; then
  pass "valid-JSON error envelope causes non-zero exit (not a silent pass)"
else
  fail "valid-JSON error envelope was silently passed (exit 0) — fail-open bug"
fi
if printf '%s' "$stderr_out" | grep -q 'non-advisory error'; then
  pass "valid-JSON error envelope triggers infra-error message"
else
  fail "valid-JSON error envelope missing infra-error message in stderr: $stderr_out"
fi
if printf '%s' "$stderr_out" | grep -q 'PASSED'; then
  fail "valid-JSON error envelope wrongly emitted PASSED"
else
  pass "valid-JSON error envelope does not emit PASSED"
fi
rm -rf "$TMP7"

# Test 8: vulnerabilities-keyed schema with non-allowlisted critical → gate ABORTS
printf '\nTest 8: npm v7 vulnerabilities schema — non-allowlisted critical → aborts\n'
TMP8="$(setup_fake_pnpm)"
write_fake_pnpm "$TMP8" "$VULN_SCHEMA_CRITICAL_JSON" 1
rc=0
stderr_out="$(env PATH="$TMP8:$PATH" REPO_ROOT="$REPO_ROOT" bash -c "
  source '$GATE_SCRIPT'
  AUDIT_STATUS_LINE=''
  run_audit_gate
" 2>&1 >/dev/null)" || rc=$?
if [[ $rc -ne 0 ]]; then
  pass "vulnerabilities-schema non-allowlisted critical causes non-zero exit"
else
  fail "vulnerabilities-schema non-allowlisted critical was silently passed — fail-open bug"
fi
if printf '%s' "$stderr_out" | grep -q 'NON-ALLOWLISTED'; then
  pass "vulnerabilities-schema prints NON-ALLOWLISTED message"
else
  fail "vulnerabilities-schema missing NON-ALLOWLISTED message: $stderr_out"
fi
rm -rf "$TMP8"

# Test 9: vulnerabilities-keyed schema with only allowlisted advisories → passes
printf '\nTest 9: npm v7 vulnerabilities schema — allowlisted-only advisories → passes\n'
TMP9="$(setup_fake_pnpm)"
write_fake_pnpm "$TMP9" "$VULN_SCHEMA_ALLOWLISTED_JSON" 1
if out="$(run_gate_in_subshell "$TMP9" 2>/dev/null)"; then
  if printf '%s' "$out" | grep -q 'PASSED'; then
    pass "vulnerabilities-schema allowlisted-only advisories pass the gate"
  else
    fail "vulnerabilities-schema allowlisted audit passed but status line missing 'PASSED': $out"
  fi
else
  fail "vulnerabilities-schema allowlisted-only audit exited non-zero (expected pass)"
fi
rm -rf "$TMP9"

# Test 10: bare null output → aborts safely with infra message (no crash / TypeError)
printf '\nTest 10: bare null JSON output → aborts safely (no unhandled error)\n'
TMP10="$(setup_fake_pnpm)"
write_fake_pnpm "$TMP10" "null" 0
rc=0
stderr_out="$(env PATH="$TMP10:$PATH" REPO_ROOT="$REPO_ROOT" bash -c "
  source '$GATE_SCRIPT'
  AUDIT_STATUS_LINE=''
  run_audit_gate
" 2>&1 >/dev/null)" || rc=$?
if [[ $rc -ne 0 ]]; then
  pass "null JSON output causes non-zero exit"
else
  fail "null JSON output was silently passed or did not abort"
fi
if printf '%s' "$stderr_out" | grep -qi 'typeerror\|cannot read propert'; then
  fail "null JSON output produced an unhandled TypeError: $stderr_out"
else
  pass "null JSON output does not produce an unhandled TypeError"
fi
if printf '%s' "$stderr_out" | grep -q 'non-advisory error'; then
  pass "null JSON output triggers infra-error message"
else
  fail "null JSON output missing infra-error message: $stderr_out"
fi
rm -rf "$TMP10"

# Test 11: non-zero pnpm exit + empty stdout → aborts (no silent pass)
printf '\nTest 11: non-zero pnpm exit + empty stdout → aborts\n'
TMP11="$(setup_fake_pnpm)"
write_fake_pnpm "$TMP11" "" 1
rc=0
stderr_out="$(env PATH="$TMP11:$PATH" REPO_ROOT="$REPO_ROOT" bash -c "
  source '$GATE_SCRIPT'
  AUDIT_STATUS_LINE=''
  run_audit_gate
" 2>&1 >/dev/null)" || rc=$?
if [[ $rc -ne 0 ]]; then
  pass "non-zero pnpm exit + empty output causes non-zero gate exit"
else
  fail "non-zero pnpm exit + empty output was silently passed — fail-open bug"
fi
rm -rf "$TMP11"

# --- metadata reconciliation tests (residual fail-open coverage) --------------

# Test 12: metadata reports high/critical but NO advisory container at all → ABORTS (exit 3)
printf '\nTest 12: metadata reports critical:5 high:3 but no advisories key → ABORTS (exit 3)\n'
META_ONLY_JSON='{"metadata":{"vulnerabilities":{"critical":5,"high":3}}}'
TMP12="$(setup_fake_pnpm)"
write_fake_pnpm "$TMP12" "$META_ONLY_JSON" 0
rc=0
stderr_out="$(env PATH="$TMP12:$PATH" REPO_ROOT="$REPO_ROOT" bash -c "
  source '$GATE_SCRIPT'
  AUDIT_STATUS_LINE=''
  run_audit_gate
" 2>&1 >/dev/null)" || rc=$?
if [[ $rc -ne 0 ]]; then
  pass "metadata-only with critical:5 high:3 causes non-zero exit (not a silent pass)"
else
  fail "metadata-only with critical:5 high:3 was silently passed — fail-open bug"
fi
if printf '%s' "$stderr_out" | grep -q 'inconsistent'; then
  pass "metadata-only inconsistency prints reconciliation error message"
else
  fail "metadata-only inconsistency missing reconciliation message in stderr: $stderr_out"
fi
rm -rf "$TMP12"

# Test 13: metadata reports critical:5 but advisories container is empty → ABORTS (exit 3)
printf '\nTest 13: advisories:{} but metadata reports critical:5 → ABORTS (exit 3)\n'
EMPTY_ADVISORIES_META_CRIT_JSON='{"advisories":{},"metadata":{"vulnerabilities":{"critical":5}}}'
TMP13="$(setup_fake_pnpm)"
write_fake_pnpm "$TMP13" "$EMPTY_ADVISORIES_META_CRIT_JSON" 0
rc=0
stderr_out="$(env PATH="$TMP13:$PATH" REPO_ROOT="$REPO_ROOT" bash -c "
  source '$GATE_SCRIPT'
  AUDIT_STATUS_LINE=''
  run_audit_gate
" 2>&1 >/dev/null)" || rc=$?
if [[ $rc -ne 0 ]]; then
  pass "empty advisories + metadata critical:5 causes non-zero exit"
else
  fail "empty advisories + metadata critical:5 was silently passed — fail-open bug"
fi
if printf '%s' "$stderr_out" | grep -q 'inconsistent'; then
  pass "empty advisories + metadata inconsistency prints reconciliation error"
else
  fail "empty advisories + metadata inconsistency missing reconciliation message: $stderr_out"
fi
rm -rf "$TMP13"

# Test 14: all-allowlisted advisories with matching metadata counts → PASSES
# Allowlist has: GHSA-w7jw-789q-3m8p (critical), GHSA-ph9p-34f9-6g65 (high), GHSA-gv7w-rqvm-qjhr (high)
# metadata critical:1 high:2 — matches iteratedHighCrit=3, reconciliation consistent, allowlist clears all
printf '\nTest 14: allowlisted advisories with matching metadata counts → PASSES\n'
TMP14="$(setup_fake_pnpm)"
write_fake_pnpm "$TMP14" "$ALLOWLISTED_JSON" 1
if out="$(run_gate_in_subshell "$TMP14" 2>/dev/null)"; then
  if printf '%s' "$out" | grep -q 'PASSED'; then
    pass "all-allowlisted with matching metadata counts passes gate"
  else
    fail "all-allowlisted with matching metadata passed but status line missing 'PASSED': $out"
  fi
else
  fail "all-allowlisted with matching metadata exited non-zero (expected pass)"
fi
rm -rf "$TMP14"

# Test 15: genuinely clean audit — metadata all zeros, empty advisories → PASSES
printf '\nTest 15: genuinely clean audit (metadata all zeros, empty advisories) → PASSES\n'
CLEAN_META_JSON='{"advisories":{},"metadata":{"vulnerabilities":{"info":0,"low":0,"moderate":0,"high":0,"critical":0}}}'
TMP15="$(setup_fake_pnpm)"
write_fake_pnpm "$TMP15" "$CLEAN_META_JSON" 0
if out="$(run_gate_in_subshell "$TMP15" 2>/dev/null)"; then
  if printf '%s' "$out" | grep -q 'PASSED'; then
    pass "genuinely clean audit (all-zero metadata, empty advisories) passes gate"
  else
    fail "genuinely clean audit passed but status line missing 'PASSED': $out"
  fi
else
  fail "genuinely clean audit exited non-zero (expected pass)"
fi
rm -rf "$TMP15"

# --- present-but-empty metadata.vulnerabilities guard (belt-and-suspenders) ---

# Test 16: metadata present, vulnerabilities key absent, no advisories → ABORTS (exit 3)
printf '\nTest 16: {"metadata":{}} with no advisories → ABORTS (exit 3)\n'
META_NO_VULNS_JSON='{"metadata":{}}'
TMP16="$(setup_fake_pnpm)"
write_fake_pnpm "$TMP16" "$META_NO_VULNS_JSON" 0
rc=0
stderr_out="$(env PATH="$TMP16:$PATH" REPO_ROOT="$REPO_ROOT" bash -c "
  source '$GATE_SCRIPT'
  AUDIT_STATUS_LINE=''
  run_audit_gate
" 2>&1 >/dev/null)" || rc=$?
if [[ $rc -ne 0 ]]; then
  pass "metadata present, vulnerabilities absent, no advisories → aborts (exit 3)"
else
  fail "metadata present, vulnerabilities absent, no advisories → silently passed (fail-open bug)"
fi
if printf '%s' "$stderr_out" | grep -q 'metadata present but metadata.vulnerabilities missing/null'; then
  pass "metadata-only with absent vulnerabilities prints expected error message"
else
  fail "metadata-only with absent vulnerabilities missing expected message in stderr: $stderr_out"
fi
rm -rf "$TMP16"

# Test 17: advisories:{} present with metadata.vulnerabilities:null → ABORTS (exit 3)
printf '\nTest 17: {"advisories":{},"metadata":{"vulnerabilities":null}} → ABORTS (exit 3)\n'
ADVISORIES_META_NULL_JSON='{"advisories":{},"metadata":{"vulnerabilities":null}}'
TMP17="$(setup_fake_pnpm)"
write_fake_pnpm "$TMP17" "$ADVISORIES_META_NULL_JSON" 0
rc=0
stderr_out="$(env PATH="$TMP17:$PATH" REPO_ROOT="$REPO_ROOT" bash -c "
  source '$GATE_SCRIPT'
  AUDIT_STATUS_LINE=''
  run_audit_gate
" 2>&1 >/dev/null)" || rc=$?
if [[ $rc -ne 0 ]]; then
  pass "advisories:{} with metadata.vulnerabilities:null → aborts (exit 3)"
else
  fail "advisories:{} with metadata.vulnerabilities:null → silently passed (fail-open bug)"
fi
if printf '%s' "$stderr_out" | grep -q 'inconsistent'; then
  pass "advisories:{} + metadata.vulnerabilities:null prints inconsistency message"
else
  fail "advisories:{} + metadata.vulnerabilities:null missing inconsistency message in stderr: $stderr_out"
fi
rm -rf "$TMP17"

# Test 18: genuine clean — metadata.vulnerabilities all zeros → PASSES (do not regress)
printf '\nTest 18: genuine clean {"advisories":{},"metadata":{"vulnerabilities":{"info":0,...}}} → PASSES\n'
GENUINE_CLEAN_JSON='{"advisories":{},"metadata":{"vulnerabilities":{"info":0,"low":0,"moderate":0,"high":0,"critical":0}}}'
TMP18="$(setup_fake_pnpm)"
write_fake_pnpm "$TMP18" "$GENUINE_CLEAN_JSON" 0
if out="$(run_gate_in_subshell "$TMP18" 2>/dev/null)"; then
  if printf '%s' "$out" | grep -q 'PASSED'; then
    pass "genuine clean audit with all-zero metadata.vulnerabilities still passes gate"
  else
    fail "genuine clean audit passed but status line missing 'PASSED': $out"
  fi
else
  fail "genuine clean audit exited non-zero — regression: all-zero metadata.vulnerabilities was rejected"
fi
rm -rf "$TMP18"

# --- strict schema validation tests (Fix A — fail-open regression coverage) ---

# Test 19: advisories is an ARRAY → ABORTS (exit 3), never PASSED
printf '\nTest 19: {"advisories":[]} (array, not object) → ABORTS (exit 3)\n'
ADVISORIES_ARRAY_JSON='{"advisories":[],"metadata":{"vulnerabilities":{"info":0,"low":0,"moderate":0,"high":0,"critical":0}}}'
TMP19="$(setup_fake_pnpm)"
write_fake_pnpm "$TMP19" "$ADVISORIES_ARRAY_JSON" 0
rc=0
stderr_out="$(env PATH="$TMP19:$PATH" REPO_ROOT="$REPO_ROOT" bash -c "
  source '$GATE_SCRIPT'
  AUDIT_STATUS_LINE=''
  run_audit_gate
" 2>&1 >/dev/null)" || rc=$?
if [[ $rc -ne 0 ]]; then
  pass "advisories:[] (array) → aborts (exit 3), not passed"
else
  fail "advisories:[] (array) → silently passed — fail-open bug"
fi
if printf '%s' "$stderr_out" | grep -q 'not a plain object'; then
  pass "advisories:[] prints 'not a plain object' message"
else
  fail "advisories:[] missing 'not a plain object' message in stderr: $stderr_out"
fi
rm -rf "$TMP19"

# Test 20: advisories is a STRING → ABORTS (exit 3), never PASSED
printf '\nTest 20: {"advisories":"corrupt"} (string) → ABORTS (exit 3)\n'
ADVISORIES_STRING_JSON='{"advisories":"corrupt","metadata":{"vulnerabilities":{"info":0,"low":0,"moderate":0,"high":0,"critical":0}}}'
TMP20="$(setup_fake_pnpm)"
write_fake_pnpm "$TMP20" "$ADVISORIES_STRING_JSON" 0
rc=0
stderr_out="$(env PATH="$TMP20:$PATH" REPO_ROOT="$REPO_ROOT" bash -c "
  source '$GATE_SCRIPT'
  AUDIT_STATUS_LINE=''
  run_audit_gate
" 2>&1 >/dev/null)" || rc=$?
if [[ $rc -ne 0 ]]; then
  pass "advisories:\"corrupt\" (string) → aborts (exit 3), not passed"
else
  fail "advisories:\"corrupt\" (string) → silently passed — fail-open bug"
fi
if printf '%s' "$stderr_out" | grep -q 'not a plain object'; then
  pass "advisories:\"corrupt\" prints 'not a plain object' message"
else
  fail "advisories:\"corrupt\" missing 'not a plain object' message in stderr: $stderr_out"
fi
rm -rf "$TMP20"

# Test 21: vulnerabilities key present as array → ABORTS (exit 3), never PASSED
printf '\nTest 21: {"vulnerabilities":[]} (array, not object) → ABORTS (exit 3)\n'
VULNERABILITIES_ARRAY_JSON='{"vulnerabilities":[]}'
TMP21="$(setup_fake_pnpm)"
write_fake_pnpm "$TMP21" "$VULNERABILITIES_ARRAY_JSON" 0
rc=0
stderr_out="$(env PATH="$TMP21:$PATH" REPO_ROOT="$REPO_ROOT" bash -c "
  source '$GATE_SCRIPT'
  AUDIT_STATUS_LINE=''
  run_audit_gate
" 2>&1 >/dev/null)" || rc=$?
if [[ $rc -ne 0 ]]; then
  pass "vulnerabilities:[] (array) → aborts (exit 3), not passed"
else
  fail "vulnerabilities:[] (array) → silently passed — fail-open bug"
fi
if printf '%s' "$stderr_out" | grep -q 'not a plain object'; then
  pass "vulnerabilities:[] prints 'not a plain object' message"
else
  fail "vulnerabilities:[] missing 'not a plain object' message in stderr: $stderr_out"
fi
rm -rf "$TMP21"

# Test 22: advisories:{} with pnpm exit 1 and missing metadata → ABORTS (exit 3)
# This is the specific "advisories:{} + pnpm exit 1" fail-open vector
printf '\nTest 22: {"advisories":{}} with pnpm exit 1, no metadata → ABORTS (exit 3)\n'
ADVISORIES_EMPTY_NO_META_JSON='{"advisories":{}}'
TMP22="$(setup_fake_pnpm)"
write_fake_pnpm "$TMP22" "$ADVISORIES_EMPTY_NO_META_JSON" 1
rc=0
stderr_out="$(env PATH="$TMP22:$PATH" REPO_ROOT="$REPO_ROOT" bash -c "
  source '$GATE_SCRIPT'
  AUDIT_STATUS_LINE=''
  run_audit_gate
" 2>&1 >/dev/null)" || rc=$?
if [[ $rc -ne 0 ]]; then
  pass "advisories:{} + pnpm exit 1 + no metadata → aborts (exit 3), not passed"
else
  fail "advisories:{} + pnpm exit 1 + no metadata → silently passed — fail-open bug"
fi
if printf '%s' "$stderr_out" | grep -q 'inconsistent'; then
  pass "advisories:{} + no metadata prints inconsistency message"
else
  fail "advisories:{} + no metadata missing inconsistency message in stderr: $stderr_out"
fi
rm -rf "$TMP22"

# Test 23: BOTH advisories AND vulnerabilities present → ABORTS (exit 3, ambiguous)
printf '\nTest 23: both "advisories" and "vulnerabilities" present → ABORTS (exit 3, ambiguous)\n'
BOTH_CONTAINERS_JSON='{"advisories":{},"vulnerabilities":{},"metadata":{"vulnerabilities":{"info":0,"low":0,"moderate":0,"high":0,"critical":0}}}'
TMP23="$(setup_fake_pnpm)"
write_fake_pnpm "$TMP23" "$BOTH_CONTAINERS_JSON" 0
rc=0
stderr_out="$(env PATH="$TMP23:$PATH" REPO_ROOT="$REPO_ROOT" bash -c "
  source '$GATE_SCRIPT'
  AUDIT_STATUS_LINE=''
  run_audit_gate
" 2>&1 >/dev/null)" || rc=$?
if [[ $rc -ne 0 ]]; then
  pass "both advisories + vulnerabilities containers → aborts (exit 3, ambiguous)"
else
  fail "both advisories + vulnerabilities containers → silently passed — fail-open bug"
fi
if printf '%s' "$stderr_out" | grep -q 'ambiguous'; then
  pass "both containers present prints 'ambiguous' message"
else
  fail "both containers present missing 'ambiguous' message in stderr: $stderr_out"
fi
rm -rf "$TMP23"

# --- summary -------------------------------------------------------------------

printf '\n================================\n'
printf 'Results: %d passed, %d failed\n' "$PASS_COUNT" "$FAIL_COUNT"
if [[ $FAIL_COUNT -gt 0 ]]; then
  printf '\nFailed tests:\n'
  for f in "${FAILURES[@]}"; do
    printf '  - %s\n' "$f"
  done
  exit 1
fi
printf 'All tests passed.\n'
