import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultContacts } from "../../shared/fixtures/defaultContacts";
import { ToastProvider } from "../components/feedback/ToastRegion";
import { ImportExportPage } from "./ImportExportPage";
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
        <ImportExportPage />
      </MemoryRouter>
    </ToastProvider>
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
        previewCsvImport: vi.fn().mockResolvedValue({
          importToken: "csv-token-1",
          sourceFilePath: "/tmp/incoming/directory.csv",
          fileName: "directory.csv",
          detectedFormat: "exportación cruda de hoja de servicios",
          detectionConfidence: "medium",
          totalRowCount: 2,
          validRowCount: 2,
          invalidRowCount: 0,
          warningCount: 1,
          recordCount: 2,
          mergedRecordCount: defaultContacts.records.length + 1,
          createdCount: 1,
          updatedCount: 1,
          typeCounts: {
            person: 1,
            service: 1
          },
          areaCounts: {
            otros: 1
          },
          rowIssues: [],
          warnings: [
            {
              rowNumber: 3,
              displayName: "Urgencias",
              message: "El área \"urgencias\" no está soportada y se omitirá."
            }
          ]
        }),
        importCsvDataset: vi.fn().mockResolvedValue({
          contacts: {
            ...defaultContacts,
            records: [
              {
                ...defaultContacts.records[0]!,
                id: "cnt_csv_imported",
                displayName: "Directorio CSV"
              }
            ]
          },
          settings: editableSettings,
          backupPath: "/tmp/backups/contacts-csv-auto.json",
          importedFilePath: "/tmp/incoming/directory.csv",
          recordCount: defaultContacts.records.length + 1,
          warningCount: 1,
          invalidRowCount: 0,
          createdCount: 1,
          updatedCount: 1
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

    expect(await screen.findByText("Importar y exportar datos")).toBeInTheDocument();
    expect(screen.getByText("contacts-1.json")).toBeInTheDocument();
    expect(screen.getByText(String(defaultContacts.records.length))).toBeInTheDocument();
  });

  it("creates a backup and shows success feedback", async () => {
    renderPage();

    expect(await screen.findByText("Importar y exportar datos")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Crear backup/ }));

    await waitFor(() => {
      expect(window.hospitalDirectory.createBackup).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByText(/Backup creado en/)).toBeInTheDocument();
  });

  it("shows the backup service error message when manual backup fails", async () => {
    window.hospitalDirectory.createBackup = vi
      .fn()
      .mockRejectedValue(new Error("No se pudo crear el backup del directorio. Ruta afectada: /tmp/backups."));

    renderPage();

    expect(await screen.findByText("Importar y exportar datos")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Crear backup/ }));

    expect(
      await screen.findByText("No se pudo crear el backup del directorio. Ruta afectada: /tmp/backups.")
    ).toBeInTheDocument();
  });

  it("exports the dataset and shows completion feedback", async () => {
    renderPage();

    expect(await screen.findByText("Importar y exportar datos")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Exportar JSON/ }));

    await waitFor(() => {
      expect(window.hospitalDirectory.exportDataset).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByText(/Exportación completada en/)).toBeInTheDocument();
  });

  it("shows the export service error message when the target path is not writable", async () => {
    window.hospitalDirectory.exportDataset = vi
      .fn()
      .mockRejectedValue(new Error("No se pudo exportar el directorio al destino seleccionado. Ruta afectada: /tmp/exports/share.json."));

    renderPage();

    expect(await screen.findByText("Importar y exportar datos")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Exportar JSON/ }));

    expect(
      await screen.findByText("No se pudo exportar el directorio al destino seleccionado. Ruta afectada: /tmp/exports/share.json.")
    ).toBeInTheDocument();
  });

  it("imports a dataset after confirmation and refreshes the store", async () => {
    renderPage();

    expect(await screen.findByText("Importar y exportar datos")).toBeInTheDocument();
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

  it("shows a backup refresh error instead of throwing on rejection", async () => {
    renderPage();

    expect(await screen.findByText("Importar y exportar datos")).toBeInTheDocument();
    window.hospitalDirectory.listBackups = vi.fn().mockRejectedValue(new Error("broken refresh"));

    fireEvent.click(screen.getByRole("button", { name: "Actualizar" }));

    expect(
      await screen.findByText("No se pudo actualizar la lista de backups. Inténtalo de nuevo.")
    ).toBeInTheDocument();
  });

  it("renders a fallback label for invalid timestamps in backups", async () => {
    window.hospitalDirectory.listBackups = vi.fn().mockResolvedValue([
      {
        fileName: "broken-date.json",
        filePath: "/tmp/backups/broken-date.json",
        createdAt: "not-a-date",
        sizeBytes: 1200
      }
    ]);

    renderPage();

    expect(await screen.findByText("Fecha no válida")).toBeInTheDocument();
  });

  it("previews a spreadsheet file and imports it after confirmation", async () => {
    renderPage();

    expect(await screen.findByText("Importar y exportar datos")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Preparar agenda/ }));

    expect(await screen.findByText("Vista previa importación")).toBeInTheDocument();
    expect(screen.getByText("directory.csv")).toBeInTheDocument();
    expect(screen.getAllByText(/Formato detectado: exportación cruda de hoja de servicios/)).toHaveLength(2);
    expect(screen.getByText(/La detección del formato tiene confianza media/)).toBeInTheDocument();
    expect(screen.getByText("El área \"urgencias\" no está soportada y se omitirá.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Confirmar importación/ }));

    await waitFor(() => {
      expect(window.hospitalDirectory.importCsvDataset).toHaveBeenCalledWith("csv-token-1");
    });
    expect(useAppStore.getState().contacts?.records[0]?.displayName).toBe("Directorio CSV");
    expect(await screen.findByText(/Importación completada desde/)).toBeInTheDocument();
  });

  it("blocks import confirmation when the preview contains invalid rows", async () => {
    window.hospitalDirectory.previewCsvImport = vi.fn().mockResolvedValue({
      importToken: "csv-token-invalid",
      sourceFilePath: "/tmp/incoming/broken.csv",
      fileName: "broken.csv",
      totalRowCount: 2,
      validRowCount: 1,
      invalidRowCount: 1,
      warningCount: 0,
      recordCount: 1,
      mergedRecordCount: defaultContacts.records.length,
      createdCount: 0,
      updatedCount: 1,
      typeCounts: {
        person: 1
      },
      areaCounts: {},
      rowIssues: [
        {
          rowNumber: 3,
          displayName: "Fila rota",
          messages: ["El tipo es obligatorio."]
        }
      ],
      warnings: []
    });

    renderPage();

    expect(await screen.findByText("Importar y exportar datos")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Preparar agenda/ }));

    expect(await screen.findByText("El archivo tiene filas inválidas. Corrige el origen antes de importar.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Confirmar importación/ })).toBeDisabled();
    expect(window.hospitalDirectory.importCsvDataset).not.toHaveBeenCalled();
  });

  it("clears the previous CSV preview when a new selection is canceled", async () => {
    window.hospitalDirectory.previewCsvImport = vi
      .fn()
      .mockResolvedValueOnce({
        importToken: "csv-token-first",
        sourceFilePath: "/tmp/incoming/directory.csv",
        fileName: "directory.csv",
        totalRowCount: 2,
        validRowCount: 2,
        invalidRowCount: 0,
        warningCount: 0,
        recordCount: 2,
        mergedRecordCount: defaultContacts.records.length + 2,
        createdCount: 2,
        updatedCount: 0,
        typeCounts: {
          person: 2
        },
        areaCounts: {},
        rowIssues: [],
        warnings: []
      })
      .mockResolvedValueOnce(null);

    renderPage();

    expect(await screen.findByText("Importar y exportar datos")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Preparar agenda/ }));
    expect(await screen.findByText("Vista previa importación")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Preparar agenda/ }));

    await waitFor(() => {
      expect(screen.queryByText("Vista previa importación")).not.toBeInTheDocument();
    });
    expect(await screen.findByText("Selección de archivo cancelada.")).toBeInTheDocument();
  });

  it("shows the import error when preview preparation fails before row parsing", async () => {
    window.hospitalDirectory.previewCsvImport = vi
      .fn()
      .mockRejectedValue(
        new Error(
          "La cabecera del CSV contiene columnas fuera de la plantilla MVP: legacyDesk. Usa la plantilla oficial antes de importar."
        )
      );

    renderPage();

    expect(await screen.findByText("Importar y exportar datos")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Preparar agenda/ }));

    expect(
      await screen.findByText(
        "La cabecera del CSV contiene columnas fuera de la plantilla MVP: legacyDesk. Usa la plantilla oficial antes de importar."
      )
    ).toBeInTheDocument();
    expect(screen.queryByText("Vista previa importación")).not.toBeInTheDocument();
  });
});
