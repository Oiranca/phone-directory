# build-resources

This directory holds static assets consumed by electron-builder during packaging.

## Signing files

The macOS signing entitlements live here:

| File | Purpose |
|------|---------|
| `entitlements.mac.plist` | Primary app entitlements for hardened runtime signing |
| `entitlements.mac.inherit.plist` | Inherited entitlements for helper apps and frameworks |

These files are referenced from the `mac` section in `package.json`.

## Icon files

Icon files are optional — electron-builder falls back to its own default icons when none are provided.
To use custom icons, place the files below and add an `icon` field to each platform section in `package.json` (see example config at the bottom of this file).

| File        | Platform | Recommended size      |
|-------------|----------|-----------------------|
| `icon.ico`  | Windows  | 256x256 (multi-frame) |
| `icon.icns` | macOS    | 512x512 (multi-frame) |
| `icon.png`  | Linux    | 512x512 PNG           |

To include icons in the electron-builder config, add the `icon` field to each
platform section in `package.json`:

```jsonc
"win": {
  "target": [{ "target": "dir", "arch": ["x64"] }],
  "icon": "build-resources/icon.ico"
},
"mac": {
  "target": [{ "target": "dir", "arch": ["x64", "arm64"] }],
  "icon": "build-resources/icon.icns"
},
"linux": {
  "target": [{ "target": "dir", "arch": ["x64"] }],
  "icon": "build-resources/icon.png",
  "category": "Office"
}
```

The icon fields are intentionally omitted from the current config — add them when icon files are ready.
