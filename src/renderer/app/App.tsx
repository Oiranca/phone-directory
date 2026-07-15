import { useEffect, useRef, useState } from "react";
import { Outlet } from "react-router-dom";
import { isRecoveryBootstrap } from "../../shared/types/contact";
import type { ImportContactsResult, ResetContactsResult } from "../../shared/types/contact";
import { ConfirmDialog } from "../components/feedback/ConfirmDialog";
import { ErrorBoundary } from "../components/feedback/ErrorBoundary";
import { LoadingStatus } from "../components/feedback/LoadingStatus";
import { PathDisplay } from "../components/feedback/PathDisplay";
import { StatePanel } from "../components/feedback/StatePanel";
import { AppShell } from "../components/layout/AppShell";
import { useToast } from "../components/feedback/ToastRegion";
import { useAppStore } from "../store/useAppStore";
import { toCompactToastMessage } from "../utils/toastMessage";

const RecoveryPanel = () => {
  const { recovery, settings, initialize, initializeRecovery } = useAppStore();
  const [isImporting, setIsImporting] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [isRestoringPaths, setIsRestoringPaths] = useState(false);
  const [isResetDialogOpen, setIsResetDialogOpen] = useState(false);
  const resetConfirmInFlightRef = useRef(false);
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
        message: toCompactToastMessage(error, "No se pudo importar una copia JSON válida.")
      });
    } finally {
      setIsImporting(false);
    }
  };

  const handleResetDataset = async () => {
    if (resetConfirmInFlightRef.current) {
      return;
    }

    resetConfirmInFlightRef.current = true;
    setIsResetDialogOpen(false);

    try {
      setIsResetting(true);
      const result = await window.hospitalDirectory.resetDataset();
      applyRecoveredData(result);
    } catch (error) {
      pushToast({
        type: "error",
        message: toCompactToastMessage(error, "No se pudo restablecer el directorio vacío.")
      });
    } finally {
      setIsResetting(false);
      resetConfirmInFlightRef.current = false;
    }
  };

  const handleRestoreManagedPaths = async () => {
    try {
      setIsRestoringPaths(true);
      const defaults = await window.hospitalDirectory.getSettingsDefaults();
      await window.hospitalDirectory.saveSettings({
        editorName: settings?.editorName ?? defaults.editorName,
        dataFilePath: defaults.dataFilePath,
        backupDirectoryPath: defaults.backupDirectoryPath,
        ui: settings?.ui ?? defaults.ui
      });

      const payload = await window.hospitalDirectory.getBootstrapData();

      if (isRecoveryBootstrap(payload)) {
        initializeRecovery(payload.recovery, payload.settings);
        return;
      }

      initialize(payload);
    } catch (error) {
      pushToast({
        type: "error",
        message: toCompactToastMessage(error, "No se pudieron restaurar las rutas gestionadas.")
      });
    } finally {
      setIsRestoringPaths(false);
    }
  };

  return (
    <section aria-busy={isImporting || isResetting || isRestoringPaths} className="mx-auto max-w-3xl rounded-3xl border border-amber-200 bg-white p-8 shadow-panel">
      <p className="text-sm font-semibold uppercase tracking-[0.22em] text-amber-700">Recuperación obligatoria</p>
      <h2 className="mt-3 text-3xl font-semibold text-scs-blueDark">No se puede abrir el directorio actual</h2>
      <p className="mt-4 text-sm text-slate-700">{recovery.message}</p>
      {recovery.details && <p className="mt-2 text-sm text-slate-600">{recovery.details}</p>}
      <div className="mt-5 rounded-2xl bg-slate-50 p-4 text-sm text-slate-700">
        <p className="font-semibold text-scs-blueDark">Archivo afectado</p>
        <PathDisplay path={recovery.contactsFilePath} className="mt-1" />
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <button
          type="button"
          onClick={() => void handleImportJson()}
          disabled={isImporting || isResetting || isRestoringPaths}
          className="rounded-2xl bg-scs-blue px-5 py-4 text-sm font-semibold text-white disabled:opacity-60"
        >
          {isImporting ? "Importando JSON…" : "Importar JSON válido"}
        </button>
        <button
          type="button"
          onClick={() => setIsResetDialogOpen(true)}
          disabled={isImporting || isResetting || isRestoringPaths}
          className="rounded-2xl border border-slate-300 px-5 py-4 text-sm font-semibold text-slate-800 disabled:opacity-60"
        >
          {isResetting ? "Restableciendo…" : "Restablecer directorio vacío"}
        </button>
        <button
          type="button"
          onClick={() => void handleRestoreManagedPaths()}
          disabled={isImporting || isResetting || isRestoringPaths}
          className="rounded-2xl border border-amber-300 bg-amber-50 px-5 py-4 text-sm font-semibold text-amber-900 disabled:opacity-60"
        >
          {isRestoringPaths ? "Restaurando rutas…" : "Usar rutas gestionadas"}
        </button>
      </div>

      <ConfirmDialog
        isOpen={isResetDialogOpen}
        title="Restablecer directorio vacío"
        message="Antes se guardará una copia de seguridad de los datos de la agenda y después se restablecerá un directorio vacío. ¿Quieres continuar?"
        confirmLabel="Restablecer directorio vacío"
        cancelLabel="Cancelar"
        isDestructive={true}
        onConfirm={() => {
          void handleResetDataset();
        }}
        onCancel={() => setIsResetDialogOpen(false)}
      />
    </section>
  );
};

export const App = () => {
  const {
    contacts,
    settings,
    recovery,
    isLoading,
    bootstrapError,
    bootstrapHelp,
    ensureBootstrapLoaded
  } = useAppStore();
  const { pushToast } = useToast();
  const bootstrapErrorTitleRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    void ensureBootstrapLoaded();
  }, []);

  useEffect(() => {
    if (typeof window.hospitalDirectory?.onAutoBackupFailure !== "function") {
      return;
    }

    return window.hospitalDirectory.onAutoBackupFailure(({ message }) => {
      pushToast({
        type: "error",
        message: toCompactToastMessage(message, "No se pudo crear la copia de seguridad automática.")
      });
    });
  }, [pushToast]);

  // Moves focus to the boot error heading as soon as it mounts — this is the
  // most critical error screen in the app (nothing else can render without a
  // successful bootstrap), so it should not rely on the user noticing it visually.
  useEffect(() => {
    if (bootstrapError) {
      bootstrapErrorTitleRef.current?.focus();
    }
  }, [bootstrapError]);

  if (bootstrapError) {
    return (
      <AppShell>
        <StatePanel
          role="alert"
          title="No se pudieron cargar los datos"
          titleRef={bootstrapErrorTitleRef}
          message={bootstrapError}
          action={
            <>
              {bootstrapHelp ? <p className="mb-4 text-sm text-slate-500">{bootstrapHelp}</p> : null}
              <button
                type="button"
                onClick={() => {
                  void ensureBootstrapLoaded();
                }}
                className="rounded-full bg-scs-blue px-5 py-3 text-sm font-semibold text-white"
              >
                Reintentar
              </button>
            </>
          }
        />
      </AppShell>
    );
  }

  if (isLoading) {
    return (
      <AppShell>
        <LoadingStatus message="Cargando datos locales…" />
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
      <ErrorBoundary>
        <Outlet />
      </ErrorBoundary>
    </AppShell>
  );
};
