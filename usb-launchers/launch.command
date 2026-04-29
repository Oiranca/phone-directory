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
# NOTE: Launches the Mach-O binary directly (unsigned/unnotarized build assumed).
# If this build becomes notarized, Gatekeeper may reject direct binary invocation.
# In that case, switch to: open -a "$APP" and pass --portable via a CLI arg instead.
# USB media is deployer-controlled; residual TOCTOU window between the -d check and exec is accepted.
env ELECTRON_PORTABLE=1 "$APP/Contents/MacOS/Phone Directory" &
disown
