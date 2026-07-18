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

    fireEvent.change(screen.getByLabelText("Buscar contactos"), {
      target: { value: "Control de planta" }
    });

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

  it("shows inactive records without any way to hide them (filters removed)", async () => {
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
    // This record inherits organization.service ("Información") from
    // the spread fixture record, so the title is composed with that prefix.
    expect((await screen.findAllByText(/control de noche/i)).length).toBeGreaterThan(0);
    expect(screen.queryByText("Inactivo")).not.toBeInTheDocument();
  });

  it("does not render any type/area/tag/inactive filter controls", async () => {
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
    expect(screen.queryByLabelText("Tipo")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Área")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Etiqueta")).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: /mostrar inactivos/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Limpiar" })).not.toBeInTheDocument();
  });

  it("shows organization.role in the list card subtitle when present", async () => {
    const contacts = structuredClone(defaultContacts);
    contacts.records[0]!.organization.role = "Jefe/a de Servicio";

    window.hospitalDirectory.getBootstrapData = vi.fn().mockResolvedValue({
      contacts,
      settings: {
        editorName: "",
        dataFilePath: "/tmp/data/contacts.json",
        backupDirectoryPath: "/tmp/backups",
        ui: { showInactiveByDefault: false }
      }
    });

    renderPage();

    expect(await screen.findByLabelText("Buscar contactos")).toBeInTheDocument();
    const list = screen.getByRole("list", { name: "Resultados del directorio" });
    expect(within(list).getByText("Jefe/a de Servicio")).toBeInTheDocument();
  });

  it("does not render a role line in the list card when organization.role is absent", async () => {
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
    const list = screen.getByRole("list", { name: "Resultados del directorio" });
    // The title is composed as "{service} - {displayName}" when the
    // service adds context, so match with a regex instead of the exact name.
    const heading = within(list).getByText(/admisión general/i);
    const card = heading.closest("div.min-w-0");
    // The Tipo/Unidad subtitle line was removed entirely, so with no
    // role set the title's wrapper div renders no <p> at all.
    expect(card?.querySelectorAll("p")).toHaveLength(0);
  });

  it("does not render the Tipo/Unidad subtitle line in list cards", async () => {
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
    const list = screen.getByRole("list", { name: "Resultados del directorio" });
    expect(within(list).queryByText(/Sin unidad/)).not.toBeInTheDocument();
    // Old "Tipo · Unidad" line for record[0] (type "service", department "Admisión").
    expect(within(list).queryByText("Servicio · Admisión")).not.toBeInTheDocument();
  });

  it("does not render the service line in a list card when it duplicates the displayName", async () => {
    const contacts = structuredClone(defaultContacts);
    contacts.records[0]!.displayName = "Helipuerto (Secretaría)";
    contacts.records[0]!.organization.service = "Helipuerto (Secretaría)";
    contacts.records[0]!.organization.area = undefined;

    window.hospitalDirectory.getBootstrapData = vi.fn().mockResolvedValue({
      contacts,
      settings: {
        editorName: "",
        dataFilePath: "/tmp/data/contacts.json",
        backupDirectoryPath: "/tmp/backups",
        ui: { showInactiveByDefault: false }
      }
    });

    renderPage();

    expect(await screen.findByLabelText("Buscar contactos")).toBeInTheDocument();
    const list = screen.getByRole("list", { name: "Resultados del directorio" });
    // The name renders once (the title) — the duplicate service line is skipped.
    expect(within(list).getAllByText("Helipuerto (Secretaría)")).toHaveLength(1);
  });

  it("still renders the service line in a list card when it genuinely differs from the displayName", async () => {
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
    const list = screen.getByRole("list", { name: "Resultados del directorio" });
    // defaultContacts.records[0].organization.service === "Información", distinct
    // from displayName "Admisión General" — it must still render. (Both fixture
    // records happen to share this service value, so scope to record[0]'s card.)
    // The title itself is now composed as "Información - Admisión
    // General" for this same reason, so match with a regex.
    const heading = within(list).getByText(/admisión general/i);
    const card = heading.closest("button");
    expect(within(card as HTMLElement).getAllByText("Información").length).toBeGreaterThan(0);
  });

  it("shows organization.role in the detail view when present", async () => {
    const contacts = structuredClone(defaultContacts);
    contacts.records[0]!.organization.role = "Enfermero/a";

    window.hospitalDirectory.getBootstrapData = vi.fn().mockResolvedValue({
      contacts,
      settings: {
        editorName: "",
        dataFilePath: "/tmp/data/contacts.json",
        backupDirectoryPath: "/tmp/backups",
        ui: { showInactiveByDefault: false }
      }
    });

    renderPage();

    expect(await screen.findByLabelText("Buscar contactos")).toBeInTheDocument();
    const detail = screen.getByRole("region", { name: "Detalle del registro seleccionado" });
    expect(within(detail).getByText("Enfermero/a")).toBeInTheDocument();
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

  it("does not render the type pill in the detail view header", async () => {
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
    const detail = screen.getByRole("region", { name: "Detalle del registro seleccionado" });
    // records[0].type is "service" -> label "Servicio" — the pill must be gone.
    expect(within(detail).queryByText("Servicio")).not.toBeInTheDocument();
  });

  it("still renders privacy-flag pills in the detail header once the type pill is removed", async () => {
    const contacts = structuredClone(defaultContacts);
    contacts.records[0]!.contactMethods.phones[0]!.confidential = true;

    window.hospitalDirectory.getBootstrapData = vi.fn().mockResolvedValue({
      contacts,
      settings: {
        editorName: "",
        dataFilePath: "/tmp/data/contacts.json",
        backupDirectoryPath: "/tmp/backups",
        ui: { showInactiveByDefault: false }
      }
    });

    renderPage();

    expect(await screen.findByLabelText("Buscar contactos")).toBeInTheDocument();
    const detail = screen.getByRole("region", { name: "Detalle del registro seleccionado" });
    // "Confidencial" renders both as the header privacy pill and the phone-level badge.
    expect(within(detail).getAllByText("Confidencial").length).toBeGreaterThan(0);
    expect(within(detail).queryByText("Servicio")).not.toBeInTheDocument();
  });

  it("composes the title as '{service} - {displayName}' in the list card and detail view when the service adds context", async () => {
    const contacts = structuredClone(defaultContacts);
    contacts.records[0]!.displayName = "Nereida";
    contacts.records[0]!.organization.service = "Alergia";

    window.hospitalDirectory.getBootstrapData = vi.fn().mockResolvedValue({
      contacts,
      settings: {
        editorName: "",
        dataFilePath: "/tmp/data/contacts.json",
        backupDirectoryPath: "/tmp/backups",
        ui: { showInactiveByDefault: false }
      }
    });

    renderPage();

    expect(await screen.findByLabelText("Buscar contactos")).toBeInTheDocument();
    const list = screen.getByRole("list", { name: "Resultados del directorio" });
    expect(within(list).getByText("Alergia - Nereida")).toBeInTheDocument();

    const detail = screen.getByRole("region", { name: "Detalle del registro seleccionado" });
    expect(within(detail).getByText("Alergia - Nereida")).toBeInTheDocument();
    // The raw displayName ("Nereida") is otherwise hidden inside the
    // composed title, so it's always surfaced as its own labeled card in the detail view.
    expect(within(detail).getByText("Nombre y Apellidos")).toBeInTheDocument();
    expect(within(detail).getByText("Nereida")).toBeInTheDocument();
  });

  it("collapses the composed title to just the service when it already contains the displayName as a substring", async () => {
    const contacts = structuredClone(defaultContacts);
    contacts.records[0]!.displayName = "Francisco Artíles";
    contacts.records[0]!.organization.service = "Cocina Francisco Artíles";

    window.hospitalDirectory.getBootstrapData = vi.fn().mockResolvedValue({
      contacts,
      settings: {
        editorName: "",
        dataFilePath: "/tmp/data/contacts.json",
        backupDirectoryPath: "/tmp/backups",
        ui: { showInactiveByDefault: false }
      }
    });

    renderPage();

    expect(await screen.findByLabelText("Buscar contactos")).toBeInTheDocument();
    const list = screen.getByRole("list", { name: "Resultados del directorio" });
    // Service already contains the full name — must NOT render as
    // "Cocina Francisco Artíles - Francisco Artíles". The title (h3) itself
    // must be exactly "Cocina Francisco Artíles" with no appended name — the
    // getListServiceLine secondary line (untouched by this fix) may
    // still separately repeat the service value, which is pre-existing behavior.
    expect(
      within(list).queryByText(/Cocina Francisco Artíles - Francisco Artíles/)
    ).not.toBeInTheDocument();
    const matches = within(list).getAllByText("Cocina Francisco Artíles");
    expect(matches.some((el) => el.tagName === "H3")).toBe(true);

    const detail = screen.getByRole("region", { name: "Detalle del registro seleccionado" });
    expect(
      within(detail).queryByText(/Cocina Francisco Artíles - Francisco Artíles/)
    ).not.toBeInTheDocument();
    expect(within(detail).getByText("Cocina Francisco Artíles")).toBeInTheDocument();
    // Service merely CONTAINS the full name as a substring (a
    // data-entry convention for this row), it does not EXACTLY equal it —
    // "Francisco Artíles" is still a genuine, distinct name and must be shown
    // in its own card, not hidden behind the empty-state placeholder. Only an
    // exact displayName/service match (see the Sindicato Médico test below)
    // represents the "blank Nombre column fell back to service" case.
    expect(within(detail).getByText("Nombre y Apellidos")).toBeInTheDocument();
    expect(within(detail).getByText("Francisco Artíles")).toBeInTheDocument();
    expect(within(detail).queryByText("Sin nombre y apellidos registrado")).not.toBeInTheDocument();
  });

  it("keeps the title unchanged when the service duplicates the displayName, in both list card and detail view", async () => {
    const contacts = structuredClone(defaultContacts);
    contacts.records[0]!.displayName = "Helipuerto (Secretaría)";
    contacts.records[0]!.organization.service = "Helipuerto (Secretaría)";
    contacts.records[0]!.organization.area = undefined;

    window.hospitalDirectory.getBootstrapData = vi.fn().mockResolvedValue({
      contacts,
      settings: {
        editorName: "",
        dataFilePath: "/tmp/data/contacts.json",
        backupDirectoryPath: "/tmp/backups",
        ui: { showInactiveByDefault: false }
      }
    });

    renderPage();

    expect(await screen.findByLabelText("Buscar contactos")).toBeInTheDocument();
    const list = screen.getByRole("list", { name: "Resultados del directorio" });
    expect(within(list).queryByText(/Helipuerto \(Secretaría\) - Helipuerto \(Secretaría\)/)).not.toBeInTheDocument();
    expect(within(list).getAllByText("Helipuerto (Secretaría)")).toHaveLength(1);

    const detail = screen.getByRole("region", { name: "Detalle del registro seleccionado" });
    expect(within(detail).queryByText(/Helipuerto \(Secretaría\) - Helipuerto \(Secretaría\)/)).not.toBeInTheDocument();
    // displayName exactly duplicates the service — "Helipuerto
    // (Secretaría)" must now appear only ONCE in the detail view (the
    // uncomposed title); the Nombre y Apellidos card must NOT repeat it and
    // instead shows the empty-state placeholder.
    expect(within(detail).getAllByText("Helipuerto (Secretaría)").length).toBe(1);
    // "Nombre y Apellidos" is now its own always-visible card (no longer
    // conditional on the title being composed), so it must still render here.
    expect(within(detail).getByText("Nombre y Apellidos")).toBeInTheDocument();
    expect(within(detail).getByText("Sin nombre y apellidos registrado")).toBeInTheDocument();
  });

  it("shows the empty-state placeholder in Nombre y Apellidos when displayName is just the service label repeated, e.g. blank ODS 'Nombre' column", async () => {
    const contacts = structuredClone(defaultContacts);
    contacts.records[0]!.displayName = "Sindicato Médico";
    contacts.records[0]!.organization.service = "Sindicato Médico";
    contacts.records[0]!.organization.area = undefined;

    window.hospitalDirectory.getBootstrapData = vi.fn().mockResolvedValue({
      contacts,
      settings: {
        editorName: "",
        dataFilePath: "/tmp/data/contacts.json",
        backupDirectoryPath: "/tmp/backups",
        ui: { showInactiveByDefault: false }
      }
    });

    renderPage();

    expect(await screen.findByLabelText("Buscar contactos")).toBeInTheDocument();
    const detail = screen.getByRole("region", { name: "Detalle del registro seleccionado" });
    // The title correctly shows just "Sindicato Médico" (exact-match, no
    // composition) exactly once.
    expect(within(detail).getAllByText("Sindicato Médico").length).toBe(1);
    // The Nombre y Apellidos card must NOT duplicate the service label as if
    // it were a real person's name — it renders the empty-state placeholder.
    expect(within(detail).getByText("Nombre y Apellidos")).toBeInTheDocument();
    expect(within(detail).getByText("Sin nombre y apellidos registrado")).toBeInTheDocument();
  });

  it("leaves the title unchanged when organization.service is absent", async () => {
    const contacts = structuredClone(defaultContacts);
    contacts.records[0]!.displayName = "Recepción Central";
    contacts.records[0]!.organization.service = undefined;

    window.hospitalDirectory.getBootstrapData = vi.fn().mockResolvedValue({
      contacts,
      settings: {
        editorName: "",
        dataFilePath: "/tmp/data/contacts.json",
        backupDirectoryPath: "/tmp/backups",
        ui: { showInactiveByDefault: false }
      }
    });

    renderPage();

    expect(await screen.findByLabelText("Buscar contactos")).toBeInTheDocument();
    const list = screen.getByRole("list", { name: "Resultados del directorio" });
    expect(within(list).getByText("Recepción Central")).toBeInTheDocument();

    const detail = screen.getByRole("region", { name: "Detalle del registro seleccionado" });
    // "Recepción Central" now appears twice in the detail view — once as
    // the (uncomposed) title, and once in the always-visible "Nombre y Apellidos"
    // card — so assert on both occurrences instead of a single unique match.
    expect(within(detail).getAllByText("Recepción Central").length).toBe(2);
    expect(within(detail).getByText("Nombre y Apellidos")).toBeInTheDocument();
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

  // ODS parsing intentionally stores the bare floor/room value (e.g.
  // "6"), relying on display-time reconstruction of the "Planta "/"Hab "
  // prefixes (see stripPlantaPrefix in spreadsheet-parsers.ts and
  // formatLocationFloor/formatLocationRoom in shared/utils/contacts.ts). The
  // Ubicación card used to raw-join location.floor/location.room, rendering a
  // bare "6" instead of "Planta 6".
  it("prefixes floor and room with 'Planta'/'Hab' in the Ubicación card, matching locationSummary's format", async () => {
    const contacts = structuredClone(defaultContacts);
    const target = contacts.records[1]!;
    target.location = {
      ...target.location,
      floor: "6",
      room: "301"
    };

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
      selectedRecordId: target.id,
      isLoading: false,
      bootstrapStatus: "success",
      bootstrapError: "",
      bootstrapHelp: ""
    });

    renderPage();

    const detail = await screen.findByRole("region", { name: "Detalle del registro seleccionado" });

    const locationText = within(detail).getByText(/Planta 6/);
    expect(locationText).toBeInTheDocument();
    expect(locationText.textContent).toContain("Planta 6");
    expect(locationText.textContent).toContain("Hab 301");
    expect(locationText.textContent).not.toMatch(/·\s*6\s*·/);
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

  it("hides the entire Teléfonos section (heading, counter, empty-state copy) when a record has no phones", async () => {
    const contacts = structuredClone(defaultContacts);
    contacts.records[0]!.contactMethods.phones = [];

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
    expect(screen.queryByText("Teléfonos")).not.toBeInTheDocument();
    expect(screen.queryByText("0 disponibles")).not.toBeInTheDocument();
    expect(screen.queryByText("No hay teléfonos registrados.")).not.toBeInTheDocument();
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

  // Layout/scroll polish — filter bar stays visible while scrolling
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

    expect(await screen.findByText("No se han encontrado resultados para esta búsqueda.")).toBeInTheDocument();

    // The result count stays a polite live region even at zero results so
    // "0 resultados" is announced alongside the empty-state panel (StatePanel
    // drives its own announcement via a separate sr-only status region — see
    // StatePanel.tsx).
    const statusRegions = screen.getAllByRole("status");
    expect(statusRegions).toHaveLength(2);
    const countRegion = statusRegions.find((region) => region.textContent?.includes("0 resultados"));
    expect(countRegion).toBeDefined();
    expect(countRegion).toHaveAttribute("aria-live", "polite");
    expect(countRegion).toHaveAttribute("aria-atomic", "true");

    // StatePanel's own sr-only status region announces the empty-state title
    // and message together, shortly after mount.
    const announcementRegion = statusRegions.find((region) => region !== countRegion);
    expect(announcementRegion).toBeDefined();
    await waitFor(() => {
      expect(announcementRegion).toHaveTextContent(
        "Sin resultados. No se han encontrado resultados para esta búsqueda."
      );
    });
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

  // The arrow/Home/End tests above only assert aria-pressed
  // (selection state) — they never assert that DOM focus actually followed.
  // focusRecordButton() moves focus via requestAnimationFrame, which is the
  // genuinely risky part of the roving-tabindex extraction (wiring the
  // hook's abstract index arithmetic to real DOM focus); useRovingTabIndex's
  // own unit tests only cover the arithmetic. These regression tests assert
  // that DOM focus AND aria-pressed selection move together for real keydown
  // events, using waitFor to await the deferred rAF focus call.
  describe("keyboard navigation moves DOM focus together with selection", () => {
    const bootstrap = () => {
      window.hospitalDirectory.getBootstrapData = vi.fn().mockResolvedValue({
        contacts: defaultContacts,
        settings: {
          editorName: "",
          dataFilePath: "/tmp/data/contacts.json",
          backupDirectoryPath: "/tmp/backups",
          ui: { showInactiveByDefault: false }
        }
      });
    };

    it("ArrowDown moves both DOM focus and selection to the next record", async () => {
      bootstrap();
      renderPage();
      await screen.findByRole("list", { name: "Resultados del directorio" });

      const firstButton = screen.getByRole("button", { name: /admisión general/i });
      const secondButton = screen.getByRole("button", { name: /centro de salud demo/i });

      firstButton.focus();
      fireEvent.keyDown(firstButton, { key: "ArrowDown" });

      await waitFor(() => expect(secondButton).toHaveFocus());
      expect(secondButton).toHaveAttribute("aria-pressed", "true");
      expect(firstButton).toHaveAttribute("aria-pressed", "false");
    });

    it("ArrowUp moves both DOM focus and selection to the previous record", async () => {
      bootstrap();
      renderPage();
      await screen.findByRole("list", { name: "Resultados del directorio" });

      const firstButton = screen.getByRole("button", { name: /admisión general/i });
      const secondButton = screen.getByRole("button", { name: /centro de salud demo/i });

      firstButton.focus();
      fireEvent.keyDown(firstButton, { key: "ArrowDown" });
      await waitFor(() => expect(secondButton).toHaveFocus());

      fireEvent.keyDown(secondButton, { key: "ArrowUp" });

      await waitFor(() => expect(firstButton).toHaveFocus());
      expect(firstButton).toHaveAttribute("aria-pressed", "true");
      expect(secondButton).toHaveAttribute("aria-pressed", "false");
    });

    it("Home moves both DOM focus and selection to the first record", async () => {
      bootstrap();
      renderPage();
      await screen.findByRole("list", { name: "Resultados del directorio" });

      const firstButton = screen.getByRole("button", { name: /admisión general/i });
      const secondButton = screen.getByRole("button", { name: /centro de salud demo/i });

      firstButton.focus();
      fireEvent.keyDown(firstButton, { key: "ArrowDown" });
      await waitFor(() => expect(secondButton).toHaveFocus());

      fireEvent.keyDown(secondButton, { key: "Home" });

      await waitFor(() => expect(firstButton).toHaveFocus());
      expect(firstButton).toHaveAttribute("aria-pressed", "true");
      expect(secondButton).toHaveAttribute("aria-pressed", "false");
    });

    it("End moves both DOM focus and selection to the last record", async () => {
      bootstrap();
      renderPage();
      await screen.findByRole("list", { name: "Resultados del directorio" });

      const firstButton = screen.getByRole("button", { name: /admisión general/i });
      const lastButton = screen.getByRole("button", { name: /centro de salud demo/i });

      firstButton.focus();
      fireEvent.keyDown(firstButton, { key: "End" });

      await waitFor(() => expect(lastButton).toHaveFocus());
      expect(lastButton).toHaveAttribute("aria-pressed", "true");
      expect(firstButton).toHaveAttribute("aria-pressed", "false");
    });
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
    const editLink = screen.getByRole("link", { name: `Editar: ${firstRecord.displayName}` });
    expect(editLink).toHaveAttribute("href", `/contacts/${firstRecord.id}/edit`);
    expect(editLink).toHaveTextContent("Editar");
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

  it("hides the entire Correos electrónicos section (heading, counter, empty-state copy) when a record has no emails", async () => {
    const contacts = structuredClone(defaultContacts);
    contacts.records[0]!.contactMethods.emails = [];

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
    expect(screen.queryByText("Correos electrónicos")).not.toBeInTheDocument();
    expect(screen.queryByText("0 disponibles")).not.toBeInTheDocument();
    expect(screen.queryByText("No hay correos registrados.")).not.toBeInTheDocument();
  });

  it("shows the 'Privacidad sensible' list-card badge immediately after marking a non-preferred phone confidential", async () => {
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

  // Quick-search shortcuts for the 8 known ODS "book" sheets.
  it("clicking a book shortcut sets the search query and filters to matching department records", async () => {
    const contacts = structuredClone(defaultContacts);
    contacts.records.push({
      ...structuredClone(defaultContacts.records[0]),
      id: "sindicatos-record",
      displayName: "Delegado Sindical",
      organization: { ...defaultContacts.records[0]!.organization, department: "Sindicatos" }
    });

    window.hospitalDirectory.getBootstrapData = vi.fn().mockResolvedValue({
      contacts,
      settings: {
        editorName: "",
        dataFilePath: "/tmp/data/contacts.json",
        backupDirectoryPath: "/tmp/backups",
        ui: { showInactiveByDefault: false }
      }
    });

    renderPage();

    expect(await screen.findByLabelText("Buscar contactos")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("3 resultados");

    const sindicatosButton = screen.getByRole("button", { name: "Sindicatos" });
    fireEvent.click(sindicatosButton);

    expect(screen.getByLabelText("Buscar contactos")).toHaveValue("Sindicatos");
    expect(screen.getByRole("status")).toHaveTextContent("1 resultados");
    expect(screen.getByText("Delegado Sindical")).toBeInTheDocument();
    expect(screen.queryByText("Admisión General")).not.toBeInTheDocument();
    expect(sindicatosButton).toHaveAttribute("aria-pressed", "true");
  });

  it("clicking an active book shortcut again clears the query back to an unfiltered view", async () => {
    const contacts = structuredClone(defaultContacts);
    contacts.records.push({
      ...structuredClone(defaultContacts.records[0]),
      id: "umi-record",
      displayName: "Coordinación UMI",
      organization: { ...defaultContacts.records[0]!.organization, department: "UMI" }
    });

    window.hospitalDirectory.getBootstrapData = vi.fn().mockResolvedValue({
      contacts,
      settings: {
        editorName: "",
        dataFilePath: "/tmp/data/contacts.json",
        backupDirectoryPath: "/tmp/backups",
        ui: { showInactiveByDefault: false }
      }
    });

    renderPage();

    expect(await screen.findByLabelText("Buscar contactos")).toBeInTheDocument();

    const umiButton = screen.getByRole("button", { name: "UMI" });
    fireEvent.click(umiButton);
    expect(screen.getByLabelText("Buscar contactos")).toHaveValue("UMI");
    expect(screen.getByRole("status")).toHaveTextContent("1 resultados");

    fireEvent.click(umiButton);
    expect(screen.getByLabelText("Buscar contactos")).toHaveValue("");
    expect(umiButton).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("status")).toHaveTextContent("3 resultados");
  });
});
