import { useEffect, useState } from "react";
import { useAppStore, selectVisibleRecords } from "../store/useAppStore";

export const DirectoryPage = () => {
  const { contacts, settings, query, selectedRecordId, initialize, setQuery, setSelectedRecordId, isLoading } =
    useAppStore();
  const [bootstrapError, setBootstrapError] = useState("");

  const loadBootstrapData = async () => {
    try {
      setBootstrapError("");
      const payload = await window.hospitalDirectory.getBootstrapData();
      initialize(payload);
    } catch {
      setBootstrapError("No se pudieron cargar los datos locales. Revisa la configuración o importa una copia válida.");
    }
  };

  useEffect(() => {
    if (!contacts) {
      void loadBootstrapData();
    }
  }, [contacts]);

  if (bootstrapError) {
    return (
      <section className="rounded-3xl bg-white p-8 shadow-panel">
        <h2 className="text-xl font-semibold text-scs-blueDark">No se pudieron cargar los datos</h2>
        <p className="mt-2 text-sm text-slate-600">{bootstrapError}</p>
        <button
          type="button"
          onClick={() => void loadBootstrapData()}
          className="mt-6 rounded-full bg-scs-blue px-5 py-3 text-sm font-semibold text-white"
        >
          Reintentar
        </button>
      </section>
    );
  }

  if (isLoading || !contacts || !settings) {
    return <section className="rounded-3xl bg-white p-8 shadow-panel">Cargando datos locales…</section>;
  }

  const visibleRecords = selectVisibleRecords(
    contacts.records,
    query,
    settings.ui.showInactiveByDefault
  );
  const selectedRecord =
    visibleRecords.find((record) => record.id === selectedRecordId) ?? visibleRecords[0] ?? null;

  return (
    <section className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)_360px]">
      <aside className="rounded-3xl bg-white p-5 shadow-panel">
        <p className="text-sm font-semibold text-scs-blue">Filtros rápidos</p>
        <p className="mt-2 text-sm text-slate-600">
          La lógica avanzada de filtros se añadirá en la siguiente iteración.
        </p>
      </aside>

      <div className="rounded-3xl bg-white p-5 shadow-panel">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-scs-blueDark">Búsqueda principal</h2>
            <p className="text-sm text-slate-600">Base inicial lista para Fuse.js, filtros y detalle.</p>
          </div>
          <label htmlFor="directory-search" className="sr-only">
            Buscar contactos
          </label>
          <input
            id="directory-search"
            aria-label="Buscar contactos"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar por nombre, servicio, alias o teléfono"
            className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none ring-scs-blue transition focus:border-scs-blue focus:ring-2 sm:max-w-sm"
          />
        </div>

        <div className="mt-6 space-y-3">
          {visibleRecords.map((record) => {
            const primaryPhone = record.contactMethods.phones[0];
            const isSelected = record.id === selectedRecord?.id;
            const privacyFlags = primaryPhone
              ? [primaryPhone.confidential ? "Confidencial" : null, primaryPhone.noPatientSharing ? "No facilitar a pacientes" : null].filter(
                  (value): value is string => Boolean(value)
                )
              : [];

            return (
              <button
                key={record.id}
                type="button"
                onClick={() => setSelectedRecordId(record.id)}
                className={[
                  "w-full rounded-2xl border p-4 text-left transition",
                  isSelected
                    ? "border-scs-blue bg-scs-mist"
                    : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                ].join(" ")}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-scs-blueDark">{record.displayName}</p>
                    <p className="text-sm text-slate-600">
                      {record.type} · {record.organization.department ?? "Sin unidad"}
                    </p>
                  </div>
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-600">
                    {record.organization.area ?? "Sin área"}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium text-slate-700">{primaryPhone?.number ?? "Sin teléfono"}</span>
                  {privacyFlags.map((flag) => (
                    <span key={flag} className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
                      {flag}
                    </span>
                  ))}
                </div>
              </button>
            );
          })}
          {visibleRecords.length === 0 && (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-600">
              No hay resultados para la búsqueda actual.
            </div>
          )}
        </div>
      </div>

      <aside className="rounded-3xl bg-white p-5 shadow-panel">
        <h2 className="text-xl font-semibold text-scs-blueDark">Detalle</h2>
        {selectedRecord ? (
          <div className="mt-4 space-y-4">
            <div>
              <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">{selectedRecord.type}</p>
              <p className="text-2xl font-semibold text-scs-blueDark">{selectedRecord.displayName}</p>
            </div>
            <div className="rounded-2xl bg-slate-50 p-4">
              <p className="text-sm text-slate-500">Unidad</p>
              <p className="font-medium text-slate-800">{selectedRecord.organization.department ?? "Sin departamento"}</p>
            </div>
            <div className="space-y-3">
              {selectedRecord.contactMethods.phones.map((phone) => (
                <div key={phone.id} className="rounded-2xl border border-slate-200 p-4">
                  <p className="text-sm font-semibold text-slate-700">{phone.label ?? "Teléfono"}</p>
                  <p className="mt-1 text-lg font-semibold text-scs-blueDark">{phone.number}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {phone.confidential && (
                      <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-semibold text-red-700">
                        Confidencial
                      </span>
                    )}
                    {phone.noPatientSharing && (
                      <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800">
                        No facilitar a pacientes
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="mt-4 text-sm text-slate-600">Selecciona un registro para ver su detalle.</p>
        )}
      </aside>
    </section>
  );
};
