import { lazy } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withLazyRouteBoundary } from "./LazyRouteBoundary";

// Review follow-up on PR #135 (OIR-214): a rejected `React.lazy()` dynamic
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
    const BrokenLazyComponent = lazy(() => Promise.reject(new Error("Failed to fetch dynamically imported module")));

    render(withLazyRouteBoundary(<BrokenLazyComponent />));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeInTheDocument();
    });

    expect(screen.getByText("No se pudo cargar esta sección")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
  });

  it("still resolves and renders the wrapped component when the lazy import succeeds", async () => {
    const WorkingLazyComponent = lazy(() =>
      Promise.resolve({ default: () => <div>Contenido cargado</div> })
    );

    render(withLazyRouteBoundary(<WorkingLazyComponent />));

    expect(await screen.findByText("Contenido cargado")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
