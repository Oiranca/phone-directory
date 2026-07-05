import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DirectoryPage } from "./DirectoryPage";
import { useAppStore, resetBootstrapInFlight } from "../store/useAppStore";
import { defaultContacts } from "../../shared/fixtures/defaultContacts";

const resetStore = () => {
  resetBootstrapInFlight();
  useAppStore.setState({
    contacts: null,
    settings: null,
    recovery: null,
    selectedRecordId: null,
    query: "",
    selectedType: "all",
    selectedArea: "all",
    selectedTags: [],
    showInactive: false,
    isLoading: true,
    bootstrapStatus: "idle",
    bootstrapError: "",
    bootstrapHelp: ""
  });
};

describe("DirectoryPage", () => {
  beforeEach(() => {
    resetStore();
    Object.defineProperty(window, "hospitalDirectory", {
      configurable: true,
      value: {
        getBootstrapData: vi.fn(),
        saveSettings: vi.fn(),
        createBackup: vi.fn(),
        createRecord: vi.fn(),
        updateRecord: vi.fn()
      }
    });
  });

  afterEach(() => {
    cleanup();
  });

  const renderPage = () =>
    render(
      <MemoryRouter
        future={{
          v7_startTransition: true,
          v7_relativeSplatPath: true
        }}
      >
        <DirectoryPage />
      </MemoryRouter>
    );

  const chooseOption = async (label: string, optionLabel: string) => {
    fireEvent.click(screen.getByLabelText(label));
    fireEvent.click(await screen.findByRole("option", { name: optionLabel }));
  };

  it("shows a loading state while bootstrap is in progress", async () => {
    let resolveBootstrap: ((value: Awaited<ReturnType<typeof window.hospitalDirectory.getBootstrapData>>) => void) | null = null;
    window.hospitalDirectory.getBootstrapData = vi.fn().mockImplementation(
      () => new Promise((resolve) => { resolveBootstrap = resolve; })
    );

    renderPage();

    expect(screen.getByRole("status")).toHaveTextContent("Cargando datos locales");

    resolveBootstrap?.({ contacts: defaultContacts, settings: { editorName: "", dataFilePath: "/tmp/data/contacts.json", backupDirectoryPath: "/tmp/backups", ui: { showInactiveByDefault: false } } });
    expect(await screen.findByLabelText("Buscar contactos")).toBeInTheDocument();
  });

  it("loads records after a successful bootstrap request", async () => {
    window.hospitalDirectory.getBootstrapData = vi.fn().mockResolvedValue({
      contacts: defaultContacts,
      settings: {
        editorName: "",
        dataFilePath: "/tmp/data/contacts.json",
        backupDirectoryPath: "/tmp/backups",
        ui: {
          showInactiveByDefault: false
        }
      }
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Búsqueda de contactos" })).toBeInTheDocument();
      expect(screen.getByLabelText("Buscar contactos")).toBeInTheDocument();
    });
    expect(screen.getByRole("status")).toHaveTextContent("2 resultados");
  });

  it("announces result counts as a polite atomic status update", async () => {
    const contacts = structuredClone(defaultContacts);
    contacts.records.push({
      ...structuredClone(defaultContacts.records[0]),
      id: "control-record",
      displayName: "Control de planta",
      type: "control",
      status: "active"
    });

    window.hospitalDirectory.getBootstrapData = vi.fn().mockResolvedValue({
      contacts,
      settings: {
        editorName: "",
        dataFilePath: "/tmp/data/contacts.json",
        backupDirectoryPath: "/tmp/backups",
        ui: {
          showInactiveByDefault: false
        }
      }
    });

    renderPage();

    expect(await screen.findByLabelText("Buscar contactos")).toBeInTheDocument();

    const resultCount = screen.getByRole("status");
    expect(resultCount).toHaveAttribute("aria-live", "polite");
    expect(resultCount).toHaveAttribute("aria-atomic", "true");
    expect(resultCount).toHaveTextContent("3 resultados");

    await chooseOption("Tipo", "Control");

    expect(screen.getByRole("status")).toHaveTextContent("1 resultados");
  });

  it("calls ensureBootstrapLoaded on mount (direct route entry)", async () => {
    window.hospitalDirectory.getBootstrapData = vi.fn().mockResolvedValue({
      contacts: defaultContacts,
      settings: {
        editorName: "",
        dataFilePath: "/tmp/data/contacts.json",
        backupDirectoryPath: "/tmp/backups",
        ui: { showInactiveByDefault: false }
      }
    });

    renderPage();

    expect(await screen.findByLabelText("Buscar contactos")).toBeInTheDocument();
    expect(window.hospitalDirectory.getBootstrapData).toHaveBeenCalledTimes(1);
  });

  it("does not reload bootstrap when navigating back to the page (already loaded)", async () => {
    // Pre-load bootstrap in the store so bootstrapStatus is "success"
    useAppStore.setState({
      contacts: defaultContacts,
      settings: { editorName: "", dataFilePath: "/tmp/data/contacts.json", backupDirectoryPath: "/tmp/backups", ui: { showInactiveByDefault: false } },
      isLoading: false,
      bootstrapStatus: "success",
      bootstrapError: "",
      bootstrapHelp: ""
    });

    renderPage();

    // Page renders immediately from store — no IPC call
    expect(await screen.findByLabelText("Buscar contactos")).toBeInTheDocument();
    expect(window.hospitalDirectory.getBootstrapData).not.toHaveBeenCalled();
  });

  it("filters by type and can reveal inactive records", async () => {
    const contacts = structuredClone(defaultContacts);
    contacts.records.push({
      ...structuredClone(defaultContacts.records[0]),
      id: "inactive-record",
      displayName: "Control de Noche",
      type: "control",
      status: "inactive"
    });

    window.hospitalDirectory.getBootstrapData = vi.fn().mockResolvedValue({
      contacts,
      settings: {
        editorName: "",
        dataFilePath: "/tmp/data/contacts.json",
        backupDirectoryPath: "/tmp/backups",
        ui: {
          showInactiveByDefault: false
        }
      }
    });

    renderPage();

    expect(await screen.findByLabelText("Buscar contactos")).toBeInTheDocument();
    expect(screen.queryByText("Control de Noche")).not.toBeInTheDocument();

    await chooseOption("Tipo", "Control");
    fireEvent.click(screen.getByRole("checkbox", { name: /mostrar inactivos/i }));

    expect((await screen.findAllByText("Control de Noche")).length).toBeGreaterThan(0);
  });

  it("filters by tag and shows the active tag pill", async () => {
    const contacts = structuredClone(defaultContacts);
    contacts.records.push({
      ...structuredClone(defaultContacts.records[1]),
      id: "urgencias-record",
      displayName: "Urgencias central",
      tags: ["urgencias"]
    });

    window.hospitalDirectory.getBootstrapData = vi.fn().mockResolvedValue({
      contacts,
      settings: {
        editorName: "",
        dataFilePath: "/tmp/data/contacts.json",
        backupDirectoryPath: "/tmp/backups",
        ui: {
          showInactiveByDefault: false
        }
      }
    });

    renderPage();

    expect(await screen.findByLabelText("Buscar contactos")).toBeInTheDocument();

    await chooseOption("Etiqueta", "admisión");

    expect(screen.getByRole("status")).toHaveTextContent("1 resultados");
    expect(screen.getByText("#admisión")).toBeInTheDocument();
    expect(screen.queryByText("Urgencias central")).not.toBeInTheDocument();
  });

  it("filter-chip clear buttons carry the shared touch-target class for a 44px hit area", async () => {
    window.hospitalDirectory.getBootstrapData = vi.fn().mockResolvedValue({
      contacts: defaultContacts,
      settings: {
        editorName: "",
        dataFilePath: "/tmp/data/contacts.json",
        backupDirectoryPath: "/tmp/backups",
        ui: {
          showInactiveByDefault: false
        }
      }
    });

    renderPage();

    expect(await screen.findByLabelText("Buscar contactos")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Buscar contactos"), {
      target: { value: "admisión" }
    });

    const clearButton = await screen.findByRole("button", { name: "Eliminar filtro: búsqueda" });
    expect(clearButton).toHaveClass("touch-target");
  });

  it("clears selected tags when filter pills are reset", async () => {
    window.hospitalDirectory.getBootstrapData = vi.fn().mockResolvedValue({
      contacts: defaultContacts,
      settings: {
        editorName: "",
        dataFilePath: "/tmp/data/contacts.json",
        backupDirectoryPath: "/tmp/backups",
        ui: {
          showInactiveByDefault: false
        }
      }
    });

    renderPage();

    expect(await screen.findByLabelText("Buscar contactos")).toBeInTheDocument();

    await chooseOption("Etiqueta", "admisión");
    fireEvent.click(screen.getByRole("button", { name: "Limpiar" }));

    expect(screen.queryByText("#admisión")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("2 resultados");
  });

  it("clears the search text when filter pills are reset", async () => {
    window.hospitalDirectory.getBootstrapData = vi.fn().mockResolvedValue({
      contacts: defaultContacts,
      settings: {
        editorName: "",
        dataFilePath: "/tmp/data/contacts.json",
        backupDirectoryPath: "/tmp/backups",
        ui: {
          showInactiveByDefault: false
        }
      }
    });

    renderPage();

    const searchInput = await screen.findByLabelText("Buscar contactos");
    fireEvent.change(searchInput, { target: { value: "admisión" } });

    expect(screen.getByRole("status")).toHaveTextContent("1 resultados");

    fireEvent.click(screen.getByRole("button", { name: "Limpiar" }));

    expect(searchInput).toHaveValue("");
    expect(screen.getByRole("status")).toHaveTextContent("2 resultados");
  });

  it("clears both a tag filter and search text together in a single click", async () => {
    window.hospitalDirectory.getBootstrapData = vi.fn().mockResolvedValue({
      contacts: defaultContacts,
      settings: {
        editorName: "",
        dataFilePath: "/tmp/data/contacts.json",
        backupDirectoryPath: "/tmp/backups",
        ui: {
          showInactiveByDefault: false
        }
      }
    });

    renderPage();

    const searchInput = await screen.findByLabelText("Buscar contactos");

    await chooseOption("Etiqueta", "admisión");
    fireEvent.change(searchInput, { target: { value: "admisión" } });

    expect(screen.getByText("#admisión")).toBeInTheDocument();
    expect(searchInput).toHaveValue("admisión");
    expect(screen.getByRole("status")).toHaveTextContent("1 resultados");

    fireEvent.click(screen.getByRole("button", { name: "Limpiar" }));

    expect(screen.queryByText("#admisión")).not.toBeInTheDocument();
    expect(searchInput).toHaveValue("");
    expect(screen.getByRole("status")).toHaveTextContent("2 resultados");
  });

  it("clears only the targeted filter when each per-filter clear button is used in isolation", async () => {
    window.hospitalDirectory.getBootstrapData = vi.fn().mockResolvedValue({
      contacts: defaultContacts,
      settings: {
        editorName: "",
        dataFilePath: "/tmp/data/contacts.json",
        backupDirectoryPath: "/tmp/backups",
        ui: {
          showInactiveByDefault: false
        }
      }
    });

    renderPage();

    const searchInput = await screen.findByLabelText("Buscar contactos");

    fireEvent.change(searchInput, { target: { value: "admisión" } });
    await chooseOption("Tipo", "Servicio");
    await chooseOption("Área", "Gestión y administración");
    await chooseOption("Etiqueta", "admisión");
    fireEvent.click(screen.getByRole("checkbox", { name: /mostrar inactivos/i }));

    expect(useAppStore.getState().query).toBe("admisión");
    expect(useAppStore.getState().selectedType).toBe("service");
    expect(useAppStore.getState().selectedArea).toBe("gestion-administracion");
    expect(useAppStore.getState().selectedTags).toEqual(["admisión"]);
    expect(useAppStore.getState().showInactive).toBe(true);
    expect(screen.getByRole("button", { name: "Eliminar filtro: búsqueda" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Eliminar filtro: Servicio" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Eliminar filtro: Gestión y administración" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Eliminar filtro: admisión" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Eliminar filtro: Inactivos" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Eliminar filtro: búsqueda" }));

    expect(searchInput).toHaveValue("");
    expect(useAppStore.getState().query).toBe("");
    expect(screen.queryByRole("button", { name: "Eliminar filtro: búsqueda" })).not.toBeInTheDocument();
    expect(useAppStore.getState().selectedType).toBe("service");
    expect(useAppStore.getState().selectedArea).toBe("gestion-administracion");
    expect(useAppStore.getState().selectedTags).toEqual(["admisión"]);
    expect(useAppStore.getState().showInactive).toBe(true);
    expect(screen.getByRole("button", { name: "Eliminar filtro: Servicio" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Eliminar filtro: Gestión y administración" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Eliminar filtro: admisión" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Eliminar filtro: Inactivos" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Eliminar filtro: Servicio" }));

    expect(useAppStore.getState().selectedType).toBe("all");
    expect(screen.queryByRole("button", { name: "Eliminar filtro: Servicio" })).not.toBeInTheDocument();
    expect(useAppStore.getState().selectedArea).toBe("gestion-administracion");
    expect(useAppStore.getState().selectedTags).toEqual(["admisión"]);
    expect(useAppStore.getState().showInactive).toBe(true);
    expect(screen.getByRole("button", { name: "Eliminar filtro: Gestión y administración" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Eliminar filtro: admisión" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Eliminar filtro: Inactivos" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Eliminar filtro: Gestión y administración" }));

    expect(useAppStore.getState().selectedArea).toBe("all");
    expect(screen.queryByRole("button", { name: "Eliminar filtro: Gestión y administración" })).not.toBeInTheDocument();
    expect(useAppStore.getState().selectedTags).toEqual(["admisión"]);
    expect(useAppStore.getState().showInactive).toBe(true);
    expect(screen.getByRole("button", { name: "Eliminar filtro: admisión" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Eliminar filtro: Inactivos" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Eliminar filtro: admisión" }));

    expect(useAppStore.getState().selectedTags).toEqual([]);
    expect(screen.queryByRole("button", { name: "Eliminar filtro: admisión" })).not.toBeInTheDocument();
    expect(useAppStore.getState().showInactive).toBe(true);
    expect(screen.getByRole("button", { name: "Eliminar filtro: Inactivos" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Eliminar filtro: Inactivos" }));

    expect(useAppStore.getState().showInactive).toBe(false);
    expect(screen.queryByRole("button", { name: "Eliminar filtro: Inactivos" })).not.toBeInTheDocument();
  });

  it("de-duplicates tag options with the same normalized value", async () => {
    const contacts = structuredClone(defaultContacts);
    contacts.records.push({
      ...structuredClone(defaultContacts.records[1]),
      id: "admission-uppercase",
      displayName: "Admisión alternativa",
      tags: ["Admisión"]
    });

    window.hospitalDirectory.getBootstrapData = vi.fn().mockResolvedValue({
      contacts,
      settings: {
        editorName: "",
        dataFilePath: "/tmp/data/contacts.json",
        backupDirectoryPath: "/tmp/backups",
        ui: {
          showInactiveByDefault: false
        }
      }
    });

    renderPage();

    expect(await screen.findByLabelText("Buscar contactos")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Etiqueta"));

    expect(screen.getAllByRole("option", { name: "admisión" })).toHaveLength(1);
  });

  it("clears stale selected tags when the current dataset no longer exposes them", async () => {
    useAppStore.setState({ selectedTags: ["admisión"] });

    const contacts = structuredClone(defaultContacts);
    contacts.records = contacts.records.map((record) => ({ ...record, tags: [] }));

    window.hospitalDirectory.getBootstrapData = vi.fn().mockResolvedValue({
      contacts,
      settings: {
        editorName: "",
        dataFilePath: "/tmp/data/contacts.json",
        backupDirectoryPath: "/tmp/backups",
        ui: {
          showInactiveByDefault: false
        }
      }
    });

    renderPage();

    expect(await screen.findByLabelText("Buscar contactos")).toBeInTheDocument();

    await waitFor(() => {
      expect(useAppStore.getState().selectedTags).toEqual([]);
    });
  });

  it("re-maps selected tags to the current canonical option label", async () => {
    const contacts = structuredClone(defaultContacts);
    contacts.records[0]!.tags = ["admisión"];
    const settings = {
      editorName: "",
      dataFilePath: "/tmp/data/contacts.json",
      backupDirectoryPath: "/tmp/backups",
      ui: {
        showInactiveByDefault: false
      }
    };

    useAppStore.setState({
      contacts,
      settings,
      selectedTags: ["Admisión"],
      selectedRecordId: contacts.records[0]!.id,
      isLoading: false,
      bootstrapStatus: "success",
      bootstrapError: "",
      bootstrapHelp: ""
    });

    renderPage();

    expect(await screen.findByLabelText("Buscar contactos")).toBeInTheDocument();

    await waitFor(() => {
      expect(useAppStore.getState().selectedTags).toEqual(["admisión"]);
    });
  });

  it("shows privacy-only pills in the detail header for sensitive phones", async () => {
    const contacts = structuredClone(defaultContacts);
    contacts.records[0]!.contactMethods.phones[0]!.confidential = true;

    window.hospitalDirectory.getBootstrapData = vi.fn().mockResolvedValue({
      contacts,
      settings: {
        editorName: "",
        dataFilePath: "/tmp/data/contacts.json",
        backupDirectoryPath: "/tmp/backups",
        ui: {
          showInactiveByDefault: false
        }
      }
    });

    renderPage();

    expect(await screen.findByLabelText("Buscar contactos")).toBeInTheDocument();
    expect(screen.getAllByText("Confidencial").length).toBeGreaterThan(0);
    expect(screen.queryByText("No facilitar a pacientes")).not.toBeInTheDocument();
    expect(screen.queryByText("No pacientes")).not.toBeInTheDocument();
    expect(screen.queryByText("Trata este registro como información de uso interno y confirma el contexto antes de compartirlo.")).not.toBeInTheDocument();
    expect(screen.queryByText("Ubicación disponible")).not.toBeInTheDocument();
  });

  it("no longer renders the Unidad/Servicio/Área card in the contact detail view", async () => {
    const contacts = structuredClone(defaultContacts);

    useAppStore.setState({
      contacts,
      settings: {
        editorName: "",
        dataFilePath: "/tmp/data/contacts.json",
        backupDirectoryPath: "/tmp/backups",
        ui: {
          showInactiveByDefault: false
        }
      },
      selectedRecordId: contacts.records[1]!.id,
      isLoading: false,
      bootstrapStatus: "success",
      bootstrapError: "",
      bootstrapHelp: ""
    });

    renderPage();

    const detail = await screen.findByRole("region", { name: "Detalle del registro seleccionado" });

    expect(within(detail).queryByText("Unidad")).not.toBeInTheDocument();
    expect(within(detail).queryByText("Servicio")).not.toBeInTheDocument();
    expect(within(detail).queryByText("Área")).not.toBeInTheDocument();
  });

  it("shows the Ubicación card with location data when present", async () => {
    const contacts = structuredClone(defaultContacts);

    useAppStore.setState({
      contacts,
      settings: {
        editorName: "",
        dataFilePath: "/tmp/data/contacts.json",
        backupDirectoryPath: "/tmp/backups",
        ui: {
          showInactiveByDefault: false
        }
      },
      selectedRecordId: contacts.records[1]!.id,
      isLoading: false,
      bootstrapStatus: "success",
      bootstrapError: "",
      bootstrapHelp: ""
    });

    renderPage();

    const detail = await screen.findByRole("region", { name: "Detalle del registro seleccionado" });

    expect(within(detail).getByText("Ubicación")).toBeInTheDocument();
    expect(within(detail).getByText("Avenida de ejemplo, 10")).toBeInTheDocument();
  });

  it("shows the Ubicación card with a placeholder when no location data is present", async () => {
    const contacts = structuredClone(defaultContacts);

    useAppStore.setState({
      contacts,
      settings: {
        editorName: "",
        dataFilePath: "/tmp/data/contacts.json",
        backupDirectoryPath: "/tmp/backups",
        ui: {
          showInactiveByDefault: false
        }
      },
      selectedRecordId: contacts.records[0]!.id,
      isLoading: false,
      bootstrapStatus: "success",
      bootstrapError: "",
      bootstrapHelp: ""
    });

    renderPage();

    const detail = await screen.findByRole("region", { name: "Detalle del registro seleccionado" });

    expect(within(detail).getByText("Ubicación")).toBeInTheDocument();
    expect(within(detail).getByText("Sin ubicación detallada")).toBeInTheDocument();
  });

  it("limits result-card risk text to the visible phone while keeping detail warnings", async () => {
    const contacts = structuredClone(defaultContacts);
    contacts.records[0]!.contactMethods.phones = [
      {
        id: "primary-safe",
        label: "Principal",
        number: "70005",
        kind: "internal",
        isPrimary: true,
        confidential: false,
        noPatientSharing: false
      },
      {
        id: "secondary-sensitive",
        label: "Interno",
        number: "70006",
        kind: "internal",
        isPrimary: false,
        confidential: true,
        noPatientSharing: true
      }
    ];

    window.hospitalDirectory.getBootstrapData = vi.fn().mockResolvedValue({
      contacts,
      settings: {
        editorName: "",
        dataFilePath: "/tmp/data/contacts.json",
        backupDirectoryPath: "/tmp/backups",
        ui: {
          showInactiveByDefault: false
        }
      }
    });

    renderPage();

    expect(await screen.findByLabelText("Buscar contactos")).toBeInTheDocument();
    expect(screen.queryByText("Número interno confidencial.")).not.toBeInTheDocument();
    expect(screen.queryByText("No compartir con pacientes.")).not.toBeInTheDocument();
    expect(screen.queryByText("No compartas este contacto con pacientes ni acompañantes.")).not.toBeInTheDocument();
  });

  it("exposes selected result state programmatically", async () => {
    window.hospitalDirectory.getBootstrapData = vi.fn().mockResolvedValue({
      contacts: defaultContacts,
      settings: {
        editorName: "",
        dataFilePath: "/tmp/data/contacts.json",
        backupDirectoryPath: "/tmp/backups",
        ui: {
          showInactiveByDefault: false
        }
      }
    });

    renderPage();

    expect(await screen.findByLabelText("Buscar contactos")).toBeInTheDocument();

    const selectedButton = screen.getByRole("button", { name: /admisión general/i });
    expect(selectedButton).toHaveAttribute("aria-pressed", "true");
  });

  it("caps visible results to ten per page and exposes pagination", async () => {
    const contacts = structuredClone(defaultContacts);

    for (let index = 0; index < 9; index += 1) {
      contacts.records.push({
        ...structuredClone(defaultContacts.records[0]),
        id: `extra-record-${index}`,
        displayName: `Registro extra ${index + 1}`
      });
    }

    window.hospitalDirectory.getBootstrapData = vi.fn().mockResolvedValue({
      contacts,
      settings: {
        editorName: "",
        dataFilePath: "/tmp/data/contacts.json",
        backupDirectoryPath: "/tmp/backups",
        ui: {
          showInactiveByDefault: false
        }
      }
    });

    renderPage();

    expect(await screen.findByLabelText("Buscar contactos")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ir a la página 2" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Página anterior" })).toHaveClass("focus-ring");
    expect(screen.queryByText("Registro extra 9")).not.toBeInTheDocument();
  });

  // OIR-218: layout/scroll polish — filter bar stays visible while scrolling
  // (sticky), and the results list / detail panel are bounded to the viewport
  // (overflow-y-auto) instead of growing the page indefinitely.
  it("keeps the filter bar sticky and bounds the results list/detail panel height", async () => {
    window.hospitalDirectory.getBootstrapData = vi.fn().mockResolvedValue({
      contacts: defaultContacts,
      settings: {
        editorName: "",
        dataFilePath: "/tmp/data/contacts.json",
        backupDirectoryPath: "/tmp/backups",
        ui: { showInactiveByDefault: false }
      }
    });

    renderPage();

    expect(await screen.findByLabelText("Buscar contactos")).toBeInTheDocument();

    const searchInput = screen.getByLabelText("Buscar contactos");
    const filterBar = searchInput.closest("div.sticky");
    expect(filterBar).toHaveClass("sticky");

    const resultsList = screen.getByRole("list", { name: "Resultados del directorio" });
    expect(resultsList).toHaveClass("overflow-y-auto");

    const detailPanel = screen.getByRole("heading", { name: "Detalle del registro" }).closest("div.overflow-y-auto");
    expect(detailPanel).not.toBeNull();
  });

  it("announces the empty result state as a status update", async () => {
    window.hospitalDirectory.getBootstrapData = vi.fn().mockResolvedValue({
      contacts: defaultContacts,
      settings: {
        editorName: "",
        dataFilePath: "/tmp/data/contacts.json",
        backupDirectoryPath: "/tmp/backups",
        ui: {
          showInactiveByDefault: false
        }
      }
    });

    renderPage();

    expect(await screen.findByLabelText("Buscar contactos")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Buscar contactos"), {
      target: { value: "sin-coincidencias" }
    });

    expect(await screen.findByText("No se han encontrado resultados para esta búsqueda.")).toHaveAttribute("role", "status");

    // The result count stays a polite live region even at zero results so
    // "0 resultados" is announced alongside the empty-state panel.
    const statusRegions = screen.getAllByRole("status");
    expect(statusRegions).toHaveLength(2);
    const countRegion = statusRegions.find((region) => region.textContent?.includes("0 resultados"));
    expect(countRegion).toBeDefined();
    expect(countRegion).toHaveAttribute("aria-live", "polite");
    expect(countRegion).toHaveAttribute("aria-atomic", "true");
  });

  it("moves selection to the new page when pagination changes", async () => {
    const contacts = structuredClone(defaultContacts);

    for (let index = 0; index < 9; index += 1) {
      contacts.records.push({
        ...structuredClone(defaultContacts.records[0]),
        id: `paged-record-${index}`,
        displayName: `Paginado ${index + 1}`
      });
    }

    window.hospitalDirectory.getBootstrapData = vi.fn().mockResolvedValue({
      contacts,
      settings: {
        editorName: "",
        dataFilePath: "/tmp/data/contacts.json",
        backupDirectoryPath: "/tmp/backups",
        ui: {
          showInactiveByDefault: false
        }
      }
    });

    renderPage();

    expect(await screen.findByLabelText("Buscar contactos")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Ir a la página 2" }));

    // With RESULTS_PER_PAGE=10 and 11 total records (2 defaultContacts + 9 extras),
    // page 2 contains only "Paginado 9" which is auto-selected as the first record.
    const selectedOption = screen.getByRole("button", { name: /paginado 9/i });
    expect(selectedOption).toHaveAttribute("aria-pressed", "true");
  });

  it("Arrow Down moves selection to the next record in the list", async () => {
    window.hospitalDirectory.getBootstrapData = vi.fn().mockResolvedValue({
      contacts: defaultContacts,
      settings: {
        editorName: "",
        dataFilePath: "/tmp/data/contacts.json",
        backupDirectoryPath: "/tmp/backups",
        ui: { showInactiveByDefault: false }
      }
    });

    renderPage();

    await screen.findByRole("list", { name: "Resultados del directorio" });

    // First record should be selected by default
    const firstButton = screen.getByRole("button", { name: /admisión general/i });
    expect(firstButton).toHaveAttribute("aria-pressed", "true");

    firstButton.focus();
    fireEvent.keyDown(firstButton, { key: "ArrowDown" });

    const secondButton = screen.getByRole("button", { name: /centro de salud demo/i });
    expect(secondButton).toHaveAttribute("aria-pressed", "true");
    expect(firstButton).toHaveAttribute("aria-pressed", "false");
  });

  it("Arrow Up moves selection to the previous record in the list", async () => {
    window.hospitalDirectory.getBootstrapData = vi.fn().mockResolvedValue({
      contacts: defaultContacts,
      settings: {
        editorName: "",
        dataFilePath: "/tmp/data/contacts.json",
        backupDirectoryPath: "/tmp/backups",
        ui: { showInactiveByDefault: false }
      }
    });

    renderPage();

    await screen.findByRole("list", { name: "Resultados del directorio" });

    // Move to second record first
    const firstButton = screen.getByRole("button", { name: /admisión general/i });
    firstButton.focus();
    fireEvent.keyDown(firstButton, { key: "ArrowDown" });
    const secondButton = screen.getByRole("button", { name: /centro de salud demo/i });
    expect(secondButton).toHaveAttribute("aria-pressed", "true");

    // Now move back up
    secondButton.focus();
    fireEvent.keyDown(secondButton, { key: "ArrowUp" });
    expect(firstButton).toHaveAttribute("aria-pressed", "true");
    expect(secondButton).toHaveAttribute("aria-pressed", "false");
  });

  it("Arrow Down wraps from last to first record", async () => {
    window.hospitalDirectory.getBootstrapData = vi.fn().mockResolvedValue({
      contacts: defaultContacts,
      settings: {
        editorName: "",
        dataFilePath: "/tmp/data/contacts.json",
        backupDirectoryPath: "/tmp/backups",
        ui: { showInactiveByDefault: false }
      }
    });

    renderPage();

    await screen.findByRole("list", { name: "Resultados del directorio" });

    // Move to last record (index 1 of 2)
    const firstButton = screen.getByRole("button", { name: /admisión general/i });
    firstButton.focus();
    fireEvent.keyDown(firstButton, { key: "ArrowDown" });
    // Wrap back to first
    const secondButton = screen.getByRole("button", { name: /centro de salud demo/i });
    secondButton.focus();
    fireEvent.keyDown(secondButton, { key: "ArrowDown" });

    expect(firstButton).toHaveAttribute("aria-pressed", "true");
  });

  it("Arrow Up wraps from first to last record", async () => {
    window.hospitalDirectory.getBootstrapData = vi.fn().mockResolvedValue({
      contacts: defaultContacts,
      settings: {
        editorName: "",
        dataFilePath: "/tmp/data/contacts.json",
        backupDirectoryPath: "/tmp/backups",
        ui: { showInactiveByDefault: false }
      }
    });

    renderPage();

    await screen.findByRole("list", { name: "Resultados del directorio" });

    // First record is selected; Arrow Up should wrap to last
    const firstButton = screen.getByRole("button", { name: /admisión general/i });
    firstButton.focus();
    fireEvent.keyDown(firstButton, { key: "ArrowUp" });

    const lastButton = screen.getByRole("button", { name: /centro de salud demo/i });
    expect(lastButton).toHaveAttribute("aria-pressed", "true");
  });

  it("Home key jumps selection to the first record in the list", async () => {
    window.hospitalDirectory.getBootstrapData = vi.fn().mockResolvedValue({
      contacts: defaultContacts,
      settings: {
        editorName: "",
        dataFilePath: "/tmp/data/contacts.json",
        backupDirectoryPath: "/tmp/backups",
        ui: { showInactiveByDefault: false }
      }
    });

    renderPage();

    await screen.findByRole("list", { name: "Resultados del directorio" });

    // Move to the last record first
    const firstButton = screen.getByRole("button", { name: /admisión general/i });
    firstButton.focus();
    fireEvent.keyDown(firstButton, { key: "ArrowDown" });
    const secondButton = screen.getByRole("button", { name: /centro de salud demo/i });
    expect(secondButton).toHaveAttribute("aria-pressed", "true");

    // Home jumps back to the first record
    secondButton.focus();
    fireEvent.keyDown(secondButton, { key: "Home" });
    expect(firstButton).toHaveAttribute("aria-pressed", "true");
    expect(secondButton).toHaveAttribute("aria-pressed", "false");
  });

  it("End key jumps selection to the last record in the list", async () => {
    window.hospitalDirectory.getBootstrapData = vi.fn().mockResolvedValue({
      contacts: defaultContacts,
      settings: {
        editorName: "",
        dataFilePath: "/tmp/data/contacts.json",
        backupDirectoryPath: "/tmp/backups",
        ui: { showInactiveByDefault: false }
      }
    });

    renderPage();

    await screen.findByRole("list", { name: "Resultados del directorio" });

    // First record is selected by default; End jumps to the last record
    const firstButton = screen.getByRole("button", { name: /admisión general/i });
    firstButton.focus();
    fireEvent.keyDown(firstButton, { key: "End" });

    const lastButton = screen.getByRole("button", { name: /centro de salud demo/i });
    expect(lastButton).toHaveAttribute("aria-pressed", "true");
    expect(firstButton).toHaveAttribute("aria-pressed", "false");
  });

  it("Enter key does not change selection but does not throw", async () => {
    window.hospitalDirectory.getBootstrapData = vi.fn().mockResolvedValue({
      contacts: defaultContacts,
      settings: {
        editorName: "",
        dataFilePath: "/tmp/data/contacts.json",
        backupDirectoryPath: "/tmp/backups",
        ui: { showInactiveByDefault: false }
      }
    });

    renderPage();

    await screen.findByRole("list", { name: "Resultados del directorio" });

    const firstButton = screen.getByRole("button", { name: /admisión general/i });
    expect(firstButton).toHaveAttribute("aria-pressed", "true");

    // Enter should confirm/keep selection without changing it
    firstButton.focus();
    fireEvent.keyDown(firstButton, { key: "Enter" });

    expect(firstButton).toHaveAttribute("aria-pressed", "true");
  });

  it("keyboard nav updates selectedRecordId in the store correctly", async () => {
    window.hospitalDirectory.getBootstrapData = vi.fn().mockResolvedValue({
      contacts: defaultContacts,
      settings: {
        editorName: "",
        dataFilePath: "/tmp/data/contacts.json",
        backupDirectoryPath: "/tmp/backups",
        ui: { showInactiveByDefault: false }
      }
    });

    renderPage();

    await screen.findByRole("list", { name: "Resultados del directorio" });

    const initialId = useAppStore.getState().selectedRecordId;
    expect(initialId).toBe(defaultContacts.records[0]!.id);

    const firstButton = screen.getByRole("button", { name: /admisión general/i });
    firstButton.focus();
    fireEvent.keyDown(firstButton, { key: "ArrowDown" });

    await waitFor(() => {
      expect(useAppStore.getState().selectedRecordId).toBe(defaultContacts.records[1]!.id);
    });
  });

  it("mouse click still selects a record and overrides keyboard selection", async () => {
    window.hospitalDirectory.getBootstrapData = vi.fn().mockResolvedValue({
      contacts: defaultContacts,
      settings: {
        editorName: "",
        dataFilePath: "/tmp/data/contacts.json",
        backupDirectoryPath: "/tmp/backups",
        ui: { showInactiveByDefault: false }
      }
    });

    renderPage();

    await screen.findByRole("list", { name: "Resultados del directorio" });

    // Move to second via keyboard
    const firstButton = screen.getByRole("button", { name: /admisión general/i });
    firstButton.focus();
    fireEvent.keyDown(firstButton, { key: "ArrowDown" });
    const secondButton = screen.getByRole("button", { name: /centro de salud demo/i });
    expect(secondButton).toHaveAttribute("aria-pressed", "true");

    // Click first via mouse
    fireEvent.click(firstButton);
    expect(firstButton).toHaveAttribute("aria-pressed", "true");
    expect(secondButton).toHaveAttribute("aria-pressed", "false");
  });

  it("detail panel is wrapped in a region landmark with accessible label", async () => {
    window.hospitalDirectory.getBootstrapData = vi.fn().mockResolvedValue({
      contacts: defaultContacts,
      settings: {
        editorName: "",
        dataFilePath: "/tmp/data/contacts.json",
        backupDirectoryPath: "/tmp/backups",
        ui: { showInactiveByDefault: false }
      }
    });

    renderPage();

    expect(await screen.findByLabelText("Buscar contactos")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Detalle del registro seleccionado" })).toBeInTheDocument();
  });

  it("edit action exposes a contextual aria-label with the selected contact's name", async () => {
    window.hospitalDirectory.getBootstrapData = vi.fn().mockResolvedValue({
      contacts: defaultContacts,
      settings: {
        editorName: "",
        dataFilePath: "/tmp/data/contacts.json",
        backupDirectoryPath: "/tmp/backups",
        ui: { showInactiveByDefault: false }
      }
    });

    renderPage();

    expect(await screen.findByLabelText("Buscar contactos")).toBeInTheDocument();

    const firstRecord = defaultContacts.records[0]!;
    const editLink = screen.getByRole("link", { name: `Editar registro: ${firstRecord.displayName}` });
    expect(editLink).toHaveAttribute("href", `/contacts/${firstRecord.id}/edit`);
    expect(editLink).toHaveTextContent("Editar registro");
  });

  it("empty detail state icon is hidden from assistive technology", async () => {
    window.hospitalDirectory.getBootstrapData = vi.fn().mockResolvedValue({
      contacts: defaultContacts,
      settings: {
        editorName: "",
        dataFilePath: "/tmp/data/contacts.json",
        backupDirectoryPath: "/tmp/backups",
        ui: { showInactiveByDefault: false }
      }
    });

    renderPage();

    expect(await screen.findByLabelText("Buscar contactos")).toBeInTheDocument();

    // A query with no matches clears the selection, revealing the empty detail state.
    fireEvent.change(screen.getByLabelText("Buscar contactos"), {
      target: { value: "sin-coincidencias" }
    });

    const emptyDetail = (await screen.findByText("Selecciona un registro")).closest("div");
    const icon = emptyDetail?.querySelector("svg");
    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute("aria-hidden", "true");
  });

  it("selected record name is rendered as an h4 heading", async () => {
    window.hospitalDirectory.getBootstrapData = vi.fn().mockResolvedValue({
      contacts: defaultContacts,
      settings: {
        editorName: "",
        dataFilePath: "/tmp/data/contacts.json",
        backupDirectoryPath: "/tmp/backups",
        ui: { showInactiveByDefault: false }
      }
    });

    renderPage();

    expect(await screen.findByLabelText("Buscar contactos")).toBeInTheDocument();
    const heading = screen.getByRole("heading", { name: /admisión general/i, level: 4 });
    expect(heading).toBeInTheDocument();
    expect(heading.tagName.toLowerCase()).toBe("h4");
  });

  it("renders email details and wraps long notes safely", async () => {
    const contacts = structuredClone(defaultContacts);
    contacts.records[0]!.contactMethods.emails = [
      {
        id: "email-primary",
        address: "registro.largo@hospital-canarias.local",
        label: "Laboral",
        isPrimary: true
      }
    ];
    contacts.records[0]!.notes = "nota-super-larga-sin-espacios-que-debe-romperse-correctamente-en-la-caja-del-detalle";

    window.hospitalDirectory.getBootstrapData = vi.fn().mockResolvedValue({
      contacts,
      settings: {
        editorName: "",
        dataFilePath: "/tmp/data/contacts.json",
        backupDirectoryPath: "/tmp/backups",
        ui: {
          showInactiveByDefault: false
        }
      }
    });

    renderPage();

    expect(await screen.findByLabelText("Buscar contactos")).toBeInTheDocument();
    expect(screen.getByText("Correos electrónicos")).toBeInTheDocument();
    expect(screen.getByText("registro.largo@hospital-canarias.local")).toBeInTheDocument();
    expect(screen.getByText("Laboral")).toBeInTheDocument();
    expect(screen.getAllByText("Principal").length).toBeGreaterThan(0);
    expect(screen.getByText(/nota-super-larga/)).toHaveClass("break-words");
  });

  it("shows the 'Privacidad sensible' list-card badge immediately after marking a non-preferred phone confidential (OIR-218)", async () => {
    // Regression test: the badge previously only checked the single "preferred"
    // (non-sensitive) phone returned by getPreferredResultPhone, so a record
    // whose ONLY confidential phone is a secondary/non-preferred one never
    // showed the badge — it looked stale even though the underlying record was
    // already fully up to date (mirroring the real edit-and-save flow, where
    // useContactForm calls setContacts(result.contacts) with a freshly built
    // dataset, no remount or reload involved).
    const contacts = structuredClone(defaultContacts);
    contacts.records[0]!.contactMethods.phones = [
      {
        id: "primary-safe",
        label: "Principal",
        number: "70005",
        kind: "internal",
        isPrimary: true,
        confidential: false,
        noPatientSharing: false
      },
      {
        id: "secondary-not-yet-confidential",
        label: "Interno",
        number: "70006",
        kind: "internal",
        isPrimary: false,
        confidential: false,
        noPatientSharing: false
      }
    ];

    window.hospitalDirectory.getBootstrapData = vi.fn().mockResolvedValue({
      contacts,
      settings: {
        editorName: "",
        dataFilePath: "/tmp/data/contacts.json",
        backupDirectoryPath: "/tmp/backups",
        ui: {
          showInactiveByDefault: false
        }
      }
    });

    renderPage();

    expect(await screen.findByLabelText("Buscar contactos")).toBeInTheDocument();
    expect(screen.queryByText("Privacidad sensible")).not.toBeInTheDocument();

    // Simulate the save flow's store update (useContactForm's submit handler
    // calls setContacts(result.contacts) with the freshly saved dataset — no
    // page reload, no remount). The edited phone is the SECONDARY (non-preferred)
    // one, which getPreferredResultPhone would never surface as the displayed
    // number — the badge must still reflect it.
    const savedContacts = structuredClone(contacts);
    savedContacts.records[0]!.contactMethods.phones[1]!.confidential = true;
    useAppStore.getState().setContacts(savedContacts);

    await waitFor(() => {
      expect(screen.getByText("Privacidad sensible")).toBeInTheDocument();
    });

    // The displayed number stays the safe/preferred one — only the aggregate
    // warning badge should reflect the newly-confidential secondary phone.
    expect(screen.getAllByText("70005").length).toBeGreaterThan(0);
  });
});
