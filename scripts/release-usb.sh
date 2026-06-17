#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLATFORM="${1:-current}"
DIST_ROOT="$REPO_ROOT/dist-portable"
PACKAGE_ROOT="$DIST_ROOT/usb-package"

log() {
  printf '[release-usb] %s\n' "$1"
}

detect_platform() {
  case "$(uname -s)" in
    Darwin) printf 'mac' ;;
    Linux) printf 'linux' ;;
    MINGW*|MSYS*|CYGWIN*) printf 'win' ;;
    *) printf 'unsupported' ;;
  esac
}

# Read package version without require() so it works under Node 22+ ESM projects.
# node --input-type=module feeds the snippet as an ES module — no CJS assumption.
read_package_version() {
  node --input-type=module <<'NODESCRIPT'
import { readFileSync } from 'fs';
const pkg = JSON.parse(readFileSync('./package.json', 'utf8'));
process.stdout.write(pkg.version);
NODESCRIPT
}

if [[ "$PLATFORM" == "--platform" ]]; then
  PLATFORM="${2:-}"
elif [[ "$PLATFORM" == --platform=* ]]; then
  PLATFORM="${PLATFORM#--platform=}"
elif [[ "$PLATFORM" == "--" ]]; then
  PLATFORM="${2:-current}"
fi

if [[ "$PLATFORM" == "current" || -z "$PLATFORM" ]]; then
  PLATFORM="$(detect_platform)"
fi

case "$PLATFORM" in
  win|mac|linux) ;;
  *)
    echo "Usage: pnpm run release:usb -- [current|win|mac|linux]" >&2
    exit 2
    ;;
esac

cd "$REPO_ROOT"

log "Target platform: $PLATFORM"
log "Cleaning previous portable output"
rm -rf "$DIST_ROOT"

log "Running typecheck"
pnpm typecheck

log "Running dependency audit"
# Neutralize ONLY the test-only sentinels that may have been inherited from the
# operator's environment.  AUDIT_GATE_TEST_MODE=1 would allow AUDIT_ALLOWLIST
# to redirect the gate to an arbitrary allowlist file; unsetting both here
# ensures the real release path always uses the pinned repo allowlist.
#
# Do NOT unset SKIP_AUDIT / SKIP_AUDIT_REASON: the documented operator-initiated
# bypass (SKIP_AUDIT=1 SKIP_AUDIT_REASON="..." pnpm run release:usb) MUST remain
# reachable on the real release path — see SECURITY.md §SKIP_AUDIT Override,
# scripts/README.md, and docs/USB_RELEASE_HANDOFF_CHECKLIST.md.  The bypass is
# safe because it is fully traceable: the gate requires a non-empty validated
# SKIP_AUDIT_REASON and records "Dependency audit: BYPASSED — reason: <reason>"
# in RELEASE_MANIFEST.txt for every produced artifact.
unset AUDIT_GATE_TEST_MODE AUDIT_ALLOWLIST
# shellcheck source=scripts/lib/audit-gate.sh
source "$REPO_ROOT/scripts/lib/audit-gate.sh"
AUDIT_STATUS_LINE=""
run_audit_gate
log "$AUDIT_STATUS_LINE"

log "Running tests"
pnpm test

log "Building renderer and Electron main/preload"
pnpm run build

log "Building portable app artifact"
case "$PLATFORM" in
  win) pnpm exec electron-builder --win --dir ;;
  mac) pnpm exec electron-builder --mac --dir ;;
  linux) pnpm exec electron-builder --linux --dir ;;
esac

log "Preparing USB package layout"
rm -rf "$PACKAGE_ROOT"
mkdir -p "$PACKAGE_ROOT"

copy_required() {
  local source="$1"
  local target="$2"

  if [[ ! -e "$source" ]]; then
    echo "Missing expected build artifact: $source" >&2
    exit 1
  fi

  cp -R "$source" "$target"
}

copy_linux_appimage() {
  local version
  local source

  version="$(read_package_version)"
  source="$DIST_ROOT/Phone Directory-$version.AppImage"

  if [[ -f "$source" ]]; then
    cp "$source" "$PACKAGE_ROOT/Phone Directory.AppImage"
  fi
}

case "$PLATFORM" in
  win)
    copy_required "$DIST_ROOT/win-unpacked" "$PACKAGE_ROOT/win-unpacked"
    copy_required "$REPO_ROOT/usb-launchers/launch.bat" "$PACKAGE_ROOT/launch.bat"
    ;;
  mac)
    if [[ -d "$DIST_ROOT/mac" ]]; then
      copy_required "$DIST_ROOT/mac" "$PACKAGE_ROOT/mac"
    fi
    if [[ -d "$DIST_ROOT/mac-arm64" ]]; then
      copy_required "$DIST_ROOT/mac-arm64" "$PACKAGE_ROOT/mac-arm64"
    fi
    if [[ ! -d "$PACKAGE_ROOT/mac" && ! -d "$PACKAGE_ROOT/mac-arm64" ]]; then
      echo "Missing expected mac build artifacts in $DIST_ROOT" >&2
      exit 1
    fi
    copy_required "$REPO_ROOT/usb-launchers/launch.command" "$PACKAGE_ROOT/launch.command"
    chmod +x "$PACKAGE_ROOT/launch.command"
    ;;
  linux)
    copy_required "$DIST_ROOT/linux-unpacked" "$PACKAGE_ROOT/linux-unpacked"
    copy_linux_appimage
    copy_required "$REPO_ROOT/usb-launchers/launch.sh" "$PACKAGE_ROOT/launch.sh"
    chmod +x "$PACKAGE_ROOT/launch.sh"
    ;;
esac

copy_required "$REPO_ROOT/usb-launchers/README.txt" "$PACKAGE_ROOT/README.txt"

PKG_VERSION="$(read_package_version)"

cat > "$PACKAGE_ROOT/RELEASE_MANIFEST.txt" <<EOF
Phone Directory USB release
Generated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
Platform: $PLATFORM
Version: $PKG_VERSION
Source commit: $(git rev-parse --short HEAD)
${AUDIT_STATUS_LINE}

Copy the contents of this directory to the USB root.
Data will be created under portable-data/ on first launch.
EOF

# ---------------------------------------------------------------------------
# Phase 2 — SHA-256 artifact integrity checksums
#
# Compute SHA-256 for every regular file under the USB package root and write
# two artefacts alongside RELEASE_MANIFEST.txt:
#
#   RELEASE_MANIFEST.txt.sha256  — shasum-compatible manifest, one entry per file,
#                                   paths relative to PACKAGE_ROOT, verifiable with:
#                                     shasum -a 256 -c RELEASE_MANIFEST.txt.sha256
#
# The checksum list is also appended to RELEASE_MANIFEST.txt so the manifest
# itself records the integrity state of the bundle.
# ---------------------------------------------------------------------------

log "Computing SHA-256 checksums for release artifacts"

CHECKSUM_FILE="$PACKAGE_ROOT/RELEASE_MANIFEST.txt.sha256"

# Portability shim: prefer shasum (macOS/Perl), fall back to sha256sum (Linux
# coreutils). If neither is available, skip checksum generation with a warning
# rather than aborting the whole release under set -euo pipefail.
SHA256_CMD=""
if command -v shasum >/dev/null 2>&1; then
  SHA256_CMD="shasum -a 256"
elif command -v sha256sum >/dev/null 2>&1; then
  SHA256_CMD="sha256sum"
else
  log "WARNING: neither shasum nor sha256sum found — skipping checksum generation"
fi

if [ -n "$SHA256_CMD" ]; then
  # Build the checksum manifest relative to PACKAGE_ROOT so it is portable
  # (shasum -c / sha256sum -c must be run from within PACKAGE_ROOT on the
  # target machine).
  #
  # Exclude RELEASE_MANIFEST.txt.sha256 (circularity) AND RELEASE_MANIFEST.txt
  # itself: the checksum block is appended to RELEASE_MANIFEST.txt AFTER this
  # step, so checksumming it here would always produce FAILED on verification.
  (
    cd "$PACKAGE_ROOT"
    find . -type f \
      ! -name 'RELEASE_MANIFEST.txt.sha256' \
      ! -name 'RELEASE_MANIFEST.txt' \
      -print0 \
      | sort -z \
      | xargs -0 $SHA256_CMD \
      > "$CHECKSUM_FILE"
  )

  log "Checksums written: $CHECKSUM_FILE"

  # Append checksum block to the human-readable manifest
  {
    printf '\n--- SHA-256 Artifact Checksums ---\n'
    printf 'Verify on target: cd <usb-package> && %s -c RELEASE_MANIFEST.txt.sha256\n\n' "$SHA256_CMD"
    cat "$CHECKSUM_FILE"
  } >> "$PACKAGE_ROOT/RELEASE_MANIFEST.txt"
fi

log "USB package ready: $PACKAGE_ROOT"
