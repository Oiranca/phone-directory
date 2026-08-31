# Environment Variable Registry

This file is the single source of truth for every environment variable referenced in the
codebase. A Vitest consistency test (`src/main/config/env-vars.consistency.test.ts`) asserts
that this registry and the actual source references stay in sync: the test fails when a
variable is referenced in code but undocumented here, or documented here but no longer
referenced anywhere.

Format of entries: `ENV_VAR_NAME` — one line per variable, one per `##` block so the
consistency test can parse names reliably with a simple regex.

---

## User-Configurable

Variables a developer or operator may set in `.env` / `.env.local` to control runtime
behaviour during local development.

### ELECTRON_OPEN_DEVTOOLS

Opens Chromium DevTools automatically when Electron starts. Defaults to `1` (enabled) in the
dev launcher (`scripts/run-electron-dev.mjs`) unless overridden.

- **Type:** boolean flag — truthy values: `1`, `true`
- **Default:** `1` in dev (set by launcher); unset in production
- **Example:** `ELECTRON_OPEN_DEVTOOLS=0`

---

## Internal Runtime

Variables consumed at runtime by the application itself. They are normally set by the build
toolchain, the OS, or integration plumbing — not by end users.

### ELECTRON_RENDERER_URL

URL of the Vite dev-server to load in the renderer during E2E test runs. Only honoured when
`ELECTRON_E2E=1` and the value is a loopback URL (`localhost` / `127.0.0.1` / `::1`).

- **Type:** URL string
- **Default:** unset (production build loads `file://` assets)
- **Example:** `ELECTRON_RENDERER_URL=http://localhost:5173`

### ELECTRON_USER_DATA_PATH

Overrides Electron's `userData` directory. Only honoured when `ELECTRON_E2E=1`, so it cannot
be used to redirect user data in a production build.

- **Type:** absolute path string
- **Default:** unset (Electron resolves the platform default)
- **Example:** `ELECTRON_USER_DATA_PATH=/path/to/isolated-profile`

### VITEST

Set automatically to `"true"` by Vitest when running tests. Used internally to skip
fs-heavy code paths that are not meaningful inside a test runner.

- **Type:** string (`"true"` when set)
- **Set by:** Vitest test runner — do not set manually
- **Example:** *(set automatically)*

### APPIMAGE

Set by the AppImage runtime on Linux to the path of the `.AppImage` file. The main process
uses its parent directory as the USB root for `portable-data`.

- **Type:** absolute path string (or unset on non-AppImage platforms)
- **Set by:** AppImage runtime — do not set manually
- **Example:** *(set automatically)*

### CI

Set to a non-empty string by most CI providers (GitHub Actions, CircleCI, etc.). Used by
`playwright.config.ts` to switch to the `dot` reporter and disable server reuse.

- **Type:** string (any non-empty value is truthy; conventionally `true`)
- **Set by:** CI provider — do not set manually in local `.env`
- **Example:** *(set automatically by CI)*

---

## Release / Portable

Packaged builds are always portable. They derive `<USB_ROOT>/portable-data` from the directly
opened platform executable; no environment variable activates portable mode.

## E2E-Only

Variables consumed exclusively by the Playwright E2E test harness. They are injected by the
test runner and must never be set in production or developer `.env` files.

### PLAYWRIGHT_BACKGROUND

Selects the JSON reporter used by detached local Playwright runs. Background automation sets
this flag so results remain available in `test-results/e2e-background.json` without requiring
an interactive terminal. It does not enable headed mode; Playwright remains headless by default.

- **Type:** exact flag — `1` enables the background JSON reporter; any other value is ignored
- **Default:** unset (the local list reporter is used; CI uses the dot reporter)
- **Set by:** background E2E automation — do not set in `.env`
- **Example:** `PLAYWRIGHT_BACKGROUND=1`

### USB_IMPORT_FIXTURE_ROOT

Opt-in path to an existing USB `portable-data/data` directory for the Vitest JSON import
integration test. When unset, that hardware-dependent test is skipped; normal test runs do
not require a mounted USB.

- **Type:** absolute directory path
- **Default:** unset
- **Example:** `USB_IMPORT_FIXTURE_ROOT=/Volumes/Agenda/portable-data/data`

### ELECTRON_E2E

Enables E2E mode inside the Electron main process. When set, the renderer URL and user-data
path overrides are honoured, and file-dialog handlers are intercepted.

- **Type:** boolean flag — truthy values: `1`, `true`
- **Default:** unset
- **Set by:** Playwright global setup — do not set in `.env`
- **Example:** *(injected by test harness)*

### E2E_OPEN_DIALOG_PATHS

JSON-encoded array of absolute paths returned by intercepted open-file dialog calls during
E2E tests.

- **Type:** JSON string — e.g. `["/path/to/fixture.csv"]`
- **Default:** unset
- **Set by:** Playwright global setup — do not set in `.env`
- **Example:** *(injected by test harness)*

### E2E_SAVE_DIALOG_PATHS

JSON-encoded array of absolute paths returned by intercepted save-file dialog calls during
E2E tests.

- **Type:** JSON string — e.g. `["/path/to/output.csv"]`
- **Default:** unset
- **Set by:** Playwright global setup — do not set in `.env`
- **Example:** *(injected by test harness)*
