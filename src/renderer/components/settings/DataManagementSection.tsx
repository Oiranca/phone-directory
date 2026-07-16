import { useEffect, useRef, useState } from "react";
import type { BackupListItem, CsvImportPreviewWithConflicts, MergePolicy } from "../../../shared/types/contact";
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

type PendingConfirmation =
  | { kind: "pick-import" }
  | { kind: "import-csv"; preview: CsvImportPreviewWithConflicts };

/**
 * "Datos e importación" section of the Configuración page.
 *
 * This used to be the standalone "Importar/Exportar" page (see the removed
 * `ImportExportPage`). It now lives as a section inside Configuración.
 *
 * Card consolidation:
 * - "Copia de seguridad" merges the former "Crear copia de seguridad" and
 *   "Exportar JSON" actions into a single card. A later pass reduced this to a
 *   single primary button plus a de-emphasized secondary link for saving to
 *   a different folder; a subsequent pass removed that secondary link entirely (the
 *   operator confirmed choosing another destination folder is never
 *   needed) — the card is now just a title, one description line and the
 *   single "Crear copia de seguridad" button. The underlying
 *   exportDataset() IPC mechanism is untouched; only this UI entry point
 *   into it was removed.
 * - "Importar" is now a single unified entry point: one button opens exactly
 *   one native file dialog (filtered to .json/.csv/.ods/.xls/.xlsx) via
 *   window.hospitalDirectory.pickAndImportDataset(). The main process
 *   determines the picked file's extension and dispatches internally to the
 *   existing importDataset() (JSON full-replace) or previewCsvImport()
 *   (CSV/ODS/XLS/XLSX normalize/validate/preview) pipelines — this component
 *   only renders whichever existing result/preview UI matches the returned
 *   `kind`.
 *
 *   Because the destructive JSON full-replace path can only be identified
 *   *after* the file is picked (main dispatches by extension, not before),
 *   the safety confirmation for that path is shown *before* the native
 *   dialog opens: a single generic warning covering both possible outcomes
 *   (picking a JSON replaces everything with an automatic backup; picking a
 *   spreadsheet goes through its own additional preview/confirm step below,
 *   unchanged). This preserves the original destructive-replace confirmation
 *   semantics while still allowing one unified button/dialog.
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
  // Covers the whole pickAndImportDataset() round-trip — the native dialog is
  // open and, once a file is picked, either the JSON full-replace or the CSV
  // preview generation is still running. We only find out which one after the
  // call resolves, so this single flag drives both the button label and the
  // "processing" status region below.
  const [isImporting, setIsImporting] = useState(false);
  const [isImportingCsv, setIsImportingCsv] = useState(false);
  const [csvPreview, setCsvPreview] = useState<CsvImportPreviewWithConflicts | null>(null);
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation | null>(null);
  const confirmationInFlightRef = useRef(false);
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
    isImporting ||
    isImportingCsv;

  const loadBackups = async () => {
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
  };

  useEffect(() => {
    void ensureBootstrapLoaded();
  }, []);

  useFocusOnMount(panelHeadingRef, isPanelOpen);

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
  }, [storeIsLoading, bootstrapStatus, contacts, settings]);

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

  // Single unified "Importar" entry point. Opens exactly one native
  // dialog (via pickAndImportDataset) and renders whichever existing flow
  // matches the returned `kind` — the JSON full-replace result handling
  // (previously handleImport) or the CSV preview handling (previously
  // handlePreviewCsvImport), both reused verbatim below.
  const handlePickAndImport = async () => {
    try {
      setIsImporting(true);
      setCsvPreview(null);
      const response = await window.hospitalDirectory.pickAndImportDataset();

      if (response.kind === "cancelled") {
        pushToast({
          type: "warning",
          message: "Selección cancelada."
        });
        return;
      }

      if (response.kind === "unsupported-extension") {
        pushToast({
          type: "error",
          message: `Tipo de archivo no admitido${response.extension ? ` (.${response.extension})` : ""}. Elige una copia de seguridad o una hoja de cálculo (CSV, ODS, XLS o XLSX).`
        });
        return;
      }

      if (response.kind === "json-import") {
        const result = response.result;

        initialize({
          contacts: result.contacts,
          settings: result.settings
        });
        await refreshBackups();
        pushToast({
          type: "success",
          message: "Importación completada."
        });
        return;
      }

      // response.kind === "csv-preview" — identical post-processing to the
      // former handlePreviewCsvImport.
      const preview = response.preview;

      setCsvPreview(preview);

      // Nothing importable at all is still blocked (no valid contact
      // rows and no buscas content) — everything else is a partial import.
      const hasImportableContent = preview.validRowCount > 0 || preview.parsedBuscasCellCount > 0;

      if (preview.invalidRowCount > 0 && !hasImportableContent) {
        pushToast({
          type: "error",
          message: "El archivo no contiene filas válidas para importar. Corrige el origen antes de importar."
        });
        return;
      }

      // Single toast per action; gate "Todo listo" when conflicts exist.
      // Confidence note shown in panel — toast covers status/count only.
      const unresolvedCount = preview.conflictCount ?? 0;

      // A partial import (some rows skipped, rest still importable) takes
      // priority over the conflict/success messaging below — it is the most
      // surprising outcome for the operator, so it gets its own single toast.
      if (preview.invalidRowCount > 0) {
        pushToast({
          type: "warning",
          message: `${preview.invalidRowCount} ${preview.invalidRowCount === 1 ? "fila será omitida" : "filas serán omitidas"} al importar. ${preview.createdCount} altas y ${preview.updatedCount} actualizaciones previstas para las filas válidas.`
        });
      } else if (unresolvedCount > 0) {
        // Item 10: "Todo listo" is contradictory when conflicts still need resolving.
        pushToast({
          type: "warning",
          message: `${unresolvedCount === 1
            ? "Hay 1 registro que ya existe en la agenda"
            : `Hay ${unresolvedCount} registros que ya existen en la agenda`}. Para cada uno elige qué hacer antes de continuar.`
        });
      } else {
        // Item 9: clean status/count toast — confidence note shown in panel.
        pushToast({
          type: preview.warningCount > 0 ? "warning" : "success",
          message: preview.warningCount > 0
            ? `Todo listo (con ${preview.warningCount} ${preview.warningCount === 1 ? "advertencia" : "advertencias"}): ${preview.createdCount} ${preview.createdCount === 1 ? "nuevo" : "nuevos"} y ${preview.updatedCount} ${preview.updatedCount === 1 ? "actualización" : "actualizaciones"}.`
            : `Todo listo: ${preview.createdCount} ${preview.createdCount === 1 ? "nuevo" : "nuevos"} y ${preview.updatedCount} ${preview.updatedCount === 1 ? "actualización" : "actualizaciones"}.`
        });
      }
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

  const handleImportCsv = async (preview: CsvImportPreviewWithConflicts) => {
    // Rejected rows no longer block the import — they are skipped. The
    // only remaining hard blocker is having nothing importable at all, mirroring
    // the guard kept in AppDataService.importCsvDataset.
    const hasImportableContent = preview.validRowCount > 0 || preview.parsedBuscasCellCount > 0;

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
      setIsImportingCsv(false);
    }
  };

  const handleConflictPolicyChange = (recordIndex: number, policy: MergePolicy) => {
    setCsvPreview((current) => {
      if (!current) {
        return current;
      }

      const previousSkippedUpdates = current.conflictedRecords.filter((conflict) => conflict.selectedPolicy === "skip").length;
      const conflictedRecords = current.conflictedRecords.map((conflict) =>
        conflict.recordIndex === recordIndex
          ? { ...conflict, selectedPolicy: policy }
          : conflict
      );
      const skippedUpdates = conflictedRecords.filter((conflict) => conflict.selectedPolicy === "skip").length;
      const baseUpdatedCount = current.updatedCount + previousSkippedUpdates;

      return {
        ...current,
        updatedCount: Math.max(0, baseUpdatedCount - skippedUpdates),
        conflictedRecords,
        policiesResolved: conflictedRecords.every((conflict) => conflict.selectedPolicy)
      };
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
    setPendingConfirmation(null);

    try {
      if (confirmation.kind === "pick-import") {
        await handlePickAndImport();
        return;
      }

      await handleImportCsv(confirmation.preview);
    } finally {
      confirmationInFlightRef.current = false;
    }
  };

  const confirmationContent = (() => {
    if (!pendingConfirmation) {
      return null;
    }

    if (pendingConfirmation.kind === "pick-import") {
      return {
        title: "Seleccionar archivo para importar",
        message:
          "Vas a elegir un archivo para importar. Si eliges una copia de seguridad completa, se reemplazarán los datos actuales del directorio (se creará una copia de seguridad automática antes de continuar). Si eliges una hoja de cálculo (CSV, ODS, XLS o XLSX), primero verás una vista previa para revisar y confirmar los cambios. ¿Deseas continuar y elegir un archivo?",
        confirmLabel: "Elegir archivo"
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
      const confidenceWarning = preview.detectionConfidence === "medium" || preview.detectionConfidence === "low"
        ? ` La detección del formato tiene confianza ${preview.detectionConfidence === "medium" ? "media" : "baja"} y debe revisarse con atención.`
        : "";

      return {
        title: "Confirmar importación de agenda",
        message: `${preview.validRowCount === 1 ? "Se importará" : "Se importarán"} ${preview.validRowCount} ${preview.validRowCount === 1 ? "registro válido" : "registros válidos"} desde ${preview.fileName}. ${preview.createdCount} se crearán y ${preview.updatedCount} se actualizarán.${
          preview.invalidRowCount > 0
            ? ` Se ${preview.invalidRowCount === 1 ? "omitirá" : "omitirán"} ${preview.invalidRowCount} ${preview.invalidRowCount === 1 ? "fila rechazada" : "filas rechazadas"}.`
            : ""
        }${policyNote}${confidenceWarning} Antes se guardará una copia de seguridad automática. ¿Quieres continuar?`,
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
            <p className="text-sm font-semibold text-slate-500">Registros activos en memoria</p>
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
              exportDataset()/createBackup() IPC mechanism is unchanged. */}
          <div className="rounded-3xl border border-slate-200 bg-slate-50 p-5">
            <p className="text-lg font-semibold text-scs-blueDark">Copia de seguridad</p>
            <p className="mt-2 text-sm text-slate-600">
              Genera una copia de seguridad del directorio en la carpeta local de copias de seguridad.
            </p>
            <div className="mt-4">
              <button
                type="button"
                onClick={() => void handleCreateBackup()}
                disabled={isMutating}
                className="focus-ring rounded-2xl bg-scs-blue px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
              >
                {isCreatingBackup ? "Creando…" : "Crear copia de seguridad"}
              </button>
            </div>
          </div>

          {/* "Importar" is a single unified entry point. One
              button opens exactly one native dialog (json/csv/ods/xls/xlsx
              filter) via pickAndImportDataset(); main dispatches by extension
              to the existing JSON full-replace or CSV preview pipelines and
              this component renders whichever existing UI matches the
              result. The card copy was shortened to two short lines (no
              "JSON" wording, no full outcome explainer). */}
          <div className="rounded-3xl border border-amber-200 bg-amber-50/60 p-5">
            <p className="text-lg font-semibold text-amber-900">Importar</p>
            <p className="mt-2 text-sm text-amber-900/80">
              Selecciona un archivo para importar. Se generará una copia de seguridad automática.
            </p>
            <p className="mt-1 text-xs text-amber-900/60">
              Formatos admitidos: JSON, CSV, ODS, XLS, XLSX
            </p>
            <div className="mt-4">
              <button
                ref={triggerButtonRef}
                type="button"
                onClick={() => setPendingConfirmation({ kind: "pick-import" })}
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
            onPolicyChange={handleConflictPolicyChange}
            onClose={() => {
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
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-scs-blue">Recuperación</p>
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
          <p className="mt-3 text-xs text-slate-500">
            ¿Necesitas recuperar una copia de seguridad anterior? Ábrela desde el botón «Importar» de arriba: seleccionar un archivo de copia de seguridad reemplaza el directorio actual con ese contenido.
          </p>
        </div>
        </aside>
      </div>

      {/* Always rendered with `isOpen` toggled (idiom A), matching the
          other ConfirmDialog call sites (BuscasPage, DeduplicatePage,
          ContactFormPage, App) instead of conditionally mounting/unmounting
          the dialog with `isOpen` hardcoded to `true`. */}
      <ConfirmDialog
        isOpen={confirmationContent !== null}
        title={confirmationContent?.title ?? ""}
        message={confirmationContent?.message ?? ""}
        confirmLabel={confirmationContent?.confirmLabel ?? "Confirmar"}
        cancelLabel="Cancelar"
        isDestructive={true}
        onConfirm={() => {
          void handleConfirmAction();
        }}
        onCancel={() => setPendingConfirmation(null)}
      />
    </section>
  );
};
