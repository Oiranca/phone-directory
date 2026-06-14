#!/usr/bin/env bash
set -euo pipefail

echo "[1/4] Type checking"
pnpm typecheck

echo "[2/4] Running tests"
pnpm test

echo "[3/4] Running audit gate tests"
pnpm run test:audit-gate

echo "[4/4] Building application"
pnpm run build

echo "Local CI checks passed."
