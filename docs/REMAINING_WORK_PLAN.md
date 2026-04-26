# Remaining Work Plan

## Document Status

- Language: English
- Scope: active backlog and follow-up work only
- Source consolidation: `MVP_PLAN.md` + `RESPONSIVE_ACCESSIBILITY_PLAN.md`
- Last updated: 2026-04-26

## 1. Purpose

This document is the single active planning reference for all remaining work currently identified in the legacy MVP and responsive/accessibility plans.

Completed work is intentionally omitted unless it changes the order or scope of the remaining backlog.

## 2. Current Baseline

The current codebase already includes:

- responsive core renderer layouts
- shared field-state and feedback primitives
- hardened `SelectField` semantics and tests
- directory master-detail browsing improvements
- global toast notifications via `ToastProvider` and `ToastRegion`
- data corruption recovery flow for invalid `contacts.json`
- privacy warning presentation improvements
- weighted Fuse.js ranking
- CSV template header validation
- editable settings path validation with actionable errors
- managed-path recovery for broken custom data locations
- compacted record detail cards for phones, emails, and long text

Latest known verified baseline:

- `npm run typecheck`
- `npm test`
- `npm run build`

Known test note:

- the bootstrap-failure stderr output in `src/renderer/app/App.test.tsx` is expected and not a failing condition

## 3. Priority Order

### Priority 1 — Finish MVP reliability and operator safety

These items have the highest product value because they reduce data-loss risk, unblock non-technical staff, and close core workflow gaps.

1. `OIR-25` — add restore-from-backup UI in Import/Export
2. remaining destructive-flow dialog migration from browser confirms to app dialogs
3. responsive and accessibility follow-up QA at `200%` zoom, `320px` width, keyboard-only navigation, and screen-reader status announcement checks

### Priority 2 — Add critical regression coverage

These items protect the MVP flows that already exist in the product.

1. `OIR-22` — add Playwright end-to-end coverage for critical MVP flows
2. add targeted regression coverage for:
   - status regions
   - retry and recovery flows
   - empty states
   - text reflow and narrow-width behavior

### Priority 3 — Improve search completeness

This item improves discoverability but is less urgent than data safety and test coverage.

1. `OIR-26` — add tag-based filtering to the directory search experience

### Priority 4 — Portable USB deployment track

These items are important for distribution but should start after the core MVP workflow and test gaps are closed.

1. `OIR-21` — package the Electron app as a portable cross-platform USB deployment
2. `OIR-28` — store app data using executable-relative paths in portable mode
3. `OIR-29` — add cross-platform launcher scripts at the USB root

## 4. Remaining Work Details

### 4.1 `OIR-25` — Restore-from-backup UI

Goal:

- make backup recovery available directly in the Import/Export screen

Why it matters:

- removes manual filesystem hunting
- makes recovery usable for non-technical staff

Definition of done:

- backup files can be listed in the UI
- a user can choose a backup and restore it through a guided flow
- destructive steps use the shared app dialog pattern
- restore success and failure paths are covered by tests

### 4.2 Destructive dialog migration follow-up

Goal:

- replace remaining `window.confirm` destructive flows with the reusable app dialog pattern

Why it matters:

- consistent focus handling
- better accessibility
- better Electron cross-platform behavior

Definition of done:

- all destructive flows use the same dialog system
- focus trap, initial focus, Escape close, and focus return are verified

### 4.3 Responsive and accessibility follow-up QA

Goal:

- finish the remaining manual and targeted regression sweep after the merged OIR-31 work

Focus checks:

- `200%` zoom
- `320px` effective width
- keyboard-only navigation
- visible focus states
- screen-reader-announced status changes

Definition of done:

- no critical or major responsive/accessibility gaps remain in current renderer routes
- follow-up defects found in the sweep are either fixed or recorded as explicit backlog items

### 4.4 `OIR-22` — Playwright critical flows

Goal:

- protect the MVP with end-to-end coverage for the main operator journeys

Required flows:

- open app and load sample dataset
- search and open a contact detail
- create a contact
- edit a contact
- import valid JSON
- import valid CSV with preview
- export JSON

Definition of done:

- Playwright is configured and runnable in the repository
- the critical flows above pass consistently
- failures are actionable and stable enough for CI use later

### 4.5 Targeted UI regression coverage follow-up

Goal:

- close focused gaps not fully covered by the current component and page tests

Required checks:

- async status region announcements
- retry and recovery surfaces
- empty-state semantics
- text reflow and narrow-width layout behavior

Definition of done:

- targeted tests exist for the identified gaps
- no uncovered critical regression surface remains in the current UI routes

### 4.6 `OIR-26` — Tag-based filtering

Goal:

- allow operators to narrow results by tags in the directory UI

Why it matters:

- tags already exist in the data model and import pipeline
- the search index already includes tags, but the UI does not expose them as filters

Definition of done:

- tags can be filtered in the directory experience
- filter state is clear, reversible, and test-covered
- the interaction remains accessible and responsive

### 4.7 `OIR-21`, `OIR-28`, `OIR-29` — Portable USB deployment

Goal:

- ship a portable build that runs from USB media without relying on system app-data paths

Scope split:

- `OIR-21`: packaging and portable distribution
- `OIR-28`: executable-relative data and backup storage in portable mode
- `OIR-29`: one-click launchers at USB root for supported platforms

Definition of done:

- packaged app runs without installation
- portable mode keeps `contacts.json`, `settings.json`, and backups with the executable
- launcher scripts exist for the supported targets

## 5. Recommended Execution Sequence

1. `OIR-25`
2. destructive dialog migration follow-up
3. responsive/accessibility QA sweep and targeted fixes
4. `OIR-22`
5. targeted UI regression coverage follow-up
6. `OIR-26`
7. `OIR-21`
8. `OIR-28`
9. `OIR-29`

## 6. Recommended Starting Point

Start with `OIR-25`.

Reason:

- next operator-facing recovery gap after settings-path hardening shipped
- directly improves recovery for non-technical staff
- builds on the path validation and backup infrastructure already in place
- gives fast, testable progress without opening the larger deployment track too early

## 7. Explicit Exclusions

These items were present in legacy planning docs but should not be treated as remaining work:

- `OIR-23` global toast system: already implemented in the current codebase
- `OIR-24` settings path validation and managed recovery: implemented on the current line
- merged OIR-31 responsive layout work already delivered on the current line
