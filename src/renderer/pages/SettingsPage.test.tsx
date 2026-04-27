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
  dataFilePath: "/tmp/data/contacts.json",
  backupDirectoryPath: "/tmp/backups",
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
        getSettingsDefaults: vi.fn().mockResolvedValue({
          editorName: "",
          dataFilePath: "/tmp/default-data/contacts.json",
          backupDirectoryPath: "/tmp/default-backups",
          ui: {
            showInactiveByDefault: false
          }
        }),
        saveSettings: vi.fn().mockResolvedValue({
          editorName: "Guardia tarde",
          dataFilePath: "/tmp/data/contacts.json",
          backupDirectoryPath: "/tmp/backups",
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
    expect(screen.getByLabelText("Ruta del archivo de datos")).toHaveValue("/tmp/data/contacts.json");
    expect(screen.getByLabelText("Ruta de la carpeta de backups")).toHaveValue("/tmp/backups");
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
        dataFilePath: "/tmp/data/contacts.json",
        backupDirectoryPath: "/tmp/backups",
        ui: {
          showInactiveByDefault: true
        }
      });
    });

    expect(await screen.findByText(/Configuración guardada/)).toBeInTheDocument();
    expect(useAppStore.getState().settings).toEqual({
      editorName: "Guardia tarde",
      dataFilePath: "/tmp/data/contacts.json",
      backupDirectoryPath: "/tmp/backups",
      ui: {
        showInactiveByDefault: true
      }
    });
    expect(screen.getByLabelText("Nombre del editor")).toHaveValue("Guardia tarde");
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
    expect(screen.getByLabelText("Ruta del archivo de datos")).toHaveValue("/tmp/data/contacts.json");
    expect(screen.getByRole("checkbox", { name: /Mostrar inactivos al iniciar/ })).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Guardar configuración" })).toBeDisabled();
  });

  it("shows recovery actions when bootstrap loading fails", async () => {
    window.hospitalDirectory.getBootstrapData = vi.fn().mockRejectedValue(new Error("broken file"));

    renderPage();

    expect(await screen.findByText("Configuración no disponible")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
  });

  it("exposes a busy status while settings are still loading", () => {
    window.hospitalDirectory.getBootstrapData = vi.fn().mockImplementation(
      () => new Promise(() => undefined)
    );

    renderPage();

    const loadingState = screen.getByRole("status");
    expect(loadingState).toHaveAttribute("aria-busy", "true");
    expect(loadingState).toHaveTextContent("Cargando configuración");
  });

  it("retries bootstrap loading after an initial failure", async () => {
    window.hospitalDirectory.getBootstrapData = vi.fn()
      .mockRejectedValueOnce(new Error("broken file"))
      .mockResolvedValueOnce({
        contacts: defaultContacts,
        settings: editableSettings
      });

    renderPage();

    expect(await screen.findByText("Configuración no disponible")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));

    expect(await screen.findByText("Configuración básica")).toBeInTheDocument();
    expect(window.hospitalDirectory.getBootstrapData).toHaveBeenCalledTimes(2);
  });

  it("shows a save error without mutating the store", async () => {
    window.hospitalDirectory.saveSettings = vi.fn().mockRejectedValue(new Error("write failed"));

    renderPage();

    expect(await screen.findByText("Configuración básica")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Nombre del editor"), {
      target: { value: "Fallo" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar configuración" }));

    expect(await screen.findByText("No se pudo guardar la configuración")).toBeInTheDocument();
    expect((await screen.findAllByText("write failed")).length).toBeGreaterThan(0);
    expect(useAppStore.getState().settings).toEqual(editableSettings);
  });

  it("loads managed paths into the form after a path validation failure", async () => {
    window.hospitalDirectory.saveSettings = vi
      .fn()
      .mockRejectedValueOnce(new Error("Ruta inválida"));

    renderPage();

    expect(await screen.findByText("Configuración básica")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Ruta del archivo de datos"), {
      target: { value: "/tmp/data/existente.json" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar configuración" }));
    expect((await screen.findAllByText("Ruta inválida")).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "Cargar rutas gestionadas" }));

    await waitFor(() => {
      expect(window.hospitalDirectory.getSettingsDefaults).toHaveBeenCalledTimes(1);
    });

    expect(screen.getByLabelText("Ruta del archivo de datos")).toHaveValue("/tmp/default-data/contacts.json");
    expect(screen.getByLabelText("Ruta de la carpeta de backups")).toHaveValue("/tmp/default-backups");
    expect(window.hospitalDirectory.saveSettings).toHaveBeenCalledTimes(1);
    expect(useAppStore.getState().settings).toEqual(editableSettings);
  });

  it("does not offer managed path reset for non-path save errors", async () => {
    window.hospitalDirectory.saveSettings = vi.fn().mockRejectedValue(new Error("write failed"));

    renderPage();

    expect(await screen.findByText("Configuración básica")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Nombre del editor"), {
      target: { value: "Fallo" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar configuración" }));

    expect(await screen.findByText("No se pudo guardar la configuración")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cargar rutas gestionadas" })).not.toBeInTheDocument();
  });

  it("offers managed path reset when the page mounts with existing settings", async () => {
    useAppStore.setState({
      contacts: defaultContacts,
      settings: editableSettings,
      recovery: null,
      selectedRecordId: null,
      query: "",
      selectedType: "all",
      selectedArea: "all",
      showInactive: false,
      isLoading: false
    });
    window.hospitalDirectory.saveSettings = vi.fn().mockRejectedValue(new Error("Ruta inválida"));

    renderPage();

    expect(await screen.findByText("Configuración básica")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("Ruta del archivo de datos"), {
      target: { value: "/tmp/data/existente.json" }
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar configuración" }));

    expect(await screen.findByText("No se pudo guardar la configuración")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cargar rutas gestionadas" })).toBeInTheDocument();
  });
});
