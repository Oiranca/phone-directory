import { useEffect, useState } from "react";
import { useAppStore } from "../store/useAppStore";

export const SettingsPage = () => {
  const { settings, contacts, initialize, setSettings } = useAppStore();
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [bootstrapError, setBootstrapError] = useState("");

  const loadBootstrapData = async () => {
    try {
      setBootstrapError("");
      const payload = await window.hospitalDirectory.getBootstrapData();
      initialize(payload);
    } catch {
      setBootstrapError(
        "No se pudo cargar la configuración local. Revisa los archivos de datos o restaura una copia válida."
      );
    }
  };

  useEffect(() => {
    if (!settings || !contacts) {
      void loadBootstrapData();
    }
  }, [contacts, settings]);

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

  const handleSave = async () => {
    setIsSaving(true);
    setSaveError("");

    try {
      const saved = await window.hospitalDirectory.saveSettings({
        editorName: settings.editorName,
        ui: settings.ui
      });
      setSettings(saved);
    } catch {
      setSaveError("No se pudo guardar la configuración. Inténtalo de nuevo.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section className="rounded-3xl bg-white p-6 shadow-panel">
      <h2 className="text-2xl font-semibold text-scs-blueDark">Configuración básica</h2>
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <div className="rounded-2xl bg-slate-50 p-4">
          <p className="text-sm font-semibold text-slate-500">Editor</p>
          <p className="mt-1 text-sm text-slate-700">{settings.editorName || "Sin configurar"}</p>
        </div>
        <div className="rounded-2xl bg-slate-50 p-4">
          <p className="text-sm font-semibold text-slate-500">Mostrar inactivos por defecto</p>
          <p className="mt-1 text-sm text-slate-700">{settings.ui.showInactiveByDefault ? "Sí" : "No"}</p>
        </div>
      </div>
      <button
        type="button"
        onClick={() => void handleSave()}
        disabled={isSaving}
        className="mt-6 rounded-full bg-scs-blue px-5 py-3 text-sm font-semibold text-white disabled:opacity-60"
      >
        {isSaving ? "Guardando…" : "Guardar configuración"}
      </button>
      {saveError && <p className="mt-4 text-sm font-medium text-red-700">{saveError}</p>}
    </section>
  );
};
