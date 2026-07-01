import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConflictRecordSummary, CsvImportPreview, CsvImportPreviewWithConflicts } from "../../../shared/types/contact";
import { CsvImportPreviewPanel } from "./CsvImportPreviewPanel";

const basePreview: CsvImportPreviewWithConflicts = {
  importToken: "test-token",
  fileName: "test.csv",
  totalRowCount: 0,
  validRowCount: 0,
  invalidRowCount: 0,
  warningCount: 0,
  recordCount: 0,
  mergedRecordCount: 0,
  createdCount: 0,
  updatedCount: 0,
  buscasSkippedRowCount: 0,
  socialHandleSkippedRowCount: 0,
  parsedBuscasCellCount: 0,
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
      expect(alert).toHaveTextContent("2 filas con errores");
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
      expect(alert).toHaveTextContent("2 filas con errores");
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
            displayName: "Mostrador importado",
            department: "Admisión",
            phones: [],
            emails: [],
            socials: []
          },
          matchingRecord: {
            id: "existing-1",
            displayName: "Mostrador actual",
            department: "Admisión",
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
    };

    it("blocks confirmation until conflict policies are selected", () => {
      renderPanel(conflictPreview);

      expect(screen.getByRole("alert")).toHaveTextContent("Para cada uno elige qué hacer");
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

  // ---------------------------------------------------------------------------
  // OIR-132 — field-level diff display in conflict cards
  // ---------------------------------------------------------------------------
  describe("conflict field-level diff (OIR-132)", () => {
    const phoneConflictPreview: CsvImportPreviewWithConflicts = {
      ...basePreview,
      fileName: "phone-conflict.csv",
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
            id: "import-ph-1",
            displayName: "Urgencias Importada",
            department: "Urgencias",
            service: "Triaje",
            specialty: "Triage avanzado",
            locationSummary: "Edificio A · Planta 1",
            phones: [
              { number: "12345", kind: "direct" },
              { number: "99999", kind: "fax", label: "Fax" }
            ],
            emails: [{ address: "urgencias@hospital.com", label: "Principal" }],
            socials: [{ platform: "instagram", handle: "urgencias_h" }]
          },
          matchingRecord: {
            id: "existing-ph-1",
            displayName: "Urgencias Actual",
            department: "Urgencias",
            service: "Triaje",
            phones: [
              { number: "12345", kind: "direct" },
              { number: "11111", kind: "other" }
            ],
            emails: [],
            socials: []
          },
          matchingRecordIndex: 0,
          matchingRecordSource: "existing",
          conflictType: "phone-match",
          conflictReasonKey: "conflict_reason.phone_match",
          matchingFieldValue: "12345"
        }
      ]
    };

    it("shows the match signal with the matching phone number in the reason label", () => {
      renderPanel(phoneConflictPreview);

      expect(screen.getByText(/Teléfono coincidente: 12345/)).toBeInTheDocument();
    });

    it("renders both record columns with Entrante and Existente labels", () => {
      renderPanel(phoneConflictPreview);

      expect(screen.getByText("Entrante")).toBeInTheDocument();
      expect(screen.getByText("Existente")).toBeInTheDocument();
    });

    it("renders display names for both sides of the conflict", () => {
      renderPanel(phoneConflictPreview);

      expect(screen.getByText("Urgencias Importada")).toBeInTheDocument();
      expect(screen.getByText("Urgencias Actual")).toBeInTheDocument();
    });

    it("highlights the matching phone number on both sides", () => {
      renderPanel(phoneConflictPreview);

      // Both columns show the matching phone with highlighted styling
      const highlightedPhones = screen.getAllByText(/^12345$/);
      expect(highlightedPhones.length).toBeGreaterThanOrEqual(2);
      for (const el of highlightedPhones) {
        expect(el.closest("li")).toHaveClass("bg-amber-100");
      }
    });

    it("renders non-matching phones without highlight", () => {
      renderPanel(phoneConflictPreview);

      const faxPhoneEl = screen.getByText("99999");
      expect(faxPhoneEl.closest("li")).not.toHaveClass("bg-amber-100");
    });

    it("renders email addresses in both columns", () => {
      renderPanel(phoneConflictPreview);

      expect(screen.getByText("urgencias@hospital.com")).toBeInTheDocument();
    });

    it("renders social handles", () => {
      renderPanel(phoneConflictPreview);

      expect(screen.getByText("@urgencias_h")).toBeInTheDocument();
    });

    it("renders specialty and location summary when present", () => {
      renderPanel(phoneConflictPreview);

      expect(screen.getByText(/Triage avanzado/)).toBeInTheDocument();
      expect(screen.getByText("Edificio A · Planta 1")).toBeInTheDocument();
    });

    it("renders a 'Sin teléfonos ni correos' placeholder when a record has none", () => {
      renderPanel({
        ...phoneConflictPreview,
        conflictedRecords: [
          {
            ...phoneConflictPreview.conflictedRecords[0]!,
            importedRecord: {
              ...phoneConflictPreview.conflictedRecords[0]!.importedRecord,
              phones: [],
              emails: [],
              socials: []
            }
          }
        ]
      });

      expect(screen.getByText("Sin teléfonos ni correos")).toBeInTheDocument();
    });

    it("does NOT show 'Sin teléfonos ni correos' when the record has socials but no phones or emails (Bug-3)", () => {
      // Regression guard for OIR-132 Bug-3: a record with socials only was showing
      // both the social list AND the empty-state note simultaneously.  The note must
      // only appear when phones, emails AND socials are all empty.
      renderPanel({
        ...phoneConflictPreview,
        conflictedRecords: [
          {
            ...phoneConflictPreview.conflictedRecords[0]!,
            importedRecord: {
              ...phoneConflictPreview.conflictedRecords[0]!.importedRecord,
              phones: [],
              emails: [],
              socials: [{ platform: "instagram", handle: "urgencias_h" }]
            }
          }
        ]
      });

      // The social handle must be visible
      expect(screen.getByText("@urgencias_h")).toBeInTheDocument();
      // The contradictory empty-state note must NOT appear
      expect(screen.queryByText("Sin teléfonos ni correos")).not.toBeInTheDocument();
    });

    it("shows only the reason label (no colon+value) when matchingFieldValue is absent", () => {
      renderPanel({
        ...phoneConflictPreview,
        conflictedRecords: [
          {
            ...phoneConflictPreview.conflictedRecords[0]!,
            matchingFieldValue: undefined
          }
        ]
      });

      expect(screen.getByText("Teléfono coincidente")).toBeInTheDocument();
      expect(screen.queryByText(/Teléfono coincidente:/)).not.toBeInTheDocument();
    });

    it("renders email-match conflict with highlighted email on both sides", () => {
      renderPanel({
        ...basePreview,
        fileName: "email-conflict.csv",
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
              id: "import-em-1",
              displayName: "Dr. García Importado",
              phones: [],
              emails: [{ address: "garcia@hospital.com" }],
              socials: []
            },
            matchingRecord: {
              id: "existing-em-1",
              displayName: "Dr. García",
              phones: [],
              emails: [{ address: "garcia@hospital.com", label: "Corporativo" }],
              socials: []
            },
            matchingRecordIndex: 0,
            matchingRecordSource: "existing",
            conflictType: "email-match",
            conflictReasonKey: "conflict_reason.email_match",
            matchingFieldValue: "garcia@hospital.com"
          }
        ]
      });

      expect(screen.getByText(/Correo coincidente: garcia@hospital.com/)).toBeInTheDocument();
      const emailEls = screen.getAllByText("garcia@hospital.com");
      expect(emailEls.length).toBeGreaterThanOrEqual(2);
      for (const el of emailEls) {
        expect(el.closest("li")).toHaveClass("bg-amber-100");
      }
    });

    // BUG-1: formatted numbers must highlight via normalized intersection
    it("highlights a matching phone when the two sides have different formatting", () => {
      // existing: "555 12 34" (formatted), incoming: "5551234" (digits-only)
      // Both normalize to "5551234" → both must be highlighted.
      renderPanel({
        ...basePreview,
        fileName: "formatted-phone-conflict.csv",
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
              id: "import-fmt-1",
              displayName: "Servicio Importado",
              phones: [
                { number: "5551234", kind: "direct" },
                { number: "9999999", kind: "other" }
              ],
              emails: [],
              socials: []
            },
            matchingRecord: {
              id: "existing-fmt-1",
              displayName: "Servicio Existente",
              phones: [
                { number: "555 12 34", kind: "direct" },
                { number: "8888888", kind: "fax" }
              ],
              emails: [],
              socials: []
            },
            matchingRecordIndex: 0,
            matchingRecordSource: "existing",
            conflictType: "phone-match",
            conflictReasonKey: "conflict_reason.phone_match",
            matchingFieldValue: "5551234"
          }
        ]
      });

      // The two matching numbers have different raw strings but same normalized form
      const importedMatch = screen.getByText("5551234");
      const existingMatch = screen.getByText("555 12 34");
      expect(importedMatch.closest("li")).toHaveClass("bg-amber-100");
      expect(existingMatch.closest("li")).toHaveClass("bg-amber-100");

      // Non-shared phones must NOT be highlighted
      expect(screen.getByText("9999999").closest("li")).not.toHaveClass("bg-amber-100");
      expect(screen.getByText("8888888").closest("li")).not.toHaveClass("bg-amber-100");
    });

    // BUG-1: email intersection must handle different cases
    it("highlights a matching email when the two sides have different case", () => {
      renderPanel({
        ...basePreview,
        fileName: "case-email-conflict.csv",
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
              id: "import-case-em-1",
              displayName: "Dr. López Importado",
              phones: [],
              emails: [
                { address: "Lopez@Hospital.com" },
                { address: "other@hospital.com" }
              ],
              socials: []
            },
            matchingRecord: {
              id: "existing-case-em-1",
              displayName: "Dr. López",
              phones: [],
              emails: [
                { address: "lopez@hospital.com" },
                { address: "unrelated@other.com" }
              ],
              socials: []
            },
            matchingRecordIndex: 0,
            matchingRecordSource: "existing",
            conflictType: "email-match",
            conflictReasonKey: "conflict_reason.email_match",
            matchingFieldValue: "lopez@hospital.com"
          }
        ]
      });

      // Both case variants of the shared email must be highlighted
      expect(screen.getByText("Lopez@Hospital.com").closest("li")).toHaveClass("bg-amber-100");
      expect(screen.getByText("lopez@hospital.com").closest("li")).toHaveClass("bg-amber-100");

      // Non-shared emails must NOT be highlighted
      expect(screen.getByText("other@hospital.com").closest("li")).not.toHaveClass("bg-amber-100");
      expect(screen.getByText("unrelated@other.com").closest("li")).not.toHaveClass("bg-amber-100");
    });
  });

  // ---------------------------------------------------------------------------
  // BUG-2: missing arrays on conflict record must not crash the panel
  // ---------------------------------------------------------------------------
  describe("conflict record robustness — missing arrays (BUG-2)", () => {
    it("renders without crashing when phones/emails/socials are absent on both records", () => {
      // Simulate a stale/untyped IPC payload that omits the array fields.
      const incompleteRecord = {
        id: "incomplete-1",
        type: "service",
        displayName: "Servicio Sin Arrays",
        status: "active"
      } as unknown as ConflictRecordSummary;

      renderPanel({
        ...basePreview,
        fileName: "incomplete-conflict.csv",
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
            importedRecord: incompleteRecord,
            matchingRecord: incompleteRecord,
            matchingRecordIndex: 0,
            matchingRecordSource: "existing",
            conflictType: "phone-match",
            conflictReasonKey: "conflict_reason.phone_match",
            matchingFieldValue: undefined
          }
        ]
      });

      // Should render the empty-state placeholder, not throw
      const emptyStates = screen.getAllByText("Sin teléfonos ni correos");
      expect(emptyStates.length).toBeGreaterThanOrEqual(1);
    });
  });

  // ---------------------------------------------------------------------------
  // BUG-3: specialty separator must not appear when service is absent
  // ---------------------------------------------------------------------------
  describe("specialty org field separator (BUG-3)", () => {
    const makeSpecialtyConflict = (overrides: Partial<{ department?: string; service?: string; specialty?: string }>) => ({
      ...basePreview,
      fileName: "specialty-conflict.csv",
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
            id: "spec-import-1",
            displayName: "Servicio",
            phones: [],
            emails: [],
            socials: [],
            ...overrides
          },
          matchingRecord: {
            id: "spec-existing-1",
            displayName: "Servicio Existente",
            phones: [],
            emails: [],
            socials: []
          },
          matchingRecordIndex: 0,
          matchingRecordSource: "existing" as const,
          conflictType: "external-id-match" as const,
          conflictReasonKey: "conflict_reason.external_id"
        }
      ]
    });

    it("does not render a dangling bullet when specialty is the only org field present", () => {
      // No department, no service — specialty alone must not get a leading " · "
      renderPanel(makeSpecialtyConflict({ specialty: "TAC" }));

      expect(screen.getAllByText(/TAC/)[0]).toBeInTheDocument();
      // The span for specialty must NOT start with a bullet separator
      const specialtySpans = document.querySelectorAll(".text-slate-500 span");
      const tacSpan = Array.from(specialtySpans).find((el) => el.textContent?.includes("TAC"));
      expect(tacSpan?.textContent?.trimStart()).toBe("TAC");
    });

    it("renders separator before specialty when department is present", () => {
      renderPanel(makeSpecialtyConflict({ department: "Radiología", specialty: "TAC" }));

      // The full org line should read "Radiología · TAC"
      expect(screen.getAllByText(/Radiología/)[0]).toBeInTheDocument();
      const orgDivs = document.querySelectorAll(".text-slate-500");
      const combined = Array.from(orgDivs).map((el) => el.textContent).join(" ");
      expect(combined).toMatch(/Radiología.*·.*TAC/);
    });

    it("renders separator before specialty when service is present", () => {
      renderPanel(makeSpecialtyConflict({ service: "Urgencias", specialty: "Triaje" }));

      const orgDivs = document.querySelectorAll(".text-slate-500");
      const combined = Array.from(orgDivs).map((el) => el.textContent).join(" ");
      expect(combined).toMatch(/Urgencias.*·.*Triaje/);
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

      expect(screen.queryByText(/Tipo de archivo:/)).not.toBeInTheDocument();
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

      expect(screen.getByRole("alert")).toHaveTextContent("1 fila con errores");
    });
  });

  describe("deferred-skip informational notes (OIR-102 / OIR-130 / OIR-134)", () => {
    it("shows the buscas note when buscasSkippedRowCount > 0 (OIR-130: empty/comment buscas rows)", () => {
      renderPanel({
        ...basePreview,
        validRowCount: 3,
        buscasSkippedRowCount: 5,
        previewRows: []
      });

      const notes = screen.getAllByRole("note");
      expect(notes).toHaveLength(1);
      expect(notes[0]).toHaveTextContent("5 filas de buscas sin número");
      expect(notes[0]).toHaveTextContent("hojas de buscas");
    });

    it("shows the social note when socialHandleSkippedRowCount > 0", () => {
      renderPanel({
        ...basePreview,
        validRowCount: 3,
        socialHandleSkippedRowCount: 2,
        previewRows: []
      });

      const notes = screen.getAllByRole("note");
      expect(notes).toHaveLength(1);
      expect(notes[0]).toHaveTextContent("2 filas omitidas");
      expect(notes[0]).toHaveTextContent("redes sociales");
    });

    it("shows both notes when buscasSkippedRowCount and socialHandleSkippedRowCount are both > 0", () => {
      renderPanel({
        ...basePreview,
        validRowCount: 3,
        buscasSkippedRowCount: 3,
        socialHandleSkippedRowCount: 1,
        previewRows: []
      });

      const notes = screen.getAllByRole("note");
      expect(notes).toHaveLength(2);
    });

    it("uses singular 'fila de buscas sin número' when exactly one buscas row is skipped (OIR-130)", () => {
      renderPanel({
        ...basePreview,
        validRowCount: 1,
        buscasSkippedRowCount: 1,
        previewRows: []
      });

      const notes = screen.getAllByRole("note");
      expect(notes[0]).toHaveTextContent("1 fila de buscas sin número");
    });

    it("uses singular 'fila omitida' when exactly one social-handle row is skipped", () => {
      renderPanel({
        ...basePreview,
        validRowCount: 1,
        socialHandleSkippedRowCount: 1,
        previewRows: []
      });

      const notes = screen.getAllByRole("note");
      expect(notes[0]).toHaveTextContent("1 fila omitida");
      expect(notes[0]).toHaveTextContent("redes sociales");
    });

    it("does not render any note when both counts are 0", () => {
      renderPanel({ ...basePreview, buscasSkippedRowCount: 0, socialHandleSkippedRowCount: 0 });

      expect(screen.queryByRole("note")).not.toBeInTheDocument();
    });

    it("does not disable the confirm button when skip counts are > 0", () => {
      renderPanel({
        ...basePreview,
        validRowCount: 2,
        buscasSkippedRowCount: 3,
        previewRows: []
      });

      // Skip counts alone do not block import.
      expect(screen.getByRole("button", { name: /Confirmar importación/ })).not.toBeDisabled();
    });
  });

  describe("buscas-only workbook confirm gate (OIR-130)", () => {
    it("enables the confirm button when parsedBuscasCellCount > 0 and validRowCount === 0", () => {
      // A buscas-only ODS: no contact rows but valid buscas content was parsed.
      renderPanel({
        ...basePreview,
        validRowCount: 0,
        parsedBuscasCellCount: 12,
        previewRows: []
      });

      expect(screen.getByRole("button", { name: /Confirmar importación/ })).not.toBeDisabled();
    });

    it("keeps the confirm button disabled when both validRowCount and parsedBuscasCellCount are 0", () => {
      // A truly empty workbook: nothing to import at all.
      renderPanel({
        ...basePreview,
        validRowCount: 0,
        parsedBuscasCellCount: 0,
        previewRows: []
      });

      expect(screen.getByRole("button", { name: /Confirmar importación/ })).toBeDisabled();
    });
  });

  // ---------------------------------------------------------------------------
  // OIR-133 — multi-select and bulk-apply conflict resolution
  // ---------------------------------------------------------------------------
  describe("conflict multi-select and bulk-apply (OIR-133)", () => {
    /** Two-conflict preview — provides the surface needed for all multi-select tests. */
    const twoConflictPreview: CsvImportPreviewWithConflicts = {
      ...basePreview,
      fileName: "multi-conflict.csv",
      totalRowCount: 2,
      validRowCount: 2,
      recordCount: 2,
      mergedRecordCount: 2,
      updatedCount: 2,
      conflictCount: 2,
      policiesResolved: false,
      conflictedRecords: [
        {
          recordIndex: 0,
          importedRecord: {
            id: "import-mc-0",
            type: "service",
            displayName: "Servicio A importado",
            status: "active",
            phones: [],
            emails: [],
            socials: []
          },
          matchingRecord: {
            id: "existing-mc-0",
            type: "service",
            displayName: "Servicio A actual",
            status: "active",
            phones: [],
            emails: [],
            socials: []
          },
          matchingRecordIndex: 0,
          matchingRecordSource: "existing",
          conflictType: "external-id-match",
          conflictReasonKey: "conflict_reason.external_id"
        },
        {
          recordIndex: 1,
          importedRecord: {
            id: "import-mc-1",
            type: "service",
            displayName: "Servicio B importado",
            status: "active",
            phones: [],
            emails: [],
            socials: []
          },
          matchingRecord: {
            id: "existing-mc-1",
            type: "service",
            displayName: "Servicio B actual",
            status: "active",
            phones: [],
            emails: [],
            socials: []
          },
          matchingRecordIndex: 1,
          matchingRecordSource: "existing",
          conflictType: "external-id-match",
          conflictReasonKey: "conflict_reason.external_id"
        }
      ]
    };

    // --- checkbox presence ---

    it("renders a per-conflict checkbox for each conflict card", () => {
      renderPanel(twoConflictPreview);

      expect(screen.getByRole("checkbox", { name: /Seleccionar Servicio A importado/ })).toBeInTheDocument();
      expect(screen.getByRole("checkbox", { name: /Seleccionar Servicio B importado/ })).toBeInTheDocument();
    });

    it("renders a select-all checkbox in the bulk toolbar", () => {
      renderPanel(twoConflictPreview);

      expect(screen.getByRole("checkbox", { name: /Seleccionar todos/ })).toBeInTheDocument();
    });

    // --- select-all / deselect-all ---

    it("select-all checks all per-conflict checkboxes", () => {
      renderPanel(twoConflictPreview);

      fireEvent.click(screen.getByRole("checkbox", { name: /Seleccionar todos/ }));

      expect(screen.getByRole("checkbox", { name: /Seleccionar Servicio A importado/ })).toBeChecked();
      expect(screen.getByRole("checkbox", { name: /Seleccionar Servicio B importado/ })).toBeChecked();
    });

    it("clicking select-all when all are selected deselects all", () => {
      renderPanel(twoConflictPreview);

      // Select all then deselect all
      const selectAllCb = screen.getByRole("checkbox", { name: /Seleccionar todos/ });
      fireEvent.click(selectAllCb); // select all
      fireEvent.click(selectAllCb); // now label says "Deseleccionar todos" — same element

      expect(screen.getByRole("checkbox", { name: /Seleccionar Servicio A importado/ })).not.toBeChecked();
      expect(screen.getByRole("checkbox", { name: /Seleccionar Servicio B importado/ })).not.toBeChecked();
    });

    it("selecting one conflict individually makes it checked", () => {
      renderPanel(twoConflictPreview);

      fireEvent.click(screen.getByRole("checkbox", { name: /Seleccionar Servicio A importado/ }));

      expect(screen.getByRole("checkbox", { name: /Seleccionar Servicio A importado/ })).toBeChecked();
      expect(screen.getByRole("checkbox", { name: /Seleccionar Servicio B importado/ })).not.toBeChecked();
    });

    // --- bulk-apply to selected ---

    it("shows bulk-apply controls only when at least one conflict is selected", () => {
      renderPanel(twoConflictPreview);

      // Initially hidden
      expect(screen.queryByRole("button", { name: /Aplicar a seleccionados/ })).not.toBeInTheDocument();

      // Select one conflict
      fireEvent.click(screen.getByRole("checkbox", { name: /Seleccionar Servicio A importado/ }));

      expect(screen.getByRole("button", { name: /Aplicar a seleccionados/ })).toBeInTheDocument();
      expect(screen.getByRole("combobox", { name: /Política para seleccionados/ })).toBeInTheDocument();
    });

    it("apply-to-selected calls onPolicyChange for each selected conflict with the chosen policy", () => {
      const { onPolicyChange } = renderPanel(twoConflictPreview);

      // Select both conflicts
      fireEvent.click(screen.getByRole("checkbox", { name: /Seleccionar todos/ }));

      // Choose "overwrite" in the bulk selector
      fireEvent.change(screen.getByRole("combobox", { name: /Política para seleccionados/ }), {
        target: { value: "overwrite" }
      });

      fireEvent.click(screen.getByRole("button", { name: /Aplicar a seleccionados/ }));

      expect(onPolicyChange).toHaveBeenCalledWith(0, "overwrite");
      expect(onPolicyChange).toHaveBeenCalledWith(1, "overwrite");
      expect(onPolicyChange).toHaveBeenCalledTimes(2);
    });

    it("apply-to-selected only targets selected conflicts, not all", () => {
      const { onPolicyChange } = renderPanel(twoConflictPreview);

      // Select only conflict 0
      fireEvent.click(screen.getByRole("checkbox", { name: /Seleccionar Servicio A importado/ }));

      // Apply "skip" to selected
      fireEvent.change(screen.getByRole("combobox", { name: /Política para seleccionados/ }), {
        target: { value: "skip" }
      });
      fireEvent.click(screen.getByRole("button", { name: /Aplicar a seleccionados/ }));

      expect(onPolicyChange).toHaveBeenCalledWith(0, "skip");
      expect(onPolicyChange).toHaveBeenCalledTimes(1);
      // conflict 1 must not be touched
      expect(onPolicyChange).not.toHaveBeenCalledWith(1, expect.anything());
    });

    it("bulk-apply deselects all after applying", () => {
      renderPanel(twoConflictPreview);

      fireEvent.click(screen.getByRole("checkbox", { name: /Seleccionar todos/ }));
      fireEvent.click(screen.getByRole("button", { name: /Aplicar a seleccionados/ }));

      // After apply, selection is cleared and the apply button disappears
      expect(screen.queryByRole("button", { name: /Aplicar a seleccionados/ })).not.toBeInTheDocument();
    });

    // --- apply-to-all shortcuts ---

    it("renders apply-to-all shortcut buttons for each policy", () => {
      renderPanel(twoConflictPreview);

      expect(screen.getByRole("button", { name: /Omitir a todos/ })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Sobrescribir a todos/ })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: /Combinar a todos/ })).toBeInTheDocument();
    });

    it("apply-to-all calls onPolicyChange for every conflict", () => {
      const { onPolicyChange } = renderPanel(twoConflictPreview);

      fireEvent.click(screen.getByRole("button", { name: /Combinar a todos/ }));

      expect(onPolicyChange).toHaveBeenCalledWith(0, "merge-fields");
      expect(onPolicyChange).toHaveBeenCalledWith(1, "merge-fields");
      expect(onPolicyChange).toHaveBeenCalledTimes(2);
    });

    // --- individual override after bulk apply ---

    it("individual radio still works after a bulk apply (per-conflict override)", () => {
      const { onPolicyChange } = renderPanel(twoConflictPreview);

      // Bulk apply "skip" to all
      fireEvent.click(screen.getByRole("button", { name: /Omitir a todos/ }));
      expect(onPolicyChange).toHaveBeenCalledTimes(2);

      // Now override conflict 0 individually to "merge-fields"
      const radios = screen.getAllByRole("radio", { name: "Combinar" });
      fireEvent.click(radios[0]!);

      expect(onPolicyChange).toHaveBeenCalledWith(0, "merge-fields");
      expect(onPolicyChange).toHaveBeenCalledTimes(3);
    });

    // --- resolved-gate still holds ---

    it("confirm button is still disabled when conflicts are unresolved after bulk deselect", () => {
      renderPanel(twoConflictPreview);

      // policiesResolved is false on twoConflictPreview — gate must hold
      expect(screen.getByRole("button", { name: /Confirmar importación/ })).toBeDisabled();
    });

    it("confirm button is enabled after all policies are resolved (policiesResolved: true)", () => {
      renderPanel({
        ...twoConflictPreview,
        policiesResolved: true,
        conflictedRecords: twoConflictPreview.conflictedRecords.map((c) => ({
          ...c,
          selectedPolicy: "merge-fields" as const
        }))
      });

      expect(screen.getByRole("button", { name: /Confirmar importación/ })).not.toBeDisabled();
    });

    // --- disabled state while mutating ---

    it("disables all multi-select controls while isMutating is true", () => {
      renderPanel(twoConflictPreview, { isMutating: true });

      expect(screen.getByRole("checkbox", { name: /Seleccionar todos/ })).toBeDisabled();
      expect(screen.getByRole("checkbox", { name: /Seleccionar Servicio A importado/ })).toBeDisabled();
      expect(screen.getByRole("checkbox", { name: /Seleccionar Servicio B importado/ })).toBeDisabled();
      expect(screen.getByRole("button", { name: /Omitir a todos/ })).toBeDisabled();
      expect(screen.getByRole("button", { name: /Sobrescribir a todos/ })).toBeDisabled();
      expect(screen.getByRole("button", { name: /Combinar a todos/ })).toBeDisabled();
    });

    // --- no bulk toolbar for zero conflicts ---

    it("does not render the bulk toolbar when there are no conflicts", () => {
      renderPanel(basePreview);

      expect(screen.queryByRole("checkbox", { name: /Seleccionar todos/ })).not.toBeInTheDocument();
      expect(screen.queryByRole("button", { name: /a todos/ })).not.toBeInTheDocument();
    });
  });

  // ---------------------------------------------------------------------------
  // OIR-122 — preview row pagination
  // ---------------------------------------------------------------------------
  describe("preview row pagination (OIR-122)", () => {
    /** Build a preview with N accepted rows, rowNumber 2..N+1. */
    const makeRowsPreview = (count: number): CsvImportPreviewWithConflicts => ({
      ...basePreview,
      fileName: "large.csv",
      totalRowCount: count,
      validRowCount: count,
      recordCount: count,
      mergedRecordCount: count,
      createdCount: count,
      previewRows: Array.from({ length: count }, (_, i) => ({
        rowNumber: i + 2,
        status: "accepted" as const,
        displayName: `Registro ${i + 1}`
      }))
    });

    it("renders first-page rows when dataset fits in one page", () => {
      renderPanel(makeRowsPreview(3));

      expect(screen.getByText("Registro 1")).toBeInTheDocument();
      expect(screen.getByText("Registro 2")).toBeInTheDocument();
      expect(screen.getByText("Registro 3")).toBeInTheDocument();
    });

    it("does not render a pager when all rows fit on one page", () => {
      renderPanel(makeRowsPreview(3));

      expect(screen.queryByRole("navigation", { name: /Paginación de filas/ })).not.toBeInTheDocument();
    });

    it("renders a pager when rows exceed PREVIEW_ROWS_PER_PAGE (101 rows)", () => {
      renderPanel(makeRowsPreview(101));

      expect(screen.getByRole("navigation", { name: /Paginación de filas/ })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Página siguiente" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Página anterior" })).toBeInTheDocument();
    });

    it("first page shows exactly the first 100 rows and not row 101", () => {
      renderPanel(makeRowsPreview(101));

      expect(screen.getByText("Registro 1")).toBeInTheDocument();
      expect(screen.getByText("Registro 100")).toBeInTheDocument();
      // Row 101 is on page 2 — must not be in the DOM
      expect(screen.queryByText("Registro 101")).not.toBeInTheDocument();
    });

    it("navigating to the last page shows the final row", () => {
      renderPanel(makeRowsPreview(101));

      fireEvent.click(screen.getByRole("button", { name: "Página siguiente" }));

      expect(screen.getByText("Registro 101")).toBeInTheDocument();
      // First page rows are no longer in the DOM
      expect(screen.queryByText("Registro 1")).not.toBeInTheDocument();
    });

    it("Página anterior button navigates back to page 1", () => {
      renderPanel(makeRowsPreview(101));

      const nextBtn = screen.getByRole("button", { name: "Página siguiente" });
      const prevBtn = screen.getByRole("button", { name: "Página anterior" });

      fireEvent.click(nextBtn); // → page 2
      expect(screen.getByText("Registro 101")).toBeInTheDocument();

      fireEvent.click(prevBtn); // → page 1
      expect(screen.getByText("Registro 1")).toBeInTheDocument();
      expect(screen.queryByText("Registro 101")).not.toBeInTheDocument();
    });

    it("Página anterior is disabled on page 1 and Página siguiente is disabled on the last page", () => {
      renderPanel(makeRowsPreview(101));

      expect(screen.getByRole("button", { name: "Página anterior" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Página siguiente" })).not.toBeDisabled();

      fireEvent.click(screen.getByRole("button", { name: "Página siguiente" }));

      expect(screen.getByRole("button", { name: "Página siguiente" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Página anterior" })).not.toBeDisabled();
    });

    it("DOM row count never exceeds PREVIEW_ROWS_PER_PAGE even with 5000 rows", () => {
      renderPanel(makeRowsPreview(5000));

      const rows = document.querySelectorAll("tbody tr");
      expect(rows.length).toBeLessThanOrEqual(100);
    });

    it("conflict selection persists across page navigation", () => {
      // Build a preview that has both a conflict AND enough rows to show a pager.
      const bigPreview: CsvImportPreviewWithConflicts = {
        ...makeRowsPreview(101),
        conflictCount: 1,
        policiesResolved: false,
        conflictedRecords: [
          {
            recordIndex: 0,
            importedRecord: {
              id: "import-pg-0",
              type: "service",
              displayName: "Servicio Paginado importado",
              status: "active",
              phones: [],
              emails: [],
              socials: []
            },
            matchingRecord: {
              id: "existing-pg-0",
              type: "service",
              displayName: "Servicio Paginado actual",
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
      };

      renderPanel(bigPreview);

      // Select the conflict
      fireEvent.click(screen.getByRole("checkbox", { name: /Seleccionar Servicio Paginado importado/ }));
      expect(screen.getByRole("checkbox", { name: /Seleccionar Servicio Paginado importado/ })).toBeChecked();

      // Navigate to page 2
      fireEvent.click(screen.getByRole("button", { name: "Página siguiente" }));

      // Navigate back to page 1
      fireEvent.click(screen.getByRole("button", { name: "Página anterior" }));

      // Conflict checkbox must still be checked — selection persisted
      expect(screen.getByRole("checkbox", { name: /Seleccionar Servicio Paginado importado/ })).toBeChecked();
    });

    it("shows the page range indicator when there are multiple pages", () => {
      renderPanel(makeRowsPreview(150));

      expect(screen.getByText(/filas 1–100 de 150/)).toBeInTheDocument();
    });

    it("does not show the page range indicator when all rows fit on one page", () => {
      renderPanel(makeRowsPreview(50));

      expect(screen.queryByText(/filas 1–/)).not.toBeInTheDocument();
    });

    it("resets to page 1 when a new preview with a different importToken is provided", () => {
      const previewA: CsvImportPreviewWithConflicts = {
        ...makeRowsPreview(101),
        importToken: "token-A"
      };
      const previewB: CsvImportPreviewWithConflicts = {
        ...makeRowsPreview(101),
        importToken: "token-B",
        previewRows: Array.from({ length: 101 }, (_, i) => ({
          rowNumber: i + 2,
          status: "accepted" as const,
          displayName: `Preview B ${i + 1}`
        }))
      };

      const onConfirm = vi.fn();
      const onClose = vi.fn();
      const onPolicyChange = vi.fn();

      const { rerender } = render(
        <CsvImportPreviewPanel
          preview={previewA}
          isImporting={false}
          isMutating={false}
          onConfirm={onConfirm}
          onPolicyChange={onPolicyChange}
          onClose={onClose}
        />
      );

      // Navigate to page 2 on preview A.
      fireEvent.click(screen.getByRole("button", { name: "Página siguiente" }));
      expect(screen.queryByText("Registro 1")).not.toBeInTheDocument();
      expect(screen.getByText("Registro 101")).toBeInTheDocument();

      // Swap in a completely new preview (different importToken).
      rerender(
        <CsvImportPreviewPanel
          preview={previewB}
          isImporting={false}
          isMutating={false}
          onConfirm={onConfirm}
          onPolicyChange={onPolicyChange}
          onClose={onClose}
        />
      );

      // Pager must be back on page 1: indicator reads "1" and first-page rows are visible.
      expect(screen.getByRole("navigation", { name: /Paginación de filas/ })).toBeInTheDocument();
      // Use selector to avoid matching the sr-only live region that also contains "Página"
      expect(screen.getByText(/Página/, { selector: 'span:not([role="status"])' })).toHaveTextContent("Página 1 de 2");
      expect(screen.getByText("Preview B 1")).toBeInTheDocument();
      expect(screen.queryByText("Preview B 101")).not.toBeInTheDocument();
    });
  });

  // ---------------------------------------------------------------------------
  // OIR-176 — conflict record pagination
  // ---------------------------------------------------------------------------
  describe("conflict pagination (OIR-176)", () => {
    /** Build a preview with N conflict records, each with a distinct recordIndex. */
    const makeConflictsPreview = (count: number): CsvImportPreviewWithConflicts => ({
      ...basePreview,
      fileName: "many-conflicts.csv",
      totalRowCount: count,
      validRowCount: count,
      recordCount: count,
      mergedRecordCount: count,
      updatedCount: count,
      conflictCount: count,
      policiesResolved: false,
      conflictedRecords: Array.from({ length: count }, (_, i) => ({
        recordIndex: i,
        importedRecord: {
          id: `import-pg-${i}`,
          displayName: `Importado ${i + 1}`,
          phones: [],
          emails: [],
          socials: []
        },
        matchingRecord: {
          id: `existing-pg-${i}`,
          displayName: `Existente ${i + 1}`,
          phones: [],
          emails: [],
          socials: []
        },
        matchingRecordIndex: i,
        matchingRecordSource: "existing" as const,
        conflictType: "external-id-match" as const,
        conflictReasonKey: "conflict_reason.external_id"
      }))
    });

    it("renders only the first 20 conflict cards when there are 50 conflicts", () => {
      renderPanel(makeConflictsPreview(50));

      // Page 1: records 0–19 (displayed as "Importado 1" through "Importado 20")
      expect(screen.getByText("Importado 1")).toBeInTheDocument();
      expect(screen.getByText("Importado 20")).toBeInTheDocument();
      // Record 21 is on page 2 — must not be in the DOM
      expect(screen.queryByText("Importado 21")).not.toBeInTheDocument();
    });

    it("navigating to page 2 shows the next 20 conflicts", () => {
      renderPanel(makeConflictsPreview(50));

      fireEvent.click(screen.getByRole("button", { name: "Página siguiente" }));

      // Page 2: records 20–39 (displayed as "Importado 21" through "Importado 40")
      expect(screen.getByText("Importado 21")).toBeInTheDocument();
      expect(screen.getByText("Importado 40")).toBeInTheDocument();
      // Page 1 records must no longer be in the DOM
      expect(screen.queryByText("Importado 1")).not.toBeInTheDocument();
    });

    it("selection persists across conflict page navigation", () => {
      renderPanel(makeConflictsPreview(50));

      // Select first conflict on page 1 (recordIndex 0 → displayName "Importado 1")
      const selectFirstConflict = () =>
        screen.getByRole("checkbox", { name: "Seleccionar Importado 1" });
      fireEvent.click(selectFirstConflict());
      expect(selectFirstConflict()).toBeChecked();

      // Navigate to page 2
      fireEvent.click(screen.getByRole("button", { name: "Página siguiente" }));

      // Navigate back to page 1
      fireEvent.click(screen.getByRole("button", { name: "Página anterior" }));

      // Selection must have persisted across page navigation
      expect(selectFirstConflict()).toBeChecked();
    });

    it("does not render conflict pagination when conflicts count is at or below the page size", () => {
      renderPanel(makeConflictsPreview(20));

      expect(screen.queryByRole("navigation", { name: /Navegación de conflictos/ })).not.toBeInTheDocument();
    });

    it("renders conflict pagination nav when conflict count exceeds the page size", () => {
      renderPanel(makeConflictsPreview(21));

      expect(screen.getByRole("navigation", { name: /Navegación de conflictos/ })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Página siguiente" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Página anterior" })).toBeInTheDocument();
    });

    it("Página anterior is disabled on page 1 and Página siguiente is disabled on the last page", () => {
      renderPanel(makeConflictsPreview(50));

      expect(screen.getByRole("button", { name: "Página anterior" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Página siguiente" })).not.toBeDisabled();

      fireEvent.click(screen.getByRole("button", { name: "Página siguiente" }));
      fireEvent.click(screen.getByRole("button", { name: "Página siguiente" }));

      expect(screen.getByRole("button", { name: "Página siguiente" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Página anterior" })).not.toBeDisabled();
    });

    it("conflict pagination buttons have the focus-ring class for keyboard focus visibility (WCAG 2.4.7)", () => {
      renderPanel(makeConflictsPreview(21));

      const prevBtn = screen.getByRole("button", { name: "Página anterior" });
      const nextBtn = screen.getByRole("button", { name: "Página siguiente" });

      expect(prevBtn.className).toContain("focus-ring");
      expect(nextBtn.className).toContain("focus-ring");
    });
  });

  // ---------------------------------------------------------------------------
  // OIR-178 — policy option consequence descriptions and aria-describedby
  // ---------------------------------------------------------------------------
  describe("policy option descriptions (OIR-178)", () => {
    const conflictWithPoliciesPreview: CsvImportPreviewWithConflicts = {
      ...basePreview,
      fileName: "policy-desc.csv",
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
            id: "import-pd-1",
            displayName: "Registro importado",
            phones: [],
            emails: [],
            socials: []
          },
          matchingRecord: {
            id: "existing-pd-1",
            displayName: "Registro existente",
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
    };

    it("renders the Omitir description in the DOM", () => {
      renderPanel(conflictWithPoliciesPreview);

      expect(
        screen.getByText("La fila del CSV no se importa; el contacto existente no cambia.")
      ).toBeInTheDocument();
    });

    it("renders the Sobrescribir description in the DOM", () => {
      renderPanel(conflictWithPoliciesPreview);

      expect(
        screen.getByText(
          "El contacto existente se reemplaza con los datos del CSV. Los datos actuales se perderán."
        )
      ).toBeInTheDocument();
    });

    it("renders the Combinar description in the DOM", () => {
      renderPanel(conflictWithPoliciesPreview);

      expect(
        screen.getByText(
          "Se fusionan ambos contactos. Los teléfonos, correos y etiquetas se combinan; las notas y otros campos del contacto existente se conservan."
        )
      ).toBeInTheDocument();
    });

    it("skip radio input has aria-describedby pointing to its description element", () => {
      renderPanel(conflictWithPoliciesPreview);

      const radio = screen.getByRole("radio", { name: "Omitir" });
      const descId = radio.getAttribute("aria-describedby");
      expect(descId).toBeTruthy();
      const descEl = document.getElementById(descId!);
      expect(descEl).toBeInTheDocument();
      expect(descEl).toHaveTextContent(
        "La fila del CSV no se importa; el contacto existente no cambia."
      );
    });

    it("overwrite radio input has aria-describedby pointing to its description element", () => {
      renderPanel(conflictWithPoliciesPreview);

      const radio = screen.getByRole("radio", { name: "Sobrescribir" });
      const descId = radio.getAttribute("aria-describedby");
      expect(descId).toBeTruthy();
      const descEl = document.getElementById(descId!);
      expect(descEl).toBeInTheDocument();
      expect(descEl).toHaveTextContent(
        "El contacto existente se reemplaza con los datos del CSV. Los datos actuales se perderán."
      );
    });

    it("merge-fields radio input has aria-describedby pointing to its description element", () => {
      renderPanel(conflictWithPoliciesPreview);

      const radio = screen.getByRole("radio", { name: "Combinar" });
      const descId = radio.getAttribute("aria-describedby");
      expect(descId).toBeTruthy();
      const descEl = document.getElementById(descId!);
      expect(descEl).toBeInTheDocument();
      expect(descEl).toHaveTextContent(
        "Se fusionan ambos contactos. Los teléfonos, correos y etiquetas se combinan; las notas y otros campos del contacto existente se conservan."
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Privacy + copy policy assertions (OIR-181)
  // ---------------------------------------------------------------------------
  describe("privacy and jargon policy (OIR-181)", () => {
    it("does not render the raw external ID value for external_id conflicts", () => {
      // The matchingFieldValue for external-id-match must never surface to the user.
      // Even if the payload still contains one (e.g., older IPC version), the renderer
      // must suppress it. This test asserts the policy end-to-end.
      renderPanel({
        ...basePreview,
        fileName: "privacy-check.csv",
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
              id: "import-priv-1",
              displayName: "Consulta Externa",
              phones: [],
              emails: [],
              socials: []
            },
            matchingRecord: {
              id: "existing-priv-1",
              displayName: "Consulta Externa actual",
              phones: [],
              emails: [],
              socials: []
            },
            matchingRecordIndex: 0,
            matchingRecordSource: "existing",
            conflictType: "external-id-match",
            conflictReasonKey: "conflict_reason.external_id",
            // raw machine ID — must not appear in rendered output
            matchingFieldValue: "ID-RAW-12345"
          }
        ]
      });

      // The human-readable reason label must be present
      expect(screen.getByText(/Este contacto ya existe en la agenda/)).toBeInTheDocument();

      // The raw internal identifier must not appear anywhere in the rendered output
      expect(screen.queryByText(/ID-RAW-12345/)).not.toBeInTheDocument();
      expect(document.body.textContent).not.toContain("ID-RAW-12345");
    });

    it("rendered conflict panel does not contain jargon terms banned by OIR-181", () => {
      // Regression guard: ensure no banned anglicisms or internal jargon surface
      // in the conflict-resolution UI after the OIR-181 copy pass.
      renderPanel({
        ...basePreview,
        fileName: "jargon-check.csv",
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
              id: "import-jargon-1",
              displayName: "Mostrador importado",
              phones: [],
              emails: [],
              socials: []
            },
            matchingRecord: {
              id: "existing-jargon-1",
              displayName: "Mostrador actual",
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

      const body = document.body.textContent ?? "";
      // None of these jargon terms should appear in user-facing copy
      expect(body).not.toMatch(/\bdataset\b/i);
      expect(body).not.toMatch(/\bbackup\b/i);
      expect(body).not.toMatch(/\bdestructiva\b/i);
    });
  });

  // ---------------------------------------------------------------------------
  // OIR-182 — UX and a11y improvements (P1 batch)
  // ---------------------------------------------------------------------------
  describe("OIR-182 UX and a11y improvements", () => {
    /** One unresolved conflict — used for most OIR-182 item tests. */
    const oneConflictPreview: CsvImportPreviewWithConflicts = {
      ...basePreview,
      fileName: "oir182.csv",
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
            id: "import-oir182-0",
            displayName: "Registro OIR-182",
            phones: [],
            emails: [],
            socials: []
          },
          matchingRecord: {
            id: "existing-oir182-0",
            displayName: "Registro existente OIR-182",
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
    };

    // Item 3 — resolution counter

    it("shows '0 de N resueltos' counter when there are unresolved conflicts", () => {
      renderPanel(oneConflictPreview);

      expect(screen.getByText(/0 de 1 resueltos/)).toBeInTheDocument();
    });

    it("resolution counter reflects resolved count when a policy is set", () => {
      renderPanel({
        ...oneConflictPreview,
        conflictedRecords: [
          {
            ...oneConflictPreview.conflictedRecords[0]!,
            selectedPolicy: "skip" as const
          }
        ]
      });

      expect(screen.getByText(/1 de 1 resueltos/)).toBeInTheDocument();
    });

    it("does not render the counter when there are no conflicts", () => {
      renderPanel(basePreview);

      expect(screen.queryByText(/de \d+ resueltos/)).not.toBeInTheDocument();
    });

    // Item 2 — single CTA in sticky footer

    it("has exactly one Confirmar importación button (sticky footer, no duplicate in header)", () => {
      renderPanel(oneConflictPreview);

      const btns = screen.getAllByRole("button", { name: /Confirmar importación/ });
      expect(btns).toHaveLength(1);
    });

    // Item 4 — close guard

    it("calls window.confirm before closing if some but not all conflicts are resolved", () => {
      const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

      const { onClose } = renderPanel({
        ...oneConflictPreview,
        conflictCount: 2,
        conflictedRecords: [
          {
            ...oneConflictPreview.conflictedRecords[0]!,
            recordIndex: 0,
            selectedPolicy: "skip" as const
          },
          {
            recordIndex: 1,
            importedRecord: {
              id: "import-oir182-1",
              displayName: "Registro OIR-182 B",
              phones: [],
              emails: [],
              socials: []
            },
            matchingRecord: {
              id: "existing-oir182-1",
              displayName: "Existente OIR-182 B",
              phones: [],
              emails: [],
              socials: []
            },
            matchingRecordIndex: 1,
            matchingRecordSource: "existing",
            conflictType: "external-id-match",
            conflictReasonKey: "conflict_reason.external_id"
          }
        ]
      });

      fireEvent.click(screen.getByRole("button", { name: /Cerrar vista previa/ }));

      expect(confirmSpy).toHaveBeenCalledOnce();
      expect(onClose).not.toHaveBeenCalled();

      confirmSpy.mockRestore();
    });

    it("closes without prompt when no policies have been resolved yet", () => {
      const confirmSpy = vi.spyOn(window, "confirm");
      const { onClose } = renderPanel(oneConflictPreview);

      fireEvent.click(screen.getByRole("button", { name: /Cerrar vista previa/ }));

      expect(confirmSpy).not.toHaveBeenCalled();
      expect(onClose).toHaveBeenCalledOnce();

      confirmSpy.mockRestore();
    });

    it("prompts before closing even when all conflicts are resolved (work would still be lost)", () => {
      const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);

      const { onClose } = renderPanel({
        ...oneConflictPreview,
        policiesResolved: true,
        conflictedRecords: [
          { ...oneConflictPreview.conflictedRecords[0]!, selectedPolicy: "overwrite" as const }
        ]
      });

      fireEvent.click(screen.getByRole("button", { name: /Cerrar vista previa/ }));

      expect(confirmSpy).toHaveBeenCalledOnce();
      expect(onClose).not.toHaveBeenCalled();

      confirmSpy.mockRestore();
    });

    // Item 6 — aria-required on policy radios

    it("all policy radio inputs carry aria-required='true'", () => {
      renderPanel(oneConflictPreview);

      expect(screen.getByRole("radio", { name: "Omitir" })).toHaveAttribute("aria-required", "true");
      expect(screen.getByRole("radio", { name: "Sobrescribir" })).toHaveAttribute("aria-required", "true");
      expect(screen.getByRole("radio", { name: "Combinar" })).toHaveAttribute("aria-required", "true");
    });

    // Item 7 — live regions in pagination navs

    it("conflict pagination nav contains an aria-live='polite' region for SR announcements", () => {
      const manyConflicts: CsvImportPreviewWithConflicts = {
        ...basePreview,
        fileName: "many.csv",
        totalRowCount: 21,
        validRowCount: 21,
        recordCount: 21,
        mergedRecordCount: 21,
        updatedCount: 21,
        conflictCount: 21,
        policiesResolved: false,
        conflictedRecords: Array.from({ length: 21 }, (_, i) => ({
          recordIndex: i,
          importedRecord: {
            id: `imp-oir182-${i}`,
            displayName: `Importado OIR-182 ${i + 1}`,
            phones: [],
            emails: [],
            socials: []
          },
          matchingRecord: {
            id: `ex-oir182-${i}`,
            displayName: `Existente OIR-182 ${i + 1}`,
            phones: [],
            emails: [],
            socials: []
          },
          matchingRecordIndex: i,
          matchingRecordSource: "existing" as const,
          conflictType: "external-id-match" as const,
          conflictReasonKey: "conflict_reason.external_id"
        }))
      };
      renderPanel(manyConflicts);

      const conflictNav = screen.getByRole("navigation", { name: /Navegación de conflictos/ });
      const liveRegion = conflictNav.querySelector("[aria-live='polite']");
      expect(liveRegion).toBeInTheDocument();
    });

    it("preview row pagination nav contains an aria-live='polite' region for SR announcements", () => {
      const manyRows: CsvImportPreviewWithConflicts = {
        ...basePreview,
        fileName: "rows.csv",
        totalRowCount: 101,
        validRowCount: 101,
        recordCount: 101,
        mergedRecordCount: 101,
        createdCount: 101,
        previewRows: Array.from({ length: 101 }, (_, i) => ({
          rowNumber: i + 2,
          status: "accepted" as const,
          displayName: `Fila OIR-182 ${i + 1}`
        }))
      };
      renderPanel(manyRows);

      const rowNav = screen.getByRole("navigation", { name: /Paginación de filas/ });
      const liveRegion = rowNav.querySelector("[aria-live='polite']");
      expect(liveRegion).toBeInTheDocument();
    });
  });
});
