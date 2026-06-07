import { useEffect, useState } from "react";
import type { BuscaRecord, EditableBuscaRecord } from "../../shared/types/busca";
import { ConfirmDialog } from "../components/feedback/ConfirmDialog";

export const BuscasPage = () => {
  const [records, setRecords] = useState<BuscaRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; number: string } | null>(null);

  const [formData, setFormData] = useState<EditableBuscaRecord>({
    number: "",
    assignedTo: "",
    department: "",
    cargo: "",
    shift: "",
    team: "",
    notes: "",
    status: "active"
  });

  const loadBuscas = async () => {
    try {
      setLoading(true);
      setError("");
      const data = await window.hospitalDirectory.listBuscas();
      setRecords(data);
    } catch {
      setError("Error al cargar los buscas.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadBuscas();
  }, []);

  const handleCreateNew = () => {
    setEditingId(null);
    setFormData({
      number: "",
      assignedTo: "",
      department: "",
      cargo: "",
      shift: "",
      team: "",
      notes: "",
      status: "active"
    });
    setShowForm(true);
  };

  const handleEdit = (record: BuscaRecord) => {
    setEditingId(record.id);
    setFormData({
      number: record.number,
      assignedTo: record.assignedTo,
      department: record.department ?? "",
      cargo: record.cargo ?? "",
      shift: record.shift ?? "",
      team: record.team ?? "",
      notes: record.notes ?? "",
      status: record.status
    });
    setShowForm(true);
  };

  const handleCancel = () => {
    setShowForm(false);
    setEditingId(null);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      if (editingId) {
        const updated = await window.hospitalDirectory.updateBusca(editingId, formData);
        setRecords((prev) => prev.map((r) => (r.id === editingId ? updated : r)));
      } else {
        const created = await window.hospitalDirectory.createBusca(formData);
        setRecords((prev) => [...prev, created]);
      }
      setShowForm(false);
      setEditingId(null);
    } catch {
      setError(editingId ? "Error al actualizar el busca." : "Error al crear el busca.");
    }
  };

  const handleDeleteClick = (record: BuscaRecord) => {
    setDeleteConfirm({ id: record.id, number: record.number });
  };

  const handleDeleteConfirm = async () => {
    if (!deleteConfirm) return;
    try {
      await window.hospitalDirectory.deleteBusca(deleteConfirm.id);
      setRecords((prev) => prev.filter((r) => r.id !== deleteConfirm.id));
      setDeleteConfirm(null);
    } catch {
      setError("Error al eliminar el busca.");
      setDeleteConfirm(null);
    }
  };

  const filteredRecords = records.filter((record) => {
    const lowerQuery = query.toLowerCase().trim();
    if (!lowerQuery) return true;
    return (
      record.number.toLowerCase().includes(lowerQuery) ||
      record.assignedTo.toLowerCase().includes(lowerQuery) ||
      (record.department?.toLowerCase() ?? "").includes(lowerQuery) ||
      (record.cargo?.toLowerCase() ?? "").includes(lowerQuery)
    );
  });

  if (loading) {
    return (
      <section role="status" aria-live="polite" className="rounded-3xl bg-white p-8 shadow-panel">
        Cargando buscas…
      </section>
    );
  }

  return (
    <section aria-labelledby="buscas-page-title" className="flex flex-col gap-5">
      <div className="rounded-3xl bg-white p-4 shadow-panel sm:p-5">
        <h2 id="buscas-page-title" className="text-xl font-semibold text-scs-blueDark mb-4">
          Registro de Buscas
        </h2>
        {error && (
          <div role="alert" className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">
            {error}
          </div>
        )}
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div className="flex-1">
            <label htmlFor="buscas-search" className="sr-only">
              Buscar buscas
            </label>
            <input
              id="buscas-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar por número, asignado, departamento o cargo"
              type="search"
              className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none ring-scs-blue transition focus:border-scs-blue focus:bg-white focus:ring-2"
            />
          </div>
          <button
            type="button"
            onClick={handleCreateNew}
            className="focus-ring rounded-full bg-scs-blue px-5 py-3 text-sm font-semibold text-white transition hover:bg-scs-blueDark"
          >
            Nuevo busca
          </button>
        </div>
        <p className="mt-3 text-xs font-medium text-slate-500">{filteredRecords.length} resultados</p>
      </div>

      {showForm && (
        <form onSubmit={handleSubmit} className="rounded-3xl bg-white p-6 shadow-panel">
          <h3 className="mb-5 text-lg font-semibold text-scs-blueDark">
            {editingId ? "Editar busca" : "Nuevo busca"}
          </h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="form-number" className="block text-sm font-medium text-slate-700 mb-2">
                Número de busca <span className="text-red-600">*</span>
              </label>
              <input
                id="form-number"
                type="text"
                required
                value={formData.number}
                onChange={(e) => setFormData((prev) => ({ ...prev, number: e.target.value }))}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none ring-scs-blue transition focus:border-scs-blue focus:bg-white focus:ring-2"
              />
            </div>
            <div>
              <label htmlFor="form-assigned-to" className="block text-sm font-medium text-slate-700 mb-2">
                Asignado a <span className="text-red-600">*</span>
              </label>
              <input
                id="form-assigned-to"
                type="text"
                required
                value={formData.assignedTo}
                onChange={(e) => setFormData((prev) => ({ ...prev, assignedTo: e.target.value }))}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none ring-scs-blue transition focus:border-scs-blue focus:bg-white focus:ring-2"
              />
            </div>
            <div>
              <label htmlFor="form-department" className="block text-sm font-medium text-slate-700 mb-2">
                Departamento
              </label>
              <input
                id="form-department"
                type="text"
                value={formData.department}
                onChange={(e) => setFormData((prev) => ({ ...prev, department: e.target.value }))}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none ring-scs-blue transition focus:border-scs-blue focus:bg-white focus:ring-2"
              />
            </div>
            <div>
              <label htmlFor="form-cargo" className="block text-sm font-medium text-slate-700 mb-2">
                Cargo
              </label>
              <input
                id="form-cargo"
                type="text"
                value={formData.cargo}
                onChange={(e) => setFormData((prev) => ({ ...prev, cargo: e.target.value }))}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none ring-scs-blue transition focus:border-scs-blue focus:bg-white focus:ring-2"
              />
            </div>
            <div>
              <label htmlFor="form-shift" className="block text-sm font-medium text-slate-700 mb-2">
                Turno
              </label>
              <input
                id="form-shift"
                type="text"
                placeholder="ej. Mañana, Tarde, Noche"
                value={formData.shift}
                onChange={(e) => setFormData((prev) => ({ ...prev, shift: e.target.value }))}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none ring-scs-blue transition focus:border-scs-blue focus:bg-white focus:ring-2"
              />
            </div>
            <div>
              <label htmlFor="form-team" className="block text-sm font-medium text-slate-700 mb-2">
                Grupo
              </label>
              <input
                id="form-team"
                type="text"
                value={formData.team}
                onChange={(e) => setFormData((prev) => ({ ...prev, team: e.target.value }))}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none ring-scs-blue transition focus:border-scs-blue focus:bg-white focus:ring-2"
              />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="form-notes" className="block text-sm font-medium text-slate-700 mb-2">
                Notas
              </label>
              <textarea
                id="form-notes"
                rows={3}
                value={formData.notes}
                onChange={(e) => setFormData((prev) => ({ ...prev, notes: e.target.value }))}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none ring-scs-blue transition focus:border-scs-blue focus:bg-white focus:ring-2"
              />
            </div>
            <div>
              <label htmlFor="form-status" className="block text-sm font-medium text-slate-700 mb-2">
                Estado
              </label>
              <select
                id="form-status"
                value={formData.status}
                onChange={(e) => setFormData((prev) => ({ ...prev, status: e.target.value as "active" | "inactive" }))}
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none ring-scs-blue transition focus:border-scs-blue focus:bg-white focus:ring-2"
              >
                <option value="active">Activo</option>
                <option value="inactive">Inactivo</option>
              </select>
            </div>
          </div>
          <div className="mt-6 flex gap-3 justify-end">
            <button
              type="button"
              onClick={handleCancel}
              className="focus-ring rounded-full border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              Cancelar
            </button>
            <button
              type="submit"
              className="focus-ring rounded-full bg-scs-blue px-5 py-3 text-sm font-semibold text-white transition hover:bg-scs-blueDark"
            >
              {editingId ? "Guardar cambios" : "Crear busca"}
            </button>
          </div>
        </form>
      )}

      {filteredRecords.length === 0 && !showForm && (
        <div
          role="status"
          aria-live="polite"
          className="rounded-3xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500 shadow-panel"
        >
          No hay buscas registradas.
        </div>
      )}

      {filteredRecords.length > 0 && (
        <div className="rounded-3xl bg-white shadow-panel overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50">
                  <th className="px-4 py-3 text-left font-semibold text-slate-700">Número</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-700">Asignado a</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-700">Departamento</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-700">Cargo</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-700">Turno</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-700">Grupo</th>
                  <th className="px-4 py-3 text-left font-semibold text-slate-700">Estado</th>
                  <th className="px-4 py-3 text-right font-semibold text-slate-700">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {filteredRecords.map((record) => (
                  <tr key={record.id} className="border-b border-slate-100 hover:bg-slate-50 transition">
                    <td className="px-4 py-3 font-medium text-slate-900">{record.number}</td>
                    <td className="px-4 py-3 text-slate-700">{record.assignedTo}</td>
                    <td className="px-4 py-3 text-slate-600">{record.department ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-600">{record.cargo ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-600">{record.shift ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-600">{record.team ?? "—"}</td>
                    <td className="px-4 py-3">
                      <span
                        className={
                          record.status === "active"
                            ? "rounded-full bg-green-100 px-2.5 py-1 text-xs font-semibold text-green-800"
                            : "rounded-full bg-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-700"
                        }
                      >
                        {record.status === "active" ? "Activo" : "Inactivo"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex gap-2 justify-end">
                        <button
                          type="button"
                          onClick={() => handleEdit(record)}
                          className="focus-ring rounded-lg px-3 py-1.5 text-xs font-semibold text-scs-blue transition hover:bg-scs-mist"
                        >
                          Editar
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteClick(record)}
                          className="focus-ring rounded-lg px-3 py-1.5 text-xs font-semibold text-red-700 transition hover:bg-red-50"
                        >
                          Eliminar
                        </button>
                      </div>
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
        message={`¿Estás seguro de que quieres eliminar el busca "${deleteConfirm?.number}"? Esta acción no se puede deshacer.`}
        confirmLabel="Eliminar"
        cancelLabel="Cancelar"
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteConfirm(null)}
        isDestructive
      />
    </section>
  );
};
