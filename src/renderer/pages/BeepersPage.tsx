import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { BeeperRecord, EditableBeeperRecord, EditableImportedBeeperRecord, ImportedBeeperRecord } from "../../shared/schemas/beeper.schema";
import { BEEPER_SHIFTS } from "../../shared/schemas/beeper.schema";
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
// BEEPER_SHIFTS.
const SHIFT_OPTIONS = BEEPER_SHIFTS.map((shift) => ({ value: shift, label: SHIFT_LABELS[shift] }));

const EditIcon = () => (
  <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2">
    <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487 19.5 7.125M6.75 20.25H3.75v-3L15.878 5.122a1.864 1.864 0 0 1 2.637 0l.363.363a1.864 1.864 0 0 1 0 2.637L6.75 20.25Z" />
  </svg>
);

const DeleteIcon = () => (
  <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2">
    <path strokeLinecap="round" strokeLinejoin="round" d="M6 7.5h12m-10.5 0 .75 12h7.5l.75-12M9.75 7.5V4.875h4.5V7.5" />
  </svg>
);

const emptyForm = (): EditableBeeperRecord => ({
  deviceNumber: "",
  assignedTo: "",
  department: "",
  role: "",
  shift: "mañana",
  group: ""
});

const normalizeVisibleBeeperCell = (value: string): string =>
  value.trim().toLocaleLowerCase("es").replace(/\s+/g, " ");

const importedBeeperDisplayKey = (record: ImportedBeeperRecord): string =>
  [record.deviceNumber, record.name ?? record.holderType ?? "", record.department, record.category ?? ""]
    .map(normalizeVisibleBeeperCell)
    .join("\u0000");

export const BeepersPage = () => {
  const { pushToast } = useToast();
  const [records, setRecords] = useState<BeeperRecord[]>([]);
  const [importedRecords, setImportedRecords] = useState<ImportedBeeperRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [query, setQuery] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingImportedId, setEditingImportedId] = useState<string | null>(null);
  const [formData, setFormData] = useState<EditableBeeperRecord>(emptyForm());
  const [formError, setFormError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; deviceNumber: string } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const firstFieldRef = useRef<HTMLInputElement>(null);
  const deferredQuery = useDeferredValue(query);

  const loadBeepers = async () => {
    try {
      setIsLoading(true);
      setLoadError(false);
      const [primary, imported] = await Promise.allSettled([
        window.hospitalDirectory.listBeepers(),
        window.hospitalDirectory.listImportedBeepers()
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
    void loadBeepers();
  }, []);

  // `when` combines showForm with editingId so switching from "create" to
  // "edit" (or vice versa) while the form stays open re-triggers focus, not
  // just the initial open — see useFocusOnMount's docstring.
  useFocusOnMount(firstFieldRef, showForm && (editingId ?? editingImportedId ?? "new"));

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

  const visibleImportedRecords = useMemo(() => {
    const visibleKeys = new Set<string>();
    return filteredImportedRecords.filter((record) => {
      const key = importedBeeperDisplayKey(record);
      if (visibleKeys.has(key)) return false;
      visibleKeys.add(key);
      return true;
    });
  }, [filteredImportedRecords]);

  const handleCreateNew = () => {
    setEditingId(null);
    setEditingImportedId(null);
    setFormData(emptyForm());
    setFormError("");
    setShowForm(true);
  };

  const handleEdit = (record: BeeperRecord) => {
    setEditingId(record.id);
    setEditingImportedId(null);
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

  const handleEditImported = (record: ImportedBeeperRecord) => {
    setEditingId(null);
    setEditingImportedId(record.id);
    setFormData({
      ...emptyForm(),
      deviceNumber: record.deviceNumber,
      assignedTo: record.name ?? record.holderType ?? "",
      department: record.department,
      role: record.category ?? ""
    });
    setFormError("");
    setShowForm(true);
  };

  const handleCancel = () => {
    if (isSaving) return;
    setShowForm(false);
    setEditingId(null);
    setEditingImportedId(null);
    setFormError("");
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isSaving) return;
    setFormError("");
    setIsSaving(true);
    try {
      if (editingImportedId) {
        const importedPayload: EditableImportedBeeperRecord = {
          deviceNumber: formData.deviceNumber,
          assignedTo: formData.assignedTo,
          department: formData.department,
          role: formData.role
        };
        const updated = await window.hospitalDirectory.updateImportedBeeper(editingImportedId, importedPayload);
        setImportedRecords((prev) => prev.map((record) => (record.id === editingImportedId ? updated : record)));
      } else if (editingId) {
        const updated = await window.hospitalDirectory.updateBeeper(editingId, formData);
        setRecords((prev) => prev.map((r) => (r.id === editingId ? updated : r)));
      } else {
        const created = await window.hospitalDirectory.addBeeper(formData);
        setRecords((prev) => [created, ...prev]);
      }
      setShowForm(false);
      setEditingId(null);
      setEditingImportedId(null);
    } catch (err) {
      setFormError(
        toCompactToastMessage(
          err,
          editingId || editingImportedId ? "Error al actualizar la busca." : "Error al crear la busca."
        )
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteClick = (record: BeeperRecord) => {
    setDeleteConfirm({ id: record.id, deviceNumber: record.deviceNumber });
  };

  const handleDeleteConfirm = async () => {
    if (!deleteConfirm || isDeleting) return;
    setIsDeleting(true);
    try {
      await window.hospitalDirectory.deleteBeeper(deleteConfirm.id);
      setRecords((prev) => prev.filter((r) => r.id !== deleteConfirm.id));
      setDeleteConfirm(null);
    } catch {
      pushToast({ type: "error", message: "Error al eliminar la busca." });
      setDeleteConfirm(null);
    } finally {
      setIsDeleting(false);
    }
  };

  const setField = <K extends keyof EditableBeeperRecord>(key: K, value: EditableBeeperRecord[K]) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
  };

  if (isLoading) {
    return <LoadingStatus message="Cargando buscas…" busy />;
  }

  if (loadError) {
    return (
      <section aria-labelledby="beeper-page-title" className="flex flex-col gap-5">
        <div className="rounded-3xl bg-white p-4 shadow-panel sm:p-5">
          <h2 id="beeper-page-title" className="text-xl font-semibold text-scs-blueDark">
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
              onClick={() => void loadBeepers()}
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
    <section aria-labelledby="beeper-page-title" className="flex flex-col gap-5" aria-busy={isDeleting}>
      {/* Header */}
      <div className="rounded-3xl bg-white p-4 shadow-panel sm:p-5">
        <div className="flex flex-col gap-4">
          <h2 id="beeper-page-title" className="text-xl font-semibold text-scs-blueDark">
            Registro de Buscas
          </h2>
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div className="flex-1">
              <label htmlFor="beeper-search" className="sr-only">
                Buscar buscas
              </label>
              <input
                id="beeper-search"
                data-page-search
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Número, titular, departamento o rol…"
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
            {filteredRecords.length + visibleImportedRecords.length}{" "}
            {filteredRecords.length + visibleImportedRecords.length === 1 ? "resultado" : "resultados"}
          </p>
        </div>
      </div>

      {/* Create / Edit Form */}
      {showForm && (
        <form
          data-keyboard-submit
          onSubmit={(e) => { if (!isSaving) void handleSubmit(e); }}
          className="rounded-3xl bg-white p-6 shadow-panel"
          aria-label={editingId || editingImportedId ? "Editar busca" : "Nueva busca"}
        >
          <h3 className="mb-5 text-lg font-semibold text-scs-blueDark">
            {editingId || editingImportedId ? "Editar busca" : "Nueva busca"}
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
                Asignado a / Titular {!editingImportedId && <span aria-hidden="true" className="text-red-600">*</span>}
              </label>
              <input
                id="form-assigned-to"
                type="text"
                required={!editingImportedId}
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
                Rol {!editingImportedId && <span aria-hidden="true" className="text-red-600">*</span>}
              </label>
              <input
                id="form-role"
                type="text"
                required={!editingImportedId}
                value={formData.role}
                onChange={(e) => setField("role", e.target.value)}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none ring-scs-blue transition focus-visible:border-scs-blue focus-visible:bg-white focus-visible:ring-2"
              />
            </div>
            {!editingImportedId && (
              <>
                <div>
                  <SelectField
                    id="form-shift"
                    label="Turno"
                    value={formData.shift}
                    onChange={(value) => setField("shift", value as EditableBeeperRecord["shift"])}
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
              </>
            )}
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
              {isSaving ? "Guardando…" : editingId || editingImportedId ? "Guardar cambios" : "Crear busca"}
            </button>
          </div>
        </form>
      )}

      {/* Empty state */}
      {filteredRecords.length === 0 && visibleImportedRecords.length === 0 && !showForm && (
        <StatePanel
          title={query ? "Sin resultados" : "Sin registros"}
          message={query
            ? "No hay buscas que coincidan con la búsqueda."
            : "No hay buscas registradas. Crea el primer registro."}
        />
      )}

      {/* Records table */}
      {(filteredRecords.length > 0 || visibleImportedRecords.length > 0) && (
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
                    Rol
                  </th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                    Departamento
                  </th>
                  <th scope="col" className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-slate-600">
                    Asignado a / Titular
                  </th>
                  <th scope="col" className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-600">
                    Acciones
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredRecords.map((record) => (
                  <tr key={record.id} className="border-b border-slate-100 transition hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <span className="inline-flex rounded-xl bg-scs-mist px-3 py-1.5 text-base font-bold text-scs-blueDark ring-1 ring-scs-blue/15">
                        {record.deviceNumber}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{record.role}</td>
                    <td className="px-4 py-3 text-slate-600">{record.department}</td>
                    <td className="px-4 py-3 text-slate-700">{record.assignedTo}</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => !isSaving && handleEdit(record)}
                          disabled={isSaving}
                          className="focus-ring inline-flex size-11 items-center justify-center rounded-full text-scs-blue transition hover:bg-scs-mist disabled:opacity-60"
                          aria-label={`Editar busca ${record.deviceNumber}`}
                        >
                          <EditIcon />
                        </button>
                        <button
                          type="button"
                          onClick={() => !isSaving && handleDeleteClick(record)}
                          disabled={isSaving}
                          className="focus-ring inline-flex size-11 items-center justify-center rounded-full text-red-700 transition hover:bg-red-50 disabled:opacity-60"
                          aria-label={`Eliminar busca ${record.deviceNumber}`}
                        >
                          <DeleteIcon />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {visibleImportedRecords.map((record) => (
                  <tr key={record.id} className="border-b border-slate-100 bg-blue-50/30 transition hover:bg-blue-50/60">
                    <td className="px-4 py-3">
                      <span className="inline-flex rounded-xl bg-scs-mist px-3 py-1.5 text-base font-bold text-scs-blueDark ring-1 ring-scs-blue/15">
                        {record.deviceNumber}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{record.category ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-600">{record.department}</td>
                    <td className="px-4 py-3 text-slate-700">{record.name ?? record.holderType ?? "—"}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => !isSaving && handleEditImported(record)}
                        disabled={isSaving}
                        className="focus-ring inline-flex size-11 items-center justify-center rounded-full text-scs-blue transition hover:bg-scs-mist disabled:opacity-60"
                        aria-label={`Editar busca ${record.deviceNumber}`}
                      >
                        <EditIcon />
                      </button>
                    </td>
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
