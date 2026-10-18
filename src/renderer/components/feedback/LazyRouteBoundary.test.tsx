import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withLazyRouteBoundary } from "./LazyRouteBoundary";

// A rejected `React.lazy()` dynamic
// import throws synchronously during render once the rejection resolves —
// `Suspense` alone only covers the *pending* state, not a rejection. On this
// USB-distributed, manually-updated app a missing/corrupt chunk file after
// an update is a realistic failure mode, so an uncaught rejection here must
// not unmount the whole app to a blank white screen.
describe("withLazyRouteBoundary", () => {
  beforeEach(() => {
    // React (and our own componentDidCatch) log the caught error to
    // console.error — expected noise for this test, keep output clean.
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("shows recoverable fallback UI instead of crashing when a lazy import rejects", async () => {
    const factory = () => Promise.reject(new Error("Failed to fetch dynamically imported module"));

    render(withLazyRouteBoundary(factory));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });

    expect(screen.getByText("No se pudo cargar esta sección")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
  });

  it("still resolves and renders the wrapped component when the lazy import succeeds", async () => {
    const factory = () => Promise.resolve({ default: () => <div>Contenido cargado</div> });

    render(withLazyRouteBoundary(factory));

    expect(await screen.findByText("Contenido cargado")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("loads the next route when its factory changes", async () => {
    const firstFactory = () => Promise.resolve({ default: () => <div>Primera sección</div> });
    const secondFactory = async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return { default: () => <div>Segunda sección</div> };
    };
    const { rerender } = render(withLazyRouteBoundary(firstFactory));

    expect(await screen.findByText("Primera sección")).toBeInTheDocument();

    rerender(withLazyRouteBoundary(secondFactory));

    expect(await screen.findByText("Segunda sección")).toBeInTheDocument();
    expect(screen.queryByText("Primera sección")).not.toBeInTheDocument();
  });

  // `React.lazy()` memoizes the promise
  // returned by its factory *per call* — once that promise has rejected,
  // re-rendering the *same* lazy component reference just re-throws the
  // same cached rejection, it never re-invokes the factory. A retry button
  // that only cleared the error state and re-rendered the same lazy
  // component therefore did nothing: the user landed right back on the
  // error fallback. This test genuinely exercises the fix by clicking the
  // "Reintentar" button and asserting real recovery — a factory that
  // rejects on its first invocation and resolves on its second.
  it("actually re-attempts the dynamic import and recovers when Reintentar is clicked", async () => {
    let attempt = 0;
    let resolveRetry: (() => void) | undefined;
    const retryPromise = new Promise<{ default: () => ReactElement }>((resolve) => {
      resolveRetry = () => resolve({ default: () => <div>Contenido recuperado</div> });
    });
    const factory = () => {
      attempt += 1;
      if (attempt === 1) {
        return Promise.reject(new Error("Failed to fetch dynamically imported module"));
      }
      return retryPromise;
    };

    render(<main id="main-content" tabIndex={-1}>{withLazyRouteBoundary(factory)}</main>);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });
    expect(screen.queryByText("Contenido recuperado")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));

    expect(await screen.findByText("Cargando…")).toBeInTheDocument();
    expect(screen.getByRole("main")).toHaveFocus();

    if (!resolveRetry) {
      throw new Error("Retry import resolver was not registered");
    }
    resolveRetry();

    expect(await screen.findByText("Contenido recuperado")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(attempt).toBe(2);
    expect(screen.getByRole("main")).toHaveFocus();
  });

  it("moves focus to the retry error heading when a second import attempt fails", async () => {
    let attempt = 0;
    const factory = () => {
      attempt += 1;
      return Promise.reject(new Error("Failed to fetch dynamically imported module"));
    };

    render(<main id="main-content" tabIndex={-1}>{withLazyRouteBoundary(factory)}</main>);

    const retryButton = await screen.findByRole("button", { name: "Reintentar" });
    retryButton.focus();
    fireEvent.click(retryButton);

    await waitFor(() => {
      expect(attempt).toBe(2);
    });

    expect(await screen.findByRole("heading", { name: "No se pudo cargar esta sección" })).toHaveFocus();
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
  });
});
