import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorBoundary } from "./ErrorBoundary";

// Module-scoped flag so the same component instance can be told to stop
// throwing between renders (used to exercise the retry/reset flow).
let shouldThrow = true;

const Bomb = () => {
  if (shouldThrow) {
    throw new Error("boom");
  }

  return <div>Contenido recuperado</div>;
};

describe("ErrorBoundary", () => {
  beforeEach(() => {
    shouldThrow = true;
    // React (and our own componentDidCatch) log the caught error to the
    // console; mock it by default to keep test output clean. Tests that
    // assert on the logging behavior grab their own spy reference.
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders children normally when no error is thrown", () => {
    render(
      <ErrorBoundary>
        <div>Directorio disponible</div>
      </ErrorBoundary>
    );

    expect(screen.getByText("Directorio disponible")).toBeInTheDocument();
  });

  it("catches a render error in a child component and shows the fallback panel instead of crashing", () => {
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>
    );

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Algo salió mal")).toBeInTheDocument();
    expect(screen.queryByText("Contenido recuperado")).not.toBeInTheDocument();
  });

  it("logs the caught error via console.error", () => {
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>
    );

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[ErrorBoundary] Uncaught render error:",
      expect.any(Error),
      expect.anything()
    );
  });

  it("renders a Reintentar action that resets the boundary and lets the subtree recover", () => {
    render(
      <ErrorBoundary>
        <Bomb />
      </ErrorBoundary>
    );

    const retryButton = screen.getByRole("button", { name: "Reintentar" });
    expect(retryButton).toBeInTheDocument();

    // Simulate the underlying issue being resolved before the user retries.
    shouldThrow = false;
    fireEvent.click(retryButton);

    expect(screen.getByText("Contenido recuperado")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
