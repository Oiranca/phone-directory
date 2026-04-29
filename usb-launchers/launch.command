#!/bin/sh
USB_ROOT="$(cd "$(dirname "$0")" && pwd)"
APP="$USB_ROOT/mac-arm64/Phone Directory.app"
if [ ! -d "$APP" ]; then
    APP="$USB_ROOT/mac/Phone Directory.app"
fi
if [ ! -d "$APP" ]; then
    echo "ERROR: Cannot find Phone Directory.app in mac-arm64/ or mac/ at $USB_ROOT"
    exit 1
fi
ELECTRON_PORTABLE=1 "$APP/Contents/MacOS/Phone Directory" &
