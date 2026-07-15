# IPC Contract (preload ↔ handlers ↔ shared)

MANT-17: a one-page map of how the renderer talks to the Electron main
process in this app. Not exhaustive — see the source files listed under each
box for the full surface.

## Diagram

```
┌─────────────────────────────┐        ┌──────────────────────────────┐
│  src/renderer/**             │        │  src/main/ipc/*.ipc.ts        │
│  (React pages/components)    │        │  registerContactsIpc()        │
│                               │        │  registerSettingsIpc()        │
│  calls                       │        │  registerBuscasIpc()          │
│  window.hospitalDirectory.*  │        │                                │
│  e.g.                        │        │  ipcMain.handle(channel, fn)  │
│  createRecord(record)        │        │  — validates input, calls a   │
│  listBuscas()                │        │    src/main/services/*        │
│  onAutoBackupFailure(cb)     │        │    service, returns a         │
└──────────────┬────────────────┘        │    Zod-validated result       │
               │                          └───────────────┬──────────────┘
               │ contextBridge                             │ ipcMain.handle /
               │ ("hospitalDirectory")                      │ webContents.send
               ▼                                           ▲
┌─────────────────────────────────────────────────────────┴──────────────┐
│  src/preload/index.cts                                                  │
│                                                                          │
│  - inlines the channel-name constants (CONTACTS_CHANNELS,               │
│    SETTINGS_CHANNELS, BUSCAS_CHANNELS, PUSH_CHANNELS) — cannot import   │
│    shared/ipc/channels.ts at runtime because Electron's sandboxed       │
│    preload can only require() built-ins, not relative ESM paths         │
│    (see the OIR-103 comment at the top of index.cts)                    │
│  - `satisfies typeof _CanonicalXxx` (type-only import from              │
│    shared/ipc/channels.ts) makes any channel rename/removal a           │
│    compile-time error here, so the inlined copy can't silently drift    │
│  - builds `api: HospitalDirectoryApi` — one method per channel, each    │
│    calling ipcRenderer.invoke(channel, ...args)                         │
│  - contextBridge.exposeInMainWorld("hospitalDirectory", api) is the     │
│    ONLY surface the renderer can call into main through                 │
└───────────────────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────────────────┐
│  src/shared/ipc/                                                        │
│                                                                          │
│  channels.ts  — canonical channel-name string constants (single         │
│                 source of truth; preload/index.cts's inlined copies     │
│                 are checked against these via `satisfies` at compile    │
│                 time — see above)                                       │
│  api.ts       — HospitalDirectoryApi interface: the method signatures   │
│                 (params/return types) both preload's `api` object and   │
│                 renderer call sites are typed against                   │
│                                                                          │
│  Also used by src/main/ipc/*.ipc.ts (to register handlers under the     │
│  same channel names) and by src/shared/types + src/shared/schemas       │
│  (Zod schemas / types passed as IPC payloads on both sides).            │
└───────────────────────────────────────────────────────────────────────┘
```

## Request/response flow (example: creating a contact)

1. `src/renderer/hooks/useContactForm.ts` calls
   `window.hospitalDirectory.createRecord(record)`.
2. That's `api.createRecord` in `src/preload/index.cts`, which calls
   `ipcRenderer.invoke(CONTACTS_CHANNELS.createRecord, record)` — channel
   string `"contacts:create-record"`.
3. `src/main/ipc/contacts.ipc.ts`'s `registerContactsIpc()` has
   `ipcMain.handle(CHANNELS.createRecord, ...)` registered against the same
   channel string (imported from the canonical `shared/ipc/channels.ts`,
   unlike preload's inlined copy).
4. The handler validates the payload, delegates to
   `src/main/services/app-data.service.ts`, and returns a result typed
   against `src/shared/types/contact.ts` / validated with
   `src/shared/schemas/contact.ts`.
5. The Promise resolves back through `ipcRenderer.invoke` to the original
   renderer call site.

## Push (main → renderer) channels

Not every channel is a renderer-initiated request/response. `PUSH_CHANNELS`
(currently just `autoBackupFailed`, `"app:auto-backup-failed"`) is main
proactively notifying the renderer — main calls
`webContents.send(channel, payload)`, and the renderer subscribes via
`window.hospitalDirectory.onAutoBackupFailure(callback)`, which wraps
`ipcRenderer.on(...)` in `src/preload/index.cts` and returns an unsubscribe
function.

## Where the channel/method surface is enforced

- `src/preload/index.cts` — `satisfies typeof _CanonicalXxx` type-only
  imports from `shared/ipc/channels.ts` catch channel renames at compile
  time.
- `src/preload/api.cts` + `src/preload/index.test.ts` — a sister module used
  for unit testing preload logic (since `index.cts` itself is hard to
  exercise directly under Electron's sandbox constraints); a source-guard
  test verifies the two stay in sync.
- `src/shared/ipc/api.contract.test.ts` — pins `HospitalDirectoryApi`'s
  shape.
- `src/main/ipc/*.ipc.test.ts` — one test file per `*.ipc.ts` handler
  registration module.
