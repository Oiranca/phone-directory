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
  it("keeps primary links first and groups Nuevo registro with Configuración at the bottom", () => {
    renderRail();
    const nav = screen.getByRole("navigation", { name: "Navegación principal" });
    expect(nav).toBeInTheDocument();
    const links = within(nav).getAllByRole("link");
    expect(links.map((link) => link.textContent)).toEqual([
      "Directorio",
      "Buscas",
      "Nuevo registro",
      "Configuración"
    ]);
    expect(nav.children[2]).toHaveAttribute("aria-hidden", "true");
    expect(nav.children[3]).toBe(links[2]);
    expect(nav.children[4]).toBe(links[3]);
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

describe("NavRail — visible labels", () => {
  it("keeps every destination label visible even when a collapsed preference was stored", () => {
    localStorage.setItem("nav-rail-collapsed:v1", "true");
    renderRail();
    const nav = screen.getByRole("navigation", { name: "Navegación principal" });
    expect(within(nav).getAllByRole("link").map((link) => link.textContent)).toEqual([
      "Directorio",
      "Buscas",
      "Nuevo registro",
      "Configuración"
    ]);
    expect(screen.queryByRole("button", { name: /títulos/i })).not.toBeInTheDocument();
  });
});
