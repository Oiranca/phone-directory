#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$REPO_ROOT/tmp/ci"
STATUS_FILE="$LOG_DIR/pre-commit-status.txt"
REPORT_FILE="$LOG_DIR/pre-commit-report.txt"
CODEX_OUTPUT_FILE="$LOG_DIR/codex-last-message.txt"

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
run_check "typecheck" npm run typecheck
TYPECHECK_EXIT=$?
run_check "test" npm run test
TEST_EXIT=$?
run_check "build" npm run build
BUILD_EXIT=$?
set -e

if [[ $TYPECHECK_EXIT -eq 0 && $TEST_EXIT -eq 0 && $BUILD_EXIT -eq 0 ]]; then
  echo "Pre-commit CI passed." | tee -a "$REPORT_FILE"
  exit 0
fi

cat <<EOF | tee -a "$REPORT_FILE"
CI gate failed.

Codex auto-fix mode will be invoked next.
Expected behavior:
- inspect the failure report
- fix the repository locally
- do not commit
- do not reset or discard changes
- stop after applying the smallest safe fix
EOF

if command -v codex >/dev/null 2>&1; then
  codex exec \
    -C "$REPO_ROOT" \
    --full-auto \
    --output-last-message "$CODEX_OUTPUT_FILE" \
    "You are fixing a failed pre-commit CI gate in this repository.

Read the failure report at: $REPORT_FILE

Requirements:
- fix the failing checks in the current working tree
- do not commit
- do not reset, clean, or discard user changes
- keep all code comments, identifiers, and documentation in English
- keep user-facing application text in Spanish
- after changes, rerun only the failing checks if needed
- finish with a short summary of what was fixed
"
else
  echo "Codex CLI not found. Auto-fix was skipped." | tee -a "$REPORT_FILE"
fi

echo
echo "Commit blocked. Review the applied changes, re-stage as needed, and commit again."
echo "Failure report: $REPORT_FILE"

exit 1
