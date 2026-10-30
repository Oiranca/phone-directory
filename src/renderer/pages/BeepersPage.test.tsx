import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
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

const renderPage = () =>
  render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <ToastProvider>
        <BeepersPage />
      </ToastProvider>
    </MemoryRouter>
  );

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
      expect(screen.getByRole("alert")).toHaveTextContent("No se pudieron cargar las buscas o los equipos.");
    });
    // Retry button must be present
    expect(screen.getByRole("button", { name: /reintentar/i })).toBeInTheDocument();
    // Must NOT show the empty-dataset creation prompt
    expect(screen.queryByText(/No hay buscas registradas/)).not.toBeInTheDocument();
    // Must NOT show the "Nueva busca" button
    expect(screen.queryByRole("button", { name: /nueva busca/i })).not.toBeInTheDocument();
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
      expect(screen.getByText(/No hay buscas registradas/)).toBeInTheDocument();
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

  it("filters individual and imported buscas by team membership", async () => {
    setupWindowApi({
      listImportedBeepers: vi.fn().mockResolvedValue(mockImportedRecords),
      listBeeperTeams: vi.fn().mockResolvedValue(mockTeams),
      listBeeperTeamMemberships: vi.fn().mockResolvedValue([
        { teamId: "team_uci", beeperId: "bsc_002" },
        { teamId: "team_uci", beeperId: "ibsc_00000001" }
      ])
    });
    renderPage();
    await screen.findByText("B-001");

    fireEvent.click(screen.getByRole("button", { name: /UCI · 9001/i }));

    await waitFor(() => {
      expect(screen.getAllByText("B-001").some((item) => item.closest("table"))).toBe(false);
      expect(screen.getAllByText("B-002").some((item) => item.closest("table"))).toBe(true);
      expect(screen.getAllByText("5001").some((item) => item.closest("table"))).toBe(true);
      expect(screen.getAllByText("5002").some((item) => item.closest("table"))).toBe(false);
    });
  });

  it("removes a current member and refreshes the selected team", async () => {
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
    await screen.findByText("B-001");

    fireEvent.click(screen.getByRole("button", { name: /UCI · 9001/i }));
    fireEvent.click(screen.getByText("Miembros del equipo"));
    fireEvent.click(screen.getByRole("checkbox", { name: /B-002/i }));

    await waitFor(() => expect(setMembers).toHaveBeenCalledWith("team_uci", ["ibsc_00000001"]));
    expect(screen.getAllByText("B-002").some((item) => item.closest("table"))).toBe(false);
    expect(screen.getAllByText("5001").some((item) => item.closest("table"))).toBe(true);
  });

  it("shows a membership update error beside the member controls", async () => {
    setupWindowApi({
      listBeeperTeams: vi.fn().mockResolvedValue(mockTeams),
      listBeeperTeamMemberships: vi.fn().mockResolvedValue([{ teamId: "team_uci", beeperId: "bsc_002" }]),
      setBeeperTeamMembers: vi.fn().mockRejectedValue(new Error("save failed"))
    });
    renderPage();
    await screen.findByText("B-001");

    fireEvent.click(screen.getByRole("button", { name: /UCI · 9001/i }));
    fireEvent.click(screen.getByText("Miembros del equipo"));
    fireEvent.click(screen.getByRole("checkbox", { name: /B-002/i }));

    const members = screen.getByText("Buscas incluidas en el equipo").closest("fieldset");
    expect(members).not.toBeNull();
    await waitFor(() => expect(within(members!).getByRole("alert")).toHaveTextContent("save failed"));
  });

  it("clears a membership error when selecting another team", async () => {
    const teams = [...mockTeams, { id: "team_guardia", name: "Guardia", displayId: "9002" }];
    setupWindowApi({
      listBeeperTeams: vi.fn().mockResolvedValue(teams),
      listBeeperTeamMemberships: vi.fn().mockResolvedValue([{ teamId: "team_uci", beeperId: "bsc_002" }]),
      setBeeperTeamMembers: vi.fn().mockRejectedValue(new Error("save failed"))
    });
    renderPage();
    await screen.findByText("B-001");

    fireEvent.click(screen.getByRole("button", { name: /UCI · 9001/i }));
    fireEvent.click(screen.getByText("Miembros del equipo"));
    fireEvent.click(screen.getByRole("checkbox", { name: /B-002/i }));
    await screen.findByRole("alert", { name: "" });

    fireEvent.click(screen.getByRole("button", { name: /Guardia · 9002/i }));

    expect(screen.queryByText("save failed")).not.toBeInTheDocument();
  });

  it("guides the operator to add members when the selected team is empty", async () => {
    setupWindowApi({
      listBeeperTeams: vi.fn().mockResolvedValue(mockTeams),
      listBeeperTeamMemberships: vi.fn().mockResolvedValue([])
    });
    renderPage();
    await screen.findByText("B-001");

    fireEvent.click(screen.getByRole("button", { name: /UCI · 9001/i }));

    await waitFor(() => expect(screen.getByText("Equipo sin buscas")).toBeInTheDocument());
    expect(screen.getByText("Este equipo no tiene buscas. Añádelas en Miembros del equipo.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("shows an empty state inside team members when no buscas are registered", async () => {
    setupWindowApi({
      listBeepers: vi.fn().mockResolvedValue([]),
      listImportedBeepers: vi.fn().mockResolvedValue([]),
      listBeeperTeams: vi.fn().mockResolvedValue(mockTeams),
      listBeeperTeamMemberships: vi.fn().mockResolvedValue([])
    });
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /UCI · 9001/i }));
    fireEvent.click(screen.getByText("Miembros del equipo"));

    expect(screen.getByText("No hay buscas registradas para asignar a este equipo.")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("shows a retryable load error when memberships could not be loaded", async () => {
    const setMembers = vi.fn();
    setupWindowApi({
      listBeeperTeams: vi.fn().mockResolvedValue(mockTeams),
      listBeeperTeamMemberships: vi.fn().mockRejectedValue(new Error("read failed")),
      setBeeperTeamMembers: setMembers
    });
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudieron cargar las buscas o los equipos.");
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(setMembers).not.toHaveBeenCalled();
  });

  it("shows a retryable load error when teams could not be loaded", async () => {
    setupWindowApi({
      listBeeperTeams: vi.fn().mockRejectedValue(new Error("read failed"))
    });
    renderPage();

    expect(await screen.findByRole("alert")).toHaveTextContent("No se pudieron cargar las buscas o los equipos.");
    expect(screen.queryByRole("button", { name: "Nuevo equipo" })).not.toBeInTheDocument();
  });

  it("shows a duplicate team number error beside the number field", async () => {
    setupWindowApi({
      addBeeperTeam: vi.fn().mockRejectedValue(new Error("El número de equipo ya está registrado."))
    });
    renderPage();
    await screen.findByText("B-001");
    fireEvent.change(screen.getByLabelText(/Nombre del equipo/i), { target: { value: "UCI" } });
    fireEvent.change(screen.getByLabelText(/Número del equipo/i), { target: { value: "9001" } });
    fireEvent.submit(screen.getByRole("form", { name: "Nuevo equipo" }));

    const input = screen.getByLabelText(/Número del equipo/i);
    await waitFor(() => expect(input).toHaveAttribute("aria-invalid", "true"));
    expect(input).toHaveAccessibleDescription("El número de equipo ya está registrado.");
  });

  it("shows inline errors for whitespace-only team fields", async () => {
    renderPage();
    await screen.findByText("B-001");
    fireEvent.change(screen.getByLabelText(/Nombre del equipo/i), { target: { value: "   " } });
    fireEvent.change(screen.getByLabelText(/Número del equipo/i), { target: { value: "   " } });
    fireEvent.submit(screen.getByRole("form", { name: "Nuevo equipo" }));

    expect(screen.getByLabelText(/Nombre del equipo/i)).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText(/Nombre del equipo/i)).toHaveAccessibleDescription("El nombre del equipo es obligatorio.");
    expect(screen.getByLabelText(/Número del equipo/i)).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText(/Número del equipo/i)).toHaveAccessibleDescription("El número del equipo es obligatorio.");
  });

  it("shows inline errors for oversized team fields", async () => {
    renderPage();
    await screen.findByText("B-001");
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
    fireEvent.click(screen.getByRole("button", { name: /UCI · 9001/i }));
    fireEvent.change(screen.getByLabelText(/Nombre del equipo/i), { target: { value: "UCI adultos" } });
    fireEvent.change(screen.getByLabelText(/Número del equipo/i), { target: { value: "9002" } });
    fireEvent.submit(screen.getByRole("form", { name: "Editar equipo" }));

    await waitFor(() => expect(window.hospitalDirectory.updateBeeperTeam).toHaveBeenCalledWith("team_uci", { name: "UCI adultos", displayId: "9002" }));
    expect(screen.getByRole("button", { name: /UCI adultos · 9002/i })).toBeInTheDocument();
  });

  it("confirms and deletes the selected team without deleting its buscas", async () => {
    setupWindowApi({
      listBeeperTeams: vi.fn().mockResolvedValue(mockTeams),
      deleteBeeperTeam: vi.fn().mockResolvedValue(undefined)
    });
    renderPage();
    await screen.findByText("B-001");
    fireEvent.click(screen.getByRole("button", { name: /UCI · 9001/i }));
    fireEvent.click(screen.getByRole("button", { name: "Eliminar equipo" }));
    expect(screen.getByText("Confirmar eliminación del equipo")).toBeInTheDocument();
    expect(screen.getByText(/Las buscas seguirán disponibles de forma individual/)).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Eliminar equipo" }));

    await waitFor(() => expect(window.hospitalDirectory.deleteBeeperTeam).toHaveBeenCalledWith("team_uci"));
    expect(screen.queryByRole("button", { name: /UCI · 9001/i })).not.toBeInTheDocument();
    expect(screen.getByText("B-001")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Todas las buscas" })).toHaveAttribute("aria-pressed", "true");
  });

  it("creates a team and adds an individual Busca as a member", async () => {
    const created = { id: "team_new", name: "Quirófano", displayId: "9010" };
    setupWindowApi({
      addBeeperTeam: vi.fn().mockResolvedValue(created),
      setBeeperTeamMembers: vi.fn().mockResolvedValue([{ teamId: "team_new", beeperId: "bsc_001" }])
    });
    renderPage();
    await screen.findByText("B-001");

    fireEvent.change(screen.getByLabelText(/Nombre del equipo/i), { target: { value: "Quirófano" } });
    fireEvent.change(screen.getByLabelText(/Número del equipo/i), { target: { value: "9010" } });
    fireEvent.submit(screen.getByRole("form", { name: "Nuevo equipo" }));

    await waitFor(() => expect(window.hospitalDirectory.addBeeperTeam).toHaveBeenCalledWith({ name: "Quirófano", displayId: "9010" }));
    fireEvent.click(screen.getByText("Miembros del equipo"));
    fireEvent.click(screen.getByRole("checkbox", { name: /B-001/i }));

    await waitFor(() => expect(window.hospitalDirectory.setBeeperTeamMembers).toHaveBeenCalledWith("team_new", ["bsc_001"]));
  });

  it("opens create form when 'Nueva busca' is clicked", async () => {
    renderPage();
    await waitFor(() => screen.getByText("B-001"));
    fireEvent.click(screen.getByRole("button", { name: /nueva busca/i }));
    expect(screen.getByRole("form", { name: /Nueva busca/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/número de busca/i)).toBeInTheDocument();
  });

  it("cancels form without saving", async () => {
    renderPage();
    await waitFor(() => screen.getByText("B-001"));
    fireEvent.click(screen.getByRole("button", { name: /nueva busca/i }));
    fireEvent.click(screen.getByRole("button", { name: /cancelar/i }));
    expect(screen.queryByRole("form", { name: /Nueva busca/i })).not.toBeInTheDocument();
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
    renderPage();
    await waitFor(() => screen.getByText("B-001"));
    fireEvent.click(screen.getByRole("button", { name: /nueva busca/i }));

    const form = screen.getByRole("form", { name: /Nueva busca/i });
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
  });

  it("keeps the default shift when creating from the main fields", async () => {
    setupWindowApi({ addBeeper: vi.fn().mockResolvedValue({ ...mockRecords[0], deviceNumber: "B-003" }) });
    renderPage();
    await waitFor(() => screen.getByText("B-001"));
    fireEvent.click(screen.getByRole("button", { name: /nueva busca/i }));

    const form = screen.getByRole("form", { name: /Nueva busca/i });
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
    renderPage();
    await waitFor(() => screen.getByText("B-001"));
    fireEvent.click(screen.getByRole("button", { name: /nueva busca/i }));

    const form = screen.getByRole("form", { name: /Nueva busca/i });
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
    expect(screen.getByText(/Estás seguro de que quieres eliminar la busca/i)).toBeInTheDocument();
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

  it("resets to the first page when the team filter changes", async () => {
    const records = makeRecords(21);
    setupWindowApi({
      listBeepers: vi.fn().mockResolvedValue(records),
      listBeeperTeams: vi.fn().mockResolvedValue([
        { id: "team_alpha", name: "Alfa", displayId: "9001" },
        { id: "team_beta", name: "Beta", displayId: "9002" }
      ]),
      listBeeperTeamMemberships: vi.fn().mockResolvedValue([
        ...records.slice(0, 11).map((record) => ({ teamId: "team_alpha", beeperId: record.id })),
        ...records.slice(10).map((record) => ({ teamId: "team_beta", beeperId: record.id }))
      ])
    });
    renderPage();

    await screen.findByText("B-001");
    fireEvent.click(screen.getByRole("button", { name: "Página siguiente" }));
    expect(await screen.findByText("B-011")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Alfa · 9001/i }));

    await waitFor(() => {
      expect(screen.getByText("Página 1 de 2")).toBeInTheDocument();
      expect(screen.getAllByText("B-001").some((item) => item.closest("table"))).toBe(true);
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
    const newRecord: BeeperRecord = {
      id: "bsc_003",
      deviceNumber: "B-003",
      assignedTo: "Marta Ruiz",
      department: "Planta 2",
      role: "Auxiliar",
      shift: "noche"
    };
    const slowAdd = new Promise<BeeperRecord>((resolve) => {
      resolveSave = resolve;
    });
    setupWindowApi({ addBeeper: vi.fn().mockReturnValueOnce(slowAdd) });

    renderPage();
    await waitFor(() => screen.getByText("B-001"));

    // Open the create form
    fireEvent.click(screen.getByRole("button", { name: /nueva busca/i }));
    const form = screen.getByRole("form", { name: /Nueva busca/i });

    // Fill out required fields
    fireEvent.change(screen.getByLabelText(/número de busca/i), { target: { value: "B-003" } });
    fireEvent.change(screen.getByLabelText(/asignado a/i), { target: { value: "Marta Ruiz" } });
    fireEvent.change(form.querySelector("#form-department")!, { target: { value: "Planta 2" } });
    fireEvent.change(form.querySelector("#form-role")!, { target: { value: "Auxiliar" } });

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
    expect(screen.getByRole("form", { name: /Nueva busca/i })).toBeInTheDocument();

    // "Nueva busca" header button must be disabled while saving
    expect(screen.getByRole("button", { name: /nueva busca/i })).toBeDisabled();

    // Table row action buttons must be disabled while saving
    expect(screen.getByRole("button", { name: /editar busca B-001/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /eliminar busca B-001/i })).toBeDisabled();

    // Let the save complete — form should close and record should appear
    resolveSave(newRecord);
    await waitFor(() => {
      expect(screen.queryByRole("form", { name: /Nueva busca/i })).not.toBeInTheDocument();
      expect(screen.getByText("B-003")).toBeInTheDocument();
    });

    // Controls must be re-enabled after save
    expect(screen.getByRole("button", { name: /nueva busca/i })).not.toBeDisabled();
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

    renderPage();
    await waitFor(() => screen.getByText("B-001"));

    // Open the create form
    fireEvent.click(screen.getByRole("button", { name: /nueva busca/i }));
    const form = screen.getByRole("form", { name: /Nueva busca/i });

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
      expect(screen.queryByRole("form", { name: /Nueva busca/i })).not.toBeInTheDocument();
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
    renderPage();
    await waitFor(() => screen.getByText("B-001"));
    fireEvent.click(screen.getByRole("button", { name: /nueva busca/i }));
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

  it("refocuses first form field when switching from create to edit while form is already open", async () => {
    renderPage();
    await waitFor(() => screen.getByText("B-001"));

    // Open create form — focus lands on first field
    fireEvent.click(screen.getByRole("button", { name: /nueva busca/i }));
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByLabelText(/número de busca/i));
    });

    // Move focus away to simulate user interaction
    screen.getByLabelText(/asignado a/i).focus();
    expect(document.activeElement).not.toBe(screen.getByLabelText(/número de busca/i));

    // Switch to editing B-001 while form is still open — focus must return to first field
    fireEvent.click(screen.getByRole("button", { name: /editar busca B-001/i }));
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByLabelText(/número de busca/i));
    });
  });

  it("search label and placeholder describe visible searchable fields", async () => {
    renderPage();
    await waitFor(() => screen.getByText("B-001"));
    const searchInput = screen.getByLabelText(/Buscar buscas/i);
    expect(searchInput).toHaveAttribute("placeholder", expect.stringMatching(/titular/i));
    expect(searchInput).toHaveAttribute("placeholder", expect.stringMatching(/departamento/i));
  });
});
