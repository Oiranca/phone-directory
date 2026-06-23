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

Set by the AppImage launcher on Linux to the path of the `.AppImage` file. Read by the
main process to expose the launcher path for self-update or portable-mode detection.

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

Variables used by the portable USB build to locate data outside the application bundle.

### ELECTRON_PORTABLE

Enables portable mode. When set to a truthy value the application stores its data relative to
the executable rather than in the OS user-data directory.

- **Type:** boolean flag — truthy values: `1`, `true`
- **Default:** unset (standard install mode)
- **Example:** `ELECTRON_PORTABLE=1`

### ELECTRON_PORTABLE_ROOT_PATH

Absolute path to the portable root directory. Only meaningful when `ELECTRON_PORTABLE=1`. The
path is trimmed; an empty or whitespace-only value is treated as unset.

- **Type:** absolute path string
- **Default:** unset
- **Example:** `ELECTRON_PORTABLE_ROOT_PATH=/path/to/portable-root`

---

## E2E-Only

Variables consumed exclusively by the Playwright E2E test harness. They are injected by the
test runner and must never be set in production or developer `.env` files.

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
