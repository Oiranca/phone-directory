import { useEffect, useRef, useState } from "react";
import { Outlet } from "react-router-dom";
import { isRecoveryBootstrap } from "../../shared/types/contact";
import type { ImportContactsResult, ResetContactsResult } from "../../shared/types/contact";
import { AppShell } from "../components/layout/AppShell";
import { useToast } from "../components/feedback/ToastRegion";
import { useAppStore } from "../store/useAppStore";

const RecoveryPanel = () => {
  const { recovery, initialize } = useAppStore();
  const [isImporting, setIsImporting] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const { pushToast } = useToast();

  if (!recovery) {
    return null;
  }

  const applyRecoveredData = (payload: ImportContactsResult | ResetContactsResult) => {
    initialize({
      contacts: payload.contacts,
      settings: payload.settings
    });
  };

  const handleImportJson = async () => {
    try {
      setIsImporting(true);
      const result = await window.hospitalDirectory.importDataset();

      if (!result) {
        return;
      }

      applyRecoveredData(result);
    } catch (error) {
      pushToast({
        type: "error",
        message: error instanceof Error
          ? error.message
          : "No se pudo importar una copia JSON válida."
      });
    } finally {
      setIsImporting(false);
    }
  };

  const handleResetDataset = async () => {
    const confirmed = window.confirm(
      "Se creará un backup del contacts.json dañado y después se restablecerá un directorio vacío. ¿Quieres continuar?"
    );

    if (!confirmed) {
      return;
    }

    try {
      setIsResetting(true);
      const result = await window.hospitalDirectory.resetDataset();
      applyRecoveredData(result);
    } catch (error) {
      pushToast({
        type: "error",
        message: error instanceof Error
          ? error.message
          : "No se pudo restablecer el directorio vacío."
      });
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <section className="mx-auto max-w-3xl rounded-3xl border border-amber-200 bg-white p-8 shadow-panel">
      <p className="text-sm font-semibold uppercase tracking-[0.22em] text-amber-700">Recuperación obligatoria</p>
      <h2 className="mt-3 text-3xl font-semibold text-scs-blueDark">No se puede abrir el directorio actual</h2>
      <p className="mt-4 text-sm text-slate-700">{recovery.message}</p>
      {recovery.details && <p className="mt-2 text-sm text-slate-600">{recovery.details}</p>}
      <div className="mt-5 rounded-2xl bg-slate-50 p-4 text-sm text-slate-700">
        <p className="font-semibold text-scs-blueDark">Archivo afectado</p>
        <p className="mt-1 break-all">{recovery.contactsFilePath}</p>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => void handleImportJson()}
          disabled={isImporting || isResetting}
          className="rounded-2xl bg-scs-blue px-5 py-4 text-sm font-semibold text-white disabled:opacity-60"
        >
          {isImporting ? "Importando JSON…" : "Importar JSON válido"}
        </button>
        <button
          type="button"
          onClick={() => void handleResetDataset()}
          disabled={isImporting || isResetting}
          className="rounded-2xl border border-slate-300 px-5 py-4 text-sm font-semibold text-slate-800 disabled:opacity-60"
        >
          {isResetting ? "Restableciendo…" : "Restablecer directorio vacío"}
        </button>
      </div>
    </section>
  );
};

export const App = () => {
  const { contacts, settings, recovery, isLoading, initialize, initializeRecovery, setIsLoading } = useAppStore();
  const [bootstrapError, setBootstrapError] = useState("");
  const [bootstrapHelp, setBootstrapHelp] = useState("");
  const hasAttempted = useRef(false);

  const loadBootstrapData = async () => {
    try {
      setIsLoading(true);
      setBootstrapError("");
      setBootstrapHelp("");

      if (typeof window.hospitalDirectory?.getBootstrapData !== "function") {
        setBootstrapError("La interfaz abierta en el navegador no puede acceder a los datos locales.");
        setBootstrapHelp("Usa la ventana de Electron que arranca con `npm run dev`. La URL http://localhost:5173 solo sirve como renderer de desarrollo.");
        setIsLoading(false);
        return;
      }

      const payload = await window.hospitalDirectory.getBootstrapData();

      if (isRecoveryBootstrap(payload)) {
        initializeRecovery(payload.recovery, payload.settings);
        return;
      }

      initialize(payload);
    } catch (error) {
      console.error('[App] Bootstrap failed:', error);
      setBootstrapError("No se pudieron cargar los datos locales. Revisa la configuración o importa una copia válida.");
      setBootstrapHelp("");
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (hasAttempted.current) {
      return;
    }

    if (contacts || (settings && recovery)) {
      return;
    }

    hasAttempted.current = true;
    void loadBootstrapData();
  }, [contacts, recovery, settings]);

  if (bootstrapError) {
    return (
      <AppShell>
        <section className="rounded-3xl bg-white p-8 shadow-panel">
          <h2 className="text-xl font-semibold text-scs-blueDark">No se pudieron cargar los datos</h2>
          <p className="mt-2 text-sm text-slate-600">{bootstrapError}</p>
          {bootstrapHelp ? <p className="mt-2 text-sm text-slate-500">{bootstrapHelp}</p> : null}
          <button
            type="button"
            onClick={() => {
              void loadBootstrapData();
            }}
            className="mt-6 rounded-full bg-scs-blue px-5 py-3 text-sm font-semibold text-white"
          >
            Reintentar
          </button>
        </section>
      </AppShell>
    );
  }

  if (isLoading) {
    return (
      <AppShell>
        <section role="status" aria-live="polite" className="rounded-3xl bg-white p-8 shadow-panel">Cargando datos locales…</section>
      </AppShell>
    );
  }

  if (recovery) {
    return (
      <AppShell isRecoveryMode>
        <RecoveryPanel />
      </AppShell>
    );
  }

  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
};
