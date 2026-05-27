import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CsvImportPreviewWithConflicts } from "../../../shared/types/contact";
import { CsvImportPreviewPanel } from "./CsvImportPreviewPanel";

const basePreview: CsvImportPreviewWithConflicts = {
  importToken: "test-token",
  sourceFilePath: "/tmp/incoming/test.csv",
  fileName: "test.csv",
  totalRowCount: 0,
  validRowCount: 0,
  invalidRowCount: 0,
  warningCount: 0,
  recordCount: 0,
  mergedRecordCount: 0,
  createdCount: 0,
  updatedCount: 0,
  typeCounts: {},
  areaCounts: {},
  rowIssues: [],
  warnings: [],
  previewRows: [],
  conflictCount: 0,
  conflictedRecords: [],
  policiesResolved: false
};

const renderPanel = (
  preview: CsvImportPreviewWithConflicts,
  overrides: Partial<{ isImporting: boolean; isMutating: boolean }> = {}
) => {
  const onConfirm = vi.fn();
  const onClose = vi.fn();
  const onPolicyChange = vi.fn();
  const result = render(
    <CsvImportPreviewPanel
      preview={preview}
      isImporting={overrides.isImporting ?? false}
      isMutating={overrides.isMutating ?? false}
      onConfirm={onConfirm}
      onPolicyChange={onPolicyChange}
      onClose={onClose}
    />
  );
  return { ...result, onConfirm, onPolicyChange, onClose };
};

afterEach(() => {
  cleanup();
});

describe("CsvImportPreviewPanel", () => {
  describe("zero-row file", () => {
    it("renders the file name and empty-file notice", () => {
      renderPanel({
        ...basePreview,
        fileName: "vacio.csv",
        totalRowCount: 0,
        previewRows: []
      });

      expect(screen.getByRole("heading", { name: "vacio.csv" })).toBeInTheDocument();
      expect(screen.getByText("El archivo no contiene filas de datos.")).toBeInTheDocument();
    });

    it("shows zero in all summary stat cells", () => {
      renderPanel(basePreview);

      const zeroValues = screen.getAllByText("0");
      expect(zeroValues.length).toBeGreaterThanOrEqual(4);
    });

    it("disables confirm when there are no valid rows to import", () => {
      renderPanel(basePreview);
      expect(screen.getByRole("button", { name: /Confirmar importación/ })).toBeDisabled();
    });
  });

  describe("all-valid rows", () => {
    const allValidPreview: CsvImportPreview = {
      ...basePreview,
      fileName: "all-valid.csv",
      totalRowCount: 3,
      validRowCount: 3,
      invalidRowCount: 0,
      warningCount: 0,
      createdCount: 3,
      recordCount: 3,
      mergedRecordCount: 3,
      typeCounts: { service: 2, person: 1 },
      areaCounts: { "gestion-administracion": 2 },
      previewRows: [
        {
          rowNumber: 2,
          status: "accepted",
          displayName: "Admisión Central",
          type: "service",
          department: "Admisión",
          area: "gestion-administracion",
          phone1Number: "12345"
        },
        {
          rowNumber: 3,
          status: "accepted",
          displayName: "Mostrador",
          type: "service",
          department: "Recepción",
          area: "gestion-administracion",
          phone1Number: "67890"
        },
        {
          rowNumber: 4,
          status: "accepted",
          displayName: "Dr. García",
          type: "person",
          department: "Urgencias",
          email1: "garcia@hospital.com"
        }
      ]
    };

    it("renders a table row for each accepted record", () => {
      renderPanel(allValidPreview);

      expect(screen.getByRole("table", { name: "Filas de importación" })).toBeInTheDocument();
      expect(screen.getByText("Admisión Central")).toBeInTheDocument();
      expect(screen.getByText("Mostrador")).toBeInTheDocument();
      expect(screen.getByText("Dr. García")).toBeInTheDocument();
    });

    it("shows accepted status badge for all rows", () => {
      renderPanel(allValidPreview);

      const badges = screen.getAllByText("Aceptada");
      expect(badges).toHaveLength(3);
    });

    it("shows phone and email fields in the table", () => {
      renderPanel(allValidPreview);

      expect(screen.getByText("12345")).toBeInTheDocument();
      expect(screen.getByText("67890")).toBeInTheDocument();
      expect(screen.getByText("garcia@hospital.com")).toBeInTheDocument();
    });

    it("shows type and area counts", () => {
      renderPanel(allValidPreview);

      expect(screen.getByText("service: 2")).toBeInTheDocument();
      expect(screen.getByText("person: 1")).toBeInTheDocument();
      expect(screen.getByText("gestion-administracion: 2")).toBeInTheDocument();
    });

    it("enables the confirm button", () => {
      renderPanel(allValidPreview);

      expect(screen.getByRole("button", { name: /Confirmar importación/ })).not.toBeDisabled();
    });

    it("calls onConfirm when confirm is clicked", () => {
      const { onConfirm } = renderPanel(allValidPreview);

      fireEvent.click(screen.getByRole("button", { name: /Confirmar importación/ }));
      expect(onConfirm).toHaveBeenCalledTimes(1);
    });

    it("calls onClose when close is clicked", () => {
      const { onClose } = renderPanel(allValidPreview);

      fireEvent.click(screen.getByRole("button", { name: "Cerrar vista previa" }));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("does not render a blocker alert", () => {
      renderPanel(allValidPreview);

      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });
  });

  describe("mixed valid and invalid rows", () => {
    const mixedPreview: CsvImportPreview = {
      ...basePreview,
      fileName: "mixed.csv",
      totalRowCount: 3,
      validRowCount: 1,
      invalidRowCount: 2,
      warningCount: 0,
      createdCount: 0,
      updatedCount: 1,
      recordCount: 1,
      mergedRecordCount: 1,
      rowIssues: [
        {
          rowNumber: 3,
          displayName: "Fila sin tipo",
          messages: ["El tipo es obligatorio."]
        },
        {
          rowNumber: 4,
          displayName: undefined,
          messages: ["El nombre visible es obligatorio.", "Cada fila necesita al menos un teléfono, un correo o un dato de ubicación."]
        }
      ],
      previewRows: [
        {
          rowNumber: 2,
          status: "accepted",
          displayName: "Registro Válido",
          type: "service",
          phone1Number: "11111"
        },
        {
          rowNumber: 3,
          status: "rejected",
          displayName: "Fila sin tipo",
          errorMessages: ["El tipo es obligatorio."]
        },
        {
          rowNumber: 4,
          status: "rejected",
          errorMessages: [
            "El nombre visible es obligatorio.",
            "Cada fila necesita al menos un teléfono, un correo o un dato de ubicación."
          ]
        }
      ]
    };

    it("renders the blocker alert when there are rejected rows", () => {
      renderPanel(mixedPreview);

      const alert = screen.getByRole("alert");
      expect(alert).toBeInTheDocument();
      expect(alert).toHaveTextContent("2 filas rechazadas");
    });

    it("disables the confirm button when invalid rows exist", () => {
      renderPanel(mixedPreview);

      expect(screen.getByRole("button", { name: /Confirmar importación/ })).toBeDisabled();
    });

    it("shows rejected status badge for invalid rows", () => {
      renderPanel(mixedPreview);

      const rejectedBadges = screen.getAllByText("Rechazada");
      expect(rejectedBadges).toHaveLength(2);
    });

    it("shows accepted badge for the valid row", () => {
      renderPanel(mixedPreview);

      expect(screen.getByText("Aceptada")).toBeInTheDocument();
    });

    it("renders error messages inline in the row table", () => {
      renderPanel(mixedPreview);

      expect(screen.getByText("El tipo es obligatorio.")).toBeInTheDocument();
      expect(screen.getByText("El nombre visible es obligatorio.")).toBeInTheDocument();
      expect(screen.getByText("Cada fila necesita al menos un teléfono, un correo o un dato de ubicación.")).toBeInTheDocument();
    });

    it("shows 'Sin nombre' placeholder for rows without a displayName", () => {
      renderPanel(mixedPreview);

      expect(screen.getByText("Sin nombre")).toBeInTheDocument();
    });
  });

  describe("all-rejected rows", () => {
    const allRejectedPreview: CsvImportPreview = {
      ...basePreview,
      fileName: "broken.csv",
      totalRowCount: 2,
      validRowCount: 0,
      invalidRowCount: 2,
      rowIssues: [
        {
          rowNumber: 2,
          messages: ["El tipo es obligatorio.", "El nombre visible es obligatorio."]
        },
        {
          rowNumber: 3,
          messages: ["El tipo es obligatorio."]
        }
      ],
      previewRows: [
        {
          rowNumber: 2,
          status: "rejected",
          errorMessages: ["El tipo es obligatorio.", "El nombre visible es obligatorio."]
        },
        {
          rowNumber: 3,
          status: "rejected",
          errorMessages: ["El tipo es obligatorio."]
        }
      ]
    };

    it("blocks import with a clear message", () => {
      renderPanel(allRejectedPreview);

      const alert = screen.getByRole("alert");
      expect(alert).toHaveTextContent("2 filas rechazadas");
    });

    it("disables the confirm button", () => {
      renderPanel(allRejectedPreview);

      expect(screen.getByRole("button", { name: /Confirmar importación/ })).toBeDisabled();
    });

    it("renders two rejected badges", () => {
      renderPanel(allRejectedPreview);

      expect(screen.getAllByText("Rechazada")).toHaveLength(2);
    });

    it("does not render any accepted or warning badges", () => {
      renderPanel(allRejectedPreview);

      expect(screen.queryByText("Aceptada")).not.toBeInTheDocument();
      expect(screen.queryByText("Advertencia")).not.toBeInTheDocument();
    });
  });

  describe("rows with warnings only", () => {
    const warningOnlyPreview: CsvImportPreview = {
      ...basePreview,
      fileName: "warnings.csv",
      totalRowCount: 2,
      validRowCount: 2,
      invalidRowCount: 0,
      warningCount: 2,
      createdCount: 2,
      recordCount: 2,
      mergedRecordCount: 2,
      warnings: [
        {
          rowNumber: 2,
          displayName: "Urgencias",
          message: "El área \"urgencias\" no está soportada y se omitirá."
        },
        {
          rowNumber: 3,
          displayName: "Rayos",
          message: "El tipo de teléfono \"ext\" no está soportado y se normalizó como \"other\"."
        }
      ],
      previewRows: [
        {
          rowNumber: 2,
          status: "warning",
          displayName: "Urgencias",
          type: "service",
          phone1Number: "55555",
          warningMessages: ["El área \"urgencias\" no está soportada y se omitirá."]
        },
        {
          rowNumber: 3,
          status: "warning",
          displayName: "Rayos",
          type: "service",
          phone1Number: "44444",
          warningMessages: ["El tipo de teléfono \"ext\" no está soportado y se normalizó como \"other\"."]
        }
      ]
    };

    it("renders warning status badges for both rows", () => {
      renderPanel(warningOnlyPreview);

      const warningBadges = screen.getAllByText("Advertencia");
      expect(warningBadges).toHaveLength(2);
    });

    it("renders an informational warning acknowledgement (not an alert)", () => {
      renderPanel(warningOnlyPreview);

      const status = screen.getByRole("status");
      expect(status).toHaveTextContent("2 advertencias detectadas");
      expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    });

    it("enables the confirm button since no rows are blocked", () => {
      renderPanel(warningOnlyPreview);

      expect(screen.getByRole("button", { name: /Confirmar importación/ })).not.toBeDisabled();
    });

    it("shows warning messages inline in the row table", () => {
      renderPanel(warningOnlyPreview);

      expect(screen.getByText("El área \"urgencias\" no está soportada y se omitirá.")).toBeInTheDocument();
      expect(screen.getByText("El tipo de teléfono \"ext\" no está soportado y se normalizó como \"other\".")).toBeInTheDocument();
    });
  });

  describe("conflict policies", () => {
    const conflictPreview: CsvImportPreviewWithConflicts = {
      ...basePreview,
      fileName: "conflicts.csv",
      totalRowCount: 1,
      validRowCount: 1,
      recordCount: 1,
      mergedRecordCount: 1,
      updatedCount: 1,
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
            status: "active"
          },
          matchingRecord: {
            id: "existing-1",
            externalId: "legacy-1",
            type: "service",
            displayName: "Mostrador actual",
            department: "Admisión",
            status: "active"
          },
          matchingRecordIndex: 0,
          matchingRecordSource: "existing",
          conflictType: "external-id-match",
          conflictReasonKey: "conflict_reason.external_id"
        }
      ]
    };

    it("blocks confirmation until conflict policies are selected", () => {
      renderPanel(conflictPreview);

      expect(screen.getByRole("alert")).toHaveTextContent("Selecciona una política");
      expect(screen.getByRole("button", { name: /Confirmar importación/ })).toBeDisabled();
    });

    it("calls onPolicyChange when a policy is selected", () => {
      const { onPolicyChange } = renderPanel(conflictPreview);

      fireEvent.click(screen.getByRole("radio", { name: "Combinar" }));

      expect(onPolicyChange).toHaveBeenCalledWith(0, "merge-fields");
    });

    it("enables confirmation when all conflict policies are resolved", () => {
      renderPanel({
        ...conflictPreview,
        policiesResolved: true,
        conflictedRecords: [
          {
            ...conflictPreview.conflictedRecords[0]!,
            selectedPolicy: "overwrite"
          }
        ]
      });

      expect(screen.getByRole("status")).toHaveTextContent("Todas las políticas");
      expect(screen.getByRole("button", { name: /Confirmar importación/ })).not.toBeDisabled();
    });
  });

  describe("detected format display", () => {
    it("shows format and confidence label for high confidence", () => {
      renderPanel({
        ...basePreview,
        detectedFormat: "plantilla normalizada",
        detectionConfidence: "high"
      });

      expect(screen.getByText(/plantilla normalizada/)).toBeInTheDocument();
      expect(screen.getByText(/confianza alta/)).toBeInTheDocument();
    });

    it("shows medium confidence label", () => {
      renderPanel({
        ...basePreview,
        detectedFormat: "exportación cruda de servicios",
        detectionConfidence: "medium"
      });

      expect(screen.getByText(/confianza media/)).toBeInTheDocument();
    });

    it("does not render format line when detectedFormat is absent", () => {
      renderPanel(basePreview);

      expect(screen.queryByText(/Formato detectado:/)).not.toBeInTheDocument();
    });
  });

  describe("interaction states", () => {
    it("disables both buttons while isMutating is true", () => {
      renderPanel(basePreview, { isMutating: true });

      expect(screen.getByRole("button", { name: "Cerrar vista previa" })).toBeDisabled();
      expect(screen.getByRole("button", { name: /Confirmar importación/ })).toBeDisabled();
    });

    it("shows importing label on confirm button while isImporting", () => {
      renderPanel(basePreview, { isImporting: true, isMutating: true });

      expect(screen.getByRole("button", { name: "Importando…" })).toBeInTheDocument();
    });
  });

  describe("singular vs plural blocker message", () => {
    it("uses singular 'fila rechazada' when exactly one row is rejected", () => {
      renderPanel({
        ...basePreview,
        invalidRowCount: 1,
        rowIssues: [{ rowNumber: 2, messages: ["El tipo es obligatorio."] }],
        previewRows: [
          { rowNumber: 2, status: "rejected", errorMessages: ["El tipo es obligatorio."] }
        ]
      });

      expect(screen.getByRole("alert")).toHaveTextContent("1 fila rechazada");
    });
  });
});
