import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RouterProvider } from "react-router/dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { router } from "./router";
import { ToastProvider } from "../components/feedback/ToastRegion";
import { defaultContacts } from "../../shared/fixtures/defaultContacts";
import { useAppStore, resetBootstrapInFlight } from "../store/useAppStore";
import type { BeeperRecord, BeeperTeam } from "../../shared/schemas/beeper.schema";

// Smoke test that the lazily-loaded routes (settings,
// deduplicate) still resolve and render their real page content through the
// Suspense boundary, not just the "Cargando…" fallback forever.

const editableSettings = {
  editorName: "Samuel",
  dataFilePath: "/tmp/data/contacts.json",
  backupDirectoryPath: "/tmp/backups",
  ui: {
    showInactiveByDefault: false,
    autoBackup: {
      enabled: false,
      trigger: "launch" as const,
      intervalHours: 2,
      editCountThreshold: 10,
      retentionCount: 5
    }
  }
};

const seedStoreAsBootstrapped = () => {
  resetBootstrapInFlight();
  useAppStore.setState({
    contacts: defaultContacts,
    settings: editableSettings,
    recovery: null,
    selectedRecordId: null,
    query: "",
    selectedType: "all",
    selectedArea: "all",
    selectedTags: [],
    showInactive: false,
    isLoading: false,
    bootstrapStatus: "success",
    bootstrapError: "",
    bootstrapHelp: ""
  });
};

describe("router — lazy route smoke test", () => {
  beforeEach(() => {
    seedStoreAsBootstrapped();
    Object.defineProperty(window, "hospitalDirectory", {
      configurable: true,
      value: {
        getBootstrapData: vi.fn().mockResolvedValue({ contacts: defaultContacts, settings: editableSettings }),
        getSettingsDefaults: vi.fn().mockResolvedValue({
          editorName: "",
          dataFilePath: "/tmp/default-data/contacts.json",
          backupDirectoryPath: "/tmp/default-backups",
          ui: editableSettings.ui
        }),
        saveSettings: vi.fn(),
        listBackups: vi.fn().mockResolvedValue([]),
        createBackup: vi.fn(),
        detectDuplicates: vi.fn().mockResolvedValue({ pairs: [] }),
        mergeContacts: vi.fn(),
        listBeepers: vi.fn().mockResolvedValue([]),
        listImportedBeepers: vi.fn().mockResolvedValue([]),
        listBeeperTeams: vi.fn().mockResolvedValue([]),
        listBeeperTeamMemberships: vi.fn().mockResolvedValue([]),
        addBeeper: vi.fn(),
        setBeeperTeamMembers: vi.fn()
      }
    });
  });

  afterEach(() => {
    cleanup();
    // Return the shared router instance to a known route so subsequent test
    // files/suites that happen to import it start from a clean slate.
    void router.navigate("/");
  });

  it("resolves the lazy settings route and renders SettingsPage content", async () => {
    render(
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    );

    // Index route (DirectoryPage) is eager — should be immediately available.
    expect(await screen.findByRole("navigation", { name: "Navegación principal" })).toBeInTheDocument();

    await act(async () => {
      await router.navigate("/settings");
    });

    expect(await screen.findByText("Configuración básica")).toBeInTheDocument();
  });

  it("redirects the legacy deduplicate route without running the finder", async () => {
    render(
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    );

    expect(await screen.findByRole("navigation", { name: "Navegación principal" })).toBeInTheDocument();

    await act(async () => {
      await router.navigate("/deduplicate");
    });

    expect(await screen.findByLabelText("Buscar contactos")).toBeInTheDocument();
    expect(screen.queryByText("No se encontraron duplicados")).not.toBeInTheDocument();
    expect(window.hospitalDirectory.detectDuplicates).not.toHaveBeenCalled();
  });

  it("resolves the lazy contact form route and renders RecordFormPage content", async () => {
    render(
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    );

    await act(async () => {
      await router.navigate("/contacts/new");
    });

    expect(await screen.findByRole("heading", { name: "Alta de contacto" })).toBeInTheDocument();
  });

  it("resolves the lazy beeper route and renders BeepersPage content", async () => {
    render(
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    );

    await act(async () => {
      await router.navigate("/beeper");
    });

    expect(await screen.findByRole("heading", { name: "Registro de Buscas" })).toBeInTheDocument();
  });

  it("resolves the lazy beeper create route and renders the busca-or-team chooser", async () => {
    render(
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    );

    await act(async () => {
      await router.navigate("/beeper/new");
    });

    expect(await screen.findByRole("heading", { name: "Nueva busca o equipo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Nuevo equipo" })).toBeInTheDocument();
  });
});

// BeepersPage serves /beeper and /beeper/new from two routes. Measured with the
// real router: moving between them does NOT remount the page (one fetch), so
// the page has to reset its own state when the route changes.
describe("router — /beeper and /beeper/new share one mounted page", () => {
  const uci: BeeperTeam = { id: "team_uci", name: "UCI", displayId: "9001" };
  const ana: BeeperRecord = { id: "bsc_001", deviceNumber: "B-001", assignedTo: "Ana García", department: "Urgencias", role: "Enfermera", shift: "mañana" };

  beforeEach(() => {
    seedStoreAsBootstrapped();
    Object.defineProperty(window, "hospitalDirectory", {
      configurable: true,
      value: {
        getBootstrapData: vi.fn().mockResolvedValue({ contacts: defaultContacts, settings: editableSettings }),
        listBackups: vi.fn().mockResolvedValue([]),
        listBeepers: vi.fn().mockResolvedValue([ana]),
        listImportedBeepers: vi.fn().mockResolvedValue([]),
        listBeeperTeams: vi.fn().mockResolvedValue([uci]),
        listBeeperTeamMemberships: vi.fn().mockResolvedValue([]),
        addBeeper: vi.fn().mockResolvedValue({ ...ana, id: "bsc_003", deviceNumber: "B-003" }),
        addBeeperTeam: vi.fn().mockResolvedValue({ id: "team_new", name: "Quirófano", displayId: "9010" }),
        setBeeperTeamMembers: vi.fn()
      }
    });
  });

  afterEach(() => {
    cleanup();
    void router.navigate("/");
  });

  const renderApp = () =>
    render(
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    );

  const goTo = (path: string) =>
    act(async () => {
      await router.navigate(path);
    });

  const selectUciInManager = async () => {
    await goTo("/beeper");
    await screen.findByText("B-001");
    fireEvent.click(screen.getByRole("button", { name: "Gestionar equipos" }));
    fireEvent.change(screen.getByLabelText("Equipo a gestionar"), { target: { value: "team_uci" } });
    expect(screen.getByRole("form", { name: "Editar equipo" })).toBeInTheDocument();
  };

  it("does not remount or refetch when navigating between the two routes", async () => {
    renderApp();
    await goTo("/beeper");
    await screen.findByText("B-001");

    await goTo("/beeper/new");
    await screen.findByRole("heading", { name: "Nueva busca o equipo" });

    expect(window.hospitalDirectory.listBeepers).toHaveBeenCalledTimes(1);
  });

  it("shows the chooser, not a leftover team editor, when entering /beeper/new", async () => {
    renderApp();
    await selectUciInManager();

    await goTo("/beeper/new");

    expect(await screen.findByRole("heading", { name: "Nueva busca o equipo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Nuevo equipo" })).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "Editar equipo" })).not.toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "Nuevo equipo" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Eliminar equipo" })).not.toBeInTheDocument();
  });

  it("shows the chooser, not a leftover busca edit form, when entering /beeper/new", async () => {
    renderApp();
    await goTo("/beeper");
    await screen.findByText("B-001");
    fireEvent.click(screen.getByRole("button", { name: /editar busca B-001/i }));
    expect(screen.getByRole("form", { name: "Editar busca" })).toBeInTheDocument();

    await goTo("/beeper/new");

    expect(await screen.findByRole("button", { name: "Nuevo equipo" })).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "Editar busca" })).not.toBeInTheDocument();
  });

  it("closes the team manager when leaving /beeper/new in the middle of creating a team", async () => {
    renderApp();
    await goTo("/beeper/new");
    fireEvent.click(await screen.findByRole("button", { name: "Nuevo equipo" }));
    expect(screen.getByRole("form", { name: "Nuevo equipo" })).toBeInTheDocument();

    await goTo("/beeper");

    expect(await screen.findByRole("heading", { name: "Registro de Buscas" })).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "Nuevo equipo" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Nombre del equipo/i)).not.toBeInTheDocument();
    // The leak: showTeamManager stayed true, so /beeper opened with the manager expanded.
    expect(screen.queryByLabelText("Equipo a gestionar")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Gestionar equipos" })).toHaveAttribute("aria-expanded", "false");
  });

  it("closes a half-open busca form when leaving /beeper/new", async () => {
    renderApp();
    await goTo("/beeper/new");
    fireEvent.click(await screen.findByRole("button", { name: "Nueva busca" }));
    expect(screen.getByRole("form", { name: "Nueva busca" })).toBeInTheDocument();

    await goTo("/beeper");

    expect(await screen.findByRole("heading", { name: "Registro de Buscas" })).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "Nueva busca" })).not.toBeInTheDocument();
  });

  it("focuses the chooser heading after AppShell moves focus, and Escape leaves to /beeper", async () => {
    renderApp();
    await goTo("/beeper");
    await screen.findByText("B-001");

    await goTo("/beeper/new");

    const heading = await screen.findByRole("heading", { name: "Nueva busca o equipo" });
    await waitFor(() => expect(heading).toHaveFocus());
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await waitFor(() => expect(router.state.location.pathname).toBe("/beeper"));
  });

  it("clears the search when leaving and re-entering /beeper", async () => {
    renderApp();
    await goTo("/beeper");
    await screen.findByText("B-001");
    fireEvent.change(screen.getByLabelText(/Buscar buscas/i), { target: { value: "zzz" } });
    await screen.findByText("Sin resultados");

    await goTo("/beeper/new");
    await screen.findByRole("heading", { name: "Nueva busca o equipo" });
    await goTo("/beeper");

    expect(await screen.findByText("B-001")).toBeInTheDocument();
    expect(screen.getByLabelText(/Buscar buscas/i)).toHaveValue("");
  });

  it("drops a team-scoped busca form opened on /beeper when entering /beeper/new", async () => {
    renderApp();
    await selectUciInManager();
    fireEvent.click(screen.getByRole("button", { name: "Nueva busca en UCI · 9001" }));
    expect(screen.getByRole("form", { name: "Nueva busca en UCI · 9001" })).toBeInTheDocument();

    await goTo("/beeper/new");

    expect(await screen.findByRole("button", { name: "Nuevo equipo" })).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: /Nueva busca/ })).not.toBeInTheDocument();
  });

  // Guards the chooser's create path itself (handleCreateNew() passes no team),
  // not the route-change reset.
  it("a busca created from the chooser is never linked to a team", async () => {
    renderApp();
    await goTo("/beeper/new");
    fireEvent.click(await screen.findByRole("button", { name: "Nueva busca" }));
    const form = screen.getByRole("form", { name: "Nueva busca" });
    fireEvent.change(screen.getByLabelText(/número de busca/i), { target: { value: "B-003" } });
    fireEvent.change(screen.getByLabelText(/asignado a/i), { target: { value: "Marta Ruiz" } });
    fireEvent.change(form.querySelector("#form-department")!, { target: { value: "Planta 2" } });
    fireEvent.change(form.querySelector("#form-role")!, { target: { value: "Auxiliar" } });
    fireEvent.submit(form);

    await waitFor(() => expect(window.hospitalDirectory.addBeeper).toHaveBeenCalled());
    await waitFor(() => expect(router.state.location.pathname).toBe("/beeper"));
    expect(window.hospitalDirectory.setBeeperTeamMembers).not.toHaveBeenCalled();
  });

  it("never offers an enabled 'Guardar equipo' again once a new team is saved", async () => {
    renderApp();
    await goTo("/beeper/new");
    fireEvent.click(await screen.findByRole("button", { name: "Nuevo equipo" }));
    fireEvent.change(screen.getByLabelText(/Nombre del equipo/i), { target: { value: "Quirófano" } });
    fireEvent.change(screen.getByLabelText(/Número del equipo/i), { target: { value: "9010" } });

    // The route commits in a transition after isSavingTeam clears. If the form is
    // still mounted in between, its save button is enabled and a second click
    // would create the team twice. Watch every DOM commit for that state.
    let savedButtonReEnabled = false;
    const observer = new MutationObserver(() => {
      const save = document.querySelector('form[aria-label="Nuevo equipo"] button[type="submit"]');
      if (save && !save.hasAttribute("disabled") && vi.mocked(window.hospitalDirectory.addBeeperTeam).mock.calls.length > 0) {
        savedButtonReEnabled = true;
      }
    });
    observer.observe(document.body, { subtree: true, childList: true, attributes: true });

    try {
      fireEvent.submit(screen.getByRole("form", { name: "Nuevo equipo" }));
      await waitFor(() => expect(router.state.location.pathname).toBe("/beeper"));
      await waitFor(() => expect(screen.queryByRole("form", { name: "Nuevo equipo" })).not.toBeInTheDocument());
    } finally {
      observer.disconnect();
    }

    expect(savedButtonReEnabled).toBe(false);
    expect(window.hospitalDirectory.addBeeperTeam).toHaveBeenCalledTimes(1);
  });

  it("returns to page 1 when coming back to /beeper", async () => {
    vi.mocked(window.hospitalDirectory.listBeepers).mockResolvedValue(
      Array.from({ length: 12 }, (_, index) => ({
        ...ana,
        id: `bsc_${String(index + 1).padStart(3, "0")}`,
        deviceNumber: `B-${String(index + 1).padStart(3, "0")}`
      }))
    );
    renderApp();
    await goTo("/beeper");
    await screen.findByText("Página 1 de 2");
    fireEvent.click(screen.getByRole("button", { name: "Página siguiente" }));
    expect(screen.getByText("Página 2 de 2")).toBeInTheDocument();

    await goTo("/beeper/new");
    await screen.findByRole("heading", { name: "Nueva busca o equipo" });
    await goTo("/beeper");

    expect(await screen.findByText("Página 1 de 2")).toBeInTheDocument();
  });
});
