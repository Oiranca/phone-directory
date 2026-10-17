import { startTransition, useCallback, useEffect, useRef, useState } from "react";
import type { BackupListItem, CsvImportPreviewWithConflicts, JsonImportPreview, MergePolicy } from "../../../shared/types/contact";
import { ConfirmDialog } from "../feedback/ConfirmDialog";
import { CsvImportPreviewPanel } from "../feedback/CsvImportPreviewPanel";
import { LoadingStatus } from "../feedback/LoadingStatus";
import { useToast } from "../feedback/ToastRegion";
import { useAppStore } from "../../store/useAppStore";
import { toCompactToastMessage } from "../../utils/toastMessage";
import { useFocusOnMount } from "../../hooks/useFocusOnMount";

const formatTimestamp = (value: string) => {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Fecha no válida";
  }

  return new Intl.DateTimeFormat("es-ES", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
};

const yieldToRenderer = () => new Promise<void>((resolve) => {
  const channel = new MessageChannel();
  channel.port1.onmessage = () => {
    channel.port1.close();
    channel.port2.close();
    resolve();
  };
  channel.port2.postMessage(undefined);
});

type PendingConfirmation =
  | { kind: "import-json"; preview: JsonImportPreview }
  | { kind: "import-csv"; preview: CsvImportPreviewWithConflicts }
  | { kind: "recover-audit-log" };

/**
 * "Datos e importación" section of the Configuración page.
 *
 * This used to be the standalone "Importar/Exportar" page (see the removed
 * `ImportExportPage`). It now lives as a section inside Configuración.
 *
 * Card consolidation:
 * - "Copia de seguridad" merges the former "Crear copia de seguridad" and
 *   "Exportar JSON" actions into a single card. A later pass reduced this to a
 *   local-backup action plus a portable combined-data export.
 * - "Importar" is now a single unified entry point: one button opens exactly
 *   one native file dialog (filtered to .json/.csv/.ods/.xls/.xlsx) via
 *   window.hospitalDirectory.pickAndImportDataset(). The main process
 *   determines the picked file's extension and dispatches internally to the
 *   schema-aware JSON import (combined data, contacts, beepers, or settings) or
 *   previewCsvImport() (CSV/ODS/XLS/XLSX normalize/validate/preview)
 *   pipelines — this component renders the matching result/preview UI.
 *
 *   The JSON schema can only be identified after the file is picked, so the
 *   pre-selection confirmation explains every supported JSON outcome.
 *
 * The "Recuperación / Copias de seguridad locales" list
 * (with its "Mostrar más" bounded-list toggle) is REMOVED entirely,
 * per updated product direction: an operator only needs to know WHEN the
 * last backup happened, not browse a list. It is replaced with a single
 * "Última copia de seguridad: <fecha>" indicator, derived client-side from
 * the same listBackups() data already fetched here (no new IPC). Restoring
 * an OLD backup file is no longer a dedicated button — importing a JSON
 * backup via the unified "Importar" picker above already performs a full
 * replace, which functionally IS a restore, so that capability is preserved
 * without a separate UI entry point.
 */
export const DataManagementSection = () => {
  const { contacts, settings, initialize, isLoading: storeIsLoading, bootstrapStatus, bootstrapError, ensureBootstrapLoaded } = useAppStore();
  const { pushToast } = useToast();
  const [backups, setBackups] = useState<BackupListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreatingBackup, setIsCreatingBackup] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isRecoveringAuditLog, setIsRecoveringAuditLog] = useState(false);
  // Covers the whole pickAndImportDataset() round-trip — the native dialog is
  // open and, once a file is picked, either JSON import or CSV preview
  // generation is still running. We only find out which one after the
  // call resolves, so this single flag drives both the button label and the
  // "processing" status region below.
  const [isImporting, setIsImporting] = useState(false);
  const [isImportingCsv, setIsImportingCsv] = useState(false);
  const [csvPreview, setCsvPreview] = useState<CsvImportPreviewWithConflicts | null>(null);
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation | null>(null);
  const csvPreviewRef = useRef<CsvImportPreviewWithConflicts | null>(null);
  const jsonPreviewRef = useRef<JsonImportPreview | null>(null);
  const confirmationInFlightRef = useRef(false);
  const policyUpdateSequenceRef = useRef(0);
  const pendingPolicyUpdatesRef = useRef<{
    preview: CsvImportPreviewWithConflicts;
    operations: Array<{
      selectedIndices: ReadonlySet<number> | null;
      policy: MergePolicy;
    }>;
  } | null>(null);
  const triggerButtonRef = useRef<HTMLButtonElement>(null);
  const panelHeadingRef = useRef<HTMLHeadingElement>(null);
  const isPanelOpen = csvPreview !== null;
  // Tracks whether the initial backup list load has been requested so the
  // backups effect never issues more than one listBackups IPC call, even when
  // contacts or settings references change after the initial load. The list
  // itself is no longer rendered — this data is fetched
  // only to derive the "Última copia de seguridad" date below.
  const backupsRequestedRef = useRef(false);
  const isMutating =
    isCreatingBackup ||
    isExporting ||
    isRecoveringAuditLog ||
    isImporting ||
    isImportingCsv;

  const loadBackups = useCallback(async () => {
    try {
      setIsLoading(true);
      const backupItems = await window.hospitalDirectory.listBackups();
      setBackups(backupItems);
    } catch {
      pushToast({
        type: "error",
        message: "No se pudo cargar la lista de copias de seguridad. Inténtalo de nuevo."
      });
    } finally {
      setIsLoading(false);
    }
  }, [pushToast]);

  useEffect(() => {
    void ensureBootstrapLoaded();
  }, [ensureBootstrapLoaded]);

  useFocusOnMount(panelHeadingRef, isPanelOpen);

  useEffect(() => () => {
    if (csvPreviewRef.current) {
      void window.hospitalDirectory.cancelCsvImportPreview(csvPreviewRef.current.importToken);
    }
    if (jsonPreviewRef.current) {
      void window.hospitalDirectory.cancelJsonImport(jsonPreviewRef.current.importToken);
    }
  }, []);

  useEffect(() => {
    if (storeIsLoading) return;
    if (bootstrapStatus === "error") {
      setIsLoading(false);
      return;
    }
    if (contacts && settings && !backupsRequestedRef.current) {
      backupsRequestedRef.current = true;
      void loadBackups();
    }
  }, [storeIsLoading, bootstrapStatus, contacts, settings, loadBackups]);

  const refreshBackups = async () => {
    try {
      const backupItems = await window.hospitalDirectory.listBackups();
      setBackups(backupItems);
    } catch {
      pushToast({
        type: "error",
        message: "No se pudo actualizar la lista de copias de seguridad. Inténtalo de nuevo."
      });
    }
  };

  const handleCreateBackup = async () => {
    try {
      setIsCreatingBackup(true);
      await window.hospitalDirectory.createBackup();
      await refreshBackups();
      pushToast({
        type: "success",
        message: "Copia de seguridad creada."
      });
    } catch (error) {
      pushToast({
        type: "error",
        message: toCompactToastMessage(error, "No se pudo crear la copia de seguridad manual.")
      });
    } finally {
      setIsCreatingBackup(false);
    }
  };

  const handleExport = async () => {
    try {
      setIsExporting(true);
      const result = await window.hospitalDirectory.exportDataset();
      if (!result) return;
      const totalBeepers = result.beeperRecordCount + result.importedBeeperRecordCount;
      pushToast({
        type: "success",
        message: `Archivo exportado: ${result.recordCount} contactos y ${totalBeepers} buscas.`
      });
    } catch (error) {
      pushToast({
        type: "error",
        message: toCompactToastMessage(error, "No se pudo exportar el archivo de datos.")
      });
    } finally {
      setIsExporting(false);
    }
  };

  const handleRecoverAuditLog = async () => {
    try {
      setIsRecoveringAuditLog(true);
      await window.hospitalDirectory.recoverAuditLog();
      pushToast({
        type: "success",
        message: "Registro de auditoría restablecido."
      });
    } catch {
      pushToast({
        type: "error",
        message: "No se pudo restablecer el registro de auditoría."
      });
    } finally {
      setIsRecoveringAuditLog(false);
    }
  };

  // Single unified "Importar" entry point. Opens exactly one native
  // dialog (via pickAndImportDataset) and renders whichever existing flow
  // matches the returned `kind`: combined data, contacts, beepers, settings, or a spreadsheet
  // preview requiring a second confirmation.
  const handlePickAndImport = async () => {
    try {
      setIsImporting(true);
      setCsvPreview(null);
      const response = await window.hospitalDirectory.pickAndImportDataset();

      if (response.kind === "cancelled") {
        return;
      }

      if (response.kind === "unsupported-extension") {
        pushToast({
          type: "error",
          message: `Tipo de archivo no admitido${response.extension ? ` (.${response.extension})` : ""}. Elige una copia de seguridad o una hoja de cálculo (CSV, ODS, XLS o XLSX).`
        });
        return;
      }

      if (response.kind === "json-preview") {
        jsonPreviewRef.current = response.preview;
        setPendingConfirmation({ kind: "import-json", preview: response.preview });
        return;
      }

      // response.kind === "csv-preview" — identical post-processing to the
      // former handlePreviewCsvImport.
      const preview = response.preview;

      csvPreviewRef.current = preview;
      setCsvPreview(preview);

    } catch (error) {
      setCsvPreview(null);
      pushToast({
        type: "error",
        message: toCompactToastMessage(error, "No se pudo completar la importación del archivo seleccionado.")
      });
    } finally {
      setIsImporting(false);
    }
  };

  const handleImportJson = async (preview: JsonImportPreview) => {
    try {
      setIsImporting(true);
      const response = await window.hospitalDirectory.confirmJsonImport(preview.importToken);
      if (response.kind === "contacts-import") initialize(response.result);
      if (response.kind === "combined-import") initialize(response.result);
      if (response.kind === "settings-import") {
        if (!contacts) throw new Error("No se pudo conservar el directorio actual al importar la configuración.");
        initialize({ contacts, settings: response.settings });
      }
      await refreshBackups();
      pushToast({ type: "success", message: "Importación completada." });
    } catch (error) {
      pushToast({ type: "error", message: toCompactToastMessage(error, "No se pudo importar el archivo seleccionado.") });
    } finally {
      if (jsonPreviewRef.current?.importToken === preview.importToken) jsonPreviewRef.current = null;
      setIsImporting(false);
    }
  };

  const cancelJsonImport = (preview: JsonImportPreview) => {
    void window.hospitalDirectory.cancelJsonImport(preview.importToken);
  };

  const handleImportCsv = async (preview: CsvImportPreviewWithConflicts) => {
    // Rejected rows no longer block the import — they are skipped. The
    // only remaining hard blocker is having nothing importable at all, mirroring
    // the guard kept in AppDataService.importCsvDataset.
    const hasImportableContent = preview.validRowCount > 0 || preview.parsedBeepersCellCount > 0;

    if (!hasImportableContent) {
      pushToast({
        type: "error",
        message: "El archivo no contiene filas válidas para importar."
      });
      return;
    }

    if ((preview.conflictCount ?? 0) > 0 && !preview.policiesResolved) {
      pushToast({
        type: "error",
        message: "Resuelve todos los conflictos antes de importar."
      });
      return;
    }

    const policySelections = (preview.conflictedRecords ?? []).flatMap((conflict) =>
      conflict.selectedPolicy
        ? [{ recordIndex: conflict.recordIndex, policy: conflict.selectedPolicy }]
        : []
    );

    if (policySelections.length !== (preview.conflictedRecords ?? []).length) {
      pushToast({
        type: "error",
        message: "Resuelve todos los conflictos antes de importar."
      });
      return;
    }

    try {
      setIsImportingCsv(true);
      const result = await window.hospitalDirectory.importCsvDataset(
        preview.importToken,
        policySelections
      );

      initialize({
        contacts: result.contacts,
        settings: result.settings
      });
      await refreshBackups();
      setCsvPreview(null);
      if (result.beeperImportStatus?.status === "partial-failure") {
        pushToast({
          type: "warning",
          message: "Contactos importados; no se pudieron guardar las buscas."
        });
        return;
      }
      pushToast({
        type: "success",
        message: `Importación completada. ${result.createdCount} ${result.createdCount === 1 ? "alta" : "altas"} y ${result.updatedCount} ${result.updatedCount === 1 ? "actualización" : "actualizaciones"}.${
          result.invalidRowCount > 0
            ? ` Se ${result.invalidRowCount === 1 ? "omitió" : "omitieron"} ${result.invalidRowCount} ${result.invalidRowCount === 1 ? "fila rechazada" : "filas rechazadas"}.`
            : ""
        }`
      });
    } catch (error) {
      pushToast({
        type: "error",
        message: toCompactToastMessage(error, "No se pudo importar el archivo seleccionado.")
      });
    } finally {
      if (csvPreviewRef.current?.importToken === preview.importToken) csvPreviewRef.current = null;
      setIsImportingCsv(false);
    }
  };

  const handleConflictPoliciesChange = async (
    preview: CsvImportPreviewWithConflicts,
    recordIndices: readonly number[] | "all",
    policy: MergePolicy
  ) => {
    const sequence = ++policyUpdateSequenceRef.current;
    const selectedIndices = recordIndices === "all" ? null : new Set(recordIndices);
    const operations = pendingPolicyUpdatesRef.current?.preview === preview
      ? [...pendingPolicyUpdatesRef.current.operations, { selectedIndices, policy }]
      : [{ selectedIndices, policy }];
    pendingPolicyUpdatesRef.current = { preview, operations };
    const conflictedRecords = preview.conflictedRecords.slice();
    let previousSkippedUpdates = 0;
    let skippedUpdates = 0;
    let policiesResolved = true;

    for (let index = 0; index < conflictedRecords.length; index += 1) {
      const conflict = conflictedRecords[index]!;
      if (conflict.selectedPolicy === "skip") {
        previousSkippedUpdates += 1;
      }

      let selectedPolicy = conflict.selectedPolicy;
      for (const operation of operations) {
        if (operation.selectedIndices === null || operation.selectedIndices.has(conflict.recordIndex)) {
          selectedPolicy = operation.policy;
        }
      }
      const updatedConflict = selectedPolicy === conflict.selectedPolicy
        ? conflict
        : { ...conflict, selectedPolicy };
      conflictedRecords[index] = updatedConflict;

      if (updatedConflict.selectedPolicy === "skip") {
        skippedUpdates += 1;
      }
      if (!updatedConflict.selectedPolicy) {
        policiesResolved = false;
      }

      if ((index + 1) % 250 === 0 && index + 1 < conflictedRecords.length) {
        await yieldToRenderer();
        if (sequence !== policyUpdateSequenceRef.current) {
          return;
        }
      }
    }

    const baseUpdatedCount = preview.updatedCount + previousSkippedUpdates;
    const updatedPreview = {
      ...preview,
      updatedCount: Math.max(0, baseUpdatedCount - skippedUpdates),
      conflictedRecords,
      policiesResolved
    };

    startTransition(() => {
      setCsvPreview((current) =>
        sequence === policyUpdateSequenceRef.current && current === preview
          ? updatedPreview
          : current
      );
    });
  };

  const handleConfirmAction = async () => {
    if (confirmationInFlightRef.current) {
      return;
    }

    const confirmation = pendingConfirmation;

    if (!confirmation) {
      return;
    }

    confirmationInFlightRef.current = true;

    try {
      if (confirmation.kind === "import-json") {
        await handleImportJson(confirmation.preview);
        return;
      }

      if (confirmation.kind === "recover-audit-log") {
        await handleRecoverAuditLog();
        return;
      }

      await handleImportCsv(confirmation.preview);
    } finally {
      confirmationInFlightRef.current = false;
      setPendingConfirmation(null);
    }
  };

  const confirmationContent = (() => {
    if (!pendingConfirmation) {
      return null;
    }

    if (pendingConfirmation.kind === "import-json") {
      const preview = pendingConfirmation.preview;
      const summary = preview.detectedType === "contacts"
        ? `${preview.recordCount} contactos`
        : preview.detectedType === "combined"
          ? `${preview.recordCount} contactos y ${preview.beeperRecordCount + preview.importedBeeperRecordCount} buscas`
          : preview.detectedType === "beepers"
            ? `${preview.recordCount + preview.importedBeeperRecordCount} buscas`
            : "preferencias";
      const replacement = preview.detectedType === "contacts"
        ? preview.currentRecordCount === null ? " El directorio actual no se puede leer." : ` Reemplazará ${preview.currentRecordCount} contactos actuales.`
        : preview.detectedType === "combined"
          ? `${preview.currentRecordCount === null ? " El directorio actual no se puede leer." : ` Reemplazará ${preview.currentRecordCount} contactos actuales.`}${preview.currentBeeperRecordCount === null ? " Las buscas actuales no se pueden leer." : ` Reemplazará ${preview.currentBeeperRecordCount} buscas actuales.`}`
          : preview.detectedType === "beepers"
            ? preview.currentBeeperRecordCount === null ? " Las buscas actuales no se pueden leer." : ` Reemplazará ${preview.currentBeeperRecordCount} buscas actuales.`
            : "";
      return {
        title: "Revisar importación JSON",
        message: `${preview.fileName}: ${summary}.${replacement} Se creará una copia de seguridad antes de aplicar los cambios.`,
        confirmLabel: "Importar archivo"
      };
    }

    if (pendingConfirmation.kind === "recover-audit-log") {
      return {
        title: "Restablecer registro de auditoría",
        message: "Se reemplazará solo el registro de auditoría activo dañado por uno vacío. Las copias en cuarentena se conservarán. ¿Quieres continuar?",
        confirmLabel: "Restablecer registro"
      };
    }

    {
      const preview = pendingConfirmation.preview;

      // Show the applied conflict policies in the dialog so the
      // user sees what was chosen (not the system defaults) before confirming.
      const conflictedRecords = preview.conflictedRecords ?? [];
      const policyParts: string[] = [];
      if (conflictedRecords.length > 0) {
        const skipCount = conflictedRecords.filter((c) => c.selectedPolicy === "skip").length;
        const overwriteCount = conflictedRecords.filter((c) => c.selectedPolicy === "overwrite").length;
        const mergeCount = conflictedRecords.filter((c) => c.selectedPolicy === "merge-fields").length;
        if (skipCount > 0) policyParts.push(`${skipCount} ${skipCount === 1 ? "se omitirá" : "se omitirán"}`);
        if (overwriteCount > 0) policyParts.push(`${overwriteCount} ${overwriteCount === 1 ? "se sobrescribirá" : "se sobrescribirán"}`);
        if (mergeCount > 0) policyParts.push(`${mergeCount} ${mergeCount === 1 ? "se combinará" : "se combinarán"}`);
      }
      const policyNote = policyParts.length > 0 ? ` Conflictos: ${policyParts.join(", ")}.` : "";
      const confidenceWarning = preview.detectionConfidence === "low"
        ? " Formato incierto: revisa la vista previa."
        : "";
      const beeperReplacement = preview.incomingBeeperRecordCount > 0
        ? ` Se importarán ${preview.incomingBeeperRecordCount} ${preview.incomingBeeperRecordCount === 1 ? "busca" : "buscas"} y se reemplazarán ${preview.currentBeeperRecordCount ?? "las"} ${preview.currentBeeperRecordCount === 1 ? "busca actual" : "buscas actuales"}.`
        : "";

      return {
        title: "Confirmar importación de agenda",
        message: `Importar ${preview.fileName}.${
          preview.invalidRowCount > 0
            ? ` Se ${preview.invalidRowCount === 1 ? "omitirá" : "omitirán"} ${preview.invalidRowCount} ${preview.invalidRowCount === 1 ? "fila rechazada" : "filas rechazadas"}.`
            : ""
        }${beeperReplacement}${policyNote}${confidenceWarning} Se creará una copia de seguridad antes de importar.`,
        confirmLabel: "Confirmar importación"
      };
    }
  })();

  if (bootstrapStatus === "error") {
    return <section role="status" aria-live="polite" className="rounded-3xl bg-white p-6 shadow-panel">{bootstrapError}</section>;
  }

  if (isLoading || storeIsLoading || !contacts || !settings) {
    return (
      <LoadingStatus
        message="Cargando importación y copias de seguridad…"
        className="rounded-3xl bg-white p-6 shadow-panel"
        busy
      />
    );
  }

  // Derive the most recent backup's date client-side from
  // the same listBackups() data already fetched above — no new IPC, and no
  // list is rendered. `backups` is not guaranteed to be sorted, so take the
  // max createdAt explicitly rather than assuming index 0 is the newest.
  const lastBackupAt = backups.reduce<string | null>((latest, backup) => {
    if (!latest) {
      return backup.createdAt;
    }
    return new Date(backup.createdAt).getTime() > new Date(latest).getTime() ? backup.createdAt : latest;
  }, null);

  return (
    <section className="space-y-6">
      <div>
        <h3 className="text-xl font-semibold text-scs-blueDark">Datos e importación</h3>
        <p className="mt-2 max-w-2xl text-sm text-slate-600">
          Copias de seguridad, exportación e importación del directorio, y recuperación desde copias locales.
        </p>
      </div>
      {/* Single-column vertical stack — the import/backup
          area previously shared a two-column grid with the "Última copia de
          seguridad" indicator as a sticky sidebar, which squeezed its
          available width (and, with it, the "Filas del archivo" preview
          table below). The indicator now renders BELOW this article, at full
          width, never beside it. */}
      <div className="space-y-6">
        <article className="rounded-3xl bg-white p-6 shadow-panel">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <div className="rounded-2xl bg-slate-50 p-4">
            <p className="text-sm font-semibold text-slate-500">Registros totales en memoria</p>
            <p className="mt-2 text-3xl font-semibold text-scs-blueDark">{contacts.records.length}</p>
          </div>
          <div className="rounded-2xl bg-slate-50 p-4">
            <p className="text-sm font-semibold text-slate-500">Última actualización del directorio</p>
            <p className="mt-2 text-sm font-medium text-slate-700">{formatTimestamp(contacts.exportedAt)}</p>
          </div>
          <div className="rounded-2xl bg-slate-50 p-4">
            <p className="text-sm font-semibold text-slate-500">Responsable local</p>
            <p className="mt-2 text-sm font-medium text-slate-700">{settings.editorName || "Sin configurar"}</p>
          </div>
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          {/* "Copia de seguridad" — a single primary
              action (save to the local backups folder). The former secondary
              "Guardar la copia en otra carpeta…" link was removed entirely:
              the operator confirmed choosing another destination
              folder is never needed, so this card is now just a title, one
              description line and the single button. The underlying
              createBackup() keeps producing the local contacts-only safety copy. */}
          <div className="min-w-0 rounded-3xl border border-slate-200 bg-slate-50 p-5">
            <p className="text-lg font-semibold text-scs-blueDark">Copia de seguridad</p>
            <p className="mt-2 text-sm text-slate-600">
              Crea una copia local solo de los contactos.
            </p>
            <p className="mt-1 text-sm text-slate-600">
              Exporta contactos y buscas en un único archivo portable.
            </p>
            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => void handleCreateBackup()}
                disabled={isMutating}
                className="focus-ring w-full rounded-2xl bg-scs-blue px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 sm:w-auto"
              >
                {isCreatingBackup ? "Creando…" : "Crear copia de seguridad"}
              </button>
              <button
                type="button"
                onClick={() => void handleExport()}
                disabled={isMutating}
                className="focus-ring w-full rounded-2xl border border-scs-blue bg-white px-4 py-2 text-sm font-semibold text-scs-blue disabled:opacity-60 sm:w-auto"
              >
                {isExporting ? "Exportando…" : "Exportar archivo portable"}
              </button>
            </div>
          </div>

          {/* One picker supports typed JSON stores and spreadsheet previews. */}
          <div className="min-w-0 rounded-3xl border border-amber-200 bg-amber-50/60 p-5">
            <p className="text-lg font-semibold text-amber-900">Importar</p>
            <p className="mt-2 text-sm text-amber-900/80">
              Importa agenda, buscas o configuración. Los datos reemplazados se respaldan antes.
            </p>
            <p className="mt-1 text-xs text-amber-900/60">
              Formatos admitidos: JSON, CSV, ODS, XLS, XLSX
            </p>
            <div className="mt-4">
              <button
                ref={triggerButtonRef}
                type="button"
                onClick={() => void handlePickAndImport()}
                disabled={isMutating}
                className="focus-ring rounded-2xl border border-amber-300 bg-white px-4 py-2 text-sm font-semibold text-amber-900 transition hover:border-amber-400 disabled:opacity-60"
              >
                {isImporting ? "Importando…" : "Importar"}
              </button>
            </div>
          </div>
        </div>

        {/* Visible spinner while the file is picked and processed */}
        {isImporting && (
          <div
            role="status"
            aria-live="polite"
            className="mt-6 flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900"
          >
            <svg
              className="h-5 w-5 animate-spin text-emerald-700"
              fill="none"
              viewBox="0 0 24 24"
              aria-hidden="true"
            >
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
            </svg>
            <span>Seleccionando y analizando el archivo, por favor espera…</span>
          </div>
        )}

        {csvPreview && (
          <CsvImportPreviewPanel
            preview={csvPreview}
            isImporting={isImportingCsv}
            isMutating={isMutating}
            onConfirm={() => setPendingConfirmation({ kind: "import-csv", preview: csvPreview })}
            onPoliciesChange={(recordIndices, policy) =>
              void handleConflictPoliciesChange(csvPreview, recordIndices, policy)
            }
            onClose={() => {
              void window.hospitalDirectory.cancelCsvImportPreview(csvPreview.importToken);
              if (csvPreviewRef.current?.importToken === csvPreview.importToken) csvPreviewRef.current = null;
              setCsvPreview(null);
              triggerButtonRef.current?.focus();
            }}
            headingRef={panelHeadingRef}
          />
        )}
        </article>

        {/* Replaces the former backups list (with its
            "Mostrar más" bounded-list toggle) with a single,
            simple date indicator — an operator only needs to know WHEN
            the last backup happened, not browse a list. Restoring an old
            backup file is done via the unified "Importar" picker above
            (importing a .json backup already performs a full replace).
            Renders BELOW the import/backup article in
            the single-column stack (no longer a sticky sidebar beside it),
            so it never steals width from the article above. */}
        <aside className="rounded-3xl border border-slate-200 bg-white p-6 shadow-panel">
        <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-scs-blue">Copias locales</p>
            <h3 className="mt-2 text-2xl font-semibold text-scs-blueDark">Última copia de seguridad</h3>
          </div>
          <button
            type="button"
            onClick={() => void refreshBackups()}
            disabled={isMutating}
            className="focus-ring rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700"
          >
            Actualizar
          </button>
        </div>

        <div className="mt-6">
          {lastBackupAt === null ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-600">
              Aún no se ha creado ninguna copia de seguridad.
            </div>
          ) : (
            <p className="text-sm font-medium text-slate-700">
              Última copia de seguridad: <span>{formatTimestamp(lastBackupAt)}</span>
            </p>
          )}
          <details className="mt-6 border-t border-slate-200 pt-4">
            <summary className="focus-ring cursor-pointer rounded-2xl px-4 py-3 text-sm font-semibold text-scs-blueDark">
              Recuperación avanzada
            </summary>
            <div className="px-4 pb-4">
              <p className="text-sm text-slate-600">
                ¿Necesitas recuperar una copia de seguridad anterior? Ábrela desde el botón «Importar» de arriba: seleccionar un archivo de copia de seguridad reemplaza el directorio actual con ese contenido.
              </p>
              <div className="mt-6 border-t border-slate-200 pt-6">
                <p className="text-sm font-semibold text-scs-blueDark">Registro de auditoría</p>
                <p className="mt-2 text-sm text-slate-600">
                  Restablece un registro de auditoría activo dañado. Las copias en cuarentena se conservan.
                </p>
                <button
                  type="button"
                  onClick={() => setPendingConfirmation({ kind: "recover-audit-log" })}
                  disabled={isMutating}
                  className="focus-ring mt-4 w-full rounded-2xl border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-900 disabled:opacity-60 sm:w-auto"
                >
                  {isRecoveringAuditLog ? "Restableciendo…" : "Restablecer registro de auditoría"}
                </button>
              </div>
            </div>
          </details>
        </div>
        </aside>
      </div>

      {/* Always rendered with `isOpen` toggled (idiom A), matching the
          other ConfirmDialog call sites (BeepersPage, DeduplicatePage,
          ContactFormPage, App) instead of conditionally mounting/unmounting
          the dialog with `isOpen` hardcoded to `true`. */}
      <ConfirmDialog
        isOpen={confirmationContent !== null}
        title={confirmationContent?.title ?? ""}
        message={confirmationContent?.message ?? ""}
        confirmLabel={confirmationContent?.confirmLabel ?? "Confirmar"}
        cancelLabel="Cancelar"
        isDestructive={true}
        confirmDisabled={isMutating}
        cancelDisabled={isMutating}
        busyMessage={
          pendingConfirmation?.kind === "import-json"
            ? "Importando el archivo JSON…"
            : pendingConfirmation?.kind === "import-csv"
              ? "Importando la hoja de cálculo…"
              : pendingConfirmation?.kind === "recover-audit-log"
                ? "Restableciendo el registro de auditoría…"
                : undefined
        }
        onConfirm={() => {
          void handleConfirmAction();
        }}
        onCancel={() => {
          if (pendingConfirmation?.kind === "import-json") {
            cancelJsonImport(pendingConfirmation.preview);
            if (jsonPreviewRef.current?.importToken === pendingConfirmation.preview.importToken) jsonPreviewRef.current = null;
          }
          setPendingConfirmation(null);
        }}
      />
    </section>
  );
};
