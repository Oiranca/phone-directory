#!/usr/bin/env bash
set -euo pipefail

# Single source of truth for the full verification pipeline.
#
# The canonical pipeline is defined ONCE in package.json `scripts.ci`
# (typecheck → test → test:audit-gate [exhaustive] → build).  This wrapper just
# delegates to it so there is no duplicated pipeline definition to drift.
#
# NOTE: scripts/run-precommit-ci.sh is intentionally a LIGHTER variant
# (typecheck + test + audit-gate SMOKE subset + build) so small/docs commits are
# not penalized by the ~25s exhaustive audit-gate harness.  That difference is
# deliberate — `pnpm run ci` (this script) is the canonical full pipeline.

echo "[ci-local] Running canonical full pipeline via 'pnpm run ci'"
exec pnpm run ci
