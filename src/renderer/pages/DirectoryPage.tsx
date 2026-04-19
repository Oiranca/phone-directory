import { useEffect, useMemo, useState } from "react";
import { useAppStore, selectVisibleRecords } from "../store/useAppStore";
import { getPhonePrivacyFlags, getPreferredResultPhone } from "../services/search.service";
import type { AreaType, RecordType } from "../../shared/constants/catalogs";

const typeLabels = {
  all: "Todos los tipos",
  person: "Persona",
  service: "Servicio",
  department: "Departamento",
  control: "Control",
  supervision: "Supervisión",
  room: "Sala",
  "external-center": "Centro externo",
  other: "Otro"
} as const satisfies Record<RecordType | "all", string>;

const areaLabels = {
  all: "Todas las áreas",
  none: "Sin área",
  "sanitaria-asistencial": "Sanitaria asistencial",
  "gestion-administracion": "Gestión y administración",
  especialidades: "Especialidades",
  otros: "Otros"
} as const satisfies Record<AreaType | "all" | "none", string>;

export const DirectoryPage = () => {
  const {
    contacts,
    settings,
    query,
    selectedRecordId,
    selectedType,
    selectedArea,
    showInactive,
    initialize,
    setQuery,
    setSelectedType,
    setSelectedArea,
    setShowInactive,
    setSelectedRecordId,
    isLoading
  } = useAppStore();
  const [bootstrapError, setBootstrapError] = useState("");
  const availableTypes = useMemo(() => contacts?.catalogs.recordTypes ?? [], [contacts]);
  const availableAreas = useMemo(() => contacts?.catalogs.areas ?? [], [contacts]);
  const visibleRecords = useMemo(
    () =>
      selectVisibleRecords(
        contacts?.records ?? [],
        query,
        { selectedType, selectedArea, showInactive }
      ),
    [contacts, query, selectedType, selectedArea, showInactive]
  );

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

  const handleTypeChange = (value: string) => {
    if (value === "all" || availableTypes.includes(value as RecordType)) {
      setSelectedType(value as RecordType | "all");
      return;
    }

    setSelectedType("all");
  };

  const handleAreaChange = (value: string) => {
    if (value === "all" || availableAreas.includes(value as AreaType)) {
      setSelectedArea(value as AreaType | "all");
      return;
    }

    setSelectedArea("all");
  };

  const selectedRecord =
    visibleRecords.find((record) => record.id === selectedRecordId) ?? visibleRecords[0] ?? null;

  return (
    <section className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)_360px]">
      <aside className="rounded-3xl bg-white p-5 shadow-panel">
        <p className="text-sm font-semibold text-scs-blue">Filtros rápidos</p>
        <div className="mt-4 space-y-4">
          <div>
            <label htmlFor="directory-type-filter" className="text-sm font-medium text-slate-700">
              Tipo
            </label>
            <select
              id="directory-type-filter"
              value={selectedType}
              onChange={(event) => handleTypeChange(event.target.value)}
              className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none ring-scs-blue transition focus:border-scs-blue focus:ring-2"
            >
              <option value="all">{typeLabels.all}</option>
              {availableTypes.map((type) => (
                <option key={type} value={type}>
                  {typeLabels[type]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="directory-area-filter" className="text-sm font-medium text-slate-700">
              Área
            </label>
            <select
              id="directory-area-filter"
              value={selectedArea}
              onChange={(event) => handleAreaChange(event.target.value)}
              className="mt-2 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700 outline-none ring-scs-blue transition focus:border-scs-blue focus:ring-2"
            >
              <option value="all">{areaLabels.all}</option>
              {availableAreas.map((area) => (
                <option key={area} value={area}>
                  {areaLabels[area]}
                </option>
              ))}
            </select>
          </div>

          <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(event) => setShowInactive(event.target.checked)}
              className="mt-1 h-4 w-4 rounded border-slate-300 text-scs-blue focus:ring-scs-blue"
            />
            <span>
              <span className="block text-sm font-medium text-slate-700">Mostrar registros inactivos</span>
              <span className="mt-1 block text-xs text-slate-500">
                Valor inicial tomado de la configuración local.
              </span>
            </span>
          </label>
        </div>
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

        <div className="mt-4 flex flex-wrap gap-2 text-xs font-medium text-slate-500">
          <span className="rounded-full bg-slate-100 px-3 py-1">
            {visibleRecords.length} resultado{visibleRecords.length === 1 ? "" : "s"}
          </span>
          <span className="rounded-full bg-slate-100 px-3 py-1">{typeLabels[selectedType] ?? selectedType}</span>
          <span className="rounded-full bg-slate-100 px-3 py-1">{areaLabels[selectedArea] ?? selectedArea}</span>
        </div>

        <div className="mt-6 space-y-3">
          {visibleRecords.map((record) => {
            const primaryPhone = getPreferredResultPhone(record);
            const isSelected = record.id === selectedRecord?.id;
            const privacyFlags = getPhonePrivacyFlags(record);

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
                  {primaryPhone?.extension && (
                    <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
                      Ext. {primaryPhone.extension}
                    </span>
                  )}
                  {privacyFlags.map((flag) => (
                    <span
                      key={flag}
                      className={[
                        "rounded-full px-3 py-1 text-xs font-semibold",
                        flag === "Confidencial" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-800"
                      ].join(" ")}
                    >
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
              <p className="mt-1 text-sm text-slate-600">
                {selectedRecord.organization.service ?? "Sin servicio"} · {areaLabels[selectedRecord.organization.area ?? "none"]}
              </p>
            </div>
            {selectedRecord.location && (
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-sm text-slate-500">Ubicación</p>
                <p className="font-medium text-slate-800">
                  {[
                    selectedRecord.location.building,
                    selectedRecord.location.floor,
                    selectedRecord.location.room,
                    selectedRecord.location.text
                  ]
                    .filter(Boolean)
                    .join(" · ") || "Sin ubicación detallada"}
                </p>
              </div>
            )}
            <div className="space-y-3">
              {selectedRecord.contactMethods.phones.map((phone) => (
                <div key={phone.id} className="rounded-2xl border border-slate-200 p-4">
                  <p className="text-sm font-semibold text-slate-700">{phone.label ?? "Teléfono"}</p>
                  <p className="mt-1 text-lg font-semibold text-scs-blueDark">{phone.number}</p>
                  {phone.extension && <p className="mt-1 text-sm text-slate-600">Extensión: {phone.extension}</p>}
                  {phone.notes && <p className="mt-2 text-sm text-slate-600">{phone.notes}</p>}
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
            {selectedRecord.notes && (
              <div className="rounded-2xl bg-slate-50 p-4">
                <p className="text-sm text-slate-500">Notas</p>
                <p className="font-medium text-slate-800">{selectedRecord.notes}</p>
              </div>
            )}
          </div>
        ) : (
          <p className="mt-4 text-sm text-slate-600">Selecciona un registro para ver su detalle.</p>
        )}
      </aside>
    </section>
  );
};
