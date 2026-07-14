/**
 * Unit tests for src/main/security.ts — the pure security policy helpers
 * used by src/main/index.ts for window creation and CSP injection.
 *
 * index.ts imports and uses these functions directly, so a regression there
 * (wrong CSP, flipped sandbox flag, loosened navigation rule) will fail here.
 *
 * Covers the security-hardening acceptance criterion:
 *   - sandbox flags (webPreferences)
 *   - denied navigation + denied window.open
 *   - Content-Security-Policy header (production and development)
 */
import { describe, expect, it } from "vitest";
import {
  buildContentSecurityPolicy,
  denyWindowOpen,
  isAllowedNavigationUrl,
  PROD_CSP,
  WINDOW_WEB_PREFERENCES
} from "./security.js";

// ---------------------------------------------------------------------------
// webPreferences — WINDOW_WEB_PREFERENCES (the real object passed to BrowserWindow)
// ---------------------------------------------------------------------------
describe("WINDOW_WEB_PREFERENCES — sandbox and context-isolation flags", () => {
  it("sandbox is true (renderer is confined to sandbox)", () => {
    expect(WINDOW_WEB_PREFERENCES.sandbox).toBe(true);
  });

  it("contextIsolation is true (preload and renderer have separate JS worlds)", () => {
    expect(WINDOW_WEB_PREFERENCES.contextIsolation).toBe(true);
  });

  it("nodeIntegration is false (renderer cannot require Node modules)", () => {
    expect(WINDOW_WEB_PREFERENCES.nodeIntegration).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// denyWindowOpen — setWindowOpenHandler callback
// ---------------------------------------------------------------------------
describe("denyWindowOpen — popup window handler", () => {
  it("always returns { action: 'deny' }", () => {
    expect(denyWindowOpen()).toEqual({ action: "deny" });
  });

  it("returns deny on every invocation (not just the first)", () => {
    expect(denyWindowOpen()).toEqual({ action: "deny" });
    expect(denyWindowOpen()).toEqual({ action: "deny" });
  });
});

// ---------------------------------------------------------------------------
// isAllowedNavigationUrl — production mode (isDev: false)
// ---------------------------------------------------------------------------
describe("isAllowedNavigationUrl — production mode", () => {
  const opts = { isDev: false, devServerUrl: "http://localhost:5173" };

  it("allows file:// URLs", () => {
    expect(isAllowedNavigationUrl("file:///path/to/index.html", opts)).toBe(true);
    expect(isAllowedNavigationUrl("file://", opts)).toBe(true);
  });

  it("denies http:// URLs", () => {
    expect(isAllowedNavigationUrl("http://example.com", opts)).toBe(false);
    expect(isAllowedNavigationUrl("http://localhost:5173", opts)).toBe(false);
  });

  it("denies https:// URLs", () => {
    expect(isAllowedNavigationUrl("https://example.com", opts)).toBe(false);
  });

  it("denies data: URLs", () => {
    expect(isAllowedNavigationUrl("data:text/html,<h1>xss</h1>", opts)).toBe(false);
  });

  it("denies javascript: URLs", () => {
    expect(isAllowedNavigationUrl("javascript:alert(1)", opts)).toBe(false);
  });

  it("denies blank string", () => {
    expect(isAllowedNavigationUrl("", opts)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isAllowedNavigationUrl — development mode (isDev: true)
// ---------------------------------------------------------------------------
describe("isAllowedNavigationUrl — development mode", () => {
  const devUrl = "http://localhost:5173";
  const opts = { isDev: true, devServerUrl: devUrl };

  it("allows the exact dev server URL", () => {
    expect(isAllowedNavigationUrl(devUrl, opts)).toBe(true);
  });

  it("allows URLs with a path under the dev server origin", () => {
    expect(isAllowedNavigationUrl(`${devUrl}/`, opts)).toBe(true);
    expect(isAllowedNavigationUrl(`${devUrl}/some/page`, opts)).toBe(true);
  });

  it("denies file:// in dev mode (only the dev server is permitted)", () => {
    expect(isAllowedNavigationUrl("file:///path/to/index.html", opts)).toBe(false);
  });

  it("denies unrelated http URLs in dev mode", () => {
    expect(isAllowedNavigationUrl("http://evil.com", opts)).toBe(false);
  });

  it("denies a URL that merely contains the dev server URL as a substring", () => {
    expect(isAllowedNavigationUrl(`http://evil.com/?r=${devUrl}`, opts)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// buildContentSecurityPolicy — production
// ---------------------------------------------------------------------------
describe("buildContentSecurityPolicy — production (isDev: false)", () => {
  const csp = buildContentSecurityPolicy({
    isDev: false,
    devServerUrl: "http://localhost:5173"
  });

  it("returns PROD_CSP exactly", () => {
    expect(csp).toBe(PROD_CSP);
  });

  it("starts with default-src 'self'", () => {
    expect(csp).toMatch(/^default-src 'self'/);
  });

  it("restricts script-src to 'self' only — no unsafe-inline in script-src directive", () => {
    const scriptSrc = csp.split(";")
      .map((d) => d.trim())
      .find((d) => d.startsWith("script-src")) ?? "";
    expect(scriptSrc).toContain("'self'");
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc).not.toContain("unsafe-eval");
  });

  it("restricts connect-src to 'self' only", () => {
    const connectSrc = csp.split(";")
      .map((d) => d.trim())
      .find((d) => d.startsWith("connect-src")) ?? "";
    expect(connectSrc).toBe("connect-src 'self'");
  });

  it("allows data: URIs for img and font (required for icons and fonts)", () => {
    expect(csp).toContain("img-src 'self' data:");
    expect(csp).toContain("font-src 'self' data:");
  });

  it("does not reference any external origin", () => {
    expect(csp).not.toContain("localhost");
    expect(csp).not.toContain("http:");
    expect(csp).not.toContain("ws:");
  });
});

// ---------------------------------------------------------------------------
// buildContentSecurityPolicy — development
// ---------------------------------------------------------------------------
describe("buildContentSecurityPolicy — development (isDev: true)", () => {
  const devServerUrl = "http://localhost:5173";
  const csp = buildContentSecurityPolicy({ isDev: true, devServerUrl });

  it("includes the dev origin in script-src (Vite HMR scripts require unsafe-inline)", () => {
    expect(csp).toContain(`script-src 'self' 'unsafe-inline' http://localhost:5173`);
  });

  it("includes the ws:// origin in connect-src (Vite HMR WebSocket)", () => {
    expect(csp).toContain("ws://localhost:5173");
  });

  it("derives ws origin from dev origin via http→ws protocol substitution", () => {
    const derived = devServerUrl.replace(/^https?:/, (m) =>
      m === "https:" ? "wss:" : "ws:"
    );
    expect(derived).toBe("ws://localhost:5173");
    expect(csp).toContain(derived);
  });

  it("does NOT equal the production CSP", () => {
    expect(csp).not.toBe(PROD_CSP);
  });

  it("still has default-src 'self'", () => {
    expect(csp).toMatch(/^default-src 'self'/);
  });
});

// ---------------------------------------------------------------------------
// buildContentSecurityPolicy — https dev server (wss: derivation)
// ---------------------------------------------------------------------------
describe("buildContentSecurityPolicy — https dev server wss: derivation", () => {
  it("derives wss:// from https:// dev origin", () => {
    const csp = buildContentSecurityPolicy({
      isDev: true,
      devServerUrl: "https://localhost:5173"
    });
    expect(csp).toContain("wss://localhost:5173");
    expect(csp).not.toContain("ws://localhost:5173");
  });
});
