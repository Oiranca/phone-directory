# Migration Scripts

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
- See [../ODS_TO_CSV_MAPPING.md](/Users/samuelromeroarbelo/Projects/phone-directory/ODS_TO_CSV_MAPPING.md) for mapping rules.

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
