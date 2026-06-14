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

# Sweep any orphaned scripts/.test-* fixture dirs on exit (normal finish,
# error abort under set -e, or Ctrl-C).  Individual tests already rm -rf their
# own dirs, so this is belt-and-suspenders for mid-run interruption only.
trap 'rm -rf "$REPO_ROOT"/scripts/.test-* 2>/dev/null || true' EXIT

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

# Test 4b: non-zero pnpm exit + clean JSON (empty advisories, all-zero meta) → aborts
# Fail-open before fix: pnpm exits 1, advisory container is empty, metadata is
# all-zero → filter saw no advisories → emitted PASSED → gate returned 0.
printf '\nTest 4b: non-zero pnpm exit + clean JSON → gate ABORTS (infra inconsistency)\n'
TMP4b="$(setup_fake_pnpm)"
write_fake_pnpm "$TMP4b" "$CLEAN_JSON" 1
rc=0
stderr_4b="$(env PATH="$TMP4b:$PATH" REPO_ROOT="$REPO_ROOT" bash -c "
  source '$GATE_SCRIPT'
  AUDIT_STATUS_LINE=''
  run_audit_gate
" 2>&1 >/dev/null)" || rc=$?
if [[ $rc -ne 0 ]]; then
  pass "Commit1: non-zero pnpm exit + clean JSON → gate aborts"
else
  fail "Commit1: non-zero pnpm exit + clean JSON → gate wrongly returned 0 (FAIL-OPEN)"
fi
if printf '%s' "$stderr_4b" | grep -q 'inconsistent'; then
  pass "Commit1: non-zero pnpm exit + clean JSON → inconsistency message emitted"
else
  fail "Commit1: inconsistency message missing from stderr: $stderr_4b"
fi
rm -rf "$TMP4b"

# Test 4c: non-zero pnpm exit + all-zero metadata + empty advisories → aborts
# (Same shape as 4b but explicit all-zero metadata object)
printf '\nTest 4c: non-zero pnpm exit + all-zero metadata → gate ABORTS\n'
ALLZERO_META_JSON='{"actions":[],"advisories":{},"muted":[],"metadata":{"vulnerabilities":{"info":0,"low":0,"moderate":0,"high":0,"critical":0},"dependencies":0}}'
TMP4c="$(setup_fake_pnpm)"
write_fake_pnpm "$TMP4c" "$ALLZERO_META_JSON" 1
rc=0
env PATH="$TMP4c:$PATH" REPO_ROOT="$REPO_ROOT" bash -c "
  source '$GATE_SCRIPT'
  AUDIT_STATUS_LINE=''
  run_audit_gate
" 2>/dev/null || rc=$?
if [[ $rc -ne 0 ]]; then
  pass "Commit1: non-zero pnpm exit + all-zero metadata → gate aborts"
else
  fail "Commit1: non-zero pnpm exit + all-zero metadata → gate wrongly returned 0 (FAIL-OPEN)"
fi
rm -rf "$TMP4c"

# Test 4d: non-zero pnpm exit + fully allowlisted findings → still PASSES
# When pnpm exits 1 AND advisories are present (all allowlisted), the gate
# must still pass — that is legitimate behavior.
printf '\nTest 4d: non-zero pnpm exit + all-allowlisted advisories → gate still PASSES\n'
TMP4d="$(setup_fake_pnpm)"
write_fake_pnpm "$TMP4d" "$ALLOWLISTED_JSON" 1
if out="$(run_gate_in_subshell "$TMP4d" 2>/dev/null)"; then
  if printf '%s' "$out" | grep -q 'PASSED'; then
    pass "Commit1: non-zero pnpm exit + allowlisted advisories → still PASSES"
  else
    fail "Commit1: non-zero pnpm exit + allowlisted advisories → passed but missing PASSED token: $out"
  fi
else
  fail "Commit1: non-zero pnpm exit + allowlisted advisories → wrongly aborted"
fi
rm -rf "$TMP4d"

# Test 4e: pnpm_exit=0 but filter emits no PASSED token → aborts (belt-and-suspenders)
# This covers the bash-layer guard: filter_exit==0 && -z status_token → exit 3.
printf '\nTest 4e: filter_exit=0 but no PASSED token → gate ABORTS\n'
TMP4e="$(setup_fake_pnpm)"
# Emit JSON that causes filter to exit 0 without writing PASSED (empty output hack):
# Use a payload missing ALL recognized keys so filter exits 3 before PASSED —
# actually we want filter_exit=0 with no PASSED token.  The only way to get that
# is a bug in the filter, which we cannot inject.  Instead, test the bash guard
# by simulating the case directly: write a pnpm stub that emits valid JSON but
# we'll rely on the upstream empty-output guard.
# Practical test: empty JSON object (no advisories, no metadata, no vulnerabilities key)
# hits the "no recognisable advisory container" path → exit 3 → bash layer aborts.
EMPTY_OBJ_JSON='{}'
write_fake_pnpm "$TMP4e" "$EMPTY_OBJ_JSON" 0
rc=0
env PATH="$TMP4e:$PATH" REPO_ROOT="$REPO_ROOT" bash -c "
  source '$GATE_SCRIPT'
  AUDIT_STATUS_LINE=''
  run_audit_gate
" 2>/dev/null || rc=$?
if [[ $rc -ne 0 ]]; then
  pass "Commit1: no-PASSED-token path → gate aborts"
else
  fail "Commit1: no-PASSED-token path → gate wrongly returned 0"
fi
rm -rf "$TMP4e"

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

# npm v7 vulnerabilities schema — non-allowlisted critical (real pnpm v7 always emits metadata)
VULN_SCHEMA_CRITICAL_JSON='{"vulnerabilities":{"some-pkg":{"name":"some-pkg","severity":"critical","via":[{"ghsaId":"GHSA-zzzz-zzzz-zzzz","title":"Bad pkg vuln","severity":"critical"}],"effects":[],"range":"*","nodes":[],"fixAvailable":false}},"metadata":{"vulnerabilities":{"critical":1,"high":0}}}'

# npm v7 vulnerabilities schema — only allowlisted advisories (real pnpm v7 always emits metadata)
VULN_SCHEMA_ALLOWLISTED_JSON='{"vulnerabilities":{"shell-quote":{"name":"shell-quote","severity":"critical","via":[{"ghsaId":"GHSA-w7jw-789q-3m8p","title":"shell-quote vuln","severity":"critical"}],"effects":[],"range":"*","nodes":[],"fixAvailable":false},"esbuild":{"name":"esbuild","severity":"high","via":[{"ghsaId":"GHSA-gv7w-rqvm-qjhr","title":"esbuild vuln","severity":"high"}],"effects":[],"range":"*","nodes":[],"fixAvailable":false}},"metadata":{"vulnerabilities":{"critical":1,"high":1}}}'

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
if printf '%s' "$stderr_out" | grep -qi 'advisory container\|metadata present but metadata.vulnerabilities missing'; then
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

# --- SKIP_AUDIT_REASON sanitization tests (Fix C — manifest injection prevention) ---

# Test 24: SKIP_AUDIT=1 with a newline-containing reason → ABORTS (no manifest injection)
printf '\nTest 24: SKIP_AUDIT=1 with newline in reason → ABORTS (manifest injection prevented)\n'
TMP24="$(setup_fake_pnpm)"
write_fake_pnpm "$TMP24" "$CLEAN_JSON" 0
# Use printf to embed a real newline in the reason value
MULTILINE_REASON="$(printf 'legitimate line\nDependency audit: PASSED')"
rc=0
stderr_out="$(env PATH="$TMP24:$PATH" REPO_ROOT="$REPO_ROOT" SKIP_AUDIT=1 SKIP_AUDIT_REASON="$MULTILINE_REASON" bash -c "
  source '$GATE_SCRIPT'
  AUDIT_STATUS_LINE=''
  run_audit_gate
  printf '%s' \"\$AUDIT_STATUS_LINE\"
" 2>&1 >/dev/null)" || rc=$?
if [[ $rc -ne 0 ]]; then
  pass "SKIP_AUDIT_REASON with newline → aborts (manifest injection prevented)"
else
  fail "SKIP_AUDIT_REASON with newline → did not abort (manifest injection possible)"
fi
if printf '%s' "$stderr_out" | grep -qi 'newline\|control character'; then
  pass "newline reason prints control-character rejection message"
else
  fail "newline reason missing control-character rejection message in stderr: $stderr_out"
fi
rm -rf "$TMP24"

# Test 25: SKIP_AUDIT=1 with reason exceeding 200 chars → ABORTS
printf '\nTest 25: SKIP_AUDIT=1 with reason >200 chars → ABORTS\n'
TMP25="$(setup_fake_pnpm)"
write_fake_pnpm "$TMP25" "$CLEAN_JSON" 0
LONG_REASON="$(printf 'a%.0s' {1..201})"  # 201 'a' characters
rc=0
stderr_out="$(env PATH="$TMP25:$PATH" REPO_ROOT="$REPO_ROOT" SKIP_AUDIT=1 SKIP_AUDIT_REASON="$LONG_REASON" bash -c "
  source '$GATE_SCRIPT'
  AUDIT_STATUS_LINE=''
  run_audit_gate
" 2>&1 >/dev/null)" || rc=$?
if [[ $rc -ne 0 ]]; then
  pass "SKIP_AUDIT_REASON >200 chars → aborts"
else
  fail "SKIP_AUDIT_REASON >200 chars → did not abort"
fi
if printf '%s' "$stderr_out" | grep -q 'exceeds 200'; then
  pass "long reason prints 'exceeds 200' rejection message"
else
  fail "long reason missing 'exceeds 200' message in stderr: $stderr_out"
fi
rm -rf "$TMP25"

# Test 26: SKIP_AUDIT=1 with a valid single-line reason under 200 chars → BYPASSES normally
printf '\nTest 26: SKIP_AUDIT=1 with valid single-line reason ≤200 chars → BYPASSES normally\n'
TMP26="$(setup_fake_pnpm)"
write_fake_pnpm "$TMP26" "$NEW_CRITICAL_JSON" 1
if out="$(env PATH="$TMP26:$PATH" REPO_ROOT="$REPO_ROOT" SKIP_AUDIT=1 SKIP_AUDIT_REASON="GHSA-w7jw-789q-3m8p accepted per SECURITY.md" bash -c "
  source '$GATE_SCRIPT'
  AUDIT_STATUS_LINE=''
  run_audit_gate
  printf '%s' \"\$AUDIT_STATUS_LINE\"
" 2>/dev/null)"; then
  pass "valid single-line reason ≤200 chars → bypasses (exit 0)"
  if printf '%s' "$out" | grep -q 'BYPASSED'; then
    pass "valid bypass sets BYPASSED in status line"
  else
    fail "valid bypass missing BYPASSED in status line: $out"
  fi
else
  fail "valid single-line reason → unexpected non-zero exit"
fi
rm -rf "$TMP26"

# --- allowlist expiry and schema validation tests (Fix D) ---------------------
# These use a temp allowlist file so the real allowlist is never mutated.

# Helpers to write temp allowlists.
# Allowlist fixtures MUST live inside $REPO_ROOT/scripts/ because the gate's
# path-scope guard (belt-and-suspenders for Fix 1) only honours AUDIT_ALLOWLIST
# overrides that resolve inside the scripts/ directory.  Using mktemp -d with a
# template rooted there satisfies that constraint without touching real files.
write_temp_allowlist() {
  local tmpdir
  tmpdir="$(mktemp -d "$REPO_ROOT/scripts/.test-XXXXXX")"
  printf '%s' "$1" > "$tmpdir/allowlist.json"
  printf '%s' "$tmpdir"
}

run_gate_with_allowlist() {
  local bindir="$1"
  local allowlist_file="$2"
  shift 2
  env PATH="$bindir:$PATH" REPO_ROOT="$REPO_ROOT" "$@" bash -c "
    set -euo pipefail
    AUDIT_GATE_TEST_MODE=1
    AUDIT_ALLOWLIST='$allowlist_file'
    source '$GATE_SCRIPT'
    AUDIT_STATUS_LINE=''
    run_audit_gate
    printf '%s\n' \"\$AUDIT_STATUS_LINE\"
  "
}

# Today + 1 year for a valid future expiry; yesterday for expired
FUTURE_EXPIRES="$(date -u -v+1y +%Y-%m-%d 2>/dev/null || date -u -d '+1 year' +%Y-%m-%d)"
PAST_EXPIRES="$(date -u -v-1d +%Y-%m-%d 2>/dev/null || date -u -d '-1 day' +%Y-%m-%d)"

# Test 27: expired allowlist entry → advisory that was allowlisted now FAILS the gate
printf '\nTest 27: expired allowlist entry → otherwise-allowlisted advisory now FAILS\n'
EXPIRED_ALLOWLIST="$(printf '[{"id":"GHSA-w7jw-789q-3m8p","package":"shell-quote","severity":"critical","reason":"test","expires":"%s"}]' "$PAST_EXPIRES")"
TMPD27_AL="$(write_temp_allowlist "$EXPIRED_ALLOWLIST")"
TMP27="$(setup_fake_pnpm)"
write_fake_pnpm "$TMP27" "$ALLOWLISTED_JSON" 1
rc=0
stderr_out="$(run_gate_with_allowlist "$TMP27" "$TMPD27_AL/allowlist.json" 2>&1 >/dev/null)" || rc=$?
if [[ $rc -ne 0 ]]; then
  pass "expired allowlist entry → gate FAILS (advisory no longer accepted)"
else
  fail "expired allowlist entry → gate passed — expiry not enforced"
fi
if printf '%s' "$stderr_out" | grep -q 'expired'; then
  pass "expired entry prints 'expired' message"
else
  fail "expired entry missing 'expired' message in stderr: $stderr_out"
fi
rm -rf "$TMP27" "$TMPD27_AL"

# Test 28: malformed allowlist entry (missing id) → gate ABORTS
printf '\nTest 28: allowlist entry missing "id" field → ABORTS\n'
MALFORMED_ALLOWLIST='[{"package":"shell-quote","severity":"critical","reason":"test","expires":"2026-12-31"}]'
TMPD28_AL="$(write_temp_allowlist "$MALFORMED_ALLOWLIST")"
TMP28="$(setup_fake_pnpm)"
write_fake_pnpm "$TMP28" "$CLEAN_JSON" 0
rc=0
stderr_out="$(run_gate_with_allowlist "$TMP28" "$TMPD28_AL/allowlist.json" 2>&1 >/dev/null)" || rc=$?
if [[ $rc -ne 0 ]]; then
  pass "allowlist entry missing 'id' → gate ABORTS"
else
  fail "allowlist entry missing 'id' → gate passed — schema not validated"
fi
if printf '%s' "$stderr_out" | grep -q 'malformed'; then
  pass "missing 'id' prints 'malformed' message"
else
  fail "missing 'id' missing 'malformed' message in stderr: $stderr_out"
fi
rm -rf "$TMP28" "$TMPD28_AL"

# Test 29: allowlist entry missing "expires" field → gate ABORTS
printf '\nTest 29: allowlist entry missing "expires" field → ABORTS\n'
NO_EXPIRES_ALLOWLIST='[{"id":"GHSA-w7jw-789q-3m8p","package":"shell-quote","severity":"critical","reason":"test"}]'
TMPD29_AL="$(write_temp_allowlist "$NO_EXPIRES_ALLOWLIST")"
TMP29="$(setup_fake_pnpm)"
write_fake_pnpm "$TMP29" "$CLEAN_JSON" 0
rc=0
stderr_out="$(run_gate_with_allowlist "$TMP29" "$TMPD29_AL/allowlist.json" 2>&1 >/dev/null)" || rc=$?
if [[ $rc -ne 0 ]]; then
  pass "allowlist entry missing 'expires' → gate ABORTS"
else
  fail "allowlist entry missing 'expires' → gate passed — schema not validated"
fi
if printf '%s' "$stderr_out" | grep -q 'malformed'; then
  pass "missing 'expires' prints 'malformed' message"
else
  fail "missing 'expires' missing 'malformed' message in stderr: $stderr_out"
fi
rm -rf "$TMP29" "$TMPD29_AL"

# Test 30: duplicate GHSA id in allowlist → gate ABORTS
printf '\nTest 30: duplicate GHSA id in allowlist → ABORTS\n'
DUPLICATE_ID_ALLOWLIST="$(printf '[{"id":"GHSA-w7jw-789q-3m8p","package":"shell-quote","severity":"critical","reason":"test","expires":"%s"},{"id":"GHSA-w7jw-789q-3m8p","package":"shell-quote","severity":"critical","reason":"dup","expires":"%s"}]' "$FUTURE_EXPIRES" "$FUTURE_EXPIRES")"
TMPD30_AL="$(write_temp_allowlist "$DUPLICATE_ID_ALLOWLIST")"
TMP30="$(setup_fake_pnpm)"
write_fake_pnpm "$TMP30" "$CLEAN_JSON" 0
rc=0
stderr_out="$(run_gate_with_allowlist "$TMP30" "$TMPD30_AL/allowlist.json" 2>&1 >/dev/null)" || rc=$?
if [[ $rc -ne 0 ]]; then
  pass "duplicate GHSA id in allowlist → gate ABORTS"
else
  fail "duplicate GHSA id in allowlist → gate passed — duplicate not detected"
fi
if printf '%s' "$stderr_out" | grep -qi 'duplicate\|malformed'; then
  pass "duplicate id prints duplicate/malformed message"
else
  fail "duplicate id missing duplicate/malformed message in stderr: $stderr_out"
fi
rm -rf "$TMP30" "$TMPD30_AL"

# Test 31: valid allowlist with future expiry → gate passes normally
printf '\nTest 31: valid allowlist with future expiry → gate passes normally\n'
VALID_FUTURE_ALLOWLIST="$(printf '[{"id":"GHSA-w7jw-789q-3m8p","package":"shell-quote","severity":"critical","reason":"test","expires":"%s"}]' "$FUTURE_EXPIRES")"
TMPD31_AL="$(write_temp_allowlist "$VALID_FUTURE_ALLOWLIST")"
TMP31="$(setup_fake_pnpm)"
write_fake_pnpm "$TMP31" "$ALLOWLISTED_JSON" 1
# Only GHSA-w7jw-789q-3m8p is allowlisted; the other two in ALLOWLISTED_JSON are not → should fail
rc=0
run_gate_with_allowlist "$TMP31" "$TMPD31_AL/allowlist.json" 2>/dev/null || rc=$?
# We expect failure here because ALLOWLISTED_JSON has 3 advisories but only 1 is in allowlist
if [[ $rc -ne 0 ]]; then
  pass "partial allowlist (1 of 3 allowlisted) → gate correctly rejects non-allowlisted entries"
else
  fail "partial allowlist → gate passed when it should have rejected non-allowlisted entries"
fi
rm -rf "$TMP31" "$TMPD31_AL"

# Test 32: clean audit with valid future-expiry allowlist → gate passes
printf '\nTest 32: clean audit with valid future-expiry allowlist → gate passes\n'
TMPD32_AL="$(write_temp_allowlist "$VALID_FUTURE_ALLOWLIST")"
TMP32="$(setup_fake_pnpm)"
write_fake_pnpm "$TMP32" "$CLEAN_JSON" 0
if out="$(run_gate_with_allowlist "$TMP32" "$TMPD32_AL/allowlist.json" 2>/dev/null)"; then
  if printf '%s' "$out" | grep -q 'PASSED'; then
    pass "clean audit with valid future-expiry allowlist → passes and reports PASSED"
  else
    fail "clean audit with valid allowlist passed but status line missing 'PASSED': $out"
  fi
else
  fail "clean audit with valid future-expiry allowlist → unexpected non-zero exit"
fi
rm -rf "$TMP32" "$TMPD32_AL"

# --- Fix 1: invalid expires date in allowlist (calendar-impossible dates) ------

# Test 33: allowlist entry with impossible month (2026-13-40) → ABORTS (exit 3)
printf '\nTest 33: allowlist entry expires:"2026-13-40" (impossible month) → ABORTS (exit 3)\n'
INVALID_MONTH_ALLOWLIST='[{"id":"GHSA-w7jw-789q-3m8p","package":"shell-quote","severity":"critical","reason":"test","expires":"2026-13-40"}]'
TMPD33_AL="$(write_temp_allowlist "$INVALID_MONTH_ALLOWLIST")"
TMP33="$(setup_fake_pnpm)"
write_fake_pnpm "$TMP33" "$CLEAN_JSON" 0
rc=0
stderr_out="$(run_gate_with_allowlist "$TMP33" "$TMPD33_AL/allowlist.json" 2>&1 >/dev/null)" || rc=$?
if [[ $rc -ne 0 ]]; then
  pass "allowlist expires:\"2026-13-40\" (impossible month) → gate ABORTS (exit 3)"
else
  fail "allowlist expires:\"2026-13-40\" → gate passed — invalid date not rejected"
fi
if printf '%s' "$stderr_out" | grep -qi 'malformed\|valid calendar date'; then
  pass "impossible-month expires prints malformed/invalid-date message"
else
  fail "impossible-month expires missing malformed message in stderr: $stderr_out"
fi
rm -rf "$TMP33" "$TMPD33_AL"

# Test 34: allowlist entry with rolled-over date (2026-02-30 → JS rolls to Mar 2) → ABORTS (exit 3)
printf '\nTest 34: allowlist entry expires:"2026-02-30" (roll-over date) → ABORTS (exit 3)\n'
ROLLOVER_DATE_ALLOWLIST='[{"id":"GHSA-w7jw-789q-3m8p","package":"shell-quote","severity":"critical","reason":"test","expires":"2026-02-30"}]'
TMPD34_AL="$(write_temp_allowlist "$ROLLOVER_DATE_ALLOWLIST")"
TMP34="$(setup_fake_pnpm)"
write_fake_pnpm "$TMP34" "$CLEAN_JSON" 0
rc=0
stderr_out="$(run_gate_with_allowlist "$TMP34" "$TMPD34_AL/allowlist.json" 2>&1 >/dev/null)" || rc=$?
if [[ $rc -ne 0 ]]; then
  pass "allowlist expires:\"2026-02-30\" (roll-over) → gate ABORTS (exit 3)"
else
  fail "allowlist expires:\"2026-02-30\" → gate passed — rolled-over date not rejected"
fi
if printf '%s' "$stderr_out" | grep -qi 'malformed\|valid calendar date\|rolled over'; then
  pass "roll-over expires prints malformed/rolled-over message"
else
  fail "roll-over expires missing malformed message in stderr: $stderr_out"
fi
rm -rf "$TMP34" "$TMPD34_AL"

# --- Fix 2: metadata-only payload (no advisory container) → ABORTS (exit 3) ---

# Test 35: payload with only metadata.vulnerabilities all-zero (no advisories key) → ABORTS (exit 3)
printf '\nTest 35: {"metadata":{"vulnerabilities":{"high":0,"critical":0}}} (no advisory container) → ABORTS (exit 3)\n'
META_ONLY_ALLZERO_JSON='{"metadata":{"vulnerabilities":{"high":0,"critical":0}}}'
TMP35="$(setup_fake_pnpm)"
write_fake_pnpm "$TMP35" "$META_ONLY_ALLZERO_JSON" 0
rc=0
stderr_out="$(env PATH="$TMP35:$PATH" REPO_ROOT="$REPO_ROOT" bash -c "
  source '$GATE_SCRIPT'
  AUDIT_STATUS_LINE=''
  run_audit_gate
" 2>&1 >/dev/null)" || rc=$?
if [[ $rc -ne 0 ]]; then
  pass "metadata-only all-zero payload (no advisory container) → gate ABORTS (exit 3)"
else
  fail "metadata-only all-zero payload → gate PASSED — fail-open: advisory container required"
fi
if printf '%s' "$stderr_out" | grep -qi 'advisory container\|malformed\|inconsistent'; then
  pass "metadata-only payload prints advisory-container-required message"
else
  fail "metadata-only payload missing advisory-container message in stderr: $stderr_out"
fi
rm -rf "$TMP35"

# Regression guards: genuine clean v6 and v7 still pass after Fix 2

# Test 36: genuine clean v6 (advisories:{} + metadata all-zero) still PASSES
printf '\nTest 36: genuine clean v6 {"advisories":{},"metadata":{"vulnerabilities":{...0}}} still PASSES\n'
CLEAN_V6_JSON='{"advisories":{},"metadata":{"vulnerabilities":{"info":0,"low":0,"moderate":0,"high":0,"critical":0}}}'
TMP36="$(setup_fake_pnpm)"
write_fake_pnpm "$TMP36" "$CLEAN_V6_JSON" 0
if out="$(run_gate_in_subshell "$TMP36" 2>/dev/null)"; then
  if printf '%s' "$out" | grep -q 'PASSED'; then
    pass "genuine clean v6 (advisories:{} + all-zero metadata) still PASSES after Fix 2"
  else
    fail "genuine clean v6 passed but status line missing 'PASSED': $out"
  fi
else
  fail "genuine clean v6 exited non-zero — regression introduced by Fix 2"
fi
rm -rf "$TMP36"

# Test 37: genuine clean v7 (vulnerabilities:{} + metadata) still PASSES
printf '\nTest 37: genuine clean v7 {"vulnerabilities":{},"metadata":{...}} still PASSES\n'
CLEAN_V7_JSON='{"vulnerabilities":{},"metadata":{"vulnerabilities":{"info":0,"low":0,"moderate":0,"high":0,"critical":0}}}'
TMP37="$(setup_fake_pnpm)"
write_fake_pnpm "$TMP37" "$CLEAN_V7_JSON" 0
if out="$(run_gate_in_subshell "$TMP37" 2>/dev/null)"; then
  if printf '%s' "$out" | grep -q 'PASSED'; then
    pass "genuine clean v7 (vulnerabilities:{} + metadata) still PASSES after Fix 2"
  else
    fail "genuine clean v7 passed but status line missing 'PASSED': $out"
  fi
else
  fail "genuine clean v7 exited non-zero — regression introduced by Fix 2"
fi
rm -rf "$TMP37"

# --- v7 metadata-required guard (symmetry with v6 guard) ----------------------

# Test 38: {"vulnerabilities":{}} with NO metadata → ABORTS (exit 3)
# Mirrors the v6 guard: a v7 payload missing metadata.vulnerabilities is malformed.
printf '\nTest 38: {"vulnerabilities":{}} (no metadata) → ABORTS (exit 3)\n'
VULN_NO_METADATA_JSON='{"vulnerabilities":{}}'
TMP38="$(setup_fake_pnpm)"
write_fake_pnpm "$TMP38" "$VULN_NO_METADATA_JSON" 0
rc=0
stderr_out="$(env PATH="$TMP38:$PATH" REPO_ROOT="$REPO_ROOT" bash -c "
  source '$GATE_SCRIPT'
  AUDIT_STATUS_LINE=''
  run_audit_gate
" 2>&1 >/dev/null)" || rc=$?
if [[ $rc -ne 0 ]]; then
  pass "vulnerabilities:{} + no metadata → aborts (exit 3), not passed"
else
  fail "vulnerabilities:{} + no metadata → silently passed — fail-open bug (v7 metadata guard missing)"
fi
if printf '%s' "$stderr_out" | grep -q 'inconsistent'; then
  pass "vulnerabilities:{} + no metadata prints inconsistency message"
else
  fail "vulnerabilities:{} + no metadata missing inconsistency message in stderr: $stderr_out"
fi
rm -rf "$TMP38"

# Test 39: clean v7 WITH metadata → still PASSES (regression guard)
printf '\nTest 39: clean v7 {"vulnerabilities":{},"metadata":{"vulnerabilities":{...0}}} still PASSES\n'
CLEAN_V7_META_JSON='{"vulnerabilities":{},"metadata":{"vulnerabilities":{"info":0,"low":0,"moderate":0,"high":0,"critical":0}}}'
TMP39="$(setup_fake_pnpm)"
write_fake_pnpm "$TMP39" "$CLEAN_V7_META_JSON" 0
if out="$(run_gate_in_subshell "$TMP39" 2>/dev/null)"; then
  if printf '%s' "$out" | grep -q 'PASSED'; then
    pass "clean v7 with metadata still PASSES after v7 metadata guard"
  else
    fail "clean v7 with metadata passed but status line missing 'PASSED': $out"
  fi
else
  fail "clean v7 with metadata exited non-zero — regression introduced by v7 metadata guard"
fi
rm -rf "$TMP39"

# --- Fix 1: metadata count type validation and severity normalization ---------

# Test 40: metadata counts as strings → ABORTS (exit 3, malformed metadata)
printf '\nTest 40: metadata.vulnerabilities counts as strings → ABORTS (exit 3)\n'
STRING_COUNTS_JSON='{"advisories":{},"metadata":{"vulnerabilities":{"high":"0","critical":"0"}}}'
TMP40="$(setup_fake_pnpm)"
write_fake_pnpm "$TMP40" "$STRING_COUNTS_JSON" 0
rc=0
stderr_out="$(env PATH="$TMP40:$PATH" REPO_ROOT="$REPO_ROOT" bash -c "
  source '$GATE_SCRIPT'
  AUDIT_STATUS_LINE=''
  run_audit_gate
" 2>&1 >/dev/null)" || rc=$?
if [[ $rc -ne 0 ]]; then
  pass "metadata counts as strings → gate ABORTS (exit 3)"
else
  fail "metadata counts as strings → gate passed — string-count coercion bug not caught"
fi
if printf '%s' "$stderr_out" | grep -qi 'not a non-negative integer\|malformed'; then
  pass "string counts print malformed-metadata message"
else
  fail "string counts missing malformed-metadata message in stderr: $stderr_out"
fi
rm -rf "$TMP40"

# Test 41: metadata counts with a negative value → ABORTS (exit 3)
printf '\nTest 41: metadata.vulnerabilities.high:-1 (negative) → ABORTS (exit 3)\n'
NEGATIVE_COUNT_JSON='{"advisories":{},"metadata":{"vulnerabilities":{"high":-1,"critical":0}}}'
TMP41="$(setup_fake_pnpm)"
write_fake_pnpm "$TMP41" "$NEGATIVE_COUNT_JSON" 0
rc=0
stderr_out="$(env PATH="$TMP41:$PATH" REPO_ROOT="$REPO_ROOT" bash -c "
  source '$GATE_SCRIPT'
  AUDIT_STATUS_LINE=''
  run_audit_gate
" 2>&1 >/dev/null)" || rc=$?
if [[ $rc -ne 0 ]]; then
  pass "metadata count -1 (negative) → gate ABORTS (exit 3)"
else
  fail "metadata count -1 → gate passed — negative count not rejected"
fi
if printf '%s' "$stderr_out" | grep -qi 'not a non-negative integer\|malformed'; then
  pass "negative count prints malformed-metadata message"
else
  fail "negative count missing malformed-metadata message in stderr: $stderr_out"
fi
rm -rf "$TMP41"

# Test 42: advisory severity with trailing space "critical " → correctly fails gate (exit 2)
# The advisory GHSA is not allowlisted, metadata reports critical:1.
# After normalization "critical " → "critical", so it is counted and the gate must FAIL (exit 2).
printf '\nTest 42: advisory severity "critical " (trailing space) + metadata critical:1 → gate FAILS (exit 2)\n'
TRAILING_SEV_JSON='{"advisories":{"99":{"findings":[],"id":99,"severity":"critical ","module_name":"some-pkg","title":"Trailing space sev","github_advisory_id":"GHSA-zzzz-zzzz-zzzz","vulnerable_versions":"<1.0.0","cves":[]}},"muted":[],"metadata":{"vulnerabilities":{"high":0,"critical":1}}}'
TMP42="$(setup_fake_pnpm)"
write_fake_pnpm "$TMP42" "$TRAILING_SEV_JSON" 1
rc=0
stderr_out="$(env PATH="$TMP42:$PATH" REPO_ROOT="$REPO_ROOT" bash -c "
  source '$GATE_SCRIPT'
  AUDIT_STATUS_LINE=''
  run_audit_gate
" 2>&1 >/dev/null)" || rc=$?
if [[ $rc -ne 0 ]]; then
  pass "advisory severity 'critical ' (trailing space) → gate correctly FAILS (exit 2), not bypassed"
else
  fail "advisory severity 'critical ' → gate passed — severity normalization not applied"
fi
if printf '%s' "$stderr_out" | grep -q 'NON-ALLOWLISTED'; then
  pass "trailing-space severity advisory prints NON-ALLOWLISTED message (correctly counted)"
else
  fail "trailing-space severity advisory missing NON-ALLOWLISTED message: $stderr_out"
fi
rm -rf "$TMP42"

# Test 43: genuine clean with valid integer metadata counts → still PASSES (regression guard)
printf '\nTest 43: genuine clean with integer metadata counts → still PASSES (regression guard)\n'
TMP43="$(setup_fake_pnpm)"
write_fake_pnpm "$TMP43" "$CLEAN_JSON" 0
if out="$(run_gate_in_subshell "$TMP43" 2>/dev/null)"; then
  if printf '%s' "$out" | grep -q 'PASSED'; then
    pass "genuine clean with integer metadata counts still PASSES after Fix 1"
  else
    fail "genuine clean with integer metadata counts passed but status line missing 'PASSED': $out"
  fi
else
  fail "genuine clean with integer metadata counts exited non-zero — Fix 1 regression"
fi
rm -rf "$TMP43"

# Test 44: all-allowlisted advisories with integer metadata counts → still PASSES
printf '\nTest 44: all-allowlisted advisories with integer metadata counts → still PASSES\n'
TMP44="$(setup_fake_pnpm)"
write_fake_pnpm "$TMP44" "$ALLOWLISTED_JSON" 1
if out="$(run_gate_in_subshell "$TMP44" 2>/dev/null)"; then
  if printf '%s' "$out" | grep -q 'PASSED'; then
    pass "all-allowlisted with integer metadata counts still PASSES after Fix 1"
  else
    fail "all-allowlisted with integer metadata counts: status line missing 'PASSED': $out"
  fi
else
  fail "all-allowlisted with integer metadata counts exited non-zero — Fix 1 regression"
fi
rm -rf "$TMP44"

# --- Fix 2: allowlist identity matching (GHSA id + package + severity) --------

# Helper: write a temp allowlist and run the gate with a specific pnpm JSON payload
run_gate_allowlist_payload() {
  local bindir="$1"
  local allowlist_file="$2"
  local payload_json="$3"
  local pnpm_exit="${4:-1}"
  write_fake_pnpm "$bindir" "$payload_json" "$pnpm_exit"
  env PATH="$bindir:$PATH" REPO_ROOT="$REPO_ROOT" bash -c "
    set -euo pipefail
    AUDIT_GATE_TEST_MODE=1
    AUDIT_ALLOWLIST='$allowlist_file'
    source '$GATE_SCRIPT'
    AUDIT_STATUS_LINE=''
    run_audit_gate
    printf '%s\n' \"\$AUDIT_STATUS_LINE\"
  "
}

# Test 45: allowlist entry with wrong package → live advisory NOT suppressed (gate FAILS exit 2)
printf '\nTest 45: allowlist entry GHSA matches but wrong package → advisory NOT suppressed, gate FAILS\n'
WRONG_PKG_ALLOWLIST="$(printf '[{"id":"GHSA-w7jw-789q-3m8p","package":"not-shell-quote","severity":"critical","reason":"test","expires":"%s"}]' "$FUTURE_EXPIRES")"
TMPD45_AL="$(write_temp_allowlist "$WRONG_PKG_ALLOWLIST")"
TMP45="$(setup_fake_pnpm)"
# Payload: GHSA-w7jw-789q-3m8p on shell-quote (critical) — allowlist has wrong package
SHELL_QUOTE_CRIT_JSON='{"advisories":{"1":{"findings":[],"id":1,"severity":"critical","module_name":"shell-quote","title":"shell-quote vuln","github_advisory_id":"GHSA-w7jw-789q-3m8p","vulnerable_versions":"<=1.8.3","cves":[]}},"muted":[],"metadata":{"vulnerabilities":{"high":0,"critical":1}}}'
rc=0
stderr_out="$(run_gate_allowlist_payload "$TMP45" "$TMPD45_AL/allowlist.json" "$SHELL_QUOTE_CRIT_JSON" 1 2>&1 >/dev/null)" || rc=$?
if [[ $rc -ne 0 ]]; then
  pass "allowlist wrong-package mismatch → advisory NOT suppressed, gate FAILS (exit 2)"
else
  fail "allowlist wrong-package mismatch → advisory was suppressed — allowlist identity bug"
fi
if printf '%s' "$stderr_out" | grep -q 'NON-ALLOWLISTED'; then
  pass "wrong-package mismatch prints NON-ALLOWLISTED message"
else
  fail "wrong-package mismatch missing NON-ALLOWLISTED message: $stderr_out"
fi
rm -rf "$TMP45" "$TMPD45_AL"

# Test 46: allowlist entry severity "low" (invalid enum) → ABORTS (exit 3, malformed allowlist)
printf '\nTest 46: allowlist entry severity:"low" (invalid enum, only high/critical allowed) → ABORTS\n'
LOW_SEV_ALLOWLIST="$(printf '[{"id":"GHSA-w7jw-789q-3m8p","package":"shell-quote","severity":"low","reason":"test","expires":"%s"}]' "$FUTURE_EXPIRES")"
TMPD46_AL="$(write_temp_allowlist "$LOW_SEV_ALLOWLIST")"
TMP46="$(setup_fake_pnpm)"
write_fake_pnpm "$TMP46" "$CLEAN_JSON" 0
rc=0
stderr_out="$(env PATH="$TMP46:$PATH" REPO_ROOT="$REPO_ROOT" bash -c "
  set -euo pipefail
  AUDIT_GATE_TEST_MODE=1
  AUDIT_ALLOWLIST='$TMPD46_AL/allowlist.json'
  source '$GATE_SCRIPT'
  AUDIT_STATUS_LINE=''
  run_audit_gate
" 2>&1 >/dev/null)" || rc=$?
if [[ $rc -ne 0 ]]; then
  pass "allowlist severity:\"low\" (invalid) → gate ABORTS (exit 3)"
else
  fail "allowlist severity:\"low\" → gate passed — invalid severity enum not rejected"
fi
if printf '%s' "$stderr_out" | grep -qi 'malformed\|invalid severity\|must be.*high.*critical'; then
  pass "invalid severity enum prints malformed/invalid-severity message"
else
  fail "invalid severity enum missing malformed message in stderr: $stderr_out"
fi
rm -rf "$TMP46" "$TMPD46_AL"

# Test 47: allowlist entry id:"not-a-ghsa" (invalid format) → ABORTS (exit 3)
printf '\nTest 47: allowlist entry id:"not-a-ghsa" (invalid GHSA format) → ABORTS (exit 3)\n'
INVALID_ID_ALLOWLIST="$(printf '[{"id":"not-a-ghsa","package":"shell-quote","severity":"critical","reason":"test","expires":"%s"}]' "$FUTURE_EXPIRES")"
TMPD47_AL="$(write_temp_allowlist "$INVALID_ID_ALLOWLIST")"
TMP47="$(setup_fake_pnpm)"
write_fake_pnpm "$TMP47" "$CLEAN_JSON" 0
rc=0
stderr_out="$(env PATH="$TMP47:$PATH" REPO_ROOT="$REPO_ROOT" bash -c "
  set -euo pipefail
  AUDIT_GATE_TEST_MODE=1
  AUDIT_ALLOWLIST='$TMPD47_AL/allowlist.json'
  source '$GATE_SCRIPT'
  AUDIT_STATUS_LINE=''
  run_audit_gate
" 2>&1 >/dev/null)" || rc=$?
if [[ $rc -ne 0 ]]; then
  pass "allowlist id:\"not-a-ghsa\" (invalid format) → gate ABORTS (exit 3)"
else
  fail "allowlist id:\"not-a-ghsa\" → gate passed — invalid GHSA format not rejected"
fi
if printf '%s' "$stderr_out" | grep -qi 'malformed\|GHSA format\|invalid.*id'; then
  pass "invalid GHSA id format prints malformed message"
else
  fail "invalid GHSA id format missing malformed message in stderr: $stderr_out"
fi
rm -rf "$TMP47" "$TMPD47_AL"

# Test 48: correct allowlist entry (id+package+severity all match) → still PASSES
printf '\nTest 48: correct allowlist entry (id+package+severity match) → advisory suppressed, gate PASSES\n'
CORRECT_ALLOWLIST="$(printf '[{"id":"GHSA-w7jw-789q-3m8p","package":"shell-quote","severity":"critical","reason":"test","expires":"%s"}]' "$FUTURE_EXPIRES")"
TMPD48_AL="$(write_temp_allowlist "$CORRECT_ALLOWLIST")"
TMP48="$(setup_fake_pnpm)"
SHELL_QUOTE_ONLY_JSON='{"advisories":{"1":{"findings":[],"id":1,"severity":"critical","module_name":"shell-quote","title":"shell-quote vuln","github_advisory_id":"GHSA-w7jw-789q-3m8p","vulnerable_versions":"<=1.8.3","cves":[]}},"muted":[],"metadata":{"vulnerabilities":{"high":0,"critical":1}}}'
if out="$(run_gate_allowlist_payload "$TMP48" "$TMPD48_AL/allowlist.json" "$SHELL_QUOTE_ONLY_JSON" 1 2>/dev/null)"; then
  if printf '%s' "$out" | grep -q 'PASSED'; then
    pass "correct allowlist entry (id+package+severity) suppresses advisory → gate PASSES"
  else
    fail "correct allowlist entry: advisory suppressed but status line missing 'PASSED': $out"
  fi
else
  fail "correct allowlist entry → gate failed — correctly matching entry not honoured"
fi
rm -rf "$TMP48" "$TMPD48_AL"

# Test 49: confirm the 3 real allowlist entries still pass with real allowlist
printf '\nTest 49: real allowlist + all 3 allowlisted advisories → still PASSES\n'
TMP49="$(setup_fake_pnpm)"
write_fake_pnpm "$TMP49" "$ALLOWLISTED_JSON" 1
if out="$(run_gate_in_subshell "$TMP49" 2>/dev/null)"; then
  if printf '%s' "$out" | grep -q 'PASSED'; then
    pass "real allowlist + 3 known advisories → still PASSES after Fix 2"
  else
    fail "real allowlist + 3 known advisories: status line missing 'PASSED': $out"
  fi
else
  fail "real allowlist + 3 known advisories → exited non-zero — Fix 2 regression"
fi
rm -rf "$TMP49"

# --- Fix 3: whitespace-only SKIP_AUDIT_REASON rejection ----------------------

# Test 50: SKIP_AUDIT=1 with spaces-only reason → ABORTS
printf '\nTest 50: SKIP_AUDIT=1, SKIP_AUDIT_REASON="   " (spaces only) → ABORTS\n'
TMP50="$(setup_fake_pnpm)"
write_fake_pnpm "$TMP50" "$CLEAN_JSON" 0
rc=0
stderr_out="$(env PATH="$TMP50:$PATH" REPO_ROOT="$REPO_ROOT" SKIP_AUDIT=1 SKIP_AUDIT_REASON="   " bash -c "
  source '$GATE_SCRIPT'
  AUDIT_STATUS_LINE=''
  run_audit_gate
" 2>&1 >/dev/null)" || rc=$?
if [[ $rc -ne 0 ]]; then
  pass "SKIP_AUDIT_REASON spaces-only → gate ABORTS (exit non-zero)"
else
  fail "SKIP_AUDIT_REASON spaces-only → gate bypassed — whitespace-only reason accepted"
fi
if printf '%s' "$stderr_out" | grep -qi 'empty\|whitespace\|SKIP_AUDIT_REASON'; then
  pass "spaces-only reason prints rejection message"
else
  fail "spaces-only reason missing rejection message in stderr: $stderr_out"
fi
rm -rf "$TMP50"

# Test 51: SKIP_AUDIT=1 with tabs-only reason → ABORTS
printf '\nTest 51: SKIP_AUDIT=1, SKIP_AUDIT_REASON=$'"'"'\t\t'"'"' (tabs only) → ABORTS\n'
TMP51="$(setup_fake_pnpm)"
write_fake_pnpm "$TMP51" "$CLEAN_JSON" 0
rc=0
stderr_out="$(env PATH="$TMP51:$PATH" REPO_ROOT="$REPO_ROOT" SKIP_AUDIT=1 "SKIP_AUDIT_REASON=$(printf '\t\t')" bash -c "
  source '$GATE_SCRIPT'
  AUDIT_STATUS_LINE=''
  run_audit_gate
" 2>&1 >/dev/null)" || rc=$?
if [[ $rc -ne 0 ]]; then
  pass "SKIP_AUDIT_REASON tabs-only → gate ABORTS (exit non-zero)"
else
  fail "SKIP_AUDIT_REASON tabs-only → gate bypassed — tabs-only reason accepted"
fi
if printf '%s' "$stderr_out" | grep -qi 'empty\|whitespace\|SKIP_AUDIT_REASON'; then
  pass "tabs-only reason prints rejection message"
else
  fail "tabs-only reason missing rejection message in stderr: $stderr_out"
fi
rm -rf "$TMP51"

# Test 52: SKIP_AUDIT=1 with valid reason surrounded by spaces → BYPASSES, manifest records trimmed reason
printf '\nTest 52: SKIP_AUDIT=1 with "  valid reason  " (padded) → BYPASSES, status records trimmed reason\n'
TMP52="$(setup_fake_pnpm)"
write_fake_pnpm "$TMP52" "$NEW_CRITICAL_JSON" 1
PADDED_REASON="  accepted per SECURITY.md  "
if out="$(env PATH="$TMP52:$PATH" REPO_ROOT="$REPO_ROOT" SKIP_AUDIT=1 SKIP_AUDIT_REASON="$PADDED_REASON" bash -c "
  source '$GATE_SCRIPT'
  AUDIT_STATUS_LINE=''
  run_audit_gate
  printf '%s' \"\$AUDIT_STATUS_LINE\"
" 2>/dev/null)"; then
  pass "padded valid reason → bypasses (exit 0)"
  if printf '%s' "$out" | grep -q 'BYPASSED'; then
    pass "padded valid reason → BYPASSED recorded in status line"
  else
    fail "padded valid reason → BYPASSED missing from status line: $out"
  fi
  if printf '%s' "$out" | grep -q 'accepted per SECURITY.md'; then
    pass "padded valid reason → trimmed reason text in status line"
  else
    fail "padded valid reason → reason text missing from status line: $out"
  fi
else
  fail "padded valid reason → unexpected non-zero exit"
fi
rm -rf "$TMP52"

# --- Fix 4: temp file cleanup after gate error/abort -------------------------

# Test 53: pnpm command failure → no temp files left in system temp dir
printf '\nTest 53: pnpm infra failure → audit temp stderr file is cleaned up (no leak)\n'
# Create an isolated tmpdir that the fake pnpm will use as TMPDIR so we can
# verify no files are left after the gate aborts.
ISOLATED_TMPDIR="$(mktemp -d)"
TMP53="$(setup_fake_pnpm)"
write_fake_pnpm "$TMP53" "$INFRA_ERROR_OUTPUT" 1
rc=0
env PATH="$TMP53:$PATH" REPO_ROOT="$REPO_ROOT" TMPDIR="$ISOLATED_TMPDIR" bash -c "
  source '$GATE_SCRIPT'
  AUDIT_STATUS_LINE=''
  run_audit_gate
" 2>/dev/null || rc=$?
# The gate must have exited non-zero (infra path)
if [[ $rc -ne 0 ]]; then
  pass "pnpm infra failure → gate exited non-zero (expected)"
else
  fail "pnpm infra failure → gate did not abort as expected"
fi
# Check that no stray temp files remain in the isolated TMPDIR
remaining="$(find "$ISOLATED_TMPDIR" -type f 2>/dev/null | wc -l | tr -d ' ')"
if [[ "$remaining" == "0" ]]; then
  pass "pnpm infra failure → no temp files leaked in TMPDIR"
else
  fail "pnpm infra failure → $remaining temp file(s) left in TMPDIR (leak detected)"
  find "$ISOLATED_TMPDIR" -type f | while read -r f; do printf '    leaked: %s\n' "$f"; done
fi
rm -rf "$TMP53" "$ISOLATED_TMPDIR"

# --- Fix 1 message-interpolation tests ----------------------------------------
# These verify that the duplicate-id and expired-entry diagnostic messages
# contain the actual GHSA id string (not collapsed JS concatenation text).

# Test 54: duplicate GHSA id in allowlist → stderr message contains the actual GHSA id
printf '\nTest 54: duplicate GHSA id in allowlist → stderr message contains actual GHSA id string\n'
DUP_ID="GHSA-aaaa-bbbb-cccc"
DUPLICATE_ID_ALLOWLIST_54="$(printf '[{"id":"%s","package":"some-pkg","severity":"critical","reason":"test","expires":"%s"},{"id":"%s","package":"some-pkg","severity":"critical","reason":"dup","expires":"%s"}]' \
  "$DUP_ID" "$FUTURE_EXPIRES" "$DUP_ID" "$FUTURE_EXPIRES")"
TMPD54_AL="$(write_temp_allowlist "$DUPLICATE_ID_ALLOWLIST_54")"
TMP54="$(setup_fake_pnpm)"
write_fake_pnpm "$TMP54" "$CLEAN_JSON" 0
rc=0
stderr_out="$(env PATH="$TMP54:$PATH" REPO_ROOT="$REPO_ROOT" bash -c "
  set -euo pipefail
  AUDIT_GATE_TEST_MODE=1
  AUDIT_ALLOWLIST='$TMPD54_AL/allowlist.json'
  source '$GATE_SCRIPT'
  AUDIT_STATUS_LINE=''
  run_audit_gate
" 2>&1 >/dev/null)" || rc=$?
if [[ $rc -ne 0 ]]; then
  pass "duplicate GHSA id → gate ABORTS (exit non-zero)"
else
  fail "duplicate GHSA id → gate passed — duplicate not detected"
fi
if printf '%s' "$stderr_out" | grep -qF "$DUP_ID"; then
  pass "duplicate GHSA id → stderr message contains the actual GHSA id ($DUP_ID)"
else
  fail "duplicate GHSA id → stderr message MISSING the actual GHSA id ($DUP_ID); got: $stderr_out"
fi
rm -rf "$TMP54" "$TMPD54_AL"

# Test 55: expired allowlist entry → stderr message contains the actual GHSA id
printf '\nTest 55: expired allowlist entry → stderr message contains actual GHSA id string\n'
EXPIRED_ID="GHSA-aaaa-bbbb-cccc"
EXPIRED_ALLOWLIST_55="$(printf '[{"id":"%s","package":"shell-quote","severity":"critical","reason":"test","expires":"%s"}]' \
  "$EXPIRED_ID" "$PAST_EXPIRES")"
TMPD55_AL="$(write_temp_allowlist "$EXPIRED_ALLOWLIST_55")"
TMP55="$(setup_fake_pnpm)"
write_fake_pnpm "$TMP55" "$CLEAN_JSON" 0
rc=0
stderr_out="$(env PATH="$TMP55:$PATH" REPO_ROOT="$REPO_ROOT" bash -c "
  set -euo pipefail
  AUDIT_GATE_TEST_MODE=1
  AUDIT_ALLOWLIST='$TMPD55_AL/allowlist.json'
  source '$GATE_SCRIPT'
  AUDIT_STATUS_LINE=''
  run_audit_gate
" 2>&1 >/dev/null)" || rc=$?
if [[ $rc -ne 0 ]]; then
  pass "expired entry → gate ABORTS (exit non-zero)"
else
  fail "expired entry → gate passed — expiry not enforced"
fi
if printf '%s' "$stderr_out" | grep -qF "$EXPIRED_ID"; then
  pass "expired entry → stderr message contains the actual GHSA id ($EXPIRED_ID)"
else
  fail "expired entry → stderr message MISSING the actual GHSA id ($EXPIRED_ID); got: $stderr_out"
fi
rm -rf "$TMP55" "$TMPD55_AL"

# --- Fix 2 trap-restoration tests (success path) ------------------------------

# Test 56: caller INT and TERM traps are preserved on the SUCCESS path
# We install sentinel traps before sourcing the gate, run the gate through a
# success path, then verify trap -p INT and trap -p TERM still show our handlers.
printf '\nTest 56: success path → caller INT and TERM traps are restored after run_audit_gate\n'
TMP56="$(setup_fake_pnpm)"
write_fake_pnpm "$TMP56" "$CLEAN_JSON" 0
trap_check_out="$(env PATH="$TMP56:$PATH" REPO_ROOT="$REPO_ROOT" bash -c "
  set -euo pipefail
  source '$GATE_SCRIPT'
  # Install sentinel caller traps AFTER sourcing (gate is not yet called).
  trap 'echo SENTINEL_INT'  INT
  trap 'echo SENTINEL_TERM' TERM
  AUDIT_STATUS_LINE=''
  run_audit_gate
  # After the successful return, report what trap -p shows for INT and TERM.
  trap -p INT
  trap -p TERM
" 2>/dev/null)"
if printf '%s' "$trap_check_out" | grep -q 'SENTINEL_INT'; then
  pass "success path → caller INT trap is restored (sentinel handler still registered)"
else
  fail "success path → caller INT trap was DESTROYED (sentinel handler missing); trap output: $trap_check_out"
fi
if printf '%s' "$trap_check_out" | grep -q 'SENTINEL_TERM'; then
  pass "success path → caller TERM trap is restored (sentinel handler still registered)"
else
  fail "success path → caller TERM trap was DESTROYED (sentinel handler missing); trap output: $trap_check_out"
fi
rm -rf "$TMP56"

# --- Fix 1: AUDIT_ALLOWLIST env-bypass regression test ------------------------
#
# On the release path (AUDIT_GATE_TEST_MODE not set / not "1"), the gate must
# IGNORE any AUDIT_ALLOWLIST env var and always use the repo-relative allowlist.
# A permissive allowlist injected via env must not cause the gate to pass when
# the repo allowlist does not cover the advisory.

# Test 57: release path ignores AUDIT_ALLOWLIST env var — injected permissive
# allowlist does NOT suppress a new critical that the repo allowlist lacks.
printf '\nTest 57 (Fix 1): release path ignores AUDIT_ALLOWLIST env var — injected permissive allowlist is NOT honoured\n'
# Build a permissive allowlist that accepts the new-critical GHSA-zzzz-zzzz-zzzz
PERMISSIVE_ALLOWLIST_DIR="$(mktemp -d)"
printf '[{"id":"GHSA-zzzz-zzzz-zzzz","package":"some-pkg","severity":"critical","reason":"evil bypass","expires":"%s"}]' \
  "$FUTURE_EXPIRES" > "$PERMISSIVE_ALLOWLIST_DIR/evil.json"
TMP57="$(setup_fake_pnpm)"
# NEW_CRITICAL_JSON has GHSA-zzzz-zzzz-zzzz — not in real repo allowlist
write_fake_pnpm "$TMP57" "$NEW_CRITICAL_JSON" 1
rc=0
stderr_out="$(env PATH="$TMP57:$PATH" REPO_ROOT="$REPO_ROOT" \
  AUDIT_ALLOWLIST="$PERMISSIVE_ALLOWLIST_DIR/evil.json" bash -c "
  source '$GATE_SCRIPT'
  AUDIT_STATUS_LINE=''
  run_audit_gate
" 2>&1 >/dev/null)" || rc=$?
if [[ $rc -ne 0 ]]; then
  pass "Fix 1 release-path: AUDIT_ALLOWLIST env var ignored — live critical still fails gate (exit non-zero)"
else
  fail "Fix 1 release-path: AUDIT_ALLOWLIST env var was honoured on release path — env-bypass not closed"
fi
if printf '%s' "$stderr_out" | grep -q 'NON-ALLOWLISTED'; then
  pass "Fix 1 release-path: gate reports NON-ALLOWLISTED (advisory not suppressed by injected allowlist)"
else
  fail "Fix 1 release-path: NON-ALLOWLISTED message missing; advisory may have been suppressed: $stderr_out"
fi
rm -rf "$TMP57" "$PERMISSIVE_ALLOWLIST_DIR"

# Test 67: both AUDIT_GATE_TEST_MODE=1 AND AUDIT_ALLOWLIST=/tmp/evil.json set in
# the inherited environment — the two-var attack must still be neutralized.
# Defense-in-depth: release-usb.sh unsets both vars before sourcing; the gate's
# path-scope guard rejects /tmp/... paths even if the sentinels somehow survive.
# This test exercises the gate's own path-scope guard (no release-usb.sh unset
# is involved here, because we source the gate directly — but the path outside
# scripts/ is rejected by the belt-and-suspenders check in audit-gate.sh).
printf '\nTest 67 (Fix 1 depth): AUDIT_GATE_TEST_MODE=1 + AUDIT_ALLOWLIST=/tmp/evil.json → still FAILS on live critical\n'
PERMISSIVE_ALLOWLIST_DIR67="$(mktemp -d)"
printf '[{"id":"GHSA-zzzz-zzzz-zzzz","package":"some-pkg","severity":"critical","reason":"evil bypass","expires":"%s"}]' \
  "$FUTURE_EXPIRES" > "$PERMISSIVE_ALLOWLIST_DIR67/evil.json"
TMP67="$(setup_fake_pnpm)"
write_fake_pnpm "$TMP67" "$NEW_CRITICAL_JSON" 1
rc=0
stderr_out="$(env PATH="$TMP67:$PATH" REPO_ROOT="$REPO_ROOT" \
  AUDIT_GATE_TEST_MODE=1 \
  AUDIT_ALLOWLIST="$PERMISSIVE_ALLOWLIST_DIR67/evil.json" bash -c "
  source '$GATE_SCRIPT'
  AUDIT_STATUS_LINE=''
  run_audit_gate
" 2>&1 >/dev/null)" || rc=$?
if [[ $rc -ne 0 ]]; then
  pass "Fix 1 depth: both sentinels set with /tmp path → live critical still fails gate (path-scope guard)"
else
  fail "Fix 1 depth: both sentinels + /tmp path → gate PASSED — two-var bypass not closed"
fi
if printf '%s' "$stderr_out" | grep -q 'NON-ALLOWLISTED'; then
  pass "Fix 1 depth: NON-ALLOWLISTED emitted — /tmp allowlist was not honoured"
else
  fail "Fix 1 depth: NON-ALLOWLISTED missing — advisory may have been suppressed: $stderr_out"
fi
rm -rf "$TMP67" "$PERMISSIVE_ALLOWLIST_DIR67"

# --- Fix 2: exact metadata reconciliation (iteratedHighCrit !== metaHighCrit) -
#
# The prior check only caught metaHighCrit > iteratedHighCrit.  A payload with
# an allowlisted critical advisory (iteratedHighCrit=1) and metadata reporting
# critical:0 (metaHighCrit=0) passed silently — iteratedHighCrit > metaHighCrit
# was accepted.  The fix requires strict equality in both directions.

# Test 58: v6 schema — allowlisted critical advisory + metadata critical:0 → ABORTS (exit 3)
# iteratedHighCrit=1 (counted before allowlist suppression), metaHighCrit=0 — mismatch
printf '\nTest 58 (Fix 2, v6): allowlisted critical + metadata critical:0 → ABORTS (inconsistent)\n'
# Payload: shell-quote critical (GHSA-w7jw-789q-3m8p — in real allowlist) but metadata says critical:0
ALLOWLISTED_CRIT_META_ZERO_JSON='{"advisories":{"1":{"findings":[],"id":1,"severity":"critical","module_name":"shell-quote","title":"shell-quote vuln","github_advisory_id":"GHSA-w7jw-789q-3m8p","vulnerable_versions":"<=1.8.3","cves":[]}},"muted":[],"metadata":{"vulnerabilities":{"high":0,"critical":0}}}'
TMP58="$(setup_fake_pnpm)"
write_fake_pnpm "$TMP58" "$ALLOWLISTED_CRIT_META_ZERO_JSON" 1
rc=0
stderr_out="$(run_gate_in_subshell "$TMP58" 2>&1 >/dev/null)" || rc=$?
if [[ $rc -ne 0 ]]; then
  pass "Fix 2 v6: allowlisted critical + metadata critical:0 → gate ABORTS (iterated > meta)"
else
  fail "Fix 2 v6: allowlisted critical + metadata critical:0 → gate PASSED — fail-open (iterated > meta not caught)"
fi
if printf '%s' "$stderr_out" | grep -q 'inconsistent'; then
  pass "Fix 2 v6: inconsistency message printed"
else
  fail "Fix 2 v6: inconsistency message missing in stderr: $stderr_out"
fi
rm -rf "$TMP58"

# Test 59: v6 schema — allowlisted critical advisory + metadata critical:0,high:0 lower than iterated → ABORTS
# Same as 58 but testing with a high advisory and metadata high:0 (iterated=1, meta=0)
printf '\nTest 59 (Fix 2, v6): allowlisted high advisory + metadata high:0 → ABORTS (inconsistent)\n'
# Payload: esbuild high (GHSA-gv7w-rqvm-qjhr — in real allowlist) but metadata says high:0
ALLOWLISTED_HIGH_META_ZERO_JSON='{"advisories":{"3":{"findings":[],"id":3,"severity":"high","module_name":"esbuild","title":"esbuild vuln","github_advisory_id":"GHSA-gv7w-rqvm-qjhr","vulnerable_versions":"<0.28.1","cves":[]}},"muted":[],"metadata":{"vulnerabilities":{"high":0,"critical":0}}}'
TMP59="$(setup_fake_pnpm)"
write_fake_pnpm "$TMP59" "$ALLOWLISTED_HIGH_META_ZERO_JSON" 1
rc=0
stderr_out="$(run_gate_in_subshell "$TMP59" 2>&1 >/dev/null)" || rc=$?
if [[ $rc -ne 0 ]]; then
  pass "Fix 2 v6: allowlisted high + metadata high:0 → gate ABORTS (iterated > meta)"
else
  fail "Fix 2 v6: allowlisted high + metadata high:0 → gate PASSED — fail-open (iterated > meta not caught)"
fi
if printf '%s' "$stderr_out" | grep -q 'inconsistent'; then
  pass "Fix 2 v6: inconsistency message printed"
else
  fail "Fix 2 v6: inconsistency message missing in stderr: $stderr_out"
fi
rm -rf "$TMP59"

# Test 60: v7 schema — allowlisted critical advisory + metadata critical:0 → ABORTS (exit 3)
# iteratedHighCrit=1 (shell-quote critical, allowlisted in real allowlist), metaHighCrit=0 — mismatch
printf '\nTest 60 (Fix 2, v7): v7 allowlisted critical + metadata critical:0 → ABORTS (inconsistent)\n'
VULN_ALLOWLISTED_META_ZERO_JSON='{"vulnerabilities":{"shell-quote":{"name":"shell-quote","severity":"critical","via":[{"ghsaId":"GHSA-w7jw-789q-3m8p","title":"shell-quote vuln","severity":"critical"}],"effects":[],"range":"*","nodes":[],"fixAvailable":false}},"metadata":{"vulnerabilities":{"critical":0,"high":0}}}'
TMP60="$(setup_fake_pnpm)"
write_fake_pnpm "$TMP60" "$VULN_ALLOWLISTED_META_ZERO_JSON" 1
rc=0
stderr_out="$(run_gate_in_subshell "$TMP60" 2>&1 >/dev/null)" || rc=$?
if [[ $rc -ne 0 ]]; then
  pass "Fix 2 v7: allowlisted critical + metadata critical:0 → gate ABORTS (iterated > meta)"
else
  fail "Fix 2 v7: allowlisted critical + metadata critical:0 → gate PASSED — fail-open (iterated > meta not caught)"
fi
if printf '%s' "$stderr_out" | grep -q 'inconsistent'; then
  pass "Fix 2 v7: inconsistency message printed"
else
  fail "Fix 2 v7: inconsistency message missing in stderr: $stderr_out"
fi
rm -rf "$TMP60"

# Test 61: consistent v6 — allowlisted critical + metadata critical:1 (equal) → still PASSES
# Regression guard: the fix must not break the legitimate all-allowlisted pass case
printf '\nTest 61 (Fix 2, v6 regression): allowlisted critical + matching metadata critical:1 → still PASSES\n'
TMP61="$(setup_fake_pnpm)"
# Use the pre-existing ALLOWLISTED_JSON (critical:1, high:2 — all in real allowlist)
write_fake_pnpm "$TMP61" "$ALLOWLISTED_JSON" 1
if out="$(run_gate_in_subshell "$TMP61" 2>/dev/null)"; then
  if printf '%s' "$out" | grep -q 'PASSED'; then
    pass "Fix 2 v6 regression: allowlisted advisories + consistent metadata → still PASSES"
  else
    fail "Fix 2 v6 regression: gate passed but status line missing 'PASSED': $out"
  fi
else
  fail "Fix 2 v6 regression: allowlisted advisories + consistent metadata exited non-zero — regression"
fi
rm -rf "$TMP61"

# Test 62: consistent v7 — allowlisted advisories + matching metadata → still PASSES
printf '\nTest 62 (Fix 2, v7 regression): v7 allowlisted advisories + matching metadata → still PASSES\n'
TMP62="$(setup_fake_pnpm)"
write_fake_pnpm "$TMP62" "$VULN_SCHEMA_ALLOWLISTED_JSON" 1
if out="$(run_gate_in_subshell "$TMP62" 2>/dev/null)"; then
  if printf '%s' "$out" | grep -q 'PASSED'; then
    pass "Fix 2 v7 regression: v7 allowlisted advisories + consistent metadata → still PASSES"
  else
    fail "Fix 2 v7 regression: gate passed but status line missing 'PASSED': $out"
  fi
else
  fail "Fix 2 v7 regression: v7 allowlisted advisories + consistent metadata exited non-zero — regression"
fi
rm -rf "$TMP62"

# --- Fix 3: INT/TERM signal propagation tests ---------------------------------
#
# Prior to Fix 3, the single _audit_gate_cleanup was installed on EXIT INT TERM.
# When INT or TERM fired it cleaned up and restored caller traps but never
# re-raised the signal — so run_audit_gate returned (or exited) with no signal
# propagation and the caller continued on to the next step.
#
# Fix 3 installs separate _audit_gate_signal_INT / _audit_gate_signal_TERM
# handlers that re-raise the signal via "kill -SIGNAL $$" after cleanup, so:
#   a) the gate process terminates with signal-correct exit status
#   b) any pre-existing caller TERM/INT handler executes
#   c) the caller does NOT continue past run_audit_gate

# Stub pnpm variant that sends a signal to a specific target PID read from the
# AUDIT_TARGET_PID environment variable.  The caller sets this to $$ (its own
# PID) so the signal reaches the process running run_audit_gate — not the
# command-substitution subshell that is pnpm's direct parent.
write_signal_pnpm() {
  local bindir="$1"
  local signame="$2"   # INT or TERM
  cat > "$bindir/pnpm" <<STUB
#!/usr/bin/env bash
if [[ "\${1:-}" == "audit" ]]; then
  kill -${signame} "\${AUDIT_TARGET_PID:-\$PPID}"
  exit 1
fi
exec pnpm-real "\$@"
STUB
  chmod +x "$bindir/pnpm"
}

# Test 63: TERM signal delivered to the gate process → caller does NOT continue
# AUDIT_TARGET_PID=\$\$ is expanded at subshell creation so pnpm signals the
# bash process running run_audit_gate (not the $(…) substitution child).
printf '\nTest 63 (Fix 3): TERM signal to gate process → caller does NOT reach post-gate "continued" marker\n'
TMP63="$(setup_fake_pnpm)"
write_signal_pnpm "$TMP63" TERM
continued_output="$(env PATH="$TMP63:$PATH" REPO_ROOT="$REPO_ROOT" bash -c "
  source '$GATE_SCRIPT'
  AUDIT_STATUS_LINE=''
  AUDIT_TARGET_PID=\$\$ run_audit_gate || true
  printf 'CONTINUED_AFTER_GATE\n'
" 2>/dev/null)" || true
if printf '%s' "$continued_output" | grep -q 'CONTINUED_AFTER_GATE'; then
  fail "Fix 3 TERM: caller continued past run_audit_gate after TERM signal — signal not propagated"
else
  pass "Fix 3 TERM: caller did NOT continue past run_audit_gate after TERM signal (signal propagated)"
fi
rm -rf "$TMP63"

# Test 64: INT signal delivered to the gate process → caller does NOT continue
printf '\nTest 64 (Fix 3): INT signal to gate process → caller does NOT reach post-gate "continued" marker\n'
TMP64="$(setup_fake_pnpm)"
write_signal_pnpm "$TMP64" INT
continued_output="$(env PATH="$TMP64:$PATH" REPO_ROOT="$REPO_ROOT" bash -c "
  source '$GATE_SCRIPT'
  AUDIT_STATUS_LINE=''
  AUDIT_TARGET_PID=\$\$ run_audit_gate || true
  printf 'CONTINUED_AFTER_GATE\n'
" 2>/dev/null)" || true
if printf '%s' "$continued_output" | grep -q 'CONTINUED_AFTER_GATE'; then
  fail "Fix 3 INT: caller continued past run_audit_gate after INT signal — signal not propagated"
else
  pass "Fix 3 INT: caller did NOT continue past run_audit_gate after INT signal (signal propagated)"
fi
rm -rf "$TMP64"

# Test 65: pre-existing caller TERM handler executes when gate receives TERM
# The sentinel TERM handler writes a marker file then exits — both the handler
# execution and signal-correct termination are verified.
printf '\nTest 65 (Fix 3): pre-existing caller TERM handler executes when gate receives TERM\n'
TMP65="$(setup_fake_pnpm)"
write_signal_pnpm "$TMP65" TERM
MARKER65="$(mktemp)"
rm -f "$MARKER65"   # should not exist until handler runs
env PATH="$TMP65:$PATH" REPO_ROOT="$REPO_ROOT" bash -c "
  source '$GATE_SCRIPT'
  trap 'printf TERM_HANDLER_RAN > $MARKER65; exit 143' TERM
  AUDIT_STATUS_LINE=''
  AUDIT_TARGET_PID=\$\$ run_audit_gate
" 2>/dev/null || true
if [[ -f "$MARKER65" ]] && grep -q 'TERM_HANDLER_RAN' "$MARKER65" 2>/dev/null; then
  pass "Fix 3 TERM: pre-existing caller TERM handler executed (marker file written)"
else
  fail "Fix 3 TERM: pre-existing caller TERM handler did NOT execute (marker file missing or empty)"
fi
rm -f "$MARKER65"
rm -rf "$TMP65"

# Test 66: pre-existing caller INT handler executes when gate receives INT
printf '\nTest 66 (Fix 3): pre-existing caller INT handler executes when gate receives INT\n'
TMP66="$(setup_fake_pnpm)"
write_signal_pnpm "$TMP66" INT
MARKER66="$(mktemp)"
rm -f "$MARKER66"
env PATH="$TMP66:$PATH" REPO_ROOT="$REPO_ROOT" bash -c "
  source '$GATE_SCRIPT'
  trap 'printf INT_HANDLER_RAN > $MARKER66; exit 130' INT
  AUDIT_STATUS_LINE=''
  AUDIT_TARGET_PID=\$\$ run_audit_gate
" 2>/dev/null || true
if [[ -f "$MARKER66" ]] && grep -q 'INT_HANDLER_RAN' "$MARKER66" 2>/dev/null; then
  pass "Fix 3 INT: pre-existing caller INT handler executed (marker file written)"
else
  fail "Fix 3 INT: pre-existing caller INT handler did NOT execute (marker file missing or empty)"
fi
rm -f "$MARKER66"
rm -rf "$TMP66"

# --- Fix A: unknown advisory severity validation --------------------------------
#
# Prior to Fix A, any severity value other than "high" or "critical" (after
# normalisation) was silently skipped.  A typo like "critcal" was treated as
# below-threshold, the advisory was not counted, and the gate exited 0/PASSED.
# Fix A validates every advisory entry strictly: the entry must be a plain
# object, its severity must be a string, and its normalised value must be one
# of the five documented audit enums (info, low, moderate, high, critical).
# Anything outside that set → exit 3 (malformed payload).

# v6 payloads for Fix A tests
# misspelled severity "critcal" — not in enum
V6_MISSPELLED_SEV_JSON='{"advisories":{"1":{"findings":[],"id":1,"severity":"critcal","module_name":"some-pkg","title":"Bad","github_advisory_id":"GHSA-zzzz-zzzz-zzzz","vulnerable_versions":"<1.0.0","cves":[]}},"muted":[],"metadata":{"vulnerabilities":{"critical":1,"high":0}}}'
# missing severity field (undefined → not a string)
V6_MISSING_SEV_JSON='{"advisories":{"1":{"findings":[],"id":1,"module_name":"some-pkg","title":"Bad","github_advisory_id":"GHSA-zzzz-zzzz-zzzz","vulnerable_versions":"<1.0.0","cves":[]}},"muted":[],"metadata":{"vulnerabilities":{"critical":1,"high":0}}}'
# non-string severity (number 9)
V6_NUMERIC_SEV_JSON='{"advisories":{"1":{"findings":[],"id":1,"severity":9,"module_name":"some-pkg","title":"Bad","github_advisory_id":"GHSA-zzzz-zzzz-zzzz","vulnerable_versions":"<1.0.0","cves":[]}},"muted":[],"metadata":{"vulnerabilities":{"critical":1,"high":0}}}'
# null advisory entry
V6_NULL_ENTRY_JSON='{"advisories":{"1":null},"muted":[],"metadata":{"vulnerabilities":{"critical":0,"high":0}}}'
# legitimate info/low/moderate only — must still PASS
V6_BELOW_THRESHOLD_JSON='{"advisories":{"1":{"findings":[],"id":1,"severity":"low","module_name":"some-pkg","title":"Low sev","github_advisory_id":"GHSA-aaaa-aaaa-aaaa","vulnerable_versions":"<1.0.0","cves":[]},"2":{"findings":[],"id":2,"severity":"moderate","module_name":"other-pkg","title":"Moderate sev","github_advisory_id":"GHSA-bbbb-bbbb-bbbb","vulnerable_versions":"<2.0.0","cves":[]},"3":{"findings":[],"id":3,"severity":"info","module_name":"info-pkg","title":"Info sev","github_advisory_id":"GHSA-cccc-cccc-cccc","vulnerable_versions":"<3.0.0","cves":[]}},"muted":[],"metadata":{"vulnerabilities":{"info":1,"low":1,"moderate":1,"high":0,"critical":0}}}'

# v7 payloads for Fix A tests
V7_MISSPELLED_SEV_JSON='{"vulnerabilities":{"some-pkg":{"name":"some-pkg","severity":"critcal","via":[{"ghsaId":"GHSA-zzzz-zzzz-zzzz","title":"Bad","severity":"critcal"}],"effects":[],"range":"*","nodes":[],"fixAvailable":false}},"metadata":{"vulnerabilities":{"critical":1,"high":0}}}'
V7_MISSING_SEV_JSON='{"vulnerabilities":{"some-pkg":{"name":"some-pkg","via":[{"ghsaId":"GHSA-zzzz-zzzz-zzzz","title":"Bad","severity":"critical"}],"effects":[],"range":"*","nodes":[],"fixAvailable":false}},"metadata":{"vulnerabilities":{"critical":1,"high":0}}}'
V7_NUMERIC_SEV_JSON='{"vulnerabilities":{"some-pkg":{"name":"some-pkg","severity":9,"via":[{"ghsaId":"GHSA-zzzz-zzzz-zzzz","title":"Bad","severity":"critical"}],"effects":[],"range":"*","nodes":[],"fixAvailable":false}},"metadata":{"vulnerabilities":{"critical":1,"high":0}}}'
V7_NULL_ENTRY_JSON='{"vulnerabilities":{"some-pkg":null},"metadata":{"vulnerabilities":{"critical":0,"high":0}}}'
V7_BELOW_THRESHOLD_JSON='{"vulnerabilities":{"some-pkg":{"name":"some-pkg","severity":"low","via":[{"ghsaId":"GHSA-aaaa-aaaa-aaaa","title":"Low sev","severity":"low"}],"effects":[],"range":"*","nodes":[],"fixAvailable":false},"other-pkg":{"name":"other-pkg","severity":"moderate","via":[{"ghsaId":"GHSA-bbbb-bbbb-bbbb","title":"Moderate sev","severity":"moderate"}],"effects":[],"range":"*","nodes":[],"fixAvailable":false}},"metadata":{"vulnerabilities":{"info":0,"low":1,"moderate":1,"high":0,"critical":0}}}'

# Test 68 (Fix A, v6): misspelled severity "critcal" → ABORTS exit 3
printf '\nTest 68 (Fix A, v6): severity:"critcal" (typo) → ABORTS (exit 3, unknown severity)\n'
TMP68="$(setup_fake_pnpm)"
write_fake_pnpm "$TMP68" "$V6_MISSPELLED_SEV_JSON" 1
rc=0
stderr_out="$(env PATH="$TMP68:$PATH" REPO_ROOT="$REPO_ROOT" bash -c "
  source '$GATE_SCRIPT'
  AUDIT_STATUS_LINE=''
  run_audit_gate
" 2>&1 >/dev/null)" || rc=$?
if [[ $rc -ne 0 ]]; then
  pass "Fix A v6: misspelled severity 'critcal' → gate ABORTS (exit 3)"
else
  fail "Fix A v6: misspelled severity 'critcal' → gate PASSED — unknown severity not caught"
fi
if printf '%s' "$stderr_out" | grep -qi 'unknown severity\|malformed advisory'; then
  pass "Fix A v6: misspelled severity prints malformed-advisory message"
else
  fail "Fix A v6: misspelled severity missing malformed-advisory message: $stderr_out"
fi
rm -rf "$TMP68"

# Test 69 (Fix A, v6): missing severity field → ABORTS exit 3
printf '\nTest 69 (Fix A, v6): missing severity field → ABORTS (exit 3)\n'
TMP69="$(setup_fake_pnpm)"
write_fake_pnpm "$TMP69" "$V6_MISSING_SEV_JSON" 1
rc=0
stderr_out="$(env PATH="$TMP69:$PATH" REPO_ROOT="$REPO_ROOT" bash -c "
  source '$GATE_SCRIPT'
  AUDIT_STATUS_LINE=''
  run_audit_gate
" 2>&1 >/dev/null)" || rc=$?
if [[ $rc -ne 0 ]]; then
  pass "Fix A v6: missing severity field → gate ABORTS (exit 3)"
else
  fail "Fix A v6: missing severity field → gate PASSED — missing severity not caught"
fi
if printf '%s' "$stderr_out" | grep -qi 'severity is not a string\|malformed advisory'; then
  pass "Fix A v6: missing severity prints malformed-advisory message"
else
  fail "Fix A v6: missing severity missing malformed-advisory message: $stderr_out"
fi
rm -rf "$TMP69"

# Test 70 (Fix A, v6): non-string severity (number 9) → ABORTS exit 3
printf '\nTest 70 (Fix A, v6): severity:9 (number, not string) → ABORTS (exit 3)\n'
TMP70="$(setup_fake_pnpm)"
write_fake_pnpm "$TMP70" "$V6_NUMERIC_SEV_JSON" 1
rc=0
stderr_out="$(env PATH="$TMP70:$PATH" REPO_ROOT="$REPO_ROOT" bash -c "
  source '$GATE_SCRIPT'
  AUDIT_STATUS_LINE=''
  run_audit_gate
" 2>&1 >/dev/null)" || rc=$?
if [[ $rc -ne 0 ]]; then
  pass "Fix A v6: numeric severity → gate ABORTS (exit 3)"
else
  fail "Fix A v6: numeric severity → gate PASSED — non-string severity not caught"
fi
if printf '%s' "$stderr_out" | grep -qi 'severity is not a string\|malformed advisory'; then
  pass "Fix A v6: numeric severity prints malformed-advisory message"
else
  fail "Fix A v6: numeric severity missing malformed-advisory message: $stderr_out"
fi
rm -rf "$TMP70"

# Test 71 (Fix A, v6): null advisory entry → ABORTS exit 3
printf '\nTest 71 (Fix A, v6): advisories:{"1":null} (null entry) → ABORTS (exit 3)\n'
TMP71="$(setup_fake_pnpm)"
write_fake_pnpm "$TMP71" "$V6_NULL_ENTRY_JSON" 0
rc=0
stderr_out="$(env PATH="$TMP71:$PATH" REPO_ROOT="$REPO_ROOT" bash -c "
  source '$GATE_SCRIPT'
  AUDIT_STATUS_LINE=''
  run_audit_gate
" 2>&1 >/dev/null)" || rc=$?
if [[ $rc -ne 0 ]]; then
  pass "Fix A v6: null advisory entry → gate ABORTS (exit 3)"
else
  fail "Fix A v6: null advisory entry → gate PASSED — null entry not caught"
fi
if printf '%s' "$stderr_out" | grep -qi 'not a plain object\|malformed advisory'; then
  pass "Fix A v6: null entry prints malformed-advisory message"
else
  fail "Fix A v6: null entry missing malformed-advisory message: $stderr_out"
fi
rm -rf "$TMP71"

# Test 72 (Fix A, v6): info/low/moderate only → still PASSES (legitimate below-threshold)
printf '\nTest 72 (Fix A, v6 regression): info/low/moderate-only advisories → still PASSES\n'
TMP72="$(setup_fake_pnpm)"
write_fake_pnpm "$TMP72" "$V6_BELOW_THRESHOLD_JSON" 0
if out="$(run_gate_in_subshell "$TMP72" 2>/dev/null)"; then
  if printf '%s' "$out" | grep -q 'PASSED'; then
    pass "Fix A v6 regression: info/low/moderate-only payload → gate PASSES (below threshold, valid enum)"
  else
    fail "Fix A v6 regression: gate passed but status line missing 'PASSED': $out"
  fi
else
  fail "Fix A v6 regression: info/low/moderate-only payload exited non-zero — regression"
fi
rm -rf "$TMP72"

# Test 73 (Fix A, v7): misspelled severity "critcal" → ABORTS exit 3
printf '\nTest 73 (Fix A, v7): severity:"critcal" (typo) → ABORTS (exit 3)\n'
TMP73="$(setup_fake_pnpm)"
write_fake_pnpm "$TMP73" "$V7_MISSPELLED_SEV_JSON" 1
rc=0
stderr_out="$(env PATH="$TMP73:$PATH" REPO_ROOT="$REPO_ROOT" bash -c "
  source '$GATE_SCRIPT'
  AUDIT_STATUS_LINE=''
  run_audit_gate
" 2>&1 >/dev/null)" || rc=$?
if [[ $rc -ne 0 ]]; then
  pass "Fix A v7: misspelled severity 'critcal' → gate ABORTS (exit 3)"
else
  fail "Fix A v7: misspelled severity 'critcal' → gate PASSED — unknown severity not caught"
fi
if printf '%s' "$stderr_out" | grep -qi 'unknown severity\|malformed advisory'; then
  pass "Fix A v7: misspelled severity prints malformed-advisory message"
else
  fail "Fix A v7: misspelled severity missing malformed-advisory message: $stderr_out"
fi
rm -rf "$TMP73"

# Test 74 (Fix A, v7): missing severity field → ABORTS exit 3
printf '\nTest 74 (Fix A, v7): missing severity field → ABORTS (exit 3)\n'
TMP74="$(setup_fake_pnpm)"
write_fake_pnpm "$TMP74" "$V7_MISSING_SEV_JSON" 1
rc=0
stderr_out="$(env PATH="$TMP74:$PATH" REPO_ROOT="$REPO_ROOT" bash -c "
  source '$GATE_SCRIPT'
  AUDIT_STATUS_LINE=''
  run_audit_gate
" 2>&1 >/dev/null)" || rc=$?
if [[ $rc -ne 0 ]]; then
  pass "Fix A v7: missing severity field → gate ABORTS (exit 3)"
else
  fail "Fix A v7: missing severity field → gate PASSED — missing severity not caught"
fi
if printf '%s' "$stderr_out" | grep -qi 'severity is not a string\|malformed advisory'; then
  pass "Fix A v7: missing severity prints malformed-advisory message"
else
  fail "Fix A v7: missing severity missing malformed-advisory message: $stderr_out"
fi
rm -rf "$TMP74"

# Test 75 (Fix A, v7): non-string severity (number 9) → ABORTS exit 3
printf '\nTest 75 (Fix A, v7): severity:9 (number, not string) → ABORTS (exit 3)\n'
TMP75="$(setup_fake_pnpm)"
write_fake_pnpm "$TMP75" "$V7_NUMERIC_SEV_JSON" 1
rc=0
stderr_out="$(env PATH="$TMP75:$PATH" REPO_ROOT="$REPO_ROOT" bash -c "
  source '$GATE_SCRIPT'
  AUDIT_STATUS_LINE=''
  run_audit_gate
" 2>&1 >/dev/null)" || rc=$?
if [[ $rc -ne 0 ]]; then
  pass "Fix A v7: numeric severity → gate ABORTS (exit 3)"
else
  fail "Fix A v7: numeric severity → gate PASSED — non-string severity not caught"
fi
if printf '%s' "$stderr_out" | grep -qi 'severity is not a string\|malformed advisory'; then
  pass "Fix A v7: numeric severity prints malformed-advisory message"
else
  fail "Fix A v7: numeric severity missing malformed-advisory message: $stderr_out"
fi
rm -rf "$TMP75"

# Test 76 (Fix A, v7): null vulnerability entry → ABORTS exit 3
printf '\nTest 76 (Fix A, v7): vulnerabilities:{"some-pkg":null} (null entry) → ABORTS (exit 3)\n'
TMP76="$(setup_fake_pnpm)"
write_fake_pnpm "$TMP76" "$V7_NULL_ENTRY_JSON" 0
rc=0
stderr_out="$(env PATH="$TMP76:$PATH" REPO_ROOT="$REPO_ROOT" bash -c "
  source '$GATE_SCRIPT'
  AUDIT_STATUS_LINE=''
  run_audit_gate
" 2>&1 >/dev/null)" || rc=$?
if [[ $rc -ne 0 ]]; then
  pass "Fix A v7: null vulnerability entry → gate ABORTS (exit 3)"
else
  fail "Fix A v7: null vulnerability entry → gate PASSED — null entry not caught"
fi
if printf '%s' "$stderr_out" | grep -qi 'not a plain object\|malformed advisory'; then
  pass "Fix A v7: null entry prints malformed-advisory message"
else
  fail "Fix A v7: null entry missing malformed-advisory message: $stderr_out"
fi
rm -rf "$TMP76"

# Test 77 (Fix A, v7): info/low/moderate only → still PASSES
printf '\nTest 77 (Fix A, v7 regression): info/low/moderate-only vulnerabilities → still PASSES\n'
TMP77="$(setup_fake_pnpm)"
write_fake_pnpm "$TMP77" "$V7_BELOW_THRESHOLD_JSON" 0
if out="$(run_gate_in_subshell "$TMP77" 2>/dev/null)"; then
  if printf '%s' "$out" | grep -q 'PASSED'; then
    pass "Fix A v7 regression: info/low/moderate-only v7 payload → gate PASSES"
  else
    fail "Fix A v7 regression: gate passed but status line missing 'PASSED': $out"
  fi
else
  fail "Fix A v7 regression: info/low/moderate-only v7 payload exited non-zero — regression"
fi
rm -rf "$TMP77"


# --- Fix B: per-severity metadata reconciliation ------------------------------
#
# Prior to Fix B, reconciliation compared only combined high+critical totals.
# An allowlisted critical advisory (iteratedCritical=1, iteratedHigh=0) paired
# with metadata {high:1, critical:0} (metaHighCrit=1 == iteratedHighCrit=1)
# passed silently despite the per-severity mismatch.
# Fix B tracks iteratedHigh and iteratedCritical separately and requires BOTH
# metaHigh===iteratedHigh AND metaCritical===iteratedCritical.

# Test 78 (Fix B, v6): allowlisted critical + metadata {high:1,critical:0} → ABORTS
# iteratedHigh=0, iteratedCritical=1; metaHigh=1, metaCritical=0 — swapped
printf '\nTest 78 (Fix B, v6): allowlisted critical + metadata high:1,critical:0 → ABORTS (severity swap)\n'
ALLOWLISTED_CRIT_META_SWAP_JSON='{"advisories":{"1":{"findings":[],"id":1,"severity":"critical","module_name":"shell-quote","title":"shell-quote vuln","github_advisory_id":"GHSA-w7jw-789q-3m8p","vulnerable_versions":"<=1.8.3","cves":[]}},"muted":[],"metadata":{"vulnerabilities":{"high":1,"critical":0}}}'
TMP78="$(setup_fake_pnpm)"
write_fake_pnpm "$TMP78" "$ALLOWLISTED_CRIT_META_SWAP_JSON" 1
rc=0
stderr_out="$(run_gate_in_subshell "$TMP78" 2>&1 >/dev/null)" || rc=$?
if [[ $rc -ne 0 ]]; then
  pass "Fix B v6: allowlisted critical + metadata high:1,critical:0 → gate ABORTS (severity swap)"
else
  fail "Fix B v6: allowlisted critical + metadata high:1,critical:0 → gate PASSED — per-severity mismatch not caught"
fi
if printf '%s' "$stderr_out" | grep -q 'inconsistent'; then
  pass "Fix B v6: severity-swap prints inconsistency message"
else
  fail "Fix B v6: severity-swap missing inconsistency message: $stderr_out"
fi
rm -rf "$TMP78"

# Test 79 (Fix B, v6): allowlisted high + metadata {high:0,critical:1} → ABORTS
# iteratedHigh=1, iteratedCritical=0; metaHigh=0, metaCritical=1 — swapped other direction
printf '\nTest 79 (Fix B, v6): allowlisted high + metadata high:0,critical:1 → ABORTS (severity swap)\n'
ALLOWLISTED_HIGH_META_SWAP_JSON='{"advisories":{"3":{"findings":[],"id":3,"severity":"high","module_name":"esbuild","title":"esbuild vuln","github_advisory_id":"GHSA-gv7w-rqvm-qjhr","vulnerable_versions":"<0.28.1","cves":[]}},"muted":[],"metadata":{"vulnerabilities":{"high":0,"critical":1}}}'
TMP79="$(setup_fake_pnpm)"
write_fake_pnpm "$TMP79" "$ALLOWLISTED_HIGH_META_SWAP_JSON" 1
rc=0
stderr_out="$(run_gate_in_subshell "$TMP79" 2>&1 >/dev/null)" || rc=$?
if [[ $rc -ne 0 ]]; then
  pass "Fix B v6: allowlisted high + metadata high:0,critical:1 → gate ABORTS (severity swap)"
else
  fail "Fix B v6: allowlisted high + metadata high:0,critical:1 → gate PASSED — per-severity mismatch not caught"
fi
if printf '%s' "$stderr_out" | grep -q 'inconsistent'; then
  pass "Fix B v6: severity-swap (high→critical) prints inconsistency message"
else
  fail "Fix B v6: severity-swap (high→critical) missing inconsistency message: $stderr_out"
fi
rm -rf "$TMP79"

# Test 80 (Fix B, v7): allowlisted critical + metadata {high:1,critical:0} → ABORTS
printf '\nTest 80 (Fix B, v7): v7 allowlisted critical + metadata high:1,critical:0 → ABORTS (severity swap)\n'
VULN_CRIT_META_SWAP_JSON='{"vulnerabilities":{"shell-quote":{"name":"shell-quote","severity":"critical","via":[{"ghsaId":"GHSA-w7jw-789q-3m8p","title":"shell-quote vuln","severity":"critical"}],"effects":[],"range":"*","nodes":[],"fixAvailable":false}},"metadata":{"vulnerabilities":{"high":1,"critical":0}}}'
TMP80="$(setup_fake_pnpm)"
write_fake_pnpm "$TMP80" "$VULN_CRIT_META_SWAP_JSON" 1
rc=0
stderr_out="$(run_gate_in_subshell "$TMP80" 2>&1 >/dev/null)" || rc=$?
if [[ $rc -ne 0 ]]; then
  pass "Fix B v7: allowlisted critical + metadata high:1,critical:0 → gate ABORTS (severity swap)"
else
  fail "Fix B v7: allowlisted critical + metadata high:1,critical:0 → gate PASSED — per-severity mismatch not caught"
fi
if printf '%s' "$stderr_out" | grep -q 'inconsistent'; then
  pass "Fix B v7: severity-swap prints inconsistency message"
else
  fail "Fix B v7: severity-swap missing inconsistency message: $stderr_out"
fi
rm -rf "$TMP80"

# Test 81 (Fix B, v7): allowlisted high + metadata {high:0,critical:1} → ABORTS
printf '\nTest 81 (Fix B, v7): v7 allowlisted high + metadata high:0,critical:1 → ABORTS (severity swap)\n'
VULN_HIGH_META_SWAP_JSON='{"vulnerabilities":{"esbuild":{"name":"esbuild","severity":"high","via":[{"ghsaId":"GHSA-gv7w-rqvm-qjhr","title":"esbuild vuln","severity":"high"}],"effects":[],"range":"*","nodes":[],"fixAvailable":false}},"metadata":{"vulnerabilities":{"high":0,"critical":1}}}'
TMP81="$(setup_fake_pnpm)"
write_fake_pnpm "$TMP81" "$VULN_HIGH_META_SWAP_JSON" 1
rc=0
stderr_out="$(run_gate_in_subshell "$TMP81" 2>&1 >/dev/null)" || rc=$?
if [[ $rc -ne 0 ]]; then
  pass "Fix B v7: allowlisted high + metadata high:0,critical:1 → gate ABORTS (severity swap)"
else
  fail "Fix B v7: allowlisted high + metadata high:0,critical:1 → gate PASSED — per-severity mismatch not caught"
fi
if printf '%s' "$stderr_out" | grep -q 'inconsistent'; then
  pass "Fix B v7: severity-swap (high→critical) prints inconsistency message"
else
  fail "Fix B v7: severity-swap (high→critical) missing inconsistency message: $stderr_out"
fi
rm -rf "$TMP81"

# Test 82 (Fix B, v6 regression): consistent per-severity counts → still PASSES
# ALLOWLISTED_JSON: critical:1 high:2 — all in real allowlist, metadata matches exactly
printf '\nTest 82 (Fix B, v6 regression): consistent per-severity counts → still PASSES\n'
TMP82="$(setup_fake_pnpm)"
write_fake_pnpm "$TMP82" "$ALLOWLISTED_JSON" 1
if out="$(run_gate_in_subshell "$TMP82" 2>/dev/null)"; then
  if printf '%s' "$out" | grep -q 'PASSED'; then
    pass "Fix B v6 regression: consistent per-severity metadata → still PASSES"
  else
    fail "Fix B v6 regression: gate passed but status line missing 'PASSED': $out"
  fi
else
  fail "Fix B v6 regression: consistent per-severity metadata exited non-zero — regression"
fi
rm -rf "$TMP82"

# Test 83 (Fix B, v7 regression): consistent per-severity counts → still PASSES
# VULN_SCHEMA_ALLOWLISTED_JSON: critical:1 high:1 — allowlisted, metadata matches
printf '\nTest 83 (Fix B, v7 regression): v7 consistent per-severity counts → still PASSES\n'
TMP83="$(setup_fake_pnpm)"
write_fake_pnpm "$TMP83" "$VULN_SCHEMA_ALLOWLISTED_JSON" 1
if out="$(run_gate_in_subshell "$TMP83" 2>/dev/null)"; then
  if printf '%s' "$out" | grep -q 'PASSED'; then
    pass "Fix B v7 regression: v7 consistent per-severity metadata → still PASSES"
  else
    fail "Fix B v7 regression: gate passed but status line missing 'PASSED': $out"
  fi
else
  fail "Fix B v7 regression: v7 consistent per-severity metadata exited non-zero — regression"
fi
rm -rf "$TMP83"


# --- Fix C: signal propagation when caller handler returns normally -----------
#
# Prior to Fix C, after restoring the caller's handler and kill -SIGNAL $$,
# if the caller's handler returned normally (no explicit exit), control returned
# to the gate's signal handler which also returned, and execution continued —
# the caller reached CONTINUED_AFTER_GATE with exit 0.
# Fix C adds `exit 130` (INT) / `exit 143` (TERM) after the kill so that
# continuation is impossible even when the caller's handler returns normally.

# Test 84 (Fix C, TERM): caller TERM handler returns normally → caller NEVER
# reaches the post-gate marker; process exits non-zero.
printf '\nTest 84 (Fix C, TERM): caller TERM handler returns normally → caller does NOT continue\n'
TMP84="$(setup_fake_pnpm)"
write_signal_pnpm "$TMP84" TERM
MARKER84="$(mktemp)"
rm -f "$MARKER84"
rc=0
# The caller trap writes the marker and RETURNS (no exit) — before Fix C this
# allowed execution to continue past run_audit_gate.
continued_output="$(env PATH="$TMP84:$PATH" REPO_ROOT="$REPO_ROOT" bash -c "
  source '$GATE_SCRIPT'
  trap 'printf TERM_HANDLER_RAN > $MARKER84' TERM
  AUDIT_STATUS_LINE=''
  AUDIT_TARGET_PID=\$\$ run_audit_gate || true
  printf 'CONTINUED_AFTER_GATE\n'
" 2>/dev/null)" || rc=$?
if printf '%s' "$continued_output" | grep -q 'CONTINUED_AFTER_GATE'; then
  fail "Fix C TERM: caller continued past run_audit_gate even though TERM handler returned normally"
else
  pass "Fix C TERM: caller did NOT continue past run_audit_gate (TERM handler returned normally)"
fi
if [[ -f "$MARKER84" ]] && grep -q 'TERM_HANDLER_RAN' "$MARKER84" 2>/dev/null; then
  pass "Fix C TERM: caller TERM handler still ran (marker written) before forced exit"
else
  fail "Fix C TERM: caller TERM handler did NOT run (marker missing)"
fi
rm -f "$MARKER84"
rm -rf "$TMP84"

# Test 85 (Fix C, INT): caller INT handler returns normally → caller NEVER
# reaches the post-gate marker; process exits non-zero.
printf '\nTest 85 (Fix C, INT): caller INT handler returns normally → caller does NOT continue\n'
TMP85="$(setup_fake_pnpm)"
write_signal_pnpm "$TMP85" INT
MARKER85="$(mktemp)"
rm -f "$MARKER85"
rc=0
continued_output="$(env PATH="$TMP85:$PATH" REPO_ROOT="$REPO_ROOT" bash -c "
  source '$GATE_SCRIPT'
  trap 'printf INT_HANDLER_RAN > $MARKER85' INT
  AUDIT_STATUS_LINE=''
  AUDIT_TARGET_PID=\$\$ run_audit_gate || true
  printf 'CONTINUED_AFTER_GATE\n'
" 2>/dev/null)" || rc=$?
if printf '%s' "$continued_output" | grep -q 'CONTINUED_AFTER_GATE'; then
  fail "Fix C INT: caller continued past run_audit_gate even though INT handler returned normally"
else
  pass "Fix C INT: caller did NOT continue past run_audit_gate (INT handler returned normally)"
fi
if [[ -f "$MARKER85" ]] && grep -q 'INT_HANDLER_RAN' "$MARKER85" 2>/dev/null; then
  pass "Fix C INT: caller INT handler still ran (marker written) before forced exit"
else
  fail "Fix C INT: caller INT handler did NOT run (marker missing)"
fi
rm -f "$MARKER85"
rm -rf "$TMP85"

# Test 86 (Fix C cross-platform): body extraction works for both Linux bare name
# and macOS SIG-prefixed name formats using the eval-assign decode approach.
# The extraction: strip "trap -- " prefix, strip trailing " <SIGNAME>" token via
# sed, then eval-assign the remaining shell-quoted word into a plain variable.
# This test runs entirely in bash (no pnpm stub) so it guards the cross-platform
# path on a macOS CI host without requiring Linux hardware.
printf '\nTest 86 (Fix C cross-platform): eval-assign body extraction — Linux bare INT/TERM and macOS SIGINT/SIGTERM\n'

_t86_decode_body() {
  # Replicates the extraction logic from audit-gate.sh for testing purposes.
  local _trap_out="$1"
  local _body=""
  if [[ -n "${_trap_out}" ]]; then
    local _rest _quoted
    _rest="${_trap_out#trap -- }"
    _quoted="$(printf '%s' "${_rest}" | sed "s/ \(SIG\)\{0,1\}[A-Z][A-Z]*$//" 2>/dev/null || true)"
    eval "_body=${_quoted}" 2>/dev/null || _body=""
  fi
  printf '%s' "${_body}"
}

# Linux bare-name format
_t86_r="$(_t86_decode_body "trap -- 'printf LINUX_INT_BODY' INT")"
if [[ "$_t86_r" == "printf LINUX_INT_BODY" ]]; then
  pass "Fix C cross-platform: Linux bare INT — body decoded correctly"
else
  fail "Fix C cross-platform: Linux bare INT — got: '$_t86_r' (expected: 'printf LINUX_INT_BODY')"
fi

_t86_r="$(_t86_decode_body "trap -- 'printf LINUX_TERM_BODY' TERM")"
if [[ "$_t86_r" == "printf LINUX_TERM_BODY" ]]; then
  pass "Fix C cross-platform: Linux bare TERM — body decoded correctly"
else
  fail "Fix C cross-platform: Linux bare TERM — got: '$_t86_r' (expected: 'printf LINUX_TERM_BODY')"
fi

# macOS SIG-prefixed format
_t86_r="$(_t86_decode_body "trap -- 'printf MAC_INT_BODY' SIGINT")"
if [[ "$_t86_r" == "printf MAC_INT_BODY" ]]; then
  pass "Fix C cross-platform: macOS SIGINT — body decoded correctly"
else
  fail "Fix C cross-platform: macOS SIGINT — got: '$_t86_r' (expected: 'printf MAC_INT_BODY')"
fi

_t86_r="$(_t86_decode_body "trap -- 'printf MAC_TERM_BODY' SIGTERM")"
if [[ "$_t86_r" == "printf MAC_TERM_BODY" ]]; then
  pass "Fix C cross-platform: macOS SIGTERM — body decoded correctly"
else
  fail "Fix C cross-platform: macOS SIGTERM — got: '$_t86_r' (expected: 'printf MAC_TERM_BODY')"
fi

# Verify a decoded body actually executes via eval (full call path).
_t86_eval_result="$(eval "$(_t86_decode_body "trap -- 'printf LINUX_INT_BODY' INT")" 2>/dev/null || true)"
if [[ "$_t86_eval_result" == "LINUX_INT_BODY" ]]; then
  pass "Fix C cross-platform: eval of Linux-format decoded body executes correctly"
else
  fail "Fix C cross-platform: eval of Linux-format decoded body got: '$_t86_eval_result' (expected: 'LINUX_INT_BODY')"
fi

unset -f _t86_decode_body
unset _t86_r _t86_eval_result

# Test 87 (Fix C embedded apostrophe, INT): caller INT handler whose body contains
# an embedded single quote — the '\'' shell quoting idiom must survive the
# eval-assign decode so the handler body actually runs.
printf '\nTest 87 (Fix C embedded apostrophe, INT): caller INT handler with embedded single quote runs correctly\n'
TMP87="$(setup_fake_pnpm)"
write_signal_pnpm "$TMP87" INT
MARKER87="$(mktemp)"
rm -f "$MARKER87"
# The handler body is:  printf "it's here" > MARKER87
# trap -p will encode the apostrophe as '\'' inside the body string.
continued_output87="$(env PATH="$TMP87:$PATH" REPO_ROOT="$REPO_ROOT" bash -c "
  source '$GATE_SCRIPT'
  trap 'printf \"it'\''s here\" > $MARKER87' INT
  AUDIT_STATUS_LINE=''
  AUDIT_TARGET_PID=\$\$ run_audit_gate || true
  printf 'CONTINUED_AFTER_GATE\n'
" 2>/dev/null)" || true
if printf '%s' "$continued_output87" | grep -q 'CONTINUED_AFTER_GATE'; then
  fail "Fix C apostrophe INT: caller continued past run_audit_gate (apostrophe body, INT)"
else
  pass "Fix C apostrophe INT: caller did NOT continue past run_audit_gate"
fi
if [[ -f "$MARKER87" ]] && grep -qF "it's here" "$MARKER87" 2>/dev/null; then
  pass "Fix C apostrophe INT: handler body with embedded apostrophe executed correctly (marker contains apostrophe text)"
else
  fail "Fix C apostrophe INT: handler body did NOT execute or marker missing/wrong (got: '$(cat "$MARKER87" 2>/dev/null || echo MISSING)')"
fi
rm -f "$MARKER87"
rm -rf "$TMP87"

# Test 88 (Fix C embedded apostrophe, TERM): same for TERM signal.
printf '\nTest 88 (Fix C embedded apostrophe, TERM): caller TERM handler with embedded single quote runs correctly\n'
TMP88="$(setup_fake_pnpm)"
write_signal_pnpm "$TMP88" TERM
MARKER88="$(mktemp)"
rm -f "$MARKER88"
continued_output88="$(env PATH="$TMP88:$PATH" REPO_ROOT="$REPO_ROOT" bash -c "
  source '$GATE_SCRIPT'
  trap 'printf \"it'\''s done\" > $MARKER88' TERM
  AUDIT_STATUS_LINE=''
  AUDIT_TARGET_PID=\$\$ run_audit_gate || true
  printf 'CONTINUED_AFTER_GATE\n'
" 2>/dev/null)" || true
if printf '%s' "$continued_output88" | grep -q 'CONTINUED_AFTER_GATE'; then
  fail "Fix C apostrophe TERM: caller continued past run_audit_gate (apostrophe body, TERM)"
else
  pass "Fix C apostrophe TERM: caller did NOT continue past run_audit_gate"
fi
if [[ -f "$MARKER88" ]] && grep -qF "it's done" "$MARKER88" 2>/dev/null; then
  pass "Fix C apostrophe TERM: handler body with embedded apostrophe executed correctly (marker contains apostrophe text)"
else
  fail "Fix C apostrophe TERM: handler body did NOT execute or marker missing/wrong (got: '$(cat "$MARKER88" 2>/dev/null || echo MISSING)')"
fi
rm -f "$MARKER88"
rm -rf "$TMP88"

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
