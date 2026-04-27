# Remaining Work Plan

## Document Status

- Language: English
- Scope: active backlog and follow-up work only
- Source consolidation: `MVP_PLAN.md` + `RESPONSIVE_ACCESSIBILITY_PLAN.md`
- Last updated: 2026-04-27

## 1. Purpose

This document is the single active planning reference for all remaining work currently identified in the legacy MVP and responsive/accessibility plans.

Completed work is intentionally omitted unless it changes the order or scope of the remaining backlog.

Latest delivered planning note:

- `OIR-25` restore-from-backup UI was merged to `develop` on 2026-04-27 and is no longer part of the active remaining backlog
- destructive recovery dialog migration was merged to `develop` on 2026-04-27 and is no longer part of the active remaining backlog
- responsive/accessibility follow-up QA and targeted fixes were merged to `develop` on 2026-04-27 and are no longer part of the active remaining backlog
- `OIR-22` Playwright critical flows merged to `develop` on 2026-04-27 via PR `#24` and is no longer part of the active remaining backlog

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
- Playwright-based Electron end-to-end harness for critical MVP flows

Latest known verified baseline:

- `npm run typecheck`
- `npm test`
- `npm run test:e2e`
- `npm run build`

Known test note:

- the bootstrap-failure stderr output in `src/renderer/app/App.test.tsx` is expected and not a failing condition

## 3. Priority Order

### Priority 1 — Finish MVP reliability and operator safety

These items have the highest remaining value because they harden UI behavior already covered by the new end-to-end baseline.

1. add targeted regression coverage for:
   - status regions
   - retry and recovery flows
   - empty states
   - text reflow and narrow-width behavior

### Priority 2 — Improve search completeness

This item improves discoverability but is less urgent than data safety and test coverage.

1. `OIR-26` — add tag-based filtering to the directory search experience

### Priority 3 — Portable USB deployment track

These items are important for distribution but should start after the core MVP workflow and test gaps are closed.

1. `OIR-21` — package the Electron app as a portable cross-platform USB deployment
2. `OIR-28` — store app data using executable-relative paths in portable mode
3. `OIR-29` — add cross-platform launcher scripts at the USB root

## 4. Remaining Work Details

### 4.1 Targeted UI regression coverage follow-up

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

### 4.2 `OIR-26` — Tag-based filtering

Goal:

- allow operators to narrow results by tags in the directory UI

Why it matters:

- tags already exist in the data model and import pipeline
- the search index already includes tags, but the UI does not expose them as filters

Definition of done:

- tags can be filtered in the directory experience
- filter state is clear, reversible, and test-covered
- the interaction remains accessible and responsive

### 4.3 `OIR-21`, `OIR-28`, `OIR-29` — Portable USB deployment

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

1. targeted UI regression coverage follow-up
2. `OIR-26`
3. `OIR-21`
4. `OIR-28`
5. `OIR-29`

## 6. Recommended Starting Point

Start with targeted UI regression coverage follow-up.

Reason:

- it is now the highest remaining quality gap after `OIR-22` landed
- it complements the new Playwright happy-path coverage with focused assertions on UI semantics and narrow-width behavior
- it creates a stronger regression net before expanding search scope and portable-distribution work

## 7. Explicit Exclusions

These items were present in legacy planning docs but should not be treated as remaining work:

- `OIR-23` global toast system: already implemented in the current codebase
- `OIR-24` settings path validation and managed recovery: implemented on the current line
- `OIR-25` restore-from-backup UI: merged to `develop` on 2026-04-27
- `OIR-22` Playwright critical flows: merged to `develop` on 2026-04-27 via PR `#24`
- destructive dialog migration follow-up: merged to `develop` on 2026-04-27
- responsive/accessibility follow-up QA and targeted fixes: merged to `develop` on 2026-04-27
- merged OIR-31 responsive layout work already delivered on the current line
