import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it } from "vitest";
import { NavRail } from "./NavRail";
import { useAppStore } from "../../store/useAppStore";

const future = { v7_startTransition: true, v7_relativeSplatPath: true } as const;

const renderRail = (initialEntries = ["/"]) =>
  render(
    <MemoryRouter initialEntries={initialEntries} future={future}>
      <NavRail />
    </MemoryRouter>
  );

afterEach(() => {
  cleanup();
  localStorage.clear();
  useAppStore.setState({ query: "" });
});

describe("NavRail — items", () => {
  it("renders four nav items with Buscas immediately below Directorio", () => {
    renderRail();
    const nav = screen.getByRole("navigation", { name: "Navegación principal" });
    expect(nav).toBeInTheDocument();
    expect(within(nav).getAllByRole("link").map((link) => link.textContent)).toEqual([
      "Directorio",
      "Buscas",
      "Nuevo registro",
      "Configuración"
    ]);
    expect(screen.queryByRole("link", { name: "Duplicados" })).not.toBeInTheDocument();
  });

  it("routes each item to the expected href", () => {
    renderRail();
    expect(screen.getByRole("link", { name: "Directorio" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "Nuevo registro" })).toHaveAttribute("href", "/contacts/new");
    expect(screen.getByRole("link", { name: "Buscas" })).toHaveAttribute("href", "/beeper");
    expect(screen.getByRole("link", { name: "Configuración" })).toHaveAttribute("href", "/settings");
  });

  it("clears the directory query when entering Agenda or Buscas", () => {
    renderRail();
    useAppStore.setState({ query: "filtro anterior" });
    fireEvent.click(screen.getByRole("link", { name: "Buscas" }));
    expect(useAppStore.getState().query).toBe("");

    useAppStore.setState({ query: "otro filtro" });
    fireEvent.click(screen.getByRole("link", { name: "Directorio" }));
    expect(useAppStore.getState().query).toBe("");
  });

  it("exposes the Alt+N shortcut hint via the title attribute, unchanged from the previous nav", () => {
    renderRail();
    expect(screen.getByRole("link", { name: "Directorio" })).toHaveAttribute("title", "Directorio — Alt+1");
    expect(screen.getByRole("link", { name: "Nuevo registro" })).toHaveAttribute("title", "Nuevo registro — Alt+2");
    expect(screen.getByRole("link", { name: "Configuración" })).toHaveAttribute("title", "Configuración — Alt+3");
    expect(screen.getByRole("link", { name: "Buscas" })).toHaveAttribute("title", "Buscas — Alt+4");
  });
});

describe("NavRail — active route highlighting", () => {
  it("marks the item matching the current route as active", () => {
    renderRail(["/"]);
    expect(screen.getByRole("link", { name: "Directorio" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Configuración" })).not.toHaveAttribute("aria-current");
  });

  it("switches the active item when rendered at a different route", () => {
    renderRail(["/settings"]);
    expect(screen.getByRole("link", { name: "Configuración" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Directorio" })).not.toHaveAttribute("aria-current");
  });

  it("does not expose a separate Duplicados item at /deduplicate", () => {
    renderRail(["/deduplicate"]);
    expect(screen.queryByRole("link", { name: "Duplicados" })).not.toBeInTheDocument();
  });
});

describe("NavRail — collapse/expand toggle", () => {
  it("defaults to collapsed (60px) when no preference is stored", () => {
    renderRail();
    const toggle = screen.getByRole("button", { name: "Mostrar títulos" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
  });

  it("expands to 192px and flips the toggle label/aria-pressed when clicked", () => {
    renderRail();
    const toggle = screen.getByRole("button", { name: "Mostrar títulos" });

    fireEvent.click(toggle);

    const expandedToggle = screen.getByRole("button", { name: "Ocultar títulos" });
    expect(expandedToggle).toHaveAttribute("aria-pressed", "true");
  });

  it("collapses again on a second click", () => {
    renderRail();
    fireEvent.click(screen.getByRole("button", { name: "Mostrar títulos" }));
    fireEvent.click(screen.getByRole("button", { name: "Ocultar títulos" }));

    expect(screen.getByRole("button", { name: "Mostrar títulos" })).toHaveAttribute("aria-pressed", "false");
  });

  it("persists the collapsed preference to localStorage across remounts", () => {
    const { unmount } = renderRail();
    fireEvent.click(screen.getByRole("button", { name: "Mostrar títulos" }));
    expect(localStorage.getItem("nav-rail-collapsed:v1")).toBe("false");
    unmount();

    renderRail();
    expect(screen.getByRole("button", { name: "Ocultar títulos" })).toBeInTheDocument();
  });

  it("falls back to collapsed when a corrupt value is stored", () => {
    localStorage.setItem("nav-rail-collapsed:v1", "not-a-boolean");
    renderRail();
    expect(screen.getByRole("button", { name: "Mostrar títulos" })).toBeInTheDocument();
  });
});
