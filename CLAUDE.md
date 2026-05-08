# phone-directory — Project Instructions

## Linear Issue Lifecycle Rule

**ALWAYS move a Linear issue to "In Progress" when work begins.**

As soon as work starts on any Linear issue — whether creating a branch, making edits, or delegating to an agent — immediately move that issue to **In Progress** in Linear.

**Why:** Issues left in Todo while actively being worked create false sprint visibility and confuse prioritization.

**How to apply:**
- Before delegating to any agent, use the Linear MCP tool (`mcp__linear-server__save_issue`) to set the issue status to "In Progress".
- This must happen before any implementation begins — not after the PR is opened.
- An issue with an open PR must NEVER sit in Todo.
- The Team Lead is responsible for this transition at Stage 1 of the pipeline.

Example:
```
mcp__linear-server__save_issue({ id: "<issue-id>", stateId: "<in-progress-state-id>" })
```

Use `mcp__linear-server__list_issue_statuses` with the team ID to resolve the "In Progress" state ID if unknown.

---

## Stack

Electron + React 18 + TypeScript + Vite + Vitest. IPC contracts validated with Zod. Atomic writes via `writeJsonFile` (dual-fsync). Data stored in user's app data directory.

## Key Paths

- `src/main/` — Electron main process (services, IPC handlers, utils)
- `src/renderer/` — React renderer (pages, components)
- `src/preload/index.cts` — context bridge (IPC surface exposed to renderer)
- `src/shared/` — shared types and Zod schemas
- `data/` — runtime data files (contacts.json, audit-log.json, backups)

## Current Handoff

- Branch baseline: `main`
- Product deployment model: local USB install on a shared workstation
- Search is considered good enough for now; do not reopen advanced search/filter work unless real usage proves a gap
- Audit logging remains implemented in code, but the audit UI entrypoints are hidden because there is no multi-user workflow right now

### Active Linear Focus

- `OIR-49` (`In Progress`) — safe bulk import workflow
  - next execution slices: `OIR-57`, then `OIR-58`
- `OIR-52` (`In Progress`) — local USB release workflow
  - next execution slices: `OIR-61`, then `OIR-62`

### Next Queue

- `OIR-54` — keyboard-first workstation flow
  - children: `OIR-63`, `OIR-64`
- `OIR-50` — duplicate cleanup
  - children: `OIR-59`, `OIR-60`
- `OIR-53` — local release-time dependency/security checks

### Canceled By Scope Review On 2026-05-08

- `OIR-51` advanced search syntax/history
- `OIR-55` advanced filter builder/presets
- `OIR-56` LDIF/vCard export
