import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { BuscaRecord, EditableBuscaRecord, ImportedBuscaRecord } from "../../shared/schemas/busca.schema";
import { BUSCA_SHIFTS } from "../../shared/schemas/busca.schema";
import { ConfirmDialog } from "../components/feedback/ConfirmDialog";
import { LoadingStatus } from "../components/feedback/LoadingStatus";
import { StatePanel } from "../components/feedback/StatePanel";
import { StatusBanner } from "../components/feedback/StatusBanner";
import { useToast } from "../components/feedback/ToastRegion";
import { SelectField } from "../components/inputs/SelectField";
import { useFocusOnMount } from "../hooks/useFocusOnMount";
import { toCompactToastMessage } from "../utils/toastMessage";

const SHIFT_LABELS: Record<string, string> = {
  "mañana": "Mañana",
  "tarde": "Tarde",
  "noche": "Noche"
};

// Options for the accessible SelectField combobox used below,
// replacing the previous plain native <select>. Same values/order as
// BUSCA_SHIFTS.
const SHIFT_OPTIONS = BUSCA_SHIFTS.map((shift) => ({ value: shift, label: SHIFT_LABELS[shift] }));

const emptyForm = (): EditableBuscaRecord => ({
  deviceNumber: "",
  assignedTo: "",
  department: "",
  role: "",
  shift: "mañana",
  group: ""
});

export const BuscasPage = () => {
  const { pushToast } = useToast();
  const [records, setRecords] = useState<BuscaRecord[]>([]);
  const [importedRecords, setImportedRecords] = useState<ImportedBuscaRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
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

  // `when` combines showForm with editingId so switching from "create" to
  // "edit" (or vice versa) while the form stays open re-triggers focus, not
  // just the initial open — see useFocusOnMount's docstring.
  useFocusOnMount(firstFieldRef, showForm && (editingId ?? "new"));

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
        (r.holderType ?? "").toLowerCase().includes(q) ||
        (r.name ?? "").toLowerCase().includes(q) ||
        (r.category ?? "").toLowerCase().includes(q) ||
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
        toCompactToastMessage(
          err,
          editingId ? "Error al actualizar la busca." : "Error al crear la busca."
        )
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
      pushToast({ type: "error", message: "Error al eliminar la busca." });
      setDeleteConfirm(null);
    } finally {
      setIsDeleting(false);
    }
  };

  const setField = <K extends keyof EditableBuscaRecord>(key: K, value: EditableBuscaRecord[K]) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
  };

  if (isLoading) {
    return <LoadingStatus message="Cargando buscas…" busy />;
  }

  if (loadError) {
    return (
      <section aria-labelledby="buscas-page-title" className="flex flex-col gap-5">
        <div className="rounded-3xl bg-white p-4 shadow-panel sm:p-5">
          <h2 id="buscas-page-title" className="text-xl font-semibold text-scs-blueDark">
            Registro de Buscas
          </h2>
        </div>
        <StatePanel
          role="alert"
          title="Error al cargar"
          message="No se pudieron cargar los registros de buscas."
          action={
            <button
              type="button"
              onClick={() => void loadBuscas()}
              className="focus-ring rounded-full bg-scs-blue px-5 py-3 text-sm font-semibold text-white transition hover:bg-scs-blueDark"
            >
              Reintentar
            </button>
          }
        />
      </section>
    );
  }

  return (
    <section aria-labelledby="buscas-page-title" className="flex flex-col gap-5" aria-busy={isDeleting}>
      {/* Header */}
      <div className="rounded-3xl bg-white p-4 shadow-panel sm:p-5">
        <div className="flex flex-col gap-4">
          <h2 id="buscas-page-title" className="text-xl font-semibold text-scs-blueDark">
            Registro de Buscas
          </h2>
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div className="flex-1">
              <label htmlFor="buscas-search" className="sr-only">
                Buscar buscas
              </label>
              <input
                id="buscas-search"
                data-page-search
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Número, asignado, departamento, rol, titular u hoja ODS…"
                type="search"
                title="Buscar buscas — pulsa / para enfocar"
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none ring-scs-blue transition focus-visible:border-scs-blue focus-visible:bg-white focus-visible:ring-2"
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
            role="status"
            aria-live="polite"
            aria-atomic="true"
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
          {formError && <StatusBanner type="error" message={formError} />}
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
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none ring-scs-blue transition focus-visible:border-scs-blue focus-visible:bg-white focus-visible:ring-2"
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
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none ring-scs-blue transition focus-visible:border-scs-blue focus-visible:bg-white focus-visible:ring-2"
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
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none ring-scs-blue transition focus-visible:border-scs-blue focus-visible:bg-white focus-visible:ring-2"
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
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none ring-scs-blue transition focus-visible:border-scs-blue focus-visible:bg-white focus-visible:ring-2"
              />
            </div>
            <div>
              <SelectField
                id="form-shift"
                label="Turno"
                value={formData.shift}
                onChange={(value) => setField("shift", value as EditableBuscaRecord["shift"])}
                options={SHIFT_OPTIONS}
              />
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
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none ring-scs-blue transition focus-visible:border-scs-blue focus-visible:bg-white focus-visible:ring-2"
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
        <StatePanel
          title={query ? "Sin resultados" : "Sin registros"}
          message={query
            ? "No hay buscas que coincidan con la búsqueda."
            : "No hay buscas registradas. Crea el primer registro."}
        />
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
                    <td className="px-4 py-3 text-slate-700">{record.name ?? record.holderType ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-600">{record.department}</td>
                    <td className="px-4 py-3 text-slate-600">{record.category ?? "—"}</td>
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
