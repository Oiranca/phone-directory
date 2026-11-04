import { useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useMatch, useNavigate } from "react-router";
import type { BeeperRecord, BeeperTeam, EditableBeeperRecord, EditableBeeperTeam, EditableImportedBeeperRecord, ImportedBeeperRecord } from "../../shared/schemas/beeper.schema";
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
const RESULTS_PER_PAGE = 10;

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

const emptyTeamForm = (): EditableBeeperTeam => ({ name: "", displayId: "" });

const validateTeamField = (value: string, label: string): string => {
  if (!value.trim()) return `El ${label} es obligatorio.`;
  if (value.trim().length > 255) return `El ${label} no puede superar 255 caracteres.`;
  return "";
};

// Spanish connectors that stay lowercase inside a displayed name (never as its first word).
const LOWERCASE_CONNECTORS = new Set(["de", "del", "la"]);

// Display only: lowercases the text and uppercases the first letter of every word, whatever
// the case of the source data. A word is a run of letters, combining marks, digits and
// apostrophes, so spaces, hyphens, dots, slashes and parentheses separate words and decomposed
// accents ("e" + U+0301) stay inside theirs. The whole words "de", "del" and "la" stay
// lowercase unless they are the first word of the value, wherever they sit (also after
// punctuation); accented variants are different words. Text without letters (the "—"
// placeholder) is unchanged.
const titleCaseWords = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) return value;
  let wordIndex = 0;
  return trimmed.toLocaleLowerCase("es").replace(/[\p{L}\p{M}\p{N}'’]+/gu, (word) => {
    const isConnector = wordIndex > 0 && LOWERCASE_CONNECTORS.has(word);
    wordIndex += 1;
    if (isConnector) return word;
    const [first = "", ...rest] = Array.from(word);
    return (/\p{L}/u.test(first) ? first.toLocaleUpperCase("es") : first) + rest.join("");
  });
};

const joinIds = (...ids: Array<string | false | undefined>): string | undefined => {
  const present = ids.filter(Boolean);
  return present.length > 0 ? present.join(" ") : undefined;
};

const normalizeVisibleBeeperCell = (value: string): string =>
  value.trim().toLocaleLowerCase("es").replace(/\s+/g, " ");

const beeperDisplayKey = (values: string[]): string =>
  values
    .map(normalizeVisibleBeeperCell)
    .join("\u0000");

const manualBeeperDisplayKey = (record: BeeperRecord): string =>
  beeperDisplayKey([record.deviceNumber, record.assignedTo, record.department, record.role]);

const importedBeeperDisplayKey = (record: ImportedBeeperRecord): string =>
  beeperDisplayKey([record.deviceNumber, record.name ?? record.holderType ?? "", record.department, record.category ?? ""]);

const importedBeeperRowsMatch = (left: ImportedBeeperRecord, right: ImportedBeeperRecord): boolean => {
  const leftValues = [left.deviceNumber, left.name ?? left.holderType ?? "", left.department, left.category ?? ""];
  const rightValues = [right.deviceNumber, right.name ?? right.holderType ?? "", right.department, right.category ?? ""];

  return (
    normalizeVisibleBeeperCell(leftValues[0]) === normalizeVisibleBeeperCell(rightValues[0]) &&
    leftValues.slice(1).every((value, index) => {
      const other = rightValues[index + 1];
      return !normalizeVisibleBeeperCell(value) || !normalizeVisibleBeeperCell(other) || normalizeVisibleBeeperCell(value) === normalizeVisibleBeeperCell(other);
    })
  );
};

const retainAvailableImportedBeeperDetails = (
  current: ImportedBeeperRecord,
  incoming: ImportedBeeperRecord
): ImportedBeeperRecord => ({
  ...current,
  name: normalizeVisibleBeeperCell(current.name ?? "") ? current.name : incoming.name,
  holderType: normalizeVisibleBeeperCell(current.holderType ?? "") ? current.holderType : incoming.holderType,
  department: normalizeVisibleBeeperCell(current.department) ? current.department : incoming.department,
  category: normalizeVisibleBeeperCell(current.category ?? "") ? current.category : incoming.category,
  schedule: [current.schedule, incoming.schedule].filter((value, index, values) =>
    value && values.findIndex((candidate) => normalizeVisibleBeeperCell(candidate ?? "") === normalizeVisibleBeeperCell(value)) === index
  ).join(" / ") || undefined,
  notes: [current.notes, incoming.notes].filter((value, index, values) =>
    value && values.findIndex((candidate) => normalizeVisibleBeeperCell(candidate ?? "") === normalizeVisibleBeeperCell(value)) === index
  ).join(" | ") || undefined
});

export const BeepersPage = () => {
  const { pushToast } = useToast();
  const navigate = useNavigate();
  const isCreateRoute = useMatch("/beeper/new") !== null;
  const [records, setRecords] = useState<BeeperRecord[]>([]);
  const [importedRecords, setImportedRecords] = useState<ImportedBeeperRecord[]>([]);
  const [teams, setTeams] = useState<BeeperTeam[]>([]);
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
  const [currentPage, setCurrentPage] = useState(1);
  const [showTeamManager, setShowTeamManager] = useState(false);
  const [isTeamDialogOpen, setIsTeamDialogOpen] = useState(false);
  const [teamForm, setTeamForm] = useState<EditableBeeperTeam>(emptyTeamForm());
  const [isSavingTeam, setIsSavingTeam] = useState(false);
  const [teamError, setTeamError] = useState("");
  const [teamNameError, setTeamNameError] = useState("");
  const [teamDisplayIdError, setTeamDisplayIdError] = useState("");

  const firstFieldRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const editTriggerRef = useRef<HTMLButtonElement | null>(null);
  const createTriggerRef = useRef<HTMLButtonElement | null>(null);
  const chooserHeadingRef = useRef<HTMLHeadingElement>(null);
  const teamNameRef = useRef<HTMLInputElement>(null);
  const teamDialogRef = useRef<HTMLDialogElement>(null);
  const teamDialogTriggerRef = useRef<HTMLButtonElement | null>(null);
  const deferredQuery = useDeferredValue(query);

  const loadBeepers = async () => {
    try {
      setIsLoading(true);
      setLoadError(false);
      const [primary, imported, listedTeams] = await Promise.allSettled([
        window.hospitalDirectory.listBeepers(),
        window.hospitalDirectory.listImportedBeepers(),
        window.hospitalDirectory.listBeeperTeams()
      ]);
      if (primary.status === "rejected") throw primary.reason;
      if (listedTeams.status === "rejected") {
        throw new Error("No se pudieron cargar los equipos.");
      }
      setRecords(primary.value);
      setImportedRecords(imported.status === "fulfilled" ? imported.value : []);
      setTeams(listedTeams.value);
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
        r.sourceSheet.toLowerCase().includes(q) ||
        (r.schedule ?? "").toLowerCase().includes(q) ||
        (r.notes ?? "").toLowerCase().includes(q)
    );
  }, [importedRecords, deferredQuery]);

  const teamCreateMode = isCreateRoute && showTeamManager;
  const showChooser = isCreateRoute && !showForm && !showTeamManager;
  const chooserReady = showChooser && !isLoading && !loadError;
  useEffect(() => {
    if (!chooserReady) return;
    // AppShell moves focus to <main> in an effect of its own on every route
    // change, and parent effects run after this one. Defer one frame so the
    // heading keeps focus (and Escape on the chooser works).
    const frame = requestAnimationFrame(() => chooserHeadingRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [chooserReady]);
  useFocusOnMount(teamNameRef, teamCreateMode);

  const visibleImportedRecords = useMemo(() => {
    const visibleKeys = new Set(filteredRecords.map(manualBeeperDisplayKey));
    const importedRecordsByDevice = new Map<string, ImportedBeeperRecord[]>();

    for (const record of filteredImportedRecords) {
      const deviceNumber = normalizeVisibleBeeperCell(record.deviceNumber);
      const candidates = importedRecordsByDevice.get(deviceNumber);

      if (!candidates) {
        importedRecordsByDevice.set(deviceNumber, [record]);
        continue;
      }

      const matchIndex = candidates.findIndex((candidate) => importedBeeperRowsMatch(candidate, record));
      if (matchIndex === -1) {
        candidates.push(record);
      } else {
        candidates[matchIndex] = retainAvailableImportedBeeperDetails(candidates[matchIndex], record);
      }
    }

    return Array.from(importedRecordsByDevice.values()).flat().filter((record) => {
      const key = importedBeeperDisplayKey(record);
      if (visibleKeys.has(key)) return false;
      visibleKeys.add(key);
      return true;
    });
  }, [filteredImportedRecords, filteredRecords]);

  const totalResults = filteredRecords.length + visibleImportedRecords.length;
  const totalPages = Math.max(1, Math.ceil(totalResults / RESULTS_PER_PAGE));
  const pageStart = (currentPage - 1) * RESULTS_PER_PAGE;
  const pageEnd = pageStart + RESULTS_PER_PAGE;
  const currentPageRecords = filteredRecords.slice(pageStart, pageEnd);
  const currentPageImportedRecords = visibleImportedRecords.slice(
    Math.max(0, pageStart - filteredRecords.length),
    Math.max(0, pageEnd - filteredRecords.length)
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [deferredQuery]);

  useEffect(() => {
    setCurrentPage((page) => Math.min(page, totalPages));
  }, [totalPages]);

  // Focus goes back to the control that opened a busca form. The triggers are
  // disabled while the form is open, so this has to run after the commit that
  // closes it (a requestAnimationFrame queued before that commit can fire first
  // and find the trigger still disabled). Callers set the kind; the layout
  // effect consumes it once `showForm` is false.
  const pendingFocusRef = useRef<"edit" | "create" | null>(null);
  useLayoutEffect(() => {
    if (showForm || !pendingFocusRef.current) return;
    const trigger = pendingFocusRef.current === "edit" ? editTriggerRef.current : createTriggerRef.current;
    pendingFocusRef.current = null;
    (trigger?.isConnected ? trigger : searchRef.current)?.focus();
  }, [showForm]);

  useEffect(() => {
    const dialog = teamDialogRef.current;
    if (!dialog) return;
    if (isTeamDialogOpen) {
      if (!dialog.open) dialog.showModal?.();
      return;
    }
    if (dialog.open) dialog.close();
    teamDialogTriggerRef.current?.focus();
  }, [isTeamDialogOpen]);

  useLayoutEffect(() => {
    if (!isTeamDialogOpen) return;
    teamDialogRef.current?.querySelector<HTMLButtonElement>("[data-team-dialog-close]")?.focus();
  }, [isTeamDialogOpen]);

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
    const wasEditing = Boolean(editingId || editingImportedId);
    setShowForm(false);
    setEditingId(null);
    setEditingImportedId(null);
    setFormError("");
    if (isCreateRoute) return;
    pendingFocusRef.current = wasEditing ? "edit" : "create";
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
      const wasEditing = Boolean(editingId || editingImportedId);
      setShowForm(false);
      setEditingId(null);
      setEditingImportedId(null);
      if (isCreateRoute) {
        pushToast({ type: "success", message: "Busca guardado." });
        navigate("/beeper");
      } else {
        pendingFocusRef.current = wasEditing ? "edit" : "create";
      }
    } catch (err) {
      setFormError(
        toCompactToastMessage(
          err,
          editingId || editingImportedId ? "Error al actualizar el busca." : "Error al crear el busca."
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
      pushToast({ type: "success", message: "Busca eliminado. Se creó una copia de seguridad previa." });
    } catch {
      pushToast({ type: "error", message: "Error al eliminar el busca." });
      setDeleteConfirm(null);
    } finally {
      setIsDeleting(false);
    }
  };

  const setField = <K extends keyof EditableBeeperRecord>(key: K, value: EditableBeeperRecord[K]) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
  };

  // BeepersPage serves /beeper and /beeper/new from two routes and is NOT
  // remounted when moving between them, so local state would leak across.
  // Reset open forms, confirm dialogs, team manager, page search and results page
  // on route change instead of remounting, so the data is not fetched again.
  const [lastIsCreateRoute, setLastIsCreateRoute] = useState(isCreateRoute);
  if (lastIsCreateRoute !== isCreateRoute) {
    setLastIsCreateRoute(isCreateRoute);
    setShowForm(false);
    setEditingId(null);
    setEditingImportedId(null);
    setFormError("");
    setShowTeamManager(false);
    setIsTeamDialogOpen(false);
    setDeleteConfirm(null);
    setQuery("");
    setCurrentPage(1);
    setTeamForm(emptyTeamForm());
    setTeamError("");
    setTeamNameError("");
    setTeamDisplayIdError("");
  }

  const saveTeam = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isSavingTeam) return;
    setTeamError("");
    const nameError = validateTeamField(teamForm.name, "nombre del equipo");
    const displayIdError = validateTeamField(teamForm.displayId, "número del equipo");
    setTeamNameError(nameError);
    setTeamDisplayIdError(displayIdError);
    if (nameError || displayIdError) return;

    setIsSavingTeam(true);
    try {
      const created = await window.hospitalDirectory.addBeeperTeam(teamForm);
      setTeams((current) => [...current, created]);
      pushToast({ type: "success", message: "Equipo guardado." });
      navigate("/beeper");
    } catch (err) {
      const message = toCompactToastMessage(err, "No se pudo guardar el equipo.");
      if (/número de equipo|ya está registrado/i.test(message)) setTeamDisplayIdError(message);
      else setTeamError(message);
    } finally {
      setIsSavingTeam(false);
    }
  };

  const formTitle = editingId || editingImportedId
    ? "Editar busca"
    : "Nuevo busca";

  if (isLoading) {
    return <LoadingStatus message="Cargando buscas…" busy />;
  }

  if (loadError) {
    return (
      <section aria-labelledby="beeper-page-title" className="flex flex-col gap-5">
        <div className="rounded-3xl bg-white p-4 shadow-panel sm:p-5">
          <h2 id="beeper-page-title" className="text-xl font-semibold text-scs-blueDark">
            {isCreateRoute ? "Gestión Buscas" : "Buscas"}
          </h2>
        </div>
        <StatePanel
          titleAs="h3"
          role="alert"
          title="Error al cargar"
          message="No se pudieron cargar los buscas o los equipos."
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

  const formIsPageTitle = isCreateRoute;
  const FormHeading = formIsPageTitle ? "h2" : "h3";

  const teamFormElement = (
    <form onSubmit={(event) => void saveTeam(event)} className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4" aria-label="Nuevo equipo">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="team-name" className="mb-2 block text-sm font-medium text-slate-700">Nombre del equipo <span aria-hidden="true" className="text-red-600">*</span></label>
          <input ref={teamNameRef} id="team-name" required maxLength={255} aria-invalid={teamNameError ? true : undefined} aria-describedby={joinIds(teamNameError && "team-name-error")} value={teamForm.name} onChange={(event) => { setTeamNameError(""); setTeamForm((current) => ({ ...current, name: event.target.value })); }} className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-hidden ring-scs-blue focus-visible:border-scs-blue focus-visible:ring-2" />
          {teamNameError && <p id="team-name-error" role="alert" className="mt-2 text-sm font-medium text-red-700">{teamNameError}</p>}
        </div>
        <div>
          <label htmlFor="team-display-id" className="mb-2 block text-sm font-medium text-slate-700">Número del equipo <span aria-hidden="true" className="text-red-600">*</span></label>
          <input id="team-display-id" required maxLength={255} aria-invalid={teamDisplayIdError ? true : undefined} aria-describedby={joinIds(teamDisplayIdError && "team-display-id-error")} value={teamForm.displayId} onChange={(event) => { setTeamDisplayIdError(""); setTeamForm((current) => ({ ...current, displayId: event.target.value })); }} className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-hidden ring-scs-blue focus-visible:border-scs-blue focus-visible:ring-2" />
          {teamDisplayIdError && <p id="team-display-id-error" role="alert" className="mt-2 text-sm font-medium text-red-700">{teamDisplayIdError}</p>}
        </div>
      </div>
      {teamError && <StatusBanner type="error" message={teamError} />}
      <div className="mt-4 flex flex-wrap gap-3">
        <button type="submit" disabled={isSavingTeam} className="focus-ring rounded-full bg-scs-blue px-5 py-3 text-sm font-semibold text-white transition hover:bg-scs-blueDark disabled:cursor-not-allowed disabled:opacity-60">
          {isSavingTeam ? "Guardando…" : "Guardar equipo"}
        </button>
        {teamCreateMode && (
          <button type="button" data-keyboard-cancel onClick={() => setShowTeamManager(false)} disabled={isSavingTeam} className="focus-ring rounded-full border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60">
            Cancelar
          </button>
        )}
      </div>
    </form>
  );

  return (
    <section aria-labelledby="beeper-page-title" className="flex flex-col gap-5" aria-busy={isDeleting}>
      {/* Header */}
      {!isCreateRoute && (
      <div className="rounded-3xl bg-white p-4 shadow-panel sm:p-5">
        <div className="flex flex-col gap-4">
          <h2 id="beeper-page-title" className="text-xl font-semibold text-scs-blueDark">
            Buscas
          </h2>
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div className="flex-1">
              <label htmlFor="beeper-search" className="sr-only">
                Buscar buscas
              </label>
              <input
                ref={searchRef}
                id="beeper-search"
                data-page-search
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Número, titular, departamento o rol…"
                type="search"
                title="Buscar buscas — pulsa / para enfocar"
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-hidden ring-scs-blue transition focus-visible:border-scs-blue focus-visible:bg-white focus-visible:ring-2"
              />
            </div>
          </div>
          <div>
            <button
              type="button"
              onClick={(event) => {
                teamDialogTriggerRef.current = event.currentTarget;
                setIsTeamDialogOpen(true);
              }}
              className="focus-ring rounded-full border border-scs-blue px-4 py-2 text-sm font-semibold text-scs-blue transition hover:bg-scs-mist"
            >
              Equipos
            </button>
          </div>
          <p
            role="status"
            aria-live="polite"
            aria-atomic="true"
            className="text-xs font-medium text-slate-500"
          >
            {totalResults} {totalResults === 1 ? "resultado" : "resultados"}
          </p>
        </div>
      </div>
      )}

      {showChooser && (
        <div
          className="rounded-3xl bg-white p-4 shadow-panel sm:p-5"
          onKeyDown={(event) => {
            if (event.key === "Escape") navigate("/beeper");
          }}
        >
          <h2 id="beeper-page-title" ref={chooserHeadingRef} tabIndex={-1} className="text-xl font-semibold text-scs-blueDark focus:outline-hidden">
            Gestión Buscas
          </h2>
          <p className="mt-2 text-sm text-slate-600">Elige qué quieres crear.</p>
          <div className="mt-4 flex flex-wrap gap-3">
            <button type="button" onClick={() => handleCreateNew()} className="focus-ring rounded-full bg-scs-blue px-5 py-3 text-sm font-semibold text-white transition hover:bg-scs-blueDark">
              Nuevo busca
            </button>
            <button type="button" onClick={() => setShowTeamManager(true)} className="focus-ring rounded-full border border-scs-blue px-5 py-3 text-sm font-semibold text-scs-blue transition hover:bg-scs-mist">
              Nuevo equipo
            </button>
            <button type="button" onClick={() => navigate("/beeper")} className="focus-ring rounded-full px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-100">
              Cancelar
            </button>
          </div>
        </div>
      )}

      {teamCreateMode && (
        <div className="rounded-3xl bg-white p-4 shadow-panel sm:p-5">
          <h2 id="beeper-page-title" className="text-xl font-semibold text-scs-blueDark">Nuevo equipo</h2>
          {teamFormElement}
        </div>
      )}

      {!isCreateRoute && (
        <dialog
          ref={teamDialogRef}
          hidden={!isTeamDialogOpen}
          aria-labelledby="team-dialog-title"
          onCancel={(event) => {
            event.preventDefault();
            setIsTeamDialogOpen(false);
          }}
          className="w-full max-w-lg rounded-3xl border-0 p-6 shadow-xl backdrop:bg-slate-900/50 focus:outline-hidden"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 id="team-dialog-title" className="text-xl font-semibold text-scs-ink">Equipos</h2>
            </div>
            <button type="button" data-team-dialog-close onClick={() => setIsTeamDialogOpen(false)} className="focus-ring shrink-0 rounded-full px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-100">Cerrar</button>
          </div>

          <ul role="list" aria-label="Equipos" className="mt-6 grid gap-2">
            {teams.map((team) => (
              <li key={team.id} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
                <span className="min-w-0 flex-1 font-semibold [overflow-wrap:anywhere]">{team.name}</span>
                <span className="min-w-0 [overflow-wrap:anywhere]"><span className="sr-only">Número del equipo: </span>{team.displayId}</span>
              </li>
            ))}
            {teams.length === 0 && <li className="text-sm text-slate-600">No hay equipos. Crea uno desde Gestión Buscas.</li>}
          </ul>
        </dialog>
      )}

      {/* Create / Edit Form */}
      {showForm && (
        <form
          data-keyboard-submit
          onSubmit={(e) => { if (!isSaving) void handleSubmit(e); }}
          className="rounded-3xl bg-white p-6 shadow-panel"
          aria-label={formTitle}
        >
          <FormHeading id={formIsPageTitle ? "beeper-page-title" : undefined} className={`mb-5 font-semibold text-scs-blueDark ${formIsPageTitle ? "text-xl" : "text-lg"}`}>
            {formTitle}
          </FormHeading>
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
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-hidden ring-scs-blue transition focus-visible:border-scs-blue focus-visible:bg-white focus-visible:ring-2"
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
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-hidden ring-scs-blue transition focus-visible:border-scs-blue focus-visible:bg-white focus-visible:ring-2"
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
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-hidden ring-scs-blue transition focus-visible:border-scs-blue focus-visible:bg-white focus-visible:ring-2"
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
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-hidden ring-scs-blue transition focus-visible:border-scs-blue focus-visible:bg-white focus-visible:ring-2"
              />
            </div>
          </div>
          {!editingImportedId && (
            <details
              key={editingId ?? "new"}
              open={Boolean(editingId)}
              className="mt-4 rounded-2xl border border-slate-200 bg-slate-50/60"
            >
              <summary className="focus-ring cursor-pointer rounded-2xl px-4 py-3 text-sm font-semibold text-scs-blueDark">
                Turno y grupo (opcional)
              </summary>
              <div className="grid gap-4 border-t border-slate-200 p-4 sm:grid-cols-2">
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
                    className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-hidden ring-scs-blue transition focus-visible:border-scs-blue focus-visible:bg-white focus-visible:ring-2"
                  />
                </div>
              </div>
            </details>
          )}
          <div className="mt-6 flex justify-end gap-3">
            {editingId ? (
              <button
                type="button"
                onClick={() => setDeleteConfirm({ id: editingId, deviceNumber: formData.deviceNumber })}
                disabled={isSaving}
                className="focus-ring mr-auto scroll-mb-[88px] rounded-full border border-red-300 bg-white px-5 py-3 text-sm font-semibold text-red-700 transition hover:bg-red-50 disabled:opacity-60 sm:scroll-mb-0"
              >
                Eliminar busca
              </button>
            ) : null}
            <button
              type="button"
              data-keyboard-cancel
              onClick={handleCancel}
              disabled={isSaving}
              className="focus-ring scroll-mb-[88px] rounded-full border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-60 sm:scroll-mb-0"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="focus-ring scroll-mb-[88px] rounded-full bg-scs-blue px-5 py-3 text-sm font-semibold text-white transition hover:bg-scs-blueDark disabled:opacity-60 sm:scroll-mb-0"
            >
              {isSaving ? "Guardando…" : editingId || editingImportedId ? "Guardar cambios" : "Crear busca"}
            </button>
          </div>
        </form>
      )}

      {/* Empty state */}
      {!isCreateRoute && filteredRecords.length === 0 && visibleImportedRecords.length === 0 && !showForm && (
        <StatePanel
          titleAs="h3"
          title={query.trim() ? "Sin resultados" : "Sin registros"}
          message={query.trim()
            ? "No hay buscas que coincidan con la búsqueda."
            : "No hay buscas registrados. Crea el primer busca o un equipo."}
          action={query.trim() ? undefined : (
            <Link
              to="/beeper/new"
              className="focus-ring inline-block rounded-full bg-scs-blue px-5 py-3 text-sm font-semibold text-white transition hover:bg-scs-blueDark"
            >
              Crear busca o equipo
            </Link>
          )}
        />
      )}

      {/* Records table */}
      {!isCreateRoute && (filteredRecords.length > 0 || visibleImportedRecords.length > 0) && (
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
                {currentPageRecords.map((record) => (
                  <tr key={record.id} className="border-b border-slate-100 transition hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <span className="inline-flex rounded-xl bg-scs-mist px-3 py-1.5 text-base font-bold text-scs-blueDark ring-1 ring-scs-blue/15">
                        {record.deviceNumber}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{record.role}</td>
                    <td className="px-4 py-3 text-slate-600">{record.department}</td>
                    <td className="px-4 py-3 text-slate-700">
                      <span>{titleCaseWords(record.assignedTo)}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={(event) => {
                            if (isSaving) return;
                            editTriggerRef.current = event.currentTarget;
                            handleEdit(record);
                          }}
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
                {currentPageImportedRecords.map((record) => (
                  <tr key={record.id} className="border-b border-slate-100 bg-blue-50/30 transition hover:bg-blue-50/60">
                    <td className="px-4 py-3">
                      <span className="inline-flex rounded-xl bg-scs-mist px-3 py-1.5 text-base font-bold text-scs-blueDark ring-1 ring-scs-blue/15">
                        {record.deviceNumber}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-600">{record.category ?? "—"}</td>
                    <td className="px-4 py-3 text-slate-600">{record.department}</td>
                    <td className="px-4 py-3 text-slate-700">
                      <span>{titleCaseWords(record.name ?? record.holderType ?? "—")}</span>
                      {record.schedule && <span className="mt-1 block text-xs text-slate-500">Horario: {record.schedule}</span>}
                      {record.notes && <span className="mt-1 block text-xs text-slate-500">Notas: {record.notes}</span>}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={(event) => {
                          if (isSaving) return;
                          editTriggerRef.current = event.currentTarget;
                          handleEditImported(record);
                        }}
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
          {totalPages > 1 && (
            <nav aria-label="Paginación de buscas" className="flex items-center justify-center gap-3 border-t border-slate-200 p-3">
              <button
                type="button"
                onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                disabled={currentPage === 1}
                aria-label="Página anterior"
                className="focus-ring rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-40"
              >
                Anterior
              </button>
              <span aria-current="page" aria-live="polite" className="text-sm font-medium text-slate-600">
                Página {currentPage} de {totalPages}
              </span>
              <button
                type="button"
                onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                disabled={currentPage === totalPages}
                aria-label="Página siguiente"
                className="focus-ring rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 disabled:opacity-40"
              >
                Siguiente
              </button>
            </nav>
          )}
        </div>
      )}

      <ConfirmDialog
        isOpen={deleteConfirm !== null}
        title="Confirmar eliminación"
        message={`¿Estás seguro de que quieres eliminar el busca "${deleteConfirm?.deviceNumber ?? ""}"? Esta acción no se puede deshacer.`}
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
