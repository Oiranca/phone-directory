import { ChangeEvent, useEffect, useState } from "react";
import { isRecoveryBootstrap } from "../../shared/types/contact";
import { useToast } from "../components/feedback/ToastRegion";
import { useAppStore } from "../store/useAppStore";
import { toCompactToastMessage } from "../utils/toastMessage";

export const SettingsPage = () => {
  const { settings, initialize, setSettings } = useAppStore();
  const { pushToast } = useToast();
  const [editorName, setEditorName] = useState("");
  const [hasEditorDraft, setHasEditorDraft] = useState(false);
  const [dataFilePath, setDataFilePath] = useState("");
  const [backupDirectoryPath, setBackupDirectoryPath] = useState("");
  const [managedDefaults, setManagedDefaults] = useState<null | {
    dataFilePath: string;
    backupDirectoryPath: string;
  }>(null);
  const [showInactiveByDefault, setShowInactiveByDefault] = useState(false);
  const [isBrowsingDataFile, setIsBrowsingDataFile] = useState(false);
  const [isBrowsingBackupDir, setIsBrowsingBackupDir] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isResettingPaths, setIsResettingPaths] = useState(false);
  const [bootstrapError, setBootstrapError] = useState("");
  const [saveError, setSaveError] = useState("");

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
      setBootstrapError(
        "No se pudo cargar la configuración local. Revisa los archivos de datos o restaura una copia válida."
      );
    }
  };

  useEffect(() => {
    if (!settings) {
      void loadBootstrapData();
    }
  }, [settings]);

  useEffect(() => {
    if (!settings) {
      return;
    }

    setEditorName(settings.editorName);
    setHasEditorDraft(false);
    setDataFilePath(settings.dataFilePath);
    setBackupDirectoryPath(settings.backupDirectoryPath);
    setShowInactiveByDefault(settings.ui.showInactiveByDefault);
    setSaveError("");
  }, [settings]);

  useEffect(() => {
    if (!settings || managedDefaults) {
      return;
    }

    let isCancelled = false;

    void window.hospitalDirectory.getSettingsDefaults()
      .then((defaults) => {
        if (isCancelled) {
          return;
        }

        setManagedDefaults({
          dataFilePath: defaults.dataFilePath,
          backupDirectoryPath: defaults.backupDirectoryPath
        });
      })
      .catch(() => {
        // Keep the form usable even if managed defaults cannot be hydrated in the background.
      });

    return () => {
      isCancelled = true;
    };
  }, [managedDefaults, settings]);

  if (bootstrapError) {
    return (
      <section className="rounded-3xl bg-white p-6 shadow-panel">
        <h2 className="text-2xl font-semibold text-scs-blueDark">Configuración no disponible</h2>
        <p role="alert" className="mt-2 text-sm text-slate-600">{bootstrapError}</p>
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

  if (!settings) {
    return <section role="status" aria-live="polite" aria-busy="true" className="rounded-3xl bg-white p-6 shadow-panel">Cargando configuración…</section>;
  }

  const isDirty =
    (hasEditorDraft && editorName !== settings.editorName) ||
    dataFilePath !== settings.dataFilePath ||
    backupDirectoryPath !== settings.backupDirectoryPath ||
    showInactiveByDefault !== settings.ui.showInactiveByDefault;

  const handleEditorNameChange = (event: ChangeEvent<HTMLInputElement>) => {
    setEditorName(event.target.value);
    setHasEditorDraft(true);
    setSaveError("");
  };

  const handleDataFilePathChange = (event: ChangeEvent<HTMLInputElement>) => {
    setDataFilePath(event.target.value);
    setSaveError("");
  };

  const handleBackupDirectoryPathChange = (event: ChangeEvent<HTMLInputElement>) => {
    setBackupDirectoryPath(event.target.value);
    setSaveError("");
  };

  const handleShowInactiveChange = (event: ChangeEvent<HTMLInputElement>) => {
    setShowInactiveByDefault(event.target.checked);
    setSaveError("");
  };

  const handleReset = () => {
    setEditorName(settings.editorName);
    setHasEditorDraft(false);
    setDataFilePath(settings.dataFilePath);
    setBackupDirectoryPath(settings.backupDirectoryPath);
    setShowInactiveByDefault(settings.ui.showInactiveByDefault);
    setSaveError("");
  };

  const handleBrowseDataFile = async () => {
    setIsBrowsingDataFile(true);
    try {
      const picked = await window.hospitalDirectory.browseForPath('dataFile');
      if (picked) {
        setDataFilePath(picked);
        setSaveError('');
      }
    } catch (error) {
      const message = toCompactToastMessage(error, 'No se pudo abrir el selector de archivo.');
      setSaveError(message);
      pushToast({ type: 'error', message });
    } finally {
      setIsBrowsingDataFile(false);
    }
  };

  const handleBrowseBackupDir = async () => {
    setIsBrowsingBackupDir(true);
    try {
      const picked = await window.hospitalDirectory.browseForPath('backupDirectory');
      if (picked) {
        setBackupDirectoryPath(picked);
        setSaveError('');
      }
    } catch (error) {
      const message = toCompactToastMessage(error, 'No se pudo abrir el selector de carpeta.');
      setSaveError(message);
      pushToast({ type: 'error', message });
    } finally {
      setIsBrowsingBackupDir(false);
    }
  };

  const handleResetPathsToDefaults = async () => {
    setIsResettingPaths(true);

    try {
      const defaults = managedDefaults ?? await window.hospitalDirectory.getSettingsDefaults();
      setManagedDefaults({
        dataFilePath: defaults.dataFilePath,
        backupDirectoryPath: defaults.backupDirectoryPath
      });
      setSaveError("");
      setDataFilePath(defaults.dataFilePath);
      setBackupDirectoryPath(defaults.backupDirectoryPath);
      pushToast({
        type: "success",
        message: "Rutas gestionadas listas para guardar."
      });
    } catch (error) {
      const message = toCompactToastMessage(error, "No se pudieron cargar las rutas gestionadas.");
      setSaveError(message);
      pushToast({
        type: "error",
        message
      });
    } finally {
      setIsResettingPaths(false);
    }
  };

  const handleSave = async () => {
    if (!isDirty) {
      return;
    }

    setIsSaving(true);
    setSaveError("");

    try {
      const saved = await window.hospitalDirectory.saveSettings({
        editorName,
        dataFilePath,
        backupDirectoryPath,
        ui: {
          showInactiveByDefault
        }
      });
      setSettings(saved);
      pushToast({
        type: "success",
        message: "Configuración guardada."
      });
    } catch (error) {
      const message = toCompactToastMessage(error, "No se pudo guardar la configuración.");
      setSaveError(message);
      pushToast({
        type: "error",
        message
      });
    } finally {
      setIsSaving(false);
    }
  };

  const canOfferManagedReset = Boolean(
    saveError &&
    managedDefaults &&
    /ruta|carpeta|archivo|backups/i.test(saveError) &&
    (
      dataFilePath !== managedDefaults.dataFilePath ||
      backupDirectoryPath !== managedDefaults.backupDirectoryPath
    )
  );

  return (
    <section className="space-y-6">
      <h2 className="sr-only">Configuración</h2>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(18rem,1fr)]">
        <section className="rounded-3xl bg-white p-6 shadow-panel">
        <div>
          <h3 className="text-xl font-semibold text-scs-blueDark">Configuración básica</h3>
          <p className="mt-2 max-w-2xl text-sm text-slate-600">
            Define quién firma los cambios locales y cómo debe arrancar el directorio cuando se vuelva a abrir.
          </p>

          <div className="mt-6 space-y-5">
            <label htmlFor="settings-editor-name" className="block">
              <span className="text-sm font-semibold text-slate-700">Nombre del editor</span>
              <input
                id="settings-editor-name"
                aria-label="Nombre del editor"
                type="text"
                value={editorName}
                onChange={handleEditorNameChange}
                placeholder="Ej. Turno mañana"
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-scs-blue focus:ring-2 focus:ring-scs-blue/20"
              />
              <span className="mt-2 block text-xs text-slate-500">
                Se usa en auditoría, importaciones CSV y futuras exportaciones.
              </span>
            </label>

            <label htmlFor="settings-data-file-path" className="block">
              <span className="text-sm font-semibold text-slate-700">Ruta del archivo de datos</span>
              <div className="mt-2 flex gap-2">
                <input
                  id="settings-data-file-path"
                  aria-label="Ruta del archivo de datos"
                  type="text"
                  value={dataFilePath}
                  onChange={handleDataFilePathChange}
                  placeholder="/ruta/al/directorio/contacts.json"
                  className="flex-1 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-scs-blue focus:ring-2 focus:ring-scs-blue/20"
                />
                <button
                  type="button"
                  onClick={() => void handleBrowseDataFile()}
                  disabled={isBrowsingDataFile || isBrowsingBackupDir || isSaving || isResettingPaths}
                  aria-label="Seleccionar archivo de datos"
                  aria-busy={isBrowsingDataFile}
                  className="shrink-0 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isBrowsingDataFile ? '…' : 'Examinar'}
                </button>
              </div>
              <span className="mt-2 block text-xs text-slate-500">
                Debe ser una ruta absoluta hacia un archivo `.json` nuevo dentro de una carpeta existente y con permisos de escritura.
              </span>
            </label>

            <label htmlFor="settings-backup-directory-path" className="block">
              <span className="text-sm font-semibold text-slate-700">Ruta de la carpeta de backups</span>
              <div className="mt-2 flex gap-2">
                <input
                  id="settings-backup-directory-path"
                  aria-label="Ruta de la carpeta de backups"
                  type="text"
                  value={backupDirectoryPath}
                  onChange={handleBackupDirectoryPathChange}
                  placeholder="/ruta/a/la/carpeta/backups"
                  className="flex-1 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm outline-none transition focus:border-scs-blue focus:ring-2 focus:ring-scs-blue/20"
                />
                <button
                  type="button"
                  onClick={() => void handleBrowseBackupDir()}
                  disabled={isBrowsingDataFile || isBrowsingBackupDir || isSaving || isResettingPaths}
                  aria-label="Seleccionar carpeta de backups"
                  aria-busy={isBrowsingBackupDir}
                  className="shrink-0 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isBrowsingBackupDir ? '…' : 'Examinar'}
                </button>
              </div>
              <span className="mt-2 block text-xs text-slate-500">
                Debe ser una ruta absoluta. La carpeta debe existir y permitir lectura y escritura para crear copias de seguridad.
              </span>
            </label>

            <label className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <input
                aria-label="Mostrar inactivos al iniciar"
                type="checkbox"
                checked={showInactiveByDefault}
                onChange={handleShowInactiveChange}
                className="mt-1 h-4 w-4 rounded border-slate-300 text-scs-blue focus:ring-scs-blue"
              />
              <span>
                <span className="block text-sm font-semibold text-slate-700">Mostrar inactivos al iniciar</span>
                <span className="mt-1 block text-sm text-slate-600">
                  Activa el filtro de registros inactivos cada vez que se cargue la aplicación.
                </span>
              </span>
            </label>
          </div>

          {saveError ? (
            <div role="alert" className="mt-6 rounded-2xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
              <p className="font-semibold">No se pudo guardar la configuración</p>
              <p className="mt-2">{saveError}</p>
              {canOfferManagedReset ? (
                <button
                  type="button"
                  onClick={() => void handleResetPathsToDefaults()}
                  disabled={isSaving || isResettingPaths}
                  className="mt-4 rounded-full border border-rose-300 bg-white px-4 py-2 text-sm font-semibold text-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isResettingPaths ? "Cargando rutas…" : "Cargar rutas gestionadas"}
                </button>
              ) : null}
            </div>
          ) : null}

          <div className="mt-6 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={isSaving || isResettingPaths || !isDirty}
              className="w-full rounded-2xl bg-scs-blue px-5 py-3 text-sm font-semibold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
            >
              {isSaving ? "Guardando…" : "Guardar configuración"}
            </button>
            <button
              type="button"
              onClick={handleReset}
              disabled={isSaving || isResettingPaths || !isDirty}
              className="w-full rounded-2xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
            >
              Descartar cambios
            </button>
          </div>
        </div>
        </section>

        <aside className="space-y-4 rounded-3xl border border-slate-200 bg-slate-50 p-5 xl:sticky xl:top-6 xl:self-start">
          <div className="rounded-2xl bg-white p-4 shadow-sm">
            <p className="text-sm font-semibold text-slate-500">Estado actual</p>
            <dl className="mt-3 space-y-3 text-sm text-slate-700">
              <div>
                <dt className="font-medium text-slate-500">Editor activo</dt>
                <dd className="mt-1">{settings.editorName || "Sin configurar"}</dd>
              </div>
              <div>
                <dt className="font-medium text-slate-500">Archivo de datos</dt>
                <dd className="mt-1 break-all">{settings.dataFilePath}</dd>
              </div>
              <div>
                <dt className="font-medium text-slate-500">Carpeta de backups</dt>
                <dd className="mt-1 break-all">{settings.backupDirectoryPath}</dd>
              </div>
              <div>
                <dt className="font-medium text-slate-500">Inactivos al iniciar</dt>
                <dd className="mt-1">{settings.ui.showInactiveByDefault ? "Sí" : "No"}</dd>
              </div>
            </dl>
          </div>

          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-4">
            <h3 className="text-sm font-semibold text-scs-blueDark">Qué cambia al guardar</h3>
            <ul className="mt-3 space-y-2 text-sm text-slate-600">
              <li>El nombre del editor se aplicará a nuevas altas y futuras importaciones.</li>
              <li>La ruta de datos debe ser absoluta y apuntar a un archivo JSON nuevo para copiar el dataset actual.</li>
              <li>La carpeta de backups debe existir y ser accesible antes de guardarla aquí.</li>
              <li>La preferencia de inactivos se usará como comportamiento inicial del directorio.</li>
              <li>Si una ruta falla, puedes cargar las rutas gestionadas y guardarlas cuando lo revises.</li>
            </ul>
          </div>
        </aside>
      </div>
    </section>
  );
};
