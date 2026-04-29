# build-resources

This directory holds static assets consumed by electron-builder during packaging.

## Icon files

Place the application icon files here before running any `build:dist*` script.
electron-builder will pick them up automatically when present.

| File        | Platform | Recommended size      |
|-------------|----------|-----------------------|
| `icon.ico`  | Windows  | 256x256 (multi-frame) |
| `icon.icns` | macOS    | 512x512 (multi-frame) |
| `icon.png`  | Linux    | 512x512 PNG           |

To include icons in the electron-builder config, add the `icon` field to each
platform section in `package.json`:

```json
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

Icon fields are intentionally omitted from the current config to avoid build
failures when the icon files are not yet present.
