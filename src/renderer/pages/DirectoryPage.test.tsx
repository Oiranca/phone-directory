import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DirectoryPage } from "./DirectoryPage";
import { useAppStore } from "../store/useAppStore";
import { defaultContacts } from "../../shared/fixtures/defaultContacts";

const resetStore = () => {
  useAppStore.setState({
    contacts: null,
    settings: null,
    recovery: null,
    selectedRecordId: null,
    query: "",
    selectedType: "all",
    selectedArea: "all",
    showInactive: false,
    isLoading: true
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

  it("shows a recovery state when bootstrap loading fails", async () => {
    window.hospitalDirectory.getBootstrapData = vi.fn().mockRejectedValue(new Error("broken file"));

    renderPage();

    expect(await screen.findByText("No se pudieron cargar los datos")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
  });

  it("loads records after a successful bootstrap request", async () => {
    window.hospitalDirectory.getBootstrapData = vi.fn().mockResolvedValue({
      contacts: defaultContacts,
      settings: {
        editorName: "",
        ui: {
          showInactiveByDefault: false
        }
      }
    });

    renderPage();

    await waitFor(() => {
      expect(screen.getByText("Búsqueda principal")).toBeInTheDocument();
      expect(screen.getByDisplayValue("")).toBeInTheDocument();
    });
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
        ui: {
          showInactiveByDefault: false
        }
      }
    });

    renderPage();

    expect(await screen.findByText("Búsqueda principal")).toBeInTheDocument();
    expect(screen.queryByText("Control de Noche")).not.toBeInTheDocument();

    await chooseOption("Tipo", "Control");
    fireEvent.click(screen.getByRole("checkbox", { name: /mostrar registros inactivos/i }));

    expect((await screen.findAllByText("Control de Noche")).length).toBeGreaterThan(0);
  });

  it("shows inline risk text and a detail warning block for sensitive phones", async () => {
    const contacts = structuredClone(defaultContacts);
    contacts.records[0]!.contactMethods.phones[0]!.confidential = true;

    window.hospitalDirectory.getBootstrapData = vi.fn().mockResolvedValue({
      contacts,
      settings: {
        editorName: "",
        ui: {
          showInactiveByDefault: false
        }
      }
    });

    renderPage();

    expect(await screen.findByText("Búsqueda principal")).toBeInTheDocument();
    expect(screen.getByText("Número interno confidencial.")).toBeInTheDocument();
    expect(screen.getByText("No compartir con pacientes.")).toBeInTheDocument();
    expect(screen.getByText("Atención de privacidad")).toBeInTheDocument();
    expect(screen.getByText("Contiene números internos confidenciales.")).toBeInTheDocument();
    expect(screen.getByText("Incluye teléfonos que no deben compartirse con pacientes.")).toBeInTheDocument();
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
        ui: {
          showInactiveByDefault: false
        }
      }
    });

    renderPage();

    expect(await screen.findByText("Búsqueda principal")).toBeInTheDocument();
    expect(screen.queryByText("Número interno confidencial.")).not.toBeInTheDocument();
    expect(screen.queryByText("No compartir con pacientes.")).not.toBeInTheDocument();
    expect(screen.getByText("Atención de privacidad")).toBeInTheDocument();
  });
});
