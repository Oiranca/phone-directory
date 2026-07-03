import "@testing-library/jest-dom/vitest";
import { afterAll, beforeAll, beforeEach, vi } from "vitest";

const originalWarn = console.warn;

// OIR-189 P3 (Finding C) — without a reset, localStorage-backed state (e.g. the
// dedup dismissed-pairs list, or any future storage key) can leak across test
// files/cases within the same run, causing order-dependent flakiness.
// sessionStorage is cleared too, defensively, in case future code starts using it.
// This setup file also runs for `@vitest-environment node` test files (e.g.
// scripts/lib/*.test.mjs), where no Web Storage globals exist — guard with
// typeof checks so those suites are unaffected.
beforeEach(() => {
  if (typeof localStorage !== "undefined") {
    localStorage.clear();
  }
  if (typeof sessionStorage !== "undefined") {
    sessionStorage.clear();
  }
});

beforeAll(() => {
  vi.spyOn(console, "warn").mockImplementation((message?: unknown, ...args: unknown[]) => {
    if (
      typeof message === "string" &&
      message.includes("React Router Future Flag Warning")
    ) {
      return;
    }

    originalWarn(message, ...args);
  });
});

afterAll(() => {
  vi.restoreAllMocks();
});
