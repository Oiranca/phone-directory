/**
 * Pure security policy helpers for the main-process window bootstrap.
 *
 * Extracted from src/main/index.ts so they can be unit-tested in isolation
 * without importing Electron or triggering app lifecycle side-effects.
 * index.ts imports and uses these functions directly — production and tests
 * share one source of truth.
 */

export const PROD_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self';";

/**
 * Returns the Content-Security-Policy string to apply via onHeadersReceived.
 *
 * In dev mode the CSP is relaxed to allow Vite's HMR script and WebSocket
 * connections from the dev server origin. In production the strict PROD_CSP
 * is used with no external origins permitted.
 */
export const buildContentSecurityPolicy = ({
  isDev,
  devServerUrl
}: {
  isDev: boolean;
  devServerUrl: string;
}): string => {
  if (!isDev) {
    return PROD_CSP;
  }

  const devOrigin = new URL(devServerUrl).origin;
  const devWsOrigin = devOrigin.replace(/^https?:/, (m) =>
    m === "https:" ? "wss:" : "ws:"
  );

  return `default-src 'self'; script-src 'self' 'unsafe-inline' ${devOrigin}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self' ${devOrigin} ${devWsOrigin};`;
};

/**
 * Returns true if the renderer is allowed to navigate to `targetUrl`.
 *
 * Production: only file:// URLs are permitted (the app loads from the local
 * file system). Development: only the Vite dev server URL (exact match or
 * path under it) is permitted.
 */
export const isAllowedNavigationUrl = (
  targetUrl: string,
  { isDev, devServerUrl }: { isDev: boolean; devServerUrl: string }
): boolean => {
  if (isDev) {
    return (
      targetUrl.startsWith(`${devServerUrl}/`) ||
      targetUrl === devServerUrl
    );
  }

  return targetUrl.startsWith("file://");
};

/**
 * The webPreferences object passed to every BrowserWindow created by the app.
 *
 * Exported so tests can assert on the actual values used at runtime — if
 * sandbox, contextIsolation, or nodeIntegration are changed here, the test
 * will fail immediately.
 */
export const WINDOW_WEB_PREFERENCES = {
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true
} as const;

/**
 * The setWindowOpenHandler callback — always denies popup windows.
 * Exported for direct testing.
 */
export const denyWindowOpen = (): { action: "deny" } => ({ action: "deny" });
