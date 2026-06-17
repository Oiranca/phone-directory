#!/usr/bin/env bash
set -euo pipefail

# Pre-commit verification — DELIBERATELY a lighter, faster variant of the full
# pipeline: typecheck + test + audit-gate SMOKE subset + build.  It runs the
# curated audit-gate smoke subset (~1.7s) instead of the exhaustive harness
# (~25s) so small/docs commits are not penalized.
#
# The CANONICAL full pipeline is `pnpm run ci` (package.json scripts.ci), which
# runs the EXHAUSTIVE audit-gate harness; scripts/ci-local.sh delegates to it.
# The remaining difference between this script and `pnpm run ci` is intentional,
# not configuration drift.

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$REPO_ROOT/tmp/ci"
STATUS_FILE="$LOG_DIR/pre-commit-status.txt"
REPORT_FILE="$LOG_DIR/pre-commit-report.txt"

mkdir -p "$LOG_DIR"

{
  echo "Pre-commit CI report"
  echo "Timestamp: $(date -u +"%Y-%m-%dT%H:%M:%SZ")"
  echo "Repository: $REPO_ROOT"
  echo
  echo "Staged files:"
  git -C "$REPO_ROOT" diff --cached --name-only || true
  echo
} > "$REPORT_FILE"

run_check() {
  local name="$1"
  shift

  echo "== $name ==" | tee -a "$REPORT_FILE"
  if "$@" >> "$REPORT_FILE" 2>&1; then
    echo "PASS $name" | tee -a "$STATUS_FILE"
    echo >> "$REPORT_FILE"
    return 0
  fi

  echo "FAIL $name" | tee -a "$STATUS_FILE"
  echo >> "$REPORT_FILE"
  return 1
}

: > "$STATUS_FILE"

set +e
run_check "typecheck" pnpm typecheck
TYPECHECK_EXIT=$?
run_check "test" pnpm test
TEST_EXIT=$?
# Pre-commit runs the FAST audit-gate SMOKE subset (a curated set of the most
# critical fail-closed behaviors) rather than the full ~200-assertion harness, so
# small/docs commits are not penalized.  The EXHAUSTIVE harness still runs in the
# canonical `pnpm run ci` and in release validation (scripts/ci-local.sh).
run_check "audit-gate-smoke" pnpm run test:audit-gate:smoke
AUDIT_GATE_EXIT=$?
run_check "build" pnpm run build
BUILD_EXIT=$?
set -e

if [[ $TYPECHECK_EXIT -eq 0 && $TEST_EXIT -eq 0 && $AUDIT_GATE_EXIT -eq 0 && $BUILD_EXIT -eq 0 ]]; then
  echo "Pre-commit CI passed." | tee -a "$REPORT_FILE"
  exit 0
fi

cat <<EOF | tee -a "$REPORT_FILE"
CI gate failed.
Expected behavior:
- inspect the failure report
- fix the repository locally
- re-run the failing checks
- re-stage the intended changes
EOF

echo
echo "Commit blocked. Fix the reported failures, re-stage as needed, and commit again."
echo "Failure report: $REPORT_FILE"

exit 1
