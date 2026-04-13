import { useEffect, useState } from "react";
import { useAppStore } from "../store/useAppStore";

export const SettingsPage = () => {
  const { settings, contacts, initialize, setSettings } = useAppStore();
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!settings || !contacts) {
      void window.hospitalDirectory.getBootstrapData().then(initialize);
    }
  }, [contacts, initialize, settings]);

  if (!settings) {
    return <section className="rounded-3xl bg-white p-6 shadow-panel">Cargando configuración…</section>;
  }

  const handleSave = async () => {
    setIsSaving(true);
    const saved = await window.hospitalDirectory.saveSettings(settings);
    setSettings(saved);
    setIsSaving(false);
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
    </section>
  );
};
