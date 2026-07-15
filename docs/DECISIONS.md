# Architectural Decisions

This document records architectural decisions and their triggers for the phone-directory
project. It is intended for future engineers (human or agent) evaluating whether a
significant architectural change — such as a storage engine migration or multi-user
support — is warranted, before any implementation work begins.

Each entry records: the decision itself, the context/signals that led to it, the concrete
condition that should trigger revisiting it, and what it means practically for anyone
picking up related work.

---

## Decision: SQLite migration trigger (ARQ-9)

**Status:** Documented, not yet triggered.

### Decision

Do **not** migrate `contacts.json` / `audit-log.json` from flat JSON files to SQLite
preemptively. The current JSON-file-per-dataset approach, written via `writeJsonFile`
(dual-fsync atomic writes) and serialized through the in-process `enqueueWrite` queue in
`app-data.service.ts`, is deliberately kept simple. A non-technical administrator on a
shared workstation can open `contacts.json` in a text editor and understand or manually
back up the data — that inspectability is a real advantage for this deployment model and
should not be traded away without a concrete reason.

If and when the trigger condition below is met, migrate to SQLite via
[`better-sqlite3`](https://github.com/WiseLibs/better-sqlite3) — it is embeddable
in-process, requires no server, and fits the app's local-USB-install deployment model
without adding new runtime infrastructure.

### Context / Signals

Three independent signals in the codebase converge on the same rough order of magnitude,
which is what makes this worth documenting now rather than waiting for a single ambiguous
complaint:

1. **Full-file-rewrite-on-every-edit pattern (ARQ-6).** `app-data.service.ts` performs a
   full read → parse → Zod-validate → rebuild-array → full rewrite (JSON.stringify of the
   entire dataset + dual fsync) on every single `createRecord`/`updateRecord` call. The
   cost scales with the **total** dataset size, not the size of the single changed record.
   At today's realistic scale (low hundreds to low thousands of contacts) this is
   sub-100ms and invisible to the user — but it is write amplification that gets worse
   linearly as the contact count grows.

2. **Audit log rotation (previously unbounded, now fixed by OIR-206).** The audit log had
   no rotation and imposed a similar unbounded, ever-growing tax on every edit. This has
   since been fixed (OIR-206, shipped in PR #134): audit-log rotation is now entry-count
   based, rotating at 5,000 entries. This closes off what was previously the most acute
   concrete "this will eventually cause a UX problem" finding in the persistence layer.
   It remains relevant to this decision only as a secondary trigger (see below) in case
   rotation policy ever changes or is disabled.

3. **Duplicate-detection service's own documented ceiling.** `duplicate-detection.service.ts`
   already contains an explicit code comment flagging its O(n²) comparison approach
   (with early-exit optimization, cooperative chunking, and a 30s abort timeout already
   implemented) as scaling acceptably only up to roughly **~10k records**, with
   "add name-prefix indexing" already noted as the next step in the code itself.

None of these three signals alone is a hard requirement to migrate today. Together, they
independently point at the same rough scale (~5,000-10,000 active contacts) as the point
where the current architecture's simplicity stops being "free."

### Trigger condition

Treat either of the following as the concrete signal to start planning the SQLite
migration as its own milestone:

- The installation reaches roughly **5,000-10,000 active contacts**, OR
- The audit log ever needs to span **multiple years of unrotated history** — this should
  not happen now that OIR-206's entry-count-based rotation (5,000 entries) is in place,
  but is documented here as a secondary trigger in case rotation policy is ever changed,
  disabled, or found insufficient in practice.

Below this threshold: do not migrate. The added complexity (new dependency, schema
design, migration tooling, loss of plain-text inspectability) is not justified by any
current pain point.

### What this means practically

If/when the trigger condition is met, budget the migration as **its own dedicated
milestone — several weeks of dedicated engineering work** — and never bundle it into
unrelated feature work. The scope includes:

1. Designing a normalized schema (contacts / phones / emails / social handles / tags as
   proper tables, rather than one JSON blob per contact).
2. Rewriting the read/write paths in `app-data.service.ts`. The IPC surface and the
   boundary Zod schemas in `src/shared/schemas/` can likely stay largely unchanged, since
   they are already transport/storage-agnostic.
3. A one-time JSON-to-SQLite migration script to import existing `contacts.json` /
   `audit-log.json` data.
4. Rewriting `duplicate-detection.service.ts`'s O(n²) in-memory scan to use SQL-side
   indexing instead — this is where SQLite migration pays off the most relative to the
   current approach.
5. Re-validating the audit-log quarantine/corruption-recovery logic
   (`AuditLogIntegrityError` and related recovery paths), which is currently
   JSON-specific, against the new storage engine.

---

## Decision: Multi-user/sync is a rework, not an incremental evolution (ARQ-5)

**Status:** Documented; no multi-user work is planned or in progress.

### Decision

If the current single-user, local-USB-install-on-shared-workstation deployment model is
ever reconsidered in favor of multi-user or networked/synced usage, that work must be
budgeted and scoped as **its own dedicated initiative from day one** — not attempted as an
incremental patch on top of the current architecture.

Explicitly: do **not** attempt a superficial fix such as adding a lockfile on a shared
network directory as a stand-in for real multi-user support. A lockfile does not solve
conflict resolution, partial-write interleaving, or stale-read problems — it would create
false confidence in a safety guarantee the system does not actually provide.

### Context / Signals

- **Write serialization is process-local only.** The `enqueueWrite` write-queue in
  `app-data.service.ts` only serializes writes within a single OS process. If two separate
  installs of this app were ever pointed at the same shared network directory, they would
  write to `contacts.json` / `audit-log.json` completely unprotected against each other —
  risking silent data loss or corruption, with no detection mechanism.
- **No optimistic concurrency versioning.** There is no version/revision field on records
  to detect or resolve concurrent edits.
- **No real user identity/session model.** The `editorName` field recorded in audit
  entries is free-text local input, not an authenticated identity or session principal.
- **No network/sync layer at all.** The current architecture has no transport beyond
  local Electron IPC between the main and renderer processes.

### What would be reused vs. rebuilt

If multi-user/sync work is ever pursued, note what already fits and what does not:

- **Would likely survive as-is:** the shared Zod schemas (`src/shared/schemas/`) and the
  `HospitalDirectoryApi` IPC contract shape — both are already transport-agnostic by
  design, so they could plausibly be served over an HTTP/WebSocket API without a full
  rewrite of the validation logic.
- **Would NOT survive as-is:** the persistence layer, which would need to become a real
  transactional store (at minimum SQLite with WAL + row versioning, or a client-server
  database — this is directly tied to the SQLite migration decision above), and the
  current single-process topology, which would need a shared-access broker or server
  component.

### Trigger condition

Only revisit this if the product's deployment scope is explicitly reconsidered away from
"single local USB install on a shared workstation" toward genuine concurrent multi-user
access. There is no partial/incremental version of this that is safe to ship — see the
explicit anti-pattern warning below.

### What this means practically

- Do not add a lockfile, "last write wins" heuristic, or any similar shortcut on the
  shared data directory in response to a multi-user request — this creates the appearance
  of safety without providing it, and would likely make failures harder to diagnose than
  having no protection at all.
- If this initiative is ever greenlit, scope it from the start to include: a real
  transactional persistence layer (see the SQLite decision above), an authenticated
  user/session identity model (replacing the free-text `editorName`), a defined conflict
  resolution strategy for concurrent edits (not just import-time merge policies, which
  today only cover the CSV import flow), and a network/sync transport layer.
