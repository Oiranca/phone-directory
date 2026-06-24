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
            displayName: "Mostrador importado",
            department: "Admisión",
            phones: [],
            emails: [],
            socials: []
          },
          matchingRecord: {
            id: "existing-1",
            externalId: "legacy-1",
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

      expect(screen.getByRole("checkbox", { name: /Seleccionar conflicto 1/ })).toBeInTheDocument();
      expect(screen.getByRole("checkbox", { name: /Seleccionar conflicto 2/ })).toBeInTheDocument();
    });

    it("renders a select-all checkbox in the bulk toolbar", () => {
      renderPanel(twoConflictPreview);

      expect(screen.getByRole("checkbox", { name: /Seleccionar todos/ })).toBeInTheDocument();
    });

    // --- select-all / deselect-all ---

    it("select-all checks all per-conflict checkboxes", () => {
      renderPanel(twoConflictPreview);

      fireEvent.click(screen.getByRole("checkbox", { name: /Seleccionar todos/ }));

      expect(screen.getByRole("checkbox", { name: /Seleccionar conflicto 1/ })).toBeChecked();
      expect(screen.getByRole("checkbox", { name: /Seleccionar conflicto 2/ })).toBeChecked();
    });

    it("clicking select-all when all are selected deselects all", () => {
      renderPanel(twoConflictPreview);

      // Select all then deselect all
      const selectAllCb = screen.getByRole("checkbox", { name: /Seleccionar todos/ });
      fireEvent.click(selectAllCb); // select all
      fireEvent.click(selectAllCb); // now label says "Deseleccionar todos" — same element

      expect(screen.getByRole("checkbox", { name: /Seleccionar conflicto 1/ })).not.toBeChecked();
      expect(screen.getByRole("checkbox", { name: /Seleccionar conflicto 2/ })).not.toBeChecked();
    });

    it("selecting one conflict individually makes it checked", () => {
      renderPanel(twoConflictPreview);

      fireEvent.click(screen.getByRole("checkbox", { name: /Seleccionar conflicto 1/ }));

      expect(screen.getByRole("checkbox", { name: /Seleccionar conflicto 1/ })).toBeChecked();
      expect(screen.getByRole("checkbox", { name: /Seleccionar conflicto 2/ })).not.toBeChecked();
    });

    // --- bulk-apply to selected ---

    it("shows bulk-apply controls only when at least one conflict is selected", () => {
      renderPanel(twoConflictPreview);

      // Initially hidden
      expect(screen.queryByRole("button", { name: /Aplicar a seleccionados/ })).not.toBeInTheDocument();

      // Select one conflict
      fireEvent.click(screen.getByRole("checkbox", { name: /Seleccionar conflicto 1/ }));

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
      fireEvent.click(screen.getByRole("checkbox", { name: /Seleccionar conflicto 1/ }));

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
      expect(screen.getByRole("checkbox", { name: /Seleccionar conflicto 1/ })).toBeDisabled();
      expect(screen.getByRole("checkbox", { name: /Seleccionar conflicto 2/ })).toBeDisabled();
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
});
