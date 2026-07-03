# Migration Scripts

## `release-usb.sh`

Runs the local release workflow for USB deployment.

```bash
pnpm run release:usb
pnpm run release:usb -- mac
pnpm run release:usb -- linux
pnpm run release:usb -- win
```

The command runs typecheck, tests, and the production build before invoking
`electron-builder --dir` for the target platform. It writes the copy-ready USB
layout to:

```bash
dist-portable/usb-package/
```

Copy the contents of that directory to the USB root.

The staged package includes the platform payload folder, the platform launcher,
`README.txt`, and a generated `RELEASE_MANIFEST.txt` with the build timestamp,
version, and source commit. Linux packages may also include
`Phone Directory.AppImage` when the build configuration produces it.

For the full packaging and operator handoff process, see
[../docs/USB_RELEASE_HANDOFF_CHECKLIST.md](../docs/USB_RELEASE_HANDOFF_CHECKLIST.md).

### Dependency Audit Gate

The release script sources `scripts/lib/audit-gate.sh` and calls `run_audit_gate` early in the pipeline (after typecheck, before tests and build). The gate:

1. Runs `pnpm audit --json` to collect the current advisory list.
2. Filters out every advisory whose GHSA ID appears in `scripts/audit-allowlist.json` (explicitly accepted risks).
3. **Fails the release** if any high-severity or critical advisory is _not_ in the allowlist.
4. Records the result in `RELEASE_MANIFEST.txt` — either `Dependency audit: PASSED (allowlist N entries)` or `Dependency audit: BYPASSED — reason: <reason>`.

If the gate fails because of a non-advisory error (network outage, registry unreachable) the message reads:

```
[audit-gate] ✗ Dependency audit failed to complete (non-advisory error — check network/registry).
```

This is distinct from an advisory failure message, which lists `NON-ALLOWLISTED` advisories by package and GHSA ID.

#### Advisory allowlist

`scripts/audit-allowlist.json` is the machine-readable source of truth for accepted risks. Each entry requires the following fields:

| Field | Type | Description |
|---|---|---|
| `id` | string | GHSA advisory ID (non-empty) |
| `package` | string | Affected package name |
| `severity` | string | Advisory severity (`high` or `critical`) |
| `reason` | string | Rationale for acceptance (deployment context, unreachable code path, etc.) |
| `expires` | string | Expiry date in `YYYY-MM-DD` format — the gate rejects entries past this date |
| `reviewDate` | string | When the entry was last reviewed (informational) |

The accepted **identity** of an entry is the composite of its GHSA `id` **and** `package`. A single GHSA advisory that affects more than one package (e.g. `GHSA-2j2x-hqr9-3h42` covering both `react-router` and `react-router-dom`) is therefore represented as one allowlist entry per package, all sharing the same `id`. A live advisory is suppressed only when its GHSA id, package name, and normalized severity all match an accepted identity.

The gate validates all required fields and rejects the run (exit 3) if any entry is malformed, contains a duplicate **identity** (the same GHSA `id` **and** the same `package`), or is **expired** (current date > `expires`). An expired entry requires the advisory to be re-reviewed and the `expires` date updated — or the advisory resolved — before a new release can proceed.

Adding an entry with a realistic `expires` date (typically 3–6 months from review) is the correct way to accept a known advisory rather than using `SKIP_AUDIT=1`.

See `SECURITY.md → Accepted Risks` for a human-readable summary of each accepted advisory.

#### Bypassing the gate

`SKIP_AUDIT=1` skips the audit entirely. A non-empty `SKIP_AUDIT_REASON` is **required** — without it the release aborts:

```bash
SKIP_AUDIT=1 SKIP_AUDIT_REASON="GHSA-w7jw-789q-3m8p accepted per SECURITY.md §Accepted Risks" \
  pnpm run release:usb
```

The bypass reason is written to `RELEASE_MANIFEST.txt` so every produced artifact is traceable. The value must be exactly `"1"` — other values (`true`, `yes`, `2`, or empty) are ignored and the gate runs normally.

Do not use `SKIP_AUDIT=1` to suppress uninvestigated advisories. Use the allowlist instead.

#### Running the gate tests

The gate logic is tested in isolation using a stubbed `pnpm` executable (no real network calls):

```bash
bash scripts/release-usb.audit.test.sh
# or via pnpm script:
pnpm run test:audit-gate
```

Tests cover: clean pass, non-allowlisted advisory failure, allowlisted-only pass, infra/network error, bypass with and without reason, and strict `SKIP_AUDIT=1` matching.

## `extract_ods_to_csv.py`

This script extracts selected sheets from the hospital `.ods` workbook into CSV working files.

It is intended for migration work before importing into the MVP application.

### Features

- list workbook sheets
- export one or more sheets to CSV
- export the recommended first MVP sheet group
- remove empty rows by default
- remove index rows such as `ÍNDICE AGENDA` by default

### Usage

List sheets:

```bash
python3 scripts/extract_ods_to_csv.py "/path/to/file.ods" --list
```

Export selected sheets:

```bash
python3 scripts/extract_ods_to_csv.py "/path/to/file.ods" \
  --sheet "Urgencias" \
  --sheet "Rayos" \
  --outdir tmp/ods-export
```

Export the recommended first MVP group:

```bash
python3 scripts/extract_ods_to_csv.py "/path/to/file.ods" \
  --group first-mvp \
  --outdir tmp/ods-export
```

Keep empty rows or visual index rows when needed:

```bash
python3 scripts/extract_ods_to_csv.py "/path/to/file.ods" \
  --sheet "Urgencias" \
  --keep-empty \
  --keep-index-rows
```

### Notes

- Output CSV files are working files, not the final normalized import template.
- The next step after extraction is normalization into the project CSV import template.
- See [../docs/ODS_TO_CSV_MAPPING.md](../docs/ODS_TO_CSV_MAPPING.md) for mapping rules.

## `normalize_working_csvs.py`

This script converts the extracted working CSV files into the MVP import template.

### Usage

```bash
python3 scripts/normalize_working_csvs.py \
  --indir tmp/ods-export \
  --out tmp/normalized/contacts-import-ready.csv
```

### Current Scope

- supports the recommended first MVP sheet group
- applies heuristic type, area, and department mapping
- detects some privacy markers from notes
- emits a CSV aligned with the project import template

### Important Limitation

This is a first-pass normalizer. The generated CSV should still be reviewed before import, especially for:

- room and control classification
- sensitive number flags
- person vs service detection
- external center naming

## `validate_normalized_csv.py`

This script validates a normalized CSV against the MVP CSV contract and emits a human-readable summary.

### Usage

```bash
python3 scripts/validate_normalized_csv.py \
  tmp/normalized/contacts-import-ready.csv \
  --report tmp/normalized/contacts-import-ready.report.json
```

### What It Checks

- required headers
- required row fields
- allowed type, area, and status values
- boolean field consistency
- missing contact or location
- duplicate `externalId`
- multiple primary phones or emails
- likely workbook noise still present in text fields
- duplicate tags or aliases

## `convert_csv_to_contacts_json.py`

This script converts a validated normalized CSV into the MVP `contacts.json` dataset.

### Usage

```bash
python3 scripts/convert_csv_to_contacts_json.py \
  tmp/normalized/contacts-import-ready.csv \
  --out tmp/json/contacts.json \
  --editor-name "Samuel"
```

### Output

The generated JSON follows the project MVP dataset shape:

- dataset version
- export timestamp
- catalogs
- normalized records
- structured phones and emails
- aliases and tags arrays
- basic audit metadata
