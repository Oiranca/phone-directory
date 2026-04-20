import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { App } from "./App";
import { useAppStore } from "../store/useAppStore";
import { defaultContacts } from "../../shared/fixtures/defaultContacts";

const editableSettings = {
  editorName: "Samuel",
  ui: {
    showInactiveByDefault: false
  }
};

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

const renderApp = () => {
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: <App />,
        children: [
          {
            index: true,
            element: <div>Directorio disponible</div>
          }
        ]
      }
    ],
    { initialEntries: ["/"] }
  );

  render(<RouterProvider router={router} />);
  return router;
};

describe("App recovery flow", () => {
  beforeEach(() => {
    resetStore();
    vi.stubGlobal("confirm", vi.fn(() => true));
    Object.defineProperty(window, "hospitalDirectory", {
      configurable: true,
      value: {
        getBootstrapData: vi.fn(),
        saveSettings: vi.fn(),
        createBackup: vi.fn(),
        createRecord: vi.fn(),
        updateRecord: vi.fn(),
        listBackups: vi.fn(),
        exportDataset: vi.fn(),
        importDataset: vi.fn(),
        resetDataset: vi.fn(),
        previewCsvImport: vi.fn(),
        importCsvDataset: vi.fn()
      }
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("blocks normal navigation and shows recovery actions when bootstrap returns recovery data", async () => {
    window.hospitalDirectory.getBootstrapData = vi.fn().mockResolvedValue({
      recovery: {
        reason: "invalid-contacts-json",
        contactsFilePath: "/tmp/data/contacts.json",
        message: "El archivo local contacts.json está dañado o tiene un formato no válido.",
        details: "Importa una copia JSON válida o restablece un directorio vacío para volver a trabajar."
      },
      settings: editableSettings
    });

    renderApp();

    expect(await screen.findByText("Recuperación obligatoria")).toBeInTheDocument();
    expect(screen.getByText("Importar JSON válido")).toBeInTheDocument();
    expect(screen.getByText("Restablecer directorio vacío")).toBeInTheDocument();
    expect(screen.queryByText("Directorio disponible")).not.toBeInTheDocument();
    expect(screen.queryByText("Directorio")).not.toBeInTheDocument();
  });

  it("imports a valid JSON backup and exits recovery mode", async () => {
    window.hospitalDirectory.getBootstrapData = vi.fn().mockResolvedValue({
      recovery: {
        reason: "invalid-contacts-json",
        contactsFilePath: "/tmp/data/contacts.json",
        message: "El archivo local contacts.json está dañado o tiene un formato no válido."
      },
      settings: editableSettings
    });
    window.hospitalDirectory.importDataset = vi.fn().mockResolvedValue({
      contacts: defaultContacts,
      settings: editableSettings,
      backupPath: "/tmp/backups/contacts-corrupted.json",
      importedFilePath: "/tmp/recovery.json",
      recordCount: defaultContacts.records.length
    });

    renderApp();

    expect(await screen.findByText("Recuperación obligatoria")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Importar JSON válido" }));

    await waitFor(() => {
      expect(window.hospitalDirectory.importDataset).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByText("Directorio disponible")).toBeInTheDocument();
  });

  it("resets to an empty dataset and exits recovery mode", async () => {
    window.hospitalDirectory.getBootstrapData = vi.fn().mockResolvedValue({
      recovery: {
        reason: "invalid-contacts-json",
        contactsFilePath: "/tmp/data/contacts.json",
        message: "El archivo local contacts.json está dañado o tiene un formato no válido."
      },
      settings: editableSettings
    });
    window.hospitalDirectory.resetDataset = vi.fn().mockResolvedValue({
      contacts: {
        ...defaultContacts,
        exportedAt: "2026-04-20T00:00:00.000Z",
        metadata: {
          ...defaultContacts.metadata,
          recordCount: 0,
          editorName: "Samuel",
          typeCounts: {},
          areaCounts: {}
        },
        records: []
      },
      settings: editableSettings,
      backupPath: "/tmp/backups/contacts-corrupted.json"
    });

    renderApp();

    expect(await screen.findByText("Recuperación obligatoria")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Restablecer directorio vacío" }));

    await waitFor(() => {
      expect(window.hospitalDirectory.resetDataset).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByText("Directorio disponible")).toBeInTheDocument();
  });
});
