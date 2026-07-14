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

Linux may also include `HospiAgenda.AppImage` when the build configuration produces the versioned AppImage artifact.

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

## 7. Release Pipeline Security

### SHA-256 artifact integrity

The release script (`scripts/release-usb.sh`) generates SHA-256 checksums for all
packaged artifacts in `usb-package/` (excluding `RELEASE_MANIFEST.txt` and
`RELEASE_MANIFEST.txt.sha256` themselves) and writes them to
`RELEASE_MANIFEST.txt.sha256`.

To verify integrity on the deployment machine before handing off:

```bash
cd dist-portable/usb-package
# macOS / systems with shasum (Perl):
shasum -a 256 -c RELEASE_MANIFEST.txt.sha256
# Linux / systems with sha256sum (GNU coreutils):
sha256sum -c RELEASE_MANIFEST.txt.sha256
```

The verification command to use is printed inside `RELEASE_MANIFEST.txt` under
the `--- SHA-256 Artifact Checksums ---` section, so you can always check which
tool was used to generate the manifest on that machine.

Every file must report `OK`. Any `FAILED` line indicates a corrupted or tampered file.
Do not hand off the USB if any checksum fails.

### CVE remediation status (as of 2026-06-17)

| GHSA | Package | Status |
|------|---------|--------|
| GHSA-5xrq-8626-4rwp | vitest UI RCE | Resolved — vitest 4.1.9 |
| GHSA-67mh-4wv8-2f99 | esbuild CORS bypass | Resolved — vite 6.4.3 |
| GHSA-4w7w-66w2-5vf9 | vite path traversal | Resolved — vite 6.x |
| GHSA-ph9p-34f9-6g65 | tmp path traversal | No upstream patch; allowlisted, monitor below |
| GHSA-gv7w-rqvm-qjhr | esbuild Deno binary | Allowlisted — Node npm path unaffected |

### tmp monitoring plan (GHSA-ph9p-34f9-6g65)

`tmp@0.2.5` has no patch available. It is a transitive dependency via:
`electron-builder > app-builder-lib > @malept/flatpak-bundler > tmp-promise > tmp`

The Flatpak target is not used in this project. Monitor:
- `electron-builder` changelog for an `app-builder-lib` bump that pulls `tmp >=0.2.6`.
- `@malept/flatpak-bundler` repository for a direct `tmp-promise` upgrade.

When a patched version becomes available:
1. Upgrade `electron-builder` in `package.json`.
2. Confirm `pnpm audit` no longer reports GHSA-ph9p-34f9-6g65.
3. Remove the `GHSA-ph9p-34f9-6g65` entry from `scripts/audit-allowlist.json`.
4. Run `pnpm run ci` to confirm no regressions.

### Allowlist review cadence

`scripts/audit-allowlist.json` entries carry an `expires` date.
Before each release:

1. Run `pnpm run test:audit-gate` — must exit 0.
2. Review entries expiring within 30 days: check whether an upstream patch is now available.
3. If patched: upgrade the package and remove the allowlist entry.
4. If not patched: update the `expires` date and `reason` to reflect the current evaluation.
