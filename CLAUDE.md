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
