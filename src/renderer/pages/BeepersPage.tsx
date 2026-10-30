import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import type { BeeperRecord, BeeperTeam, BeeperTeamMembership, EditableBeeperRecord, EditableBeeperTeam, EditableImportedBeeperRecord, ImportedBeeperRecord } from "../../shared/schemas/beeper.schema";
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
  const [records, setRecords] = useState<BeeperRecord[]>([]);
  const [importedRecords, setImportedRecords] = useState<ImportedBeeperRecord[]>([]);
  const [teams, setTeams] = useState<BeeperTeam[]>([]);
  const [memberships, setMemberships] = useState<BeeperTeamMembership[]>([]);
  const [membershipsLoaded, setMembershipsLoaded] = useState(false);
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
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [teamForm, setTeamForm] = useState<EditableBeeperTeam>(emptyTeamForm());
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null);
  const [isSavingTeam, setIsSavingTeam] = useState(false);
  const [isSavingMembers, setIsSavingMembers] = useState(false);
  const [teamError, setTeamError] = useState("");
  const [memberError, setMemberError] = useState("");
  const [teamNameError, setTeamNameError] = useState("");
  const [teamDisplayIdError, setTeamDisplayIdError] = useState("");
  const [teamDeleteConfirm, setTeamDeleteConfirm] = useState<BeeperTeam | null>(null);

  const firstFieldRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const editTriggerRef = useRef<HTMLButtonElement | null>(null);
  const deferredQuery = useDeferredValue(query);

  const loadBeepers = async () => {
    try {
      setIsLoading(true);
      setLoadError(false);
      setMembershipsLoaded(false);
      const [primary, imported, listedTeams, listedMemberships] = await Promise.allSettled([
        window.hospitalDirectory.listBeepers(),
        window.hospitalDirectory.listImportedBeepers(),
        window.hospitalDirectory.listBeeperTeams(),
        window.hospitalDirectory.listBeeperTeamMemberships()
      ]);
      if (primary.status === "rejected") throw primary.reason;
      if (listedTeams.status === "rejected" || listedMemberships.status === "rejected") {
        throw new Error("No se pudieron cargar los equipos.");
      }
      setRecords(primary.value);
      setImportedRecords(imported.status === "fulfilled" ? imported.value : []);
      setTeams(listedTeams.value);
      setMemberships(listedMemberships.value);
      setMembershipsLoaded(true);
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

  const selectedTeamMemberIds = useMemo(() => new Set(
    selectedTeamId
      ? memberships.filter((membership) => membership.teamId === selectedTeamId).map((membership) => membership.beeperId)
      : []
  ), [memberships, selectedTeamId]);

  const teamFilteredRecords = useMemo(
    () => selectedTeamId ? filteredRecords.filter((record) => selectedTeamMemberIds.has(record.id)) : filteredRecords,
    [filteredRecords, selectedTeamId, selectedTeamMemberIds]
  );

  const teamFilteredImportedRecords = useMemo(
    () => selectedTeamId ? filteredImportedRecords.filter((record) => selectedTeamMemberIds.has(record.id)) : filteredImportedRecords,
    [filteredImportedRecords, selectedTeamId, selectedTeamMemberIds]
  );

  const visibleImportedRecords = useMemo(() => {
    const visibleKeys = new Set(teamFilteredRecords.map(manualBeeperDisplayKey));
    const importedRecordsByDevice = new Map<string, ImportedBeeperRecord[]>();

    for (const record of teamFilteredImportedRecords) {
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
  }, [teamFilteredImportedRecords, teamFilteredRecords]);

  const totalResults = teamFilteredRecords.length + visibleImportedRecords.length;
  const totalPages = Math.max(1, Math.ceil(totalResults / RESULTS_PER_PAGE));
  const pageStart = (currentPage - 1) * RESULTS_PER_PAGE;
  const pageEnd = pageStart + RESULTS_PER_PAGE;
  const currentPageRecords = teamFilteredRecords.slice(pageStart, pageEnd);
  const currentPageImportedRecords = visibleImportedRecords.slice(
    Math.max(0, pageStart - teamFilteredRecords.length),
    Math.max(0, pageEnd - teamFilteredRecords.length)
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [deferredQuery]);

  useEffect(() => {
    setCurrentPage((page) => Math.min(page, totalPages));
  }, [totalPages]);

  const restoreEditFocus = () => {
    requestAnimationFrame(() => {
      (editTriggerRef.current?.isConnected ? editTriggerRef.current : searchRef.current)?.focus();
    });
  };

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
    if (wasEditing) restoreEditFocus();
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
      if (wasEditing) restoreEditFocus();
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
      pushToast({ type: "success", message: "Busca eliminada. Se creó una copia de seguridad previa." });
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

  const selectTeam = (team: BeeperTeam | null) => {
    setSelectedTeamId(team?.id ?? null);
    setCurrentPage(1);
    setEditingTeamId(team?.id ?? null);
    setTeamForm(team ? { name: team.name, displayId: team.displayId } : emptyTeamForm());
    setTeamError("");
    setTeamDisplayIdError("");
    setMemberError("");
    setTeamNameError("");
  };

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
      if (editingTeamId) {
        const updated = await window.hospitalDirectory.updateBeeperTeam(editingTeamId, teamForm);
        setTeams((current) => current.map((team) => team.id === updated.id ? updated : team));
      } else {
        const created = await window.hospitalDirectory.addBeeperTeam(teamForm);
        setTeams((current) => [...current, created]);
        setSelectedTeamId(created.id);
        setEditingTeamId(created.id);
      }
      pushToast({ type: "success", message: "Equipo guardado." });
    } catch (err) {
      const message = toCompactToastMessage(err, "No se pudo guardar el equipo.");
      if (/número de equipo|ya está registrado/i.test(message)) setTeamDisplayIdError(message);
      else setTeamError(message);
    } finally {
      setIsSavingTeam(false);
    }
  };

  const setTeamMember = async (beeperId: string, include: boolean) => {
    if (!selectedTeamId || !membershipsLoaded || isSavingMembers) return;
    setIsSavingMembers(true);
    setMemberError("");
    const nextMemberIds = new Set(selectedTeamMemberIds);
    if (include) nextMemberIds.add(beeperId);
    else nextMemberIds.delete(beeperId);
    try {
      const updated = await window.hospitalDirectory.setBeeperTeamMembers(selectedTeamId, Array.from(nextMemberIds));
      setMemberships((current) => [...current.filter((membership) => membership.teamId !== selectedTeamId), ...updated]);
    } catch (err) {
      setMemberError(toCompactToastMessage(err, "No se pudieron actualizar los miembros."));
    } finally {
      setIsSavingMembers(false);
    }
  };

  const deleteTeam = async () => {
    if (!teamDeleteConfirm || isSavingTeam) return;
    setIsSavingTeam(true);
    try {
      await window.hospitalDirectory.deleteBeeperTeam(teamDeleteConfirm.id);
      setTeams((current) => current.filter((team) => team.id !== teamDeleteConfirm.id));
      setMemberships((current) => current.filter((membership) => membership.teamId !== teamDeleteConfirm.id));
      selectTeam(null);
      setTeamDeleteConfirm(null);
      pushToast({ type: "success", message: "Equipo eliminado." });
    } catch (err) {
      setTeamError(toCompactToastMessage(err, "No se pudo eliminar el equipo."));
      setTeamDeleteConfirm(null);
    } finally {
      setIsSavingTeam(false);
    }
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
          message="No se pudieron cargar las buscas o los equipos."
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
            {totalResults} {totalResults === 1 ? "resultado" : "resultados"}
          </p>
        </div>
      </div>

      <section aria-labelledby="beeper-teams-title" className="rounded-3xl bg-white p-4 shadow-panel sm:p-5">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 id="beeper-teams-title" className="text-lg font-semibold text-scs-blueDark">Equipos</h3>
              <p className="mt-1 text-sm text-slate-600">Filtra las buscas por equipo y administra sus miembros.</p>
            </div>
            <button
              type="button"
              onClick={() => selectTeam(null)}
              disabled={isSavingTeam}
              className="focus-ring rounded-full border border-scs-blue px-5 py-3 text-sm font-semibold text-scs-blue transition hover:bg-scs-mist disabled:opacity-60"
            >
              Nuevo equipo
            </button>
          </div>
          <div className="flex flex-wrap gap-2" aria-label="Filtro de equipos">
            <button
              type="button"
              aria-pressed={selectedTeamId === null}
              onClick={() => selectTeam(null)}
              className="focus-ring min-w-0 max-w-full break-words rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition [overflow-wrap:anywhere] aria-pressed:border-scs-blue aria-pressed:bg-scs-mist aria-pressed:text-scs-blueDark aria-pressed:ring-2 aria-pressed:ring-scs-blue"
            >
              Todas las buscas
            </button>
            {teams.map((team) => (
              <button
                key={team.id}
                type="button"
                aria-pressed={selectedTeamId === team.id}
                onClick={() => selectTeam(team)}
                className="focus-ring min-w-0 max-w-full break-words rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700 transition [overflow-wrap:anywhere] aria-pressed:border-scs-blue aria-pressed:bg-scs-mist aria-pressed:text-scs-blueDark aria-pressed:ring-2 aria-pressed:ring-scs-blue"
              >
                {team.name} · {team.displayId}
              </button>
            ))}
          </div>
        </div>

        <form onSubmit={(event) => void saveTeam(event)} className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4" aria-label={editingTeamId ? "Editar equipo" : "Nuevo equipo"}>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="team-name" className="mb-2 block text-sm font-medium text-slate-700">Nombre del equipo <span aria-hidden="true" className="text-red-600">*</span></label>
              <input id="team-name" required maxLength={255} aria-invalid={teamNameError ? true : undefined} aria-describedby={teamNameError ? "team-name-error" : undefined} value={teamForm.name} onChange={(event) => { setTeamNameError(""); setTeamForm((current) => ({ ...current, name: event.target.value })); }} className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-hidden ring-scs-blue focus-visible:border-scs-blue focus-visible:ring-2" />
              {teamNameError && <p id="team-name-error" role="alert" className="mt-2 text-sm font-medium text-red-700">{teamNameError}</p>}
            </div>
            <div>
              <label htmlFor="team-display-id" className="mb-2 block text-sm font-medium text-slate-700">Número del equipo <span aria-hidden="true" className="text-red-600">*</span></label>
              <input id="team-display-id" required maxLength={255} aria-invalid={teamDisplayIdError ? true : undefined} aria-describedby={teamDisplayIdError ? "team-display-id-error" : undefined} value={teamForm.displayId} onChange={(event) => { setTeamDisplayIdError(""); setTeamForm((current) => ({ ...current, displayId: event.target.value })); }} className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-hidden ring-scs-blue focus-visible:border-scs-blue focus-visible:ring-2" />
              {teamDisplayIdError && <p id="team-display-id-error" role="alert" className="mt-2 text-sm font-medium text-red-700">{teamDisplayIdError}</p>}
            </div>
          </div>
          {teamError && <StatusBanner type="error" message={teamError} />}
          <div className="mt-4 flex flex-wrap gap-3">
            <button type="submit" disabled={isSavingTeam} className="focus-ring rounded-full bg-scs-blue px-5 py-3 text-sm font-semibold text-white transition hover:bg-scs-blueDark disabled:opacity-60">
              {isSavingTeam ? "Guardando…" : "Guardar equipo"}
            </button>
            {editingTeamId && (
              <button type="button" onClick={() => setTeamDeleteConfirm(teams.find((team) => team.id === editingTeamId) ?? null)} disabled={isSavingTeam} className="focus-ring rounded-full border border-red-300 bg-white px-5 py-3 text-sm font-semibold text-red-700 transition hover:bg-red-50 disabled:opacity-60">
                Eliminar equipo
              </button>
            )}
          </div>
        </form>

        {selectedTeamId && (
          <details className="mt-4 rounded-2xl border border-slate-200 bg-slate-50">
            <summary className="focus-ring cursor-pointer break-words rounded-2xl px-4 py-3 text-sm font-semibold text-scs-blueDark">Miembros del equipo</summary>
            <fieldset className="grid gap-2 border-t border-slate-200 p-4 sm:grid-cols-2" aria-busy={isSavingMembers}>
              <legend className="sr-only">Buscas incluidas en el equipo</legend>
              {!membershipsLoaded && <p role="alert" className="sm:col-span-2 text-sm font-medium text-red-700">No se pudieron cargar los miembros del equipo.</p>}
              {memberError && <p role="alert" className="sm:col-span-2 text-sm font-medium text-red-700">{memberError}</p>}
              <p role="status" aria-live="polite" aria-atomic="true" className="min-h-5 sm:col-span-2 text-sm text-slate-600">{isSavingMembers ? "Actualizando miembros…" : ""}</p>
              {records.length === 0 && importedRecords.length === 0 && (
                <p className="sm:col-span-2 text-sm text-slate-600">No hay buscas registradas para asignar a este equipo.</p>
              )}
              {[...records, ...importedRecords].map((record) => (
                <label key={record.id} className="flex min-w-0 max-w-full items-center gap-3 rounded-xl bg-white px-3 py-2 text-sm text-slate-700 ring-1 ring-slate-200 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60">
                  <input type="checkbox" checked={selectedTeamMemberIds.has(record.id)} disabled={!membershipsLoaded || isSavingMembers} onChange={(event) => void setTeamMember(record.id, event.target.checked)} className="focus-ring size-5 shrink-0 rounded border-slate-400 text-scs-blue focus:ring-scs-blue disabled:cursor-not-allowed" />
                  <span className="min-w-0 break-words [overflow-wrap:anywhere]"><span className="font-semibold">{record.deviceNumber}</span> · {"assignedTo" in record ? record.assignedTo : record.name ?? record.holderType ?? "Sin titular"}</span>
                </label>
              ))}
            </fieldset>
          </details>
        )}
      </section>

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
      {teamFilteredRecords.length === 0 && visibleImportedRecords.length === 0 && !showForm && (
        <StatePanel
          title={query.trim() ? "Sin resultados" : selectedTeamId ? "Equipo sin buscas" : "Sin registros"}
          message={query.trim()
            ? "No hay buscas que coincidan con la búsqueda."
            : selectedTeamId
              ? "Este equipo no tiene buscas. Añádelas en Miembros del equipo."
              : "No hay buscas registradas. Crea el primer registro."}
        />
      )}

      {/* Records table */}
      {(teamFilteredRecords.length > 0 || visibleImportedRecords.length > 0) && (
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
                    <td className="px-4 py-3 text-slate-700">{record.assignedTo}</td>
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
                      <span>{record.name ?? record.holderType ?? "—"}</span>
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
        message={`¿Estás seguro de que quieres eliminar la busca "${deleteConfirm?.deviceNumber ?? ""}"? Esta acción no se puede deshacer.`}
        confirmLabel={isDeleting ? "Eliminando…" : "Eliminar"}
        cancelLabel="Cancelar"
        onConfirm={() => void handleDeleteConfirm()}
        onCancel={() => setDeleteConfirm(null)}
        isDestructive
        confirmDisabled={isDeleting}
        cancelDisabled={isDeleting}
      />
      <ConfirmDialog
        isOpen={teamDeleteConfirm !== null}
        title="Confirmar eliminación del equipo"
        message={`¿Quieres eliminar el equipo "${teamDeleteConfirm?.name ?? ""}"? Las buscas seguirán disponibles de forma individual.`}
        confirmLabel={isSavingTeam ? "Eliminando…" : "Eliminar equipo"}
        cancelLabel="Cancelar"
        onConfirm={() => void deleteTeam()}
        onCancel={() => setTeamDeleteConfirm(null)}
        isDestructive
        confirmDisabled={isSavingTeam}
        cancelDisabled={isSavingTeam}
      />
    </section>
  );
};
