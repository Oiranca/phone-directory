# Project Audit and Improvement Plan

## Document status

- Audit date: 2026-06-14
- Scope: application code, Electron boundaries, local persistence, security, tests, dependencies, release tooling, and safe simplification
- Target deployment: single-workstation, offline-first Electron application distributed by USB
- Method: code review by four independent lanes (engineering, security, QA, architecture), dependency audit, secret/environment scan, unit/build verification, and Electron E2E execution
- Rule: every phase below must be delivered as small pull requests with no unrelated behavior changes

## 1. Executive summary

The project has a strong security baseline for an Electron desktop application: sandboxing is enabled, Node integration is disabled, navigation is restricted, IPC inputs are generally validated, filesystem paths receive careful validation, imports have resource limits, and local release tooling includes a dependency gate.

The main risks are data integrity and verification gaps rather than remote exploitation. The current E2E suite has one failing critical-flow test, but E2E is excluded from `pnpm run ci`; therefore the normal CI command can report success while a core import workflow is broken. Audit-log corruption can also be treated as an empty log, confidential contact flags are not enforced as access controls, and duplicate detection can block Electron's main process at the maximum supported dataset size.

Safe simplification is possible, but only after behavior is frozen with contract and characterization tests. A rewrite, storage migration, or combined framework upgrade is not recommended.

### Current health

| Area | Rating | Summary |
| --- | --- | --- |
| Security controls | 3/4 | Strong Electron and path controls; privacy flags and audit export need hardening |
| Data integrity | 2/4 | Atomic/queued writes are good; audit corruption and renderer synchronization remain risks |
| Automated testing | 2/4 | Broad unit coverage; E2E is red and omitted from the default CI gate |
| Architecture | 2/4 | Clear layers exist, but core services and import logic are oversized |
| Maintainability | 2/4 | Several duplicated contracts, loaders, models, and dead/hidden surfaces |
| Release hygiene | 3/4 | Strong local audit gate; scripts and test harnesses are too large |

### Priority totals

- P0: 0 findings
- P1: 8 findings requiring the first implementation phases
- P2: 11 findings requiring planned remediation
- P3: 8 improvements suitable after stabilization

## 2. Verification evidence

### Fresh results

- `pnpm run ci`: passed before document creation; unit suite reported 477 passing tests and build/audit checks passed
- `pnpm run test:e2e`: failed with 9 passing and 1 failing test
- Failing flow: `tests/e2e/critical-flows.spec.ts`, bulk import confirmation remains disabled because the test does not select the conflict policy introduced by the current import workflow
- `pnpm audit --json`: 3 advisories; all are documented and allowlisted by the repository audit gate
- Secret scan: no committed credential found by the lightweight repository scan
- Environment scan: no production secret contract found; `.env` files are ignored

### Dependency snapshot

| Category | Current action |
| --- | --- |
| `shell-quote` critical advisory | Keep documented allowlist only while upstream/transitive replacement is unavailable; review expiry every release |
| `tmp` high advisory | Keep documented allowlist temporarily; track owning dependency and remove at first compatible release |
| `esbuild` high advisory | Development-server exposure; keep gate documentation current and avoid untrusted network binding |
| Patch/minor updates | Schedule `postcss`, `electron-builder`, and `fuse.js` separately with focused verification |
| Major updates | React 19, Router 7, Tailwind 4, TypeScript 6, Vite 8, Vitest 4, Zod 4, Zustand 5, and Electron 42 require independent migration PRs |

Do not combine major dependency upgrades with the architecture phases in this plan.

## 3. Existing strengths to preserve

- `BrowserWindow` uses `contextIsolation: true`, `nodeIntegration: false`, and `sandbox: true`.
- New windows are denied and unexpected navigation is blocked.
- Production applies a restrictive Content Security Policy.
- Risky IPC handlers validate untrusted renderer input.
- Restore and managed-path flows canonicalize paths, reject symlinks, and re-check filesystem state against TOCTOU changes.
- JSON writes use durability measures and the application serializes important mutations.
- Spreadsheet parsing runs in a resource-capped worker.
- CSV/spreadsheet imports enforce 5 MB and 5,000-row limits.
- Conflict preview payloads minimize contact data.
- Release packaging is blocked by the local dependency/security audit gate.
- `.env` and local environment variants are excluded from Git.

These controls are production assets. Refactors must retain them and their tests.

## 4. Detailed findings

### P1: immediate stabilization

#### P1-01: Critical E2E flow is failing but excluded from CI

- Evidence: `package.json` defines `ci` without `test:e2e`; `scripts/ci-local.sh` follows that command; `tests/e2e/critical-flows.spec.ts` currently times out on the bulk-import confirmation button.
- Impact: a green local CI result does not prove the operator's critical import path works.
- Change: update the E2E fixture to resolve import conflicts, then add a required Electron E2E job or explicit release gate.
- Tests: no-conflict import, conflict with each supported policy, cancel, expired preview token, and malformed input.

#### P1-02: Audit-log corruption can silently erase history

- Evidence: `src/main/services/audit-log.service.ts` treats read/parse failure as an empty array during append and query.
- Impact: the next append can overwrite a corrupt log; operators may see an empty history without a blocking warning.
- Change: quarantine the damaged file, preserve evidence, return a typed integrity error, and require an explicit recovery action.
- Tests: malformed JSON, unreadable file, failed quarantine, failed append, restart after recovery, and preservation of the original bytes.

#### P1-03: Confidentiality flags are presentation metadata, not enforced policy

- Evidence: confidential/no-sharing fields are still indexed in `src/renderer/services/search.service.ts` and rendered raw in `DirectoryPage.tsx`.
- Impact: any workstation user can search and reveal values marked confidential.
- Change: define the intended policy first. If flags are security controls, create main-process safe view models, exclude flagged values from default search, and mask them unless privileged reveal is explicitly supported. If they are advisory only, rename them and document that limitation.
- Tests: search exclusion, masked rendering, clipboard/export behavior, and privileged reveal authorization if added.

#### P1-04: Duplicate merge leaves renderer state stale

- Evidence: the merge IPC returns a record, while `DeduplicatePage.tsx` does not refresh or reconcile the central store after the persisted dataset changes.
- Impact: the UI can display records that no longer match disk until reload.
- Change: return the updated dataset/version or apply a deterministic store mutation after success.
- Tests: merge success, selected-record removal, survivor update, failure rollback, and reload equivalence.

#### P1-05: Duplicate detection is quadratic on Electron's main process

- Evidence: `duplicate-detection.service.ts` performs pairwise comparisons; the supported 5,000-row limit can produce about 12.5 million comparisons.
- Impact: long main-process stalls can freeze the application and trigger operator retries.
- Change: first add timing/behavior tests, then move detection to a capped worker or introduce indexed candidate generation without changing match semantics.
- Tests: exact result parity, 5,000-record fixture, worker timeout, worker crash, cancellation, and bounded memory.

#### P1-06: `AppDataService` owns too many responsibilities

- Evidence: the 1,700+ line service owns settings, paths, contacts, backups, imports, duplicate merge, audit export, scheduling, and write serialization.
- Impact: unrelated changes share a large regression surface and security-sensitive invariants are difficult to isolate.
- Change: keep `AppDataService` as a compatibility facade; extract collaborators only after seam tests exist.
- Tests: facade delegation, write queue ordering, atomicity, error mapping, and existing service characterization suite.

#### P1-07: Spreadsheet import is a high-risk monolith

- Evidence: `spreadsheet-import.service.ts` combines format heuristics, normalization, parsers, worker orchestration, and preview assembly in 1,200+ lines.
- Impact: parser changes can alter unrelated formats and production imports.
- Change: extract pure format-specific parsers and normalization helpers without modifying heuristics in the same PR.
- Tests: golden fixtures for every accepted format, malformed files, ambiguous headers, size limits, worker failure, and result parity.

#### P1-08: Application bootstrap ownership is duplicated

- Evidence: global loading exists in `App.tsx`, while Directory, Contact Form, Settings, and Import/Export pages repeat fallback loading.
- Impact: retry and recovery behavior can diverge across routes.
- Change: introduce one idempotent `ensureBootstrapLoaded` store action/hook; retain page-specific loaders only for page data.
- Tests: direct route entry, one load per bootstrap, retry after failure, recovery mode, and route transitions.

### P2: security, contracts, and durability

#### P2-01: Audit CSV formula injection

- Evidence: CSV quoting does not neutralize cells beginning with `=`, `+`, `-`, or `@`.
- Impact: opening an exported audit CSV in spreadsheet software can evaluate attacker-controlled formulas.
- Change: neutralize dangerous leading characters for every exported cell before RFC-compliant CSV escaping.
- Tests: all dangerous prefixes, whitespace-prefixed formulas, quotes, commas, newlines, and normal Unicode text.

#### P2-02: Audit coverage does not match declared actions

- Evidence: bulk import appends audit entries, but create, update, duplicate merge, restore, and other mutations do not consistently append them.
- Impact: incident investigation and operator accountability are incomplete.
- Change: define one mutation audit contract and append only after successful durable writes; decide explicitly whether audit failure blocks the mutation.
- Tests: one entry per successful mutation, none on failure, redaction rules, actor/source fields, and ordered concurrent writes.

#### P2-03: Import confirmation token is not bound to its renderer sender

- Evidence: the preview stores `senderId`, but confirmation does not compare it with `event.sender.id`.
- Impact: another renderer in the same process could consume a token if one is introduced or compromised.
- Change: enforce sender equality and invalidate tokens after use, expiry, navigation, or sender destruction.
- Tests: correct sender, wrong sender, reuse, expiry, destroyed sender, and concurrent confirmations.

#### P2-04: Backup names can collide

- Evidence: backup identity relies on timestamp precision.
- Impact: simultaneous operations can overwrite or fail unpredictably.
- Change: add a random/monotonic suffix and keep creation inside the serialized write boundary.
- Tests: fixed clock, parallel requests, collision retry, and retention ordering.

#### P2-05: Absolute local paths are exposed broadly in the renderer

- Evidence: import preview, backup cards, recovery, and settings render full local paths.
- Impact: screenshots reveal usernames, share names, and workstation structure.
- Change: display basenames by default; reveal/copy the full path only through an explicit action. Remove `sourceFilePath` from preview payloads when the token already owns it.
- Tests: default redaction, explicit reveal, copy action, basename collision display, and accessibility labels.

#### P2-06: Electron API contract is copied across boundaries

- Evidence: preload implementation, renderer ambient declarations, and IPC channel definitions are maintained separately.
- Impact: drift can compile in one layer and fail at runtime in another.
- Change: define one shared typed public API, derive the renderer type from it, and keep raw channel names private to main/preload.
- Tests: preload exposure contract, handler registration, argument/return type checks, and renderer mocks using the shared type.

#### P2-07: Main bootstrap, preload, and settings IPC lack direct contract tests

- Evidence: behavior is covered indirectly, but navigation/CSP setup, public preload methods, and settings handlers have no focused suite.
- Impact: high-trust boundary regressions are detected late.
- Change: add focused unit/contract tests plus one packaged `file://` startup smoke test.
- Tests: sandbox flags, denied navigation/windows, CSP, all exposed methods, unknown inputs, service failures, and production loading.

#### P2-08: Shared domain shapes duplicate Zod schemas

- Evidence: `src/shared/types/contact.ts` and `src/shared/schemas/contact.ts` describe overlapping persisted and IPC data.
- Impact: runtime validation and TypeScript contracts can drift.
- Change: incrementally derive stable persisted/IPC types with `z.infer`; keep explicit UX-only types separate.
- Tests: schema suite, typecheck, serialization compatibility, and renderer compilation.

#### P2-09: Matching and dataset metadata helpers are duplicated

- Evidence: counts, normalization, and matching helpers appear in CSV import, app data, and duplicate detection with different ownership.
- Impact: fixes can change one workflow but not another.
- Change: extract exact current pure helpers first. Do not unify matching algorithms until parity tests prove intended differences.
- Tests: shared fixture matrix across import, conflict detection, and duplicate detection.

#### P2-10: Environment variable documentation is incomplete

- Evidence: `.env.example` documents only `ELECTRON_OPEN_DEVTOOLS`; dev, E2E, portable, and dialog fixture variables exist elsewhere.
- Impact: local and release behavior is harder to reproduce and audit.
- Change: document variables by category: user-configurable, internal runtime, E2E-only, and release-only. Do not put secrets or machine paths in examples.
- Tests: static consistency check between referenced variables and documentation.

#### P2-11: Platform-specific filesystem durability receives partial coverage

- Evidence: conditional tests exercise only the current runner's platform branch.
- Impact: Windows/POSIX behavior can regress unnoticed.
- Change: inject platform behavior into unit tests and keep a small Windows/Linux/macOS release matrix for filesystem smoke tests.
- Tests: rename/fsync semantics, error mapping, atomic replacement, and cleanup per platform.

### P3: maintainability and operator experience

#### P3-01: Import preview can render all 5,000 rows

- Change: paginate or virtualize while preserving summary and conflict controls.
- Tests: first/last rows, keyboard navigation, conflict selection persistence, and bounded DOM size.

#### P3-02: Large renderer pages mix orchestration and presentation

- Evidence: `ContactFormPage.tsx` exceeds 1,000 lines; Directory and Import/Export pages also own many independent concerns.
- Change: extract route hooks and cohesive presentational sections after bootstrap/API contracts stabilize.
- Tests: retain page-level tests; add focused tests only for extracted stateful units.

#### P3-03: Audit-log UI is hidden but its full boundary remains shipped

- Change: make an explicit product decision: restore the route intentionally or remove the unreachable renderer surface. Preserve backend capture if required for compliance.
- Tests: route/navigation and IPC expectations for the chosen direction.

#### P3-04: `buscas:search` is an unused IPC boundary

- Evidence: main exposes a search handler, but preload does not expose it and the renderer searches locally.
- Change: remove the dead handler/service path unless main-process search is an explicit future requirement.
- Tests: Buscas page behavior and handler registration snapshot.

#### P3-05: Release audit implementation and tests are oversized

- Evidence: `audit-gate.sh` approaches 1,000 lines and `release-usb.audit.test.sh` approaches 3,800 lines.
- Change: keep a thin shell entrypoint; move structured advisory processing to a small Node module with table-driven Vitest tests; split release fixtures by concern.
- Tests: retain the top-level shell smoke test and require parity against current fixtures.

#### P3-06: Confirmation-dialog edge cases are under-tested

- Change: add disabled-confirm and Escape behavior tests, including focus restoration.

#### P3-07: Managed-path UI reveals more information than operators usually need

- Change: use compact basename-first display and explicit reveal/copy controls; avoid nested decorative cards around operational sections.

#### P3-08: Patch/minor dependency maintenance is accumulating

- Change: update one dependency family per PR, run full gates, and record any allowlist impact. Major migrations stay separate.

## 5. Safe simplification strategy

### Simplifications considered safe after tests

1. Centralize bootstrap loading behind one idempotent action.
2. Create one typed Electron public API contract.
3. Remove the unused `buscas:search` boundary.
4. Decide and eliminate the half-shipped audit-log UI state.
5. Extract pure normalization/counting helpers without changing algorithms.
6. Keep `AppDataService` as facade while moving one responsibility at a time.
7. Split spreadsheet format parsers without changing heuristics.
8. Split release audit structured logic from shell orchestration.
9. Derive stable domain types from Zod incrementally.
10. Decompose large pages only after state ownership is stable.

### Changes not considered safe now

- Rewriting the application or replacing Electron.
- Replacing JSON persistence before integrity requirements and migration/rollback tests exist.
- Removing the mutation write queue or path-safety checks.
- Combining security fixes with parser heuristic changes.
- Combining React, Router, Tailwind, Vite, Vitest, Zod, Zustand, or Electron major upgrades.
- Weakening the dependency allowlist gate to obtain a green release.
- Moving confidential-data enforcement only into renderer components.

## 6. Phased implementation roadmap

### Phase 0: restore trustworthy gates

Goal: make green verification meaningful before refactoring.

- [ ] F0-01 Fix the conflict-aware bulk import E2E test.
- [ ] F0-02 Add all conflict policies, cancel, expiry, and invalid-token E2E cases.
- [ ] F0-03 Add Electron E2E to the required local release/CI gate.
- [ ] F0-04 Add a packaged `file://` startup smoke test for CSP and production asset loading.
- [ ] F0-05 Record baseline timing for duplicate detection at 100, 1,000, and 5,000 records.

Exit criteria:

- Unit, typecheck, build, audit gate, and Electron E2E all pass from one documented command.
- No test depends only on the development renderer URL for production startup coverage.

Recommended PRs: 2 small PRs. Risk: low.

### Phase 1: protect data and privacy

Goal: remove the highest-impact integrity and security defects.

- [ ] F1-01 Fail closed on audit-log corruption; quarantine and preserve damaged files.
- [ ] F1-02 Neutralize spreadsheet formulas in audit CSV exports.
- [ ] F1-03 Define and enforce the confidentiality/no-sharing policy in main-process view models.
- [ ] F1-04 Bind import tokens to sender, expiry, and single use.
- [ ] F1-05 Make backup identity collision-resistant.
- [ ] F1-06 Reconcile renderer state after duplicate merge.
- [ ] F1-07 Reduce default exposure of absolute local paths.

Exit criteria:

- Corrupt audit data cannot be silently replaced.
- Confidential values follow a documented, tested policy.
- Exported CSV cells cannot trigger formulas.
- Merge UI and persisted state remain equivalent.

Recommended PRs: 5-7 focused PRs. Risk: medium.

### Phase 2: complete the audit and boundary contracts

Goal: make high-trust operations explicit and testable.

- [ ] F2-01 Define one audit event contract for every successful mutation.
- [ ] F2-02 Add create/update/merge/restore/import audit entries and failure semantics.
- [ ] F2-03 Define one shared typed preload API.
- [ ] F2-04 Add direct tests for main-window security configuration, preload, contacts/settings IPC, and error mapping.
- [ ] F2-05 Derive stable persisted/IPC types from Zod schemas incrementally.
- [ ] F2-06 Document all environment variables by ownership and lifecycle.
- [ ] F2-07 Add cross-platform filesystem durability coverage.

Exit criteria:

- Every mutating operation has a tested audit outcome.
- Renderer/preload/main contract drift fails typecheck or tests.
- Production security flags and CSP have direct regression tests.

Recommended PRs: 4-6 PRs. Risk: medium.

### Phase 3: simplify boundaries without behavior changes

Goal: reduce duplication before splitting core services.

- [ ] F3-01 Centralize bootstrap ownership.
- [ ] F3-02 Extract exact shared counting/normalization helpers.
- [ ] F3-03 Remove or deliberately activate the audit-log UI.
- [ ] F3-04 Remove the dead `buscas:search` IPC path unless product scope requires it.
- [ ] F3-05 Add facade seam tests for `AppDataService` and parser characterization fixtures.

Exit criteria:

- Direct route entry and recovery behavior are unchanged.
- Import, conflict, and duplicate fixtures produce byte-for-byte equivalent normalized results where expected.
- No unreachable public IPC handler remains without a documented owner.

Recommended PRs: 3-5 PRs. Risk: low to medium.

### Phase 4: decompose main-process services

Goal: lower regression blast radius while preserving the public API.

- [ ] F4-01 Extract `SettingsRepository` and managed-path validation ownership.
- [ ] F4-02 Extract `ContactsRepository` while retaining the existing write queue.
- [ ] F4-03 Extract `BackupService` and `AutoBackupScheduler`.
- [ ] F4-04 Extract `ImportMergeService` and audit coordination.
- [ ] F4-05 Split spreadsheet pure parsers by accepted format.
- [ ] F4-06 Keep `AppDataService` as facade until all callers and tests are stable.

Exit criteria:

- No public IPC/preload signature changes.
- Existing service characterization tests remain green.
- Queue ordering, atomic writes, backups, imports, and recovery have focused owner tests.

Recommended PRs: one extraction per PR. Risk: medium to high if combined; medium when isolated.

### Phase 5: performance and renderer decomposition

Goal: remove UI stalls and reduce page complexity.

- [ ] F5-01 Move duplicate detection to a capped worker or indexed candidate pipeline with parity tests.
- [ ] F5-02 Virtualize/paginate the 5,000-row import preview.
- [ ] F5-03 Extract `ContactFormPage` orchestration hooks and sections.
- [ ] F5-04 Extract Directory search/detail state from presentation.
- [ ] F5-05 Extract Import/Export workflow state from presentation.
- [ ] F5-06 Normalize basename-first path presentation and reveal controls.

Exit criteria:

- Main process remains responsive during the maximum supported duplicate scan.
- Import preview DOM size is bounded.
- Keyboard, focus, recovery, and error behavior are unchanged.

Recommended PRs: 4-6 PRs. Risk: medium.

### Phase 6: release tooling and dependency maintenance

Goal: simplify operational code and keep the supported stack current.

- [ ] F6-01 Move audit advisory parsing to a small structured Node module.
- [ ] F6-02 Split shell audit/release fixtures while preserving one top-level smoke test.
- [ ] F6-03 Apply patch/minor dependency updates individually.
- [ ] F6-04 Re-evaluate each allowlisted advisory and remove entries immediately when fixed.
- [ ] F6-05 Plan major migrations as separate projects with rollback notes.

Exit criteria:

- Release audit behavior has parity fixtures.
- Allowlist entries remain package/advisory-specific, justified, and time-bounded.
- No major dependency migration shares a PR with functional work.

Recommended PRs: ongoing maintenance. Risk: low for extraction, variable for upgrades.

## 7. Required test matrix per PR

Every implementation PR must run the smallest relevant subset first, then the full gate before merge.

| Change area | Required targeted checks |
| --- | --- |
| Persistence/audit | service unit tests, corruption fixtures, atomicity/queue tests |
| IPC/preload | handler contract tests, invalid input, wrong sender, service errors, typecheck |
| Import | parser golden fixtures, conflict matrix, worker failure, E2E critical flow |
| Duplicate merge/detection | parity fixtures, store reconciliation, 5,000-record performance case |
| Renderer pages | focused Vitest/Testing Library tests, keyboard/focus cases, Electron E2E |
| Filesystem/release | shell smoke, Node helper tests, platform matrix where relevant |
| Dependencies | audit gate, unit suite, typecheck, build, Electron startup smoke |

Full merge gate:

1. `pnpm typecheck`
2. `pnpm test --exclude '.aia/**'`
3. `pnpm run build`
4. `pnpm run audit:gate`
5. `pnpm run test:e2e`
6. Packaged startup smoke for release-affecting changes

## 8. Implementation rules

- One behavioral concern per PR.
- Add or update tests before moving ownership boundaries.
- Preserve IPC signatures during internal extraction.
- Use typed errors; do not convert integrity failures to empty/default data.
- Keep security decisions in main/shared code, not renderer-only checks.
- Do not log contact PII, absolute paths, tokens, or raw imported rows.
- Benchmark before and after performance changes using fixed fixtures.
- Include rollback notes for persistence, parser, Electron, and dependency changes.
- Update this checklist as phases land; do not duplicate the active backlog elsewhere.

## 9. Recommended first implementation sequence

1. Fix and gate the failing import E2E flow.
2. Harden audit-log corruption handling.
3. Neutralize audit CSV formula injection.
4. Define confidentiality semantics before changing UI behavior.
5. Fix duplicate merge store synchronization.
6. Bind import tokens and harden backup naming.
7. Add preload/main/settings boundary tests.
8. Centralize bootstrap and public Electron contracts.
9. Add facade/parser characterization tests.
10. Begin one-responsibility-at-a-time service extraction.

This order first restores trustworthy evidence, then protects production data, then simplifies the system behind stable contracts.
