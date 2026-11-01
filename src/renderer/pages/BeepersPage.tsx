import { useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link, useMatch, useNavigate } from "react-router";
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

const BeepersIcon = () => (
  <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" className="size-5 shrink-0">
    <rect x="5" y="2" width="10" height="16" rx="2" />
    <line x1="8" y1="6" x2="12" y2="6" />
    <circle cx="10" cy="13" r="1" fill="currentColor" stroke="none" />
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

const teamLabel = (team: BeeperTeam): string => `${team.name} · ${team.displayId}`;

// Read-only list of the teams a busca belongs to (one busca can be in several).
const TeamPills = ({ teams }: { teams: BeeperTeam[] | undefined }) => {
  if (!teams || teams.length === 0) return null;
  return (
    // Explicit role: Tailwind's preflight removes list-style, and Safari/VoiceOver then drops list semantics.
    <ul role="list" aria-label="Equipos" className="mt-1 flex flex-wrap gap-1">
      {teams.map((team) => (
        <li key={team.id} className="whitespace-nowrap rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
          {teamLabel(team)}
        </li>
      ))}
    </ul>
  );
};

const joinIds = (...ids: Array<string | false | undefined>): string | undefined => {
  const present = ids.filter(Boolean);
  return present.length > 0 ? present.join(" ") : undefined;
};

const TEAM_LOCK_REASON_ID = "team-lock-reason";

const memberHolder = (record: BeeperRecord | ImportedBeeperRecord): string =>
  "assignedTo" in record ? record.assignedTo : record.name ?? record.holderType ?? "Sin titular";

// Built from what the row shows (number, holder and, for imported rows, source
// sheet and row) so duplicate device numbers stay distinguishable.
const memberLabel = (record: BeeperRecord | ImportedBeeperRecord): string =>
  "sourceSheet" in record
    ? `${record.deviceNumber} · ${memberHolder(record)}, ${record.sourceSheet} fila ${record.sourceRow}`
    : `${record.deviceNumber} · ${memberHolder(record)}`;

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
  const [showTeamManager, setShowTeamManager] = useState(false);
  const [selectedTeamId, setSelectedTeamId] = useState<string | null>(null);
  const [newBeeperTeamId, setNewBeeperTeamId] = useState<string | null>(null);
  const [memberQuery, setMemberQuery] = useState("");
  const [teamForm, setTeamForm] = useState<EditableBeeperTeam>(emptyTeamForm());
  const [editingTeamId, setEditingTeamId] = useState<string | null>(null);
  const [isSavingTeam, setIsSavingTeam] = useState(false);
  const [isSavingMembers, setIsSavingMembers] = useState(false);
  const [teamError, setTeamError] = useState("");
  const [memberError, setMemberError] = useState("");
  const [memberStatus, setMemberStatus] = useState("");
  const [teamNameError, setTeamNameError] = useState("");
  const [teamDisplayIdError, setTeamDisplayIdError] = useState("");
  const [teamDeleteConfirm, setTeamDeleteConfirm] = useState<BeeperTeam | null>(null);

  const firstFieldRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const editTriggerRef = useRef<HTMLButtonElement | null>(null);
  const createTriggerRef = useRef<HTMLButtonElement | null>(null);
  const memberSearchRef = useRef<HTMLInputElement>(null);
  const chooserHeadingRef = useRef<HTMLHeadingElement>(null);
  const teamNameRef = useRef<HTMLInputElement>(null);
  const teamSelectRef = useRef<HTMLSelectElement>(null);
  const teamsHeadingRef = useRef<HTMLHeadingElement>(null);
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

  const selectedTeam = teams.find((team) => team.id === selectedTeamId) ?? null;
  const newBeeperTeam = teams.find((team) => team.id === newBeeperTeamId) ?? null;

  const teamsByBeeperId = useMemo(() => {
    const byId = new Map<string, BeeperTeam[]>();
    for (const team of teams) {
      for (const membership of memberships) {
        if (membership.teamId !== team.id) continue;
        byId.set(membership.beeperId, [...(byId.get(membership.beeperId) ?? []), team]);
      }
    }
    return byId;
  }, [memberships, teams]);

  const selectedTeamMemberIds = useMemo(() => new Set(
    selectedTeamId
      ? memberships.filter((membership) => membership.teamId === selectedTeamId).map((membership) => membership.beeperId)
      : []
  ), [memberships, selectedTeamId]);

  // On /beeper/new the page opens on a chooser (busca or team). Creating a team
  // there reuses the team form (create mode); once saved, the same route shows
  // the members panel for the new team (members mode) until "Listo".
  // Cancelling a form from the chooser returns to the chooser; saving a busca
  // from the chooser returns to /beeper.
  const teamMembersMode = isCreateRoute && showTeamManager && selectedTeam !== null;
  const teamCreateMode = isCreateRoute && showTeamManager && selectedTeam === null;
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
  useFocusOnMount(memberSearchRef, teamMembersMode);

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

  // Deleting a team unmounts the form and the "Eliminar equipo" trigger that had
  // focus. Once the delete has settled (the select is disabled while saving), move
  // focus to the team select, or to the "Equipos" heading when no team is left.
  const focusAfterTeamDeleteRef = useRef(false);
  useLayoutEffect(() => {
    if (isSavingTeam || !focusAfterTeamDeleteRef.current) return;
    focusAfterTeamDeleteRef.current = false;
    (teams.length > 0 ? teamSelectRef.current : teamsHeadingRef.current)?.focus();
  }, [isSavingTeam, teams.length]);

  const handleCreateNew = (teamId: string | null = null) => {
    setNewBeeperTeamId(teamId);
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
    const wasTeamScoped = newBeeperTeamId !== null;
    setShowForm(false);
    setEditingId(null);
    setEditingImportedId(null);
    setNewBeeperTeamId(null);
    setFormError("");
    // Cancelling the chooser's busca form shows the chooser again (its heading
    // takes focus). A team-scoped form gets its trigger button back instead.
    if (isCreateRoute && !wasTeamScoped) return;
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
        if (newBeeperTeamId) {
          setMemberError("");
          setMemberStatus("");
          const currentMemberIds = memberships
            .filter((membership) => membership.teamId === newBeeperTeamId)
            .map((membership) => membership.beeperId);
          try {
            const updated = await window.hospitalDirectory.setBeeperTeamMembers(newBeeperTeamId, [...currentMemberIds, created.id]);
            setMemberships((current) => [...current.filter((membership) => membership.teamId !== newBeeperTeamId), ...updated]);
            if (newBeeperTeam) setMemberStatus(`${created.deviceNumber} creado y añadido al equipo ${teamLabel(newBeeperTeam)}`);
          } catch (err) {
            setMemberError(`${toCompactToastMessage(err, "No se pudo añadir el busca al equipo.")} El busca se creó y puedes añadirlo desde este equipo.`);
          }
        }
      }
      const wasEditing = Boolean(editingId || editingImportedId);
      setShowForm(false);
      setEditingId(null);
      setEditingImportedId(null);
      setNewBeeperTeamId(null);
      if (isCreateRoute && !newBeeperTeamId) {
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
      // The main side drops memberships of a deleted busca; mirror it so the
      // next member update does not send a dead id.
      setMemberships((current) => current.filter((membership) => membership.beeperId !== deleteConfirm.id));
      // A message about a busca (e.g. "El busca se creó…") must not outlive it.
      setMemberError("");
      setMemberStatus("");
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

  const selectTeam = (team: BeeperTeam | null) => {
    setSelectedTeamId(team?.id ?? null);
    setEditingTeamId(team?.id ?? null);
    setTeamForm(team ? { name: team.name, displayId: team.displayId } : emptyTeamForm());
    setTeamError("");
    setTeamDisplayIdError("");
    setMemberError("");
    setMemberStatus("");
    setTeamNameError("");
    setMemberQuery("");
  };

  // BeepersPage serves /beeper and /beeper/new from two routes and is NOT
  // remounted when moving between them, so local state would leak across.
  // Reset the open forms, confirm dialogs, team manager and selected team
  // (with its member search and messages), the page search and the results page
  // on route change instead of remounting, so the data is not fetched again.
  const [lastIsCreateRoute, setLastIsCreateRoute] = useState(isCreateRoute);
  if (lastIsCreateRoute !== isCreateRoute) {
    setLastIsCreateRoute(isCreateRoute);
    setShowForm(false);
    setEditingId(null);
    setEditingImportedId(null);
    setNewBeeperTeamId(null);
    setFormError("");
    setShowTeamManager(false);
    setDeleteConfirm(null);
    setTeamDeleteConfirm(null);
    setQuery("");
    setCurrentPage(1);
    selectTeam(null);
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
      if (editingTeamId) {
        const updated = await window.hospitalDirectory.updateBeeperTeam(editingTeamId, teamForm);
        setTeams((current) => current.map((team) => team.id === updated.id ? updated : team));
      } else {
        const created = await window.hospitalDirectory.addBeeperTeam(teamForm);
        setTeams((current) => [...current, created]);
        // Only reachable from /beeper/new (/beeper only edits existing teams).
        // Selecting the new team swaps the form for the members panel in the
        // same commit, so "Guardar equipo" is never offered again.
        selectTeam(created);
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

  const setTeamMember = async (record: BeeperRecord | ImportedBeeperRecord, include: boolean) => {
    if (!selectedTeam || !membershipsLoaded || isSavingMembers) return;
    setIsSavingMembers(true);
    setMemberError("");
    setMemberStatus("");
    const nextMemberIds = new Set(selectedTeamMemberIds);
    if (include) nextMemberIds.add(record.id);
    else nextMemberIds.delete(record.id);
    try {
      const updated = await window.hospitalDirectory.setBeeperTeamMembers(selectedTeam.id, Array.from(nextMemberIds));
      setMemberships((current) => [...current.filter((membership) => membership.teamId !== selectedTeam.id), ...updated]);
      setMemberStatus(`${record.deviceNumber} ${include ? "añadido al" : "quitado del"} equipo ${teamLabel(selectedTeam)}`);
      // With an empty search the list shows members only, so the removed row's
      // button unmounts; hand focus to the search input instead of <body>.
      if (!include && !memberQuery.trim()) requestAnimationFrame(() => memberSearchRef.current?.focus());
    } catch (err) {
      setMemberError(toCompactToastMessage(err, "No se pudieron actualizar los miembros."));
    } finally {
      setIsSavingMembers(false);
    }
  };

  // Empty search lists the team's current members; a search lists any busca
  // matching it, so it can be added.
  const teamMemberRows = useMemo(() => {
    const normalizedQuery = memberQuery.trim().toLocaleLowerCase("es");
    const candidates = [...records, ...importedRecords];
    if (!normalizedQuery) return candidates.filter((record) => selectedTeamMemberIds.has(record.id));
    return candidates.filter((record) =>
      `${record.deviceNumber} ${memberHolder(record)}`.toLocaleLowerCase("es").includes(normalizedQuery)
    );
  }, [importedRecords, memberQuery, records, selectedTeamMemberIds]);
  const memberSearchActive = Boolean(memberQuery.trim());
  const memberResultStatus = !memberSearchActive
    ? ""
    : teamMemberRows.length === 0
      ? "Sin buscas que coincidan"
      : `${teamMemberRows.length} ${teamMemberRows.length === 1 ? "busca coincide" : "buscas coinciden"}`;
  const formTitle = editingId || editingImportedId
    ? "Editar busca"
    : newBeeperTeam ? `Nuevo busca en ${teamLabel(newBeeperTeam)}` : "Nuevo busca";

  const deleteTeam = async () => {
    if (!teamDeleteConfirm || isSavingTeam) return;
    setIsSavingTeam(true);
    try {
      await window.hospitalDirectory.deleteBeeperTeam(teamDeleteConfirm.id);
      setTeams((current) => current.filter((team) => team.id !== teamDeleteConfirm.id));
      setMemberships((current) => current.filter((membership) => membership.teamId !== teamDeleteConfirm.id));
      selectTeam(null);
      setTeamDeleteConfirm(null);
      focusAfterTeamDeleteRef.current = true;
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
            {isCreateRoute ? "Gestión Buscas" : "Registro de Buscas"}
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

  // The busca form titles the page when it is all there is (the chooser's busca
  // form); next to a team heading or the /beeper header it is a subsection.
  const formIsPageTitle = isCreateRoute && !teamMembersMode;
  const FormHeading = formIsPageTitle ? "h2" : "h3";

  const teamFormElement = (
    <form onSubmit={(event) => void saveTeam(event)} className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4" aria-label={editingTeamId ? "Editar equipo" : "Nuevo equipo"}>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor="team-name" className="mb-2 block text-sm font-medium text-slate-700">Nombre del equipo <span aria-hidden="true" className="text-red-600">*</span></label>
          <input ref={teamNameRef} id="team-name" required maxLength={255} disabled={showForm} aria-invalid={teamNameError ? true : undefined} aria-describedby={joinIds(teamNameError && "team-name-error", showForm && TEAM_LOCK_REASON_ID)} value={teamForm.name} onChange={(event) => { setTeamNameError(""); setTeamForm((current) => ({ ...current, name: event.target.value })); }} className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-hidden ring-scs-blue focus-visible:border-scs-blue focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-60" />
          {teamNameError && <p id="team-name-error" role="alert" className="mt-2 text-sm font-medium text-red-700">{teamNameError}</p>}
        </div>
        <div>
          <label htmlFor="team-display-id" className="mb-2 block text-sm font-medium text-slate-700">Número del equipo <span aria-hidden="true" className="text-red-600">*</span></label>
          <input id="team-display-id" required maxLength={255} disabled={showForm} aria-invalid={teamDisplayIdError ? true : undefined} aria-describedby={joinIds(teamDisplayIdError && "team-display-id-error", showForm && TEAM_LOCK_REASON_ID)} value={teamForm.displayId} onChange={(event) => { setTeamDisplayIdError(""); setTeamForm((current) => ({ ...current, displayId: event.target.value })); }} className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-hidden ring-scs-blue focus-visible:border-scs-blue focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-60" />
          {teamDisplayIdError && <p id="team-display-id-error" role="alert" className="mt-2 text-sm font-medium text-red-700">{teamDisplayIdError}</p>}
        </div>
      </div>
      {teamError && <StatusBanner type="error" message={teamError} />}
      <div className="mt-4 flex flex-wrap gap-3">
        <button type="submit" disabled={isSavingTeam || showForm} aria-describedby={showForm ? TEAM_LOCK_REASON_ID : undefined} className="focus-ring rounded-full bg-scs-blue px-5 py-3 text-sm font-semibold text-white transition hover:bg-scs-blueDark disabled:cursor-not-allowed disabled:opacity-60">
          {isSavingTeam ? "Guardando…" : "Guardar equipo"}
        </button>
        {teamCreateMode && (
          <button type="button" data-keyboard-cancel onClick={() => { setShowTeamManager(false); selectTeam(null); }} disabled={isSavingTeam} className="focus-ring rounded-full border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60">
            Cancelar
          </button>
        )}
        {editingTeamId && (
          <button type="button" onClick={() => setTeamDeleteConfirm(teams.find((team) => team.id === editingTeamId) ?? null)} disabled={isSavingTeam || isSavingMembers || showForm} aria-describedby={showForm ? TEAM_LOCK_REASON_ID : undefined} className="focus-ring rounded-full border border-red-300 bg-white px-5 py-3 text-sm font-semibold text-red-700 transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60">
            Eliminar equipo
          </button>
        )}
      </div>
    </form>
  );

  // Under the page h2 on /beeper/new the panel title is an h3; on /beeper the
  // header h2 and the Equipos h3 sit above it.
  const PanelHeading = isCreateRoute ? "h3" : "h4";
  const membersPanelElement = selectedTeam ? (
    <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4" aria-busy={isSavingMembers}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PanelHeading className="text-sm font-semibold text-scs-blueDark">Buscas del equipo</PanelHeading>
        <button type="button" aria-label={`Nuevo busca en ${teamLabel(selectedTeam)}`} aria-describedby={showForm ? TEAM_LOCK_REASON_ID : undefined} onClick={(event) => { createTriggerRef.current = event.currentTarget; handleCreateNew(selectedTeam.id); }} disabled={isSavingMembers || showForm} className="focus-ring inline-flex items-center gap-2 rounded-full border border-scs-blue px-4 py-2 text-sm font-semibold text-scs-blue transition hover:bg-scs-mist disabled:cursor-not-allowed disabled:opacity-60">
          <BeepersIcon /> Nuevo busca
        </button>
      </div>
      <div className="mt-4 grid gap-3">
        {!membershipsLoaded && <p role="alert" className="sm:col-span-2 text-sm font-medium text-red-700">No se pudieron cargar los miembros del equipo.</p>}
        {memberError && <p role="alert" className="text-sm font-medium text-red-700">{memberError}</p>}
        <p role="status" aria-live="polite" aria-atomic="true" className="min-h-5 text-sm text-slate-600">{isSavingMembers ? "Actualizando miembros…" : memberStatus}</p>
        <div>
          <label htmlFor="team-member-search" className="mb-2 block text-sm font-medium text-slate-700">Buscar busca</label>
          <input ref={memberSearchRef} id="team-member-search" type="search" value={memberQuery} onChange={(event) => setMemberQuery(event.target.value)} disabled={showForm} aria-describedby={showForm ? TEAM_LOCK_REASON_ID : undefined} placeholder="Número o titular" className="focus-ring w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm outline-hidden ring-scs-blue focus-visible:border-scs-blue focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-60" />
        </div>
        <p role="status" aria-live="polite" aria-atomic="true" className="min-h-5 text-sm text-slate-600">{memberResultStatus}</p>
        {memberSearchActive && teamMemberRows.length === 0 && (
          <div>
            <button type="button" onClick={() => { setMemberQuery(""); requestAnimationFrame(() => memberSearchRef.current?.focus()); }} disabled={showForm} aria-describedby={showForm ? TEAM_LOCK_REASON_ID : undefined} className="focus-ring rounded-full border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60">Limpiar búsqueda</button>
          </div>
        )}
        {records.length === 0 && importedRecords.length === 0 && (
          <p className="text-sm text-slate-600">No hay buscas registrados para asignar a este equipo.</p>
        )}
        {records.length + importedRecords.length > 0 && !memberSearchActive && (
          <p className="text-sm text-slate-600">
            {selectedTeamMemberIds.size === 0 ? "Este equipo aún no tiene buscas. " : ""}Busca por número o titular para añadir buscas al equipo.
          </p>
        )}
        {teamMemberRows.length > 0 && (
          <ul aria-label={memberSearchActive ? "Buscas que coinciden" : "Buscas del equipo"} className="grid gap-3">
            {teamMemberRows.map((record) => {
              const isMember = selectedTeamMemberIds.has(record.id);
              const action = isMember ? "Quitar del equipo" : "Añadir al equipo";
              return (
                <li key={record.id} className="flex min-w-0 max-w-full items-center justify-between gap-3 rounded-xl bg-white px-3 py-2 text-sm text-slate-700 ring-1 ring-slate-200">
                  <span className="min-w-0 break-words [overflow-wrap:anywhere]"><span className="font-semibold">{record.deviceNumber}</span> · {memberHolder(record)}{"sourceSheet" in record && <span className="block text-xs text-slate-500">{record.sourceSheet} · fila {record.sourceRow}</span>}</span>
                  <button type="button" aria-label={`${action} ${memberLabel(record)}`} aria-describedby={showForm ? TEAM_LOCK_REASON_ID : undefined} disabled={!membershipsLoaded || showForm} aria-disabled={isSavingMembers || undefined} onClick={() => void setTeamMember(record, !isMember)} className="focus-ring shrink-0 rounded-full border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 aria-disabled:cursor-not-allowed aria-disabled:border-slate-200 aria-disabled:text-slate-400 aria-disabled:hover:bg-transparent">
                    {action}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  ) : null;

  return (
    <section aria-labelledby="beeper-page-title" className="flex flex-col gap-5" aria-busy={isDeleting}>
      {/* Header */}
      {!isCreateRoute && (
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
            <button type="button" onClick={() => { selectTeam(null); setShowTeamManager(true); }} className="focus-ring rounded-full border border-scs-blue px-5 py-3 text-sm font-semibold text-scs-blue transition hover:bg-scs-mist">
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

      {teamMembersMode && selectedTeam && (
        <div
          role="group"
          aria-labelledby="beeper-page-title"
          className="rounded-3xl bg-white p-4 shadow-panel sm:p-5"
          onKeyDown={(event) => {
            // Nothing is unsaved here, so Escape is handled locally (not through
            // [data-keyboard-cancel], which would also swallow Ctrl/Cmd+N). Typing
            // in the search box keeps Escape, like the rest of the app.
            const target = event.target;
            if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return;
            if (event.key === "Escape" && !isSavingMembers) navigate("/beeper");
          }}
        >
          <h2 id="beeper-page-title" className="text-xl font-semibold text-scs-blueDark">Equipo {teamLabel(selectedTeam)}</h2>
          {showForm && <p id={TEAM_LOCK_REASON_ID} className="mt-2 text-sm text-slate-600">Crea o cancela el busca para seguir con el equipo.</p>}
          {membersPanelElement}
          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={() => navigate("/beeper")}
              disabled={showForm || isSavingMembers}
              aria-describedby={showForm ? TEAM_LOCK_REASON_ID : undefined}
              className="focus-ring rounded-full bg-scs-blue px-5 py-3 text-sm font-semibold text-white transition hover:bg-scs-blueDark disabled:cursor-not-allowed disabled:opacity-60"
            >
              Listo
            </button>
          </div>
        </div>
      )}

      {!isCreateRoute && (
      <section aria-labelledby="beeper-teams-title" className="rounded-3xl bg-white p-4 shadow-panel sm:p-5">
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 id="beeper-teams-title" ref={teamsHeadingRef} tabIndex={-1} className="text-lg font-semibold text-scs-blueDark focus:outline-hidden">Equipos</h3>
              <p className="mt-1 text-sm text-slate-600">Edita un equipo o administra sus buscas.</p>
            </div>
            {teams.length > 0 && <button
              type="button"
              onClick={() => {
                setShowTeamManager((current) => !current);
              }}
              disabled={isSavingTeam || isSavingMembers || showForm}
              aria-expanded={showTeamManager}
              aria-controls={showTeamManager ? "team-manager" : undefined}
              aria-describedby={showForm ? TEAM_LOCK_REASON_ID : undefined}
              className="focus-ring rounded-full border border-scs-blue px-5 py-3 text-sm font-semibold text-scs-blue transition hover:bg-scs-mist disabled:cursor-not-allowed disabled:opacity-60"
            >
              Gestionar equipos
            </button>}
          </div>
          {teams.length === 0 && <p className="text-sm text-slate-600">Todavía no hay equipos. Crea uno desde «<Link to="/beeper/new" className="focus-ring rounded font-semibold text-scs-blue underline">Gestión Buscas</Link>».</p>}
          {showForm && <p id={TEAM_LOCK_REASON_ID} className="text-sm text-slate-600">{editingId || editingImportedId ? "Guarda" : "Crea"} o cancela el busca para editar el equipo.</p>}
        </div>

        {showTeamManager && teams.length > 0 && <div id="team-manager">
        <div className="mt-4">
          <label htmlFor="team-select" className="mb-2 block text-sm font-medium text-slate-700">Equipo a gestionar</label>
          <select ref={teamSelectRef} id="team-select" disabled={isSavingTeam || isSavingMembers || showForm} aria-describedby={showForm ? TEAM_LOCK_REASON_ID : undefined} value={selectedTeamId ?? ""} onChange={(event) => selectTeam(teams.find((team) => team.id === event.target.value) ?? null)} className="focus-ring w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-700 outline-hidden ring-scs-blue focus-visible:border-scs-blue focus-visible:ring-2 disabled:cursor-not-allowed disabled:opacity-60">
            <option value="">Elige un equipo</option>
            {teams.map((team) => <option key={team.id} value={team.id}>{team.name} · {team.displayId}</option>)}
          </select>
        </div>

        {selectedTeam && teamFormElement}

        {membersPanelElement}
        </div>}
      </section>
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
                      <span>{record.assignedTo}</span>
                      <TeamPills teams={teamsByBeeperId.get(record.id)} />
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
                      <span>{record.name ?? record.holderType ?? "—"}</span>
                      <TeamPills teams={teamsByBeeperId.get(record.id)} />
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
      <ConfirmDialog
        isOpen={teamDeleteConfirm !== null}
        title="Confirmar eliminación del equipo"
        message={`¿Quieres eliminar el equipo "${teamDeleteConfirm?.name ?? ""}"? Los buscas seguirán disponibles de forma individual.`}
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
