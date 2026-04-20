import { useEffect, useState } from "react";
import { Outlet } from "react-router-dom";
import type { BootstrapResult, ImportContactsResult, ResetContactsResult } from "../../shared/types/contact";
import { AppShell } from "../components/layout/AppShell";
import { useAppStore } from "../store/useAppStore";

const isRecoveryBootstrap = (
  payload: BootstrapResult
): payload is Extract<BootstrapResult, { recovery: unknown }> => "recovery" in payload;

const RecoveryPanel = () => {
  const { recovery, initialize } = useAppStore();
  const [actionError, setActionError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

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
      setActionError("");
      setStatusMessage("");
      const result = await window.hospitalDirectory.importDataset();

      if (!result) {
        setStatusMessage("Selección de JSON cancelada.");
        return;
      }

      applyRecoveredData(result);
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "No se pudo importar una copia JSON válida."
      );
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
      setActionError("");
      setStatusMessage("");
      const result = await window.hospitalDirectory.resetDataset();
      applyRecoveredData(result);
    } catch (error) {
      setActionError(
        error instanceof Error
          ? error.message
          : "No se pudo restablecer el directorio vacío."
      );
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

      {statusMessage && (
        <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          {statusMessage}
        </div>
      )}

      {actionError && (
        <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {actionError}
        </div>
      )}
    </section>
  );
};

export const App = () => {
  const { contacts, settings, recovery, isLoading, initialize, initializeRecovery, setIsLoading } = useAppStore();
  const [bootstrapError, setBootstrapError] = useState("");

  const loadBootstrapData = async () => {
    try {
      setIsLoading(true);
      setBootstrapError("");
      const payload = await window.hospitalDirectory.getBootstrapData();

      if (isRecoveryBootstrap(payload)) {
        initializeRecovery(payload.recovery, payload.settings);
        return;
      }

      initialize(payload);
    } catch {
      setBootstrapError("No se pudieron cargar los datos locales. Revisa la configuración o importa una copia válida.");
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (contacts || (settings && recovery)) {
      return;
    }

    void loadBootstrapData();
  }, [contacts, recovery, settings]);

  if (bootstrapError) {
    return (
      <AppShell>
        <section className="rounded-3xl bg-white p-8 shadow-panel">
          <h2 className="text-xl font-semibold text-scs-blueDark">No se pudieron cargar los datos</h2>
          <p className="mt-2 text-sm text-slate-600">{bootstrapError}</p>
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
        <section className="rounded-3xl bg-white p-8 shadow-panel">Cargando datos locales…</section>
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
