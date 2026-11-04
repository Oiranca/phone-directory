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



const newTeam = { id: "team_new", name: "Quirófano", displayId: "9010" };


// Exactly one h2 titles the page in every state (ready, empty, load error and /beeper/new), and
// the root section is named by it. StatePanel titles inside the page are h3.
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

  it("retries when loading teams fails", async () => {
    const listTeams = vi
      .fn()
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValueOnce(mockTeams);
    setupWindowApi({ listBeeperTeams: listTeams });
    renderPage();

    await screen.findByRole("button", { name: /reintentar/i });
    fireEvent.click(screen.getByRole("button", { name: /reintentar/i }));

    await waitFor(() => expect(listTeams).toHaveBeenCalledTimes(2));
    await screen.findByText("B-001");
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

  it("shows the Buscas title and the Equipos button on /beeper", async () => {
    setupWindowApi({ listBeeperTeams: vi.fn().mockResolvedValue(mockTeams) });
    renderPage();
    await screen.findByText("B-001");

    expect(screen.queryByRole("heading", { name: "Gestión Buscas" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Nuevo equipo" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Nuevo busca" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Buscas" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Equipos" })).toBeInTheDocument();
  });

  it("lists existing teams and their number in the dialog", async () => {
    setupWindowApi({ listBeeperTeams: vi.fn().mockResolvedValue(mockTeams) });
    renderPage();
    await screen.findByText("B-001");
    fireEvent.click(screen.getByRole("button", { name: "Equipos" }));

    const teams = within(screen.getByRole("dialog")).getByRole("list", { name: "Equipos" });
    expect(teams).toHaveAttribute("role", "list");
    expect(within(teams).getByText("UCI")).toBeInTheDocument();
    expect(within(teams).getByText("9001")).toBeInTheDocument();
    expect(within(teams).queryByRole("button")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Nombre del equipo/i)).not.toBeInTheDocument();
  });

  it("does not load or expose team memberships", async () => {
    setupWindowApi({ listBeeperTeams: vi.fn().mockResolvedValue(mockTeams) });
    renderPage();
    await screen.findByText("B-001");
    fireEvent.click(screen.getByRole("button", { name: "Equipos" }));

    expect(window.hospitalDirectory.listBeeperTeamMemberships).not.toHaveBeenCalled();
    expect(screen.queryByText("Buscas del equipo")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /editar equipo/i })).not.toBeInTheDocument();
  });

  it("closes Equipos with Escape and restores trigger focus", async () => {
    renderPage();
    const trigger = await screen.findByRole("button", { name: "Equipos" });
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent(screen.getByRole("dialog"), new Event("cancel", { cancelable: true }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();
  });


  it("keeps team creation in Gestión Buscas when the dialog is empty", async () => {
    renderPage();
    await screen.findByText("B-001");
    fireEvent.click(screen.getByRole("button", { name: "Equipos" }));

    expect(screen.getByText("No hay equipos. Crea uno desde Gestión Buscas.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Nuevo equipo" })).not.toBeInTheDocument();
  });

  it("opens on a chooser at /beeper/new, focuses its heading and hides the list", async () => {
    renderPage("/beeper/new");

    const heading = await screen.findByRole("heading", { name: "Gestión Buscas" });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(screen.getByRole("button", { name: "Nuevo busca" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Nuevo equipo" })).toBeInTheDocument();
    expect(screen.queryByLabelText(/Buscar buscas/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Equipos" })).not.toBeInTheDocument();
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

  it("returns to Buscas after creating a team", async () => {
    setupWindowApi({ addBeeperTeam: vi.fn().mockResolvedValue(newTeam) });
    renderPage("/beeper/new");
    await openTeamCreateForm();
    fireEvent.change(screen.getByLabelText(/Nombre del equipo/i), { target: { value: newTeam.name } });
    fireEvent.change(screen.getByLabelText(/Número del equipo/i), { target: { value: newTeam.displayId } });
    fireEvent.submit(screen.getByRole("form", { name: "Nuevo equipo" }));

    await waitFor(() => expect(window.hospitalDirectory.addBeeperTeam).toHaveBeenCalledWith({ name: newTeam.name, displayId: newTeam.displayId }));
    await waitFor(() => expectPathname("/beeper"));
    expect(window.hospitalDirectory.setBeeperTeamMembers).not.toHaveBeenCalled();
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
    it("is 'Buscas' on /beeper, with the busca form as an h3", async () => {
      renderPage();
      await screen.findByText("B-001");
      expectSinglePageTitle("Buscas");

      fireEvent.click(screen.getByRole("button", { name: /editar busca B-001/i }));

      expectSinglePageTitle("Buscas");
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



    it("comes back to 'Gestión Buscas' when a form is cancelled to the chooser", async () => {
      renderPage("/beeper/new");
      await openBuscaForm();
      fireEvent.click(screen.getByRole("button", { name: /cancelar/i }));

      expectSinglePageTitle("Gestión Buscas");
    });
  });

  describe("state panel headings", () => {
    it("titles the empty state with an h3 under the single page h2", async () => {
      setupWindowApi({ listBeepers: vi.fn().mockResolvedValue([]) });
      renderPage();

      await screen.findByText("No hay buscas registrados. Crea el primer busca o un equipo.");
      expectSinglePageTitle("Buscas");
      expect(screen.getByRole("heading", { name: "Sin registros", level: 3 })).toBeInTheDocument();
    });

    it("titles the load error with an h3 under the single page h2", async () => {
      setupWindowApi({ listBeepers: vi.fn().mockRejectedValue(new Error("read failed")) });
      renderPage();

      await screen.findByRole("alert");
      expectSinglePageTitle("Buscas");
      expect(screen.getByRole("heading", { name: "Error al cargar", level: 3 })).toBeInTheDocument();
    });

    it("titles the load error on /beeper/new 'Gestión Buscas'", async () => {
      setupWindowApi({ listBeepers: vi.fn().mockRejectedValue(new Error("read failed")) });
      renderPage("/beeper/new");

      await screen.findByRole("alert");
      expectSinglePageTitle("Gestión Buscas");
      expect(screen.queryByRole("heading", { name: "Buscas" })).not.toBeInTheDocument();
    });
  });




  describe("holder display case", () => {
    const rowOf = (deviceNumber: string) => {
      const row = within(screen.getByRole("table")).getByText(deviceNumber).closest("tr");
      if (!row) throw new Error(`No row for ${deviceNumber}`);
      return within(row);
    };
    const rowOfDevice = (deviceNumber: string) => {
      const row = within(screen.getByRole("table")).getByText(deviceNumber).closest("tr");
      if (!row) throw new Error(`No row for ${deviceNumber}`);
      return row;
    };
    const shouting: BeeperRecord = { ...mockRecords[0], id: "bsc_010", deviceNumber: "B-010", assignedTo: "FARMACIA URGENCI HECTOR ALONSO FARMACEUTICO URGENCIAS" };

    it("shows a manual holder with the first letter of each word capitalized", async () => {
      setupWindowApi({ listBeepers: vi.fn().mockResolvedValue([shouting]) });
      renderPage();
      await screen.findByText("B-010");

      expect(rowOf("B-010").getByText("Farmacia Urgenci Hector Alonso Farmaceutico Urgencias")).toBeInTheDocument();
      expect(rowOf("B-010").queryByText("FARMACIA URGENCI HECTOR ALONSO FARMACEUTICO URGENCIAS")).not.toBeInTheDocument();
    });

    it("normalizes an imported holder name or holder type, and keeps the placeholder", async () => {
      setupWindowApi({
        listBeepers: vi.fn().mockResolvedValue([]),
        listImportedBeepers: vi.fn().mockResolvedValue([
          { ...mockImportedRecords[0], name: "MECANICO MECANICO DE GASES" },
          { ...mockImportedRecords[1], holderType: undefined }
        ])
      });
      renderPage();
      await screen.findByText("5001");

      expect(rowOf("5001").getByText("Mecanico Mecanico de Gases")).toBeInTheDocument();
      expect(rowOf("5002").getByText("—", { selector: "span" })).toBeInTheDocument();
      cleanup();
      setupWindowApi({
        listBeepers: vi.fn().mockResolvedValue([]),
        listImportedBeepers: vi.fn().mockResolvedValue([{ ...mockImportedRecords[0], holderType: "RESIDENTE" }])
      });
      renderPage();
      await screen.findByText("5001");
      expect(rowOf("5001").getByText("Residente")).toBeInTheDocument();
    });

    it("capitalizes accented words", async () => {
      setupWindowApi({ listBeepers: vi.fn().mockResolvedValue([{ ...shouting, assignedTo: "ÁNGEL PÉREZ" }]) });
      renderPage();
      await screen.findByText("B-010");

      expect(rowOf("B-010").getByText("Ángel Pérez")).toBeInTheDocument();
    });

    it("starts a new word after spaces, hyphens, dots, slashes and parentheses, but not after digits or apostrophes", async () => {
      const holders = [
        ["B-011", "M.INTERNA-INFECCIOSOS", "M.Interna-Infecciosos"],
        ["B-012", "D'ANGELO SANTI", "D'angelo Santi"],
        ["B-013", "MECANICO 2DA GUARDIA", "Mecanico 2da Guardia"],
        ["B-014", "(URGENCIAS) JEFE/A", "(Urgencias) Jefe/A"],
        ["B-015", "Endocrino Guardia Endocrino Guardia", "Endocrino Guardia Endocrino Guardia"],
        ["B-016", "ÁNGEL PÉREZ", "Ángel Pérez"],
        // Decomposed accents (letter + combining mark) must not split the word.
        ["B-017", "A\u0301NGEL PE\u0301REZ", "A\u0301ngel Pe\u0301rez"],
        ["B-018", "JOSE\u0301 MARI\u0301A", "Jose\u0301 Mari\u0301a"],
        ["B-019", "İSTANBUL", "I\u0307stanbul"],
        ["B-020", "D\u2019ANGELO SANTI", "D\u2019angelo Santi"]
      ] as const;
      setupWindowApi({
        listBeepers: vi.fn().mockResolvedValue(holders.map(([deviceNumber, assignedTo]) => ({ ...shouting, id: `bsc_${deviceNumber}`, deviceNumber, assignedTo })))
      });
      renderPage();
      await screen.findByText("B-011");

      for (const [deviceNumber, , expected] of holders) {
        expect(rowOf(deviceNumber).getByText(expected, { selector: "span" })).toBeInTheDocument();
      }
    });

    it("keeps the connectors de, del and la lowercase, except as the first word", async () => {
      const holders = [
        ["B-030", "MECANICO MECANICO DE GASES", "Mecanico Mecanico de Gases"],
        ["B-031", "JEFE DEL SERVICIO", "Jefe del Servicio"],
        ["B-032", "HECTOR ALONSO DE LA CRUZ", "Hector Alonso de la Cruz"],
        ["B-033", "DE LA CRUZ", "De la Cruz"],
        ["B-034", "DEL RIO", "Del Rio"],
        // Only whole words are connectors.
        ["B-035", "DELGADO LAURA DEBORA", "Delgado Laura Debora"],
        // After punctuation they still are connectors, unless they are the first word of the value.
        ["B-036", "M.INTERNA-DE GUARDIA", "M.Interna-de Guardia"],
        ["B-037", "(DE LA CRUZ) DEL RIO", "(De la Cruz) del Rio"],
        // Accented variants are different words.
        ["B-038", "DÉ LÁ CRUZ", "Dé Lá Cruz"],
        // Idempotent.
        ["B-039", "Jefe del Servicio de la Zona", "Jefe del Servicio de la Zona"]
      ] as const;
      setupWindowApi({
        listBeepers: vi.fn().mockResolvedValue(holders.map(([deviceNumber, assignedTo]) => ({ ...shouting, id: `bsc_${deviceNumber}`, deviceNumber, assignedTo })))
      });
      renderPage();
      await screen.findByText("B-030");

      for (const [deviceNumber, , expected] of holders) {
        expect(rowOf(deviceNumber).getByText(expected, { selector: "span" })).toBeInTheDocument();
      }
    });

    it("keeps the connectors lowercase for an imported holder too", async () => {
      setupWindowApi({
        listBeepers: vi.fn().mockResolvedValue([]),
        listImportedBeepers: vi.fn().mockResolvedValue([{ ...mockImportedRecords[0], name: "HECTOR ALONSO DE LA CRUZ" }])
      });
      renderPage();
      await screen.findByText("5001");

      expect(rowOf("5001").getByText("Hector Alonso de la Cruz")).toBeInTheDocument();
    });


    it("only uppercases letters: a Roman numeral and a word-initial combining mark stay as they are", async () => {
      const holders = [
        ["B-021", "\u217B ANA", "\u217B Ana"],
        ["B-022", "\u0345ABC", "\u0345abc"]
      ] as const;
      setupWindowApi({
        listBeepers: vi.fn().mockResolvedValue(holders.map(([deviceNumber, assignedTo]) => ({ ...shouting, id: `bsc_${deviceNumber}`, deviceNumber, assignedTo })))
      });
      renderPage();
      await screen.findByText("B-021");

      for (const [deviceNumber, , expected] of holders) {
        expect(rowOf(deviceNumber).getByText(expected, { selector: "span" })).toBeInTheDocument();
      }
    });

    it("shows an already capitalized holder unchanged", async () => {
      setupWindowApi({ listBeepers: vi.fn().mockResolvedValue([{ ...shouting, assignedTo: "Ángel Pérez" }]) });
      renderPage();
      await screen.findByText("B-010");

      expect(rowOf("B-010").getByText("Ángel Pérez", { selector: "span" })).toBeInTheDocument();
    });




    it("keeps the raw holder in the edit form", async () => {
      setupWindowApi({ listBeepers: vi.fn().mockResolvedValue([shouting]) });
      renderPage();
      await screen.findByText("B-010");

      fireEvent.click(screen.getByRole("button", { name: /editar busca B-010/i }));

      expect(screen.getByLabelText(/asignado a/i)).toHaveValue("FARMACIA URGENCI HECTOR ALONSO FARMACEUTICO URGENCIAS");
    });

    it("keeps the raw holder in the edit form of an imported busca", async () => {
      setupWindowApi({
        listBeepers: vi.fn().mockResolvedValue([]),
        listImportedBeepers: vi.fn().mockResolvedValue([{ ...mockImportedRecords[0], name: "MECANICO DE GASES" }])
      });
      renderPage();
      await screen.findByText("5001");

      fireEvent.click(screen.getByRole("button", { name: /editar busca 5001/i }));

      expect(screen.getByLabelText(/asignado a/i)).toHaveValue("MECANICO DE GASES");
    });

    it("finds a holder by lowercase and uppercase queries", async () => {
      setupWindowApi({ listBeepers: vi.fn().mockResolvedValue([shouting, mockRecords[1]]) });
      renderPage();
      await screen.findByText("B-010");

      for (const query of ["farmacia urgenci", "FARMACIA URGENCI"]) {
        fireEvent.change(screen.getByLabelText(/Buscar buscas/i), { target: { value: query } });
        await waitFor(() => expect(screen.queryByText("B-002")).not.toBeInTheDocument());
        expect(screen.getByText("B-010")).toBeInTheDocument();
      }
    });

    it("only transforms the holder column, not Rol or Departamento", async () => {
      setupWindowApi({
        listBeepers: vi.fn().mockResolvedValue([{ ...shouting, role: "UCI", department: "URGENCIAS" }]),
        listImportedBeepers: vi.fn().mockResolvedValue([
          { ...mockImportedRecords[0], name: "MECANICO DE GASES", category: "UCI", department: "URGENCIAS" }
        ])
      });
      renderPage();
      await screen.findByText("B-010");

      for (const deviceNumber of ["B-010", "5001"]) {
        const cells = within(rowOfDevice(deviceNumber)).getAllByRole("cell");
        expect(cells[1]).toHaveTextContent(/^UCI$/);
        expect(cells[2]).toHaveTextContent(/^URGENCIAS$/);
      }
    });
  });
});
