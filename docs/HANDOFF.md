# Session Handoff

## Purpose

This file is the single session handoff reference for the repository.

Use it at the start of every new Codex session to understand:

- the current delivery status
- the active branch and pull request
- the latest review state
- the next recommended actions
- the working rules that must remain consistent

## Project Snapshot

- Project: `Hospital Directory MVP`
- Product type: local-first desktop application for a hospital contact directory
- Stack: `Electron + React + TypeScript + Vite`
- Persistence: local JSON files
- Migration path: `ODS -> working CSV -> normalized CSV -> contacts.json`
- Product UI language: Spanish
- Code, comments, scripts, variables, and documentation language: English

## Current Git State

- Active branch: `feat/oir-19-csv-template-validation`
- Base branch: `main`
- Active pull request: not opened yet for the current branch

## Current Linear Backlog

- `OIR-18` Done — weighted Fuse.js search ranking landed in PR #10 and merged to `main`
- `OIR-19` In Progress — CSV template validation and per-row error reporting
- `OIR-20` Todo — recovery flow for invalid `contacts.json`
- `OIR-21` Todo — portable USB packaging
- `OIR-22` Todo — Playwright critical-flow coverage
- `OIR-23` Todo — global toast notification system
- `OIR-24` Todo — writable path validation in Settings
- `OIR-25` Todo — restore-from-backup UI flow
- `OIR-26` Todo — tag-based directory filtering
- `OIR-27` Done — privacy inline warnings merged in PR #9
- `OIR-28` Todo — executable-relative portable data paths
- `OIR-29` Todo — USB launcher scripts

## What Is Already In Place

- MVP planning documents and migration references
- JSON persistence, backups, import/export, and settings flows
- Weighted Fuse.js search with ranking tests
- Directory privacy warning UI for sensitive phones
- CSV preview flow with row-level issues, warnings, and import confirmation
- Local CI command and test/build/typecheck workflow

## Current Review Status

Current branch work is not committed yet and is focused on `OIR-19`.

Implemented in the working tree:

- strict CSV header validation against the MVP template contract
- duplicate header detection before row parsing
- unsupported column detection before row parsing
- renderer test coverage that confirms template validation errors surface to the user
- service coverage for unsupported and duplicate header failures
- plan and handoff refresh to reflect post-merge repository state

Required before commit and PR:

- complete two QA and code review cycles on the final diff
- keep commits small and in English
- open a ready-for-review PR, not a draft
- attach the PR link back to Linear

## Key Repository Rules

- Always work on a dedicated branch per Linear issue
- Move the owning Linear issue to `In Progress` before implementation and to `Done` after merge
- Run two QA and code review cycles before commits and before opening the PR
- Keep commits small and logically scoped
- Update `docs/MVP_PLAN.md` and `docs/HANDOFF.md` whenever plan status or active work changes
- Keep all docs in English
- Keep only user-facing application text in Spanish

## Important Files

- [README.md](../README.md)
- [MVP_PLAN.md](./MVP_PLAN.md)
- [HANDOFF.md](./HANDOFF.md)
- [CSV_IMPORT_TEMPLATE.md](./CSV_IMPORT_TEMPLATE.md)
- [ODS_TO_CSV_MAPPING.md](./ODS_TO_CSV_MAPPING.md)
- [scripts/README.md](../scripts/README.md)

## Recommended Start-Of-Session Checklist

1. Read this file
2. Check `git status` and confirm the active branch
3. Check the Linear issue that owns the current branch
4. Review open PR comments if a PR already exists
5. Run fresh validation before making any completion claim

## Recommended Next Step

Finish `OIR-19` on `feat/oir-19-csv-template-validation`, run the second QA/code review cycle on the full diff, commit the work in small English commits, and open the PR.
