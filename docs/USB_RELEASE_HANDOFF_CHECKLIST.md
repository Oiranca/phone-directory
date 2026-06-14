# USB Release Handoff Checklist

Use this checklist for every operator-facing USB release.

## 1. Pre-release checks

- Confirm the release branch is merged to `main`.
- Confirm the local working tree is clean.
- Pull the latest `main`.
- Install dependencies with the locked package manager:

```bash
pnpm install --frozen-lockfile
```

## 2. Build the USB package

Build the package for the current platform:

```bash
pnpm run release:usb
```

Or choose an explicit target:

```bash
pnpm run release:usb -- win
pnpm run release:usb -- mac
pnpm run release:usb -- linux
```

The release script runs:

1. `pnpm typecheck`
2. **Dependency audit gate** (`pnpm audit --json` filtered against `scripts/audit-allowlist.json`)
3. `pnpm test`
4. `pnpm run build`
5. `electron-builder --dir` for the selected platform
6. USB package staging under `dist-portable/usb-package/`

The audit gate exits non-zero (aborting the release) if any high- or
critical-severity advisory is not covered by an unexpired allowlist entry.
The result is recorded in `RELEASE_MANIFEST.txt` as one of:

```
Dependency audit: PASSED (allowlist N entries)
Dependency audit: BYPASSED — reason: <reason>
```

Verify the audit status line in `RELEASE_MANIFEST.txt` after the build:

- **PASSED** — all advisories accounted for; release is clean.
- **BYPASSED** — the audit was skipped intentionally; confirm the reason is
  documented and accepted before handing off the USB.

If the release is blocked by a `NON-ALLOWLISTED` advisory:

1. Review the advisory: `pnpm audit` (human-readable output).
2. Either resolve it (update the dependency) or add an entry to
   `scripts/audit-allowlist.json` with a GHSA id, package, severity, reason,
   and an expiry date; then re-run `pnpm run release:usb`.
3. Do not use `SKIP_AUDIT=1` unless the advisory is confirmed accepted and a
   reason is recorded.

## 3. Copy to the USB drive

Copy the contents of `dist-portable/usb-package/` to the USB root.

Expected USB root files vary by platform:

| Platform | Required payload |
| --- | --- |
| Windows | `win-unpacked/`, `launch.bat`, `README.txt`, `RELEASE_MANIFEST.txt` |
| macOS | `mac/` and/or `mac-arm64/`, `launch.command`, `README.txt`, `RELEASE_MANIFEST.txt` |
| Linux | `linux-unpacked/`, `launch.sh`, `README.txt`, `RELEASE_MANIFEST.txt` |

Linux may also include `Phone Directory.AppImage` when the build configuration produces the versioned AppImage artifact.

If the USB filesystem strips executable bits, restore them after copying:

```bash
chmod +x <USB_MOUNT>/launch.sh
chmod +x <USB_MOUNT>/launch.command
```

## 4. Smoke test from USB

Run the launcher from the USB root on the target platform:

- Windows: double-click `launch.bat`
- macOS: double-click `launch.command`
- Linux: run `./launch.sh`

Confirm:

- the app opens without launcher errors
- `portable-data/` is created at the USB root
- a new or existing contact can be viewed
- settings show usable data and backup paths
- closing and reopening preserves the same data

## 5. Operator handoff

Before handoff, confirm the USB root contains:

- the platform payload folder
- the platform launcher
- `README.txt`
- `RELEASE_MANIFEST.txt`
- `portable-data/` when handing off an initialized drive

Tell the operator:

- launch the app only through the launcher file
- keep `portable-data/` with the USB drive
- back up `portable-data/` before major imports or cleanup work
- do not delete `RELEASE_MANIFEST.txt`; it identifies the build

## 6. Failure handling

If the app does not open:

- keep the USB contents unchanged
- capture the platform and launcher used
- on Windows or Linux, capture any terminal output
- on macOS, capture any visible Terminal, Finder, Gatekeeper, or launch dialog text
- retry on the same machine after ejecting and remounting the USB drive
- if it still fails, rebuild from the latest `main` and replace the USB contents
