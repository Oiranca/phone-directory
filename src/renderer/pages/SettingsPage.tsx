import { ChangeEvent, useEffect, useState } from "react";
import { useToast } from "../components/feedback/ToastRegion";
import { DataManagementSection } from "../components/settings/DataManagementSection";
import { useAppStore } from "../store/useAppStore";
import { toCompactToastMessage } from "../utils/toastMessage";

const clampInteger = (value: string, minimum: number, maximum: number) => {
  const parsed = Math.trunc(Number(value));

  if (!Number.isFinite(parsed)) {
    return minimum;
  }

  return Math.min(maximum, Math.max(minimum, parsed));
};

export const SettingsPage = () => {
  const { settings, setSettings, ensureBootstrapLoaded } = useAppStore();
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
  const [autoBackupEnabled, setAutoBackupEnabled] = useState(false);
  const [autoBackupTrigger, setAutoBackupTrigger] = useState<"launch" | "intervalHours" | "editCount">("launch");
  const [autoBackupIntervalHours, setAutoBackupIntervalHours] = useState("2");
  const [autoBackupEditCountThreshold, setAutoBackupEditCountThreshold] = useState("10");
  const [autoBackupRetentionCount, setAutoBackupRetentionCount] = useState("5");
  const [isBrowsingDataFile, setIsBrowsingDataFile] = useState(false);
  const [isBrowsingBackupDir, setIsBrowsingBackupDir] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isResettingPaths, setIsResettingPaths] = useState(false);
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    void ensureBootstrapLoaded();
  }, []);

  useEffect(() => {
    if (!settings) {
      return;
    }

    setEditorName(settings.editorName);
    setHasEditorDraft(false);
    setDataFilePath(settings.dataFilePath);
    setBackupDirectoryPath(settings.backupDirectoryPath);
    setShowInactiveByDefault(settings.ui.showInactiveByDefault);
    setAutoBackupEnabled(settings.ui.autoBackup.enabled);
    setAutoBackupTrigger(settings.ui.autoBackup.trigger);
    setAutoBackupIntervalHours(String(settings.ui.autoBackup.intervalHours));
    setAutoBackupEditCountThreshold(String(settings.ui.autoBackup.editCountThreshold));
    setAutoBackupRetentionCount(String(settings.ui.autoBackup.retentionCount));
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

  if (!settings) {
    return <section role="status" aria-live="polite" aria-busy="true" className="rounded-3xl bg-white p-6 shadow-panel">Cargando configuración…</section>;
  }

  const isDirty =
    (hasEditorDraft && editorName !== settings.editorName) ||
    dataFilePath !== settings.dataFilePath ||
    backupDirectoryPath !== settings.backupDirectoryPath ||
    showInactiveByDefault !== settings.ui.showInactiveByDefault ||
    autoBackupEnabled !== settings.ui.autoBackup.enabled ||
    autoBackupTrigger !== settings.ui.autoBackup.trigger ||
    autoBackupIntervalHours !== String(settings.ui.autoBackup.intervalHours) ||
    autoBackupEditCountThreshold !== String(settings.ui.autoBackup.editCountThreshold) ||
    autoBackupRetentionCount !== String(settings.ui.autoBackup.retentionCount);

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

  const handleAutoBackupEnabledChange = (event: ChangeEvent<HTMLInputElement>) => {
    setAutoBackupEnabled(event.target.checked);
    setSaveError("");
  };

  const handleReset = () => {
    setEditorName(settings.editorName);
    setHasEditorDraft(false);
    setDataFilePath(settings.dataFilePath);
    setBackupDirectoryPath(settings.backupDirectoryPath);
    setShowInactiveByDefault(settings.ui.showInactiveByDefault);
    setAutoBackupEnabled(settings.ui.autoBackup.enabled);
    setAutoBackupTrigger(settings.ui.autoBackup.trigger);
    setAutoBackupIntervalHours(String(settings.ui.autoBackup.intervalHours));
    setAutoBackupEditCountThreshold(String(settings.ui.autoBackup.editCountThreshold));
    setAutoBackupRetentionCount(String(settings.ui.autoBackup.retentionCount));
    setSaveError("");
  };

  const handleBrowseDataFile = async () => {
    setIsBrowsingDataFile(true);
    try {
      const picked = await window.hospitalDirectory.browseForPath("dataFile");
      if (picked) {
        setDataFilePath(picked);
        setSaveError("");
      }
    } catch (error) {
      const message = toCompactToastMessage(error, "No se pudo abrir el selector de archivo.");
      setSaveError(message);
      pushToast({ type: "error", message });
    } finally {
      setIsBrowsingDataFile(false);
    }
  };

  const handleBrowseBackupDir = async () => {
    setIsBrowsingBackupDir(true);
    try {
      const picked = await window.hospitalDirectory.browseForPath("backupDirectory");
      if (picked) {
        setBackupDirectoryPath(picked);
        setSaveError("");
      }
    } catch (error) {
      const message = toCompactToastMessage(error, "No se pudo abrir el selector de carpeta.");
      setSaveError(message);
      pushToast({ type: "error", message });
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

    const normalizedAutoBackupSettings = {
      enabled: autoBackupEnabled,
      trigger: autoBackupTrigger,
      intervalHours: clampInteger(autoBackupIntervalHours, 1, 168),
      editCountThreshold: clampInteger(autoBackupEditCountThreshold, 1, 1000),
      retentionCount: clampInteger(autoBackupRetentionCount, 1, 100)
    };

    try {
      const saved = await window.hospitalDirectory.saveSettings({
        editorName,
        dataFilePath,
        backupDirectoryPath,
        ui: {
          showInactiveByDefault,
          autoBackup: normalizedAutoBackupSettings
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
      <section className="rounded-3xl bg-white p-6 shadow-panel">
        <div>
          <h3 className="text-xl font-semibold text-scs-blueDark">Configuración básica</h3>
          <p className="mt-2 max-w-2xl text-sm text-slate-600">
            Define quién firma los cambios locales y cómo debe arrancar el directorio cuando se vuelva a abrir.
          </p>

          <div className="mt-6 space-y-4">
            <div>
              <label htmlFor="settings-editor-name" className="block text-sm font-semibold text-slate-700">Nombre del editor</label>
              <input
                id="settings-editor-name"
                type="text"
                value={editorName}
                onChange={handleEditorNameChange}
                placeholder="Ej. Turno mañana"
                aria-describedby="settings-editor-name-hint"
                className="mt-2 w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm outline-none transition focus-visible:border-scs-blue focus-visible:ring-2 focus-visible:ring-scs-blue/20"
              />
              <p id="settings-editor-name-hint" className="mt-2 text-xs text-slate-500">
                Se usa en auditoría, importaciones CSV y futuras exportaciones.
              </p>
            </div>

            <div className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <input
                id="settings-show-inactive"
                type="checkbox"
                checked={showInactiveByDefault}
                onChange={handleShowInactiveChange}
                aria-describedby="settings-show-inactive-desc"
                className="mt-1 h-4 w-4 rounded border-slate-300 text-scs-blue focus-visible:ring-scs-blue"
              />
              <div>
                <label htmlFor="settings-show-inactive" className="block text-sm font-semibold text-slate-700">Mostrar inactivos al iniciar</label>
                <p id="settings-show-inactive-desc" className="mt-1 text-sm text-slate-600">
                  Activa el filtro de registros inactivos cada vez que se cargue la aplicación.
                </p>
              </div>
            </div>

            {/* OIR-221: "Copia de seguridad automática" compacted into a single tight
                row-group — the toggle, schedule and retention all share one row on
                wider screens instead of being spread across separate stacked blocks. */}
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-start gap-3">
                <input
                  id="settings-autobackup-enabled"
                  type="checkbox"
                  checked={autoBackupEnabled}
                  onChange={handleAutoBackupEnabledChange}
                  aria-describedby="settings-autobackup-enabled-desc"
                  className="mt-1 h-4 w-4 rounded border-slate-300 text-scs-blue focus-visible:ring-scs-blue"
                />
                <div>
                  <label htmlFor="settings-autobackup-enabled" className="block text-sm font-semibold text-slate-700">Activar copia de seguridad automática</label>
                  <p id="settings-autobackup-enabled-desc" className="mt-1 text-sm text-slate-600">
                    Crea copias automáticas en segundo plano para reducir el riesgo entre copias de seguridad manuales.
                  </p>
                </div>
              </div>

              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <div>
                  <label htmlFor="settings-autobackup-trigger" className="block text-xs font-semibold text-slate-700">Cuándo crear la copia de seguridad automática</label>
                  <select
                    id="settings-autobackup-trigger"
                    value={autoBackupTrigger}
                    onChange={(event) => {
                      setAutoBackupTrigger(event.target.value as "launch" | "intervalHours" | "editCount");
                      setSaveError("");
                    }}
                    disabled={!autoBackupEnabled}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus-visible:border-scs-blue focus-visible:ring-2 focus-visible:ring-scs-blue/20 disabled:opacity-60"
                  >
                    <option value="launch">Al abrir la app</option>
                    <option value="intervalHours">Cada N horas</option>
                    <option value="editCount">Cada N ediciones</option>
                  </select>
                </div>

                {autoBackupEnabled && autoBackupTrigger === "intervalHours" ? (
                  <div>
                    <label htmlFor="settings-autobackup-interval-hours" className="block text-xs font-semibold text-slate-700">Horas entre copias de seguridad automáticas</label>
                    <input
                      id="settings-autobackup-interval-hours"
                      type="number"
                      min={1}
                      max={168}
                      step={1}
                      value={autoBackupIntervalHours}
                      onChange={(event) => {
                        setAutoBackupIntervalHours(event.target.value);
                        setSaveError("");
                      }}
                      className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus-visible:border-scs-blue focus-visible:ring-2 focus-visible:ring-scs-blue/20"
                    />
                  </div>
                ) : null}

                {autoBackupEnabled && autoBackupTrigger === "editCount" ? (
                  <div>
                    <label htmlFor="settings-autobackup-edit-count" className="block text-xs font-semibold text-slate-700">Ediciones entre copias de seguridad automáticas</label>
                    <input
                      id="settings-autobackup-edit-count"
                      type="number"
                      min={1}
                      max={1000}
                      step={1}
                      value={autoBackupEditCountThreshold}
                      onChange={(event) => {
                        setAutoBackupEditCountThreshold(event.target.value);
                        setSaveError("");
                      }}
                      className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus-visible:border-scs-blue focus-visible:ring-2 focus-visible:ring-scs-blue/20"
                    />
                  </div>
                ) : null}

                <div>
                  <label htmlFor="settings-autobackup-retention" className="block text-xs font-semibold text-slate-700">Retención de copias de seguridad automáticas</label>
                  <input
                    id="settings-autobackup-retention"
                    type="number"
                    min={1}
                    max={100}
                    step={1}
                    value={autoBackupRetentionCount}
                    onChange={(event) => {
                      setAutoBackupRetentionCount(event.target.value);
                      setSaveError("");
                    }}
                    disabled={!autoBackupEnabled}
                    className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none transition focus-visible:border-scs-blue focus-visible:ring-2 focus-visible:ring-scs-blue/20 disabled:opacity-60"
                  />
                </div>
              </div>
            </div>

            {/* OIR-221: the raw data-file/backup-folder path fields are technical
                and almost never touched day-to-day on this shared workstation, so
                they are folded away behind a collapsed "Avanzado" disclosure rather
                than shown prominently. The underlying settings values are untouched
                — this only hides the editing UI, it never resets or clears them. */}
            <details className="rounded-2xl border border-slate-200 bg-white">
              <summary className="focus-ring cursor-pointer select-none rounded-2xl px-4 py-3 text-sm font-semibold text-slate-700">
                Avanzado
              </summary>
              <div className="space-y-5 border-t border-slate-200 p-4">
                <div>
                  <label htmlFor="settings-data-file-path" className="block text-sm font-semibold text-slate-700">Ruta del archivo de datos</label>
                  <div className="mt-2 flex gap-2">
                    <input
                      id="settings-data-file-path"
                      type="text"
                      value={dataFilePath}
                      onChange={handleDataFilePathChange}
                      placeholder="/ruta/al/directorio/contacts.json"
                      aria-describedby="settings-data-file-path-hint"
                      className="flex-1 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm outline-none transition focus-visible:border-scs-blue focus-visible:ring-2 focus-visible:ring-scs-blue/20"
                    />
                    <button
                      type="button"
                      onClick={() => void handleBrowseDataFile()}
                      disabled={isBrowsingDataFile || isBrowsingBackupDir || isSaving || isResettingPaths}
                      aria-label={isBrowsingDataFile ? "Examinando archivos…" : "Seleccionar archivo de datos"}
                      aria-busy={isBrowsingDataFile}
                      className="focus-ring shrink-0 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isBrowsingDataFile ? "Examinando…" : "Examinar"}
                    </button>
                  </div>
                  <p id="settings-data-file-path-hint" className="mt-2 text-xs text-slate-500">
                    Debe ser una ruta absoluta hacia un archivo `.json` nuevo dentro de una carpeta existente y con permisos de escritura.
                  </p>
                </div>

                <div>
                  <label htmlFor="settings-backup-directory-path" className="block text-sm font-semibold text-slate-700">Ruta de la carpeta de copias de seguridad</label>
                  <div className="mt-2 flex gap-2">
                    <input
                      id="settings-backup-directory-path"
                      type="text"
                      value={backupDirectoryPath}
                      onChange={handleBackupDirectoryPathChange}
                      placeholder="/ruta/a/la/carpeta/copia-de-seguridad"
                      aria-describedby="settings-backup-directory-path-hint"
                      className="flex-1 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 shadow-sm outline-none transition focus-visible:border-scs-blue focus-visible:ring-2 focus-visible:ring-scs-blue/20"
                    />
                    <button
                      type="button"
                      onClick={() => void handleBrowseBackupDir()}
                      disabled={isBrowsingDataFile || isBrowsingBackupDir || isSaving || isResettingPaths}
                      aria-label="Seleccionar carpeta de copias de seguridad"
                      aria-busy={isBrowsingBackupDir}
                      className="focus-ring shrink-0 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isBrowsingBackupDir ? "…" : "Examinar"}
                    </button>
                  </div>
                  <p id="settings-backup-directory-path-hint" className="mt-2 text-xs text-slate-500">
                    Debe ser una ruta absoluta. La carpeta debe existir y permitir lectura y escritura para crear copias de seguridad.
                  </p>
                </div>
              </div>
            </details>
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
                  className="focus-ring mt-4 rounded-full border border-rose-300 bg-white px-4 py-2 text-sm font-semibold text-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
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
              className="focus-ring w-full rounded-2xl bg-scs-blue px-5 py-3 text-sm font-semibold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
            >
              {isSaving ? "Guardando…" : "Guardar configuración"}
            </button>
            <button
              type="button"
              onClick={handleReset}
              disabled={isSaving || isResettingPaths || !isDirty}
              className="focus-ring w-full rounded-2xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
            >
              Descartar cambios
            </button>
          </div>
        </div>
      </section>

      <DataManagementSection />
    </section>
  );
};
