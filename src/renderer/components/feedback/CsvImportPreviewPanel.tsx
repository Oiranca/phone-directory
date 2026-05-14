import type { CsvImportPreview, CsvImportPreviewRow } from "../../../shared/types/contact";

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

const formatDetectionConfidence = (value: CsvImportPreview["detectionConfidence"]) => {
  if (value === "high") return "alta";
  if (value === "medium") return "media";
  if (value === "low") return "baja";
  return "";
};

type Props = {
  preview: CsvImportPreview;
  isImporting: boolean;
  isMutating: boolean;
  onConfirm: () => void;
  onClose: () => void;
};

export const CsvImportPreviewPanel = ({ preview, isImporting, isMutating, onConfirm, onClose }: Props) => {
  const hasBlockers = preview.invalidRowCount > 0;
  const isConfirmDisabled = isMutating || hasBlockers || preview.validRowCount === 0;

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
          <p className="mt-1 text-sm text-emerald-900/80">{preview.sourceFilePath}</p>
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
