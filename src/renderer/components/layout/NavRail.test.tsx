import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router";
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

const getDesktopSections = () => {
  const sections = document.querySelector("[data-navigation-sections=desktop]");
  if (!sections) throw new Error("Desktop navigation sections were not rendered");
  return sections;
};

const getDesktopLinks = () => within(getDesktopSections()).getAllByRole("link");
const getDesktopLink = (name: string) => within(getDesktopSections()).getByRole("link", { name });
const NavigateToAgenda = () => {
  const navigate = useNavigate();
  return <button type="button" onClick={() => navigate("/")}>Ir a Agenda</button>;
};

afterEach(() => {
  cleanup();
  localStorage.clear();
  useAppStore.setState({ query: "" });
});

describe("NavRail — sections", () => {
  it("keeps destinations grouped and separated without redundant headings", () => {
    renderRail();
    const sections = getDesktopSections();

    expect(sections.querySelectorAll("section")).toHaveLength(6);
    expect(sections.querySelector("section > p")).not.toBeInTheDocument();
    expect(sections.querySelectorAll("section.border-t")).toHaveLength(6);
    expect(within(sections).getAllByRole("region").map((section) => section.getAttribute("aria-label"))).toEqual([
      "Doctor Negrín",
      "Hospital Polivalente",
      "Juan Carlos I",
      "Otros centros",
      "Centros de Salud",
      "Unidad de Salud Mental"
    ]);
    expect(getDesktopLinks().map((link) => link.textContent)).toEqual([
      "Agenda",
      "Buscas",
      "Polivalente",
      "Juan Carlos I",
      "San Roque Guía",
      "CAE Arucas",
      "CAE Gáldar",
      "Centros de Salud",
      "Consultorios Locales",
      "USM · Canalejas",
      "USM · Casa del Mar",
      "USM · Costa Ayala",
      "USM · La Feria"
    ]);
    expect(within(sections).getAllByRole("link")).toHaveLength(13);
  });

  it("keeps routes and shortcut hints when labels change", () => {
    renderRail();
    expect(getDesktopLink("Agenda")).toHaveAttribute("href", "/");
    expect(getDesktopLink("Agenda")).toHaveAttribute("title", "Agenda — Alt+1");
    expect(getDesktopLinks().map((link) => link.getAttribute("href"))).toEqual([
      "/",
      "/beeper",
      "/centers/hospital-polivalente",
      "/centers/hjci",
      "/centers/hsrg",
      "/centers/cae-arucas",
      "/centers/cae-galdar",
      "/centers/health-centers",
      "/centers/local-clinics",
      "/centers/usm-canalejas",
      "/centers/usm-casa-del-mar",
      "/centers/usm-costa-ayala",
      "/centers/usm-la-feria"
    ]);
    expect(getDesktopLink("Buscas")).toHaveAttribute("title", "Buscas — Alt+4");
    expect(screen.getByRole("link", { name: "Nuevo registro" })).toHaveAttribute("href", "/contacts/new");
  });

  it("clears the directory query when entering Agenda or Buscas", () => {
    renderRail();
    useAppStore.setState({ query: "filtro anterior" });
    fireEvent.click(getDesktopLink("Buscas"));
    expect(useAppStore.getState().query).toBe("");

    useAppStore.setState({ query: "otro filtro" });
    fireEvent.click(getDesktopLink("Agenda"));
    expect(useAppStore.getState().query).toBe("");
  });
});

describe("NavRail — active route highlighting", () => {
  it("marks the item matching the current route as active", () => {
    renderRail(["/"]);
    expect(getDesktopLink("Agenda")).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Configuración" })).not.toHaveAttribute("aria-current");
  });

  it("marks only the selected center destination as active", () => {
    renderRail(["/centers/hsrg"]);
    expect(getDesktopLinks().find((link) => link.getAttribute("href") === "/centers/hsrg")).toHaveAttribute("aria-current", "page");
    expect(getDesktopLink("Agenda")).not.toHaveAttribute("aria-current");
  });

  it("highlights only Gestión Buscas at /beeper/new, not Buscas", () => {
    renderRail(["/beeper/new"]);
    expect(screen.getByRole("link", { name: "Gestión Buscas" })).toHaveAttribute("aria-current", "page");
    expect(getDesktopLink("Buscas")).not.toHaveAttribute("aria-current");
  });
});

describe("NavRail — mobile disclosure", () => {
  it("keeps grouped center links in the mobile disclosure", () => {
    renderRail();
    const mobileCenters = document.querySelector("details[data-center-menu]");

    expect(mobileCenters).toBeInTheDocument();
    expect(within(mobileCenters!).getByText("Centros")).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Navegación principal" })).toHaveClass("grid-cols-6");
    expect(mobileCenters?.querySelector("summary")).toHaveClass("min-h-11");
    expect(mobileCenters?.querySelector("section")).toHaveClass("gap-2");
    expect(mobileCenters!.querySelectorAll("section")).toHaveLength(5);
    expect(mobileCenters!.querySelector("section > p")).not.toBeInTheDocument();
    expect(mobileCenters!.querySelectorAll("section.border-t")).toHaveLength(5);
    expect(within(mobileCenters!).getAllByRole("region").map((section) => section.getAttribute("aria-label"))).toEqual([
      "Hospital Polivalente",
      "Juan Carlos I",
      "Otros centros",
      "Centros de Salud",
      "Unidad de Salud Mental"
    ]);
    expect(within(mobileCenters!).getAllByRole("link").map((link) => link.textContent)).toEqual([
      "Polivalente",
      "Juan Carlos I",
      "San Roque Guía",
      "CAE Arucas",
      "CAE Gáldar",
      "Centros de Salud",
      "Consultorios Locales",
      "USM · Canalejas",
      "USM · Casa del Mar",
      "USM · Costa Ayala",
      "USM · La Feria"
    ]);
  });

  it("keeps the mobile disclosure label short when a center is selected", () => {
    renderRail(["/centers/hsrg"]);
    const summary = document.querySelector("details[data-center-menu] summary");

    expect(summary).toHaveClass("bg-scs-blue", "text-white");
    expect(summary).toHaveTextContent("Centros");
    expect(summary).not.toHaveTextContent("San Roque Guía");
  });

  it("closes the mobile disclosure after navigation changes the route", async () => {
    render(
      <MemoryRouter initialEntries={["/centers/hsrg"]} future={future}>
        <NavRail />
        <NavigateToAgenda />
      </MemoryRouter>
    );
    const mobileCenters = document.querySelector<HTMLDetailsElement>("details[data-center-menu]")!;
    mobileCenters.open = true;

    fireEvent.click(screen.getByRole("button", { name: "Ir a Agenda" }));

    await waitFor(() => expect(mobileCenters.open).toBe(false));
  });
});
