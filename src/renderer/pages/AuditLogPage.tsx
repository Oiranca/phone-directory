import { useEffect, useState } from "react";
import type { AuditAction, AuditLogEntry, AuditLogQueryParams } from "../../shared/types/contact";
import { useToast } from "../components/feedback/ToastRegion";
import { toCompactToastMessage } from "../utils/toastMessage";

const ACTION_LABELS: Record<AuditAction, string> = {
  create: "Alta",
  update: "Actualización",
  delete: "Eliminación",
  "bulk-import": "Importación masiva",
  "restore-from-backup": "Restauración de backup"
};

const ACTION_COLORS: Record<AuditAction, string> = {
  create: "bg-emerald-100 text-emerald-900",
  update: "bg-blue-100 text-blue-900",
  delete: "bg-red-100 text-red-900",
  "bulk-import": "bg-purple-100 text-purple-900",
  "restore-from-backup": "bg-amber-100 text-amber-900"
};

const AUDIT_ACTIONS: AuditAction[] = ["create", "update", "delete", "bulk-import", "restore-from-backup"];

const formatTimestamp = (value: string) => {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Fecha no válida";
  }

  return new Intl.DateTimeFormat("es-ES", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
};

const ChangesPanel = ({ changes }: { changes: Record<string, { old: unknown; new: unknown }> }) => (
  <div className="mt-3 overflow-x-auto rounded-2xl border border-slate-200 bg-slate-50">
    <table className="w-full text-xs">
      <thead>
        <tr className="border-b border-slate-200">
          <th className="px-3 py-2 text-left font-semibold text-slate-600">Campo</th>
          <th className="px-3 py-2 text-left font-semibold text-slate-600">Antes</th>
          <th className="px-3 py-2 text-left font-semibold text-slate-600">Después</th>
        </tr>
      </thead>
      <tbody>
        {Object.entries(changes).map(([key, diff]) => (
          <tr key={key} className="border-b border-slate-100 last:border-0">
            <td className="px-3 py-2 font-mono text-slate-700">{key}</td>
            <td className="px-3 py-2 text-red-700">
              {diff.old === null || diff.old === undefined ? <span className="italic text-slate-400">—</span> : String(diff.old)}
            </td>
            <td className="px-3 py-2 text-emerald-700">
              {diff.new === null || diff.new === undefined ? <span className="italic text-slate-400">—</span> : String(diff.new)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const AuditEntryRow = ({ entry }: { entry: AuditLogEntry }) => {
  const [expanded, setExpanded] = useState(false);
  const hasChanges = entry.action === "update" && entry.changes && Object.keys(entry.changes).length > 0;

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${ACTION_COLORS[entry.action]}`}>
              {ACTION_LABELS[entry.action]}
            </span>
            {entry.recordName && (
              <span className="text-sm font-semibold text-scs-blueDark">{entry.recordName}</span>
            )}
            {entry.importSource && (
              <span className="text-xs text-slate-500">{entry.importSource}</span>
            )}
          </div>
          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
            <span>{formatTimestamp(entry.timestamp)}</span>
            <span className="font-medium text-slate-700">{entry.editor}</span>
            {entry.recordsAffected !== undefined && (
              <span>{entry.recordsAffected} registros afectados</span>
            )}
            {entry.reason && (
              <span className="italic">{entry.reason}</span>
            )}
          </div>
        </div>
        {hasChanges && (
          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            className="shrink-0 rounded-full border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-600 hover:bg-slate-50"
          >
            {expanded ? "Ocultar cambios" : "Ver cambios"}
          </button>
        )}
      </div>
      {expanded && hasChanges && entry.changes && (
        <ChangesPanel changes={entry.changes as Record<string, { old: unknown; new: unknown }>} />
      )}
    </article>
  );
};

export const AuditLogPage = () => {
  const { pushToast } = useToast();
  const [isLoading, setIsLoading] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [filters, setFilters] = useState<AuditLogQueryParams>({});
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [editor, setEditor] = useState("");
  const [actionFilter, setActionFilter] = useState<AuditAction | "">("");
  const [recordName, setRecordName] = useState("");

  const buildParams = (): AuditLogQueryParams => ({
    ...(fromDate ? { fromDate: `${fromDate}T00:00:00.000Z` } : {}),
    ...(toDate ? { toDate: `${toDate}T23:59:59.999Z` } : {}),
    ...(editor.trim() ? { editor: editor.trim() } : {}),
    ...(actionFilter ? { action: actionFilter } : {}),
    ...(recordName.trim() ? { recordName: recordName.trim() } : {})
  });

  const loadAuditLog = async (params: AuditLogQueryParams) => {
    try {
      setIsLoading(true);
      const result = await window.hospitalDirectory.getAuditLog(params);
      setEntries(result.entries);
      setTotalCount(result.totalCount);
    } catch (error) {
      pushToast({
        type: "error",
        message: toCompactToastMessage(error, "No se pudo cargar el registro de auditoría.")
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadAuditLog({});
  }, []);

  const handleApplyFilters = () => {
    const params = buildParams();
    setFilters(params);
    void loadAuditLog(params);
  };

  const handleClearFilters = () => {
    setFromDate("");
    setToDate("");
    setEditor("");
    setActionFilter("");
    setRecordName("");
    setFilters({});
    void loadAuditLog({});
  };

  const handleExport = async () => {
    try {
      setIsExporting(true);
      const result = await window.hospitalDirectory.exportAuditLog(filters);

      if (!result) {
        pushToast({ type: "warning", message: "Exportación cancelada." });
        return;
      }

      pushToast({
        type: "success",
        message: `Exportación completada. ${result.entryCount} entradas exportadas.`
      });
    } catch (error) {
      pushToast({
        type: "error",
        message: toCompactToastMessage(error, "No se pudo exportar el registro de auditoría.")
      });
    } finally {
      setIsExporting(false);
    }
  };

  const hasActiveFilters = Object.keys(filters).length > 0;

  return (
    <section className="space-y-6">
      <h2 className="sr-only">Registro de auditoría</h2>

      <div className="rounded-3xl bg-white p-6 shadow-panel">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-scs-blue">Cumplimiento</p>
            <h3 className="mt-2 text-2xl font-semibold text-scs-blueDark">Registro de auditoría</h3>
          </div>
          <button
            type="button"
            onClick={() => void handleExport()}
            disabled={isExporting || isLoading}
            className="rounded-full border border-scs-blue px-5 py-2 text-sm font-semibold text-scs-blue disabled:opacity-60"
          >
            {isExporting ? "Exportando…" : "Exportar CSV"}
          </button>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          <div>
            <label htmlFor="audit-from-date" className="block text-xs font-semibold text-slate-600">
              Desde
            </label>
            <input
              id="audit-from-date"
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
              className="mt-1 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm focus:border-scs-blue focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="audit-to-date" className="block text-xs font-semibold text-slate-600">
              Hasta
            </label>
            <input
              id="audit-to-date"
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
              className="mt-1 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm focus:border-scs-blue focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="audit-editor" className="block text-xs font-semibold text-slate-600">
              Editor
            </label>
            <input
              id="audit-editor"
              type="text"
              value={editor}
              onChange={(e) => setEditor(e.target.value)}
              placeholder="Nombre del editor"
              className="mt-1 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm placeholder-slate-400 focus:border-scs-blue focus:outline-none"
            />
          </div>
          <div>
            <label htmlFor="audit-action" className="block text-xs font-semibold text-slate-600">
              Acción
            </label>
            <select
              id="audit-action"
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value as AuditAction | "")}
              className="mt-1 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm focus:border-scs-blue focus:outline-none"
            >
              <option value="">Todas</option>
              {AUDIT_ACTIONS.map((action) => (
                <option key={action} value={action}>
                  {ACTION_LABELS[action]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="audit-record-name" className="block text-xs font-semibold text-slate-600">
              Nombre del registro
            </label>
            <input
              id="audit-record-name"
              type="text"
              value={recordName}
              onChange={(e) => setRecordName(e.target.value)}
              placeholder="Buscar por nombre"
              className="mt-1 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm placeholder-slate-400 focus:border-scs-blue focus:outline-none"
            />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-3">
          <button
            type="button"
            onClick={handleApplyFilters}
            disabled={isLoading}
            className="rounded-full bg-scs-blue px-5 py-2 text-sm font-semibold text-white disabled:opacity-60"
          >
            Aplicar filtros
          </button>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={handleClearFilters}
              disabled={isLoading}
              className="rounded-full border border-slate-300 px-5 py-2 text-sm font-semibold text-slate-700 disabled:opacity-60"
            >
              Limpiar filtros
            </button>
          )}
        </div>
      </div>

      <div className="rounded-3xl bg-white p-6 shadow-panel">
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm text-slate-600">
            {isLoading ? (
              "Cargando…"
            ) : (
              <>
                <span className="font-semibold text-scs-blueDark">{totalCount}</span>
                {" "}
                {totalCount === 1 ? "entrada" : "entradas"}
                {hasActiveFilters ? " (filtradas)" : ""}
              </>
            )}
          </p>
        </div>

        {isLoading ? (
          <div role="status" aria-live="polite" aria-busy="true" className="mt-6 text-sm text-slate-500">
            Cargando registro de auditoría…
          </div>
        ) : entries.length === 0 ? (
          <div className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500">
            {hasActiveFilters
              ? "No hay entradas que coincidan con los filtros aplicados."
              : "El registro de auditoría está vacío. Las operaciones sobre contactos aparecerán aquí."}
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {entries.map((entry, index) => (
              <AuditEntryRow key={`${entry.timestamp}-${entry.recordId ?? ""}-${index}`} entry={entry} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
};
