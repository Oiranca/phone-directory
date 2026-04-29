# USB Deployment Guide

This document describes how to prepare a USB drive for portable Phone Directory distribution.

## Step 1 — Build the platform artifacts

Run the appropriate build command for each target platform:

```bash
npm run build:dist:win      # produces dist-portable/win-unpacked/
npm run build:dist:mac      # produces dist-portable/mac/ and dist-portable/mac-arm64/
npm run build:dist:linux    # produces dist-portable/linux-unpacked/
# To produce an AppImage, add "AppImage" to the linux targets in package.json and rebuild.
```

The `dist-portable/` directory is gitignored. Build on the target platform or use a CI runner.

## Step 2 — Copy platform artifacts to the USB root

Copy the relevant output folder(s) from `dist-portable/` to the root of the USB drive:

| Platform       | Folder to copy             | Destination on USB  |
|----------------|----------------------------|---------------------|
| Windows        | `dist-portable/win-unpacked/` | `<USB_ROOT>/win-unpacked/` |
| macOS x64      | `dist-portable/mac/`          | `<USB_ROOT>/mac/`          |
| macOS arm64    | `dist-portable/mac-arm64/`    | `<USB_ROOT>/mac-arm64/`    |
| Linux (dir)    | `dist-portable/linux-unpacked/` | `<USB_ROOT>/linux-unpacked/` |
| Linux (AppImage) | `dist-portable/Phone Directory.AppImage` | `<USB_ROOT>/Phone Directory.AppImage` |

You do not need to include all platforms on a single drive. Include only the platforms your target users need.

## Step 3 — Copy the launcher files to the USB root

From this `usb-launchers/` directory, copy the relevant launcher(s) and the README to the USB root:

```
<USB_ROOT>/
├── launch.bat          (Windows)
├── launch.sh           (Linux)
├── launch.command      (macOS)
└── README.txt          (all platforms)
```

On Linux and macOS, make the scripts executable after copying:

```bash
chmod +x <USB_MOUNT>/launch.sh
chmod +x <USB_MOUNT>/launch.command
```

## Final USB layout

A fully populated multi-platform drive looks like this:

```
USB_ROOT/
├── win-unpacked/
│   └── Phone Directory.exe
├── mac/
│   └── Phone Directory.app/
├── mac-arm64/
│   └── Phone Directory.app/
├── linux-unpacked/
│   └── phone-directory
├── Phone Directory.AppImage     (optional)
├── launch.bat
├── launch.sh
├── launch.command
└── README.txt
```

## Notes

- All user data (contacts, settings, backups) is stored in a `portable-data/` folder created automatically at the USB root on first launch. Nothing is written to the host computer.
- The `ELECTRON_PORTABLE=1` environment variable is set by each launcher script. The app reads this flag to activate portable mode.
- To back up user data, copy the `portable-data/` folder to a safe location.
