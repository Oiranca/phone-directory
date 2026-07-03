import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultContacts } from "../../shared/fixtures/defaultContacts";
import { ToastProvider } from "../components/feedback/ToastRegion";
import { ImportExportPage } from "./ImportExportPage";
import { useAppStore, resetBootstrapInFlight } from "../store/useAppStore";

const originalHTMLDialogElement = globalThis.HTMLDialogElement;
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

  if (originalHTMLDialogElement) {
    vi.stubGlobal("HTMLDialogElement", originalHTMLDialogElement);
  } else {
    vi.unstubAllGlobals();
  }
});

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
        restoreBackup: vi.fn().mockResolvedValue({
          contacts: {
            ...defaultContacts,
            records: [
              {
                ...defaultContacts.records[0]!,
                id: "cnt_restored",
                displayName: "Directorio restaurado"
              }
            ]
          },
          settings: editableSettings,
          backupPath: "/tmp/backups/contacts-before-restore.json",
          importedFilePath: "/tmp/backups/contacts-1.json",
          recordCount: 1
        }),
        exportDataset: vi.fn().mockResolvedValue({
          filePath: "/tmp/exports/share.json",
          exportedAt: defaultContacts.exportedAt,
          recordCount: defaultContacts.records.length
        }),
        previewCsvImport: vi.fn().mockResolvedValue({
          importToken: "csv-token-1",
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
          ],
          previewRows: [
            {
              rowNumber: 2,
              status: "accepted",
              displayName: "Admisión General",
              type: "service",
              department: "Admisión",
              area: "gestion-administracion",
              phone1Number: "12345"
            },
            {
              rowNumber: 3,
              status: "warning",
              displayName: "Urgencias",
              type: "service",
              department: "Urgencias",
              phone1Number: "99999",
              warningMessages: ["El área \"urgencias\" no está soportada y se omitirá."]
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
  });

  it("loads backup inventory and current dataset summary", async () => {
    renderPage();

    expect(await screen.findByText("Importar y exportar datos")).toBeInTheDocument();
    // PathDisplay renders the basename twice: once in the heading <p> and once in the
    // PathDisplay component itself — both showing "contacts-1.json".
    expect(screen.getAllByText("contacts-1.json").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(String(defaultContacts.records.length))).toBeInTheDocument();
  });

  it("creates a backup and shows success feedback", async () => {
    renderPage();

    expect(await screen.findByText("Importar y exportar datos")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Crear backup/ }));

    await waitFor(() => {
      expect(window.hospitalDirectory.createBackup).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByText("Backup creado.")).toBeInTheDocument();
  });

  it("shows the backup service error message when manual backup fails", async () => {
    window.hospitalDirectory.createBackup = vi
      .fn()
      .mockRejectedValue(new Error("No se pudo crear el backup del directorio. Ruta afectada: /tmp/backups."));

    renderPage();

    expect(await screen.findByText("Importar y exportar datos")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Crear backup/ }));

    expect(
      await screen.findByText("No se pudo crear el backup del directorio.")
    ).toBeInTheDocument();
  });

  it("exports the dataset and shows completion feedback", async () => {
    renderPage();

    expect(await screen.findByText("Importar y exportar datos")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Exportar JSON/ }));

    await waitFor(() => {
      expect(window.hospitalDirectory.exportDataset).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByText("Exportación completada.")).toBeInTheDocument();
  });

  it("shows the export service error message when the target path is not writable", async () => {
    window.hospitalDirectory.exportDataset = vi
      .fn()
      .mockRejectedValue(new Error("No se pudo exportar el directorio al destino seleccionado. Ruta afectada: /tmp/exports/share.json."));

    renderPage();

    expect(await screen.findByText("Importar y exportar datos")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Exportar JSON/ }));

    expect(
      await screen.findByText("No se pudo exportar el directorio al destino seleccionado.")
    ).toBeInTheDocument();
  });

  it("imports a dataset after confirmation and refreshes the store", async () => {
    renderPage();

    expect(await screen.findByText("Importar y exportar datos")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Importar JSON/ }));
    fireEvent.click((await screen.findAllByRole("button", { name: "Importar JSON" })).at(-1)!);

    await waitFor(() => {
      expect(window.hospitalDirectory.importDataset).toHaveBeenCalledTimes(1);
    });
    expect(useAppStore.getState().contacts?.records[0]?.displayName).toBe("Directorio importado");
    expect(await screen.findByText("Importación completada.")).toBeInTheDocument();
  });

  it("exposes a busy status while bootstrap data is still loading", async () => {
    let resolveBootstrap: ((value: Awaited<ReturnType<typeof window.hospitalDirectory.getBootstrapData>>) => void) | null = null;

    window.hospitalDirectory.getBootstrapData = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveBootstrap = resolve;
        })
    );

    renderPage();

    const loadingState = screen.getByRole("status");
    expect(loadingState).toHaveAttribute("aria-busy", "true");
    expect(loadingState).toHaveTextContent("Cargando importación y backups");

    resolveBootstrap?.({
      contacts: defaultContacts,
      settings: editableSettings
    });

    expect(await screen.findByText("Importar y exportar datos")).toBeInTheDocument();
  });

  it("calls ensureBootstrapLoaded on mount then loads backups (direct route entry)", async () => {
    renderPage();

    expect(await screen.findByText("Importar y exportar datos")).toBeInTheDocument();
    expect(window.hospitalDirectory.getBootstrapData).toHaveBeenCalledTimes(1);
    expect(window.hospitalDirectory.listBackups).toHaveBeenCalledTimes(1);
    expect(screen.getAllByText("contacts-1.json").length).toBeGreaterThanOrEqual(1);
  });

  it("does not reload bootstrap when store already has data (route transition), only loads backups", async () => {
    useAppStore.setState({
      contacts: defaultContacts,
      settings: editableSettings,
      isLoading: false,
      bootstrapStatus: "success",
      bootstrapError: "",
      bootstrapHelp: ""
    });

    renderPage();

    expect(await screen.findByText("Importar y exportar datos")).toBeInTheDocument();
    expect(window.hospitalDirectory.getBootstrapData).not.toHaveBeenCalled();
    expect(window.hospitalDirectory.listBackups).toHaveBeenCalledTimes(1);
  });

  it("does not hang on the spinner when bootstrap fails — exits loading state and shows error", async () => {
    window.hospitalDirectory.getBootstrapData = vi.fn().mockRejectedValue(new Error("IPC failed"));

    renderPage();

    // Should exit the spinner; aria-busy must not remain true indefinitely
    await waitFor(() => {
      const status = screen.getByRole("status");
      expect(status).not.toHaveAttribute("aria-busy", "true");
    });
    // listBackups must NOT be called when bootstrap failed
    expect(window.hospitalDirectory.listBackups).not.toHaveBeenCalled();
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
    expect(screen.getByText(/Formato detectado: exportación cruda de hoja de servicios/)).toBeInTheDocument();
    expect(screen.getByText("Confianza media en la detección del formato. Revisa la vista previa.")).toBeInTheDocument();
    expect(screen.getByText("El área \"urgencias\" no está soportada y se omitirá.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Confirmar importación/ }));
    fireEvent.click((await screen.findAllByRole("button", { name: "Confirmar importación" })).at(-1)!);

    await waitFor(() => {
      expect(window.hospitalDirectory.importCsvDataset).toHaveBeenCalledWith("csv-token-1", []);
    });
    expect(useAppStore.getState().contacts?.records[0]?.displayName).toBe("Directorio CSV");
    expect(await screen.findByText("Importación completada. 1 altas y 1 actualizaciones.")).toBeInTheDocument();
  });

  it("passes selected conflict policies when confirming a spreadsheet import", async () => {
    window.hospitalDirectory.previewCsvImport = vi.fn().mockResolvedValue({
      importToken: "csv-token-conflict",
      fileName: "conflicts.csv",
      totalRowCount: 1,
      validRowCount: 1,
      invalidRowCount: 0,
      warningCount: 0,
      recordCount: 1,
      mergedRecordCount: defaultContacts.records.length,
      createdCount: 0,
      updatedCount: 1,
      typeCounts: { service: 1 },
      areaCounts: {},
      rowIssues: [],
      warnings: [],
      previewRows: [
        {
          rowNumber: 2,
          status: "accepted",
          displayName: "Mostrador importado",
          type: "service"
        }
      ],
      conflictCount: 1,
      policiesResolved: false,
      conflictedRecords: [
        {
          recordIndex: 0,
          importedRecord: {
            id: "import-1",
            externalId: "legacy-1",
            type: "service",
            displayName: "Mostrador importado",
            department: "Admisión",
            status: "active",
            phones: [],
            emails: [],
            socials: []
          },
          matchingRecord: {
            id: "existing-1",
            externalId: "legacy-1",
            type: "service",
            displayName: "Mostrador actual",
            department: "Admisión",
            status: "active",
            phones: [],
            emails: [],
            socials: []
          },
          matchingRecordIndex: 0,
          matchingRecordSource: "existing",
          conflictType: "external-id-match",
          conflictReasonKey: "conflict_reason.external_id"
        }
      ]
    });

    renderPage();

    expect(await screen.findByText("Importar y exportar datos")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Preparar agenda/ }));
    expect(await screen.findByText("Conflictos (1)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Confirmar importación/ })).toBeDisabled();

    fireEvent.click(screen.getByRole("radio", { name: "Combinar" }));
    fireEvent.click(screen.getByRole("button", { name: /Confirmar importación/ }));
    fireEvent.click((await screen.findAllByRole("button", { name: "Confirmar importación" })).at(-1)!);

    await waitFor(() => {
      expect(window.hospitalDirectory.importCsvDataset).toHaveBeenCalledWith(
        "csv-token-conflict",
        [{ recordIndex: 0, policy: "merge-fields" }]
      );
    });
  });

  it("updates confirmation counts when a conflict is skipped", async () => {
    window.hospitalDirectory.previewCsvImport = vi.fn().mockResolvedValue({
      importToken: "csv-token-skip-conflict",
      fileName: "skip-conflicts.csv",
      totalRowCount: 1,
      validRowCount: 1,
      invalidRowCount: 0,
      warningCount: 0,
      recordCount: 1,
      mergedRecordCount: defaultContacts.records.length,
      createdCount: 0,
      updatedCount: 1,
      typeCounts: { service: 1 },
      areaCounts: {},
      rowIssues: [],
      warnings: [],
      previewRows: [
        {
          rowNumber: 2,
          status: "accepted",
          displayName: "Mostrador importado",
          type: "service"
        }
      ],
      conflictCount: 1,
      policiesResolved: false,
      conflictedRecords: [
        {
          recordIndex: 0,
          importedRecord: {
            id: "import-1",
            externalId: "legacy-1",
            type: "service",
            displayName: "Mostrador importado",
            status: "active",
            phones: [],
            emails: [],
            socials: []
          },
          matchingRecord: {
            id: "existing-1",
            externalId: "legacy-1",
            type: "service",
            displayName: "Mostrador actual",
            status: "active",
            phones: [],
            emails: [],
            socials: []
          },
          matchingRecordIndex: 0,
          matchingRecordSource: "existing",
          conflictType: "external-id-match",
          conflictReasonKey: "conflict_reason.external_id"
        }
      ]
    });

    renderPage();

    expect(await screen.findByText("Importar y exportar datos")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Preparar agenda/ }));
    fireEvent.click(await screen.findByRole("radio", { name: "Omitir" }));
    fireEvent.click(screen.getByRole("button", { name: /Confirmar importación/ }));

    expect(await screen.findByText(/0 se crearán y 0 se actualizarán/)).toBeInTheDocument();
  });

  it("blocks stale resolved previews when a conflict is missing its selected policy", async () => {
    window.hospitalDirectory.previewCsvImport = vi.fn().mockResolvedValue({
      importToken: "csv-token-stale-conflict",
      fileName: "stale-conflicts.csv",
      totalRowCount: 1,
      validRowCount: 1,
      invalidRowCount: 0,
      warningCount: 0,
      recordCount: 1,
      mergedRecordCount: defaultContacts.records.length,
      createdCount: 0,
      updatedCount: 1,
      typeCounts: { service: 1 },
      areaCounts: {},
      rowIssues: [],
      warnings: [],
      previewRows: [
        {
          rowNumber: 2,
          status: "accepted",
          displayName: "Mostrador importado",
          type: "service"
        }
      ],
      conflictCount: 1,
      policiesResolved: true,
      conflictedRecords: [
        {
          recordIndex: 0,
          importedRecord: {
            id: "import-1",
            externalId: "legacy-1",
            type: "service",
            displayName: "Mostrador importado",
            status: "active",
            phones: [],
            emails: [],
            socials: []
          },
          matchingRecord: {
            id: "existing-1",
            externalId: "legacy-1",
            type: "service",
            displayName: "Mostrador actual",
            status: "active",
            phones: [],
            emails: [],
            socials: []
          },
          matchingRecordIndex: 0,
          matchingRecordSource: "existing",
          conflictType: "external-id-match",
          conflictReasonKey: "conflict_reason.external_id"
        }
      ]
    });

    renderPage();

    expect(await screen.findByText("Importar y exportar datos")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Preparar agenda/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Confirmar importación/ }));
    fireEvent.click((await screen.findAllByRole("button", { name: "Confirmar importación" })).at(-1)!);

    expect(await screen.findByText("Resuelve todos los conflictos antes de importar.")).toBeInTheDocument();
    expect(window.hospitalDirectory.importCsvDataset).not.toHaveBeenCalled();
  });

  it("OIR-200: allows a partial import when the preview contains some invalid rows alongside valid rows", async () => {
    window.hospitalDirectory.previewCsvImport = vi.fn().mockResolvedValue({
      importToken: "csv-token-invalid",
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
      warnings: [],
      previewRows: [
        {
          rowNumber: 2,
          status: "accepted",
          displayName: "Registro válido",
          type: "person",
          phone1Number: "11111"
        },
        {
          rowNumber: 3,
          status: "rejected",
          displayName: "Fila rota",
          errorMessages: ["El tipo es obligatorio."]
        }
      ]
    });
    window.hospitalDirectory.importCsvDataset = vi.fn().mockResolvedValue({
      contacts: {
        ...defaultContacts,
        records: [
          {
            ...defaultContacts.records[0]!,
            id: "cnt_csv_partial",
            displayName: "Registro válido"
          }
        ]
      },
      settings: editableSettings,
      backupPath: "/tmp/backups/contacts-csv-partial.json",
      importedFilePath: "/tmp/incoming/broken.csv",
      recordCount: defaultContacts.records.length,
      warningCount: 0,
      invalidRowCount: 1,
      createdCount: 0,
      updatedCount: 1,
      conflictCount: 0,
      rowIssues: [
        {
          rowNumber: 3,
          displayName: "Fila rota",
          messages: ["El tipo es obligatorio."]
        }
      ]
    });

    renderPage();

    expect(await screen.findByText("Importar y exportar datos")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Preparar agenda/ }));

    expect(
      await screen.findByText("1 fila será omitida al importar. 0 altas y 1 actualizaciones previstas para las filas válidas.")
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Confirmar importación/ })).not.toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /Confirmar importación/ }));
    fireEvent.click((await screen.findAllByRole("button", { name: "Confirmar importación" })).at(-1)!);

    await waitFor(() => {
      expect(window.hospitalDirectory.importCsvDataset).toHaveBeenCalledWith("csv-token-invalid", []);
    });
    expect(
      await screen.findByText("Importación completada. 0 altas y 1 actualizaciones. Se omitió 1 fila rechazada.")
    ).toBeInTheDocument();
  });

  it("OIR-200: still blocks import confirmation when the preview has zero valid rows", async () => {
    window.hospitalDirectory.previewCsvImport = vi.fn().mockResolvedValue({
      importToken: "csv-token-all-invalid",
      fileName: "all-broken.csv",
      totalRowCount: 1,
      validRowCount: 0,
      invalidRowCount: 1,
      warningCount: 0,
      recordCount: 0,
      mergedRecordCount: defaultContacts.records.length,
      createdCount: 0,
      updatedCount: 0,
      parsedBuscasCellCount: 0,
      typeCounts: {},
      areaCounts: {},
      rowIssues: [
        {
          rowNumber: 2,
          displayName: "Fila rota",
          messages: ["El tipo es obligatorio."]
        }
      ],
      warnings: [],
      previewRows: [
        {
          rowNumber: 2,
          status: "rejected",
          displayName: "Fila rota",
          errorMessages: ["El tipo es obligatorio."]
        }
      ]
    });

    renderPage();

    expect(await screen.findByText("Importar y exportar datos")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Preparar agenda/ }));

    expect(
      await screen.findByText("El archivo no contiene filas válidas para importar. Corrige el origen antes de importar.")
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Confirmar importación/ })).toBeDisabled();
    expect(window.hospitalDirectory.importCsvDataset).not.toHaveBeenCalled();
  });

  it("clears the previous CSV preview when a new selection is canceled", async () => {
    window.hospitalDirectory.previewCsvImport = vi
      .fn()
      .mockResolvedValueOnce({
        importToken: "csv-token-first",
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
        warnings: [],
        previewRows: [
          {
            rowNumber: 2,
            status: "accepted",
            displayName: "Registro A",
            type: "person",
            phone1Number: "11111"
          },
          {
            rowNumber: 3,
            status: "accepted",
            displayName: "Registro B",
            type: "person",
            phone1Number: "22222"
          }
        ]
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
    expect(await screen.findByText("Selección cancelada.")).toBeInTheDocument();
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

  it("restores a listed backup after dialog confirmation", async () => {
    renderPage();

    expect(await screen.findByText("Importar y exportar datos")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Preparar agenda/ }));
    expect(await screen.findByText("Vista previa importación")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Restaurar este backup" }));
    fireEvent.click(await screen.findByRole("button", { name: "Restaurar backup" }));

    await waitFor(() => {
      expect(window.hospitalDirectory.restoreBackup).toHaveBeenCalledWith("/tmp/backups/contacts-1.json");
    });
    expect(useAppStore.getState().contacts?.records[0]?.displayName).toBe("Directorio restaurado");
    expect(await screen.findByText("Backup restaurado.")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText("Vista previa importación")).not.toBeInTheDocument();
    });
  });

  it("shows the restore service error message when backup restore fails", async () => {
    window.hospitalDirectory.restoreBackup = vi
      .fn()
      .mockRejectedValue(new Error("No se pudo restaurar el backup seleccionado. Ruta afectada: /tmp/backups/contacts-1.json."));

    renderPage();

    expect(await screen.findByText("Importar y exportar datos")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Restaurar este backup" }));
    fireEvent.click(await screen.findByRole("button", { name: "Restaurar backup" }));

    expect(
      await screen.findByText("No se pudo restaurar el backup seleccionado.")
    ).toBeInTheDocument();
  });

  it("disables competing actions while a backup restore is running", async () => {
    let resolveRestore: ((value: Awaited<ReturnType<typeof window.hospitalDirectory.restoreBackup>>) => void) | null = null;
    window.hospitalDirectory.restoreBackup = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRestore = resolve;
        })
    );

    renderPage();

    expect(await screen.findByText("Importar y exportar datos")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Restaurar este backup" }));
    fireEvent.click(await screen.findByRole("button", { name: "Restaurar backup" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Actualizar" })).toBeDisabled();
    });
    expect(screen.getByRole("button", { name: /Crear backup/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Exportar JSON/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Importar JSON/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Preparar agenda/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Restaurando…" })).toBeDisabled();

    resolveRestore?.({
      contacts: defaultContacts,
      settings: editableSettings,
      backupPath: "/tmp/backups/contacts-before-restore.json",
      importedFilePath: "/tmp/backups/contacts-1.json",
      recordCount: defaultContacts.records.length
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Actualizar" })).not.toBeDisabled();
    });
  });

  it("submits restore confirmation only once on rapid double click", async () => {
    let resolveRestore: ((value: Awaited<ReturnType<typeof window.hospitalDirectory.restoreBackup>>) => void) | null = null;
    window.hospitalDirectory.restoreBackup = vi.fn().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRestore = resolve;
        })
    );

    renderPage();

    expect(await screen.findByText("Importar y exportar datos")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Restaurar este backup" }));

    const confirmButton = await screen.findByRole("button", { name: "Restaurar backup" });
    fireEvent.click(confirmButton);
    fireEvent.click(confirmButton);

    await waitFor(() => {
      expect(window.hospitalDirectory.restoreBackup).toHaveBeenCalledTimes(1);
    });

    resolveRestore?.({
      contacts: defaultContacts,
      settings: editableSettings,
      backupPath: "/tmp/backups/contacts-before-restore.json",
      importedFilePath: "/tmp/backups/contacts-1.json",
      recordCount: defaultContacts.records.length
    });
  });

  it("does NOT call listBackups in recovery mode (contacts null, settings present)", async () => {
    // FIX 2 regression lock: loadBackups must only fire when BOTH contacts AND
    // settings are present. In recovery mode contacts is null, so the backup
    // panel is hidden by the render gate — issuing listBackups IPC is wasted work.
    window.hospitalDirectory.getBootstrapData = vi.fn().mockResolvedValue({
      recovery: {
        reason: "invalid-contacts-json",
        contactsFilePath: "/data/contacts.json",
        message: "Failed to parse"
      },
      settings: editableSettings
    });

    renderPage();

    // Wait for the bootstrap to complete (store moves to success with contacts=null)
    await waitFor(() => {
      expect(useAppStore.getState().bootstrapStatus).toBe("success");
    });
    await waitFor(() => {
      expect(useAppStore.getState().isLoading).toBe(false);
    });

    expect(window.hospitalDirectory.listBackups).not.toHaveBeenCalled();
  });

  it("calls listBackups in normal mode (contacts AND settings both present)", async () => {
    // Ensure the happy path: both contacts and settings non-null → listBackups fires.
    renderPage();

    expect(await screen.findByText("Importar y exportar datos")).toBeInTheDocument();
    expect(window.hospitalDirectory.listBackups).toHaveBeenCalledTimes(1);
  });

  it("moves focus to the panel heading when the CSV import preview panel opens", async () => {
    renderPage();

    expect(await screen.findByText("Importar y exportar datos")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Preparar agenda/ }));

    // useLayoutEffect fires synchronously after the DOM update — no timer involved
    await waitFor(() => {
      const heading = screen.getByRole("heading", { name: "directory.csv" });
      expect(document.activeElement).toBe(heading);
    });
  });

  it("returns focus to the trigger button when the CSV preview panel closes", async () => {
    renderPage();

    expect(await screen.findByText("Importar y exportar datos")).toBeInTheDocument();

    const triggerButton = screen.getByRole("button", { name: /Preparar agenda/ });
    fireEvent.click(triggerButton);
    await screen.findByText("Vista previa importación");

    fireEvent.click(screen.getByRole("button", { name: "Cerrar vista previa" }));

    await waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: /Preparar agenda/ })
      );
    });
  });

  it("does NOT re-issue listBackups when contacts change after initial load (backupsRequestedRef guard)", async () => {
    // Regression lock for the loaded-once guarantee: after the initial load,
    // subsequent store mutations (e.g. after a JSON import) update contacts,
    // which is now in the effect deps. The backupsRequestedRef guard must
    // prevent listBackups from firing a second time.
    renderPage();

    // Wait for initial load to complete
    expect(await screen.findByText("Importar y exportar datos")).toBeInTheDocument();
    expect(window.hospitalDirectory.listBackups).toHaveBeenCalledTimes(1);

    // Simulate a contacts mutation (e.g. post-import store update)
    const mutatedContacts = {
      ...defaultContacts,
      records: defaultContacts.records.slice(0, 1)
    };
    useAppStore.setState({ contacts: mutatedContacts });

    // Give React time to flush any effects triggered by the state change
    await waitFor(() => {
      expect(useAppStore.getState().contacts).toBe(mutatedContacts);
    });

    // listBackups must still be 1 — the ref guard prevented a second call
    expect(window.hospitalDirectory.listBackups).toHaveBeenCalledTimes(1);
  });

  it("shows error UI and does not hang spinner when bootstrap fails (bootstrap-error early-out)", async () => {
    window.hospitalDirectory.getBootstrapData = vi.fn().mockRejectedValue(new Error("bridge error"));

    renderPage();

    // Spinner must stop
    await waitFor(() => {
      const status = screen.getByRole("status");
      expect(status).not.toHaveAttribute("aria-busy", "true");
    });

    // Error text is shown, not the spinner text
    expect(screen.queryByText(/Cargando importación/)).not.toBeInTheDocument();
    // listBackups must never be called
    expect(window.hospitalDirectory.listBackups).not.toHaveBeenCalled();
  });
});
