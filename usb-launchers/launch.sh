#!/bin/sh
USB_ROOT="$(cd "$(dirname "$0")" && pwd)"
BIN="$USB_ROOT/linux-unpacked/phone-directory"
APPIMAGE="$USB_ROOT/Phone Directory.AppImage"

# exec replaces this shell process — no lingering parent after launch.
# USB media is deployer-controlled; residual TOCTOU window is accepted for this deployment model.
if [ -x "$BIN" ]; then
    exec env ELECTRON_PORTABLE=1 "$BIN"
fi
if [ -x "$APPIMAGE" ]; then
    # --appimage-extract-and-run bypasses FUSE (required on Ubuntu 22.04+/Fedora 37+ without libfuse2).
    exec env ELECTRON_PORTABLE=1 "$APPIMAGE" --appimage-extract-and-run
fi
echo "ERROR: Cannot find linux-unpacked/phone-directory or Phone Directory.AppImage at $USB_ROOT" >&2
exit 1
