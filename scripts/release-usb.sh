#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLATFORM="current"
PLATFORM_SET=0
DATA_SOURCE_DIR=""
DIST_ROOT="$REPO_ROOT/dist-portable"
PACKAGE_ROOT="$DIST_ROOT/usb-package"
INITIAL_DATA_SNAPSHOT=""
INITIAL_DATA_STATUS="EMPTY (created on first launch)"

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

usage() {
  cat >&2 <<'EOF'
Usage: pnpm run release:usb -- [current|win|mac|linux] [--data-dir <managed-data-directory>]

--data-dir must point to the app-managed data directory containing contacts.json
and beepers.json. settings.json is optional and must use managed portable paths.
EOF
}

cleanup() {
  if [[ -n "$INITIAL_DATA_SNAPSHOT" && -d "$INITIAL_DATA_SNAPSHOT" ]]; then
    rm -rf "$INITIAL_DATA_SNAPSHOT"
  fi
}

trap cleanup EXIT

# Read package version without require() so it works under Node 22+ ESM projects.
# node --input-type=module feeds the snippet as an ES module — no CJS assumption.
read_package_version() {
  node --input-type=module <<'NODESCRIPT'
import { readFileSync } from 'fs';
const pkg = JSON.parse(readFileSync('./package.json', 'utf8'));
process.stdout.write(pkg.version);
NODESCRIPT
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --)
      shift
      ;;
    current|win|mac|linux)
      if [[ $PLATFORM_SET -eq 1 ]]; then
        echo "Target platform was specified more than once." >&2
        usage
        exit 2
      fi
      PLATFORM="$1"
      PLATFORM_SET=1
      shift
      ;;
    --platform)
      if [[ $# -lt 2 || -z "$2" || $PLATFORM_SET -eq 1 ]]; then
        usage
        exit 2
      fi
      PLATFORM="$2"
      PLATFORM_SET=1
      shift 2
      ;;
    --platform=*)
      if [[ $PLATFORM_SET -eq 1 ]]; then
        usage
        exit 2
      fi
      PLATFORM="${1#--platform=}"
      PLATFORM_SET=1
      shift
      ;;
    --data-dir)
      if [[ $# -lt 2 || -z "$2" || -n "$DATA_SOURCE_DIR" ]]; then
        usage
        exit 2
      fi
      DATA_SOURCE_DIR="$2"
      shift 2
      ;;
    --data-dir=*)
      if [[ -n "$DATA_SOURCE_DIR" || -z "${1#--data-dir=}" ]]; then
        usage
        exit 2
      fi
      DATA_SOURCE_DIR="${1#--data-dir=}"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown release argument: $1" >&2
      usage
      exit 2
      ;;
  esac
done

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

if [[ -n "$DATA_SOURCE_DIR" ]]; then
  DATA_SOURCE_DIR="$(node -e 'const path = require("node:path"); process.stdout.write(path.resolve(process.argv[1]));' "$DATA_SOURCE_DIR")"
  case "$DATA_SOURCE_DIR" in
    "$DIST_ROOT"|"$DIST_ROOT"/*)
      echo "The initialized data source cannot be inside dist-portable because release cleanup removes that directory." >&2
      exit 2
      ;;
  esac

  INITIAL_DATA_SNAPSHOT="$(mktemp -d "${TMPDIR:-/tmp}/hospiagenda-release-data.XXXXXX")"
  INITIAL_DATA_FILES="$(
    USB_RELEASE_DATA_SOURCE="$DATA_SOURCE_DIR" \
    USB_RELEASE_DATA_SNAPSHOT="$INITIAL_DATA_SNAPSHOT" \
    node --input-type=module <<'NODESCRIPT'
import fs from "node:fs";
import path from "node:path";

const source = process.env.USB_RELEASE_DATA_SOURCE;
const snapshot = process.env.USB_RELEASE_DATA_SNAPSHOT;
const fail = (message) => {
  console.error(`[release-usb] Invalid initialized data: ${message}`);
  process.exit(2);
};

if (!source || !snapshot) fail("internal source configuration is missing.");

let sourceStat;
try {
  sourceStat = fs.lstatSync(source);
} catch {
  fail("source directory does not exist or cannot be read.");
}
if (!sourceStat.isDirectory() || sourceStat.isSymbolicLink()) {
  fail("source must be a real directory, not a file or symbolic link.");
}

const readManagedJson = (name, required) => {
  const filePath = path.join(source, name);
  let stat;
  try {
    stat = fs.lstatSync(filePath);
  } catch (error) {
    if (!required && error?.code === "ENOENT") return null;
    fail(`${name} is required and must be readable.`);
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    fail(`${name} must be a regular file, not a symbolic link.`);
  }
  try {
    return { filePath, value: JSON.parse(fs.readFileSync(filePath, "utf8")) };
  } catch {
    fail(`${name} is not valid JSON.`);
  }
};

const contacts = readManagedJson("contacts.json", true);
if (!contacts.value || typeof contacts.value !== "object" || Array.isArray(contacts.value) || !Array.isArray(contacts.value.records)) {
  fail("contacts.json must be a directory dataset with a records array.");
}

const beepers = readManagedJson("beepers.json", true);
if (
  !beepers.value ||
  typeof beepers.value !== "object" ||
  Array.isArray(beepers.value) ||
  !Array.isArray(beepers.value.records) ||
  (beepers.value.importedRecords !== undefined && !Array.isArray(beepers.value.importedRecords))
) {
  fail("beepers.json must contain records and optional importedRecords arrays.");
}

const settings = readManagedJson("settings.json", false);
if (settings) {
  const managed = settings.value?.managedPaths;
  if (
    !settings.value ||
    typeof settings.value !== "object" ||
    Array.isArray(settings.value) ||
    managed?.dataFilePath !== true ||
    managed?.backupDirectoryPath !== true
  ) {
    fail("settings.json can only be packaged when both managedPaths flags are true.");
  }
}

const files = [contacts, beepers, settings].filter(Boolean);
for (const file of files) {
  fs.copyFileSync(file.filePath, path.join(snapshot, path.basename(file.filePath)));
  fs.chmodSync(path.join(snapshot, path.basename(file.filePath)), 0o600);
}
process.stdout.write(files.map((file) => path.basename(file.filePath)).join(", "));
NODESCRIPT
  )"
  INITIAL_DATA_STATUS="INCLUDED ($INITIAL_DATA_FILES)"
  log "Initialized data validated and snapshotted: $INITIAL_DATA_FILES"
fi

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

log "Running E2E tests (critical import flow gate)"
pnpm run test:e2e

log "Building portable app artifact"
case "$PLATFORM" in
  win) pnpm exec electron-builder --win portable --x64 ;;
  mac) pnpm exec electron-builder --mac --dir ;;
  linux) pnpm exec electron-builder --linux --dir ;;
esac

HOST_PLATFORM="$(node -p "process.platform === 'win32' ? 'win' : process.platform === 'darwin' ? 'mac' : process.platform === 'linux' ? 'linux' : process.platform")"
if [[ "$HOST_PLATFORM" == "$PLATFORM" ]]; then
  log "Running packaged startup smoke ($PLATFORM file:// path)"
  pnpm run test:e2e:packaged -- --skip-build --platform="$PLATFORM"
else
  log "Skipping packaged startup smoke: host platform '$HOST_PLATFORM' cannot launch '$PLATFORM' artifact"
fi

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
  source="$DIST_ROOT/HospiAgenda-$version.AppImage"

  if [[ -f "$source" ]]; then
    cp "$source" "$PACKAGE_ROOT/HospiAgenda.AppImage"
  fi
}

case "$PLATFORM" in
  win)
    copy_required "$DIST_ROOT/HospiAgenda.exe" "$PACKAGE_ROOT/HospiAgenda.exe"
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
    ;;
  linux)
    copy_required "$DIST_ROOT/linux-unpacked" "$PACKAGE_ROOT/linux-unpacked"
    copy_linux_appimage
    copy_required "$REPO_ROOT/usb-launchers/launch.sh" "$PACKAGE_ROOT/launch.sh"
    chmod +x "$PACKAGE_ROOT/launch.sh"
    ;;
esac

copy_required "$REPO_ROOT/usb-launchers/README.txt" "$PACKAGE_ROOT/README.txt"

if [[ -n "$INITIAL_DATA_SNAPSHOT" ]]; then
  log "Staging initialized portable data"
  mkdir -p "$PACKAGE_ROOT/portable-data/data"
  for data_file in contacts.json beepers.json settings.json; do
    if [[ -f "$INITIAL_DATA_SNAPSHOT/$data_file" ]]; then
      cp "$INITIAL_DATA_SNAPSHOT/$data_file" "$PACKAGE_ROOT/portable-data/data/$data_file"
      chmod 600 "$PACKAGE_ROOT/portable-data/data/$data_file"
    fi
  done
fi

PKG_VERSION="$(read_package_version)"

cat > "$PACKAGE_ROOT/RELEASE_MANIFEST.txt" <<EOF
HospiAgenda USB release
Generated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
Platform: $PLATFORM
Version: $PKG_VERSION
Source commit: $(git rev-parse --short HEAD)
${AUDIT_STATUS_LINE}
Initial data: ${INITIAL_DATA_STATUS}

Copy the contents of this directory to the USB root.
Open the platform executable directly. It stores data in portable-data at the USB root.
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
# SHA256_CMD is a bash array to avoid SC2086 word-splitting on invocation.
SHA256_CMD=()
if command -v shasum >/dev/null 2>&1; then
  SHA256_CMD=(shasum -a 256)
elif command -v sha256sum >/dev/null 2>&1; then
  SHA256_CMD=(sha256sum)
else
  log "WARNING: neither shasum nor sha256sum found — skipping checksum generation"
fi

if [ "${#SHA256_CMD[@]}" -gt 0 ]; then
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
      | xargs -0 "${SHA256_CMD[@]}" \
      > "$CHECKSUM_FILE"
  )

  log "Checksums written: $CHECKSUM_FILE"

  # Append checksum block to the human-readable manifest
  {
    printf '\n--- SHA-256 Artifact Checksums ---\n'
    printf 'Verify on target: cd <usb-package> && %s -c RELEASE_MANIFEST.txt.sha256\n\n' "${SHA256_CMD[*]}"
    cat "$CHECKSUM_FILE"
  } >> "$PACKAGE_ROOT/RELEASE_MANIFEST.txt"
fi

log "USB package ready: $PACKAGE_ROOT"
