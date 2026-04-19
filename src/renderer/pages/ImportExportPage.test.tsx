import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultContacts } from "../../shared/fixtures/defaultContacts";
import { ImportExportPage } from "./ImportExportPage";
import { useAppStore } from "../store/useAppStore";

const resetStore = () => {
  useAppStore.setState({
    contacts: null,
    settings: null,
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
    <MemoryRouter>
      <ImportExportPage />
    </MemoryRouter>
  );

describe("ImportExportPage", () => {
  beforeEach(() => {
    resetStore();
    vi.stubGlobal("confirm", vi.fn(() => true));
    Object.defineProperty(window, "hospitalDirectory", {
      configurable: true,
      value: {
        getBootstrapData: vi.fn().mockResolvedValue({
          contacts: defaultContacts,
          settings: editableSettings
        }),
        saveSettings: vi.fn(),
        createBackup: vi.fn().mockResolvedValue("/tmp/backups/contacts-1.json"),
        createRecord: vi.fn(),
        updateRecord: vi.fn(),
        listBackups: vi.fn().mockResolvedValue([
          {
            fileName: "contacts-1.json",
            filePath: "/tmp/backups/contacts-1.json",
            createdAt: "2026-04-19T18:00:00.000Z",
            sizeBytes: 2048
          }
        ]),
        exportDataset: vi.fn().mockResolvedValue({
          filePath: "/tmp/exports/share.json",
          exportedAt: defaultContacts.exportedAt,
          recordCount: defaultContacts.records.length
        }),
        importDataset: vi.fn().mockResolvedValue({
          contacts: {
            ...defaultContacts,
            records: [
              {
                ...defaultContacts.records[0]!,
                id: "cnt_replaced",
                displayName: "Directorio importado"
              }
            ]
          },
          settings: editableSettings,
          backupPath: "/tmp/backups/contacts-auto.json",
          importedFilePath: "/tmp/incoming/replacement.json",
          recordCount: 1
        })
      }
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("loads backup inventory and current dataset summary", async () => {
    renderPage();

    expect(await screen.findByText("Importar y exportar JSON")).toBeInTheDocument();
    expect(screen.getByText("contacts-1.json")).toBeInTheDocument();
    expect(screen.getByText(String(defaultContacts.records.length))).toBeInTheDocument();
  });

  it("creates a backup and shows success feedback", async () => {
    renderPage();

    expect(await screen.findByText("Importar y exportar JSON")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Crear backup/ }));

    await waitFor(() => {
      expect(window.hospitalDirectory.createBackup).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByText(/Backup creado en/)).toBeInTheDocument();
  });

  it("exports the dataset and shows completion feedback", async () => {
    renderPage();

    expect(await screen.findByText("Importar y exportar JSON")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Exportar JSON/ }));

    await waitFor(() => {
      expect(window.hospitalDirectory.exportDataset).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByText(/Exportación completada en/)).toBeInTheDocument();
  });

  it("imports a dataset after confirmation and refreshes the store", async () => {
    renderPage();

    expect(await screen.findByText("Importar y exportar JSON")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Importar JSON/ }));

    await waitFor(() => {
      expect(window.hospitalDirectory.importDataset).toHaveBeenCalledTimes(1);
    });
    expect(useAppStore.getState().contacts?.records[0]?.displayName).toBe("Directorio importado");
    expect(await screen.findByText(/Importación completada desde/)).toBeInTheDocument();
  });

  it("shows a recovery state when bootstrap loading fails", async () => {
    window.hospitalDirectory.getBootstrapData = vi.fn().mockRejectedValue(new Error("broken file"));
    window.hospitalDirectory.listBackups = vi.fn().mockRejectedValue(new Error("broken file"));

    renderPage();

    expect(await screen.findByText("Importación y backups no disponibles")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reintentar" })).toBeInTheDocument();
  });
});
