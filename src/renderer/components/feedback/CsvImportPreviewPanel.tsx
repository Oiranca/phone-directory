import { useState, useCallback, useEffect } from "react";
import type { RefObject } from "react";
import { normalizePhoneForDedup } from "../../../shared/utils/matching";
import type {
  CsvImportPreviewWithConflicts,
  CsvImportPreviewRow,
  ConflictedImportRecord,
  ConflictRecordSummary,
  MergePolicy
} from "../../../shared/types/contact";

const STATUS_LABELS: Record<CsvImportPreviewRow["status"], string> = {
  accepted: "Aceptada",
  warning: "Advertencia",
  rejected: "Rechazada"
};

const STATUS_ROW_STYLES: Record<CsvImportPreviewRow["status"], string> = {
  accepted: "bg-white",
  warning: "bg-amber-50",
  rejected: "bg-red-50"
};

const STATUS_BADGE_STYLES: Record<CsvImportPreviewRow["status"], string> = {
  accepted: "bg-emerald-100 text-emerald-900",
  warning: "bg-amber-100 text-amber-900",
  rejected: "bg-red-100 text-red-900"
};

const STATUS_ICON: Record<CsvImportPreviewRow["status"], string> = {
  accepted: "✓",
  warning: "⚠",
  rejected: "✗"
};

const POLICY_LABELS: Record<MergePolicy, string> = {
  skip: "Omitir",
  overwrite: "Sobrescribir",
  "merge-fields": "Combinar"
};

/** Plain-language consequence descriptions shown below each policy label (OIR-178). */
const POLICY_DESCRIPTIONS: Record<MergePolicy, string> = {
  skip: "La fila del CSV no se importa; el contacto existente no cambia.",
  overwrite: "El contacto existente se reemplaza con los datos del CSV. Los datos actuales se perderán.",
  "merge-fields":
    "Se fusionan ambos contactos. Los teléfonos, correos y etiquetas se combinan; las notas y otros campos del contacto existente se conservan."
};

/** Maximum rows rendered in the DOM at one time for the preview row table. */
const PREVIEW_ROWS_PER_PAGE = 100;

/** Maximum conflict cards rendered in the DOM at one time for the conflict resolution list. */
const CONFLICTS_PER_PAGE = 20;

const CONFLICT_REASON_LABELS: Record<string, string> = {
  "conflict_reason.external_id": "Este contacto ya existe en la agenda (mismo código)",
  "conflict_reason.phone_match": "Teléfono coincidente",
  "conflict_reason.email_match": "Correo coincidente"
};

const formatDetectionConfidence = (value: CsvImportPreviewWithConflicts["detectionConfidence"]) => {
  if (value === "high") return "alta";
  if (value === "medium") return "media";
  if (value === "low") return "baja";
  return "";
};

// ---------------------------------------------------------------------------
// ConflictFieldDiff — field-level diff for a single conflict pair (OIR-132).
// ---------------------------------------------------------------------------

type ConflictRecordColProps = {
  label: string;
  record: ConflictRecordSummary;
  /** Normalized phone numbers that are shared between both sides of the conflict. */
  matchingPhoneNorms: ReadonlySet<string>;
  /** Normalized email addresses that are shared between both sides of the conflict. */
  matchingEmailNorms: ReadonlySet<string>;
  /** Type of match so we know which field category to highlight. */
  conflictType: ConflictedImportRecord["conflictType"];
};

const ConflictRecordCol = ({
  label,
  record,
  matchingPhoneNorms,
  matchingEmailNorms,
  conflictType
}: ConflictRecordColProps) => {
  // BUG-2: defensively default arrays — runtime IPC payload may omit them.
  const phones = record.phones ?? [];
  const emails = record.emails ?? [];
  const socials = record.socials ?? [];

  // BUG-1: highlight by normalized intersection, not raw string equality.
  const isMatchingPhone = (num: string) =>
    conflictType === "phone-match" && matchingPhoneNorms.has(normalizePhoneForDedup(num));
  const isMatchingEmail = (addr: string) =>
    conflictType === "email-match" && matchingEmailNorms.has(addr.trim().toLowerCase());

  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-800">{label}</p>
      <p className="mt-1 font-semibold text-slate-900">{record.displayName}</p>

      {/* Org fields */}
      {(record.department ?? record.service ?? record.specialty) && (
        <div className="mt-1 text-xs text-slate-500">
          {record.department && <span>{record.department}</span>}
          {record.service && <span>{record.department ? " · " : ""}{record.service}</span>}
          {/* BUG-3: only render separator when there is a preceding sibling */}
          {record.specialty && (
            <span>{(record.department ?? record.service) ? " · " : ""}{record.specialty}</span>
          )}
        </div>
      )}
      {record.locationSummary && (
        <p className="mt-0.5 text-xs text-slate-500">{record.locationSummary}</p>
      )}

      {/* Phones */}
      {phones.length > 0 && (
        <ul className="mt-2 space-y-0.5" aria-label="Teléfonos">
          {phones.map((phone, i) => (
            <li
              key={i}
              className={[
                "rounded px-1.5 py-0.5 text-xs",
                isMatchingPhone(phone.number)
                  ? "bg-amber-100 font-semibold text-amber-900 ring-1 ring-amber-400"
                  : "text-slate-700"
              ].join(" ")}
            >
              {isMatchingPhone(phone.number) && (
                <span className="mr-1 text-amber-700" aria-label="Campo coincidente">*</span>
              )}
              {phone.number}
              {phone.label && <span className="ml-1 text-slate-500">({phone.label})</span>}
            </li>
          ))}
        </ul>
      )}

      {/* Emails */}
      {emails.length > 0 && (
        <ul className="mt-1 space-y-0.5" aria-label="Correos">
          {emails.map((email, i) => (
            <li
              key={i}
              className={[
                "rounded px-1.5 py-0.5 text-xs",
                isMatchingEmail(email.address)
                  ? "bg-amber-100 font-semibold text-amber-900 ring-1 ring-amber-400"
                  : "text-slate-700"
              ].join(" ")}
            >
              {isMatchingEmail(email.address) && (
                <span className="mr-1 text-amber-700" aria-label="Campo coincidente">*</span>
              )}
              {email.address}
              {email.label && <span className="ml-1 text-slate-500">({email.label})</span>}
            </li>
          ))}
        </ul>
      )}

      {/* Socials */}
      {socials.length > 0 && (
        <ul className="mt-1 space-y-0.5" aria-label="Redes sociales">
          {socials.map((social, i) => (
            <li key={i} className="text-xs text-slate-600">
              {social.platform}
              {social.handle && <span className="ml-1">@{social.handle}</span>}
              {!social.handle && social.url && <span className="ml-1">{social.url}</span>}
              {social.label && <span className="ml-1 text-slate-600">({social.label})</span>}
            </li>
          ))}
        </ul>
      )}

      {phones.length === 0 && emails.length === 0 && socials.length === 0 && (
        <p className="mt-1 text-xs italic text-slate-600">Sin teléfonos ni correos</p>
      )}
    </div>
  );
};

type Props = {
  preview: CsvImportPreviewWithConflicts;
  isImporting: boolean;
  isMutating: boolean;
  onConfirm: () => void;
  onPolicyChange: (recordIndex: number, policy: MergePolicy) => void;
  onClose: () => void;
  headingRef?: RefObject<HTMLHeadingElement>;
};

export const CsvImportPreviewPanel = ({ preview, isImporting, isMutating, onConfirm, onPolicyChange, onClose, headingRef }: Props) => {
  const conflictedRecords = preview.conflictedRecords ?? [];
  const conflictCount = preview.conflictCount ?? conflictedRecords.length;
  const policiesResolved = preview.policiesResolved ?? conflictCount === 0;
  const hasBlockers = preview.invalidRowCount > 0;
  const hasUnresolvedConflicts = conflictCount > 0 && !policiesResolved;
  // OIR-130: A buscas-only workbook has validRowCount === 0 but parsedBuscasCellCount > 0.
  // Treat it as confirmable. Only block when BOTH contact rows AND buscas content are absent.
  const hasImportableContent = preview.validRowCount > 0 || preview.parsedBuscasCellCount > 0;
  const isConfirmDisabled = isMutating || hasBlockers || hasUnresolvedConflicts || !hasImportableContent;

  // ---------------------------------------------------------------------------
  // OIR-133 — multi-select state (purely local UI, no IPC/main change needed).
  // selectedIndices tracks the set of conflict recordIndex values the operator
  // has checked.  bulkPolicy is the policy the operator wants to apply to the
  // selection in one click.
  // ---------------------------------------------------------------------------
  const [selectedIndices, setSelectedIndices] = useState<ReadonlySet<number>>(new Set());
  const [bulkPolicy, setBulkPolicy] = useState<MergePolicy>("skip");

  // ---------------------------------------------------------------------------
  // OIR-176 — conflict record pagination.
  // conflictsPage is 0-based. Reset to 0 whenever a new file is previewed.
  // ---------------------------------------------------------------------------
  const [conflictsPage, setConflictsPage] = useState(0);

  useEffect(() => {
    setConflictsPage(0);
  }, [preview.importToken]);

  // ---------------------------------------------------------------------------
  // OIR-122 — preview row pagination.
  // previewPage is 1-based. Reset to page 1 whenever a new file is previewed.
  // ---------------------------------------------------------------------------
  const [previewPage, setPreviewPage] = useState(1);
  const totalPreviewRows = preview.previewRows.length;
  const totalPreviewPages = Math.max(1, Math.ceil(totalPreviewRows / PREVIEW_ROWS_PER_PAGE));

  // Guard against the current page going out of range when the dataset shrinks.
  const safePage = Math.min(previewPage, totalPreviewPages);

  useEffect(() => {
    setPreviewPage(1);
  }, [preview.importToken]);

  const previewPageStart = (safePage - 1) * PREVIEW_ROWS_PER_PAGE;
  const currentPageRows = preview.previewRows.slice(previewPageStart, previewPageStart + PREVIEW_ROWS_PER_PAGE);

  const paginatedConflicts = conflictedRecords.slice(
    conflictsPage * CONFLICTS_PER_PAGE,
    (conflictsPage + 1) * CONFLICTS_PER_PAGE
  );

  const allIndices = conflictedRecords.map((c) => c.recordIndex);
  const allSelected = allIndices.length > 0 && allIndices.every((idx) => selectedIndices.has(idx));
  const someSelected = !allSelected && allIndices.some((idx) => selectedIndices.has(idx));
  const selectedCount = allIndices.filter((idx) => selectedIndices.has(idx)).length;

  const handleToggleOne = useCallback((recordIndex: number) => {
    setSelectedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(recordIndex)) {
        next.delete(recordIndex);
      } else {
        next.add(recordIndex);
      }
      return next;
    });
  }, []);

  const handleSelectAll = useCallback(() => {
    setSelectedIndices(new Set(allIndices));
  }, [allIndices]);

  const handleDeselectAll = useCallback(() => {
    setSelectedIndices(new Set());
  }, []);

  const handleApplyToSelected = useCallback(() => {
    for (const idx of allIndices) {
      if (selectedIndices.has(idx)) {
        onPolicyChange(idx, bulkPolicy);
      }
    }
    // Deselect all after applying so the UI resets cleanly.
    setSelectedIndices(new Set());
  }, [allIndices, selectedIndices, bulkPolicy, onPolicyChange]);

  const handleApplyToAll = useCallback((policy: MergePolicy) => {
    for (const idx of allIndices) {
      onPolicyChange(idx, policy);
    }
    setSelectedIndices(new Set());
  }, [allIndices, onPolicyChange]);

  return (
    <section
      aria-label="Vista previa de importación"
      className="mt-6 rounded-3xl border border-emerald-200 bg-emerald-50/60 p-5"
    >
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.2em] text-emerald-700">
            Vista previa importación
          </p>
          <h3
            ref={headingRef}
            tabIndex={-1}
            className="mt-2 text-xl font-semibold text-emerald-950"
          >
            {preview.fileName}
          </h3>
          {preview.detectedFormat && (
            <p className="mt-2 text-sm text-emerald-900/80">
              Tipo de archivo: {preview.detectedFormat}
              {preview.detectionConfidence && preview.detectionConfidence !== "low"
                ? ` (confianza ${formatDetectionConfidence(preview.detectionConfidence)})`
                : preview.detectionConfidence === "low"
                  ? " — formato no reconocido, revísalo con atención"
                  : ""}
            </p>
          )}
        </div>
        <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
          <button
            type="button"
            onClick={onClose}
            disabled={isMutating}
            className="rounded-full border border-emerald-300 px-4 py-2 text-center text-sm font-semibold text-emerald-900 disabled:opacity-60"
          >
            Cerrar vista previa
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isConfirmDisabled}
            className="rounded-full bg-emerald-700 px-4 py-2 text-center text-sm font-semibold text-white disabled:opacity-60"
          >
            {isImporting ? "Importando…" : "Confirmar importación"}
          </button>
        </div>
      </div>

      {/* Blocker message */}
      {hasBlockers && (
        <div
          role="alert"
          className="mt-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800"
        >
          Hay {preview.invalidRowCount} {preview.invalidRowCount === 1 ? "fila con errores que no se importará" : "filas con errores que no se importarán"}.
          Corrígelas en la agenda original o cierra esta vista.
        </div>
      )}

      {/* Warning-only acknowledgement */}
      {!hasBlockers && preview.warningCount > 0 && (
        <div
          role="status"
          className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        >
          <span className="font-semibold">
            {preview.warningCount} {preview.warningCount === 1 ? "advertencia" : "advertencias"} detectadas.
          </span>{" "}
          Los registros marcados se importarán aplicando las correcciones automáticas indicadas.
        </div>
      )}

      {!hasBlockers && conflictCount > 0 && (
        <div
          role={hasUnresolvedConflicts ? "alert" : "status"}
          className={[
            "mt-5 rounded-2xl border px-4 py-3 text-sm",
            hasUnresolvedConflicts
              ? "border-amber-300 bg-amber-50 text-amber-950"
              : "border-emerald-200 bg-white/70 text-emerald-950"
          ].join(" ")}
        >
          <span className="font-semibold">
            Hay {conflictCount} {conflictCount === 1 ? "registro que ya existe en la agenda" : "registros que ya existen en la agenda"}.
          </span>{" "}
          {hasUnresolvedConflicts
            ? "Para cada uno elige qué hacer (omitir, sustituir o combinar) antes de continuar."
            : "Todas las políticas de conflicto están seleccionadas."}
        </div>
      )}

      {/* OIR-130: Buscas rows are now parsed and imported into the Buscas section. */}
      {(preview.buscasSkippedRowCount ?? 0) > 0 && (
        <div
          role="note"
          className="mt-5 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900"
        >
          <span className="font-semibold">
            {preview.buscasSkippedRowCount} {preview.buscasSkippedRowCount === 1 ? "fila de buscas sin número" : "filas de buscas sin número"}
          </span>{" "}
          omitidas (filas vacías o solo comentarios en las hojas de buscas)
        </div>
      )}
      {(preview.socialHandleSkippedRowCount ?? 0) > 0 && (
        <div
          role="note"
          className="mt-5 rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-900"
        >
          <span className="font-semibold">
            {preview.socialHandleSkippedRowCount} {preview.socialHandleSkippedRowCount === 1 ? "fila omitida" : "filas omitidas"}
          </span>{" "}
          (redes sociales — filas sin número de teléfono omitidas)
        </div>
      )}

      {/* Summary stats */}
      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-2xl bg-white/80 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">Filas leídas</p>
          <p className="mt-2 text-3xl font-semibold text-emerald-950">{preview.totalRowCount}</p>
        </div>
        <div className="rounded-2xl bg-white/80 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">Válidas</p>
          <p className="mt-2 text-3xl font-semibold text-emerald-950">{preview.validRowCount}</p>
        </div>
        <div className="rounded-2xl bg-white/80 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">Inválidas</p>
          <p className="mt-2 text-3xl font-semibold text-emerald-950">{preview.invalidRowCount}</p>
        </div>
        <div className="rounded-2xl bg-white/80 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">Advertencias</p>
          <p className="mt-2 text-3xl font-semibold text-emerald-950">{preview.warningCount}</p>
        </div>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl bg-white/80 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">Altas</p>
          <p className="mt-2 text-3xl font-semibold text-emerald-950">{preview.createdCount}</p>
        </div>
        <div className="rounded-2xl bg-white/80 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">Actualizaciones</p>
          <p className="mt-2 text-3xl font-semibold text-emerald-950">{preview.updatedCount}</p>
        </div>
        <div className="rounded-2xl bg-white/80 p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">Total final</p>
          <p className="mt-2 text-3xl font-semibold text-emerald-950">{preview.mergedRecordCount}</p>
        </div>
      </div>

      {conflictedRecords.length > 0 && (
        <div className="mt-6">
          {/* OIR-133 — bulk-apply toolbar */}
          <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-amber-200 bg-amber-50/60 px-4 py-3">
            {/* Select-all / deselect-all */}
            <label className="flex items-center gap-2 text-sm font-medium text-amber-900">
              <input
                type="checkbox"
                aria-label="Seleccionar todos los conflictos"
                checked={allSelected}
                ref={(el) => {
                  if (el) el.indeterminate = someSelected;
                }}
                disabled={isMutating || conflictedRecords.length === 0}
                onChange={() => {
                  if (allSelected) {
                    handleDeselectAll();
                  } else {
                    handleSelectAll();
                  }
                }}
                className="h-4 w-4 accent-amber-700"
              />
              {allSelected ? "Deseleccionar todos" : "Seleccionar todos"}
            </label>

            {/* Bulk-policy selector + apply button — shown only when ≥1 conflict selected */}
            {selectedCount > 0 && (
              <>
                <span className="text-xs text-amber-700">
                  {selectedCount} {selectedCount === 1 ? "seleccionado" : "seleccionados"}
                </span>
                <select
                  aria-label="Política para seleccionados"
                  value={bulkPolicy}
                  disabled={isMutating}
                  onChange={(e) => setBulkPolicy(e.target.value as MergePolicy)}
                  className="rounded-lg border border-amber-300 bg-white px-2 py-1 text-sm text-slate-800"
                >
                  {(Object.keys(POLICY_LABELS) as MergePolicy[]).map((p) => (
                    <option key={p} value={p}>{POLICY_LABELS[p]}</option>
                  ))}
                </select>
                <button
                  type="button"
                  disabled={isMutating}
                  onClick={handleApplyToSelected}
                  className="rounded-full bg-amber-700 px-3 py-1 text-xs font-semibold text-white disabled:opacity-60"
                >
                  Aplicar a seleccionados
                </button>
              </>
            )}

            {/* Apply-to-all shortcuts — always visible */}
            <div className="ml-auto flex flex-wrap gap-2">
              {(Object.keys(POLICY_LABELS) as MergePolicy[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  disabled={isMutating}
                  onClick={() => handleApplyToAll(p)}
                  className="rounded-full border border-amber-300 bg-white px-3 py-1 text-xs font-semibold text-amber-900 hover:bg-amber-100 disabled:opacity-60"
                >
                  {POLICY_LABELS[p]} a todos
                </button>
              ))}
            </div>
          </div>

          <p className="text-sm font-semibold text-emerald-950">
            Conflictos ({conflictedRecords.length})
          </p>
          <div className="mt-3 space-y-4">
            {paginatedConflicts.map((conflict) => {
              const reasonLabel = CONFLICT_REASON_LABELS[conflict.conflictReasonKey] ?? "Coincidencia detectada";
              // Strip the raw machine ID for external_id conflicts — only show the human label.
              const matchSignal = conflict.matchingFieldValue && conflict.conflictReasonKey !== "conflict_reason.external_id"
                ? `${reasonLabel}: ${conflict.matchingFieldValue}`
                : reasonLabel;

              // BUG-1: compute normalized intersection for phones and emails.
              const importedPhones = conflict.importedRecord.phones ?? [];
              const matchingPhones = conflict.matchingRecord.phones ?? [];
              const importedEmails = conflict.importedRecord.emails ?? [];
              const matchingEmails = conflict.matchingRecord.emails ?? [];

              const importedPhoneNorms = new Set(importedPhones.map((p) => normalizePhoneForDedup(p.number)));
              const matchingPhoneNorms = new Set(
                [...matchingPhones.map((p) => normalizePhoneForDedup(p.number))].filter((n) =>
                  importedPhoneNorms.has(n)
                )
              );
              const importedEmailNorms = new Set(importedEmails.map((e) => e.address.trim().toLowerCase()));
              const matchingEmailNorms = new Set(
                [...matchingEmails.map((e) => e.address.trim().toLowerCase())].filter((n) =>
                  importedEmailNorms.has(n)
                )
              );

              const isSelected = selectedIndices.has(conflict.recordIndex);

              return (
                <article
                  key={`conflict-${conflict.recordIndex}`}
                  className={[
                    "rounded-2xl border bg-white/80 p-4",
                    isSelected ? "border-amber-400 ring-2 ring-amber-300" : "border-amber-200"
                  ].join(" ")}
                >
                  {/* Row header: checkbox + match signal */}
                  <div className="mb-3 flex items-start gap-3">
                    <input
                      type="checkbox"
                      aria-label={`Seleccionar conflicto ${conflict.recordIndex + 1}`}
                      checked={isSelected}
                      disabled={isMutating}
                      onChange={() => handleToggleOne(conflict.recordIndex)}
                      className="mt-0.5 h-4 w-4 shrink-0 accent-amber-700"
                    />
                    <p className="text-xs font-semibold text-amber-800">
                      {matchSignal}
                    </p>
                  </div>
                  <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(220px,0.8fr)]">
                    <ConflictRecordCol
                      label="Entrante"
                      record={conflict.importedRecord}
                      matchingPhoneNorms={matchingPhoneNorms}
                      matchingEmailNorms={matchingEmailNorms}
                      conflictType={conflict.conflictType}
                    />
                    <ConflictRecordCol
                      label="Existente"
                      record={conflict.matchingRecord}
                      matchingPhoneNorms={matchingPhoneNorms}
                      matchingEmailNorms={matchingEmailNorms}
                      conflictType={conflict.conflictType}
                    />
                    <fieldset>
                      <legend className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-800">
                        Política
                      </legend>
                      <div className="mt-2 grid gap-2">
                        {(Object.keys(POLICY_LABELS) as MergePolicy[]).map((policy) => {
                          const descId = `policy-desc-${conflict.recordIndex}-${policy}`;
                          return (
                            <div
                              key={policy}
                              className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2"
                            >
                              <label className="flex items-center gap-2 text-sm font-medium text-slate-800">
                                <input
                                  type="radio"
                                  name={`conflict-policy-${conflict.recordIndex}`}
                                  value={policy}
                                  checked={conflict.selectedPolicy === policy}
                                  disabled={isMutating}
                                  onChange={() => onPolicyChange(conflict.recordIndex, policy)}
                                  aria-describedby={descId}
                                  className="h-4 w-4 shrink-0"
                                />
                                {POLICY_LABELS[policy]}
                              </label>
                              <p
                                id={descId}
                                className="mt-1 pl-6 text-xs text-slate-500"
                              >
                                {POLICY_DESCRIPTIONS[policy]}
                              </p>
                            </div>
                          );
                        })}
                      </div>
                    </fieldset>
                  </div>
                </article>
              );
            })}
          </div>

          {/* OIR-176 — conflict pagination controls */}
          {conflictedRecords.length > CONFLICTS_PER_PAGE && (
            <nav aria-label="Navegación de conflictos" className="mt-3 rounded-2xl border border-amber-200 bg-white/80 p-2">
              <div className="flex items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={() => setConflictsPage((p) => p - 1)}
                  disabled={conflictsPage === 0}
                  aria-label="Página anterior"
                  className="focus-ring flex h-9 w-9 items-center justify-center rounded-xl text-amber-600 transition hover:bg-amber-50 disabled:cursor-default disabled:opacity-30"
                >
                  <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5">
                    <path d="m12.5 4.5-5 5 5 5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
                  </svg>
                </button>
                <span className="text-sm text-amber-900">
                  Página <span aria-current="page" className="font-semibold">{conflictsPage + 1}</span> de <span className="font-semibold">{Math.ceil(conflictedRecords.length / CONFLICTS_PER_PAGE)}</span>
                </span>
                <button
                  type="button"
                  onClick={() => setConflictsPage((p) => p + 1)}
                  disabled={(conflictsPage + 1) * CONFLICTS_PER_PAGE >= conflictedRecords.length}
                  aria-label="Página siguiente"
                  className="focus-ring flex h-9 w-9 items-center justify-center rounded-xl text-amber-600 transition hover:bg-amber-50 disabled:cursor-default disabled:opacity-30"
                >
                  <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5">
                    <path d="m7.5 4.5 5 5-5 5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
                  </svg>
                </button>
              </div>
            </nav>
          )}
        </div>
      )}

      {/* Type/area counts */}
      <div className="mt-5 grid gap-4 xl:grid-cols-2">
        <div className="rounded-2xl bg-white/80 p-4">
          <p className="text-sm font-semibold text-emerald-950">Tipos detectados</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {Object.entries(preview.typeCounts).length === 0 ? (
              <span className="text-sm text-emerald-900/80">Sin registros válidos todavía.</span>
            ) : (
              Object.entries(preview.typeCounts).map(([type, count]) => (
                <span key={type} className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-900">
                  {type}: {count}
                </span>
              ))
            )}
          </div>
        </div>
        <div className="rounded-2xl bg-white/80 p-4">
          <p className="text-sm font-semibold text-emerald-950">Áreas detectadas</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {Object.entries(preview.areaCounts).length === 0 ? (
              <span className="text-sm text-emerald-900/80">Sin áreas clasificadas en el CSV.</span>
            ) : (
              Object.entries(preview.areaCounts).map(([area, count]) => (
                <span key={area} className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-900">
                  {area}: {count}
                </span>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Row-level table */}
      {preview.previewRows.length > 0 && (
        <div className="mt-6">
          <p className="text-sm font-semibold text-emerald-950">
            Filas del archivo ({preview.previewRows.length})
            {totalPreviewPages > 1 && (
              <span className="ml-2 text-xs font-normal text-emerald-700">
                — filas {previewPageStart + 1}–{Math.min(previewPageStart + PREVIEW_ROWS_PER_PAGE, totalPreviewRows)} de {totalPreviewRows}
              </span>
            )}
          </p>
          <div className="mt-3 overflow-x-auto rounded-2xl border border-emerald-200">
            <table className="w-full border-collapse text-sm" aria-label="Filas de importación">
              <thead>
                <tr className="border-b border-emerald-200 bg-emerald-100/60">
                  <th scope="col" className="whitespace-nowrap px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-emerald-800">
                    Fila
                  </th>
                  <th scope="col" className="whitespace-nowrap px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-emerald-800">
                    Estado
                  </th>
                  <th scope="col" className="whitespace-nowrap px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-emerald-800">
                    Nombre visible
                  </th>
                  <th scope="col" className="whitespace-nowrap px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-emerald-800">
                    Tipo
                  </th>
                  <th scope="col" className="whitespace-nowrap px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-emerald-800">
                    Departamento
                  </th>
                  <th scope="col" className="whitespace-nowrap px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-emerald-800">
                    Área
                  </th>
                  <th scope="col" className="whitespace-nowrap px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-emerald-800">
                    Teléfono
                  </th>
                  <th scope="col" className="whitespace-nowrap px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-emerald-800">
                    Correo
                  </th>
                  <th scope="col" className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-emerald-800">
                    Mensajes
                  </th>
                </tr>
              </thead>
              <tbody>
                {currentPageRows.map((row) => (
                  <tr
                    key={`row-${row.rowNumber}`}
                    className={["border-b border-emerald-100 last:border-0", STATUS_ROW_STYLES[row.status]].join(" ")}
                  >
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-slate-500">
                      {row.rowNumber}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2">
                      <span
                        className={[
                          "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold",
                          STATUS_BADGE_STYLES[row.status]
                        ].join(" ")}
                        aria-label={`Estado: ${STATUS_LABELS[row.status]}`}
                      >
                        <span aria-hidden="true">{STATUS_ICON[row.status]}</span>
                        {STATUS_LABELS[row.status]}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-medium text-slate-800">
                      {row.displayName ?? <span className="italic text-slate-600">Sin nombre</span>}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                      {row.type ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-slate-600">
                      {row.department ?? "—"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                      {row.area ?? "—"}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-slate-600">
                      {row.phone1Number ?? "—"}
                    </td>
                    <td className="px-3 py-2 text-slate-600">
                      {row.email1 ?? "—"}
                    </td>
                    <td className="px-3 py-2">
                      {row.errorMessages && row.errorMessages.length > 0 && (
                        <ul className="space-y-0.5">
                          {row.errorMessages.map((msg, i) => (
                            <li key={i} className="text-xs text-red-700">
                              {msg}
                            </li>
                          ))}
                        </ul>
                      )}
                      {row.warningMessages && row.warningMessages.length > 0 && (
                        <ul className="space-y-0.5">
                          {row.warningMessages.map((msg, i) => (
                            <li key={i} className="text-xs text-amber-700">
                              {msg}
                            </li>
                          ))}
                        </ul>
                      )}
                      {(!row.errorMessages || row.errorMessages.length === 0) &&
                        (!row.warningMessages || row.warningMessages.length === 0) && (
                          <span className="text-xs text-slate-600">—</span>
                        )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pager — only shown when there are multiple pages */}
          {totalPreviewPages > 1 && (
            <nav aria-label="Paginación de filas de importación" className="mt-3 rounded-2xl border border-emerald-200 bg-white/80 p-2">
              <div className="flex items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={() => setPreviewPage((p) => Math.max(1, p - 1))}
                  disabled={safePage === 1}
                  aria-label="Página anterior"
                  className="flex h-9 w-9 items-center justify-center rounded-xl text-emerald-600 transition hover:bg-emerald-50 disabled:cursor-default disabled:opacity-30"
                >
                  <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5">
                    <path d="m12.5 4.5-5 5 5 5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
                  </svg>
                </button>
                <span className="text-sm text-emerald-900">
                  Página <span aria-current="page" className="font-semibold">{safePage}</span> de <span className="font-semibold">{totalPreviewPages}</span>
                </span>
                <button
                  type="button"
                  onClick={() => setPreviewPage((p) => Math.min(totalPreviewPages, p + 1))}
                  disabled={safePage === totalPreviewPages}
                  aria-label="Página siguiente"
                  className="flex h-9 w-9 items-center justify-center rounded-xl text-emerald-600 transition hover:bg-emerald-50 disabled:cursor-default disabled:opacity-30"
                >
                  <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5">
                    <path d="m7.5 4.5 5 5-5 5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
                  </svg>
                </button>
              </div>
            </nav>
          )}
        </div>
      )}

      {/* Zero-rows state */}
      {preview.previewRows.length === 0 && preview.totalRowCount === 0 && (
        <div className="mt-6 rounded-2xl border border-dashed border-emerald-300 bg-white/60 px-4 py-6 text-center text-sm text-emerald-900/80">
          El archivo no contiene filas de datos.
        </div>
      )}
    </section>
  );
};
