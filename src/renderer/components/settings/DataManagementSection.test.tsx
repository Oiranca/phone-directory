import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultContacts } from "../../../shared/fixtures/defaultContacts";
import { ToastProvider } from "../feedback/ToastRegion";
import { DataManagementSection } from "./DataManagementSection";
import { useAppStore, resetBootstrapInFlight } from "../../store/useAppStore";

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
        <DataManagementSection />
      </MemoryRouter>
    </ToastProvider>
  );

// OIR-219: the "Importar" card is now a single button. Clicking it opens the
// pre-selection safety confirmation (generic — covers both the JSON
// full-replace and the CSV preview outcomes) before pickAndImportDataset()
// is actually invoked. Tests drive that two-click sequence through this helper.
const openImportPicker = async () => {
  fireEvent.click(screen.getByRole("button", { name: "Importar" }));
  fireEvent.click(await screen.findByRole("button", { name: "Elegir archivo" }));
};

const defaultCsvPreview = {
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
};

const defaultJsonImportResult = {
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
};

describe("DataManagementSection (OIR-219 — Configuración data section)", () => {
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
        // OIR-219: the component only calls pickAndImportDataset() — default to
        // the CSV-preview flow since most tests exercise it. Tests that need the
        // JSON full-replace flow override this per-test with a "json-import" kind.
        pickAndImportDataset: vi.fn().mockResolvedValue({
          kind: "csv-preview",
          preview: { ...defaultCsvPreview }
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
        })
      }
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("loads backup inventory and current dataset summary", async () => {
    renderPage();

    expect(await screen.findByText("Datos e importación")).toBeInTheDocument();
    // OIR-223: the fetched backup inventory now only drives the single
    // "Última copia de seguridad" date indicator — no per-backup list.
    expect(await screen.findByText(/Última copia de seguridad:/)).toBeInTheDocument();
    expect(screen.getByText(String(defaultContacts.records.length))).toBeInTheDocument();
    expect(screen.getByText("Última actualización del directorio")).toBeInTheDocument();
  });

  it("card-like action buttons carry focus-ring for keyboard focus visibility", async () => {
    renderPage();

    expect(await screen.findByText("Datos e importación")).toBeInTheDocument();

    const backupBtn = screen.getByRole("button", { name: /Crear copia de seguridad/ });
    const exportBtn = screen.getByRole("button", { name: /Guardar la copia en otra carpeta/ });
    const importBtn = screen.getByRole("button", { name: "Importar" });

    expect(backupBtn.className).toContain("focus-ring");
    expect(exportBtn.className).toContain("focus-ring");
    expect(importBtn.className).toContain("focus-ring");
  });

  it("OIR-223: shows the unified Import card copy describing both possible outcomes in plain backup language (no 'JSON' wording)", async () => {
    renderPage();

    expect(await screen.findByText("Datos e importación")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Selecciona un archivo para importar. Si es una copia de seguridad completa, reemplaza los datos actuales del directorio (se crea una copia de seguridad automática antes de continuar). Si es una hoja de cálculo (CSV, ODS, XLS o XLSX), se valida y se muestra una vista previa antes de aplicar los cambios."
      )
    ).toBeInTheDocument();
    expect(screen.queryByText(/JSON/)).not.toBeInTheDocument();
  });

  it("creates a backup and shows success feedback", async () => {
    renderPage();

    expect(await screen.findByText("Datos e importación")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Crear copia de seguridad/ }));

    await waitFor(() => {
      expect(window.hospitalDirectory.createBackup).toHaveBeenCalledTimes(1);
    });
    expect(await screen.findByText("Copia de seguridad creada.")).toBeInTheDocument();
  });

  it("shows the backup service error message when manual backup fails", async () => {
    window.hospitalDirectory.createBackup = vi
      .fn()
      .mockRejectedValue(new Error("No se pudo crear la copia de seguridad del directorio. Ruta afectada: /tmp/backups."));

    renderPage();

    expect(await screen.findByText("Datos e importación")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Crear copia de seguridad/ }));

    expect(
      await screen.findByText("No se pudo crear la copia de seguridad del directorio.")
    ).toBeInTheDocument();
  });

  it("exports the dataset and shows completion feedback", async () => {
    renderPage();

    expect(await screen.findByText("Datos e importación")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Guardar la copia en otra carpeta/ }));

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

    expect(await screen.findByText("Datos e importación")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Guardar la copia en otra carpeta/ }));

    expect(
      await screen.findByText("No se pudo exportar el directorio al destino seleccionado.")
    ).toBeInTheDocument();
  });

  it("shows the pre-selection confirmation dialog before opening the file picker", async () => {
    renderPage();

    expect(await screen.findByText("Datos e importación")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Importar" }));

    const dialog = await screen.findByRole("dialog", { name: "Seleccionar archivo para importar" });
    expect(dialog).toBeVisible();
    expect(window.hospitalDirectory.pickAndImportDataset).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Elegir archivo" }));
    await waitFor(() => {
      expect(window.hospitalDirectory.pickAndImportDataset).toHaveBeenCalledTimes(1);
    });
  });

  it("imports a JSON dataset after confirmation and refreshes the store", async () => {
    window.hospitalDirectory.pickAndImportDataset = vi.fn().mockResolvedValue({
      kind: "json-import",
      result: defaultJsonImportResult
    });

    renderPage();

    expect(await screen.findByText("Datos e importación")).toBeInTheDocument();
    await openImportPicker();

    await waitFor(() => {
      expect(window.hospitalDirectory.pickAndImportDataset).toHaveBeenCalledTimes(1);
    });
    expect(useAppStore.getState().contacts?.records[0]?.displayName).toBe("Directorio importado");
    expect(await screen.findByText("Importación completada.")).toBeInTheDocument();
  });

  it("shows a cancellation toast when the file dialog is dismissed", async () => {
    window.hospitalDirectory.pickAndImportDataset = vi.fn().mockResolvedValue({ kind: "cancelled" });

    renderPage();

    expect(await screen.findByText("Datos e importación")).toBeInTheDocument();
    await openImportPicker();

    expect(await screen.findByText("Selección cancelada.")).toBeInTheDocument();
  });

  it("shows an error toast for an unsupported file extension", async () => {
    window.hospitalDirectory.pickAndImportDataset = vi.fn().mockResolvedValue({
      kind: "unsupported-extension",
      extension: "exe"
    });

    renderPage();

    expect(await screen.findByText("Datos e importación")).toBeInTheDocument();
    await openImportPicker();

    expect(
      await screen.findByText("Tipo de archivo no admitido (.exe). Elige una copia de seguridad o una hoja de cálculo (CSV, ODS, XLS o XLSX).")
    ).toBeInTheDocument();
  });

  it("shows the import error when the picker/dispatch call fails", async () => {
    window.hospitalDirectory.pickAndImportDataset = vi
      .fn()
      .mockRejectedValue(new Error("La cabecera del CSV contiene columnas que no pertenecen a la plantilla oficial: legacyDesk. Corrige el archivo antes de importarlo."));

    renderPage();

    expect(await screen.findByText("Datos e importación")).toBeInTheDocument();
    await openImportPicker();

    expect(
      await screen.findByText(
        "La cabecera del CSV contiene columnas que no pertenecen a la plantilla oficial: legacyDesk. Corrige el archivo antes de importarlo."
      )
    ).toBeInTheDocument();
    expect(screen.queryByText("Vista previa importación")).not.toBeInTheDocument();
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
    expect(loadingState).toHaveTextContent("Cargando importación y copias de seguridad");

    resolveBootstrap?.({
      contacts: defaultContacts,
      settings: editableSettings
    });

    expect(await screen.findByText("Datos e importación")).toBeInTheDocument();
  });

  it("calls ensureBootstrapLoaded on mount then loads backups (direct route entry)", async () => {
    renderPage();

    expect(await screen.findByText("Datos e importación")).toBeInTheDocument();
    expect(window.hospitalDirectory.getBootstrapData).toHaveBeenCalledTimes(1);
    expect(window.hospitalDirectory.listBackups).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(/Última copia de seguridad:/)).toBeInTheDocument();
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

    expect(await screen.findByText("Datos e importación")).toBeInTheDocument();
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

    expect(await screen.findByText("Datos e importación")).toBeInTheDocument();
    window.hospitalDirectory.listBackups = vi.fn().mockRejectedValue(new Error("broken refresh"));

    fireEvent.click(screen.getByRole("button", { name: "Actualizar" }));

    expect(
      await screen.findByText("No se pudo actualizar la lista de copias de seguridad. Inténtalo de nuevo.")
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

    expect(await screen.findByText("Datos e importación")).toBeInTheDocument();
    await openImportPicker();

    expect(await screen.findByText("Vista previa importación")).toBeInTheDocument();
    expect(screen.getByText("directory.csv")).toBeInTheDocument();
    expect(screen.getByText(/Formato detectado: exportación cruda de hoja de servicios/)).toBeInTheDocument();
    // OIR-188: confidence note is shown in the preview panel (not in the toast)
    expect(screen.getByText(/Confianza media en la detección del formato\. Revisa la vista previa\./)).toBeInTheDocument();
    expect(screen.getByText("El área \"urgencias\" no está soportada y se omitirá.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Confirmar importación/ }));
    fireEvent.click((await screen.findAllByRole("button", { name: "Confirmar importación" })).at(-1)!);

    await waitFor(() => {
      expect(window.hospitalDirectory.importCsvDataset).toHaveBeenCalledWith("csv-token-1", []);
    });
    expect(useAppStore.getState().contacts?.records[0]?.displayName).toBe("Directorio CSV");
    expect(await screen.findByText("Importación completada. 1 alta y 1 actualización.")).toBeInTheDocument();
  });

  it("passes selected conflict policies when confirming a spreadsheet import", async () => {
    window.hospitalDirectory.pickAndImportDataset = vi.fn().mockResolvedValue({
      kind: "csv-preview",
      preview: {
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
      }
    });

    renderPage();

    expect(await screen.findByText("Datos e importación")).toBeInTheDocument();
    await openImportPicker();
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
    window.hospitalDirectory.pickAndImportDataset = vi.fn().mockResolvedValue({
      kind: "csv-preview",
      preview: {
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
              type: "service",
              displayName: "Mostrador importado",
              status: "active",
              phones: [],
              emails: [],
              socials: []
            },
            matchingRecord: {
              id: "existing-1",
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
      }
    });

    renderPage();

    expect(await screen.findByText("Datos e importación")).toBeInTheDocument();
    await openImportPicker();
    fireEvent.click(await screen.findByRole("radio", { name: "Omitir" }));
    fireEvent.click(screen.getByRole("button", { name: /Confirmar importación/ }));

    expect(await screen.findByText(/0 se crearán y 0 se actualizarán/)).toBeInTheDocument();
  });

  it("blocks stale resolved previews when a conflict is missing its selected policy", async () => {
    window.hospitalDirectory.pickAndImportDataset = vi.fn().mockResolvedValue({
      kind: "csv-preview",
      preview: {
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
              type: "service",
              displayName: "Mostrador importado",
              status: "active",
              phones: [],
              emails: [],
              socials: []
            },
            matchingRecord: {
              id: "existing-1",
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
      }
    });

    renderPage();

    expect(await screen.findByText("Datos e importación")).toBeInTheDocument();
    await openImportPicker();
    fireEvent.click(await screen.findByRole("button", { name: /Confirmar importación/ }));
    fireEvent.click((await screen.findAllByRole("button", { name: "Confirmar importación" })).at(-1)!);

    expect(await screen.findByText("Resuelve todos los conflictos antes de importar.")).toBeInTheDocument();
    expect(window.hospitalDirectory.importCsvDataset).not.toHaveBeenCalled();
  });

  it("OIR-200: allows a partial import when the preview contains some invalid rows alongside valid rows", async () => {
    window.hospitalDirectory.pickAndImportDataset = vi.fn().mockResolvedValue({
      kind: "csv-preview",
      preview: {
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
      }
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

    expect(await screen.findByText("Datos e importación")).toBeInTheDocument();
    await openImportPicker();

    expect(
      await screen.findByText("1 fila será omitida al importar. 0 altas y 1 actualizaciones previstas para las filas válidas.")
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Confirmar importación/ })).not.toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: /Confirmar importación/ }));

    expect(
      await screen.findByText((content) =>
        content.includes("1 registro válido") && content.includes("Se omitirá 1 fila rechazada")
      )
    ).toBeInTheDocument();

    fireEvent.click((await screen.findAllByRole("button", { name: "Confirmar importación" })).at(-1)!);

    await waitFor(() => {
      expect(window.hospitalDirectory.importCsvDataset).toHaveBeenCalledWith("csv-token-invalid", []);
    });
    expect(
      await screen.findByText("Importación completada. 0 altas y 1 actualización. Se omitió 1 fila rechazada.")
    ).toBeInTheDocument();
  });

  it("OIR-200: still blocks import confirmation when the preview has zero valid rows", async () => {
    window.hospitalDirectory.pickAndImportDataset = vi.fn().mockResolvedValue({
      kind: "csv-preview",
      preview: {
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
      }
    });

    renderPage();

    expect(await screen.findByText("Datos e importación")).toBeInTheDocument();
    await openImportPicker();

    expect(
      await screen.findByText("El archivo no contiene filas válidas para importar. Corrige el origen antes de importar.")
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Confirmar importación/ })).toBeDisabled();
    expect(window.hospitalDirectory.importCsvDataset).not.toHaveBeenCalled();
  });

  it("clears the previous CSV preview when a new selection is canceled", async () => {
    window.hospitalDirectory.pickAndImportDataset = vi
      .fn()
      .mockResolvedValueOnce({
        kind: "csv-preview",
        preview: {
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
        }
      })
      .mockResolvedValueOnce({ kind: "cancelled" });

    renderPage();

    expect(await screen.findByText("Datos e importación")).toBeInTheDocument();
    await openImportPicker();
    expect(await screen.findByText("Vista previa importación")).toBeInTheDocument();

    await openImportPicker();

    await waitFor(() => {
      expect(screen.queryByText("Vista previa importación")).not.toBeInTheDocument();
    });
    expect(await screen.findByText("Selección cancelada.")).toBeInTheDocument();
  });

  // OIR-223 priority 5: the dedicated "Restaurar esta copia de seguridad"
  // button/list and its restoreBackup() IPC call site were removed from this
  // component — restoring an old backup is now done via the unified
  // "Importar" picker (a .json pick already performs a full replace, which
  // functionally IS a restore; see the "imports a JSON dataset..." test
  // above). The restoreBackup IPC channel itself is unchanged/untouched.

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

    expect(await screen.findByText("Datos e importación")).toBeInTheDocument();
    expect(window.hospitalDirectory.listBackups).toHaveBeenCalledTimes(1);
  });

  it("moves focus to the panel heading when the CSV import preview panel opens", async () => {
    renderPage();

    expect(await screen.findByText("Datos e importación")).toBeInTheDocument();
    await openImportPicker();

    // useLayoutEffect fires synchronously after the DOM update — no timer involved
    await waitFor(() => {
      const heading = screen.getByRole("heading", { name: "directory.csv" });
      expect(document.activeElement).toBe(heading);
    });
  });

  it("returns focus to the trigger button when the CSV preview panel closes", async () => {
    renderPage();

    expect(await screen.findByText("Datos e importación")).toBeInTheDocument();

    const triggerButton = screen.getByRole("button", { name: "Importar" });
    await openImportPicker();
    await screen.findByText("Vista previa importación");

    fireEvent.click(screen.getByRole("button", { name: "Cerrar vista previa" }));

    await waitFor(() => {
      expect(document.activeElement).toBe(triggerButton);
    });
  });

  it("does NOT re-issue listBackups when contacts change after initial load (backupsRequestedRef guard)", async () => {
    // Regression lock for the loaded-once guarantee: after the initial load,
    // subsequent store mutations (e.g. after a JSON import) update contacts,
    // which is now in the effect deps. The backupsRequestedRef guard must
    // prevent listBackups from firing a second time.
    renderPage();

    // Wait for initial load to complete
    expect(await screen.findByText("Datos e importación")).toBeInTheDocument();
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

  // ---------------------------------------------------------------------------
  // OIR-182 — import P1 UX fixes
  // ---------------------------------------------------------------------------

  it("OIR-182 item 1 / OIR-219: shows analysis spinner while pickAndImportDataset is pending", async () => {
    // Intercept with a never-resolving promise so the "processing" status region stays visible
    let resolvePick!: (value: unknown) => void;
    const pendingPick = new Promise((resolve) => { resolvePick = resolve; });
    window.hospitalDirectory.pickAndImportDataset = vi.fn().mockReturnValue(pendingPick);

    renderPage();
    expect(await screen.findByText("Datos e importación")).toBeInTheDocument();

    await openImportPicker();

    // Spinner must appear while promise is in flight
    expect(await screen.findByText(/Seleccionando y analizando el archivo/)).toBeInTheDocument();
    const spinnerStatus = screen.getByRole("status");
    expect(spinnerStatus).toBeInTheDocument();

    // Resolve to avoid state-update-after-unmount warning
    resolvePick({ kind: "cancelled" });
  });

  it("OIR-182 item 10: shows conflict warning toast (not 'Todo listo') when conflictCount > 0", async () => {
    window.hospitalDirectory.pickAndImportDataset = vi.fn().mockResolvedValue({
      kind: "csv-preview",
      preview: {
        importToken: "csv-conflict-toast",
        fileName: "conflicts.csv",
        detectedFormat: "exportación cruda",
        detectionConfidence: "high",
        totalRowCount: 2,
        validRowCount: 2,
        invalidRowCount: 0,
        warningCount: 0,
        recordCount: 2,
        mergedRecordCount: 2,
        createdCount: 0,
        updatedCount: 2,
        typeCounts: {},
        areaCounts: {},
        rowIssues: [],
        warnings: [],
        previewRows: [],
        buscasSkippedRowCount: 0,
        socialHandleSkippedRowCount: 0,
        parsedBuscasCellCount: 0,
        conflictCount: 2,
        policiesResolved: false,
        conflictedRecords: [
          {
            recordIndex: 0,
            importedRecord: { id: "ci-0", displayName: "Contacto A", phones: [], emails: [], socials: [] },
            matchingRecord: { id: "ce-0", displayName: "Existente A", phones: [], emails: [], socials: [] },
            matchingRecordIndex: 0,
            matchingRecordSource: "existing",
            conflictType: "external-id-match",
            conflictReasonKey: "conflict_reason.external_id"
          },
          {
            recordIndex: 1,
            importedRecord: { id: "ci-1", displayName: "Contacto B", phones: [], emails: [], socials: [] },
            matchingRecord: { id: "ce-1", displayName: "Existente B", phones: [], emails: [], socials: [] },
            matchingRecordIndex: 1,
            matchingRecordSource: "existing",
            conflictType: "external-id-match",
            conflictReasonKey: "conflict_reason.external_id"
          }
        ]
      }
    });

    renderPage();
    expect(await screen.findByText("Datos e importación")).toBeInTheDocument();
    await openImportPicker();

    // Wait for the preview panel to load
    expect(await screen.findByText("Vista previa importación")).toBeInTheDocument();

    // "Todo listo" must NOT appear when there are conflicts to resolve
    expect(screen.queryByText(/Todo listo/)).not.toBeInTheDocument();

    // The conflict warning message (in toast or panel alert) must contain "Para cada uno"
    expect(screen.getByText(/Para cada uno elige qué hacer antes de continuar/)).toBeInTheDocument();
  });

  it("OIR-182 item 9 / OIR-188: confidence note shown in panel, not in toast, when detectionConfidence is not 'high'", async () => {
    // Default mock already has detectionConfidence="medium" and conflictCount=0.
    // OIR-188: confidence note moved from toast to panel.
    renderPage();
    expect(await screen.findByText("Datos e importación")).toBeInTheDocument();
    await openImportPicker();

    // Wait for panel to appear (preview received)
    expect(await screen.findByText("Vista previa importación")).toBeInTheDocument();

    // OIR-188: confidence note appears in the panel (amber paragraph).
    expect(screen.getByText(/Confianza media en la detección del formato\. Revisa la vista previa\./)
    ).toBeInTheDocument();

    // The toast must NOT include the confidence note — it covers status/count only.
    // Warning toasts use role="alert". No alert element must mention confidence.
    const alerts = screen
      .getAllByRole("alert")
      .filter((el) => el.textContent?.includes("Confianza media"));
    expect(alerts).toHaveLength(0);
  });

  // ---------------------------------------------------------------------------
  // OIR-223 priority 5 — the backups list (with OIR-221's "Mostrar más"
  // bounded-list toggle) is REMOVED. It is replaced with a single "Última
  // copia de seguridad: <fecha>" indicator derived client-side from the same
  // listBackups() data. No per-backup filename/size/restore row is rendered
  // anymore, and restoring an old backup is done via "Importar" instead.
  // ---------------------------------------------------------------------------

  const buildBackupList = (count: number) =>
    Array.from({ length: count }, (_, index) => ({
      fileName: `contacts-${count - index}.json`,
      filePath: `/tmp/backups/contacts-${count - index}.json`,
      createdAt: new Date(2026, 0, count - index).toISOString(),
      sizeBytes: 1024 * (index + 1)
    }));

  it("OIR-223: shows a single 'Última copia de seguridad' date indicator, no per-backup list rows", async () => {
    renderPage();

    expect(await screen.findByText("Datos e importación")).toBeInTheDocument();
    expect(await screen.findByText(/Última copia de seguridad:/)).toBeInTheDocument();

    // No backup filename/size rows, and no restore-list UI, are rendered.
    expect(screen.queryByText("contacts-1.json")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Restaurar esta copia de seguridad" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Mostrar \d+ más/ })).not.toBeInTheDocument();
  });

  it("OIR-223: the date shown is the MOST RECENT backup's createdAt, regardless of list order", async () => {
    window.hospitalDirectory.listBackups = vi.fn().mockResolvedValue([
      { fileName: "contacts-old.json", filePath: "/tmp/backups/contacts-old.json", createdAt: "2026-01-01T00:00:00.000Z", sizeBytes: 100 },
      { fileName: "contacts-newest.json", filePath: "/tmp/backups/contacts-newest.json", createdAt: "2026-06-01T00:00:00.000Z", sizeBytes: 100 },
      { fileName: "contacts-middle.json", filePath: "/tmp/backups/contacts-middle.json", createdAt: "2026-03-01T00:00:00.000Z", sizeBytes: 100 }
    ]);

    renderPage();

    expect(await screen.findByText("Datos e importación")).toBeInTheDocument();
    const indicator = await screen.findByText(/Última copia de seguridad:/);
    expect(indicator.textContent).toContain("jun");
  });

  it("OIR-223: shows an empty-state message when there are no backups yet", async () => {
    window.hospitalDirectory.listBackups = vi.fn().mockResolvedValue(buildBackupList(0));

    renderPage();

    expect(await screen.findByText("Datos e importación")).toBeInTheDocument();
    expect(await screen.findByText("Aún no se ha creado ninguna copia de seguridad.")).toBeInTheDocument();
    expect(screen.queryByText(/Última copia de seguridad:/)).not.toBeInTheDocument();
  });

  it("OIR-223: mentions the Importar picker as the way to restore an old backup", async () => {
    renderPage();

    expect(await screen.findByText("Datos e importación")).toBeInTheDocument();
    expect(
      await screen.findByText(/Ábrela desde el botón «Importar» de arriba/)
    ).toBeInTheDocument();
  });
});
