import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { BuscasPage } from "./BuscasPage";
import type { BuscaRecord } from "../../shared/schemas/busca.schema";

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
      addBusca: vi.fn(),
      updateBusca: vi.fn(),
      deleteBusca: vi.fn(),
      searchBuscas: vi.fn(),
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

  it("shows error message when listBuscas fails", async () => {
    setupWindowApi({
      listBuscas: vi.fn().mockRejectedValue(new Error("network error"))
    });
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent("No se pudieron cargar los registros de buscas.");
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
});
