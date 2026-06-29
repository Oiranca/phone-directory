import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { BuscasPage } from "./BuscasPage";
import type { BuscaRecord, ImportedBuscaRecord } from "../../shared/schemas/busca.schema";

const mockRecords: BuscaRecord[] = [
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

const mockImportedRecords: ImportedBuscaRecord[] = [
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

// Stub HTMLDialogElement.showModal/close since jsdom does not implement them
let dialogPrototype: (HTMLElement & { showModal?: () => void; close?: () => void }) | undefined;
let originalShowModal: (() => void) | undefined;
let originalClose: (() => void) | undefined;

beforeAll(() => {
  if (typeof globalThis.HTMLDialogElement === "undefined") {
    class HTMLDialogElementStub extends HTMLElement {
      open = false;
    }
    vi.stubGlobal("HTMLDialogElement", HTMLDialogElementStub);
  }

  dialogPrototype =
    typeof globalThis.HTMLDialogElement !== "undefined"
      ? globalThis.HTMLDialogElement.prototype
      : HTMLElement.prototype;

  originalShowModal = dialogPrototype.showModal;
  originalClose = dialogPrototype.close;

  dialogPrototype.showModal = vi.fn(function(this: HTMLElement & { open?: boolean }) {
    this.open = true;
  });
  dialogPrototype.close = vi.fn(function(this: HTMLElement & { open?: boolean }) {
    this.open = false;
  });
});

afterAll(() => {
  if (dialogPrototype) {
    dialogPrototype.showModal = originalShowModal;
    dialogPrototype.close = originalClose;
  }
});

const setupWindowApi = (overrides: Partial<typeof window.hospitalDirectory> = {}) => {
  Object.defineProperty(window, "hospitalDirectory", {
    configurable: true,
    value: {
      listBuscas: vi.fn().mockResolvedValue(mockRecords),
      listImportedBuscas: vi.fn().mockResolvedValue([]),
      addBusca: vi.fn(),
      updateBusca: vi.fn(),
      deleteBusca: vi.fn(),
      ...overrides
    }
  });
};

const renderPage = () =>
  render(
    <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <BuscasPage />
    </MemoryRouter>
  );

describe("BuscasPage", () => {
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

  it("shows retryable error state when listBuscas fails — no empty state shown", async () => {
    setupWindowApi({
      listBuscas: vi.fn().mockRejectedValue(new Error("network error"))
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("No se pudieron cargar los registros de buscas.");
    });
    // Retry button must be present
    expect(screen.getByRole("button", { name: /reintentar/i })).toBeInTheDocument();
    // Must NOT show the empty-dataset creation prompt
    expect(screen.queryByText(/No hay buscas registradas/)).not.toBeInTheDocument();
    // Must NOT show the "Nueva busca" button
    expect(screen.queryByRole("button", { name: /nueva busca/i })).not.toBeInTheDocument();
  });

  it("retries load when Reintentar is clicked after a failure", async () => {
    const listBuscasMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValueOnce(mockRecords);
    setupWindowApi({ listBuscas: listBuscasMock });
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
    setupWindowApi({ listBuscas: vi.fn().mockResolvedValue([]) });
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
      expect(screen.getByText("Mañana")).toBeInTheDocument();
      expect(screen.getByText("Equipo A")).toBeInTheDocument();
    });
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

  it("creates a new busca on form submit", async () => {
    const newRecord: BuscaRecord = {
      id: "bsc_003",
      deviceNumber: "B-003",
      assignedTo: "Marta Ruiz",
      department: "Planta 2",
      role: "Auxiliar",
      shift: "noche"
    };
    setupWindowApi({ addBusca: vi.fn().mockResolvedValue(newRecord) });
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
    fireEvent.change(screen.getByLabelText(/turno/i), { target: { value: "noche" } });

    fireEvent.submit(form);

    await waitFor(() => {
      expect(window.hospitalDirectory.addBusca).toHaveBeenCalledWith(
        expect.objectContaining({ deviceNumber: "B-003", shift: "noche" })
      );
      expect(screen.getByText("B-003")).toBeInTheDocument();
    });
  });

  it("opens edit form pre-populated with record data", async () => {
    renderPage();
    await waitFor(() => screen.getByText("B-001"));
    fireEvent.click(screen.getByRole("button", { name: /editar busca B-001/i }));

    const numberInput = screen.getByLabelText(/número de busca/i) as HTMLInputElement;
    expect(numberInput.value).toBe("B-001");
    const assignedInput = screen.getByLabelText(/asignado a/i) as HTMLInputElement;
    expect(assignedInput.value).toBe("Ana García");
  });

  it("updates a busca on edit form submit", async () => {
    const updated: BuscaRecord = { ...mockRecords[0]!, assignedTo: "Ana Actualizada" };
    setupWindowApi({ updateBusca: vi.fn().mockResolvedValue(updated) });
    renderPage();
    await waitFor(() => screen.getByText("B-001"));
    fireEvent.click(screen.getByRole("button", { name: /editar busca B-001/i }));

    fireEvent.change(screen.getByLabelText(/asignado a/i), { target: { value: "Ana Actualizada" } });
    fireEvent.submit(screen.getByRole("form", { name: /Editar busca/i }));

    await waitFor(() => {
      expect(window.hospitalDirectory.updateBusca).toHaveBeenCalledWith(
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
    setupWindowApi({ deleteBusca: vi.fn().mockResolvedValue(undefined) });
    renderPage();
    await waitFor(() => screen.getByText("B-001"));
    fireEvent.click(screen.getByRole("button", { name: /eliminar busca B-001/i }));
    const confirmButton = await screen.findByRole("button", { name: /^Eliminar$/i });
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(window.hospitalDirectory.deleteBusca).toHaveBeenCalledWith("bsc_001");
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

  it("disables confirm button while deletion is in progress to prevent double-submit", async () => {
    let resolveDelete!: () => void;
    const slowDelete = new Promise<void>((resolve) => {
      resolveDelete = resolve;
    });
    setupWindowApi({ deleteBusca: vi.fn().mockReturnValueOnce(slowDelete) });

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
    setupWindowApi({ deleteBusca: vi.fn().mockReturnValueOnce(slowDelete) });

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
    let resolveSave!: (value: BuscaRecord) => void;
    const newRecord: BuscaRecord = {
      id: "bsc_003",
      deviceNumber: "B-003",
      assignedTo: "Marta Ruiz",
      department: "Planta 2",
      role: "Auxiliar",
      shift: "noche"
    };
    const slowAdd = new Promise<BuscaRecord>((resolve) => {
      resolveSave = resolve;
    });
    setupWindowApi({ addBusca: vi.fn().mockReturnValueOnce(slowAdd) });

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
    let resolveSave!: (value: BuscaRecord) => void;
    const newRecord: BuscaRecord = {
      id: "bsc_004",
      deviceNumber: "B-004",
      assignedTo: "Carlos Díaz",
      department: "Radiología",
      role: "Técnico",
      shift: "mañana"
    };
    const slowAdd = new Promise<BuscaRecord>((resolve) => {
      resolveSave = resolve;
    });
    const addBuscaMock = vi.fn().mockReturnValueOnce(slowAdd);
    setupWindowApi({ addBusca: addBuscaMock });

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
    expect(addBuscaMock).toHaveBeenCalledTimes(1);

    // Resolve the save and confirm the record appears
    resolveSave(newRecord);
    await waitFor(() => {
      expect(screen.queryByRole("form", { name: /Nueva busca/i })).not.toBeInTheDocument();
      expect(screen.getByText("B-004")).toBeInTheDocument();
    });

    // addBusca must still have been called exactly once
    expect(addBuscaMock).toHaveBeenCalledTimes(1);
  });

  it("shows manual buscas even when listImportedBuscas rejects — no error state", async () => {
    setupWindowApi({
      listImportedBuscas: vi.fn().mockRejectedValue(new Error("ODS store unavailable"))
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

  it("shows imported ODS records with ODS badge in the table", async () => {
    setupWindowApi({
      listImportedBuscas: vi.fn().mockResolvedValue(mockImportedRecords)
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("5001")).toBeInTheDocument();
      expect(screen.getByText("5002")).toBeInTheDocument();
      expect(screen.getByText("Principal")).toBeInTheDocument();
      expect(screen.getByText("Residente")).toBeInTheDocument();
    });
    // Both ODS badges must be present
    const odsBadges = screen.getAllByText("ODS");
    expect(odsBadges.length).toBe(2);
  });

  it("includes imported records in the result count", async () => {
    setupWindowApi({
      listImportedBuscas: vi.fn().mockResolvedValue(mockImportedRecords)
    });
    renderPage();
    await waitFor(() => {
      // 2 regular + 2 imported = 4 resultados
      expect(screen.getByText("4 resultados")).toBeInTheDocument();
    });
  });

  it("filters imported records by search query", async () => {
    setupWindowApi({
      listImportedBuscas: vi.fn().mockResolvedValue(mockImportedRecords)
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

  it("table has accessible caption", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText("B-001")).toBeInTheDocument();
    });
    const caption = document.querySelector("caption");
    expect(caption).not.toBeNull();
    expect(caption!.textContent).toBe("Registros de buscas");
    expect(caption!.className).toContain("sr-only");
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

  it("search label and placeholder mention ODS holder and source-sheet fields", async () => {
    renderPage();
    await waitFor(() => screen.getByText("B-001"));
    const searchInput = screen.getByLabelText(/Buscar buscas/i);
    expect(searchInput).toHaveAttribute("placeholder", expect.stringMatching(/titular/i));
    expect(searchInput).toHaveAttribute("placeholder", expect.stringMatching(/hoja ods/i));
  });
});
