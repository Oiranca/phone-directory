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

const CONFLICT_REASON_LABELS: Record<string, string> = {
  "conflict_reason.external_id": "Mismo identificador externo",
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
  /** The specific value that triggered the match — used to highlight the matching field. */
  matchingFieldValue?: string;
  /** Type of match so we know which field to highlight. */
  conflictType: ConflictedImportRecord["conflictType"];
};

const ConflictRecordCol = ({ label, record, matchingFieldValue, conflictType }: ConflictRecordColProps) => {
  const isMatchingPhone = (num: string) =>
    conflictType === "phone-match" && matchingFieldValue !== undefined && num === matchingFieldValue;
  const isMatchingEmail = (addr: string) =>
    conflictType === "email-match" && matchingFieldValue !== undefined && addr.toLowerCase() === matchingFieldValue.toLowerCase();

  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-800">{label}</p>
      <p className="mt-1 font-semibold text-slate-900">{record.displayName}</p>

      {/* Org fields */}
      {(record.department ?? record.service ?? record.specialty) && (
        <div className="mt-1 text-xs text-slate-500">
          {record.department && <span>{record.department}</span>}
          {record.service && <span>{record.department ? " · " : ""}{record.service}</span>}
          {record.specialty && <span> · {record.specialty}</span>}
        </div>
      )}
      {record.locationSummary && (
        <p className="mt-0.5 text-xs text-slate-500">{record.locationSummary}</p>
      )}

      {/* Phones */}
      {record.phones.length > 0 && (
        <ul className="mt-2 space-y-0.5" aria-label="Teléfonos">
          {record.phones.map((phone, i) => (
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
      {record.emails.length > 0 && (
        <ul className="mt-1 space-y-0.5" aria-label="Correos">
          {record.emails.map((email, i) => (
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
      {record.socials.length > 0 && (
        <ul className="mt-1 space-y-0.5" aria-label="Redes sociales">
          {record.socials.map((social, i) => (
            <li key={i} className="text-xs text-slate-600">
              {social.platform}
              {social.handle && <span className="ml-1">@{social.handle}</span>}
              {!social.handle && social.url && <span className="ml-1">{social.url}</span>}
              {social.label && <span className="ml-1 text-slate-400">({social.label})</span>}
            </li>
          ))}
        </ul>
      )}

      {record.phones.length === 0 && record.emails.length === 0 && (
        <p className="mt-1 text-xs italic text-slate-400">Sin teléfonos ni correos</p>
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
};

export const CsvImportPreviewPanel = ({ preview, isImporting, isMutating, onConfirm, onPolicyChange, onClose }: Props) => {
  const conflictedRecords = preview.conflictedRecords ?? [];
  const conflictCount = preview.conflictCount ?? conflictedRecords.length;
  const policiesResolved = preview.policiesResolved ?? conflictCount === 0;
  const hasBlockers = preview.invalidRowCount > 0;
  const hasUnresolvedConflicts = conflictCount > 0 && !policiesResolved;
  const isConfirmDisabled = isMutating || hasBlockers || hasUnresolvedConflicts || preview.validRowCount === 0;

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
          <h3 className="mt-2 text-xl font-semibold text-emerald-950">{preview.fileName}</h3>
          {preview.detectedFormat && (
            <p className="mt-2 text-sm text-emerald-900/80">
              Formato detectado: {preview.detectedFormat}
              {preview.detectionConfidence
                ? ` (confianza ${formatDetectionConfidence(preview.detectionConfidence)})`
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
          El archivo contiene {preview.invalidRowCount} {preview.invalidRowCount === 1 ? "fila rechazada" : "filas rechazadas"}.
          Corrige el origen antes de importar o cierra la vista previa para seleccionar otro archivo.
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
            {conflictCount} {conflictCount === 1 ? "conflicto detectado" : "conflictos detectados"}.
          </span>{" "}
          {hasUnresolvedConflicts
            ? "Selecciona una política para cada conflicto antes de confirmar."
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
          <p className="text-sm font-semibold text-emerald-950">
            Conflictos ({conflictedRecords.length})
          </p>
          <div className="mt-3 space-y-4">
            {conflictedRecords.map((conflict) => {
              const reasonLabel = CONFLICT_REASON_LABELS[conflict.conflictReasonKey] ?? "Coincidencia detectada";
              const matchSignal = conflict.matchingFieldValue
                ? `${reasonLabel}: ${conflict.matchingFieldValue}`
                : reasonLabel;

              return (
                <article
                  key={`conflict-${conflict.recordIndex}`}
                  className="rounded-2xl border border-amber-200 bg-white/80 p-4"
                >
                  {/* Match signal badge */}
                  <p className="mb-3 text-xs font-semibold text-amber-800">
                    {matchSignal}
                  </p>
                  <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(220px,0.8fr)]">
                    <ConflictRecordCol
                      label="Entrante"
                      record={conflict.importedRecord}
                      matchingFieldValue={conflict.matchingFieldValue}
                      conflictType={conflict.conflictType}
                    />
                    <ConflictRecordCol
                      label="Existente"
                      record={conflict.matchingRecord}
                      matchingFieldValue={conflict.matchingFieldValue}
                      conflictType={conflict.conflictType}
                    />
                    <fieldset>
                      <legend className="text-xs font-semibold uppercase tracking-[0.2em] text-amber-800">
                        Política
                      </legend>
                      <div className="mt-2 grid gap-2">
                        {(Object.keys(POLICY_LABELS) as MergePolicy[]).map((policy) => (
                          <label
                            key={policy}
                            className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-800"
                          >
                            <input
                              type="radio"
                              name={`conflict-policy-${conflict.recordIndex}`}
                              value={policy}
                              checked={conflict.selectedPolicy === policy}
                              disabled={isMutating}
                              onChange={() => onPolicyChange(conflict.recordIndex, policy)}
                              className="h-4 w-4"
                            />
                            {POLICY_LABELS[policy]}
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  </div>
                </article>
              );
            })}
          </div>
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
                {preview.previewRows.map((row) => (
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
                      {row.displayName ?? <span className="italic text-slate-400">Sin nombre</span>}
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
                          <span className="text-xs text-slate-400">—</span>
                        )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
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
