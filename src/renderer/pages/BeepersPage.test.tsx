import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../components/feedback/ToastRegion";
import { BeepersPage } from "./BeepersPage";
import type { BeeperRecord, BeeperTeam, ImportedBeeperRecord } from "../../shared/schemas/beeper.schema";

const mockRecords: BeeperRecord[] = [
  {
    id: "bsc_001",
    deviceNumber: "B-001",
    assignedTo: "Ana García",
    department: "Urgencias",
    role: "Enfermera",
    shift: "mañana",
    group: "Equipo A"
  },
  {
    id: "bsc_002",
    deviceNumber: "B-002",
    assignedTo: "Luis Pérez",
    department: "UCI",
    role: "Médico",
    shift: "tarde"
  }
];

const mockImportedRecords: ImportedBeeperRecord[] = [
  {
    id: "ibsc_00000001",
    deviceNumber: "5001",
    department: "Cardiología",
    holderType: "Principal",
    sourceSheet: "Buscas_Facultativos",
    sourceRow: 2
  },
  {
    id: "ibsc_00000002",
    deviceNumber: "5002",
    department: "Neurología",
    holderType: "Residente",
    sourceSheet: "Buscas_Enfermería",
    sourceRow: 3
  }
];

const mockTeams: BeeperTeam[] = [{ id: "team_uci", name: "UCI", displayId: "9001" }];

const makeRecords = (count: number): BeeperRecord[] =>
  Array.from({ length: count }, (_, index) => ({
    id: `bsc_${String(index + 1).padStart(3, "0")}`,
    deviceNumber: `B-${String(index + 1).padStart(3, "0")}`,
    assignedTo: `Persona ${index + 1}`,
    department: index < 11 ? "Grupo Alfa" : "Grupo Beta",
    role: "Profesional",
    shift: "mañana"
  }));

const setupWindowApi = (overrides: Partial<typeof window.hospitalDirectory> = {}) => {
  Object.defineProperty(window, "hospitalDirectory", {
    configurable: true,
    value: {
      listBeepers: vi.fn().mockResolvedValue(mockRecords),
      listImportedBeepers: vi.fn().mockResolvedValue([]),
      addBeeper: vi.fn(),
      updateBeeper: vi.fn(),
      deleteBeeper: vi.fn(),
      updateImportedBeeper: vi.fn(),
      listBeeperTeams: vi.fn().mockResolvedValue([]),
      listBeeperTeamMemberships: vi.fn().mockResolvedValue([]),
      addBeeperTeam: vi.fn(),
      updateBeeperTeam: vi.fn(),
      deleteBeeperTeam: vi.fn(),
      setBeeperTeamMembers: vi.fn(),
      ...overrides
    }
  });
};

const LocationProbe = () => <span data-testid="pathname">{useLocation().pathname}</span>;

const renderPage = (path = "/beeper") =>
  render(
    <MemoryRouter initialEntries={[path]} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <ToastProvider>
        <BeepersPage />
        <LocationProbe />
      </ToastProvider>
    </MemoryRouter>
  );

// Exact match: toHaveTextContent is a substring check and "/beeper" is a prefix of "/beeper/new".
const expectPathname = (pathname: string) => expect(screen.getByTestId("pathname").textContent).toBe(pathname);

// /beeper/new opens on a chooser; these pick one of its two options.
const openBuscaForm = async () => {
  fireEvent.click(await screen.findByRole("button", { name: "Nuevo busca" }));
};

const openTeamCreateForm = async () => {
  fireEvent.click(await screen.findByRole("button", { name: "Nuevo equipo" }));
};

const openTeamManager = async (teamId: string) => {
  await screen.findByText("B-001");
  fireEvent.click(screen.getByRole("button", { name: "Gestionar equipos" }));
  fireEvent.change(screen.getByLabelText("Equipo a gestionar"), { target: { value: teamId } });
};

// Opens the team-scoped create form for the selected team, fills it and submits.
const createBuscaFromTeam = (deviceNumber: string) => {
  fireEvent.click(screen.getByRole("button", { name: "Nuevo busca en UCI · 9001" }));
  const form = screen.getByRole("form", { name: "Nuevo busca en UCI · 9001" });
  fireEvent.change(screen.getByLabelText(/número de busca/i), { target: { value: deviceNumber } });
  fireEvent.change(screen.getByLabelText(/asignado a/i), { target: { value: "Marta Ruiz" } });
  fireEvent.change(form.querySelector("#form-department")!, { target: { value: "Planta 2" } });
  fireEvent.change(form.querySelector("#form-role")!, { target: { value: "Auxiliar" } });
  fireEvent.submit(form);
};

const newTeam = { id: "team_new", name: "Quirófano", displayId: "9010" };

// On /beeper/new: choose "Nuevo equipo", fill the form and save. Leaves the page on the
// new team's members panel.
const saveNewTeamFromChooser = async () => {
  await openTeamCreateForm();
  fireEvent.change(screen.getByLabelText(/Nombre del equipo/i), { target: { value: newTeam.name } });
  fireEvent.change(screen.getByLabelText(/Número del equipo/i), { target: { value: newTeam.displayId } });
  fireEvent.submit(screen.getByRole("form", { name: "Nuevo equipo" }));
  await screen.findByRole("heading", { name: "Buscas del equipo" });
};

// Exactly one h2 titles the page in the ready and /beeper/new states, and the root section is
// named by it. (The /beeper empty state and the load-error state render a second h2 from StatePanel.)
const expectSinglePageTitle = (text: string) => {
  const titles = document.querySelectorAll("#beeper-page-title");
  expect(titles).toHaveLength(1);
  expect(titles[0]).toHaveTextContent(text);
  expect(titles[0].tagName).toBe("H2");
  expect(screen.getAllByRole("heading", { level: 2 })).toHaveLength(1);
  expect(screen.getByRole("region", { name: text })).toBeInTheDocument();
};

describe("BeepersPage", () => {
  beforeEach(() => {
    setupWindowApi();
  });

  afterEach(() => {
    cleanup();
  });

  it("shows loading state initially then displays records", async () => {
    renderPage();
    expect(screen.getByRole("status")).toHaveTextContent("Cargando buscas");
    await waitFor(() => {
      expect(screen.getByText("B-001")).toBeInTheDocument();
      expect(screen.getByText("B-002")).toBeInTheDocument();
    });
  });

  it("shows retryable error state when listBeepers fails — no empty state shown", async () => {
    setupWindowApi({
      listBeepers: vi.fn().mockRejectedValue(new Error("network error"))
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("No se pudieron cargar los buscas o los equipos.");
    });
    // Retry button must be present
    expect(screen.getByRole("button", { name: /reintentar/i })).toBeInTheDocument();
    // Must NOT show the empty-dataset creation prompt
    expect(screen.queryByText(/No hay buscas registrados/)).not.toBeInTheDocument();
    // Must NOT show the "Nuevo busca" button
    expect(screen.queryByRole("button", { name: /nuevo busca/i })).not.toBeInTheDocument();
  });

  it("retries load when Reintentar is clicked after a failure", async () => {
    const listBeepersMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValueOnce(mockRecords);
    setupWindowApi({ listBeepers: listBeepersMock });
    renderPage();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /reintentar/i })).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /reintentar/i }));

    await waitFor(() => {
      expect(screen.getByText("B-001")).toBeInTheDocument();
    });
  });

  it("shows empty state when no records exist", async () => {
    setupWindowApi({ listBeepers: vi.fn().mockResolvedValue([]) });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/No hay buscas registrados/)).toBeInTheDocument();
    });
  });

  it("displays record fields in the table", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("Ana García")).toBeInTheDocument();
      expect(screen.getByText("Urgencias")).toBeInTheDocument();
      expect(screen.getByText("Enfermera")).toBeInTheDocument();
    });
  });

  it("orders visible columns for fast scanning and emphasizes the beeper number", async () => {
    renderPage();
    await screen.findByText("B-001");

    expect(screen.getAllByRole("columnheader").map((header) => header.textContent?.trim())).toEqual([
      "Número",
      "Rol",
      "Departamento",
      "Asignado a / Titular",
      "Acciones"
    ]);
    const emphasizedNumber = screen.getByText("B-001");
    expect(emphasizedNumber).toHaveClass("bg-scs-mist", "font-bold");
    expect(
      within(emphasizedNumber.closest("tr")!).getAllByRole("cell").slice(0, 4).map((cell) => cell.textContent?.trim())
    ).toEqual(["B-001", "Enfermera", "Urgencias", "Ana García"]);
  });

  it("filters records by search query", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("B-001")).toBeInTheDocument();
    });
    fireEvent.change(screen.getByLabelText(/Buscar buscas/i), {
      target: { value: "UCI" }
    });
    await waitFor(() => {
      expect(screen.queryByText("B-001")).not.toBeInTheDocument();
      expect(screen.getByText("B-002")).toBeInTheDocument();
    });
  });

  it("toggles the team manager without resetting its selected team", async () => {
    setupWindowApi({ listBeeperTeams: vi.fn().mockResolvedValue(mockTeams) });
    renderPage();
    await screen.findByText("B-001");
    const toggle = screen.getByRole("button", { name: "Gestionar equipos" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).not.toHaveAttribute("aria-controls");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveAttribute("aria-controls", "team-manager");
    fireEvent.change(screen.getByLabelText("Equipo a gestionar"), { target: { value: "team_uci" } });
    fireEvent.click(toggle);
    fireEvent.click(toggle);
    expect(screen.getByLabelText("Equipo a gestionar")).toHaveValue("team_uci");
  });

  it("lists the team's current members when the member search is empty", async () => {
    setupWindowApi({
      listImportedBeepers: vi.fn().mockResolvedValue(mockImportedRecords),
      listBeeperTeams: vi.fn().mockResolvedValue(mockTeams),
      listBeeperTeamMemberships: vi.fn().mockResolvedValue([
        { teamId: "team_uci", beeperId: "bsc_002" },
        { teamId: "team_uci", beeperId: "ibsc_00000001" }
      ])
    });
    renderPage();
    await openTeamManager("team_uci");

    const members = within(screen.getByRole("list", { name: "Buscas del equipo" }));
    expect(members.getByRole("button", { name: "Quitar del equipo B-002 · Luis Pérez" })).toBeInTheDocument();
    expect(members.getByRole("button", { name: "Quitar del equipo 5001 · Principal, Buscas_Facultativos fila 2" })).toBeInTheDocument();
    expect(members.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /Añadir al equipo/ })).not.toBeInTheDocument();
  });

  it("removes a member from the current-members list without removing the Busca from the main list", async () => {
    const setMembers = vi.fn().mockResolvedValue([{ teamId: "team_uci", beeperId: "ibsc_00000001" }]);
    setupWindowApi({
      listImportedBeepers: vi.fn().mockResolvedValue(mockImportedRecords),
      listBeeperTeams: vi.fn().mockResolvedValue(mockTeams),
      listBeeperTeamMemberships: vi.fn().mockResolvedValue([
        { teamId: "team_uci", beeperId: "bsc_002" },
        { teamId: "team_uci", beeperId: "ibsc_00000001" }
      ]),
      setBeeperTeamMembers: setMembers
    });
    renderPage();
    await openTeamManager("team_uci");

    fireEvent.click(screen.getByRole("button", { name: "Quitar del equipo B-002 · Luis Pérez" }));

    await waitFor(() => expect(setMembers).toHaveBeenCalledWith("team_uci", ["ibsc_00000001"]));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Quitar del equipo B-002 · Luis Pérez" })).not.toBeInTheDocument());
    expect(screen.getAllByText("B-002").some((item) => item.closest("table"))).toBe(true);
    await waitFor(() => expect(screen.getByLabelText("Buscar busca")).toHaveFocus());
  });

  it("adds an existing Busca through an explicit button and the button flips to remove", async () => {
    setupWindowApi({
      listBeeperTeams: vi.fn().mockResolvedValue(mockTeams),
      listBeeperTeamMemberships: vi.fn().mockResolvedValue([]),
      setBeeperTeamMembers: vi.fn().mockResolvedValue([{ teamId: "team_uci", beeperId: "bsc_001" }])
    });
    renderPage();
    await openTeamManager("team_uci");

    fireEvent.change(screen.getByLabelText("Buscar busca"), { target: { value: "B-001" } });
    fireEvent.click(screen.getByRole("button", { name: "Añadir al equipo B-001 · Ana García" }));

    await waitFor(() => expect(window.hospitalDirectory.setBeeperTeamMembers).toHaveBeenCalledWith("team_uci", ["bsc_001"]));
    expect(await screen.findByRole("button", { name: "Quitar del equipo B-001 · Ana García" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Añadir al equipo B-001 · Ana García" })).not.toBeInTheDocument();
  });

  it("adds and removes an imported Busca through explicit buttons", async () => {
    const setMembers = vi.fn()
      .mockResolvedValueOnce([{ teamId: "team_uci", beeperId: "ibsc_00000001" }])
      .mockResolvedValueOnce([]);
    setupWindowApi({
      listImportedBeepers: vi.fn().mockResolvedValue(mockImportedRecords),
      listBeeperTeams: vi.fn().mockResolvedValue(mockTeams),
      listBeeperTeamMemberships: vi.fn().mockResolvedValue([]),
      setBeeperTeamMembers: setMembers
    });
    renderPage();
    await openTeamManager("team_uci");
    fireEvent.change(screen.getByLabelText("Buscar busca"), { target: { value: "5001" } });
    fireEvent.click(screen.getByRole("button", { name: "Añadir al equipo 5001 · Principal, Buscas_Facultativos fila 2" }));
    await waitFor(() => expect(setMembers).toHaveBeenLastCalledWith("team_uci", ["ibsc_00000001"]));
    fireEvent.click(await screen.findByRole("button", { name: "Quitar del equipo 5001 · Principal, Buscas_Facultativos fila 2" }));
    await waitFor(() => expect(setMembers).toHaveBeenLastCalledWith("team_uci", []));
  });

  it("announces which Busca was added to or removed from which team", async () => {
    setupWindowApi({
      listBeeperTeams: vi.fn().mockResolvedValue(mockTeams),
      setBeeperTeamMembers: vi.fn()
        .mockResolvedValueOnce([{ teamId: "team_uci", beeperId: "bsc_002" }])
        .mockResolvedValueOnce([])
    });
    renderPage();
    await openTeamManager("team_uci");
    fireEvent.change(screen.getByLabelText("Buscar busca"), { target: { value: "B-002" } });

    fireEvent.click(screen.getByRole("button", { name: "Añadir al equipo B-002 · Luis Pérez" }));
    await waitFor(() => expect(screen.getByText("B-002 añadido al equipo UCI · 9001")).toBeInTheDocument());
    expect(screen.getByText("B-002 añadido al equipo UCI · 9001")).toHaveAttribute("role", "status");

    fireEvent.click(screen.getByRole("button", { name: "Quitar del equipo B-002 · Luis Pérez" }));
    await waitFor(() => expect(screen.getByText("B-002 quitado del equipo UCI · 9001")).toBeInTheDocument());
  });

  it("keeps the member button enabled while saving, blocks scoped create, and ignores a second click", async () => {
    let resolveSave: (value: Array<{ teamId: string; beeperId: string }>) => void = () => undefined;
    const setMembers = vi.fn().mockReturnValue(new Promise((resolve) => { resolveSave = resolve; }));
    setupWindowApi({ listBeeperTeams: vi.fn().mockResolvedValue(mockTeams), setBeeperTeamMembers: setMembers });
    renderPage();
    await openTeamManager("team_uci");
    fireEvent.change(screen.getByLabelText("Buscar busca"), { target: { value: "B-001" } });
    const button = screen.getByRole("button", { name: "Añadir al equipo B-001 · Ana García" });
    button.focus();

    fireEvent.click(button);
    await waitFor(() => expect(button).toHaveAttribute("aria-disabled", "true"));
    // `disabled` would drop focus to <body> in Chromium; jsdom cannot show that, so
    // asserting the button is not disabled is the real guard.
    expect(button).not.toBeDisabled();
    // A scoped create during the save would link against stale memberships.
    expect(screen.getByRole("button", { name: "Nuevo busca en UCI · 9001" })).toBeDisabled();
    expect(screen.getByLabelText("Buscar busca")).not.toBeDisabled();
    fireEvent.click(button);
    expect(setMembers).toHaveBeenCalledTimes(1);

    resolveSave([{ teamId: "team_uci", beeperId: "bsc_001" }]);
    await waitFor(() => expect(button).not.toHaveAttribute("aria-disabled"));
  });

  it("keeps membership unchanged and shows an error when an update fails", async () => {
    setupWindowApi({
      listBeeperTeams: vi.fn().mockResolvedValue(mockTeams),
      listBeeperTeamMemberships: vi.fn().mockResolvedValue([{ teamId: "team_uci", beeperId: "bsc_002" }]),
      setBeeperTeamMembers: vi.fn().mockRejectedValue(new Error("save failed"))
    });
    renderPage();
    await openTeamManager("team_uci");
    fireEvent.click(screen.getByRole("button", { name: "Quitar del equipo B-002 · Luis Pérez" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("save failed");
    expect(screen.getByRole("button", { name: "Quitar del equipo B-002 · Luis Pérez" })).toBeInTheDocument();
  });

  it("clears a member error and the member search when switching team", async () => {
    const otherTeam: BeeperTeam = { id: "team_urg", name: "Urgencias", displayId: "9002" };
    setupWindowApi({
      listBeeperTeams: vi.fn().mockResolvedValue([...mockTeams, otherTeam]),
      setBeeperTeamMembers: vi.fn().mockRejectedValue(new Error("save failed"))
    });
    renderPage();
    await openTeamManager("team_uci");
    fireEvent.change(screen.getByLabelText("Buscar busca"), { target: { value: "B-001" } });
    fireEvent.click(screen.getByRole("button", { name: "Añadir al equipo B-001 · Ana García" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("save failed");

    fireEvent.change(screen.getByLabelText("Equipo a gestionar"), { target: { value: "team_urg" } });

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Buscar busca")).toHaveValue("");
  });

  it("locks team editing with a visible reason while the team-scoped busca form is open", async () => {
    setupWindowApi({ listBeeperTeams: vi.fn().mockResolvedValue(mockTeams) });
    renderPage();
    await openTeamManager("team_uci");
    fireEvent.click(screen.getByRole("button", { name: "Nuevo busca en UCI · 9001" }));

    expect(screen.getByLabelText("Equipo a gestionar")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Gestionar equipos" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Eliminar equipo" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Nuevo busca en UCI · 9001" })).toBeDisabled();
    expect(screen.getByLabelText("Buscar busca")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Gestionar equipos" })).toHaveAccessibleDescription("Crea o cancela el busca para editar el equipo.");
    expect(screen.getByRole("button", { name: "Eliminar equipo" })).toHaveAccessibleDescription("Crea o cancela el busca para editar el equipo.");

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Nuevo busca en UCI · 9001" })).toHaveFocus());
  });

  it("locks and unlocks team editing around a non-team busca form", async () => {
    setupWindowApi({ listBeeperTeams: vi.fn().mockResolvedValue(mockTeams) });
    renderPage();
    await openTeamManager("team_uci");
    fireEvent.click(screen.getByRole("button", { name: /editar busca B-001/i }));

    expect(screen.getByLabelText(/Nombre del equipo/i)).toBeDisabled();
    expect(screen.getByLabelText(/Número del equipo/i)).toBeDisabled();
    expect(screen.getByRole("button", { name: "Guardar equipo" })).toBeDisabled();
    expect(screen.getByLabelText(/Nombre del equipo/i)).toHaveAccessibleDescription("Guarda o cancela el busca para editar el equipo.");

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(screen.getByLabelText(/Nombre del equipo/i)).toBeEnabled();
    expect(screen.getByRole("button", { name: "Guardar equipo" })).toBeEnabled();
    expect(screen.queryByText("Guarda o cancela el busca para editar el equipo.")).not.toBeInTheDocument();
  });

  it("words the lock reason as 'Guarda' while editing an imported busca", async () => {
    setupWindowApi({
      listImportedBeepers: vi.fn().mockResolvedValue(mockImportedRecords),
      listBeeperTeams: vi.fn().mockResolvedValue(mockTeams)
    });
    renderPage();
    await openTeamManager("team_uci");
    fireEvent.click(screen.getByRole("button", { name: /editar busca 5001/i }));

    expect(screen.getByLabelText(/Nombre del equipo/i)).toHaveAccessibleDescription("Guarda o cancela el busca para editar el equipo.");
  });

  it("disables 'Limpiar búsqueda' while a busca form is open", async () => {
    setupWindowApi({ listBeeperTeams: vi.fn().mockResolvedValue(mockTeams) });
    renderPage();
    await openTeamManager("team_uci");
    fireEvent.change(screen.getByLabelText("Buscar busca"), { target: { value: "sin coincidencia" } });
    fireEvent.click(screen.getByRole("button", { name: "Nuevo busca en UCI · 9001" }));

    const clear = screen.getByRole("button", { name: "Limpiar búsqueda" });
    expect(clear).toBeDisabled();
    expect(clear).toHaveAccessibleDescription("Crea o cancela el busca para editar el equipo.");
    fireEvent.click(clear);
    expect(screen.getByLabelText("Buscar busca")).toHaveValue("sin coincidencia");
  });

  it("does not say the team is empty when its members are hidden because imported buscas failed to load", async () => {
    setupWindowApi({
      listImportedBeepers: vi.fn().mockRejectedValue(new Error("import failed")),
      listBeeperTeams: vi.fn().mockResolvedValue(mockTeams),
      listBeeperTeamMemberships: vi.fn().mockResolvedValue([{ teamId: "team_uci", beeperId: "ibsc_00000001" }])
    });
    renderPage();
    await openTeamManager("team_uci");

    expect(screen.queryByRole("list", { name: "Buscas del equipo" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Este equipo aún no tiene buscas\./)).not.toBeInTheDocument();
    expect(screen.getByText(/Busca por número o titular para añadir buscas al equipo\./)).toBeInTheDocument();
  });

  it("names the team in the team-scoped create form", async () => {
    setupWindowApi({ listBeeperTeams: vi.fn().mockResolvedValue(mockTeams) });
    renderPage();
    await openTeamManager("team_uci");
    fireEvent.click(screen.getByRole("button", { name: "Nuevo busca en UCI · 9001" }));

    expect(screen.getByRole("form", { name: "Nuevo busca en UCI · 9001" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Nuevo busca en UCI · 9001" })).toBeInTheDocument();
  });

  it("filters manager candidates and distinguishes duplicate device actions", async () => {
    const importedDuplicate = { ...mockImportedRecords[0], id: "ibsc_00000003", sourceRow: 9 };
    setupWindowApi({
      listImportedBeepers: vi.fn().mockResolvedValue([...mockImportedRecords, importedDuplicate]),
      listBeeperTeams: vi.fn().mockResolvedValue(mockTeams)
    });
    renderPage();
    await openTeamManager("team_uci");
    fireEvent.change(screen.getByLabelText("Buscar busca"), { target: { value: "5001" } });
    expect(screen.getByRole("button", { name: "Añadir al equipo 5001 · Principal, Buscas_Facultativos fila 2" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Añadir al equipo 5001 · Principal, Buscas_Facultativos fila 9" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Buscar busca"), { target: { value: "Luis" } });
    expect(screen.getByRole("button", { name: "Añadir al equipo B-002 · Luis Pérez" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Añadir al equipo 5001/ })).not.toBeInTheDocument();
  });

  it("announces the member search result count in one status region", async () => {
    setupWindowApi({ listBeeperTeams: vi.fn().mockResolvedValue(mockTeams) });
    renderPage();
    await openTeamManager("team_uci");
    const search = screen.getByLabelText("Buscar busca");

    fireEvent.change(search, { target: { value: "B-0" } });
    const status = screen.getByText("2 buscas coinciden");
    expect(status).toHaveAttribute("role", "status");
    expect(status).toHaveAttribute("aria-atomic", "true");

    fireEvent.change(search, { target: { value: "B-001" } });
    expect(screen.getByText("1 busca coincide")).toBe(status);

    fireEvent.change(search, { target: { value: "sin coincidencia" } });
    expect(screen.getByText("Sin buscas que coincidan")).toBe(status);
    expect(status).not.toContainElement(screen.getByRole("button", { name: "Limpiar búsqueda" }));
  });

  it("guides the user when a team member search has no matches", async () => {
    setupWindowApi({ listBeeperTeams: vi.fn().mockResolvedValue(mockTeams) });
    renderPage();
    await openTeamManager("team_uci");
    expect(screen.queryAllByRole("button", { name: /(?:Añadir|Quitar) del equipo/ })).toHaveLength(0);
    expect(screen.getByText(/Este equipo aún no tiene buscas\./)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Buscar busca"), { target: { value: "sin coincidencia" } });
    expect(screen.getAllByRole("status").some((status) => status.textContent === "Sin buscas que coincidan")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Limpiar búsqueda" }));
    expect(screen.getByText(/Busca por número o titular para añadir buscas al equipo\./)).toBeInTheDocument();
    expect(screen.queryAllByRole("button", { name: /(?:Añadir|Quitar) del equipo/ })).toHaveLength(0);
    await waitFor(() => expect(screen.getByLabelText("Buscar busca")).toHaveFocus());
  });

  it("explains that there are no buscas to assign when the registry is empty", async () => {
    setupWindowApi({
      listBeepers: vi.fn().mockResolvedValue([]),
      listBeeperTeams: vi.fn().mockResolvedValue(mockTeams)
    });
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "Gestionar equipos" }));
    fireEvent.change(screen.getByLabelText("Equipo a gestionar"), { target: { value: "team_uci" } });

    expect(screen.getByText("No hay buscas registrados para asignar a este equipo.")).toBeInTheDocument();
  });

  it("shows the load error and hides team management when memberships could not be loaded", async () => {
    setupWindowApi({
      listBeeperTeams: vi.fn().mockResolvedValue(mockTeams),
      listBeeperTeamMemberships: vi.fn().mockRejectedValue(new Error("read failed"))
    });
    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudieron cargar los buscas o los equipos.");
    expect(screen.queryByRole("button", { name: "Gestionar equipos" })).not.toBeInTheDocument();
  });

  it("shows a retryable load error when teams could not be loaded", async () => {
    setupWindowApi({
      listBeeperTeams: vi.fn().mockRejectedValue(new Error("read failed"))
    });
    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudieron cargar los buscas o los equipos.");
    expect(screen.queryByRole("button", { name: "Gestionar equipos" })).not.toBeInTheDocument();
  });

  it("shows a duplicate team number error beside the number field", async () => {
    setupWindowApi({
      addBeeperTeam: vi.fn().mockRejectedValue(new Error("El número de equipo ya está registrado."))
    });
    renderPage("/beeper/new");
    await openTeamCreateForm();
    fireEvent.change(screen.getByLabelText(/Nombre del equipo/i), { target: { value: "UCI" } });
    fireEvent.change(screen.getByLabelText(/Número del equipo/i), { target: { value: "9001" } });
    fireEvent.submit(screen.getByRole("form", { name: "Nuevo equipo" }));

    const input = screen.getByLabelText(/Número del equipo/i);
    await waitFor(() => expect(input).toHaveAttribute("aria-invalid", "true"));
    expect(input).toHaveAccessibleDescription("El número de equipo ya está registrado.");
  });

  it("shows inline errors for whitespace-only team fields", async () => {
    renderPage("/beeper/new");
    await openTeamCreateForm();
    fireEvent.change(screen.getByLabelText(/Nombre del equipo/i), { target: { value: "   " } });
    fireEvent.change(screen.getByLabelText(/Número del equipo/i), { target: { value: "   " } });
    fireEvent.submit(screen.getByRole("form", { name: "Nuevo equipo" }));

    expect(screen.getByLabelText(/Nombre del equipo/i)).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText(/Nombre del equipo/i)).toHaveAccessibleDescription("El nombre del equipo es obligatorio.");
    expect(screen.getByLabelText(/Número del equipo/i)).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText(/Número del equipo/i)).toHaveAccessibleDescription("El número del equipo es obligatorio.");
  });

  it("shows inline errors for oversized team fields", async () => {
    renderPage("/beeper/new");
    await openTeamCreateForm();
    fireEvent.change(screen.getByLabelText(/Nombre del equipo/i), { target: { value: "n".repeat(256) } });
    fireEvent.change(screen.getByLabelText(/Número del equipo/i), { target: { value: "9".repeat(256) } });
    fireEvent.submit(screen.getByRole("form", { name: "Nuevo equipo" }));

    expect(screen.getByLabelText(/Nombre del equipo/i)).toHaveAccessibleDescription("El nombre del equipo no puede superar 255 caracteres.");
    expect(screen.getByLabelText(/Número del equipo/i)).toHaveAccessibleDescription("El número del equipo no puede superar 255 caracteres.");
  });

  it("edits the selected team", async () => {
    const updated = { ...mockTeams[0], name: "UCI adultos", displayId: "9002" };
    setupWindowApi({
      listBeeperTeams: vi.fn().mockResolvedValue(mockTeams),
      updateBeeperTeam: vi.fn().mockResolvedValue(updated)
    });
    renderPage();
    await screen.findByText("B-001");
    fireEvent.click(screen.getByRole("button", { name: "Gestionar equipos" }));
    fireEvent.change(screen.getByLabelText("Equipo a gestionar"), { target: { value: "team_uci" } });
    fireEvent.change(screen.getByLabelText(/Nombre del equipo/i), { target: { value: "UCI adultos" } });
    fireEvent.change(screen.getByLabelText(/Número del equipo/i), { target: { value: "9002" } });
    fireEvent.submit(screen.getByRole("form", { name: "Editar equipo" }));

    await waitFor(() => expect(window.hospitalDirectory.updateBeeperTeam).toHaveBeenCalledWith("team_uci", { name: "UCI adultos", displayId: "9002" }));
    expect(screen.getAllByText("UCI adultos · 9002")).not.toHaveLength(0);
  });

  it("confirms and deletes the selected team without deleting its buscas", async () => {
    setupWindowApi({
      listBeeperTeams: vi.fn().mockResolvedValue(mockTeams),
      deleteBeeperTeam: vi.fn().mockResolvedValue(undefined)
    });
    renderPage();
    await screen.findByText("B-001");
    fireEvent.click(screen.getByRole("button", { name: "Gestionar equipos" }));
    fireEvent.change(screen.getByLabelText("Equipo a gestionar"), { target: { value: "team_uci" } });
    fireEvent.click(screen.getByRole("button", { name: "Eliminar equipo" }));
    expect(screen.getByText("Confirmar eliminación del equipo")).toBeInTheDocument();
    expect(screen.getByText(/Los buscas seguirán disponibles de forma individual/)).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Eliminar equipo" }));

    await waitFor(() => expect(window.hospitalDirectory.deleteBeeperTeam).toHaveBeenCalledWith("team_uci"));
    expect(screen.queryByText("UCI · 9001")).not.toBeInTheDocument();
    expect(screen.getByText("B-001")).toBeInTheDocument();
  });

  it("shows the members panel for a new team without leaving /beeper/new", async () => {
    setupWindowApi({ addBeeperTeam: vi.fn().mockResolvedValue(newTeam) });
    renderPage("/beeper/new");
    await saveNewTeamFromChooser();

    expect(window.hospitalDirectory.addBeeperTeam).toHaveBeenCalledWith({ name: "Quirófano", displayId: "9010" });
    expect(screen.getByRole("heading", { name: "Equipo Quirófano · 9010" })).toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "Nuevo equipo" })).not.toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "Editar equipo" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Eliminar equipo" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancelar" })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText("Buscar busca")).toHaveFocus());
    // ToastProvider dedupes identical toasts, so "exactly once" cannot be asserted from the DOM.
    expect(screen.getByText("Equipo guardado.")).toBeInTheDocument();
    expectPathname("/beeper/new");
  });

  it("adds an existing busca to the new team from the database", async () => {
    setupWindowApi({
      addBeeperTeam: vi.fn().mockResolvedValue(newTeam),
      setBeeperTeamMembers: vi.fn().mockResolvedValue([{ teamId: "team_new", beeperId: "bsc_001" }])
    });
    renderPage("/beeper/new");
    await saveNewTeamFromChooser();

    fireEvent.change(screen.getByLabelText("Buscar busca"), { target: { value: "B-001" } });
    fireEvent.click(screen.getByRole("button", { name: "Añadir al equipo B-001 · Ana García" }));

    await waitFor(() => expect(window.hospitalDirectory.setBeeperTeamMembers).toHaveBeenCalledWith("team_new", ["bsc_001"]));
    expect(await screen.findByRole("button", { name: "Quitar del equipo B-001 · Ana García" })).toBeInTheDocument();
    expectPathname("/beeper/new");
  });

  it("adds an imported busca to the new team", async () => {
    setupWindowApi({
      listImportedBeepers: vi.fn().mockResolvedValue(mockImportedRecords),
      addBeeperTeam: vi.fn().mockResolvedValue(newTeam),
      setBeeperTeamMembers: vi.fn().mockResolvedValue([{ teamId: "team_new", beeperId: "ibsc_00000001" }])
    });
    renderPage("/beeper/new");
    await saveNewTeamFromChooser();

    fireEvent.change(screen.getByLabelText("Buscar busca"), { target: { value: "5001" } });
    fireEvent.click(screen.getByRole("button", { name: "Añadir al equipo 5001 · Principal, Buscas_Facultativos fila 2" }));

    await waitFor(() => expect(window.hospitalDirectory.setBeeperTeamMembers).toHaveBeenCalledWith("team_new", ["ibsc_00000001"]));
  });

  it("creates a busca for the new team, links it and stays on /beeper/new without a toast", async () => {
    setupWindowApi({
      addBeeperTeam: vi.fn().mockResolvedValue(newTeam),
      addBeeper: vi.fn().mockResolvedValue({ ...mockRecords[0], id: "bsc_003", deviceNumber: "B-003" }),
      setBeeperTeamMembers: vi.fn().mockResolvedValue([{ teamId: "team_new", beeperId: "bsc_003" }])
    });
    renderPage("/beeper/new");
    await saveNewTeamFromChooser();

    fireEvent.click(screen.getByRole("button", { name: "Nuevo busca en Quirófano · 9010" }));
    const form = screen.getByRole("form", { name: "Nuevo busca en Quirófano · 9010" });
    fireEvent.change(screen.getByLabelText(/número de busca/i), { target: { value: "B-003" } });
    fireEvent.change(screen.getByLabelText(/asignado a/i), { target: { value: "Marta Ruiz" } });
    fireEvent.change(form.querySelector("#form-department")!, { target: { value: "Planta 2" } });
    fireEvent.change(form.querySelector("#form-role")!, { target: { value: "Auxiliar" } });
    fireEvent.submit(form);

    await waitFor(() => expect(window.hospitalDirectory.setBeeperTeamMembers).toHaveBeenCalledWith("team_new", ["bsc_003"]));
    expect(await screen.findByText("B-003 creado y añadido al equipo Quirófano · 9010")).toBeInTheDocument();
    expectPathname("/beeper/new");
    expect(screen.queryByText("Busca guardado.")).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Nuevo busca en Quirófano · 9010" })).toHaveFocus());
  });

  it("cancelling the team-scoped busca form keeps the members panel", async () => {
    setupWindowApi({ addBeeperTeam: vi.fn().mockResolvedValue(newTeam) });
    renderPage("/beeper/new");
    await saveNewTeamFromChooser();
    fireEvent.click(screen.getByRole("button", { name: "Nuevo busca en Quirófano · 9010" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    expect(screen.getByRole("heading", { name: "Buscas del equipo" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Nuevo equipo" })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Nuevo busca en Quirófano · 9010" })).toHaveFocus());
  });

  it("focuses the member search after saving a team even if animation frames run immediately", async () => {
    // An animation frame queued while saving would fire before the members panel is
    // committed; the focus must come from the commit that mounts the input.
    const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 0;
    });
    try {
      setupWindowApi({ addBeeperTeam: vi.fn().mockResolvedValue(newTeam) });
      renderPage("/beeper/new");
      await saveNewTeamFromChooser();

      expect(screen.getByLabelText("Buscar busca")).toHaveFocus();
    } finally {
      raf.mockRestore();
    }
  });

  it("'Listo' leaves the members panel for /beeper", async () => {
    setupWindowApi({ addBeeperTeam: vi.fn().mockResolvedValue(newTeam) });
    renderPage("/beeper/new");
    await saveNewTeamFromChooser();

    fireEvent.click(screen.getByRole("button", { name: "Listo" }));

    expectPathname("/beeper");
  });

  it("disables 'Listo' while a busca form is open", async () => {
    setupWindowApi({ addBeeperTeam: vi.fn().mockResolvedValue(newTeam) });
    renderPage("/beeper/new");
    await saveNewTeamFromChooser();
    const done = screen.getByRole("button", { name: "Listo" });
    expect(done).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Nuevo busca en Quirófano · 9010" }));

    expect(done).toBeDisabled();
    expect(done).toHaveAccessibleDescription("Crea o cancela el busca para seguir con el equipo.");
  });

  it("keeps 'Listo' disabled and ignores Escape while a member update is saving", async () => {
    let resolveSave: (value: Array<{ teamId: string; beeperId: string }>) => void = () => undefined;
    setupWindowApi({
      addBeeperTeam: vi.fn().mockResolvedValue(newTeam),
      setBeeperTeamMembers: vi.fn().mockReturnValue(new Promise((resolve) => { resolveSave = resolve; }))
    });
    renderPage("/beeper/new");
    await saveNewTeamFromChooser();
    fireEvent.change(screen.getByLabelText("Buscar busca"), { target: { value: "B-001" } });
    const add = screen.getByRole("button", { name: "Añadir al equipo B-001 · Ana García" });
    fireEvent.click(add);

    await waitFor(() => expect(screen.getByRole("button", { name: "Listo" })).toBeDisabled());
    fireEvent.keyDown(add, { key: "Escape" });
    expectPathname("/beeper/new");

    resolveSave([{ teamId: "team_new", beeperId: "bsc_001" }]);
    await waitFor(() => expect(screen.getByRole("button", { name: "Listo" })).toBeEnabled());
  });

  it("Escape on a members-panel button leaves to /beeper, but not from the member search box", async () => {
    setupWindowApi({ addBeeperTeam: vi.fn().mockResolvedValue(newTeam) });
    renderPage("/beeper/new");
    await saveNewTeamFromChooser();

    fireEvent.keyDown(screen.getByLabelText("Buscar busca"), { key: "Escape" });
    expectPathname("/beeper/new");

    fireEvent.keyDown(screen.getByRole("button", { name: "Listo" }), { key: "Escape" });
    expectPathname("/beeper");
  });

  it("restores focus to the trigger even when the animation frame fires before React commits", async () => {
    // Run animation frames immediately, i.e. before the commit that closes the form
    // and re-enables the (disabled-while-open) trigger.
    const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 0;
    });
    try {
      setupWindowApi({
        listBeeperTeams: vi.fn().mockResolvedValue(mockTeams),
        addBeeper: vi.fn().mockResolvedValue({ ...mockRecords[0], id: "bsc_003", deviceNumber: "B-003" }),
        setBeeperTeamMembers: vi.fn().mockResolvedValue([{ teamId: "team_uci", beeperId: "bsc_003" }])
      });
      renderPage();
      await openTeamManager("team_uci");
      createBuscaFromTeam("B-003");

      await waitFor(() => expect(window.hospitalDirectory.setBeeperTeamMembers).toHaveBeenCalled());
      await waitFor(() => expect(screen.getByRole("button", { name: "Nuevo busca en UCI · 9001" })).toHaveFocus());
    } finally {
      raf.mockRestore();
    }
  });

  it("creates an individual Busca from a team and links it", async () => {
    const created = { ...mockRecords[0], id: "bsc_003", deviceNumber: "B-003" };
    setupWindowApi({
      listBeeperTeams: vi.fn().mockResolvedValue(mockTeams),
      addBeeper: vi.fn().mockResolvedValue(created),
      setBeeperTeamMembers: vi.fn().mockResolvedValue([{ teamId: "team_uci", beeperId: "bsc_003" }])
    });
    renderPage();
    await openTeamManager("team_uci");
    createBuscaFromTeam("B-003");

    await waitFor(() => expect(window.hospitalDirectory.setBeeperTeamMembers).toHaveBeenCalledWith("team_uci", ["bsc_003"]));
    await waitFor(() => expect(screen.getByRole("button", { name: "Nuevo busca en UCI · 9001" })).toHaveFocus());
  });

  it("announces a busca created from a team and added to it", async () => {
    setupWindowApi({
      listBeeperTeams: vi.fn().mockResolvedValue(mockTeams),
      addBeeper: vi.fn().mockResolvedValue({ ...mockRecords[0], id: "bsc_003", deviceNumber: "B-003" }),
      setBeeperTeamMembers: vi.fn().mockResolvedValue([{ teamId: "team_uci", beeperId: "bsc_003" }])
    });
    renderPage();
    await openTeamManager("team_uci");
    createBuscaFromTeam("B-003");

    expect(await screen.findByText("B-003 creado y añadido al equipo UCI · 9001")).toHaveAttribute("role", "status");
  });

  it("keeps a newly created Busca available when its team link fails", async () => {
    const created = { ...mockRecords[0], id: "bsc_003", deviceNumber: "B-003" };
    const setMembers = vi.fn().mockRejectedValueOnce(new Error("link failed")).mockResolvedValueOnce([{ teamId: "team_uci", beeperId: "bsc_003" }]);
    setupWindowApi({
      listBeeperTeams: vi.fn().mockResolvedValue(mockTeams),
      addBeeper: vi.fn().mockResolvedValue(created),
      setBeeperTeamMembers: setMembers
    });
    renderPage();
    await openTeamManager("team_uci");
    createBuscaFromTeam("B-003");
    expect(await screen.findByRole("alert")).toHaveTextContent("El busca se creó");
    expect(screen.getAllByText("B-003")).not.toHaveLength(0);
    fireEvent.change(screen.getByLabelText("Buscar busca"), { target: { value: "B-003" } });
    fireEvent.click(screen.getByRole("button", { name: "Añadir al equipo B-003 · Ana García" }));
    await waitFor(() => expect(setMembers).toHaveBeenLastCalledWith("team_uci", ["bsc_003"]));
    expect(window.hospitalDirectory.addBeeper).toHaveBeenCalledTimes(1);
  });

  it("replaces the earlier creation announcement when a later scoped create fails to link", async () => {
    setupWindowApi({
      listBeeperTeams: vi.fn().mockResolvedValue(mockTeams),
      addBeeper: vi.fn()
        .mockResolvedValueOnce({ ...mockRecords[0], id: "bsc_003", deviceNumber: "B-003" })
        .mockResolvedValueOnce({ ...mockRecords[0], id: "bsc_004", deviceNumber: "B-004" }),
      setBeeperTeamMembers: vi.fn()
        .mockResolvedValueOnce([{ teamId: "team_uci", beeperId: "bsc_003" }])
        .mockRejectedValueOnce(new Error("link failed"))
    });
    renderPage();
    await openTeamManager("team_uci");
    createBuscaFromTeam("B-003");
    await screen.findByText("B-003 creado y añadido al equipo UCI · 9001");

    createBuscaFromTeam("B-004");

    expect(await screen.findByRole("alert")).toHaveTextContent("El busca se creó");
    expect(screen.queryByText("B-003 creado y añadido al equipo UCI · 9001")).not.toBeInTheDocument();
  });

  it("clears an earlier member error when a scoped create succeeds", async () => {
    setupWindowApi({
      listBeeperTeams: vi.fn().mockResolvedValue(mockTeams),
      addBeeper: vi.fn().mockResolvedValue({ ...mockRecords[0], id: "bsc_003", deviceNumber: "B-003" }),
      setBeeperTeamMembers: vi.fn()
        .mockRejectedValueOnce(new Error("save failed"))
        .mockResolvedValueOnce([{ teamId: "team_uci", beeperId: "bsc_003" }])
    });
    renderPage();
    await openTeamManager("team_uci");
    fireEvent.change(screen.getByLabelText("Buscar busca"), { target: { value: "B-001" } });
    fireEvent.click(screen.getByRole("button", { name: "Añadir al equipo B-001 · Ana García" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("save failed");

    createBuscaFromTeam("B-003");

    await screen.findByText("B-003 creado y añadido al equipo UCI · 9001");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("opens the busca form from the chooser's 'Nuevo busca'", async () => {
    renderPage("/beeper/new");
    await openBuscaForm();
    expect(screen.getByRole("form", { name: /Nuevo busca/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/número de busca/i)).toBeInTheDocument();
  });

  it("cancelling the busca form returns to the chooser without saving", async () => {
    renderPage("/beeper/new");
    await openBuscaForm();
    fireEvent.click(screen.getByRole("button", { name: /cancelar/i }));
    expect(screen.queryByRole("form", { name: /Nuevo busca/i })).not.toBeInTheDocument();
    expect(window.hospitalDirectory.addBeeper).not.toHaveBeenCalled();
    expectPathname("/beeper/new");
    const heading = screen.getByRole("heading", { name: "Gestión Buscas" });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(screen.getByRole("button", { name: "Nuevo equipo" })).toBeInTheDocument();
  });

  it("creates a new beeper on form submit", async () => {
    const newRecord: BeeperRecord = {
      id: "bsc_003",
      deviceNumber: "B-003",
      assignedTo: "Marta Ruiz",
      department: "Planta 2",
      role: "Auxiliar",
      shift: "noche"
    };
    setupWindowApi({ addBeeper: vi.fn().mockResolvedValue(newRecord) });
    renderPage("/beeper/new");
    await openBuscaForm();

    const form = screen.getByRole("form", { name: /Nuevo busca/i });
    fireEvent.change(screen.getByLabelText(/número de busca/i), { target: { value: "B-003" } });
    fireEvent.change(screen.getByLabelText(/asignado a/i), { target: { value: "Marta Ruiz" } });
    // Use the form-department input directly to avoid table column header ambiguity
    fireEvent.change(form.querySelector("#form-department")!, { target: { value: "Planta 2" } });
    // "Rol" uniquely matches the label (table header is "Rol" too — use id)
    fireEvent.change(form.querySelector("#form-role")!, { target: { value: "Auxiliar" } });
    const optionalDetails = screen.getByText("Turno y grupo (opcional)").closest("details") as HTMLDetailsElement;
    expect(optionalDetails.open).toBe(false);
    fireEvent.click(screen.getByText("Turno y grupo (opcional)"));
    expect(optionalDetails.open).toBe(true);
    fireEvent.click(screen.getByLabelText(/turno/i));
    fireEvent.click(screen.getByRole("option", { name: "Noche" }));

    fireEvent.submit(form);

    await waitFor(() => {
      expect(window.hospitalDirectory.addBeeper).toHaveBeenCalledWith(
        expect.objectContaining({ deviceNumber: "B-003", shift: "noche" })
      );
      expect(screen.getByText("B-003")).toBeInTheDocument();
    });
    await waitFor(() => expectPathname("/beeper"));
  });

  it("keeps the default shift when creating from the main fields", async () => {
    setupWindowApi({ addBeeper: vi.fn().mockResolvedValue({ ...mockRecords[0], deviceNumber: "B-003" }) });
    renderPage("/beeper/new");
    await openBuscaForm();

    const form = screen.getByRole("form", { name: /Nuevo busca/i });
    expect((screen.getByText("Turno y grupo (opcional)").closest("details") as HTMLDetailsElement).open).toBe(false);
    fireEvent.change(screen.getByLabelText(/número de busca/i), { target: { value: "B-003" } });
    fireEvent.change(screen.getByLabelText(/asignado a/i), { target: { value: "Marta Ruiz" } });
    fireEvent.change(form.querySelector("#form-department")!, { target: { value: "Planta 2" } });
    fireEvent.change(form.querySelector("#form-role")!, { target: { value: "Auxiliar" } });
    fireEvent.submit(form);

    await waitFor(() => expect(window.hospitalDirectory.addBeeper).toHaveBeenCalledWith(
      expect.objectContaining({ deviceNumber: "B-003", shift: "mañana", group: "" })
    ));
  });

  it("sanitizes IPC error boilerplate when addBeeper rejects", async () => {
    setupWindowApi({
      addBeeper: vi
        .fn()
        .mockRejectedValue(
          new Error(
            "Error invoking remote method 'beepers:add': Error: El número de busca ya existe."
          )
        )
    });
    renderPage("/beeper/new");
    await openBuscaForm();

    const form = screen.getByRole("form", { name: /Nuevo busca/i });
    fireEvent.change(screen.getByLabelText(/número de busca/i), { target: { value: "B-003" } });
    fireEvent.change(screen.getByLabelText(/asignado a/i), { target: { value: "Marta Ruiz" } });
    fireEvent.change(form.querySelector("#form-department")!, { target: { value: "Planta 2" } });
    fireEvent.change(form.querySelector("#form-role")!, { target: { value: "Auxiliar" } });
    fireEvent.change(screen.getByLabelText(/turno/i), { target: { value: "noche" } });

    fireEvent.submit(form);

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("El número de busca ya existe.");
    });
    // The raw Electron IPC boilerplate must never reach the user
    expect(screen.queryByText(/Error invoking remote method/)).not.toBeInTheDocument();
  });

  it("opens edit form pre-populated with record data", async () => {
    renderPage();
    await waitFor(() => screen.getByText("B-001"));
    fireEvent.click(screen.getByRole("button", { name: /editar busca B-001/i }));

    const numberInput = screen.getByLabelText(/número de busca/i) as HTMLInputElement;
    expect(numberInput.value).toBe("B-001");
    const assignedInput = screen.getByLabelText(/asignado a/i) as HTMLInputElement;
    expect(assignedInput.value).toBe("Ana García");
    expect((screen.getByText("Turno y grupo (opcional)").closest("details") as HTMLDetailsElement).open).toBe(true);
    expect(screen.getByLabelText(/^Grupo$/i)).toHaveValue("Equipo A");
  });

  it("updates a beeper on edit form submit", async () => {
    const updated: BeeperRecord = { ...mockRecords[0]!, assignedTo: "Ana Actualizada" };
    setupWindowApi({ updateBeeper: vi.fn().mockResolvedValue(updated) });
    renderPage();
    await waitFor(() => screen.getByText("B-001"));
    fireEvent.click(screen.getByRole("button", { name: /editar busca B-001/i }));

    fireEvent.change(screen.getByLabelText(/asignado a/i), { target: { value: "Ana Actualizada" } });
    fireEvent.submit(screen.getByRole("form", { name: /Editar busca/i }));

    await waitFor(() => {
      expect(window.hospitalDirectory.updateBeeper).toHaveBeenCalledWith(
        "bsc_001",
        expect.objectContaining({ assignedTo: "Ana Actualizada" })
      );
      expect(screen.getByText("Ana Actualizada")).toBeInTheDocument();
    });
  });

  it("shows confirm dialog before deleting", async () => {
    renderPage();
    await waitFor(() => screen.getByText("B-001"));
    fireEvent.click(screen.getByRole("button", { name: /eliminar busca B-001/i }));
    expect(screen.getByText(/Confirmar eliminación/i)).toBeInTheDocument();
    expect(screen.getByText(/Estás seguro de que quieres eliminar el busca/i)).toBeInTheDocument();
  });

  it("deletes a record after confirm", async () => {
    setupWindowApi({ deleteBeeper: vi.fn().mockResolvedValue(undefined) });
    renderPage();
    await waitFor(() => screen.getByText("B-001"));
    fireEvent.click(screen.getByRole("button", { name: /eliminar busca B-001/i }));
    const confirmButton = await screen.findByRole("button", { name: /^Eliminar$/i });
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(window.hospitalDirectory.deleteBeeper).toHaveBeenCalledWith("bsc_001");
      expect(screen.queryByText("B-001")).not.toBeInTheDocument();
    });
  });

  it("drops the 'El busca se creó…' error when that busca is deleted", async () => {
    setupWindowApi({
      listBeeperTeams: vi.fn().mockResolvedValue(mockTeams),
      addBeeper: vi.fn().mockResolvedValue({ ...mockRecords[0], id: "bsc_003", deviceNumber: "B-003" }),
      setBeeperTeamMembers: vi.fn().mockRejectedValue(new Error("link failed")),
      deleteBeeper: vi.fn().mockResolvedValue(undefined)
    });
    renderPage();
    await openTeamManager("team_uci");
    createBuscaFromTeam("B-003");
    expect(await screen.findByRole("alert")).toHaveTextContent("El busca se creó");

    fireEvent.click(screen.getByRole("button", { name: /eliminar busca B-003/i }));
    fireEvent.click(await screen.findByRole("button", { name: /^Eliminar$/i }));

    await waitFor(() => expect(window.hospitalDirectory.deleteBeeper).toHaveBeenCalledWith("bsc_003"));
    await waitFor(() => expect(screen.queryByText(/El busca se creó/)).not.toBeInTheDocument());
  });

  it("drops the 'creado y añadido' announcement when that busca is deleted", async () => {
    setupWindowApi({
      listBeeperTeams: vi.fn().mockResolvedValue(mockTeams),
      addBeeper: vi.fn().mockResolvedValue({ ...mockRecords[0], id: "bsc_003", deviceNumber: "B-003" }),
      setBeeperTeamMembers: vi.fn().mockResolvedValue([{ teamId: "team_uci", beeperId: "bsc_003" }]),
      deleteBeeper: vi.fn().mockResolvedValue(undefined)
    });
    renderPage();
    await openTeamManager("team_uci");
    createBuscaFromTeam("B-003");
    await screen.findByText("B-003 creado y añadido al equipo UCI · 9001");

    fireEvent.click(screen.getByRole("button", { name: /eliminar busca B-003/i }));
    fireEvent.click(await screen.findByRole("button", { name: /^Eliminar$/i }));

    await waitFor(() => expect(screen.queryByText(/creado y añadido/)).not.toBeInTheDocument());
  });

  const deleteBuscaB002 = async () => {
    fireEvent.click(screen.getByRole("button", { name: /eliminar busca B-002/i }));
    fireEvent.click(await screen.findByRole("button", { name: /^Eliminar$/i }));
    await waitFor(() => expect(window.hospitalDirectory.deleteBeeper).toHaveBeenCalledWith("bsc_002"));
  };

  it("shows the empty-team copy after deleting the team's only member busca", async () => {
    setupWindowApi({
      listBeeperTeams: vi.fn().mockResolvedValue(mockTeams),
      listBeeperTeamMemberships: vi.fn().mockResolvedValue([{ teamId: "team_uci", beeperId: "bsc_002" }]),
      deleteBeeper: vi.fn().mockResolvedValue(undefined)
    });
    renderPage();
    await openTeamManager("team_uci");
    expect(screen.queryByText(/Este equipo aún no tiene buscas\./)).not.toBeInTheDocument();

    await deleteBuscaB002();

    expect(await screen.findByText(/Este equipo aún no tiene buscas\./)).toBeInTheDocument();
  });

  it("does not send a deleted busca's id when updating the team's members afterwards", async () => {
    const setMembers = vi.fn().mockResolvedValue([{ teamId: "team_uci", beeperId: "bsc_001" }]);
    setupWindowApi({
      listBeeperTeams: vi.fn().mockResolvedValue(mockTeams),
      listBeeperTeamMemberships: vi.fn().mockResolvedValue([{ teamId: "team_uci", beeperId: "bsc_002" }]),
      deleteBeeper: vi.fn().mockResolvedValue(undefined),
      setBeeperTeamMembers: setMembers
    });
    renderPage();
    await openTeamManager("team_uci");
    await deleteBuscaB002();

    fireEvent.change(screen.getByLabelText("Buscar busca"), { target: { value: "B-001" } });
    fireEvent.click(screen.getByRole("button", { name: "Añadir al equipo B-001 · Ana García" }));

    await waitFor(() => expect(setMembers).toHaveBeenCalledWith("team_uci", ["bsc_001"]));
  });

  it("closes confirm dialog on cancel", async () => {
    renderPage();
    await waitFor(() => screen.getByText("B-001"));
    fireEvent.click(screen.getByRole("button", { name: /eliminar busca B-001/i }));
    fireEvent.click(screen.getByRole("button", { name: /^Cancelar$/i }));
    await waitFor(() => {
      expect(screen.queryByText(/Confirmar eliminación/i)).not.toBeInTheDocument();
    });
  });

  it("shows result count", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("2 resultados")).toBeInTheDocument();
    });
  });

  it("renders at most ten rows and navigates page boundaries", async () => {
    setupWindowApi({
      listBeepers: vi.fn().mockResolvedValue(makeRecords(9)),
      listImportedBeepers: vi.fn().mockResolvedValue(mockImportedRecords)
    });
    renderPage();

    await screen.findByText("B-001");
    expect(document.querySelectorAll("tbody tr")).toHaveLength(10);
    expect(screen.queryByText("5002")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Página siguiente" }));
    expect(await screen.findByText("5002")).toBeInTheDocument();
    expect(document.querySelectorAll("tbody tr")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Página siguiente" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Página anterior" }));
    expect(await screen.findByText("B-001")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Página anterior" })).toBeDisabled();
  });

  it("resets to the first page when the search changes", async () => {
    setupWindowApi({ listBeepers: vi.fn().mockResolvedValue(makeRecords(21)) });
    renderPage();

    await screen.findByText("B-001");
    fireEvent.click(screen.getByRole("button", { name: "Página siguiente" }));
    fireEvent.click(screen.getByRole("button", { name: "Página siguiente" }));
    expect(await screen.findByText("B-021")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Buscar buscas/i), { target: { value: "Grupo Alfa" } });
    await waitFor(() => {
      expect(screen.getByText("Página 1 de 2")).toBeInTheDocument();
      expect(screen.getByText("B-001")).toBeInTheDocument();
    });
  });

  it("clamps the current page after deleting its last row", async () => {
    setupWindowApi({
      listBeepers: vi.fn().mockResolvedValue(makeRecords(11)),
      deleteBeeper: vi.fn().mockResolvedValue(undefined)
    });
    renderPage();

    await screen.findByText("B-001");
    fireEvent.click(screen.getByRole("button", { name: "Página siguiente" }));
    fireEvent.click(await screen.findByRole("button", { name: "Eliminar busca B-011" }));
    fireEvent.click(await screen.findByRole("button", { name: /^Eliminar$/i }));

    await waitFor(() => {
      expect(screen.getByText("B-001")).toBeInTheDocument();
      expect(screen.queryByRole("navigation", { name: "Paginación de buscas" })).not.toBeInTheDocument();
    });
  });

  it("restores focus to the edit button after saving", async () => {
    setupWindowApi({ updateBeeper: vi.fn().mockResolvedValue(mockRecords[0]) });
    renderPage();

    const editButton = await screen.findByRole("button", { name: "Editar busca B-001" });
    fireEvent.click(editButton);
    fireEvent.submit(screen.getByRole("form", { name: /Editar busca/i }));

    await waitFor(() => {
      expect(document.activeElement).toBe(editButton);
    });
  });

  it("disables confirm button while deletion is in progress to prevent double-submit", async () => {
    let resolveDelete!: () => void;
    const slowDelete = new Promise<void>((resolve) => {
      resolveDelete = resolve;
    });
    setupWindowApi({ deleteBeeper: vi.fn().mockReturnValueOnce(slowDelete) });

    renderPage();
    await waitFor(() => screen.getByText("B-001"));
    fireEvent.click(screen.getByRole("button", { name: /eliminar busca B-001/i }));

    const confirmButton = await screen.findByRole("button", { name: /^Eliminar$/i });
    fireEvent.click(confirmButton);

    // While the async delete is in flight the button must be disabled
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Eliminando/i })).toBeDisabled();
    });

    // Let the delete complete
    resolveDelete();
    await waitFor(() => {
      expect(screen.queryByText("B-001")).not.toBeInTheDocument();
    });
  });

  it("prevents Cancel button and Escape from firing while delete is in-flight", async () => {
    let resolveDelete!: () => void;
    const slowDelete = new Promise<void>((resolve) => {
      resolveDelete = resolve;
    });
    setupWindowApi({ deleteBeeper: vi.fn().mockReturnValueOnce(slowDelete) });

    renderPage();
    await waitFor(() => screen.getByText("B-001"));
    fireEvent.click(screen.getByRole("button", { name: /eliminar busca B-001/i }));

    const confirmButton = await screen.findByRole("button", { name: /^Eliminar$/i });
    fireEvent.click(confirmButton);

    // While in-flight: Cancel button must be disabled
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Eliminando/i })).toBeDisabled();
    });
    const cancelButton = screen.getByRole("button", { name: /^Cancelar$/i });
    expect(cancelButton).toBeDisabled();

    // Clicking the disabled Cancel button must not close the dialog
    fireEvent.click(cancelButton);
    expect(screen.getByText(/Confirmar eliminación/i)).toBeInTheDocument();

    // Escape (dialog onCancel event) must not close the dialog while in-flight
    const dialog = screen.getByRole("dialog");
    fireEvent(dialog, new Event("cancel", { bubbles: false, cancelable: true }));
    expect(screen.getByText(/Confirmar eliminación/i)).toBeInTheDocument();

    // Let the delete complete — dialog should close naturally
    resolveDelete();
    await waitFor(() => {
      expect(screen.queryByText("B-001")).not.toBeInTheDocument();
    });
  });

  it("prevents Cancel and form dismissal while save is in-flight", async () => {
    let resolveSave!: (value: BeeperRecord) => void;
    const slowUpdate = new Promise<BeeperRecord>((resolve) => {
      resolveSave = resolve;
    });
    setupWindowApi({ updateBeeper: vi.fn().mockReturnValueOnce(slowUpdate) });

    renderPage();
    await waitFor(() => screen.getByText("B-001"));

    // Open the edit form for B-001
    fireEvent.click(screen.getByRole("button", { name: /editar busca B-001/i }));
    const form = screen.getByRole("form", { name: /Editar busca/i });

    // Submit — save is now in-flight
    fireEvent.submit(form);

    // While in-flight: Cancel button must be disabled
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Guardando/i })).toBeDisabled();
    });
    const cancelButton = screen.getByRole("button", { name: /^Cancelar$/i });
    expect(cancelButton).toBeDisabled();

    // Clicking the disabled Cancel button must not dismiss the form
    fireEvent.click(cancelButton);
    expect(screen.getByRole("form", { name: /Editar busca/i })).toBeInTheDocument();

    // Table row action buttons must be disabled while saving
    expect(screen.getByRole("button", { name: /editar busca B-002/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /eliminar busca B-002/i })).toBeDisabled();

    // Let the save complete — form should close
    resolveSave({ ...mockRecords[0], assignedTo: "Ana García Ruiz" });
    await waitFor(() => {
      expect(screen.queryByRole("form", { name: /Editar busca/i })).not.toBeInTheDocument();
    });

    // Controls must be re-enabled after save
    expect(screen.getByRole("button", { name: /editar busca B-002/i })).not.toBeDisabled();
  });

  it("prevents double-submit on rapid form submit events", async () => {
    let resolveSave!: (value: BeeperRecord) => void;
    const newRecord: BeeperRecord = {
      id: "bsc_004",
      deviceNumber: "B-004",
      assignedTo: "Carlos Díaz",
      department: "Radiología",
      role: "Técnico",
      shift: "mañana"
    };
    const slowAdd = new Promise<BeeperRecord>((resolve) => {
      resolveSave = resolve;
    });
    const addBeeperMock = vi.fn().mockReturnValueOnce(slowAdd);
    setupWindowApi({ addBeeper: addBeeperMock });

    renderPage("/beeper/new");
    await openBuscaForm();
    const form = screen.getByRole("form", { name: /Nuevo busca/i });

    // Fill required fields
    fireEvent.change(screen.getByLabelText(/número de busca/i), { target: { value: "B-004" } });
    fireEvent.change(screen.getByLabelText(/asignado a/i), { target: { value: "Carlos Díaz" } });
    fireEvent.change(form.querySelector("#form-department")!, { target: { value: "Radiología" } });
    fireEvent.change(form.querySelector("#form-role")!, { target: { value: "Técnico" } });

    // Fire two submit events in rapid succession
    fireEvent.submit(form);
    fireEvent.submit(form);

    // Wait for saving state to confirm first submit was processed
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Guardando/i })).toBeDisabled();
    });

    // Only one service call must have been made despite two submit events
    expect(addBeeperMock).toHaveBeenCalledTimes(1);

    // Resolve the save and confirm the record appears
    resolveSave(newRecord);
    await waitFor(() => {
      expect(screen.queryByRole("form", { name: /Nuevo busca/i })).not.toBeInTheDocument();
      expect(screen.getByText("B-004")).toBeInTheDocument();
    });

    // addBeeper must still have been called exactly once
    expect(addBeeperMock).toHaveBeenCalledTimes(1);
  });

  it("shows manual beepers even when listImportedBeepers rejects — no error state", async () => {
    setupWindowApi({
      listImportedBeepers: vi.fn().mockRejectedValue(new Error("ODS store unavailable"))
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("B-001")).toBeInTheDocument();
      expect(screen.getByText("B-002")).toBeInTheDocument();
    });
    // Must not show the error/retry state
    expect(screen.queryByRole("button", { name: /reintentar/i })).not.toBeInTheDocument();
    // No ODS rows should appear
    expect(screen.queryByText("ODS")).not.toBeInTheDocument();
  });

  it("shows imported ODS records in the simplified table with edit actions", async () => {
    setupWindowApi({
      listImportedBeepers: vi.fn().mockResolvedValue(mockImportedRecords)
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("5001")).toBeInTheDocument();
      expect(screen.getByText("5002")).toBeInTheDocument();
      expect(screen.getByText("Principal")).toBeInTheDocument();
      expect(screen.getByText("Residente")).toBeInTheDocument();
    });
    expect(screen.queryByRole("columnheader", { name: /Turno|Origen/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: /Grupo|Hoja/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Editar busca 5001" })).toBeInTheDocument();
  });

  it("edits an imported ODS record from the actions column", async () => {
    const updatedRecord: ImportedBeeperRecord = {
      ...mockImportedRecords[0]!,
      deviceNumber: "5009",
      department: "Cardiología Intervencionista"
    };
    const updateImportedBeeper = vi.fn().mockResolvedValue(updatedRecord);
    setupWindowApi({
      listImportedBeepers: vi.fn().mockResolvedValue(mockImportedRecords),
      updateImportedBeeper
    });
    renderPage();

    await waitFor(() => screen.getByRole("button", { name: "Editar busca 5001" }));
    fireEvent.click(screen.getByRole("button", { name: "Editar busca 5001" }));
    const form = screen.getByRole("form", { name: /Editar busca/i });
    expect(screen.queryByLabelText(/^Turno$/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/^Grupo$/i)).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Número de busca/i), { target: { value: "5009" } });
    fireEvent.change(screen.getByLabelText(/Departamento/i), { target: { value: "Cardiología Intervencionista" } });
    fireEvent.submit(form);

    await waitFor(() => {
      expect(updateImportedBeeper).toHaveBeenCalledWith("ibsc_00000001", expect.objectContaining({
        deviceNumber: "5009",
        department: "Cardiología Intervencionista"
      }));
      expect(screen.getByText("5009")).toBeInTheDocument();
    });
  });

  it("includes imported records in the result count", async () => {
    setupWindowApi({
      listImportedBeepers: vi.fn().mockResolvedValue(mockImportedRecords)
    });
    renderPage();
    await waitFor(() => {
      // 2 regular + 2 imported = 4 resultados
      expect(screen.getByText("4 resultados")).toBeInTheDocument();
    });
  });

  it("filters imported records by search query", async () => {
    setupWindowApi({
      listImportedBeepers: vi.fn().mockResolvedValue(mockImportedRecords)
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("5001")).toBeInTheDocument();
    });
    fireEvent.change(screen.getByLabelText(/Buscar buscas/i), {
      target: { value: "Cardiología" }
    });
    await waitFor(() => {
      expect(screen.getByText("5001")).toBeInTheDocument();
      expect(screen.queryByText("5002")).not.toBeInTheDocument();
    });
  });

  it("deduplicates imported search rows when every visible data column matches", async () => {
    const duplicateSourceRecords: ImportedBeeperRecord[] = [
      {
        id: "ibsc_duplicate_1",
        deviceNumber: "7958",
        department: "Traumatología",
        category: "Residente/a",
        sourceSheet: "Buscas_Celadores",
        sourceRow: 2
      },
      {
        id: "ibsc_duplicate_2",
        deviceNumber: " 7958 ",
        department: " traumatología ",
        category: "residente/a",
        sourceSheet: "Buscas_Todos",
        sourceRow: 8
      },
      {
        id: "ibsc_distinct_role",
        deviceNumber: "7958",
        department: "Traumatología",
        category: "Adjunto/a",
        sourceSheet: "Buscas_Todos",
        sourceRow: 9
      },
      {
        id: "ibsc_distinct_department",
        deviceNumber: "7958",
        department: "Rehabilitación",
        category: "Residente/a",
        sourceSheet: "Buscas_Todos",
        sourceRow: 10
      },
      {
        id: "ibsc_distinct_holder_1",
        deviceNumber: "7958",
        name: "Ana García",
        department: "Traumatología",
        category: "Residente/a",
        sourceSheet: "Buscas_Todos",
        sourceRow: 11
      },
      {
        id: "ibsc_distinct_holder_2",
        deviceNumber: "7958",
        name: "Luis Pérez",
        department: "Traumatología",
        category: "Residente/a",
        sourceSheet: "Buscas_Todos",
        sourceRow: 12
      }
    ];
    setupWindowApi({
      listBeepers: vi.fn().mockResolvedValue([]),
      listImportedBeepers: vi.fn().mockResolvedValue(duplicateSourceRecords)
    });
    renderPage();

    fireEvent.change(await screen.findByLabelText(/Buscar buscas/i), {
      target: { value: "7958" }
    });

    await waitFor(() => {
      expect(screen.getByText("4 resultados")).toBeInTheDocument();
      expect(screen.getAllByText("7958")).toHaveLength(4);
      expect(screen.getAllByText("Residente/a")).toHaveLength(3);
      expect(screen.getByText("Adjunto/a")).toBeInTheDocument();
      expect(screen.getByText("Rehabilitación")).toBeInTheDocument();
      expect(screen.getByText("Ana García")).toBeInTheDocument();
      expect(screen.getByText("Luis Pérez")).toBeInTheDocument();
    });
  });

  it("merges incomplete imported search rows while retaining available details", async () => {
    setupWindowApi({
      listBeepers: vi.fn().mockResolvedValue([]),
      listImportedBeepers: vi.fn().mockResolvedValue([
        {
          id: "ibsc_7320_incomplete",
          deviceNumber: "7320",
          department: "Reumatología",
          sourceSheet: "Buscas_Todos",
          sourceRow: 2
        },
        {
          id: "ibsc_7320_complete",
          deviceNumber: " 7320 ",
          department: " reumatología ",
          category: "Doctor/a",
          sourceSheet: "Buscas_Facultativos",
          sourceRow: 8
        }
      ])
    });
    renderPage();

    fireEvent.change(await screen.findByLabelText(/Buscar buscas/i), { target: { value: "reu" } });

    await waitFor(() => {
      expect(screen.getByText("1 resultado")).toBeInTheDocument();
      expect(screen.getAllByText("7320")).toHaveLength(1);
      expect(screen.getByText("Reumatología")).toBeInTheDocument();
      expect(screen.getByText("Doctor/a")).toBeInTheDocument();
    });
  });

  it("hides an imported search row when the same visible beeper exists manually", async () => {
    setupWindowApi({
      listBeepers: vi.fn().mockResolvedValue([
        {
          id: "bsc_duplicate",
          deviceNumber: "7958",
          assignedTo: "Reumatología",
          department: "Hospitalización",
          role: "Residente/a",
          shift: "mañana"
        }
      ]),
      listImportedBeepers: vi.fn().mockResolvedValue([
        {
          id: "ibsc_duplicate",
          deviceNumber: " 7958 ",
          name: " reumatología ",
          department: " hospitalización ",
          category: "residente/a",
          sourceSheet: "Buscas_Todos",
          sourceRow: 2
        }
      ])
    });
    renderPage();

    fireEvent.change(await screen.findByLabelText(/Buscar buscas/i), { target: { value: "reu" } });

    await waitFor(() => {
      expect(screen.getByText("1 resultado")).toBeInTheDocument();
      expect(screen.getAllByText("7958")).toHaveLength(1);
    });
  });

  it("shows name/category for new-layout imported records and finds them by search", async () => {
    const newLayoutRecord: ImportedBeeperRecord = {
      id: "ibsc_00000003",
      deviceNumber: "5003",
      department: "Pediatría",
      // holderType is intentionally undefined for the new Busca 1/Busca 2
      // layout — only name/category are populated.
      name: "María López",
      category: "Enfermero/a",
      sourceSheet: "Buscas_Pediatría",
      sourceRow: 4
    };
    setupWindowApi({
      listImportedBeepers: vi.fn().mockResolvedValue([newLayoutRecord])
    });
    renderPage();

    await waitFor(() => {
      expect(screen.getByText("5003")).toBeInTheDocument();
      // Name is displayed instead of a blank "Titular" cell.
      expect(screen.getByText("María López")).toBeInTheDocument();
      // Category is shown in the role column.
      expect(screen.getByText("Enfermero/a")).toBeInTheDocument();
    });

    // Searching by name must find the record.
    fireEvent.change(screen.getByLabelText(/Buscar buscas/i), {
      target: { value: "María López" }
    });
    await waitFor(() => {
      expect(screen.getByText("5003")).toBeInTheDocument();
    });

    // Searching by category must also find the record.
    fireEvent.change(screen.getByLabelText(/Buscar buscas/i), {
      target: { value: "Enfermero" }
    });
    await waitFor(() => {
      expect(screen.getByText("5003")).toBeInTheDocument();
    });
  });

  it("table has accessible caption", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("B-001")).toBeInTheDocument();
    });
    const caption = document.querySelector("caption");
    expect(caption).not.toBeNull();
    expect(caption!.textContent).toBe("Registros de buscas");
  });

  it("focuses the first form field when the create form opens", async () => {
    renderPage("/beeper/new");
    await openBuscaForm();
    await waitFor(() => {
      const firstInput = screen.getByLabelText(/número de busca/i);
      expect(document.activeElement).toBe(firstInput);
    });
  });

  it("focuses the first form field when the edit form opens", async () => {
    renderPage();
    await waitFor(() => screen.getByText("B-001"));
    fireEvent.click(screen.getByRole("button", { name: /editar busca B-001/i }));
    await waitFor(() => {
      const firstInput = screen.getByLabelText(/número de busca/i);
      expect(document.activeElement).toBe(firstInput);
    });
  });

  it("refocuses first form field when switching between edit targets while the form is already open", async () => {
    renderPage();
    await waitFor(() => screen.getByText("B-001"));

    // Open the edit form — focus lands on first field
    fireEvent.click(screen.getByRole("button", { name: /editar busca B-001/i }));
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByLabelText(/número de busca/i));
    });

    // Move focus away to simulate user interaction
    screen.getByLabelText(/asignado a/i).focus();
    expect(document.activeElement).not.toBe(screen.getByLabelText(/número de busca/i));

    // Switch to editing B-002 while the form is still open — focus must return to first field
    fireEvent.click(screen.getByRole("button", { name: /editar busca B-002/i }));
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByLabelText(/número de busca/i));
    });
    expect(screen.getByLabelText(/número de busca/i)).toHaveValue("B-002");
  });

  it("search label and placeholder describe visible searchable fields", async () => {
    renderPage();
    await waitFor(() => screen.getByText("B-001"));
    const searchInput = screen.getByLabelText(/Buscar buscas/i);
    expect(searchInput).toHaveAttribute("placeholder", expect.stringMatching(/titular/i));
    expect(searchInput).toHaveAttribute("placeholder", expect.stringMatching(/departamento/i));
  });

  it("shows no chooser, no header 'Nuevo busca' button and no create option on /beeper", async () => {
    setupWindowApi({ listBeeperTeams: vi.fn().mockResolvedValue(mockTeams) });
    renderPage();
    await openTeamManager("team_uci");

    expect(screen.queryByRole("heading", { name: "Gestión Buscas" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Nuevo equipo" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Nuevo busca" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Registro de Buscas" })).toBeInTheDocument();
  });

  it("lists only existing teams in the select, with an 'Elige un equipo' placeholder", async () => {
    setupWindowApi({ listBeeperTeams: vi.fn().mockResolvedValue(mockTeams) });
    renderPage();
    await screen.findByText("B-001");
    fireEvent.click(screen.getByRole("button", { name: "Gestionar equipos" }));

    const options = within(screen.getByLabelText("Equipo a gestionar")).getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual(["Elige un equipo", "UCI · 9001"]);
    expect(screen.queryByLabelText(/Nombre del equipo/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Buscar busca")).not.toBeInTheDocument();
  });

  it("points to 'Gestión Buscas' when there are no teams", async () => {
    renderPage();
    await screen.findByText("B-001");

    expect(screen.getByText(/Crea uno desde/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Gestión Buscas" })).toHaveAttribute("href", "/beeper/new");
    expect(screen.queryByText(/menú lateral/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Gestionar equipos" })).not.toBeInTheDocument();
  });

  it("opens on a chooser at /beeper/new, focuses its heading and hides the list", async () => {
    renderPage("/beeper/new");

    const heading = await screen.findByRole("heading", { name: "Gestión Buscas" });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(screen.getByRole("button", { name: "Nuevo busca" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Nuevo equipo" })).toBeInTheDocument();
    expect(screen.queryByLabelText(/Buscar buscas/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Gestionar equipos" })).not.toBeInTheDocument();
  });

  it("opens the team form in create mode from the chooser and focuses its name field", async () => {
    renderPage("/beeper/new");
    await openTeamCreateForm();

    expect(screen.getByRole("form", { name: "Nuevo equipo" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText(/Nombre del equipo/i)).toHaveFocus());
    expect(screen.queryByRole("button", { name: "Eliminar equipo" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Equipo a gestionar")).not.toBeInTheDocument();
    expect(screen.queryByRole("form", { name: "Nuevo busca" })).not.toBeInTheDocument();
  });

  it("cancelling the team form returns to the chooser", async () => {
    renderPage("/beeper/new");
    await openTeamCreateForm();
    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));

    expectPathname("/beeper/new");
    expect(screen.queryByRole("form", { name: "Nuevo equipo" })).not.toBeInTheDocument();
    const heading = screen.getByRole("heading", { name: "Gestión Buscas" });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(window.hospitalDirectory.addBeeperTeam).not.toHaveBeenCalled();
  });

  it("returns to /beeper from the chooser with Cancelar or Escape", async () => {
    renderPage("/beeper/new");
    fireEvent.click(await screen.findByRole("button", { name: "Cancelar" }));
    expectPathname("/beeper");

    cleanup();
    renderPage("/beeper/new");
    const heading = await screen.findByRole("heading", { name: "Gestión Buscas" });
    fireEvent.keyDown(heading, { key: "Escape" });
    expectPathname("/beeper");
  });

  it("returns to /beeper after saving a new busca", async () => {
    setupWindowApi({ addBeeper: vi.fn().mockResolvedValue({ ...mockRecords[0], id: "bsc_003", deviceNumber: "B-003" }) });
    renderPage("/beeper/new");
    await openBuscaForm();
    const form = screen.getByRole("form", { name: "Nuevo busca" });
    fireEvent.change(screen.getByLabelText(/número de busca/i), { target: { value: "B-003" } });
    fireEvent.change(screen.getByLabelText(/asignado a/i), { target: { value: "Marta Ruiz" } });
    fireEvent.change(form.querySelector("#form-department")!, { target: { value: "Planta 2" } });
    fireEvent.change(form.querySelector("#form-role")!, { target: { value: "Auxiliar" } });
    fireEvent.submit(form);

    await waitFor(() => expectPathname("/beeper"));
  });

  it("shows a success toast after saving a busca from the chooser", async () => {
    setupWindowApi({ addBeeper: vi.fn().mockResolvedValue({ ...mockRecords[0], id: "bsc_003", deviceNumber: "B-003" }) });
    renderPage("/beeper/new");
    await openBuscaForm();
    const form = screen.getByRole("form", { name: "Nuevo busca" });
    fireEvent.change(screen.getByLabelText(/número de busca/i), { target: { value: "B-003" } });
    fireEvent.change(screen.getByLabelText(/asignado a/i), { target: { value: "Marta Ruiz" } });
    fireEvent.change(form.querySelector("#form-department")!, { target: { value: "Planta 2" } });
    fireEvent.change(form.querySelector("#form-role")!, { target: { value: "Auxiliar" } });
    fireEvent.submit(form);

    expect(await screen.findByText("Busca guardado.")).toBeInTheDocument();
  });

  it("shows no empty-state panel on /beeper/new", async () => {
    setupWindowApi({ listBeepers: vi.fn().mockResolvedValue([]) });
    renderPage("/beeper/new");

    await screen.findByRole("heading", { name: "Gestión Buscas" });
    expect(screen.queryByText("Sin registros")).not.toBeInTheDocument();
    expect(screen.queryByText(/No hay buscas registrados/)).not.toBeInTheDocument();
  });

  it("offers a link to /beeper/new when there are no buscas, but not when a search finds nothing", async () => {
    setupWindowApi({ listBeepers: vi.fn().mockResolvedValue([]) });
    renderPage();

    expect(await screen.findByText("No hay buscas registrados. Crea el primer busca o un equipo.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Crear busca o equipo" })).toHaveAttribute("href", "/beeper/new");

    fireEvent.change(screen.getByLabelText(/Buscar buscas/i), { target: { value: "zzz" } });
    expect(await screen.findByText("Sin resultados")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Crear busca o equipo" })).not.toBeInTheDocument();
  });

  describe("page title per state", () => {
    it("is 'Registro de Buscas' on /beeper, with the busca form as an h3", async () => {
      renderPage();
      await screen.findByText("B-001");
      expectSinglePageTitle("Registro de Buscas");

      fireEvent.click(screen.getByRole("button", { name: /editar busca B-001/i }));

      expectSinglePageTitle("Registro de Buscas");
      expect(screen.getByRole("heading", { name: "Editar busca", level: 3 })).toBeInTheDocument();
    });

    it("is 'Gestión Buscas' on the chooser", async () => {
      renderPage("/beeper/new");

      await screen.findByRole("button", { name: "Nuevo equipo" });
      expectSinglePageTitle("Gestión Buscas");
      expect(screen.queryByRole("group", { name: /Equipo/ })).not.toBeInTheDocument();
    });

    it("becomes the busca form title, and the chooser heading goes away", async () => {
      renderPage("/beeper/new");
      await openBuscaForm();

      expectSinglePageTitle("Nuevo busca");
      expect(screen.queryByRole("heading", { name: "Gestión Buscas" })).not.toBeInTheDocument();
      // Same size as the chooser's title, not smaller.
      expect(screen.getByRole("heading", { name: "Nuevo busca", level: 2 })).toHaveClass("text-xl");
    });

    it("becomes 'Nuevo equipo' on the team form, and the chooser heading goes away", async () => {
      renderPage("/beeper/new");
      await openTeamCreateForm();

      expectSinglePageTitle("Nuevo equipo");
      expect(screen.queryByRole("heading", { name: "Gestión Buscas" })).not.toBeInTheDocument();
      expect(screen.queryByRole("group", { name: /Equipo/ })).not.toBeInTheDocument();
    });

    it("becomes the team heading on the members panel, with h3 subsections", async () => {
      setupWindowApi({ addBeeperTeam: vi.fn().mockResolvedValue(newTeam) });
      renderPage("/beeper/new");
      await saveNewTeamFromChooser();

      expectSinglePageTitle("Equipo Quirófano · 9010");
      expect(screen.getByRole("group", { name: "Equipo Quirófano · 9010" })).toContainElement(screen.getByLabelText("Buscar busca"));
      expect(screen.queryByRole("heading", { name: "Gestión Buscas" })).not.toBeInTheDocument();
      expect(screen.getByRole("heading", { name: "Buscas del equipo", level: 3 })).toBeInTheDocument();
      expect(screen.queryByRole("heading", { level: 4 })).not.toBeInTheDocument();
    });

    it("stays the team heading while a team-scoped busca form is open", async () => {
      setupWindowApi({ addBeeperTeam: vi.fn().mockResolvedValue(newTeam) });
      renderPage("/beeper/new");
      await saveNewTeamFromChooser();
      fireEvent.click(screen.getByRole("button", { name: "Nuevo busca en Quirófano · 9010" }));

      expectSinglePageTitle("Equipo Quirófano · 9010");
      const formTitle = screen.getByRole("heading", { name: "Nuevo busca en Quirófano · 9010", level: 3 });
      expect(formTitle).toHaveClass("text-lg");
      expect(formTitle).not.toHaveClass("text-xl");
    });

    it("comes back to 'Gestión Buscas' when a form is cancelled to the chooser", async () => {
      renderPage("/beeper/new");
      await openBuscaForm();
      fireEvent.click(screen.getByRole("button", { name: /cancelar/i }));

      expectSinglePageTitle("Gestión Buscas");
    });
  });
});
