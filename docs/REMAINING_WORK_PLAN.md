# Remaining Work Plan

## Document Status

- Language: English
- Scope: active backlog and follow-up work only
- Source consolidation: `MVP_PLAN.md` + `RESPONSIVE_ACCESSIBILITY_PLAN.md`
- Last updated: 2026-04-29 (OIR-43 complete)

## 1. Purpose

This document is the single active planning reference for all remaining work currently identified in the legacy MVP and responsive/accessibility plans.

Completed work is intentionally omitted unless it changes the order or scope of the remaining backlog.

Latest delivered planning note:

- `OIR-25` restore-from-backup UI was merged to `develop` on 2026-04-27 and is no longer part of the active remaining backlog
- destructive recovery dialog migration was merged to `develop` on 2026-04-27 and is no longer part of the active remaining backlog
- responsive/accessibility follow-up QA and targeted fixes were merged to `develop` on 2026-04-27 and are no longer part of the active remaining backlog
- `OIR-22` Playwright critical flows merged to `develop` on 2026-04-27 via PR `#24` and is no longer part of the active remaining backlog
- `OIR-26` tag-based filtering merged to `main` on 2026-04-28 via PR `#26` and is no longer part of the active remaining backlog
- `OIR-28` portable managed data roots merged to `main` on 2026-04-28 via PR `#27` and is no longer part of the active remaining backlog
- `OIR-21` portable cross-platform USB packaging merged to `main` on 2026-04-29 via PR `#28` and is no longer part of the active remaining backlog
- `OIR-29` USB launcher scripts merged to `main` on 2026-04-29 via PR `#29` and is no longer part of the active remaining backlog
- `OIR-43` settings folder-picker and auto-default paths merged to `main` on 2026-04-29 via PR `#30` and is no longer part of the active remaining backlog

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
- portable-mode managed data roots with portable metadata rebasing
- electron-builder `--dir` portable packaging for Windows (`win-unpacked/`), macOS (`mac/`, `mac-arm64/`), and Linux (`linux-unpacked/`, AppImage)
- portable-root symlink-chain safety checks before bootstrap
- compacted record detail cards for phones, emails, and long text
- Playwright-based Electron end-to-end harness for critical MVP flows
- USB launcher scripts for Windows (`launch.bat`), macOS (`launch.command`), and Linux (`launch.sh`) with `ELECTRON_PORTABLE_ROOT_PATH` pointing data to `portable-data/` at USB root
- Settings page native path pickers for data file and backup directory, with auto-default paths and browse-state coverage

Latest known verified baseline:

- `npm run typecheck`
- `npm test`
- `npm run test:e2e`
- `npm run build`

Known test note:

- the bootstrap-failure stderr output in `src/renderer/app/App.test.tsx` is expected and not a failing condition

## 3. Priority Order

### Priority 1 — Improve search completeness

This track is complete on the current line.

### Priority 2 — Portable USB deployment track

Complete. `OIR-21` and `OIR-29` both merged to `main` on 2026-04-29.

### Priority 3 — Settings UX

This track is complete on the current line.

### Priority 4 — Security hardening and dependency remediation

1. `OIR-35` — spreadsheet import dependency hardening (`xlsx` replacement or isolation)
2. `OIR-36` — enable or explicitly document BrowserWindow sandbox posture
3. `OIR-37` — split CSP for production-safe bundle output
4. `OIR-38` — gate E2E dialog bypass to unpackaged builds only
5. `OIR-39` — serialize `AppDataService` writes
6. `OIR-40` — replace `Math.random()` record IDs
7. `OIR-41` — strip filesystem paths from renderer-facing errors
8. `OIR-42` — fsync temp writes before rename on USB media

## 4. Remaining Work Details

### 4.1 Security remediation queue (`OIR-35` through `OIR-42`)

Goal:

- close the remaining security findings now that the portable deployment and Settings UX tracks are complete

Definition of done:

- `OIR-35` through `OIR-42` are resolved or explicitly accepted with documented rationale
- dependency and Electron upgrades are validated on the current packaging line
- production bundle security posture is re-checked after the fixes
- regression coverage remains green for affected import, IPC, and persistence flows


## 5. Recommended Execution Sequence

1. `OIR-35`
2. `OIR-36`
3. `OIR-37`
4. `OIR-38`
5. `OIR-39`
6. `OIR-40`
7. `OIR-41`
8. `OIR-42`

## 6. Recommended Starting Point

Start with `OIR-35`.

Reason:

- `OIR-43` merged to `main` on 2026-04-29 via PR `#30`, so the previous top product backlog item is closed
- `OIR-34` is addressed on the current branch, so `OIR-35` is now the highest-severity remaining issue

## 7. Explicit Exclusions

These items were present in legacy planning docs but should not be treated as remaining work:

- `OIR-23` global toast system: already implemented in the current codebase
- `OIR-24` settings path validation and managed recovery: implemented on the current line
- `OIR-25` restore-from-backup UI: merged to `develop` on 2026-04-27
- `OIR-22` Playwright critical flows: merged to `develop` on 2026-04-27 via PR `#24`
- `OIR-26` tag-based filtering: merged to `main` on 2026-04-28 via PR `#26`
- `OIR-28` portable managed data roots: merged to `main` on 2026-04-28 via PR `#27`
- `OIR-21` portable USB packaging: merged to `main` on 2026-04-29 via PR `#28`
- `OIR-29` USB launcher scripts: merged to `main` on 2026-04-29 via PR `#29`
- `OIR-43` settings folder-picker and auto-default paths: merged to `main` on 2026-04-29 via PR `#30`
- `OIR-33` targeted regression coverage: completed on 2026-04-27
- destructive dialog migration follow-up: merged to `develop` on 2026-04-27
- responsive/accessibility follow-up QA and targeted fixes: merged to `develop` on 2026-04-27
- merged OIR-31 responsive layout work already delivered on the current line

## 8. Security Audit Findings (OIR-34 through OIR-42)

Security audit conducted 2026-04-29. These findings are now the active remaining backlog after `OIR-43` merged to `main`.

Linear issues created: OIR-34 through OIR-42. Findings are ordered by severity.

---

### HIGH — OIR-34: Electron dependency — 17 unfixed security advisories

- **Linear:** [OIR-34](https://linear.app/oiranca/issue/OIR-34)
- **File:** `package.json` / `package-lock.json` (previously on Electron `32.3.3`)
- **Risk:** 17 known unfixed advisories in Electron 32.x. No patch available in 32.x.
- **Impact:** Renderer compromise could escalate to OS-level access.
- **Fix:** Upgrade to a supported non-vulnerable Electron line with runway (`40.9.2` on the current branch) and re-run `npm audit`.
- **Current status:** addressed by upgrading to Electron `40.9.2`; `npm audit` no longer reports Electron advisories.

---

### HIGH — OIR-35: xlsx 0.18.5 — Prototype Pollution + ReDoS

- **Linear:** [OIR-35](https://linear.app/oiranca/issue/OIR-35)
- **File:** `package.json` (xlsx `^0.18.5`), `src/main/services/spreadsheet-import.service.ts`
- **Risk:** `XLSX.readFile` is synchronous on the main thread and the package has known Prototype Pollution and ReDoS CVEs.
- **Impact:** A malformed `.xlsx` file from an untrusted source could hang the process or corrupt the global prototype.
- **Fix:** Replace with `exceljs` or isolate the call inside a `worker_threads` Worker.

---

### MEDIUM — OIR-36: `sandbox: false` on BrowserWindow

- **Linear:** [OIR-36](https://linear.app/oiranca/issue/OIR-36)
- **File:** `src/main/index.ts` (~line 48)
- **Risk:** OS-level process isolation is disabled. If the renderer is compromised, the attacker has unprivileged OS access.
- **Impact:** Renderer XSS → OS process access.
- **Fix:** Test `sandbox: true` with the CJS preload. If not feasible, document accepted risk explicitly.

---

### MEDIUM — OIR-37: CSP `unsafe-inline` + `localhost` in production bundle

- **Linear:** [OIR-37](https://linear.app/oiranca/issue/OIR-37)
- **File:** `index.html` (~line 8)
- **Risk:** A single CSP covers both dev and production. The shipped `dist/index.html` includes `script-src 'unsafe-inline'` and `http://localhost:5173`.
- **Impact:** XSS attack surface remains open in production.
- **Fix:** Split CSP at build time (Vite plugin or post-build script). Strip `unsafe-inline` and localhost entries from the production output.

---

### MEDIUM — OIR-38: E2E path bypass not gated to `!app.isPackaged`

- **Linear:** [OIR-38](https://linear.app/oiranca/issue/OIR-38)
- **File:** `src/main/config/env.ts` (~lines 58–68), `src/main/ipc/contacts.ipc.ts` (~lines 28–29, 61–87)
- **Risk:** `ELECTRON_E2E=1` env var in a production build bypasses all file dialog checks, allowing arbitrary read/write paths.
- **Impact:** Any process on the same machine can read/write arbitrary files via IPC if the env var is set.
- **Fix:** Gate `e2eOpenDialogPaths` / `e2eSaveDialogPaths` on `!app.isPackaged`.

---

### MEDIUM — OIR-39: No write serialization in `AppDataService` (concurrent write race)

- **Linear:** [OIR-39](https://linear.app/oiranca/issue/OIR-39)
- **File:** `src/main/services/app-data.service.ts` (all write methods)
- **Risk:** Concurrent IPC calls race on read→mutate→write, causing silent data loss.
- **Impact:** Two simultaneous contact edits → one silently lost.
- **Fix:** Add a promise-chain write queue so writes are serialized.

---

### LOW — OIR-40: `Math.random()` for record IDs

- **Linear:** [OIR-40](https://linear.app/oiranca/issue/OIR-40)
- **File:** `src/main/services/app-data.service.ts` (~lines 972–973)
- **Risk:** `Math.random()` is not cryptographically random; ID collisions are possible under load.
- **Fix:** Replace with `crypto.randomUUID()` (already available in Node/Electron).

---

### LOW — OIR-41: Full filesystem paths leaked in renderer error messages

- **Linear:** [OIR-41](https://linear.app/oiranca/issue/OIR-41)
- **File:** `src/main/services/app-data.service.ts` (~lines 1015–1059)
- **Risk:** Raw USB mount path (containing OS username and drive letter) is serialized into IPC error messages and shown in UI toasts.
- **Impact:** Leaks system info in shared/kiosk environments.
- **Fix:** Strip raw path context before serializing errors across the IPC boundary.

---

### INFO — OIR-42: No `fsync` before `rename` in `writeJsonFile` (USB data safety)

- **Linear:** [OIR-42](https://linear.app/oiranca/issue/OIR-42)
- **File:** `src/main/utils/fs-json.ts` (~lines 12–34)
- **Risk:** On FAT32 USB drives, abrupt removal can corrupt or zero the file despite a "successful" atomic rename, because the OS write cache may not have flushed.
- **Impact:** Data loss on unexpected USB ejection.
- **Fix:** Call `fileHandle.sync()` before closing the temp file in the atomic write path.
