import { useEffect, useState } from "react";
import type { BackupListItem } from "../../shared/types/contact";
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

export const ImportExportPage = () => {
  const { contacts, settings, initialize } = useAppStore();
  const [backups, setBackups] = useState<BackupListItem[]>([]);
  const [bootstrapError, setBootstrapError] = useState("");
  const [actionError, setActionError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isCreatingBackup, setIsCreatingBackup] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  const loadPageData = async () => {
    try {
      setBootstrapError("");
      setActionError("");
      setIsLoading(true);

      const bootstrapPromise = contacts && settings
        ? Promise.resolve({ contacts, settings })
        : window.hospitalDirectory.getBootstrapData();
      const [payload, backupItems] = await Promise.all([
        bootstrapPromise,
        window.hospitalDirectory.listBackups()
      ]);

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
      setActionError("");
      const backupItems = await window.hospitalDirectory.listBackups();
      setBackups(backupItems);
    } catch {
      setActionError("No se pudo actualizar la lista de backups. Inténtalo de nuevo.");
    }
  };

  const handleCreateBackup = async () => {
    try {
      setIsCreatingBackup(true);
      setActionError("");
      const backupPath = await window.hospitalDirectory.createBackup();
      await refreshBackups();
      setStatusMessage(`Backup creado en ${backupPath}.`);
    } catch {
      setActionError("No se pudo crear el backup manual. Inténtalo de nuevo.");
    } finally {
      setIsCreatingBackup(false);
    }
  };

  const handleExport = async () => {
    try {
      setIsExporting(true);
      setActionError("");
      const result = await window.hospitalDirectory.exportDataset();

      if (!result) {
        setStatusMessage("Exportación cancelada.");
        return;
      }

      setStatusMessage(`Exportación completada en ${result.filePath}.`);
    } catch {
      setActionError("No se pudo exportar el dataset actual.");
    } finally {
      setIsExporting(false);
    }
  };

  const handleImport = async () => {
    const confirmed = window.confirm(
      "La importación reemplaza todo el directorio actual y crea un backup automático antes de continuar. ¿Quieres seguir?"
    );

    if (!confirmed) {
      return;
    }

    try {
      setIsImporting(true);
      setActionError("");
      const result = await window.hospitalDirectory.importDataset();

      if (!result) {
        setStatusMessage("Importación cancelada.");
        return;
      }

      initialize({
        contacts: result.contacts,
        settings: result.settings
      });
      await refreshBackups();
      setStatusMessage(
        `Importación completada desde ${result.importedFilePath}. Backup automático: ${result.backupPath}.`
      );
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "No se pudo importar el archivo JSON seleccionado."
      );
    } finally {
      setIsImporting(false);
    }
  };

  if (bootstrapError) {
    return (
      <section className="rounded-3xl bg-white p-6 shadow-panel">
        <h2 className="text-2xl font-semibold text-scs-blueDark">Importación y backups no disponibles</h2>
        <p className="mt-2 text-sm text-slate-600">{bootstrapError}</p>
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
    return <section className="rounded-3xl bg-white p-6 shadow-panel">Cargando importación y backups…</section>;
  }

  return (
    <section className="grid gap-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
      <article className="rounded-3xl bg-white p-6 shadow-panel">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-scs-blue">Intercambio de datos</p>
        <h2 className="mt-2 text-2xl font-semibold text-scs-blueDark">Importar y exportar JSON</h2>
        <p className="mt-3 max-w-3xl text-sm text-slate-600">
          Exporta el directorio activo para compartirlo, o reemplaza el dataset local con un JSON válido. La importación crea un backup automático antes de sobrescribir.
        </p>

        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <div className="rounded-2xl bg-slate-50 p-4">
            <p className="text-sm font-semibold text-slate-500">Registros activos en memoria</p>
            <p className="mt-2 text-3xl font-semibold text-scs-blueDark">{contacts.records.length}</p>
          </div>
          <div className="rounded-2xl bg-slate-50 p-4">
            <p className="text-sm font-semibold text-slate-500">Última exportación del dataset</p>
            <p className="mt-2 text-sm font-medium text-slate-700">{formatTimestamp(contacts.exportedAt)}</p>
          </div>
          <div className="rounded-2xl bg-slate-50 p-4">
            <p className="text-sm font-semibold text-slate-500">Editor local</p>
            <p className="mt-2 text-sm font-medium text-slate-700">{settings.editorName || "Sin configurar"}</p>
          </div>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-3">
          <button
            type="button"
            onClick={() => void handleCreateBackup()}
            disabled={isCreatingBackup}
            className="rounded-3xl border border-slate-200 bg-slate-50 p-5 text-left transition hover:border-scs-blue disabled:opacity-60"
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
            disabled={isExporting}
            className="rounded-3xl border border-slate-200 bg-slate-50 p-5 text-left transition hover:border-scs-blue disabled:opacity-60"
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
            onClick={() => void handleImport()}
            disabled={isImporting}
            className="rounded-3xl border border-amber-200 bg-amber-50 p-5 text-left transition hover:border-amber-400 disabled:opacity-60"
          >
            <p className="text-lg font-semibold text-amber-900">Importar JSON</p>
            <p className="mt-2 text-sm text-amber-900/80">
              Reemplaza el directorio completo por un archivo válido. Acción destructiva con backup previo.
            </p>
            <p className="mt-4 text-sm font-semibold text-amber-900">
              {isImporting ? "Importando…" : "Seleccionar archivo"}
            </p>
          </button>
        </div>

        {(statusMessage || actionError) && (
          <div
            className={[
              "mt-6 rounded-2xl px-4 py-3 text-sm font-medium",
              actionError
                ? "border border-red-200 bg-red-50 text-red-700"
                : "border border-emerald-200 bg-emerald-50 text-emerald-700"
            ].join(" ")}
          >
            {actionError || statusMessage}
          </div>
        )}
      </article>

      <aside className="rounded-3xl bg-white p-6 shadow-panel">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-scs-blue">Recuperación</p>
            <h3 className="mt-2 text-2xl font-semibold text-scs-blueDark">Backups locales</h3>
          </div>
          <button
            type="button"
            onClick={() => void refreshBackups()}
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
                <p className="mt-1 text-xs text-slate-500">{backup.filePath}</p>
                <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold text-slate-600">
                  <span className="rounded-full bg-slate-100 px-3 py-1">{formatTimestamp(backup.createdAt)}</span>
                  <span className="rounded-full bg-slate-100 px-3 py-1">{formatSize(backup.sizeBytes)}</span>
                </div>
              </article>
            ))
          )}
        </div>
      </aside>
    </section>
  );
};
