# Hospital Directory MVP

Local-first desktop MVP for managing a hospital contact directory.

The project is designed for administrative staff and prioritizes:

- fast search
- clear record detail
- offline operation
- simple JSON-based persistence
- safe handling of sensitive phone numbers

## Current Status

The repository currently includes:

- project planning and MVP scope documents
- migration tooling from `.ods` to normalized CSV and `contacts.json`
- React + Electron bootstrap
- shared types and Zod schemas
- example dataset and example settings
- initial renderer pages and Electron filesystem bootstrap

## Documentation

Planning and migration reference files:

- [HANDOFF.md](./HANDOFF.md)
- [MVP_PLAN.md](./MVP_PLAN.md)
- [CSV_IMPORT_TEMPLATE.md](./CSV_IMPORT_TEMPLATE.md)
- [ODS_TO_CSV_MAPPING.md](./ODS_TO_CSV_MAPPING.md)
- [scripts/README.md](./scripts/README.md)

## Tech Stack

- React
- TypeScript
- Vite
- Electron
- Tailwind CSS
- Zustand
- Zod
- Vitest

## Project Structure

```txt
data/                    Example JSON fixtures tracked in the repository
scripts/                 ODS extraction, normalization, validation, and conversion tooling
src/main/                Electron main process
src/preload/             Electron preload bridge
src/renderer/            React application
src/shared/              Shared types, schemas, constants, and fixtures
tmp/                     Ignored local migration outputs
```

## Getting Started

Install dependencies:

```bash
npm install
```

Start the development environment:

```bash
npm run dev
```

Optional local development environment file:

```bash
cp .env.example .env.local
```

Available development variables:

- `ELECTRON_OPEN_DEVTOOLS=1` opens Electron DevTools automatically in development.

Run the test suite:

```bash
npm run test
```

Run the local pre-commit CI gate:

```bash
npm run ci
```

Equivalent shell helper:

```bash
bash scripts/ci-local.sh
```

## Automatic Commit Gate

This repository is configured to run a local CI gate automatically on `git commit`.

The pre-commit hook runs:

- `npm run typecheck`
- `npm run test`
- `npm run build`

If the gate fails:

- the commit is blocked
- a failure report is written under `tmp/ci/`
- no automatic fix is applied by the hook

After fixing the reported failures locally, re-stage what you want and run `git commit` again.

Temporary bypass for an exceptional case:

```bash
SKIP_PRECOMMIT_CI=1 git commit
```

Build renderer and Electron sources:

```bash
npm run build
```

## Application Language Policy

- Code comments, identifiers, scripts, and documentation must be in English.
- User-facing application text is currently in Spanish.

## Example Data

Repository-safe example files:

- [data/contacts.example.json](./data/contacts.example.json)
- [data/settings.example.json](./data/settings.example.json)

Actual local data generated during migration stays outside versioned files.

## Migration Workflow

1. Extract selected sheets from the source `.ods`
2. Normalize working CSVs into the MVP CSV template
3. Validate the normalized CSV
4. Convert the validated CSV into `contacts.json`

Supporting scripts:

- [scripts/extract_ods_to_csv.py](./scripts/extract_ods_to_csv.py)
- [scripts/normalize_working_csvs.py](./scripts/normalize_working_csvs.py)
- [scripts/validate_normalized_csv.py](./scripts/validate_normalized_csv.py)
- [scripts/convert_csv_to_contacts_json.py](./scripts/convert_csv_to_contacts_json.py)

## Next Implementation Focus

The bootstrap is in place. The next product-facing iteration should implement:

- stronger search and filter behavior with Fuse.js
- the real contact form flow
- import/export UI
- backup management UI
- dataset editing and persistence actions from the renderer
