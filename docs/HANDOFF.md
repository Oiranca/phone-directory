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

- Active branch: `feat/bootstrap-mvp-local-ci`
- Base branch: `main`
- Active pull request: [#1 Bootstrap hospital directory MVP foundation and local CI workflow](https://github.com/Oiranca/phone-directory/pull/1)

## Current Linear Backlog

- `OIR-10` Core local app foundation for the hospital directory MVP
- `OIR-11` Consolidate the migration pipeline from ODS to normalized contacts dataset
- `OIR-12` Implement the main directory workspace for search and record detail
- `OIR-13` Implement the dedicated create and edit record workflow
- `OIR-14` Implement MVP import, export, and backup flows
- `OIR-15` Implement the MVP settings flow for editor identity and managed data paths
- `OIR-16` Harden the MVP and define the release candidate quality gate

## What Is Already In Place

- MVP planning documents and migration references
- ODS extraction, CSV normalization, CSV validation, and JSON conversion scripts
- Example `contacts.example.json` and `settings.example.json`
- Electron main process bootstrap
- React renderer scaffold and routing
- Shared TypeScript types and Zod schemas
- Local CI command and tracked pre-commit hook
- Initial PR opened for the bootstrap work

## Current Review Status

The current PR is under review and has active follow-up work.

Implemented or in progress during the current review pass:

- replacing absolute local documentation links with repository-relative links
- adding a labeled search field for accessibility
- hardening Electron window settings with `sandbox: true`
- fixing non-portable backup path creation
- aligning normalized CSV labels with the Spanish UI policy
- relaxing CSV validator header requirements to match the documented import contract
- adding recovery UI for bootstrap loading failures
- expanding search matching to operational fields such as extensions, location, tags, emails, notes, and person names
- adding tests for bootstrap recovery and broader search matching

Outstanding review follow-up still to finish in the current branch:

- reduce renderer trust and settings write surface where practical
- rerun CI
- perform the second QA and code review cycle
- reply to PR review comments in English
- close resolved review comments
- push the branch and update the PR

## Key Repository Rules

- Always work on a dedicated branch per Linear issue
- Create or confirm the Linear issue before starting implementation work
- Open a PR with a complete English description instead of pushing directly to `main`
- Keep commits small and logically scoped
- Update `README.md` whenever setup, workflow, architecture, scripts, or operational behavior changes
- Keep all docs in English
- Keep only user-facing application text in Spanish

## Important Files

- [README.md](./README.md)
- [MVP_PLAN.md](./MVP_PLAN.md)
- [CSV_IMPORT_TEMPLATE.md](./CSV_IMPORT_TEMPLATE.md)
- [ODS_TO_CSV_MAPPING.md](./ODS_TO_CSV_MAPPING.md)
- [scripts/README.md](./scripts/README.md)

## Recommended Start-Of-Session Checklist

1. Read this file
2. Check the active branch and `git status`
3. Check the active PR and pending review comments
4. Check the Linear issue that owns the current work
5. Run the relevant local validation before making new claims

## Recommended Next Step

Finish the PR #1 review remediation on `feat/bootstrap-mvp-local-ci`, complete the second QA/review cycle, update the PR, and then branch from the next approved Linear issue.
