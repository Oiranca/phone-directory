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

  version="$(node -p "require('./package.json').version")"
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

cat > "$PACKAGE_ROOT/RELEASE_MANIFEST.txt" <<EOF
Phone Directory USB release
Generated: $(date -u +"%Y-%m-%dT%H:%M:%SZ")
Platform: $PLATFORM
Version: $(node -p "require('./package.json').version")
Source commit: $(git rev-parse --short HEAD)

Copy the contents of this directory to the USB root.
Data will be created under portable-data/ on first launch.
EOF

log "USB package ready: $PACKAGE_ROOT"
