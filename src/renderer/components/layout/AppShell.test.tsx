import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { AppShell } from "./AppShell";

const future = { v7_startTransition: true, v7_relativeSplatPath: true } as const;

const renderShell = (props: { isRecoveryMode?: boolean } = {}, initialEntries = ["/"]) =>
  render(
    <MemoryRouter initialEntries={initialEntries} future={future}>
      <AppShell {...props}>
        <div>child</div>
      </AppShell>
    </MemoryRouter>
  );

afterEach(() => {
  cleanup();
});

describe("AppShell — default mode", () => {
  it("renders nav with all 4 links", () => {
    renderShell();
    const nav = screen.getByRole("navigation", { name: "Navegación principal" });
    expect(nav).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Directorio" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Nuevo registro" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Importar/Exportar" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Configuración" })).toBeInTheDocument();
  });

  it("nav links have correct hrefs", () => {
    renderShell();
    expect(screen.getByRole("link", { name: "Directorio" })).toHaveAttribute("href", "/");
    expect(screen.getByRole("link", { name: "Nuevo registro" })).toHaveAttribute("href", "/contacts/new");
    expect(screen.getByRole("link", { name: "Importar/Exportar" })).toHaveAttribute("href", "/import-export");
    expect(screen.getByRole("link", { name: "Configuración" })).toHaveAttribute("href", "/settings");
  });

  it("nav links keep the shared focus visibility class", () => {
    renderShell();
    expect(screen.getByRole("link", { name: "Directorio" })).toHaveClass("focus-ring");
    expect(screen.getByRole("link", { name: "Configuración" })).toHaveClass("focus-ring");
  });

  it("shows Offline badge", () => {
    renderShell();
    expect(screen.getByText("Offline")).toBeInTheDocument();
  });

  it("does not show recovery banner", () => {
    renderShell();
    expect(
      screen.queryByText(/bloqueado hasta importar/i)
    ).not.toBeInTheDocument();
  });

  it("renders children in main", () => {
    renderShell();
    expect(screen.getByText("child")).toBeInTheDocument();
  });

  it("main route target keeps a visible focus style for programmatic focus", () => {
    renderShell();
    expect(screen.getByRole("main")).toHaveClass("focus-visible:ring-2");
    expect(screen.getByRole("main")).toHaveClass("focus-visible:ring-scs-blue");
  });
});

describe("AppShell — recovery mode", () => {
  it("hides nav when isRecoveryMode=true", () => {
    renderShell({ isRecoveryMode: true });
    expect(
      screen.queryByRole("navigation", { name: "Navegación principal" })
    ).not.toBeInTheDocument();
  });

  it("shows recovery banner text", () => {
    renderShell({ isRecoveryMode: true });
    expect(
      screen.getByText(
        "El directorio está bloqueado hasta importar una copia JSON válida o restablecer un dataset vacío."
      )
    ).toBeInTheDocument();
  });

  it("shows Recuperación badge", () => {
    renderShell({ isRecoveryMode: true });
    expect(screen.getByText("Recuperación")).toBeInTheDocument();
  });
});

describe("AppShell — active NavLink", () => {
  it("active link at / gets aria-current=page", () => {
    renderShell({}, ["/"]);
    expect(screen.getByRole("link", { name: "Directorio" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Configuración" })).not.toHaveAttribute("aria-current");
  });

  it("active link at /settings gets aria-current=page", () => {
    renderShell({}, ["/settings"]);
    expect(screen.getByRole("link", { name: "Configuración" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Directorio" })).not.toHaveAttribute("aria-current");
  });

  it("active link at /contacts/new gets aria-current=page", () => {
    renderShell({}, ["/contacts/new"]);
    const link = screen.getByRole("link", { name: "Nuevo registro" });
    expect(link).toHaveAttribute("aria-current", "page");
  });

  it("inactive links do not get aria-current", () => {
    renderShell({}, ["/contacts/new"]);
    expect(screen.getByRole("link", { name: "Nuevo registro" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Directorio" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: "Configuración" })).not.toHaveAttribute("aria-current");
  });
});
