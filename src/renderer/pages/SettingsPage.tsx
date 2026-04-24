import { ChangeEvent, useEffect, useState } from "react";
import { isRecoveryBootstrap } from "../../shared/types/contact";
import { useToast } from "../components/feedback/ToastRegion";
import { useAppStore } from "../store/useAppStore";

export const SettingsPage = () => {
  const { settings, initialize, setSettings } = useAppStore();
  const { pushToast } = useToast();
  const [editorName, setEditorName] = useState("");
  const [hasEditorDraft, setHasEditorDraft] = useState(false);
  const [showInactiveByDefault, setShowInactiveByDefault] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [bootstrapError, setBootstrapError] = useState("");

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
    setShowInactiveByDefault(settings.ui.showInactiveByDefault);
  }, [settings]);

  if (bootstrapError) {
    return (
      <section className="rounded-3xl bg-white p-6 shadow-panel">
        <h2 className="text-2xl font-semibold text-scs-blueDark">Configuración no disponible</h2>
        <p className="mt-2 text-sm text-slate-600">{bootstrapError}</p>
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
    return <section className="rounded-3xl bg-white p-6 shadow-panel">Cargando configuración…</section>;
  }

  const isDirty =
    (hasEditorDraft && editorName !== settings.editorName) ||
    showInactiveByDefault !== settings.ui.showInactiveByDefault;

  const handleEditorNameChange = (event: ChangeEvent<HTMLInputElement>) => {
    setEditorName(event.target.value);
    setHasEditorDraft(true);
  };

  const handleShowInactiveChange = (event: ChangeEvent<HTMLInputElement>) => {
    setShowInactiveByDefault(event.target.checked);
  };

  const handleReset = () => {
    setEditorName(settings.editorName);
    setHasEditorDraft(false);
    setShowInactiveByDefault(settings.ui.showInactiveByDefault);
  };

  const handleSave = async () => {
    if (!isDirty) {
      return;
    }

    setIsSaving(true);

    try {
      const saved = await window.hospitalDirectory.saveSettings({
        editorName,
        ui: {
          showInactiveByDefault
        }
      });
      setSettings(saved);
      pushToast({
        type: "success",
        message: "Configuración guardada. El filtro por defecto se aplicará en la próxima carga."
      });
    } catch {
      pushToast({
        type: "error",
        message: "No se pudo guardar la configuración. Inténtalo de nuevo."
      });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section className="space-y-6">
      <div className="rounded-3xl bg-white p-6 shadow-panel">
        <p className="text-sm font-semibold uppercase tracking-[0.2em] text-scs-blue">Configuración</p>
        <h2 className="mt-2 text-2xl font-semibold text-scs-blueDark sm:text-3xl">Preferencias locales</h2>
        <p className="mt-2 max-w-2xl text-sm text-slate-600">
          Ajusta quién firma los cambios y cómo debe arrancar el directorio en esta instalación.
        </p>
      </div>

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

          <div className="mt-6 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={isSaving || !isDirty}
              className="w-full rounded-2xl bg-scs-blue px-5 py-3 text-sm font-semibold text-white shadow-sm disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
            >
              {isSaving ? "Guardando…" : "Guardar configuración"}
            </button>
            <button
              type="button"
              onClick={handleReset}
              disabled={isSaving || !isDirty}
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
                <dt className="font-medium text-slate-500">Inactivos al iniciar</dt>
                <dd className="mt-1">{settings.ui.showInactiveByDefault ? "Sí" : "No"}</dd>
              </div>
            </dl>
          </div>

          <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-4">
            <h3 className="text-sm font-semibold text-scs-blueDark">Qué cambia al guardar</h3>
            <ul className="mt-3 space-y-2 text-sm text-slate-600">
              <li>El nombre del editor se aplicará a nuevas altas y futuras importaciones.</li>
              <li>La preferencia de inactivos se usará como comportamiento inicial del directorio.</li>
              <li>No se modifica el dataset actual hasta que edites, importes o exportes datos.</li>
            </ul>
          </div>
        </aside>
      </div>
    </section>
  );
};
