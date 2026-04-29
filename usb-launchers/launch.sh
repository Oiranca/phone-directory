#!/bin/sh
USB_ROOT="$(cd "$(dirname "$0")" && pwd)"
BIN="$USB_ROOT/linux-unpacked/phone-directory"
APPIMAGE="$USB_ROOT/Phone Directory.AppImage"

if [ -x "$BIN" ]; then
    ELECTRON_PORTABLE=1 "$BIN"
elif [ -x "$APPIMAGE" ]; then
    ELECTRON_PORTABLE=1 "$APPIMAGE"
else
    echo "ERROR: Cannot find linux-unpacked/phone-directory or Phone Directory.AppImage at $USB_ROOT"
    exit 1
fi
