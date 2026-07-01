import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { BackupListItem, CsvImportPreviewWithConflicts, MergePolicy } from "../../shared/types/contact";
import { ConfirmDialog } from "../components/feedback/ConfirmDialog";
import { CsvImportPreviewPanel } from "../components/feedback/CsvImportPreviewPanel";
import { PathDisplay } from "../components/feedback/PathDisplay";
import { useToast } from "../components/feedback/ToastRegion";
import { useAppStore } from "../store/useAppStore";
import { toCompactToastMessage } from "../utils/toastMessage";

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

const formatSize = (sizeBytes: number) => {
  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }

  if (sizeBytes < 1024 * 1024) {
    return `${(sizeBytes / 1024).toFixed(1)} KB`;
  }

  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
};

type PendingConfirmation =
  | { kind: "import-json" }
  | { kind: "import-csv"; preview: CsvImportPreviewWithConflicts }
  | { kind: "restore-backup"; backup: BackupListItem };

export const ImportExportPage = () => {
  const { contacts, settings, initialize, isLoading: storeIsLoading, bootstrapStatus, bootstrapError, ensureBootstrapLoaded } = useAppStore();
  const { pushToast } = useToast();
  const [backups, setBackups] = useState<BackupListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCreatingBackup, setIsCreatingBackup] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isPreparingCsvPreview, setIsPreparingCsvPreview] = useState(false);
  const [isImportingCsv, setIsImportingCsv] = useState(false);
  const [restoringBackupPath, setRestoringBackupPath] = useState("");
  const [csvPreview, setCsvPreview] = useState<CsvImportPreviewWithConflicts | null>(null);
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation | null>(null);
  const confirmationInFlightRef = useRef(false);
  const triggerButtonRef = useRef<HTMLButtonElement>(null);
  const panelHeadingRef = useRef<HTMLHeadingElement>(null);
  const isPanelOpen = csvPreview !== null;
  // Tracks whether the initial backup list load has been requested so the
  // backups effect never issues more than one listBackups IPC call, even when
  // contacts or settings references change after the initial load.
  const backupsRequestedRef = useRef(false);
  const isRestoreInProgress = restoringBackupPath !== "";
  const isMutating =
    isCreatingBackup ||
    isExporting ||
    isImporting ||
    isPreparingCsvPreview ||
    isImportingCsv ||
    isRestoreInProgress;

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

  useLayoutEffect(() => {
    if (isPanelOpen) {
      panelHeadingRef.current?.focus();
    }
  }, [isPanelOpen]);

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

  const handleExport = async () => {
    try {
      setIsExporting(true);
      const result = await window.hospitalDirectory.exportDataset();

      if (!result) {
        pushToast({
          type: "warning",
          message: "Exportación cancelada."
        });
        return;
      }

      pushToast({
        type: "success",
        message: "Exportación completada."
      });
    } catch (error) {
      pushToast({
        type: "error",
        message: toCompactToastMessage(error, "No se pudo exportar el directorio.")
      });
    } finally {
      setIsExporting(false);
    }
  };

  const handleImport = async () => {
    try {
      setIsImporting(true);
      const result = await window.hospitalDirectory.importDataset();

      if (!result) {
        pushToast({
          type: "warning",
          message: "Importación cancelada."
        });
        return;
      }

      initialize({
        contacts: result.contacts,
        settings: result.settings
      });
      await refreshBackups();
      pushToast({
        type: "success",
        message: "Importación completada."
      });
    } catch (error) {
      pushToast({
        type: "error",
        message: toCompactToastMessage(error, "No se pudo importar el archivo JSON.")
      });
    } finally {
      setIsImporting(false);
    }
  };

  const handleRestoreBackup = async (backup: BackupListItem) => {
    try {
      setRestoringBackupPath(backup.filePath);
      const result = await window.hospitalDirectory.restoreBackup(backup.filePath);

      initialize({
        contacts: result.contacts,
        settings: result.settings
      });
      setCsvPreview(null);
      await refreshBackups();
      pushToast({
        type: "success",
        message: "Copia de seguridad restaurada."
      });
    } catch (error) {
      pushToast({
        type: "error",
        message: toCompactToastMessage(error, "No se pudo restaurar la copia de seguridad seleccionada.")
      });
    } finally {
      setRestoringBackupPath("");
    }
  };

  const handlePreviewCsvImport = async () => {
    try {
      setIsPreparingCsvPreview(true);
      setCsvPreview(null);
      const preview = await window.hospitalDirectory.previewCsvImport();

      if (!preview) {
        pushToast({
          type: "warning",
          message: "Selección cancelada."
        });
        return;
      }

      setCsvPreview(preview);

      if (preview.invalidRowCount > 0) {
        pushToast({
          type: "error",
          message: "Algunas filas tienen errores. Corrígelas en la agenda original y vuelve a intentarlo."
        });
        return;
      }

      // OIR-182 items 9+10: single toast per action; gate "Todo listo" when conflicts exist.
      // OIR-188: confidence note shown in panel — toast covers status/count only.
      const unresolvedCount = preview.conflictCount ?? 0;

      if (unresolvedCount > 0) {
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
        message: toCompactToastMessage(error, "No se pudo preparar la vista previa del archivo.")
      });
    } finally {
      setIsPreparingCsvPreview(false);
    }
  };

  const handleImportCsv = async (preview: CsvImportPreviewWithConflicts) => {
    if (preview.invalidRowCount > 0) {
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
        message: `Importación completada. ${result.createdCount} ${result.createdCount === 1 ? "alta" : "altas"} y ${result.updatedCount} ${result.updatedCount === 1 ? "actualización" : "actualizaciones"}.`
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
      if (confirmation.kind === "import-json") {
        await handleImport();
        return;
      }

      if (confirmation.kind === "import-csv") {
        await handleImportCsv(confirmation.preview);
        return;
      }

      await handleRestoreBackup(confirmation.backup);
    } finally {
      confirmationInFlightRef.current = false;
    }
  };

  const confirmationContent = (() => {
    if (!pendingConfirmation) {
      return null;
    }

    if (pendingConfirmation.kind === "import-json") {
      return {
        title: "Confirmar importación JSON",
        message:
          "La importación reemplaza todo el directorio actual y crea una copia de seguridad automática antes de continuar. ¿Quieres seguir?",
        confirmLabel: "Importar JSON"
      };
    }

    if (pendingConfirmation.kind === "import-csv") {
      const preview = pendingConfirmation.preview;

      // OIR-182 item 8: show the applied conflict policies in the dialog so the
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
        message: `${preview.validRowCount === 1 ? "Se importará" : "Se importarán"} ${preview.validRowCount} ${preview.validRowCount === 1 ? "registro válido" : "registros válidos"} desde ${preview.fileName}. ${preview.createdCount} se crearán y ${preview.updatedCount} se actualizarán.${policyNote}${confidenceWarning} Antes se guardará una copia de seguridad automática. ¿Quieres continuar?`,
        confirmLabel: "Confirmar importación"
      };
    }

    return {
      title: "Restaurar copia de seguridad",
      message: `Se restaurará ${pendingConfirmation.backup.fileName} como directorio activo y antes se creará una copia de seguridad automática del estado actual. ¿Quieres continuar?`,
      confirmLabel: "Restaurar copia de seguridad"
    };
  })();

  if (bootstrapStatus === "error") {
    return <section role="status" aria-live="polite" className="rounded-3xl bg-white p-6 shadow-panel">{bootstrapError}</section>;
  }

  if (isLoading || storeIsLoading || !contacts || !settings) {
    return <section role="status" aria-live="polite" aria-busy="true" className="rounded-3xl bg-white p-6 shadow-panel">Cargando importación y copias de seguridad…</section>;
  }

  return (
    <section className="space-y-6">
      <h2 className="sr-only">Importar y exportar datos</h2>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(300px,0.85fr)]">
        <article className="rounded-3xl bg-white p-6 shadow-panel">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <div className="rounded-2xl bg-slate-50 p-4">
            <p className="text-sm font-semibold text-slate-500">Registros activos en memoria</p>
            <p className="mt-2 text-3xl font-semibold text-scs-blueDark">{contacts.records.length}</p>
          </div>
          <div className="rounded-2xl bg-slate-50 p-4">
            <p className="text-sm font-semibold text-slate-500">Última actualización del dataset</p>
            <p className="mt-2 text-sm font-medium text-slate-700">{formatTimestamp(contacts.exportedAt)}</p>
          </div>
          <div className="rounded-2xl bg-slate-50 p-4">
            <p className="text-sm font-semibold text-slate-500">Responsable local</p>
            <p className="mt-2 text-sm font-medium text-slate-700">{settings.editorName || "Sin configurar"}</p>
          </div>
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <button
            type="button"
            onClick={() => void handleCreateBackup()}
            disabled={isMutating}
            className="focus-ring rounded-3xl border border-slate-200 bg-slate-50 p-5 text-left transition hover:border-scs-blue hover:bg-white disabled:opacity-60"
          >
            <p className="text-lg font-semibold text-scs-blueDark">Crear copia de seguridad</p>
            <p className="mt-2 text-sm text-slate-600">
              Genera una copia inmediata del <code>contacts.json</code> actual en la carpeta local de copias de seguridad.
            </p>
            <p className="mt-4 text-sm font-semibold text-scs-blue">
              {isCreatingBackup ? "Creando…" : "Crear ahora"}
            </p>
          </button>

          <button
            type="button"
            onClick={() => void handleExport()}
            disabled={isMutating}
            className="focus-ring rounded-3xl border border-slate-200 bg-slate-50 p-5 text-left transition hover:border-scs-blue hover:bg-white disabled:opacity-60"
          >
            <p className="text-lg font-semibold text-scs-blueDark">Exportar JSON</p>
            <p className="mt-2 text-sm text-slate-600">
              Guarda una copia del directorio listo para compartir o archivar fuera de la aplicación.
            </p>
            <p className="mt-4 text-sm font-semibold text-scs-blue">
              {isExporting ? "Exportando…" : "Elegir destino"}
            </p>
          </button>

          <button
            type="button"
            onClick={() => setPendingConfirmation({ kind: "import-json" })}
            disabled={isMutating}
            className="focus-ring rounded-3xl border border-amber-200 bg-amber-50 p-5 text-left transition hover:border-amber-400 hover:bg-amber-50/80 disabled:opacity-60"
          >
            <p className="text-lg font-semibold text-amber-900">Importar JSON</p>
            <p className="mt-2 text-sm text-amber-900/80">
              Reemplaza el directorio completo por un archivo válido. Acción destructiva con backup previo.
            </p>
            <p className="mt-4 text-sm font-semibold text-amber-900">
              {isImporting ? "Importando…" : "Seleccionar archivo"}
            </p>
          </button>

          <button
            ref={triggerButtonRef}
            type="button"
            onClick={() => void handlePreviewCsvImport()}
            disabled={isMutating}
            className="focus-ring rounded-3xl border border-emerald-200 bg-emerald-50 p-5 text-left transition hover:border-emerald-400 hover:bg-emerald-50/80 disabled:opacity-60"
          >
            <p className="text-lg font-semibold text-emerald-900">Importar CSV/ODS</p>
            <p className="mt-2 text-sm text-emerald-900/80">
              Abre CSV, ODS, XLS o XLSX. La app normaliza al template, valida filas y prepara altas o actualizaciones.
            </p>
            <p className="mt-4 text-sm font-semibold text-emerald-900">
              {isPreparingCsvPreview ? "Analizando…" : "Seleccionar archivo"}
            </p>
          </button>
        </div>

        {/* OIR-182 item 1: visible spinner while the file is being analysed */}
        {isPreparingCsvPreview && (
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
            <span>Analizando el archivo, por favor espera…</span>
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

        <aside className="rounded-3xl border border-slate-200 bg-white p-6 shadow-panel xl:sticky xl:top-6 xl:self-start">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-scs-blue">Recuperación</p>
            <h3 className="mt-2 text-2xl font-semibold text-scs-blueDark">Copias de seguridad locales</h3>
          </div>
          <button
            type="button"
            onClick={() => void refreshBackups()}
            disabled={isMutating}
            className="rounded-full border border-slate-300 px-4 py-2 text-sm font-semibold text-slate-700"
          >
            Actualizar
          </button>
        </div>

        <div className="mt-6 space-y-3">
          {backups.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-sm text-slate-600">
              Aún no hay copias de seguridad locales disponibles.
            </div>
          ) : (
            backups.map((backup) => (
              <article key={backup.filePath} className="rounded-2xl border border-slate-200 p-4">
                <p className="text-sm font-semibold text-scs-blueDark">{backup.fileName}</p>
                <PathDisplay path={backup.filePath} className="mt-1 text-slate-500" textClassName="text-xs" />
                <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold text-slate-600">
                  <span className="rounded-full bg-slate-100 px-3 py-1">{formatTimestamp(backup.createdAt)}</span>
                  <span className="rounded-full bg-slate-100 px-3 py-1">{formatSize(backup.sizeBytes)}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setPendingConfirmation({ kind: "restore-backup", backup })}
                  disabled={isMutating}
                  className="mt-4 rounded-full border border-scs-blue px-4 py-2 text-sm font-semibold text-scs-blue disabled:opacity-60"
                >
                  {restoringBackupPath === backup.filePath ? "Restaurando…" : "Restaurar esta copia de seguridad"}
                </button>
              </article>
            ))
          )}
        </div>
        </aside>
      </div>

      {confirmationContent ? (
        <ConfirmDialog
          isOpen={true}
          title={confirmationContent.title}
          message={confirmationContent.message}
          confirmLabel={confirmationContent.confirmLabel}
          cancelLabel="Cancelar"
          isDestructive={true}
          onConfirm={() => {
            void handleConfirmAction();
          }}
          onCancel={() => setPendingConfirmation(null)}
        />
      ) : null}
    </section>
  );
};
