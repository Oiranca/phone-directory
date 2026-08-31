import type { IpcMain } from "electron";

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
 * Only the canonical renderer document is permitted. Query-string and hash
 * changes are allowed because they do not replace that document.
 */
export const isAllowedNavigationUrl = (
  targetUrl: string,
  expectedRendererUrl: string
): boolean => {
  try {
    const target = new URL(targetUrl);
    const expected = new URL(expectedRendererUrl);

    return (
      target.protocol === expected.protocol &&
      target.username === expected.username &&
      target.password === expected.password &&
      target.host === expected.host &&
      target.pathname === expected.pathname
    );
  } catch {
    return false;
  }
};

type TrustedWebContents = {
  mainFrame: unknown;
};

type TrustedIpcEvent = {
  sender: unknown;
  senderFrame: { url: string } | null;
};

export const assertTrustedIpcEvent = (
  event: TrustedIpcEvent,
  expectedWebContents: TrustedWebContents | null,
  expectedRendererUrl: string
): void => {
  if (
    !expectedWebContents ||
    event.sender !== expectedWebContents ||
    event.senderFrame !== expectedWebContents.mainFrame ||
    !event.senderFrame ||
    !isAllowedNavigationUrl(event.senderFrame.url, expectedRendererUrl)
  ) {
    throw new Error("Unauthorized IPC sender");
  }
};

export const createTrustedIpcHandle = (
  registerHandle: IpcMain["handle"],
  getExpectedWebContents: () => TrustedWebContents | null,
  expectedRendererUrl: string
): IpcMain["handle"] =>
  (channel, listener) => {
    registerHandle(channel, (event, ...args) => {
      assertTrustedIpcEvent(event, getExpectedWebContents(), expectedRendererUrl);
      return listener(event, ...args);
    });
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
