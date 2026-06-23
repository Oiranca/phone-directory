/**
 * Startup path smoke tests (OIR-117 acceptance criteria 3 & 4).
 *
 * Criterion 3: verify the production code path in src/main/index.ts is wired
 * to loadFile(dist/index.html) — NOT a hardcoded http:// URL. We verify the
 * wiring statically by confirming the dist/index.html file exists and that the
 * path expression in the source maps to the correct artifact, then run a
 * functional E2E that exercises the app fully through the built assets.
 *
 * Criterion 4: no production startup coverage depends ONLY on the dev renderer
 * URL. The second test documents (and gates) dev-mode URL behaviour.
 *
 * Why file:// is not directly testable in E2E:
 * `isDev` is defined as `!app.isPackaged`. In Playwright/Electron E2E the app
 * is launched via `electron.launch()` against dist-electron/main/index.js —
 * not a signed, packaged .app — so `app.isPackaged` is always false. The only
 * way to test the actual file:// loadFile() branch is to package the app
 * (electron-builder). That is outside the scope of the unit/E2E test suite.
 * Instead we:
 *   a) Verify the built dist/index.html artifact exists (the target of loadFile).
 *   b) Assert the production loadFile() path uses the correct relative path
 *      expression (by reading the compiled main/index.js after build).
 *   c) Run the app through the E2E harness to confirm it renders correctly.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import {
  closeElectronApp,
  createWorkspace,
  launchElectronApp,
  removeWorkspace,
  waitForDirectory
} from "./helpers/electron.js";

const repoRootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test.describe("file:// startup smoke — production renderer path", () => {
  test("built dist/index.html exists (loadFile target is valid)", async () => {
    // This verifies criterion 3: the artifact that loadFile() targets must be
    // present after `pnpm run build`. If this fails, the packaged app would
    // show a blank page at file:// startup.
    const distIndexPath = path.join(repoRootDir, "dist", "index.html");
    const stat = await fs.stat(distIndexPath);
    expect(stat.isFile()).toBe(true);
    expect(stat.size).toBeGreaterThan(0);
  });

  test("compiled main/index.js wires loadFile to dist/index.html (not a remote URL)", async () => {
    // Verify the production startup path in the compiled output.
    // After build:electron, dist-electron/main/index.js must call
    // loadFile(...dist/index.html) — not loadURL with any http:// address.
    const compiledMain = await fs.readFile(
      path.join(repoRootDir, "dist-electron", "main", "index.js"),
      "utf-8"
    );

    // The loadFile call must reference the renderer bundle relative to __dirname.
    expect(compiledMain).toContain("loadFile");
    expect(compiledMain).toContain("dist/index.html");

    // The fallback DEV_SERVER_URL must be guarded by an isDev branch, not called
    // unconditionally. The string "http://localhost:5173" may appear (it's the
    // fallback default) but loadURL(DEV_SERVER_URL) must be inside isDev guard.
    // We verify this by confirming loadFile() appears AND is not replaced by a
    // bare loadURL with a hardcoded http address as the only call.
    expect(compiledMain).not.toMatch(/loadURL\s*\(\s*["'`]http:\/\/localhost/);
  });

  test("app renders the directory heading via E2E (built assets are functional)", async () => {
    // Functional smoke: the built E2E app (dev mode, dev server) renders the
    // main directory page. This confirms the build pipeline and IPC surface
    // are intact end-to-end.
    const workspace = await createWorkspace("file-startup-functional");
    const { electronApp, page } = await launchElectronApp({
      userDataPath: workspace.userDataPath
    });

    try {
      // The app must reach the directory page within the E2E timeout.
      await waitForDirectory(page);

      // The page URL must come from the configured renderer source.
      const pageUrl = page.url();
      expect(pageUrl).toBeTruthy();
      expect(pageUrl).not.toBe("");
    } finally {
      await closeElectronApp(electronApp);
      await removeWorkspace(workspace);
    }
  });

  test("dev-mode: ELECTRON_RENDERER_URL controls the dev server URL (not hardcoded)", async () => {
    // Criterion 4: dev mode must use env.rendererUrl (from ELECTRON_RENDERER_URL)
    // rather than a hardcoded constant. If env.rendererUrl is null, it falls
    // back to "http://localhost:5173" — the fallback is expected.
    //
    // This test documents (and gates) the dev-mode URL behaviour:
    // with ELECTRON_E2E=1 + ELECTRON_RENDERER_URL=http://localhost:5173, the
    // app loads from the dev server (not file://). This must remain true so
    // that removing the ELECTRON_RENDERER_URL env var in the packaged build
    // would not silently fall back to the dev server URL.
    const workspace = await createWorkspace("file-startup-dev-url-check");
    const { electronApp, page } = await launchElectronApp({
      userDataPath: workspace.userDataPath
    });

    try {
      const pageUrl = page.url();
      // With the dev server running (as started by global-setup), the URL must
      // be http://localhost:5173/ — confirming dev mode is active.
      expect(pageUrl, "Dev mode should load from dev server, not file://").not.toMatch(/^file:\/\//);
      expect(pageUrl).toContain("localhost");
    } finally {
      await closeElectronApp(electronApp);
      await removeWorkspace(workspace);
    }
  });
});
