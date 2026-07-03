import { useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { BuscaRecord, EditableBuscaRecord, ImportedBuscaRecord } from "../../shared/schemas/busca.schema";
import { BUSCA_SHIFTS } from "../../shared/schemas/busca.schema";
import { ConfirmDialog } from "../components/feedback/ConfirmDialog";

const SHIFT_LABELS: Record<string, string> = {
  "mañana": "Mañana",
  "tarde": "Tarde",
  "noche": "Noche"
};

const emptyForm = (): EditableBuscaRecord => ({
  deviceNumber: "",
  assignedTo: "",
  department: "",
  role: "",
  shift: "mañana",
  group: ""
});

export const BuscasPage = () => {
  const [records, setRecords] = useState<BuscaRecord[]>([]);
  const [importedRecords, setImportedRecords] = useState<ImportedBuscaRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<EditableBuscaRecord>(emptyForm());
  const [formError, setFormError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; deviceNumber: string } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const firstFieldRef = useRef<HTMLInputElement>(null);
  const deferredQuery = useDeferredValue(query);

  const loadBuscas = async () => {
    try {
      setIsLoading(true);
      setLoadError(false);
      setError("");
      const [primary, imported] = await Promise.allSettled([
        window.hospitalDirectory.listBuscas(),
        window.hospitalDirectory.listImportedBuscas()
      ]);
      if (primary.status === "rejected") throw primary.reason;
      setRecords(primary.value);
      setImportedRecords(imported.status === "fulfilled" ? imported.value : []);
    } catch {
      setLoadError(true);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadBuscas();
  }, []);

  useLayoutEffect(() => {
    if (showForm) {
      firstFieldRef.current?.focus();
    }
  }, [showForm, editingId]);

  const filteredRecords = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    if (!q) return records;
    return records.filter(
      (r) =>
        r.deviceNumber.toLowerCase().includes(q) ||
        r.assignedTo.toLowerCase().includes(q) ||
        r.department.toLowerCase().includes(q) ||
        r.role.toLowerCase().includes(q)
    );
  }, [records, deferredQuery]);

  const filteredImportedRecords = useMemo(() => {
    const q = deferredQuery.trim().toLowerCase();
    if (!q) return importedRecords;
    return importedRecords.filter(
      (r) =>
        r.deviceNumber.toLowerCase().includes(q) ||
        r.holderType.toLowerCase().includes(q) ||
        r.department.toLowerCase().includes(q) ||
        r.sourceSheet.toLowerCase().includes(q)
    );
  }, [importedRecords, deferredQuery]);

  const handleCreateNew = () => {
    setEditingId(null);
    setFormData(emptyForm());
    setFormError("");
    setShowForm(true);
  };

  const handleEdit = (record: BuscaRecord) => {
    setEditingId(record.id);
    setFormData({
      deviceNumber: record.deviceNumber,
      assignedTo: record.assignedTo,
      department: record.department,
      role: record.role,
      shift: record.shift,
      group: record.group ?? ""
    });
    setFormError("");
    setShowForm(true);
  };

  const handleCancel = () => {
    if (isSaving) return;
    setShowForm(false);
    setEditingId(null);
    setFormError("");
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isSaving) return;
    setFormError("");
    setIsSaving(true);
    try {
      if (editingId) {
        const updated = await window.hospitalDirectory.updateBusca(editingId, formData);
        setRecords((prev) => prev.map((r) => (r.id === editingId ? updated : r)));
      } else {
        const created = await window.hospitalDirectory.addBusca(formData);
        setRecords((prev) => [created, ...prev]);
      }
      setShowForm(false);
      setEditingId(null);
    } catch (err) {
      setFormError(
        err instanceof Error
          ? err.message
          : editingId
          ? "Error al actualizar la busca."
          : "Error al crear la busca."
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteClick = (record: BuscaRecord) => {
    setDeleteConfirm({ id: record.id, deviceNumber: record.deviceNumber });
  };

  const handleDeleteConfirm = async () => {
    if (!deleteConfirm || isDeleting) return;
    setIsDeleting(true);
    try {
      await window.hospitalDirectory.deleteBusca(deleteConfirm.id);
      setRecords((prev) => prev.filter((r) => r.id !== deleteConfirm.id));
      setDeleteConfirm(null);
    } catch {
      setError("Error al eliminar la busca.");
      setDeleteConfirm(null);
    } finally {
      setIsDeleting(false);
    }
  };

  const setField = <K extends keyof EditableBuscaRecord>(key: K, value: EditableBuscaRecord[K]) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
  };

  if (isLoading) {
    return (
      <section role="status" aria-live="polite" className="rounded-3xl bg-white p-8 shadow-panel">
        Cargando buscas…
      </section>
    );
  }

  if (loadError) {
    return (
      <section aria-labelledby="buscas-page-title" className="flex flex-col gap-5">
        <div className="rounded-3xl bg-white p-4 shadow-panel sm:p-5">
          <h2 id="buscas-page-title" className="text-xl font-semibold text-scs-blueDark">
            Registro de Buscas
          </h2>
        </div>
        <div
          role="alert"
          className="rounded-3xl border border-red-200 bg-red-50 p-8 text-center shadow-panel"
        >
          <p className="mb-4 text-sm font-medium text-red-900">
            No se pudieron cargar los registros de buscas.
          </p>
          <button
            type="button"
            onClick={() => void loadBuscas()}
            className="focus-ring rounded-full bg-scs-blue px-5 py-3 text-sm font-semibold text-white transition hover:bg-scs-blueDark"
          >
            Reintentar
          </button>
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby="buscas-page-title" className="flex flex-col gap-5">
      {/* Header */}
      <div className="rounded-3xl bg-white p-4 shadow-panel sm:p-5">
        <div className="flex flex-col gap-4">
          <h2 id="buscas-page-title" className="text-xl font-semibold text-scs-blueDark">
            Registro de Buscas
          </h2>
          {error && (
            <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
              {error}
            </div>
          )}
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div className="flex-1">
              <label htmlFor="buscas-search" className="sr-only">
                Buscar buscas por número, asignado, departamento, rol, titular u hoja ODS
              </label>
              <input
                id="buscas-search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar por número, nombre, departamento, rol, titular u hoja ODS"
                type="search"
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none ring-scs-blue transition focus:border-scs-blue focus:bg-white focus:ring-2"
              />
            </div>
            <button
              type="button"
              onClick={handleCreateNew}
              disabled={isSaving}
              className="focus-ring shrink-0 rounded-full bg-scs-blue px-5 py-3 text-sm font-semibold text-white transition hover:bg-scs-blueDark disabled:opacity-60"
            >
              Nueva busca
            </button>
          </div>
          <p
            role={filteredRecords.length + filteredImportedRecords.length > 0 ? "status" : undefined}
            aria-live={filteredRecords.length + filteredImportedRecords.length > 0 ? "polite" : "off"}
            aria-atomic={filteredRecords.length + filteredImportedRecords.length > 0 ? "true" : undefined}
            className="text-xs font-medium text-slate-500"
          >
            {filteredRecords.length + filteredImportedRecords.length}{" "}
            {filteredRecords.length + filteredImportedRecords.length === 1 ? "resultado" : "resultados"}
          </p>
        </div>
      </div>

      {/* Create / Edit Form */}
      {showForm && (
        <form
          data-keyboard-submit
          onSubmit={(e) => { if (!isSaving) void handleSubmit(e); }}
          className="rounded-3xl bg-white p-6 shadow-panel"
          aria-label={editingId ? "Editar busca" : "Nueva busca"}
        >
          <h3 className="mb-5 text-lg font-semibold text-scs-blueDark">
            {editingId ? "Editar busca" : "Nueva busca"}
          </h3>
          {formError && (
            <div role="alert" className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
              {formError}
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="form-device-number" className="mb-2 block text-sm font-medium text-slate-700">
                Número de busca <span aria-hidden="true" className="text-red-600">*</span>
              </label>
              <input
                ref={firstFieldRef}
                id="form-device-number"
                type="text"
                required
                value={formData.deviceNumber}
                onChange={(e) => setField("deviceNumber", e.target.value)}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none ring-scs-blue transition focus:border-scs-blue focus:bg-white focus:ring-2"
              />
            </div>
            <div>
              <label htmlFor="form-assigned-to" className="mb-2 block text-sm font-medium text-slate-700">
                Asignado a <span aria-hidden="true" className="text-red-600">*</span>
              </label>
              <input
                id="form-assigned-to"
                type="text"
                required
                value={formData.assignedTo}
                onChange={(e) => setField("assignedTo", e.target.value)}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none ring-scs-blue transition focus:border-scs-blue focus:bg-white focus:ring-2"
              />
            </div>
            <div>
              <label htmlFor="form-department" className="mb-2 block text-sm font-medium text-slate-700">
                Departamento <span aria-hidden="true" className="text-red-600">*</span>
              </label>
              <input
                id="form-department"
                type="text"
                required
                value={formData.department}
                onChange={(e) => setField("department", e.target.value)}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none ring-scs-blue transition focus:border-scs-blue focus:bg-white focus:ring-2"
              />
            </div>
            <div>
              <label htmlFor="form-role" className="mb-2 block text-sm font-medium text-slate-700">
                Rol <span aria-hidden="true" className="text-red-600">*</span>
              </label>
              <input
                id="form-role"
                type="text"
                required
                value={formData.role}
                onChange={(e) => setField("role", e.target.value)}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none ring-scs-blue transition focus:border-scs-blue focus:bg-white focus:ring-2"
              />
            </div>
            <div>
              <label htmlFor="form-shift" className="mb-2 block text-sm font-medium text-slate-700">
                Turno <span aria-hidden="true" className="text-red-600">*</span>
              </label>
              <select
                id="form-shift"
                required
                value={formData.shift}
                onChange={(e) => setField("shift", e.target.value as EditableBuscaRecord["shift"])}
                className="focus-ring w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none ring-scs-blue transition focus:border-scs-blue focus:bg-white focus:ring-2"
              >
                {BUSCA_SHIFTS.map((shift) => (
                  <option key={shift} value={shift}>
                    {SHIFT_LABELS[shift]}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="form-group" className="mb-2 block text-sm font-medium text-slate-700">
                Grupo
              </label>
              <input
                id="form-group"
                type="text"
                value={formData.group ?? ""}
                onChange={(e) => setField("group", e.target.value)}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none ring-scs-blue transition focus:border-scs-blue focus:bg-white focus:ring-2"
              />
            </div>
          </div>
          <div className="mt-6 flex justify-end gap-3">
            <button
              type="button"
              data-keyboard-cancel
              onClick={handleCancel}
              disabled={isSaving}
              className="focus-ring rounded-full border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="focus-ring rounded-full bg-scs-blue px-5 py-3 text-sm font-semibold text-white transition hover:bg-scs-blueDark disabled:opacity-60"
            >
              {isSaving ? "Guardando…" : editingId ? "Guardar cambios" : "Crear busca"}
            </button>
          </div>
        </form>
      )}

      {/* Empty state */}
      {filteredRecords.length === 0 && filteredImportedRecords.length === 0 && !showForm && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-3xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500 shadow-panel"
        >
          {query
            ? "No hay buscas que coincidan con la búsqueda."
            : "No hay buscas registradas. Crea el primer registro."}
        </div>
      )}

      {/* Records table */}
      {(filteredRecords.length > 0 || filteredImportedRecords.length > 0) && (
        <div className="rounded-3xl bg-white shadow-panel overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <caption className="sr-only">Registros de buscas</caption>
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                    Número
                  </th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                    Asignado a / Titular
                  </th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                    Departamento
                  </th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                    Rol
                  </th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                    Turno / Origen
                  </th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                    Grupo / Hoja
                  </th>
                  <th scope="col" className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-600">
                    Acciones
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredRecords.map((record) => (
                  <tr key={record.id} className="border-b border-slate-100 transition hover:bg-slate-50">
                    <td className="px-4 py-3 font-semibold text-scs-blueDark">{record.deviceNumber}</td>
                    <td className="px-4 py-3 text-slate-700">{record.assignedTo}</td>
                    <td className="px-4 py-3 text-slate-600">{record.department}</td>
                    <td className="px-4 py-3 text-slate-600">{record.role}</td>
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">
                        {SHIFT_LABELS[record.shift] ?? record.shift}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-500">{record.group ?? "—"}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => !isSaving && handleEdit(record)}
                          disabled={isSaving}
                          className="focus-ring rounded-lg px-3 py-1.5 text-xs font-semibold text-scs-blue transition hover:bg-scs-mist disabled:opacity-60"
                          aria-label={`Editar busca ${record.deviceNumber}`}
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => !isSaving && handleDeleteClick(record)}
                          disabled={isSaving}
                          className="focus-ring rounded-lg px-3 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-red-50 disabled:opacity-60"
                          aria-label={`Eliminar busca ${record.deviceNumber}`}
                        >
                          Eliminar
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filteredImportedRecords.map((record) => (
                  <tr key={record.id} className="border-b border-slate-100 bg-blue-50/30 transition hover:bg-blue-50/60">
                    <td className="px-4 py-3 font-semibold text-scs-blueDark">{record.deviceNumber}</td>
                    <td className="px-4 py-3 text-slate-700">{record.holderType}</td>
                    <td className="px-4 py-3 text-slate-600">{record.department}</td>
                    <td className="px-4 py-3 text-slate-400">—</td>
                    <td className="px-4 py-3">
                      <span className="rounded-full bg-blue-100 px-2.5 py-1 text-xs font-semibold text-blue-700">
                        ODS
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-500">{record.sourceSheet}</td>
                    <td className="px-4 py-3 text-right" />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <ConfirmDialog
        isOpen={deleteConfirm !== null}
        title="Confirmar eliminación"
        message={`¿Estás seguro de que quieres eliminar la busca "${deleteConfirm?.deviceNumber ?? ""}"? Esta acción no se puede deshacer.`}
        confirmLabel={isDeleting ? "Eliminando…" : "Eliminar"}
        cancelLabel="Cancelar"
        onConfirm={() => void handleDeleteConfirm()}
        onCancel={() => setDeleteConfirm(null)}
        isDestructive
        confirmDisabled={isDeleting}
        cancelDisabled={isDeleting}
      />
    </section>
  );
};
