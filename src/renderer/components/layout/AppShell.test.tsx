import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { FormEvent } from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppShell } from "./AppShell";
import { useAppStore } from "../../store/useAppStore";

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
  // OIR-218: reset settings so the last-import watermark test's setState()
  // doesn't leak into subsequent tests in this file.
  useAppStore.setState({ settings: null });
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

  // OIR-218: the "Local" badge and the big serif "Agenda" heading were removed —
  // only the "AGENDA HOSPITALARIA" eyebrow remains, plus a last-import
  // watermark shown in the badge's place once an import has happened.
  it("does not show a 'Local' badge", () => {
    renderShell();
    expect(screen.queryByText("Local")).not.toBeInTheDocument();
  });

  it("header shows the 'AGENDA HOSPITALARIA' eyebrow, no 'Agenda' heading, and never mentions 'MVP'", () => {
    renderShell();
    const header = screen.getByRole("banner");
    expect(screen.getByText("Agenda Hospitalaria")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
    expect(header.textContent).not.toMatch(/MVP/i);
  });

  it("hides the last-import watermark when no import has ever happened", () => {
    renderShell();
    expect(screen.queryByText(/Última actualización/)).not.toBeInTheDocument();
  });

  it("shows the last-import watermark as DD-MM-YYYY HH:mm once an import has happened", () => {
    useAppStore.setState({
      settings: {
        editorName: "",
        dataFilePath: "/tmp/data/contacts.json",
        backupDirectoryPath: "/tmp/backups",
        ui: { showInactiveByDefault: false },
        lastImportedAt: "2026-06-15T09:05:00.000Z"
      } as never
    });

    renderShell();

    // Locale-independent: build the expected label from the same Date the
    // component parses, so this test is stable regardless of the CI runner's
    // timezone.
    const date = new Date("2026-06-15T09:05:00.000Z");
    const pad = (n: number) => String(n).padStart(2, "0");
    const expected = `Última actualización: ${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}`;

    expect(screen.getByText(expected)).toBeInTheDocument();
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

  it("focuses data-page-search input with slash when focus is not in text entry", () => {
    render(
      <MemoryRouter future={future}>
        <AppShell>
          <input data-page-search aria-label="Buscar contactos" />
        </AppShell>
      </MemoryRouter>
    );

    fireEvent.keyDown(window, { key: "/" });

    expect(screen.getByLabelText("Buscar contactos")).toHaveFocus();
  });

  it("prefers data-page-search over the directory-search id fallback when both are present", () => {
    render(
      <MemoryRouter future={future}>
        <AppShell>
          {/* data-page-search is the preferred target (current-page search) */}
          <input data-page-search aria-label="Buscar en página actual" />
          {/* id fallback — should NOT receive focus when data-page-search is present */}
          <input id="directory-search" aria-label="Buscar contactos" />
        </AppShell>
      </MemoryRouter>
    );

    fireEvent.keyDown(window, { key: "/" });

    expect(screen.getByLabelText("Buscar en página actual")).toHaveFocus();
    expect(screen.getByLabelText("Buscar contactos")).not.toHaveFocus();
  });

  it("keeps slash as text input when typing in a text field", () => {
    render(
      <MemoryRouter future={future}>
        <AppShell>
          <input data-page-search aria-label="Buscar contactos" />
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

  it("does not steal modifier+n while an in-progress form is open (e.g. Buscas inline form)", () => {
    render(
      <MemoryRouter future={future}>
        <AppShell>
          <LocationProbe />
          <button type="button" data-keyboard-cancel>Cancelar</button>
        </AppShell>
      </MemoryRouter>
    );

    // fireEvent returns false when preventDefault was called on the event.
    const notPrevented = fireEvent.keyDown(window, { key: "n", ctrlKey: true });

    expect(screen.getByTestId("location")).toHaveTextContent("/");
    // The keypress must still be consumed so Electron/Chromium's native
    // Ctrl/Cmd+N (new window) can't fire while an unsaved form is open.
    expect(notPrevented).toBe(false);
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
        "El directorio está bloqueado hasta importar una copia JSON válida o restablecer el directorio vacío."
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
