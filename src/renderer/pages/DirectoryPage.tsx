import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { isRecoveryBootstrap } from "../../shared/types/contact";
import { useAppStore, selectVisibleRecords } from "../store/useAppStore";
import { getPhonePrivacyFlags, getPreferredResultPhone } from "../services/search.service";
import type { PrivacyFlag } from "../services/search.service";
import type { AreaType, RecordType } from "../../shared/constants/catalogs";
import type { PhoneContact } from "../../shared/types/contact";
import { SelectField } from "../components/inputs/SelectField";

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

const privacyInlineRiskText = {
  Confidencial: "Número interno confidencial.",
  "No facilitar a pacientes": "No compartir con pacientes."
} as const;

const privacyDetailWarningText = {
  Confidencial: "Contiene números internos confidenciales.",
  "No facilitar a pacientes": "Incluye teléfonos que no deben compartirse con pacientes."
} as const satisfies Record<PrivacyFlag, string>;

const getPhoneInlinePrivacyFlags = (phone?: PhoneContact): PrivacyFlag[] => {
  if (!phone) {
    return [];
  }

  const flags: PrivacyFlag[] = [];

  if (phone.confidential) {
    flags.push("Confidencial");
  }

  if (phone.noPatientSharing) {
    flags.push("No facilitar a pacientes");
  }

  return flags;
};

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

  // NOTE: App.tsx handles global bootstrap and blocks navigation during loading/recovery.
  // This local loader is retained only for page-level retry and test isolation.
  const loadBootstrapData = async () => {
    try {
      setBootstrapError("");
      const payload = await window.hospitalDirectory.getBootstrapData();
      if (isRecoveryBootstrap(payload)) {
        setBootstrapError(payload.recovery.message);
        return;
      }
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
  const selectedRecordPrivacyFlags = selectedRecord ? getPhonePrivacyFlags(selectedRecord) : [];

  return (
    <div className="flex flex-col gap-6">
      {/* Search Header */}
      <div className="rounded-3xl bg-white p-5 shadow-panel sm:p-6">
        <div className="flex flex-col gap-5">
          <div>
            <h2 className="text-2xl font-semibold text-scs-blueDark sm:text-3xl">Directorio</h2>
            <p className="mt-1 text-sm text-slate-600">
              Busca, filtra y revisa el detalle operativo.
            </p>
          </div>
          <div className="flex flex-col gap-3 md:flex-row md:items-end">
            <div className="flex-1">
              <label htmlFor="directory-search" className="sr-only">
                Buscar contactos
              </label>
              <input
                id="directory-search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar por nombre, servicio, alias..."
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none ring-scs-blue transition focus:border-scs-blue focus:bg-white focus:ring-2"
              />
            </div>
            <div className="w-full md:w-48">
              <SelectField
                id="directory-type-filter"
                label="Tipo"
                value={selectedType}
                onChange={handleTypeChange}
                options={[
                  { value: "all", label: typeLabels.all },
                  ...availableTypes.map((type) => ({ value: type, label: typeLabels[type] }))
                ]}
              />
            </div>
            <div className="w-full md:w-48">
              <SelectField
                id="directory-area-filter"
                label="Área"
                value={selectedArea}
                onChange={handleAreaChange}
                options={[
                  { value: "all", label: areaLabels.all },
                  ...availableAreas.map((area) => ({ value: area, label: areaLabels[area] }))
                ]}
              />
            </div>
          </div>
          <div className="flex items-center justify-between">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={showInactive}
                onChange={(event) => setShowInactive(event.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-scs-blue focus:ring-scs-blue"
              />
              <span className="text-sm font-medium text-slate-700">Mostrar inactivos</span>
            </label>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
              {visibleRecords.length} resultados
            </span>
          </div>
        </div>
      </div>

      {/* Main Layout: List (Left) / Detail (Right) */}
      <div className="grid items-start gap-6 lg:grid-cols-[340px_minmax(0,1fr)] xl:grid-cols-[380px_minmax(0,1fr)]">
        
        {/* Left Column: Results List */}
        <div className="flex flex-col gap-3">
          {visibleRecords.map((record) => {
            const primaryPhone = getPreferredResultPhone(record);
            const isSelected = record.id === selectedRecord?.id;
            const privacyFlags = getPhoneInlinePrivacyFlags(primaryPhone);

            return (
              <button
                key={record.id}
                type="button"
                onClick={() => setSelectedRecordId(record.id)}
                aria-pressed={isSelected}
                className={[
                  "w-full rounded-2xl border p-4 text-left transition",
                  isSelected
                    ? "border-scs-blue bg-scs-mist shadow-sm ring-1 ring-scs-blue"
                    : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50 shadow-panel"
                ].join(" ")}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-semibold text-scs-blueDark">{record.displayName}</p>
                    <p className="truncate text-xs text-slate-500">
                      {record.type} · {record.organization.department ?? "Sin unidad"}
                    </p>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium text-slate-700">{primaryPhone?.number ?? "Sin teléfono"}</span>
                  {privacyFlags.length > 0 && (
                    <span className="inline-flex items-center gap-2" title="Atención de privacidad">
                      <span className="inline-flex h-2 w-2 rounded-full bg-amber-500" aria-hidden="true"></span>
                      <span className="sr-only">Atención de privacidad</span>
                    </span>
                  )}
                </div>
              </button>
            );
          })}
          {visibleRecords.length === 0 && (
            <div className="rounded-3xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500 shadow-panel">
              No hay resultados para la búsqueda y filtros actuales.
            </div>
          )}
        </div>

        {/* Right Column: Detail View (Sticky) */}
        <div className="lg:sticky lg:top-6">
          <div className="rounded-3xl bg-white p-6 shadow-panel sm:p-8">
            <h3 className="text-xs font-semibold text-slate-400 mb-6 uppercase tracking-wider">Detalle del Registro</h3>
            {selectedRecord ? (
              <div className="space-y-6">
                <div>
                  <p className="text-sm font-semibold uppercase tracking-wide text-scs-blue">{selectedRecord.type}</p>
                  <p className="mt-1 text-3xl font-semibold text-scs-blueDark">{selectedRecord.displayName}</p>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="rounded-2xl bg-slate-50 p-4 border border-slate-100">
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Unidad y Servicio</p>
                    <p className="mt-2 font-medium text-slate-800">{selectedRecord.organization.department ?? "Sin departamento"}</p>
                    <p className="mt-1 text-sm text-slate-600">
                      {selectedRecord.organization.service ?? "Sin servicio"}
                    </p>
                    <p className="mt-1 text-xs text-slate-500">{areaLabels[selectedRecord.organization.area ?? "none"]}</p>
                  </div>
                  
                  {selectedRecord.location && (
                    <div className="rounded-2xl bg-slate-50 p-4 border border-slate-100">
                      <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Ubicación</p>
                      <p className="mt-2 text-sm font-medium text-slate-800">
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
                </div>

                {selectedRecordPrivacyFlags.length > 0 && (
                  <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-amber-950">
                    <div className="flex items-center gap-2">
                      <svg className="h-5 w-5 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                      <p className="font-semibold text-amber-800">Atención de privacidad</p>
                    </div>
                    <p className="mt-2 text-sm">
                      Este registro contiene teléfonos sensibles. Confirma el contexto antes de compartir.
                    </p>
                    <ul className="mt-3 space-y-2 text-sm">
                      {selectedRecordPrivacyFlags.map((flag) => (
                        <li key={flag} className="flex gap-2">
                          <span className="font-semibold shrink-0">{flag}:</span>
                          <span>{privacyDetailWarningText[flag]}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-2">Teléfonos</p>
                  {selectedRecord.contactMethods.phones.map((phone) => (
                    <div key={phone.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-2xl border border-slate-200 p-4 transition hover:bg-slate-50">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">{phone.label ?? "Teléfono"}</p>
                        <p className="mt-1 text-xl font-semibold text-scs-blueDark">{phone.number}</p>
                        {phone.extension && <p className="mt-1 text-sm font-medium text-slate-600">Ext: {phone.extension}</p>}
                        {phone.notes && <p className="mt-1 text-xs text-slate-500">{phone.notes}</p>}
                      </div>
                      <div className="flex flex-wrap gap-2 shrink-0">
                        {phone.confidential && (
                          <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-semibold text-red-700 border border-red-200">
                            Confidencial
                          </span>
                        )}
                        {phone.noPatientSharing && (
                          <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800 border border-amber-200">
                            No pacientes
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                  {selectedRecord.contactMethods.phones.length === 0 && (
                    <p className="text-sm text-slate-500 italic">No hay teléfonos registrados.</p>
                  )}
                </div>

                {selectedRecord.notes && (
                  <div className="rounded-2xl bg-slate-50 p-4 border border-slate-100">
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Notas</p>
                    <p className="mt-2 text-sm font-medium text-slate-800 whitespace-pre-wrap">{selectedRecord.notes}</p>
                  </div>
                )}

                <div className="pt-4 border-t border-slate-100">
                  <Link
                    to={`/contacts/${selectedRecord.id}/edit`}
                    className="inline-flex w-full sm:w-auto items-center justify-center rounded-2xl bg-slate-800 px-6 py-3 text-sm font-semibold text-white transition hover:bg-slate-700"
                  >
                    Editar registro
                  </Link>
                </div>
              </div>
            ) : (
              <div className="flex h-64 flex-col items-center justify-center text-center">
                <div className="rounded-full bg-slate-50 p-4 mb-4">
                  <svg className="h-8 w-8 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" />
                  </svg>
                </div>
                <p className="text-base font-medium text-slate-600">Selecciona un registro</p>
                <p className="mt-1 text-sm text-slate-500">Haz clic en un resultado de la lista para ver su detalle.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
