# Remaining Work Plan

## Document Status

- Language: English
- Scope: active backlog and follow-up work only
- Source consolidation: `MVP_PLAN.md` + `RESPONSIVE_ACCESSIBILITY_PLAN.md`
- Last updated: 2026-05-06 (`OIR-47` merged to `main`)

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
- `OIR-34` Electron upgrade to supported `40.9.2` merged to `main` on 2026-04-29 via PR `#31` and is no longer part of the active remaining backlog
- `OIR-35` spreadsheet import dependency hardening merged to `main` on 2026-04-29 via PR `#32` and is no longer part of the active remaining backlog
- `OIR-36` BrowserWindow sandbox hardening merged to `main` on 2026-04-30 via PR `#40` and is no longer part of the active remaining backlog
- `OIR-37`, `OIR-39`, `OIR-40`, `OIR-41`, and `OIR-42` merged to `main` on 2026-04-30 via PR `#41` and are no longer part of the active remaining backlog
- `OIR-38` E2E packaging gate merged on 2026-04-30 via PR `#37` and is no longer part of the active remaining backlog
- `OIR-44` POSIX directory fsync durability merged to `main` on 2026-05-06 via PR `#42` and is no longer part of the active remaining backlog
- `OIR-47` configurable scheduled auto-backup merged to `main` on 2026-05-06 via PR `#43` and is no longer part of the active remaining backlog

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
- configurable scheduled auto-backups with launch, interval, and edit-count triggers plus retention and failure feedback

Latest known verified baseline:

- `npm run typecheck`
- `npm run build`
- `npx vitest run --exclude '.aia/**'`

Known test note:

- the bootstrap-failure stderr output in `src/renderer/app/App.test.tsx` is expected and not a failing condition
- the current `main` baseline is clean under `npx vitest run --exclude '.aia/**'`

## 3. Priority Order

### Priority 1 — Improve search completeness

This track is complete on the current line.

### Priority 2 — Portable USB deployment track

Complete. `OIR-21` and `OIR-29` both merged to `main` on 2026-04-29.

### Priority 3 — Settings UX

This track is complete on the current line.

### Priority 4 — Reliability follow-up and release hardening

1. `OIR-46` — sign distribution builds to reduce Windows/macOS trust warnings

## 4. Remaining Work Details

### 4.1 Remaining tracked backlog (`OIR-46`)

Goal:

- close the remaining release-quality gaps now that the security remediation queue and POSIX durability follow-up are merged

Definition of done:

- `OIR-46` documents or implements code-signing for shipped builds
- verification is re-run on the resulting release line


## 5. Recommended Execution Sequence

1. `OIR-46`

## 6. Recommended Starting Point

Start with `OIR-46`.

Reason:

- the main-branch verification baseline is now clean, leaving code-signing as the main release-hardening gap

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
- `OIR-34` Electron upgrade to supported `40.9.2`: merged to `main` on 2026-04-29 via PR `#31`
- `OIR-35` spreadsheet import dependency hardening: merged to `main` on 2026-04-29 via PR `#32`
- `OIR-36` BrowserWindow sandbox hardening: merged to `main` on 2026-04-30 via PR `#40`
- `OIR-37` split CSP: merged to `main` on 2026-04-30 via PR `#41`
- `OIR-38` E2E path gate: merged on 2026-04-30 via PR `#37`
- `OIR-39` write serialization: merged to `main` on 2026-04-30 via PR `#41`
- `OIR-40` crypto UUID record IDs: merged to `main` on 2026-04-30 via PR `#41`
- `OIR-41` IPC path sanitization: merged to `main` on 2026-04-30 via PR `#41`
- `OIR-42` temp-file fsync before rename: merged to `main` on 2026-04-30 via PR `#41`
- `OIR-44` POSIX parent-directory fsync durability: merged to `main` on 2026-05-06 via PR `#42`
- `OIR-45` known backup-path test failures: no longer reproducing on the verified current `main` baseline
- `OIR-47` configurable scheduled auto-backup: merged to `main` on 2026-05-06 via PR `#43`
- `OIR-33` targeted regression coverage: completed on 2026-04-27
- destructive dialog migration follow-up: merged to `develop` on 2026-04-27
- responsive/accessibility follow-up QA and targeted fixes: merged to `develop` on 2026-04-27
- merged OIR-31 responsive layout work already delivered on the current line

## 8. Completed Security and Durability Queue

Security audit conducted 2026-04-29. This queue is no longer active backlog.

Linear issues `OIR-34` through `OIR-42` are complete, and the POSIX durability follow-up `OIR-44` is also merged.

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
- **File:** `package.json` (previously `xlsx` `^0.18.5`), `src/main/services/spreadsheet-import.service.ts`
- **Risk:** `XLSX.readFile` is synchronous on the main thread and the package has known Prototype Pollution and ReDoS CVEs.
- **Impact:** A malformed `.xlsx` file from an untrusted source could hang the process or corrupt the global prototype.
- **Fix:** replace `xlsx` with `xlsx-republish` and parse untrusted spreadsheets inside a bounded worker
- **Current status:** addressed and merged to `main` via PR `#32`; production audit no longer reports high spreadsheet import advisories

---

### MEDIUM — OIR-36: `sandbox: false` on BrowserWindow

- **Linear:** [OIR-36](https://linear.app/oiranca/issue/OIR-36)
- **File:** `src/main/index.ts` (~line 48)
- **Risk:** OS-level process isolation is disabled. If the renderer is compromised, the attacker has unprivileged OS access.
- **Impact:** Renderer XSS → OS process access.
- **Fix:** Test `sandbox: true` with the CJS preload. If not feasible, document accepted risk explicitly.
- **Current status:** addressed and merged to `main` via PR `#40`.

---

### MEDIUM — OIR-37: CSP `unsafe-inline` + `localhost` in production bundle

- **Linear:** [OIR-37](https://linear.app/oiranca/issue/OIR-37)
- **File:** `index.html` (~line 8)
- **Risk:** A single CSP covers both dev and production. The shipped `dist/index.html` includes `script-src 'unsafe-inline'` and `http://localhost:5173`.
- **Impact:** XSS attack surface remains open in production.
- **Fix:** Split CSP at build time (Vite plugin or post-build script). Strip `unsafe-inline` and localhost entries from the production output.
- **Current status:** addressed and merged to `main` via PR `#41`.

---

### MEDIUM — OIR-38: E2E path bypass not gated to `!app.isPackaged`

- **Linear:** [OIR-38](https://linear.app/oiranca/issue/OIR-38)
- **File:** `src/main/config/env.ts` (~lines 58–68), `src/main/ipc/contacts.ipc.ts` (~lines 28–29, 61–87)
- **Risk:** `ELECTRON_E2E=1` env var in a production build bypasses all file dialog checks, allowing arbitrary read/write paths.
- **Impact:** Any process on the same machine can read/write arbitrary files via IPC if the env var is set.
- **Fix:** Gate `e2eOpenDialogPaths` / `e2eSaveDialogPaths` on `!app.isPackaged`.
- **Current status:** addressed and merged on 2026-04-30 via PR `#37`.

---

### MEDIUM — OIR-39: No write serialization in `AppDataService` (concurrent write race)

- **Linear:** [OIR-39](https://linear.app/oiranca/issue/OIR-39)
- **File:** `src/main/services/app-data.service.ts` (all write methods)
- **Risk:** Concurrent IPC calls race on read→mutate→write, causing silent data loss.
- **Impact:** Two simultaneous contact edits → one silently lost.
- **Fix:** Add a promise-chain write queue so writes are serialized.
- **Current status:** addressed and merged to `main` via PR `#41`.

---

### LOW — OIR-40: `Math.random()` for record IDs

- **Linear:** [OIR-40](https://linear.app/oiranca/issue/OIR-40)
- **File:** `src/main/services/app-data.service.ts` (~lines 972–973)
- **Risk:** `Math.random()` is not cryptographically random; ID collisions are possible under load.
- **Fix:** Replace with `crypto.randomUUID()` (already available in Node/Electron).
- **Current status:** addressed and merged to `main` via PR `#41`.

---

### LOW — OIR-41: Full filesystem paths leaked in renderer error messages

- **Linear:** [OIR-41](https://linear.app/oiranca/issue/OIR-41)
- **File:** `src/main/services/app-data.service.ts` (~lines 1015–1059)
- **Risk:** Raw USB mount path (containing OS username and drive letter) is serialized into IPC error messages and shown in UI toasts.
- **Impact:** Leaks system info in shared/kiosk environments.
- **Fix:** Strip raw path context before serializing errors across the IPC boundary.
- **Current status:** addressed and merged to `main` via PR `#41`.

---

### INFO — OIR-42: No `fsync` before `rename` in `writeJsonFile` (USB data safety)

- **Linear:** [OIR-42](https://linear.app/oiranca/issue/OIR-42)
- **File:** `src/main/utils/fs-json.ts` (~lines 12–34)
- **Risk:** On FAT32 USB drives, abrupt removal can corrupt or zero the file despite a "successful" atomic rename, because the OS write cache may not have flushed.
- **Impact:** Data loss on unexpected USB ejection.
- **Fix:** Call `fileHandle.sync()` before closing the temp file in the atomic write path.
- **Current status:** addressed and merged to `main` via PR `#41`.

## 9. Post-Audit Durability Follow-up

### INFO — OIR-44: fsync parent directory after atomic rename on POSIX

- **Linear:** [OIR-44](https://linear.app/oiranca/issue/OIR-44)
- **File:** `src/main/utils/fs-json.ts`
- **Risk:** A crash after `rename(2)` but before the parent directory metadata is flushed can lose the renamed file entry on POSIX filesystems.
- **Impact:** Successful writes can disappear after sudden power loss.
- **Fix:** `fsync` the parent directory after the atomic rename on non-Windows platforms.
- **Current status:** addressed and merged to `main` on 2026-05-06 via PR `#42`.
