import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultContacts } from "../../shared/fixtures/defaultContacts";
import { ToastProvider } from "../components/feedback/ToastRegion";
import { SettingsPage } from "./SettingsPage";
import { useAppStore } from "../store/useAppStore";

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

const editableSettings = {
  editorName: "Samuel",
  ui: {
    showInactiveByDefault: false
  }
};

const renderPage = () =>
  render(
    <ToastProvider>
      <MemoryRouter>
        <SettingsPage />
      </MemoryRouter>
    </ToastProvider>
  );

describe("SettingsPage", () => {
  beforeEach(() => {
    resetStore();
    Object.defineProperty(window, "hospitalDirectory", {
      configurable: true,
      value: {
        getBootstrapData: vi.fn().mockResolvedValue({
          contacts: defaultContacts,
          settings: editableSettings
        }),
        saveSettings: vi.fn().mockResolvedValue({
          editorName: "Guardia tarde",
          ui: {
            showInactiveByDefault: true
          }
        }),
        createBackup: vi.fn(),
        createRecord: vi.fn(),
        updateRecord: vi.fn(),
        listBackups: vi.fn(),
        exportDataset: vi.fn(),
        importDataset: vi.fn(),
        previewCsvImport: vi.fn(),
        importCsvDataset: vi.fn()
      }
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("loads editable settings and keeps save disabled until there are changes", async () => {
    renderPage();

    expect(await screen.findByText("Configuración básica")).toBeInTheDocument();
    expect(screen.getByLabelText("Nombre del editor")).toHaveValue("Samuel");
    expect(screen.getByRole("button", { name: "Guardar configuración" })).toBeDisabled();
  });

  it("saves editor and inactive-default preferences", async () => {
    renderPage();

    expect(await screen.findByText("Configuración básica")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Nombre del editor"), {
      target: { value: "Guardia tarde" }
    });
    fireEvent.click(screen.getByRole("checkbox", { name: /Mostrar inactivos al iniciar/ }));
    fireEvent.click(screen.getByRole("button", { name: "Guardar configuración" }));

    await waitFor(() => {
      expect(window.hospitalDirectory.saveSettings).toHaveBeenCalledWith({
        editorName: "Guardia tarde",
        ui: {
          showInactiveByDefault: true
        }
      });
    });

    expect(await screen.findByText(/Configuración guardada/)).toBeInTheDocument();
    expect(useAppStore.getState().settings).toEqual({
      editorName: "Guardia tarde",
      ui: {
        showInactiveByDefault: true
      }
    });
    expect(screen.getByLabelText("Nombre del editor")).toHaveValue("");
  });

  it("restores the last persisted values when discarding changes", async () => {
    renderPage();

    expect(await screen.findByText("Configuración básica")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Nombre del editor"), {
      target: { value: "Temporal" }
    });
    fireEvent.click(screen.getByRole("checkbox", { name: /Mostrar inactivos al iniciar/ }));
    fireEvent.click(screen.getByRole("button", { name: "Descartar cambios" }));

    expect(screen.getByLabelText("Nombre del editor")).toHaveValue("Samuel");
    expect(screen.getByRole("checkbox", { name: /Mostrar inactivos al iniciar/ })).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Guardar configuración" })).toBeDisabled();
  });

  it("shows recovery actions when bootstrap loading fails", async () => {
    window.hospitalDirectory.getBootstrapData = vi.fn().mockRejectedValue(new Error("broken file"));

    renderPage();

    expect(await screen.findByText("Configuración no disponible")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
  });

  it("shows a save error without mutating the store", async () => {
    window.hospitalDirectory.saveSettings = vi.fn().mockRejectedValue(new Error("write failed"));

    renderPage();

    expect(await screen.findByText("Configuración básica")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Nombre del editor"), {
      target: { value: "Fallo" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar configuración" }));

    expect(await screen.findByText("No se pudo guardar la configuración. Inténtalo de nuevo.")).toBeInTheDocument();
    expect(useAppStore.getState().settings).toEqual(editableSettings);
  });
});
