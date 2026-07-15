import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LoadingStatus } from "./LoadingStatus";

describe("LoadingStatus", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the message inside a polite status region", () => {
    render(<LoadingStatus message="Cargando datos locales…" />);

    const region = screen.getByRole("status");
    expect(region).toHaveTextContent("Cargando datos locales…");
    expect(region).toHaveAttribute("aria-live", "polite");
  });

  it("omits aria-busy when `busy` is not passed", () => {
    render(<LoadingStatus message="Cargando…" />);
    expect(screen.getByRole("status")).not.toHaveAttribute("aria-busy");
  });

  it("sets aria-busy when `busy` is passed", () => {
    render(<LoadingStatus message="Cargando configuración…" busy />);
    expect(screen.getByRole("status")).toHaveAttribute("aria-busy", "true");
  });

  it("applies a default className when none is passed", () => {
    render(<LoadingStatus message="Cargando…" />);
    expect(screen.getByRole("status").className).toContain("rounded-3xl");
  });

  it("applies a custom className when passed", () => {
    render(<LoadingStatus message="Cargando…" className="custom-class" />);
    expect(screen.getByRole("status").className).toBe("custom-class");
  });
});
