import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { FormEvent } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
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

const LocationProbe = () => {
  const location = useLocation();
  return <p data-testid="location">{location.pathname}</p>;
};

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

  it("nav links expose keyboard shortcut hint via title attribute", () => {
    renderShell();
    expect(screen.getByRole("link", { name: "Directorio" })).toHaveAttribute("title", "Directorio — Alt+1");
    expect(screen.getByRole("link", { name: "Nuevo registro" })).toHaveAttribute("title", "Nuevo registro — Alt+2");
    expect(screen.getByRole("link", { name: "Importar/Exportar" })).toHaveAttribute("title", "Importar/Exportar — Alt+3");
    expect(screen.getByRole("link", { name: "Configuración" })).toHaveAttribute("title", "Configuración — Alt+4");
    expect(screen.getByRole("link", { name: "Buscas" })).toHaveAttribute("title", "Buscas — Alt+5");
    expect(screen.getByRole("link", { name: "Duplicados" })).toHaveAttribute("title", "Duplicados — Alt+6");
  });

  it("nav links keep the shared focus visibility class", () => {
    renderShell();
    expect(screen.getByRole("link", { name: "Directorio" })).toHaveClass("focus-ring");
    expect(screen.getByRole("link", { name: "Configuración" })).toHaveClass("focus-ring");
  });

  it("shows Local badge", () => {
    renderShell();
    expect(screen.getByText("Local")).toBeInTheDocument();
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

  it("main route target remains the skip-link anchor", () => {
    renderShell();
    expect(screen.getByRole("main")).toHaveAttribute("id", "main-content");
    expect(screen.getByRole("main")).toHaveAttribute("tabIndex", "-1");
    expect(screen.getByRole("main")).toHaveClass("focus-ring");
  });

  it("focuses data-keyboard-search input with slash when focus is not in text entry", () => {
    render(
      <MemoryRouter future={future}>
        <AppShell>
          <input data-keyboard-search aria-label="Buscar contactos" />
        </AppShell>
      </MemoryRouter>
    );

    fireEvent.keyDown(window, { key: "/" });

    expect(screen.getByLabelText("Buscar contactos")).toHaveFocus();
  });

  it("keeps slash as text input when typing in a text field", () => {
    render(
      <MemoryRouter future={future}>
        <AppShell>
          <input data-keyboard-search aria-label="Buscar contactos" />
          <input aria-label="Campo activo" />
        </AppShell>
      </MemoryRouter>
    );
    const activeField = screen.getByLabelText("Campo activo");
    activeField.focus();

    fireEvent.keyDown(activeField, { key: "/" });

    expect(activeField).toHaveFocus();
  });

  it("opens the new record route with modifier+n", () => {
    render(
      <MemoryRouter future={future}>
        <AppShell>
          <LocationProbe />
        </AppShell>
      </MemoryRouter>
    );

    fireEvent.keyDown(window, { key: "n", ctrlKey: true });

    expect(screen.getByTestId("location")).toHaveTextContent("/contacts/new");
  });

  it("submits the active keyboard form with modifier+s", () => {
    const onSubmit = vi.fn((event: FormEvent<HTMLFormElement>) => event.preventDefault());
    render(
      <MemoryRouter future={future}>
        <AppShell>
          <form data-keyboard-submit onSubmit={onSubmit}>
            <button type="submit">Guardar</button>
          </form>
        </AppShell>
      </MemoryRouter>
    );

    fireEvent.keyDown(window, { key: "s", ctrlKey: true });

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("uses alt number shortcuts for primary routes", () => {
    render(
      <MemoryRouter future={future}>
        <AppShell>
          <LocationProbe />
        </AppShell>
      </MemoryRouter>
    );

    fireEvent.keyDown(window, { code: "Digit4", key: "¡", altKey: true });

    expect(screen.getByTestId("location")).toHaveTextContent("/settings");
  });

  it("ignores alt number route shortcuts inside text entry", () => {
    render(
      <MemoryRouter future={future}>
        <AppShell>
          <LocationProbe />
          <input aria-label="Campo activo" />
        </AppShell>
      </MemoryRouter>
    );
    const activeField = screen.getByLabelText("Campo activo");
    activeField.focus();

    fireEvent.keyDown(activeField, { code: "Digit4", key: "¡", altKey: true });

    expect(activeField).toHaveFocus();
    expect(screen.getByTestId("location")).toHaveTextContent("/");
  });

  it("does not cancel a form while Escape is pressed inside a text field", () => {
    const onCancel = vi.fn();
    render(
      <MemoryRouter future={future}>
        <AppShell>
          <button type="button" data-keyboard-cancel onClick={onCancel}>Cancelar</button>
          <input aria-label="Campo activo" />
        </AppShell>
      </MemoryRouter>
    );
    const activeField = screen.getByLabelText("Campo activo");
    activeField.focus();

    fireEvent.keyDown(activeField, { key: "Escape" });

    expect(onCancel).not.toHaveBeenCalled();
  });

  it("activates the form cancel target with Escape outside text entry", () => {
    const onCancel = vi.fn();
    render(
      <MemoryRouter future={future}>
        <AppShell>
          <button type="button" data-keyboard-cancel onClick={onCancel}>Cancelar</button>
        </AppShell>
      </MemoryRouter>
    );

    fireEvent.keyDown(window, { key: "Escape" });

    expect(onCancel).toHaveBeenCalledTimes(1);
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
