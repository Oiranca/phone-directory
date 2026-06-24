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
  # node fs.realpathSync.native.  Node is a hard repo dependency, so this third
  # fallback keeps the test path portable on minimal environments that lack both
  # realpath(1) and python3.
  # FAIL-CLOSED: if NONE of the resolvers is available (or canonicalization
  # fails everywhere), _AUDIT_OVERRIDE_FILE_REAL is left empty AND we treat that
  # as REJECTED — we do NOT fall back to accepting the override on the parent-dir
  # check alone.  An unresolvable file target could be a symlink to anywhere; the
  # only safe default is to use the pinned repo allowlist.
  # Prerequisite for test mode: realpath(1), python3, OR node must be present.
  # Try each resolver in order and FALL THROUGH on an empty/failed result, not
  # merely when the tool is absent: a resolver that is present but fails (exits
  # non-zero, or prints nothing) must not short-circuit the chain.  This keeps
  # the node fallback reachable even on a host where realpath/python3 exist but
  # cannot resolve the path.
  _AUDIT_OVERRIDE_FILE_REAL=""
  if command -v realpath >/dev/null 2>&1; then
    _AUDIT_OVERRIDE_FILE_REAL="$(realpath "${AUDIT_ALLOWLIST}" 2>/dev/null)" || _AUDIT_OVERRIDE_FILE_REAL=""
  fi
  if [[ -z "$_AUDIT_OVERRIDE_FILE_REAL" ]] && command -v python3 >/dev/null 2>&1; then
    _AUDIT_OVERRIDE_FILE_REAL="$(python3 -c "import os,sys; print(os.path.realpath(sys.argv[1]))" "${AUDIT_ALLOWLIST}" 2>/dev/null)" || _AUDIT_OVERRIDE_FILE_REAL=""
  fi
  if [[ -z "$_AUDIT_OVERRIDE_FILE_REAL" ]] && command -v node >/dev/null 2>&1; then
    _AUDIT_OVERRIDE_FILE_REAL="$(node -e 'process.stdout.write(require("fs").realpathSync.native(process.argv[1]))' "${AUDIT_ALLOWLIST}" 2>/dev/null)" || _AUDIT_OVERRIDE_FILE_REAL=""
  fi
  # Derive the real parent dir of the resolved file path (only when resolution succeeded).
  _AUDIT_OVERRIDE_FILE_DIR=""
  if [[ -n "$_AUDIT_OVERRIDE_FILE_REAL" ]]; then
    _AUDIT_OVERRIDE_FILE_DIR="$(dirname "$_AUDIT_OVERRIDE_FILE_REAL")"
  fi
  # Accept the override only when ALL of the following hold:
  #   1. The parent dir of the literal path is inside scripts/  (catches .. escapes)
  #   2. The real file target resolved successfully AND is also inside scripts/
  #      (catches symlink escapes; empty _AUDIT_OVERRIDE_FILE_REAL = no resolver
  #       available = REJECTED, fail-closed)
  if [[ -n "$_AUDIT_OVERRIDE_REAL" && "$_AUDIT_OVERRIDE_REAL/" == "$_AUDIT_SCRIPTS_DIR/"* ]] && \
     [[ -n "$_AUDIT_OVERRIDE_FILE_REAL" && "$_AUDIT_OVERRIDE_FILE_DIR/" == "$_AUDIT_SCRIPTS_DIR/"* ]]; then
    : # Override resolves inside scripts/ — honour it.
  else
    AUDIT_ALLOWLIST="$_AUDIT_GATE_SCRIPT_DIR/../audit-allowlist.json"
  fi
else
  # Production path (or test mode without an override): always use the
  # repo-relative allowlist, ignore any env value.
  AUDIT_ALLOWLIST="$_AUDIT_GATE_SCRIPT_DIR/../audit-allowlist.json"
fi

# Advisory-processing logic lives in the standalone ESM module audit-gate-core.mjs.
# The shell calls that module directly, passing the allowlist path and pnpm exit code
# as arguments and piping the audit JSON through stdin.  Exit-code contract:
#   0  — no non-allowlisted high/critical advisories (stdout: PASSED:<N>)
#   2  — non-allowlisted high/critical advisories found (stderr: [audit-gate] NON-ALLOWLISTED ...)
#   3  — JSON is unparseable, payload is malformed, or infra/registry error

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
    # Reject ONLY the Unicode line/paragraph separators that a line-aware manifest
    # parser or viewer could treat as a line break — these multi-byte UTF-8
    # sequences pass the \n/\r and tr '\000-\037\177' checks above and could be
    # used to inject a spoofed "Dependency audit: PASSED" line into
    # RELEASE_MANIFEST.txt:
    #   U+0085 NEL                  → UTF-8  C2 85
    #   U+2028 LINE SEPARATOR       → UTF-8  E2 80 A8
    #   U+2029 PARAGRAPH SEPARATOR  → UTF-8  E2 80 A9
    # Ordinary printable non-ASCII (e.g. "§", used in the documented bypass
    # examples in SECURITY.md / scripts/README.md) is ALLOWED.  We match the exact
    # byte sequences under LC_ALL=C with fixed-string (-F) patterns so detection is
    # encoding-agnostic (works under C and C.UTF-8) and portable across GNU and
    # macOS/BSD grep (no \| alternation).  grep -q returns 0 if any of the three
    # sequences is present.
    if printf '%s' "$_reason_trimmed" | LC_ALL=C grep -qF -e $'\xc2\x85' -e $'\xe2\x80\xa8' -e $'\xe2\x80\xa9'; then
      printf '[audit-gate] ✗ SKIP_AUDIT_REASON contains a Unicode line/paragraph separator (U+0085, U+2028, or U+2029).\n' >&2
      printf '[audit-gate]   Provide a single-line reason without Unicode line separators.\n' >&2
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

  # --audit-level=high makes pnpm's exit code AND printed advisories reflect only
  # advisories at or above "high" severity.  A tree whose only findings are
  # low/moderate then exits 0 and reports those low/moderate advisories without
  # treating them as a failure — matching this gate's policy of acting on
  # high/critical only.  Low/moderate advisories therefore never block a release
  # and never trip the non-zero-exit infra-inconsistency check below.
  audit_json="$(pnpm audit --json --audit-level=high 2>"$_pnpm_stderr_file")" || pnpm_exit=$?
  pnpm_stderr="$(cat "$_pnpm_stderr_file")"

  # Remove the temp file immediately now that we have captured its contents.
  # The EXIT trap is a belt-and-suspenders for the interruption path.
  rm -f "$_pnpm_stderr_file"
  trap - EXIT INT TERM
  eval "${_prev_trap_EXIT:-true}"  2>/dev/null || true
  eval "${_prev_trap_INT:-true}"   2>/dev/null || true
  eval "${_prev_trap_TERM:-true}"  2>/dev/null || true

  # Feed JSON through the advisory-processing module.
  # Pass the allowlist path and pnpm_exit as CLI args so the module can detect the
  # structurally-clean-but-non-zero case (non-zero+empty advisory container).
  local filter_output
  local filter_exit=0
  filter_output="$(printf '%s' "$audit_json" | node "$_AUDIT_GATE_SCRIPT_DIR/audit-gate-core.mjs" "$AUDIT_ALLOWLIST" "$pnpm_exit" 2>&1)" || filter_exit=$?

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
