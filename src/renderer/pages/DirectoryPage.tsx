import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { isRecoveryBootstrap } from "../../shared/types/contact";
import { useAppStore, selectVisibleRecords } from "../store/useAppStore";
import { getPhonePrivacyFlags, getPreferredResultPhone, normalizeTag } from "../services/search.service";
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

const tagLabelIntl = new Intl.Collator("es", { sensitivity: "base" });

const privacyInlineRiskText = {
  Confidencial: "Número interno confidencial.",
  "No facilitar a pacientes": "No compartir con pacientes."
} as const;

const RESULTS_PER_PAGE = 5;
const PAGINATION_WINDOW = 3;

const getPageRange = (startPage: number, length: number): number[] =>
  Array.from({ length }, (_, index) => startPage + index);

const getPaginationItems = (currentPage: number, totalPages: number): Array<number | "ellipsis-left" | "ellipsis-right"> => {
  if (totalPages <= PAGINATION_WINDOW + 2) {
    return getPageRange(1, totalPages);
  }

  if (currentPage <= PAGINATION_WINDOW) {
    return [...getPageRange(1, PAGINATION_WINDOW), "ellipsis-right", totalPages];
  }

  const trailingWindowStart = totalPages - (PAGINATION_WINDOW - 1);
  if (currentPage >= trailingWindowStart) {
    return [1, "ellipsis-left", ...getPageRange(trailingWindowStart, PAGINATION_WINDOW)];
  }

  const middleWindowStart = currentPage - Math.floor(PAGINATION_WINDOW / 2);
  return [1, "ellipsis-left", ...getPageRange(middleWindowStart, PAGINATION_WINDOW), "ellipsis-right", totalPages];
};

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
    selectedTags,
    showInactive,
    initialize,
    setQuery,
    setSelectedType,
    setSelectedArea,
    setSelectedTags,
    setShowInactive,
    setSelectedRecordId,
    isLoading
  } = useAppStore();
  const [bootstrapError, setBootstrapError] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const availableTypes = useMemo(() => contacts?.catalogs.recordTypes ?? [], [contacts]);
  const availableAreas = useMemo(() => contacts?.catalogs.areas ?? [], [contacts]);
  const availableTags = useMemo(() => {
    if (!contacts) {
      return [];
    }

    const tagsByNormalizedValue = new Map<string, string>();

    contacts.records.forEach((record) => {
      record.tags.forEach((tag) => {
        const trimmedTag = tag.trim();

        if (trimmedTag.length === 0) {
          return;
        }

        const normalizedTag = normalizeTag(trimmedTag);

        if (!tagsByNormalizedValue.has(normalizedTag)) {
          tagsByNormalizedValue.set(normalizedTag, trimmedTag);
        }
      });
    });

    return Array.from(tagsByNormalizedValue.values()).sort((left, right) => tagLabelIntl.compare(left, right));
  }, [contacts]);
  const deferredQuery = useDeferredValue(query);
  const visibleRecords = useMemo(
    () =>
      selectVisibleRecords(
        contacts?.records ?? [],
        deferredQuery,
        { selectedType, selectedArea, selectedTags, showInactive }
      ),
    [contacts, deferredQuery, selectedType, selectedArea, selectedTags, showInactive]
  );
  const totalPages = Math.max(1, Math.ceil(visibleRecords.length / RESULTS_PER_PAGE));
  const pageStart = (currentPage - 1) * RESULTS_PER_PAGE;
  const currentPageRecords = useMemo(
    () => visibleRecords.slice(pageStart, pageStart + RESULTS_PER_PAGE),
    [visibleRecords, pageStart]
  );
  const paginationItems = getPaginationItems(currentPage, totalPages);

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

  useEffect(() => {
    setCurrentPage(1);
  }, [deferredQuery, selectedType, selectedArea, selectedTags, showInactive]);

  useEffect(() => {
    setCurrentPage((page) => Math.min(page, totalPages));
  }, [totalPages]);

  useEffect(() => {
    if (selectedTags.length === 0) {
      return;
    }

    const normalizedToAvailableTag = new Map(
      availableTags.map((tag) => [normalizeTag(tag), tag] as const)
    );
    const nextSelectedTags = selectedTags.flatMap((tag) => {
      const matchingTag = normalizedToAvailableTag.get(normalizeTag(tag));
      return matchingTag ? [matchingTag] : [];
    });
    const hasChanged =
      nextSelectedTags.length !== selectedTags.length ||
      nextSelectedTags.some((tag, index) => tag !== selectedTags[index]);

    if (hasChanged) {
      setSelectedTags(nextSelectedTags);
    }
  }, [availableTags, selectedTags, setSelectedTags]);

  useEffect(() => {
    if (currentPageRecords.length === 0) {
      if (selectedRecordId !== null) {
        setSelectedRecordId(null);
      }
      return;
    }

    const hasSelectedRecordOnPage = currentPageRecords.some((record) => record.id === selectedRecordId);

    if (!hasSelectedRecordOnPage) {
      setSelectedRecordId(currentPageRecords[0]!.id);
    }
  }, [currentPageRecords, selectedRecordId, setSelectedRecordId]);

  if (bootstrapError) {
    return (
      <section className="rounded-3xl bg-white p-8 shadow-panel">
        <h2 className="text-xl font-semibold text-scs-blueDark">No se pudieron cargar los datos</h2>
        <p role="alert" className="mt-2 text-sm text-slate-600">{bootstrapError}</p>
        <button
          type="button"
          onClick={() => void loadBootstrapData()}
          className="focus-ring mt-6 rounded-full bg-scs-blue px-5 py-3 text-sm font-semibold text-white"
        >
          Reintentar
        </button>
      </section>
    );
  }

  if (isLoading || !contacts || !settings) {
    return <section role="status" aria-live="polite" className="rounded-3xl bg-white p-8 shadow-panel">Cargando datos locales…</section>;
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

  const handleClearFilters = () => {
    setQuery("");
    setSelectedType("all");
    setSelectedArea("all");
    setSelectedTags([]);
    setShowInactive(false);
  };

  const handleTagChange = (value: string) => {
    if (value === "all") {
      setSelectedTags([]);
      return;
    }

    if (availableTags.includes(value)) {
      setSelectedTags([value]);
      return;
    }

    setSelectedTags([]);
  };

  const selectedRecord =
    currentPageRecords.find((record) => record.id === selectedRecordId) ?? currentPageRecords[0] ?? null;
  const selectedRecordPrivacyFlags = selectedRecord ? getPhonePrivacyFlags(selectedRecord) : [];

  return (
    <section aria-labelledby="directory-page-title" className="flex flex-col gap-5">
      {/* Search Header */}
      <div className="rounded-3xl bg-white p-4 shadow-panel sm:p-5">
        <div className="flex flex-col gap-4">
          <h2 id="directory-page-title" className="sr-only">Directorio</h2>
          <div className="flex flex-col gap-3 md:flex-row md:items-end">
            <div className="flex-1">
              <label htmlFor="directory-search" className="sr-only">
                Buscar contactos
              </label>
              <input
                id="directory-search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar contacto o servicio"
                type="search"
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
            {availableTags.length > 0 || selectedTags.length > 0 ? (
              <div className="w-full md:w-48">
                <SelectField
                  id="directory-tag-filter"
                  label="Etiqueta"
                  value={selectedTags[0] ?? "all"}
                  onChange={handleTagChange}
                  options={[
                    { value: "all", label: "Todas las etiquetas" },
                    ...availableTags.map((tag) => ({ value: tag, label: tag }))
                  ]}
                />
              </div>
            ) : null}
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={showInactive}
                onChange={(event) => setShowInactive(event.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-scs-blue focus:ring-scs-blue"
              />
              <span className="text-sm font-medium text-slate-700">Mostrar inactivos</span>
            </label>
            <p
              role={visibleRecords.length > 0 ? "status" : undefined}
              aria-live={visibleRecords.length > 0 ? "polite" : "off"}
              aria-atomic={visibleRecords.length > 0 ? "true" : undefined}
              className="text-xs font-medium text-slate-500"
            >
              {visibleRecords.length} resultados
            </p>
          </div>
          {(query || selectedType !== "all" || selectedArea !== "all" || selectedTags.length > 0 || showInactive) && (
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {query ? (
                <span className="rounded-full bg-slate-100 px-2.5 py-1 font-medium text-slate-600">
                  {query}
                </span>
              ) : null}
              {selectedType !== "all" ? (
                <span className="rounded-full bg-slate-100 px-2.5 py-1 font-medium text-slate-600">
                  {typeLabels[selectedType]}
                </span>
              ) : null}
              {selectedArea !== "all" ? (
                <span className="rounded-full bg-slate-100 px-2.5 py-1 font-medium text-slate-600">
                  {areaLabels[selectedArea]}
                </span>
              ) : null}
              {selectedTags.map((tag) => (
                <span key={tag} className="rounded-full bg-slate-100 px-2.5 py-1 font-medium text-slate-600">
                  #{tag}
                </span>
              ))}
              {showInactive ? (
                <span className="rounded-full bg-slate-100 px-2.5 py-1 font-medium text-slate-600">
                  Inactivos
                </span>
              ) : null}
              <button
                type="button"
                onClick={handleClearFilters}
                className="focus-ring rounded-full px-2 py-1 font-semibold text-scs-blue transition hover:text-scs-blueDark"
              >
                Limpiar
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Main Layout: List (Left) / Detail (Right) */}
      <div className="grid items-start gap-6 lg:grid-cols-[340px_minmax(0,1fr)] xl:grid-cols-[380px_minmax(0,1fr)]">
        
        {/* Left Column: Results List */}
        <div className="flex flex-col gap-3">
          <ul aria-label="Resultados del directorio" className="flex flex-col gap-3">
          {currentPageRecords.map((record) => {
            const primaryPhone = getPreferredResultPhone(record);
            const isSelected = record.id === selectedRecord?.id;
            const privacyFlags = getPhoneInlinePrivacyFlags(primaryPhone);

            return (
              <li key={record.id}>
                <button
                  type="button"
                  onClick={() => setSelectedRecordId(record.id)}
                  aria-pressed={isSelected}
                  className={[
                    "w-full rounded-2xl border p-4 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-scs-blue focus-visible:ring-offset-2",
                    isSelected
                      ? "border-scs-blue bg-scs-mist shadow-sm ring-1 ring-scs-blue"
                      : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50 shadow-panel"
                  ].join(" ")}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-scs-blueDark">{record.displayName}</p>
                      <p className="truncate text-xs text-slate-500">
                        {typeLabels[record.type]} · {record.organization.department ?? "Sin unidad"}
                      </p>
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      {record.status === "inactive" ? (
                        <span className="rounded-full bg-slate-200 px-2.5 py-1 text-xs font-semibold text-slate-700">
                          Inactivo
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <p className="mt-2 truncate text-sm text-slate-600">
                    {record.organization.service ?? areaLabels[record.organization.area ?? "none"]}
                  </p>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium text-slate-700">{primaryPhone?.number ?? "Sin teléfono"}</span>
                    {privacyFlags.length > 0 && (
                      <span className="inline-flex items-center gap-2 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-900" title="Atención de privacidad">
                        <span className="inline-flex h-2 w-2 rounded-full bg-amber-500" aria-hidden="true"></span>
                        <span>Privacidad sensible</span>
                      </span>
                    )}
                  </div>
                </button>
              </li>
            );
          })}
          </ul>
          {visibleRecords.length === 0 && (
            <div role="status" aria-live="polite" className="rounded-3xl border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500 shadow-panel">
              No hay resultados para la búsqueda y filtros actuales.
            </div>
          )}
          {visibleRecords.length > RESULTS_PER_PAGE && (
            <nav aria-label="Paginación de resultados" className="rounded-2xl border border-slate-200 bg-white p-2">
              <div className="flex flex-wrap items-center justify-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                  disabled={currentPage === 1}
                  aria-label="Página anterior"
                  className="focus-ring flex h-10 w-10 items-center justify-center rounded-xl text-slate-400 transition hover:bg-slate-50 hover:text-slate-700 disabled:cursor-default disabled:opacity-30"
                >
                  <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5">
                    <path d="m12.5 4.5-5 5 5 5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
                  </svg>
                </button>
                <div className="flex flex-wrap items-center justify-center gap-1.5">
                  {paginationItems.map((item) => {
                    if (typeof item !== "number") {
                      return (
                        <span key={item} aria-hidden="true" className="px-1 text-sm font-semibold text-slate-400">
                          ...
                        </span>
                      );
                    }

                    return (
                      <button
                        key={item}
                        type="button"
                      onClick={() => setCurrentPage(item)}
                      aria-current={item === currentPage ? "page" : undefined}
                      aria-label={`Ir a la página ${item}`}
                      className={[
                          "focus-ring flex h-10 min-w-10 items-center justify-center rounded-xl px-3 text-sm font-semibold transition",
                          item === currentPage
                            ? "bg-scs-blue text-white shadow-sm"
                            : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
                      ].join(" ")}
                    >
                      {item}
                      </button>
                    );
                  })}
                </div>
                <button
                  type="button"
                  onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                  disabled={currentPage === totalPages}
                  aria-label="Página siguiente"
                  className="focus-ring flex h-10 w-10 items-center justify-center rounded-xl text-slate-400 transition hover:bg-slate-50 hover:text-slate-700 disabled:cursor-default disabled:opacity-30"
                >
                  <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5">
                    <path d="m7.5 4.5 5 5-5 5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
                  </svg>
                </button>
              </div>
            </nav>
          )}
        </div>

        {/* Right Column: Detail View (Sticky) */}
        <div className="lg:sticky lg:top-6">
          <div className="rounded-3xl bg-white p-6 shadow-panel sm:p-8">
            <h3 className="mb-5 text-xs font-semibold uppercase tracking-[0.22em] text-slate-400">Detalle del registro</h3>
            {selectedRecord ? (
              <div className="space-y-6">
                <div className="rounded-[28px] bg-slate-50/80 p-5 ring-1 ring-slate-100 sm:p-6">
                  <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold uppercase tracking-wide text-scs-blue ring-1 ring-slate-200">
                          {typeLabels[selectedRecord.type]}
                        </span>
                        {selectedRecord.status === "inactive" ? (
                          <span className="rounded-full bg-slate-200 px-3 py-1 text-xs font-semibold text-slate-700">
                            Inactivo
                          </span>
                        ) : null}
                        {selectedRecordPrivacyFlags.map((flag) => (
                          <span
                            key={flag}
                            className={flag === "Confidencial"
                              ? "rounded-full border border-red-200 bg-red-100 px-3 py-1 text-xs font-semibold text-red-700"
                              : "rounded-full border border-amber-200 bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-800"}
                          >
                            {flag}
                          </span>
                        ))}
                      </div>
                      <p className="mt-4 max-w-4xl text-3xl font-semibold leading-tight text-scs-blueDark sm:text-4xl">
                        {selectedRecord.displayName}
                      </p>
                    </div>
                    <Link
                      to={`/contacts/${selectedRecord.id}/edit`}
                      className="focus-ring inline-flex min-h-11 shrink-0 items-center justify-center self-start whitespace-nowrap rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
                    >
                      Editar registro
                    </Link>
                  </div>
                </div>

                <div className={selectedRecord.location ? "grid gap-4 sm:grid-cols-2" : "grid gap-4"}>
                  <div className="rounded-2xl border border-slate-200 bg-white p-5">
                    <div className="grid gap-4 sm:grid-cols-3">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Unidad</p>
                        <p className="mt-3 break-words text-base font-semibold text-slate-900 [overflow-wrap:anywhere]">
                          {selectedRecord.organization.department ?? "Sin departamento"}
                        </p>
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Servicio</p>
                        <p className="mt-3 break-words text-sm font-medium text-slate-700 [overflow-wrap:anywhere]">
                          {selectedRecord.organization.service ?? "Sin servicio"}
                        </p>
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Área</p>
                        <p className="mt-3 break-words text-sm font-medium text-slate-700 [overflow-wrap:anywhere]">
                          {areaLabels[selectedRecord.organization.area ?? "none"]}
                        </p>
                      </div>
                    </div>
                  </div>

                  {selectedRecord.location && (
                    <div className="rounded-2xl border border-slate-200 bg-white p-5">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Ubicación</p>
                      <p className="mt-3 break-words text-sm font-medium leading-6 text-slate-800 [overflow-wrap:anywhere]">
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

                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Teléfonos</p>
                    <p className="text-xs font-medium text-slate-400">
                      {selectedRecord.contactMethods.phones.length} disponibles
                    </p>
                  </div>
                  <div className="grid gap-3 xl:grid-cols-2">
                    {selectedRecord.contactMethods.phones.map((phone) => (
                      <div key={phone.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0">
                          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{phone.label ?? "Teléfono"}</p>
                          <p className="mt-2 text-3xl font-semibold leading-none text-scs-blueDark">{phone.number}</p>
                          {phone.extension && <p className="mt-2 text-sm font-medium text-slate-600">Extensión {phone.extension}</p>}
                          {phone.notes && <p className="mt-1 break-words text-sm text-slate-500 [overflow-wrap:anywhere]">{phone.notes}</p>}
                        </div>
                          <div className="flex flex-wrap gap-2 shrink-0">
                            {phone.isPrimary && (
                              <span className="rounded-full bg-scs-mist px-3 py-1.5 text-xs font-semibold text-scs-blueDark">
                                Principal
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="mt-4 flex flex-wrap gap-2">
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
                  </div>
                  {selectedRecord.contactMethods.phones.length === 0 && (
                    <p className="text-sm text-slate-500 italic">No hay teléfonos registrados.</p>
                  )}
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Correos electrónicos</p>
                    <p className="text-xs font-medium text-slate-400">
                      {selectedRecord.contactMethods.emails.length} disponibles
                    </p>
                  </div>
                  <div className="grid gap-3 xl:grid-cols-2">
                    {selectedRecord.contactMethods.emails.map((email) => (
                      <div key={email.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0">
                            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{email.label ?? "Correo electrónico"}</p>
                            <p className="mt-2 break-words text-lg font-semibold text-scs-blueDark [overflow-wrap:anywhere]">
                              {email.address}
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-2 shrink-0">
                            {email.isPrimary ? (
                              <span className="rounded-full bg-scs-mist px-3 py-1.5 text-xs font-semibold text-scs-blueDark">
                                Principal
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  {selectedRecord.contactMethods.emails.length === 0 && (
                    <p className="text-sm text-slate-500 italic">No hay correos registrados.</p>
                  )}
                </div>

                {selectedRecord.notes && (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-5">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Notas</p>
                    <p className="mt-3 break-words whitespace-pre-wrap text-sm font-medium leading-6 text-slate-800 [overflow-wrap:anywhere]">
                      {selectedRecord.notes}
                    </p>
                  </div>
                )}
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
    </section>
  );
};
