import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const config = JSON.parse(readFileSync(resolve(process.cwd(), "src-tauri/tauri.conf.json"), "utf8"));
const { csp, devCsp } = config.app.security;

describe("Tauri security policy", () => {
  it("keeps production sources restricted to the bundled app and Tauri IPC", () => {
    expect(csp).toBe(
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self' ipc: http://ipc.localhost;"
    );
  });

  it("allows only Vite's local development origin and HMR socket", () => {
    expect(devCsp).toContain("script-src 'self' 'unsafe-inline' http://localhost:5173");
    expect(devCsp).toContain("connect-src 'self' ipc: http://ipc.localhost http://localhost:5173 ws://localhost:5173");
  });
});
