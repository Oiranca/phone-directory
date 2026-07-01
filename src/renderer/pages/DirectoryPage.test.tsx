import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
      expect(screen.getByRole("heading", { name: "Directorio" })).toBeInTheDocument();
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
    expect(screen.getAllByText("No facilitar a pacientes").length).toBeGreaterThan(0);
    expect(screen.queryByText("Trata este registro como información de uso interno y confirma el contexto antes de compartirlo.")).not.toBeInTheDocument();
    expect(screen.queryByText("Ubicación disponible")).not.toBeInTheDocument();
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

    const statusEl = await screen.findByRole("status");
    expect(statusEl).toHaveTextContent("No hay resultados para la búsqueda y filtros actuales.");
    expect(screen.getAllByRole("status")).toHaveLength(1);
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
});
