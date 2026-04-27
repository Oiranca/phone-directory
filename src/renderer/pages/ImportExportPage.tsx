import { useEffect, useState } from "react";
import { isRecoveryBootstrap } from "../../shared/types/contact";
import type { BackupListItem, CsvImportPreview } from "../../shared/types/contact";
import { ConfirmDialog } from "../components/feedback/ConfirmDialog";
import { useToast } from "../components/feedback/ToastRegion";
import { useAppStore } from "../store/useAppStore";

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

const toUserFacingError = (error: unknown, fallback: string) => {
  if (!(error instanceof Error)) {
    return fallback;
  }

  return error.message.replace(/^Error invoking remote method '[^']+': Error: /, "");
};

const formatDetectionConfidence = (value: CsvImportPreview["detectionConfidence"]) => {
  if (value === "high") {
    return "alta";
  }

  if (value === "medium") {
    return "media";
  }

  if (value === "low") {
    return "baja";
  }

  return "";
};

type PendingConfirmation =
  | { kind: "import-json" }
  | { kind: "import-csv"; preview: CsvImportPreview }
  | { kind: "restore-backup"; backup: BackupListItem };

export const ImportExportPage = () => {
  const { contacts, settings, initialize } = useAppStore();
  const { pushToast } = useToast();
  const [backups, setBackups] = useState<BackupListItem[]>([]);
  const [bootstrapError, setBootstrapError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isCreatingBackup, setIsCreatingBackup] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isPreparingCsvPreview, setIsPreparingCsvPreview] = useState(false);
  const [isImportingCsv, setIsImportingCsv] = useState(false);
  const [restoringBackupPath, setRestoringBackupPath] = useState("");
  const [csvPreview, setCsvPreview] = useState<CsvImportPreview | null>(null);
  const [pendingConfirmation, setPendingConfirmation] = useState<PendingConfirmation | null>(null);
  const isRestoreInProgress = restoringBackupPath !== "";
  const isMutating =
    isCreatingBackup ||
    isExporting ||
    isImporting ||
    isPreparingCsvPreview ||
    isImportingCsv ||
    isRestoreInProgress;

  const loadPageData = async () => {
    try {
      setBootstrapError("");
      setIsLoading(true);

      const bootstrapPromise = contacts && settings
        ? Promise.resolve({ contacts, settings })
        : window.hospitalDirectory.getBootstrapData();
      const [payload, backupItems] = await Promise.all([
        bootstrapPromise,
        window.hospitalDirectory.listBackups()
      ]);

      if (isRecoveryBootstrap(payload)) {
        setBootstrapError(payload.recovery.message);
        return;
      }

      if (!contacts || !settings) {
        initialize(payload);
      }

      setBackups(backupItems);
    } catch {
      setBootstrapError(
        "No se pudo cargar el estado de importación y backups. Revisa los archivos locales o restaura una copia válida."
      );
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadPageData();
  }, []);

  const refreshBackups = async () => {
    try {
      const backupItems = await window.hospitalDirectory.listBackups();
      setBackups(backupItems);
    } catch {
      pushToast({
        type: "error",
        message: "No se pudo actualizar la lista de backups. Inténtalo de nuevo."
      });
    }
  };

  const handleCreateBackup = async () => {
    try {
      setIsCreatingBackup(true);
      const backupPath = await window.hospitalDirectory.createBackup();
      await refreshBackups();
      pushToast({
        type: "success",
        message: `Backup creado en ${backupPath}.`
      });
    } catch (error) {
      pushToast({
        type: "error",
        message: error instanceof Error
          ? error.message
          : "No se pudo crear el backup manual. Inténtalo de nuevo."
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
        message: `Exportación completada en ${result.filePath}.`
      });
    } catch (error) {
      pushToast({
        type: "error",
        message: error instanceof Error
          ? error.message
          : "No se pudo exportar el dataset actual."
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
        message: `Importación completada desde ${result.importedFilePath}. Backup automático: ${result.backupPath}.`
      });
    } catch (error) {
      pushToast({
        type: "error",
        message: error instanceof Error
          ? error.message
          : "No se pudo importar el archivo JSON seleccionado."
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
      await refreshBackups();
      pushToast({
        type: "success",
        message: `Backup restaurado desde ${backup.fileName}. Copia de seguridad previa: ${result.backupPath}.`
      });
    } catch (error) {
      pushToast({
        type: "error",
        message: toUserFacingError(error, "No se pudo restaurar el backup seleccionado.")
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
          message: "Selección de archivo cancelada."
        });
        return;
      }

      setCsvPreview(preview);

      if (preview.invalidRowCount > 0) {
        pushToast({
          type: "error",
          message: "El archivo tiene filas inválidas. Corrige el origen antes de importar."
        });
        return;
      }

      pushToast({
        type: preview.warningCount > 0 ? "warning" : "success",
        message: preview.warningCount > 0
          ? `${preview.detectedFormat ? `Formato detectado: ${preview.detectedFormat}. ` : ""}Importación lista con ${preview.warningCount} advertencias. ${preview.createdCount} altas y ${preview.updatedCount} actualizaciones previstas.`
          : `${preview.detectedFormat ? `Formato detectado: ${preview.detectedFormat}. ` : ""}Importación lista: ${preview.createdCount} altas y ${preview.updatedCount} actualizaciones previstas.`
      });

      if (preview.detectionConfidence === "medium" || preview.detectionConfidence === "low") {
        pushToast({
          type: "warning",
          message: `La detección del formato tiene confianza ${formatDetectionConfidence(preview.detectionConfidence)}. Revisa la vista previa antes de importar.`
        });
      }
    } catch (error) {
      setCsvPreview(null);
      pushToast({
        type: "error",
        message: toUserFacingError(error, "No se pudo preparar la vista previa del archivo.")
      });
    } finally {
      setIsPreparingCsvPreview(false);
    }
  };

  const handleImportCsv = async (preview: CsvImportPreview) => {
    if (preview.invalidRowCount > 0) {
      return;
    }

    try {
      setIsImportingCsv(true);
      const result = await window.hospitalDirectory.importCsvDataset(preview.importToken);

      initialize({
        contacts: result.contacts,
        settings: result.settings
      });
      await refreshBackups();
      setCsvPreview(null);
      pushToast({
        type: "success",
        message: `Importación completada desde ${result.importedFilePath}. ${result.createdCount} altas, ${result.updatedCount} actualizaciones. Backup: ${result.backupPath}.`
      });
    } catch (error) {
      pushToast({
        type: "error",
        message: toUserFacingError(error, "No se pudo importar el archivo seleccionado.")
      });
    } finally {
      setIsImportingCsv(false);
    }
  };

  const handleConfirmAction = async () => {
    const confirmation = pendingConfirmation;

    if (!confirmation) {
      return;
    }

    setPendingConfirmation(null);

    if (confirmation.kind === "import-json") {
      await handleImport();
      return;
    }

    if (confirmation.kind === "import-csv") {
      await handleImportCsv(confirmation.preview);
      return;
    }

    await handleRestoreBackup(confirmation.backup);
  };

  const confirmationContent = (() => {
    if (!pendingConfirmation) {
      return null;
    }

    if (pendingConfirmation.kind === "import-json") {
      return {
        title: "Confirmar importación JSON",
        message:
          "La importación reemplaza todo el directorio actual y crea un backup automático antes de continuar. ¿Quieres seguir?",
        confirmLabel: "Importar JSON"
      };
    }

    if (pendingConfirmation.kind === "import-csv") {
      const preview = pendingConfirmation.preview;

      return {
        title: "Confirmar importación de agenda",
        message: `Se importarán ${preview.validRowCount} registros válidos desde ${preview.fileName}. ${preview.createdCount} se crearán y ${preview.updatedCount} se actualizarán.${preview.detectionConfidence === "medium" || preview.detectionConfidence === "low"
          ? ` La detección del formato tiene confianza ${formatDetectionConfidence(preview.detectionConfidence)} y debe revisarse con atención.`
          : ""} Se creará un backup automático. ¿Quieres continuar?`,
        confirmLabel: "Confirmar importación"
      };
    }

    return {
      title: "Restaurar backup",
      message: `Se restaurará ${pendingConfirmation.backup.fileName} como directorio activo y antes se creará una copia de seguridad automática del estado actual. ¿Quieres continuar?`,
      confirmLabel: "Restaurar backup"
    };
  })();

  if (bootstrapError) {
    return (
      <section className="rounded-3xl bg-white p-6 shadow-panel">
        <h2 className="text-2xl font-semibold text-scs-blueDark">Importación y backups no disponibles</h2>
        <p role="alert" className="mt-2 text-sm text-slate-600">{bootstrapError}</p>
        <button
          type="button"
          onClick={() => void loadPageData()}
          className="mt-6 rounded-full bg-scs-blue px-5 py-3 text-sm font-semibold text-white"
        >
          Reintentar
        </button>
      </section>
    );
  }

  if (isLoading || !contacts || !settings) {
    return <section role="status" aria-live="polite" aria-busy="true" className="rounded-3xl bg-white p-6 shadow-panel">Cargando importación y backups…</section>;
  }

  return (
    <section className="space-y-6">
      <div className="rounded-3xl bg-white p-6 shadow-panel">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-scs-blue">Intercambio de datos</p>
        <h2 className="mt-2 text-2xl font-semibold text-scs-blueDark sm:text-3xl">Importar y exportar datos</h2>
        <p className="mt-3 max-w-3xl text-sm text-slate-600">
          Exporta el directorio activo como JSON, o importa archivos JSON, CSV, ODS o XLSX. Las hojas se normalizan al template interno y cada importación crea un backup automático.
        </p>
      </div>

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
            <p className="text-sm font-semibold text-slate-500">Editor local</p>
            <p className="mt-2 text-sm font-medium text-slate-700">{settings.editorName || "Sin configurar"}</p>
          </div>
        </div>

        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <button
            type="button"
            onClick={() => void handleCreateBackup()}
            disabled={isMutating}
            className="rounded-3xl border border-slate-200 bg-slate-50 p-5 text-left transition hover:border-scs-blue hover:bg-white disabled:opacity-60"
          >
            <p className="text-lg font-semibold text-scs-blueDark">Crear backup</p>
            <p className="mt-2 text-sm text-slate-600">
              Genera una copia inmediata del <code>contacts.json</code> actual en la carpeta local de backups.
            </p>
            <p className="mt-4 text-sm font-semibold text-scs-blue">
              {isCreatingBackup ? "Creando…" : "Crear ahora"}
            </p>
          </button>

          <button
            type="button"
            onClick={() => void handleExport()}
            disabled={isMutating}
            className="rounded-3xl border border-slate-200 bg-slate-50 p-5 text-left transition hover:border-scs-blue hover:bg-white disabled:opacity-60"
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
            className="rounded-3xl border border-amber-200 bg-amber-50 p-5 text-left transition hover:border-amber-400 hover:bg-amber-50/80 disabled:opacity-60"
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
            type="button"
            onClick={() => void handlePreviewCsvImport()}
            disabled={isMutating}
            className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5 text-left transition hover:border-emerald-400 hover:bg-emerald-50/80 disabled:opacity-60"
          >
            <p className="text-lg font-semibold text-emerald-900">Preparar agenda</p>
            <p className="mt-2 text-sm text-emerald-900/80">
              Abre CSV, ODS, XLS o XLSX. La app normaliza al template, valida filas y prepara altas o actualizaciones.
            </p>
            <p className="mt-4 text-sm font-semibold text-emerald-900">
              {isPreparingCsvPreview ? "Analizando…" : "Seleccionar archivo"}
            </p>
          </button>
        </div>

        {csvPreview && (
          <section className="mt-6 rounded-3xl border border-emerald-200 bg-emerald-50/60 p-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-sm font-semibold uppercase tracking-[0.2em] text-emerald-700">Vista previa importación</p>
                <h3 className="mt-2 text-xl font-semibold text-emerald-950">{csvPreview.fileName}</h3>
                <p className="mt-1 text-sm text-emerald-900/80">{csvPreview.sourceFilePath}</p>
                {csvPreview.detectedFormat && (
                  <p className="mt-2 text-sm text-emerald-900/80">
                    Formato detectado: {csvPreview.detectedFormat}
                    {csvPreview.detectionConfidence
                      ? ` (confianza ${formatDetectionConfidence(csvPreview.detectionConfidence)})`
                      : ""}
                  </p>
                )}
              </div>
              <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
                <button
                  type="button"
                  onClick={() => setCsvPreview(null)}
                  disabled={isMutating}
                  className="rounded-full border border-emerald-300 px-4 py-2 text-center text-sm font-semibold text-emerald-900"
                >
                  Cerrar vista previa
                </button>
                <button
                  type="button"
                  onClick={() => setPendingConfirmation({ kind: "import-csv", preview: csvPreview })}
                  disabled={isMutating || csvPreview.invalidRowCount > 0}
                  className="rounded-full bg-emerald-700 px-4 py-2 text-center text-sm font-semibold text-white disabled:opacity-60"
                >
                  {isImportingCsv ? "Importando…" : "Confirmar importación"}
                </button>
              </div>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-2xl bg-white/80 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">Filas leídas</p>
                <p className="mt-2 text-3xl font-semibold text-emerald-950">{csvPreview.totalRowCount}</p>
              </div>
              <div className="rounded-2xl bg-white/80 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">Válidas</p>
                <p className="mt-2 text-3xl font-semibold text-emerald-950">{csvPreview.validRowCount}</p>
              </div>
              <div className="rounded-2xl bg-white/80 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">Inválidas</p>
                <p className="mt-2 text-3xl font-semibold text-emerald-950">{csvPreview.invalidRowCount}</p>
              </div>
              <div className="rounded-2xl bg-white/80 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">Advertencias</p>
                <p className="mt-2 text-3xl font-semibold text-emerald-950">{csvPreview.warningCount}</p>
              </div>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-3">
              <div className="rounded-2xl bg-white/80 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">Altas</p>
                <p className="mt-2 text-3xl font-semibold text-emerald-950">{csvPreview.createdCount}</p>
              </div>
              <div className="rounded-2xl bg-white/80 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">Actualizaciones</p>
                <p className="mt-2 text-3xl font-semibold text-emerald-950">{csvPreview.updatedCount}</p>
              </div>
              <div className="rounded-2xl bg-white/80 p-4">
                <p className="text-xs font-semibold uppercase tracking-[0.2em] text-emerald-700">Total final</p>
                <p className="mt-2 text-3xl font-semibold text-emerald-950">{csvPreview.mergedRecordCount}</p>
              </div>
            </div>

            <div className="mt-5 grid gap-4 xl:grid-cols-2">
              <div className="rounded-2xl bg-white/80 p-4">
                <p className="text-sm font-semibold text-emerald-950">Tipos detectados</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {Object.entries(csvPreview.typeCounts).length === 0 ? (
                    <span className="text-sm text-emerald-900/80">Sin registros válidos todavía.</span>
                  ) : (
                    Object.entries(csvPreview.typeCounts).map(([type, count]) => (
                      <span key={type} className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-900">
                        {type}: {count}
                      </span>
                    ))
                  )}
                </div>
              </div>

              <div className="rounded-2xl bg-white/80 p-4">
                <p className="text-sm font-semibold text-emerald-950">Áreas detectadas</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {Object.entries(csvPreview.areaCounts).length === 0 ? (
                    <span className="text-sm text-emerald-900/80">Sin áreas clasificadas en el CSV.</span>
                  ) : (
                    Object.entries(csvPreview.areaCounts).map(([area, count]) => (
                      <span key={area} className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-semibold text-emerald-900">
                        {area}: {count}
                      </span>
                    ))
                  )}
                </div>
              </div>
            </div>

            <div className="mt-5 grid gap-4 xl:grid-cols-2">
              <div className="rounded-2xl bg-white/80 p-4">
                <p className="text-sm font-semibold text-emerald-950">Filas inválidas</p>
                {csvPreview.rowIssues.length === 0 ? (
                  <p className="mt-3 text-sm text-emerald-900/80">No se detectaron filas inválidas.</p>
                ) : (
                  <div className="mt-3 space-y-3">
                    {csvPreview.rowIssues.slice(0, 5).map((issue) => (
                      <article key={`issue-${issue.rowNumber}`} className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                        <p className="font-semibold">
                          Fila {issue.rowNumber}
                          {issue.displayName ? ` · ${issue.displayName}` : ""}
                        </p>
                        <p className="mt-1">{issue.messages.join(" ")}</p>
                      </article>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-2xl bg-white/80 p-4">
                <p className="text-sm font-semibold text-emerald-950">Advertencias</p>
                {csvPreview.warnings.length === 0 ? (
                  <p className="mt-3 text-sm text-emerald-900/80">No se detectaron advertencias.</p>
                ) : (
                  <div className="mt-3 space-y-3">
                    {csvPreview.warnings.slice(0, 5).map((warning, index) => (
                      <article key={`warning-${warning.rowNumber}-${index}`} className="rounded-2xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                        <p className="font-semibold">
                          Fila {warning.rowNumber}
                          {warning.displayName ? ` · ${warning.displayName}` : ""}
                        </p>
                        <p className="mt-1">{warning.message}</p>
                      </article>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>
        )}
        </article>

        <aside className="rounded-3xl border border-slate-200 bg-white p-6 shadow-panel xl:sticky xl:top-6 xl:self-start">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-scs-blue">Recuperación</p>
            <h3 className="mt-2 text-2xl font-semibold text-scs-blueDark">Backups locales</h3>
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
              Todavía no hay backups locales disponibles.
            </div>
          ) : (
            backups.map((backup) => (
              <article key={backup.filePath} className="rounded-2xl border border-slate-200 p-4">
                <p className="text-sm font-semibold text-scs-blueDark">{backup.fileName}</p>
                <p className="mt-1 break-all text-xs text-slate-500">{backup.filePath}</p>
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
                  {restoringBackupPath === backup.filePath ? "Restaurando…" : "Restaurar este backup"}
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
