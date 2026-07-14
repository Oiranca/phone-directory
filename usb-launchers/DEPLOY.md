# USB Deployment Guide

This document describes how to prepare a USB drive for portable HospiAgenda distribution.

## Step 1 — Build the USB package

Use the release orchestrator for the target platform:

```bash
pnpm run release:usb -- win
pnpm run release:usb -- mac
pnpm run release:usb -- linux
```

The command runs typecheck, tests, the production build, `electron-builder --dir`,
and USB package staging. The copy-ready output is:

```bash
dist-portable/usb-package/
```

To also produce an AppImage (optional Linux fallback), temporarily add `"AppImage"` to the
`linux.target` array in the `build` section of `package.json`, then run:

```bash
pnpm run release:usb -- linux
```

When `dist-portable/HospiAgenda-<version>.AppImage` exists, the release script
copies it into the USB package as `HospiAgenda.AppImage`.

The `dist-portable/` directory is gitignored. Build on the target platform or use a CI runner.

## Step 2 — Copy the staged package to the USB root

Copy the contents of `dist-portable/usb-package/` to the root of the USB drive.

| Platform       | Folder to copy             | Destination on USB  |
|----------------|----------------------------|---------------------|
| Windows        | `dist-portable/usb-package/*` | `<USB_ROOT>/` |
| macOS          | `dist-portable/usb-package/*` | `<USB_ROOT>/` |
| Linux          | `dist-portable/usb-package/*` | `<USB_ROOT>/` |

You do not need to include all platforms on a single drive. Include only the platforms your target users need.

## Step 3 — Verify launcher files

The release package includes the relevant launcher and `README.txt`:

```
<USB_ROOT>/
├── launch.bat          (Windows)
├── launch.sh           (Linux)
├── launch.command      (macOS)
└── README.txt          (all platforms)
```

On Linux and macOS, the release script marks the staged launcher executable. If the
USB filesystem strips executable bits, restore them after copying:

```bash
chmod +x <USB_MOUNT>/launch.sh
chmod +x <USB_MOUNT>/launch.command
```

## Final USB layout

A fully populated multi-platform drive looks like this:

```
USB_ROOT/
├── win-unpacked/
│   └── HospiAgenda.exe
├── mac/
│   └── HospiAgenda.app/
├── mac-arm64/
│   └── HospiAgenda.app/
├── linux-unpacked/
│   └── hospiagenda
├── HospiAgenda.AppImage     (optional)
├── launch.bat
├── launch.sh
├── launch.command
├── README.txt
└── RELEASE_MANIFEST.txt
```

## Notes

- All persistent user data is stored in a `portable-data/` folder created automatically at the USB root on first launch. Linux AppImage fallback launches may extract temporary runtime files under `/tmp`, but directory data and backups stay on the USB drive. The folder layout is:
  ```
  portable-data/
    data/
      contacts.json
      settings.json
    backups/
  ```
- The launchers set both `ELECTRON_PORTABLE=1` (activates portable mode) and `ELECTRON_PORTABLE_ROOT_PATH` (points Electron userData to `<USB_ROOT>/portable-data`).
- To back up user data, copy the `portable-data/` folder to a safe location.
- For the release checklist and operator handoff steps, see [`../docs/USB_RELEASE_HANDOFF_CHECKLIST.md`](../docs/USB_RELEASE_HANDOFF_CHECKLIST.md).
