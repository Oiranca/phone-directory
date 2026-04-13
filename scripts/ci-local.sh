#!/usr/bin/env bash
set -euo pipefail

echo "[1/3] Type checking"
npm run typecheck

echo "[2/3] Running tests"
npm run test

echo "[3/3] Building application"
npm run build

echo "Local CI checks passed."
