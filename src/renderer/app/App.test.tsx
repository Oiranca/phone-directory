import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import { App } from "./App";
import { ToastProvider } from "../components/feedback/ToastRegion";
import { useAppStore, resetBootstrapInFlight } from "../store/useAppStore";
import { defaultContacts } from "../../shared/fixtures/defaultContacts";

const editableSettings = {
  editorName: "Samuel",
  dataFilePath: "/tmp/data/contacts.json",
  backupDirectoryPath: "/tmp/backups",
  ui: {
    showInactiveByDefault: false,
    autoBackup: {
      enabled: false,
      trigger: "launch",
      intervalHours: 2,
      editCountThreshold: 10,
      retentionCount: 5
    }
  }
};

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

  render(
    <ToastProvider>
      <RouterProvider router={router} />
    </ToastProvider>
  );
  return router;
};

describe("App recovery flow", () => {
  beforeEach(() => {
    resetStore();
    Object.defineProperty(window, "hospitalDirectory", {
      configurable: true,
      value: {
        getBootstrapData: vi.fn(),
        getSettingsDefaults: vi.fn().mockResolvedValue({
          editorName: "",
          dataFilePath: "/tmp/default-data/contacts.json",
          backupDirectoryPath: "/tmp/default-backups",
          ui: {
            showInactiveByDefault: false,
            autoBackup: editableSettings.ui.autoBackup
          }
        }),
        saveSettings: vi.fn(),
        createBackup: vi.fn(),
        createRecord: vi.fn(),
        updateRecord: vi.fn(),
        listBackups: vi.fn(),
        exportDataset: vi.fn(),
        importDataset: vi.fn(),
        pickAndImportDataset: vi.fn().mockResolvedValue({
          kind: "json-preview",
          preview: { importToken: "recovery-json", fileName: "contacts.json", detectedType: "contacts", recordCount: 0, currentRecordCount: null }
        }),
        confirmJsonImport: vi.fn(),
        cancelJsonImport: vi.fn(),
        cancelCsvImportPreview: vi.fn(),
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
    // "Directorio" appears in the AppShell h1 regardless of mode; check nav/page content instead
    expect(screen.queryByRole("navigation", { name: "Navegación principal" })).not.toBeInTheDocument();
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
    window.hospitalDirectory.pickAndImportDataset = vi.fn().mockResolvedValue({ kind: "json-preview", preview: { importToken: "recovery-ok", fileName: "contacts.json", detectedType: "contacts", recordCount: defaultContacts.records.length, currentRecordCount: null } });
    window.hospitalDirectory.confirmJsonImport = vi.fn().mockResolvedValue({ kind: "contacts-import", result: { contacts: defaultContacts, settings: editableSettings, recordCount: defaultContacts.records.length } });

    renderApp();

    expect(await screen.findByText("Recuperación obligatoria")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Importar JSON válido" }));

    fireEvent.click(await screen.findByRole("button", { name: "Importar copia" }));
    await waitFor(() => expect(window.hospitalDirectory.confirmJsonImport).toHaveBeenCalledWith("recovery-ok"));
    expect(await screen.findByText("Directorio disponible")).toBeInTheDocument();
  });

  it("keeps the JSON confirmation open and disables both actions while applying it", async () => {
    let resolveImport!: (value: unknown) => void;
    window.hospitalDirectory.getBootstrapData = vi.fn().mockResolvedValue({
      recovery: { reason: "invalid-contacts-json", contactsFilePath: "/tmp/data/contacts.json", message: "El archivo local contacts.json está dañado." },
      settings: editableSettings
    });
    window.hospitalDirectory.confirmJsonImport = vi.fn().mockReturnValue(new Promise((resolve) => { resolveImport = resolve; }));

    renderApp();
    expect(await screen.findByText("Recuperación obligatoria")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Importar JSON válido" }));
    fireEvent.click(await screen.findByRole("button", { name: "Importar copia" }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Importar copia" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Importar copia" }));
    expect(window.hospitalDirectory.confirmJsonImport).toHaveBeenCalledTimes(1);

    resolveImport({ kind: "contacts-import", result: { contacts: defaultContacts, settings: editableSettings, recordCount: defaultContacts.records.length } });
    expect(await screen.findByText("Directorio disponible")).toBeInTheDocument();
  });

  it("cancels a spreadsheet preview selected from recovery", async () => {
    window.hospitalDirectory.getBootstrapData = vi.fn().mockResolvedValue({
      recovery: { reason: "invalid-contacts-json", contactsFilePath: "/tmp/data/contacts.json", message: "El archivo local contacts.json está dañado." },
      settings: editableSettings
    });
    window.hospitalDirectory.pickAndImportDataset = vi.fn().mockResolvedValue({
      kind: "csv-preview",
      preview: { importToken: "recovery-csv", fileName: "contacts.csv" }
    });

    renderApp();
    expect(await screen.findByText("Recuperación obligatoria")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Importar JSON válido" }));

    await waitFor(() => expect(window.hospitalDirectory.cancelCsvImportPreview).toHaveBeenCalledWith("recovery-csv"));
    expect(await screen.findByText("Selecciona una copia JSON válida para recuperar el directorio.")).toBeInTheDocument();
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
      settings: editableSettings
    });

    renderApp();

    expect(await screen.findByText("Recuperación obligatoria")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Restablecer directorio vacío" }));
    fireEvent.click((await screen.findAllByRole("button", { name: "Restablecer directorio vacío" })).at(-1)!);

    await waitFor(() => {
      expect(window.hospitalDirectory.resetDataset).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByText("Directorio disponible")).toBeInTheDocument();
  });

  it("shows the error message in the recovery panel when confirmation throws", async () => {
    window.hospitalDirectory.getBootstrapData = vi.fn().mockResolvedValue({
      recovery: {
        reason: "invalid-contacts-json",
        contactsFilePath: "/tmp/data/contacts.json",
        message: "El archivo local contacts.json está dañado o tiene un formato no válido."
      },
      settings: editableSettings
    });
    window.hospitalDirectory.pickAndImportDataset = vi.fn().mockResolvedValue({ kind: "json-preview", preview: { importToken: "recovery-error", fileName: "contacts.json", detectedType: "contacts", recordCount: 0, currentRecordCount: null } });
    window.hospitalDirectory.confirmJsonImport = vi.fn().mockRejectedValue(new Error("No se pudo importar una copia JSON válida."));

    renderApp();

    expect(await screen.findByText("Recuperación obligatoria")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Importar JSON válido" }));
    fireEvent.click(await screen.findByRole("button", { name: "Importar copia" }));

    expect(await screen.findByText("No se pudo importar una copia JSON válida.")).toBeInTheDocument();
  });

  it("shows the error message in the recovery panel when resetDataset throws", async () => {
    window.hospitalDirectory.getBootstrapData = vi.fn().mockResolvedValue({
      recovery: {
        reason: "invalid-contacts-json",
        contactsFilePath: "/tmp/data/contacts.json",
        message: "El archivo local contacts.json está dañado o tiene un formato no válido."
      },
      settings: editableSettings
    });
    window.hospitalDirectory.resetDataset = vi.fn().mockRejectedValue(
      new Error("No se pudo restablecer el directorio vacío.")
    );

    renderApp();

    expect(await screen.findByText("Recuperación obligatoria")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Restablecer directorio vacío" }));
    fireEvent.click((await screen.findAllByRole("button", { name: "Restablecer directorio vacío" })).at(-1)!);

    expect(await screen.findByText("No se pudo restablecer el directorio vacío.")).toBeInTheDocument();
  });

  it("restores managed paths from recovery mode and exits the blocked state", async () => {
    window.hospitalDirectory.getBootstrapData = vi.fn()
      .mockResolvedValueOnce({
        recovery: {
          reason: "invalid-contacts-json",
          contactsFilePath: "/tmp/custom-data/contacts.json",
          message: "El archivo configurado no existe."
        },
        settings: editableSettings
      })
      .mockResolvedValueOnce({
        contacts: defaultContacts,
        settings: {
          ...editableSettings,
          dataFilePath: "/tmp/default-data/contacts.json",
          backupDirectoryPath: "/tmp/default-backups"
        }
      });
    window.hospitalDirectory.saveSettings = vi.fn().mockResolvedValue({
      ...editableSettings,
      dataFilePath: "/tmp/default-data/contacts.json",
      backupDirectoryPath: "/tmp/default-backups"
    });

    renderApp();

    expect(await screen.findByText("Recuperación obligatoria")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Usar rutas gestionadas" }));

    await waitFor(() => {
      expect(window.hospitalDirectory.getSettingsDefaults).toHaveBeenCalledTimes(1);
      expect(window.hospitalDirectory.saveSettings).toHaveBeenCalledWith({
        editorName: "Samuel",
        dataFilePath: "/tmp/default-data/contacts.json",
        backupDirectoryPath: "/tmp/default-backups",
        ui: {
          showInactiveByDefault: false,
          autoBackup: editableSettings.ui.autoBackup
        }
      });
      expect(window.hospitalDirectory.getBootstrapData).toHaveBeenCalledTimes(2);
    });

    expect(await screen.findByText("Directorio disponible")).toBeInTheDocument();
  });

  it("confirmation throws with a custom message → custom message appears (not the hardcoded fallback)", async () => {
    window.hospitalDirectory.getBootstrapData = vi.fn().mockResolvedValue({
      recovery: {
        reason: "invalid-contacts-json",
        contactsFilePath: "/tmp/data/contacts.json",
        message: "El archivo local contacts.json está dañado o tiene un formato no válido."
      },
      settings: editableSettings
    });
    window.hospitalDirectory.pickAndImportDataset = vi.fn().mockResolvedValue({ kind: "json-preview", preview: { importToken: "recovery-custom", fileName: "contacts.json", detectedType: "contacts", recordCount: 0, currentRecordCount: null } });
    window.hospitalDirectory.confirmJsonImport = vi.fn().mockRejectedValue(new Error("Custom import failure"));

    renderApp();

    expect(await screen.findByText("Recuperación obligatoria")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Importar JSON válido" }));
    fireEvent.click(await screen.findByRole("button", { name: "Importar copia" }));

    expect(await screen.findByText("Custom import failure")).toBeInTheDocument();
    expect(screen.queryByText("No se pudo importar una copia JSON válida.")).not.toBeInTheDocument();
  });

  it("resetDataset throws with a custom message → custom message appears (not the hardcoded fallback)", async () => {
    window.hospitalDirectory.getBootstrapData = vi.fn().mockResolvedValue({
      recovery: {
        reason: "invalid-contacts-json",
        contactsFilePath: "/tmp/data/contacts.json",
        message: "El archivo local contacts.json está dañado o tiene un formato no válido."
      },
      settings: editableSettings
    });
    window.hospitalDirectory.resetDataset = vi.fn().mockRejectedValue(
      new Error("Custom reset failure")
    );

    renderApp();

    expect(await screen.findByText("Recuperación obligatoria")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Restablecer directorio vacío" }));
    fireEvent.click((await screen.findAllByRole("button", { name: "Restablecer directorio vacío" })).at(-1)!);

    expect(await screen.findByText("Custom reset failure")).toBeInTheDocument();
    expect(screen.queryByText("No se pudo restablecer el directorio vacío.")).not.toBeInTheDocument();
  });

  it("does not reset the dataset when the recovery reset dialog is canceled", async () => {
    window.hospitalDirectory.getBootstrapData = vi.fn().mockResolvedValue({
      recovery: {
        reason: "invalid-contacts-json",
        contactsFilePath: "/tmp/data/contacts.json",
        message: "El archivo local contacts.json está dañado o tiene un formato no válido."
      },
      settings: editableSettings
    });

    renderApp();

    expect(await screen.findByText("Recuperación obligatoria")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Restablecer directorio vacío" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cancelar" }));

    expect(window.hospitalDirectory.resetDataset).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("does not reset the dataset when the recovery reset dialog is dismissed with Escape", async () => {
    window.hospitalDirectory.getBootstrapData = vi.fn().mockResolvedValue({
      recovery: {
        reason: "invalid-contacts-json",
        contactsFilePath: "/tmp/data/contacts.json",
        message: "El archivo local contacts.json está dañado o tiene un formato no válido."
      },
      settings: editableSettings
    });

    renderApp();

    expect(await screen.findByText("Recuperación obligatoria")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Restablecer directorio vacío" }));

    const dialog = await screen.findByRole("dialog");
    const cancelEvent = new Event("cancel", { cancelable: true });
    fireEvent(dialog, cancelEvent);

    expect(cancelEvent.defaultPrevented).toBe(true);
    expect(window.hospitalDirectory.resetDataset).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("submits the recovery reset only once on rapid double confirm", async () => {
    window.hospitalDirectory.getBootstrapData = vi.fn().mockResolvedValue({
      recovery: {
        reason: "invalid-contacts-json",
        contactsFilePath: "/tmp/data/contacts.json",
        message: "El archivo local contacts.json está dañado o tiene un formato no válido."
      },
      settings: editableSettings
    });

    let resolveReset: ((value: Awaited<ReturnType<typeof window.hospitalDirectory.resetDataset>>) => void) | null = null;
    window.hospitalDirectory.resetDataset = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveReset = resolve;
        })
    );

    renderApp();

    expect(await screen.findByText("Recuperación obligatoria")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Restablecer directorio vacío" }));

    const confirmButton = (await screen.findAllByRole("button", { name: "Restablecer directorio vacío" })).at(-1)!;
    fireEvent.click(confirmButton);
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(window.hospitalDirectory.resetDataset).toHaveBeenCalledTimes(1);
    });

    resolveReset?.({
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
      settings: editableSettings
    });
  });

  it("shows bootstrap error UI when getBootstrapData rejects, and Reintentar retries the call", async () => {
    const getBootstrapData = vi.fn()
      .mockRejectedValueOnce(new Error("IPC not ready"))
      .mockResolvedValue({ contacts: defaultContacts, settings: editableSettings });

    window.hospitalDirectory.getBootstrapData = getBootstrapData;

    renderApp();

    const errorHeading = await screen.findByText("No se pudieron cargar los datos");
    expect(errorHeading).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
    // Focus moves to the boot error heading on mount so the most
    // critical error screen in the app is not missed visually.
    await waitFor(() => {
      expect(document.activeElement).toBe(errorHeading);
    });
    await waitFor(() => {
      expect(getBootstrapData).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByRole("button", { name: "Reintentar" }));

    await waitFor(() => {
      expect(getBootstrapData).toHaveBeenCalledTimes(2);
    });
  });

  it("shows a browser-only guidance message when the Electron bridge is unavailable", async () => {
    // @ts-expect-error test intentionally removes the preload bridge
    delete window.hospitalDirectory;

    renderApp();

    expect(
      await screen.findByText("La interfaz abierta en el navegador no puede acceder a los datos locales.")
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Usa la ventana de Electron que arranca con `pnpm dev`\./)
    ).toBeInTheDocument();
  });
});
