#!/usr/bin/env bash
set -euo pipefail

echo "[1/3] Type checking"
pnpm typecheck

echo "[2/3] Running tests"
pnpm test

echo "[3/3] Building application"
pnpm run build

echo "Local CI checks passed."
