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

The release script runs `pnpm audit --audit-level=high` early in the pipeline (after typecheck, before tests and build). If any high-severity or critical advisories are found the release exits immediately with a non-zero code and no artifact is produced.

To bypass the gate when an advisory has been explicitly reviewed and accepted (see `SECURITY.md` → Accepted Risks):

```bash
SKIP_AUDIT=1 pnpm run release:usb
```

A warning line is printed to stderr when the override is active. Do not use `SKIP_AUDIT=1` to suppress uninvestigated advisories.

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
