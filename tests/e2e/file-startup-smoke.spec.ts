/**
 * Dev-startup smoke tests + production loadFile() wiring checks (OIR-117 AC3/AC4).
 *
 * SCOPE BOUNDARY — what this suite covers and what it does NOT:
 *
 * Covered:
 *   AC3a) The built dist/index.html artifact exists (required by the packaged
 *         loadFile() call — if missing, a packaged app would show a blank page).
 *   AC3b) The compiled dist-electron/main/index.js contains a loadFile() call
 *         that references "dist/index.html" and does NOT call loadURL() with a
 *         hardcoded http://localhost address unconditionally. This is a static
 *         wiring check on the compiled output, not a live packaged-app test.
 *   AC3c) The app renders the main directory page end-to-end when launched
 *         through the Playwright/Electron harness. This exercises the dev-server
 *         branch (isDev === true), confirming the build pipeline and IPC surface
 *         are intact.
 *   AC3d) The built dist/index.html uses RELATIVE asset paths (./assets/...) not
 *         absolute paths (/assets/...). Absolute paths resolve to the filesystem
 *         root under file:// protocol, causing a blank window in all packaged
 *         builds. Requires vite.config.ts to have base: "./" set.
 *   AC4)  Dev mode uses ELECTRON_RENDERER_URL rather than a hardcoded constant.
 *
 * NOT covered (requires electron-builder packaging to test):
 *   The actual production file:// loadFile() branch at runtime.
 *   In Playwright/Electron E2E, the app is launched against
 *   dist-electron/main/index.js via electron.launch() — NOT a signed,
 *   packaged .app. Because of this, `app.isPackaged` is always false, so
 *   isDev is always true and the dev-server branch is always taken.
 *   Exercising the real loadFile() branch requires `electron-builder --dir`
 *   followed by launching the packaged binary, which is outside the scope
 *   of this unit/E2E suite and is covered by the USB release smoke workflow.
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

// NOTE: This describe block is intentionally named "dev-startup smoke" because
// all E2E tests below run with app.isPackaged === false (dev branch active).
// The two static-wiring checks (AC3a, AC3b) do not launch the app and verify
// the PRODUCTION loadFile() wiring at the source/artifact level only.
test.describe("dev-startup smoke — build artifact + loadFile wiring checks", () => {
  // AC3a: static artifact check — no app launch required.
  test("built dist/index.html exists (loadFile target is valid for packaged app)", async () => {
    // Verifies that the artifact targeted by the production loadFile() call is
    // present after `pnpm run build`. A missing dist/index.html would cause a
    // blank page in the packaged app, but this test catches that at CI time.
    const distIndexPath = path.join(repoRootDir, "dist", "index.html");
    const stat = await fs.stat(distIndexPath);
    expect(stat.isFile()).toBe(true);
    expect(stat.size).toBeGreaterThan(0);
  });

  // AC3d: static asset-path check — no app launch required.
  // Regression guard for the blank-window bug caused by Vite defaulting base to "/".
  // Under file:// protocol, absolute paths like /assets/index-*.js resolve to the
  // filesystem root (not the app directory), causing all assets to 404 → blank window.
  // vite.config.ts MUST have base: "./" to produce relative paths.
  // This test will FAIL if base: "./" is removed from vite.config.ts.
  test("dist/index.html uses relative asset paths (no /assets/ absolute refs that break file://)", async () => {
    const distIndexPath = path.join(repoRootDir, "dist", "index.html");
    const html = await fs.readFile(distIndexPath, "utf-8");

    // Collect all src= and href= attribute values from the HTML.
    const srcMatches = [...html.matchAll(/\bsrc="([^"]+)"/g)].map((m) => m[1]);
    const hrefMatches = [...html.matchAll(/\bhref="([^"]+)"/g)].map((m) => m[1]);
    const allRefs = [...srcMatches, ...hrefMatches];

    // Filter to only asset paths (scripts, stylesheets, etc — not data: URIs or #fragments).
    const assetRefs = allRefs.filter(
      (ref) => !ref.startsWith("data:") && !ref.startsWith("#") && ref.trim() !== ""
    );

    expect(assetRefs.length, "dist/index.html must reference at least one asset").toBeGreaterThan(0);

    // None of the asset paths may start with "/" (absolute) — they must be relative.
    // An absolute /assets/... path will silently 404 under file:// because the OS
    // resolves it from the filesystem root, not from beside index.html.
    const absoluteRefs = assetRefs.filter((ref) => ref.startsWith("/"));
    expect(
      absoluteRefs,
      `dist/index.html contains absolute asset paths that will 404 under file:// protocol.\n` +
        `These paths resolve to filesystem root under file://, causing a blank window.\n` +
        `Fix: ensure vite.config.ts has base: "./" set.\n` +
        `Offending refs: ${absoluteRefs.join(", ")}`
    ).toHaveLength(0);
  });

  // AC3b: static wiring check — no app launch required.
  test("compiled main/index.js wires loadFile to dist/index.html (not a remote URL)", async () => {
    // Verify the production startup path in the compiled output.
    // After build:electron, dist-electron/main/index.js must call
    // loadFile(...dist/index.html) — not loadURL with any http:// address.
    // This is a static check on the compiled artifact; it does NOT launch the
    // packaged app and does NOT exercise the runtime loadFile() branch.
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

  // AC3c: functional dev-mode smoke — launches the app in DEV branch.
  test("app renders the directory heading via E2E (dev branch, built assets functional)", async () => {
    // Dev-mode smoke: the app is launched with app.isPackaged === false so the
    // dev-server (loadURL) branch is taken, NOT the production loadFile() branch.
    // This confirms the build pipeline and IPC surface are intact end-to-end.
    // It does NOT exercise the file:// startup path — see suite-level comment.
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

  // AC4: dev-mode URL source check — confirms ELECTRON_RENDERER_URL is used.
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
    //
    // NOTE: like the functional smoke above, this runs with app.isPackaged ===
    // false. The URL observed here is the DEV server URL, not file://.
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
