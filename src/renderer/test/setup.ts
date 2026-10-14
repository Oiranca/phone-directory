import "@testing-library/jest-dom/vitest";
import { afterAll, beforeAll, beforeEach, vi } from "vitest";

// Ensure localStorage is always available regardless of the test runtime
// environment. jsdom provides it when `environment: "jsdom"` is set in
// vite.config.ts, but an explicit polyfill makes the setup deterministic in
// case tests are ever run with a node-like environment or an older jsdom build
// that does not attach localStorage to globalThis.
if (typeof globalThis.localStorage === "undefined") {
  const _store: Record<string, string> = {};
  const _localStorage: Storage = {
    getItem: (key: string) => Object.prototype.hasOwnProperty.call(_store, key) ? _store[key]! : null,
    setItem: (key: string, value: string) => { _store[key] = String(value); },
    removeItem: (key: string) => { delete _store[key]; },
    clear: () => { for (const k of Object.keys(_store)) delete _store[k]; },
    key: (index: number) => Object.keys(_store)[index] ?? null,
    get length() { return Object.keys(_store).length; }
  };
  Object.defineProperty(globalThis, "localStorage", {
    value: _localStorage,
    writable: true,
    configurable: true
  });
}

const originalWarn = console.warn;
let originalDialogConstructor: typeof HTMLDialogElement | undefined;
let originalShowModal: PropertyDescriptor | undefined;
let originalClose: PropertyDescriptor | undefined;

beforeAll(() => {
  if (typeof HTMLElement === "undefined") return;

  originalDialogConstructor = globalThis.HTMLDialogElement;
  if (typeof globalThis.HTMLDialogElement === "undefined") {
    class HTMLDialogElementStub extends HTMLElement {
      open = false;
    }
    Object.defineProperty(globalThis, "HTMLDialogElement", { configurable: true, value: HTMLDialogElementStub });
  }

  const prototype = globalThis.HTMLDialogElement.prototype;
  originalShowModal = Object.getOwnPropertyDescriptor(prototype, "showModal");
  originalClose = Object.getOwnPropertyDescriptor(prototype, "close");
  prototype.showModal = function () { this.open = true; };
  prototype.close = function () { this.open = false; };
});

// Without a reset, localStorage-backed state (e.g. the
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
  if (typeof HTMLElement !== "undefined") {
    const prototype = globalThis.HTMLDialogElement.prototype;
    if (originalShowModal) Object.defineProperty(prototype, "showModal", originalShowModal);
    else delete (prototype as HTMLDialogElement & { showModal?: () => void }).showModal;
    if (originalClose) Object.defineProperty(prototype, "close", originalClose);
    else delete (prototype as HTMLDialogElement & { close?: () => void }).close;
    if (!originalDialogConstructor) delete (globalThis as typeof globalThis & { HTMLDialogElement?: typeof HTMLDialogElement }).HTMLDialogElement;
  }
  vi.restoreAllMocks();
});
