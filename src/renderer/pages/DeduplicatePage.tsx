import { useEffect, useState } from "react";
import type { DuplicatePair } from "../../shared/types/duplicate";
import { useToast } from "../components/feedback/ToastRegion";
import { ConfirmDialog } from "../components/feedback/ConfirmDialog";
import { MergeLossPreview } from "../components/deduplicate/MergeLossPreview";
import { StatePanel } from "../components/feedback/StatePanel";
import { useAppStore } from "../store/useAppStore";

interface PairState {
  pair: DuplicatePair;
  keepId: string | null;
}

const STORAGE_KEY_PREFIX = "dedup-dismissed-pairs";
const STORAGE_KEY_VERSION = "v1";

/**
 * djb2 hash — deterministic, synchronous, no external dependencies.
 * Used to derive a stable opaque identifier from the dataset file path so that
 * dismissed-pair lists stay isolated per dataset. Without this, switching
 * dataFilePath or opening a copied dataset that reuses contact IDs could silently
 * hide duplicate warnings for the wrong directory.
 */
function hashPath(path: string): string {
  let h = 5381;
  for (let i = 0; i < path.length; i++) {
    h = (((h << 5) + h) ^ path.charCodeAt(i)) >>> 0;
  }
  return h.toString(36);
}

/**
 * Build a dataset-scoped localStorage key.
 * Format: `dedup-dismissed-pairs:v1:<djb2(dataFilePath)>`
 *
 * Scope source: `settings.dataFilePath` from EditableAppSettings, which is
 * populated by the bootstrap IPC call before any page renders in normal
 * operation. Using the path (rather than a separate UUID) is intentional — it
 * is stable, derived from the real filesystem location, and does not require
 * persisting a separate dataset identifier.
 *
 * Falls back to the bare prefix (unscoped) when dataFilePath is absent. This
 * preserves backward compatibility with any dismissals written under the old
 * global key, and covers tests that do not seed settings or recovery-mode
 * renders where contacts.json is temporarily unavailable.
 */
export function buildStorageKey(dataFilePath: string | null | undefined): string {
  if (!dataFilePath) {
    return STORAGE_KEY_PREFIX;
  }
  return `${STORAGE_KEY_PREFIX}:${STORAGE_KEY_VERSION}:${hashPath(dataFilePath)}`;
}

export function readDismissedPairIds(storageKey: string): string[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}

export function writeDismissedPairId(storageKey: string, id: string): void {
  const existing = readDismissedPairIds(storageKey);
  if (!existing.includes(id)) {
    try {
      localStorage.setItem(storageKey, JSON.stringify([...existing, id]));
    } catch {
      // ignore write failures (quota exceeded, private browsing, etc.)
    }
  }
}

export const DeduplicatePage = () => {
  const { pushToast } = useToast();
  const applyMergeResult = useAppStore((s) => s.applyMergeResult);
  const dataFilePath = useAppStore((s) => s.settings?.dataFilePath ?? null);
  const storageKey = buildStorageKey(dataFilePath);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pairStates, setPairStates] = useState<PairState[]>([]);
  const [mergingId, setMergingId] = useState<string | null>(null);
  const [confirmState, setConfirmState] = useState<{
    pairId: string;
    keepRecord: { id: string; displayName: string };
    discardRecord: { id: string; displayName: string };
  } | null>(null);

  const handleDismissPair = (pairId: string) => {
    setPairStates((current) => current.filter((ps) => ps.pair.id !== pairId));
    writeDismissedPairId(storageKey, pairId);
  };

  useEffect(() => {
    const load = async () => {
      try {
        setIsLoading(true);
        setLoadError(null);
        const result = await window.hospitalDirectory.detectDuplicates();
        const dismissed = readDismissedPairIds(storageKey);
        setPairStates(
          result.pairs
            .filter((pair) => !dismissed.includes(pair.id))
            .map((pair) => ({ pair, keepId: null }))
        );
      } catch (error) {
        setLoadError(
          error instanceof Error ? error.message : "No se pudo cargar duplicados"
        );
      } finally {
        setIsLoading(false);
      }
    };

    void load();
  // storageKey is stable in normal operation (set once at bootstrap); include it
  // so that if the operator changes dataFilePath the list reloads under the new scope.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  const handleKeepSelect = (pairId: string, keepId: string) => {
    setPairStates((current) =>
      current.map((ps) =>
        ps.pair.id === pairId ? { ...ps, keepId } : ps
      )
    );
  };

  const handleMergeClick = (pairState: PairState) => {
    if (!pairState.keepId) {
      return;
    }

    const keepRecord =
      pairState.pair.recordA.id === pairState.keepId
        ? pairState.pair.recordA
        : pairState.pair.recordB;
    const discardRecord =
      pairState.pair.recordA.id === pairState.keepId
        ? pairState.pair.recordB
        : pairState.pair.recordA;

    // Show confirmation dialog before merge
    setConfirmState({
      pairId: pairState.pair.id,
      keepRecord: { id: keepRecord.id, displayName: keepRecord.displayName },
      discardRecord: { id: discardRecord.id, displayName: discardRecord.displayName }
    });
  };

  const handleConfirmMerge = async () => {
    if (!confirmState) return;

    // Prevent concurrent merges (disable all buttons during merge)
    if (mergingId) return;

    const mergedPairId = confirmState.pairId;
    const discardId = confirmState.discardRecord.id;

    try {
      setMergingId(mergedPairId);

      // Stage A: IPC merge + store reconciliation — if this throws, merge genuinely failed
      const survivor = await window.hospitalDirectory.mergeContacts({
        keepId: confirmState.keepRecord.id,
        discardId
      });

      // Reconcile the central store — remove discarded, upsert survivor
      applyMergeResult(survivor, discardId);
    } catch (error) {
      // Merge truly failed — report it and bail out without touching pair state
      const message =
        error instanceof Error
          ? error.message
          : "No se pudo fusionar el duplicado. Inténtalo de nuevo.";
      pushToast({ type: "error", message });
      setMergingId(null);
      setConfirmState(null);
      return;
    }

    // Stage B: merge committed — show success, then refresh the list
    pushToast({ type: "success", message: "Duplicado fusionado correctamente" });

    try {
      // Refresh all pairs to clear any pairs that referenced the discarded record
      const result = await window.hospitalDirectory.detectDuplicates();
      const dismissed = readDismissedPairIds(storageKey);
      setPairStates(
        result.pairs
          .filter((pair) => !dismissed.includes(pair.id))
          .map((pair) => ({ pair, keepId: null }))
      );
    } catch {
      // Refresh failed but the merge already committed — warn the operator to
      // reload rather than applying a partial local filter that could mask the
      // true list state.
      pushToast({
        type: "warning",
        message: "La fusión se completó, pero la lista no pudo actualizarse. Recarga la página para ver los cambios."
      });
    } finally {
      setMergingId(null);
      setConfirmState(null);
    }
  };

  if (isLoading) {
    return (
      <section role="status" aria-live="polite" className="rounded-3xl bg-white p-8 shadow-panel">
        Buscando duplicados…
      </section>
    );
  }

  // Error state: detection failure
  if (loadError) {
    return (
      <StatePanel
        role="alert"
        title="No se pudo cargar duplicados"
        message={loadError}
        action={
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="focus-ring rounded-2xl bg-scs-blue px-4 py-2 text-sm font-semibold text-white transition hover:bg-scs-blueDark"
          >
            Reintentar
          </button>
        }
      />
    );
  }

  // Empty state: no duplicates found
  if (pairStates.length === 0) {
    return (
      <StatePanel
        title="No se encontraron duplicados"
        message="El directorio no tiene registros con datos coincidentes."
        icon={
          <svg className="h-8 w-8 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 13l4 4L19 7" />
          </svg>
        }
      />
    );
  }

  return (
    <section aria-labelledby="deduplicate-page-title" className="flex flex-col gap-5">
      <div className="rounded-3xl bg-white p-5 shadow-panel">
        <h2 id="deduplicate-page-title" className="text-2xl font-semibold text-scs-blueDark">
          Duplicados detectados
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          {pairStates.length} {pairStates.length === 1 ? "par encontrado" : "pares encontrados"}.
          Selecciona el registro a conservar y fusiona.
        </p>
      </div>

      <div className="flex flex-col gap-4">
        {pairStates.map((pairState) => {
          const { pair, keepId } = pairState;
          const isMerging = mergingId === pair.id;

          return (
            <article key={pair.id} className="rounded-3xl bg-white p-6 shadow-panel">
              <div className="mb-4 flex flex-wrap items-center gap-3">
                <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-900">
                  Similitud {Math.round(pair.score * 100)}%
                </span>
                <div className="flex flex-wrap gap-2">
                  {pair.reasons.map((reason) => (
                    <span
                      key={reason}
                      className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600"
                    >
                      {reason}
                    </span>
                  ))}
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                {[pair.recordA, pair.recordB].map((record) => {
                  const isSelected = keepId === record.id;

                  return (
                    <div
                      key={record.id}
                      className={[
                        "rounded-2xl border p-4 transition",
                        isSelected
                          ? "border-scs-blue bg-scs-mist ring-1 ring-scs-blue"
                          : "border-slate-200 bg-slate-50"
                      ].join(" ")}
                    >
                      <h3 className="font-semibold text-scs-blueDark">{record.displayName}</h3>
                      {record.department && (
                        <p className="mt-1 text-xs text-slate-500">{record.department}</p>
                      )}
                      {record.phones.length > 0 && (
                        <ul className="mt-3 space-y-1">
                          {record.phones.map((phone) => (
                            <li key={phone.id} className="text-sm text-slate-700">
                              {phone.label ? <span className="font-medium">{phone.label}: </span> : null}
                              {phone.number}
                            </li>
                          ))}
                        </ul>
                      )}
                      <button
                        type="button"
                        onClick={() => handleKeepSelect(pair.id, record.id)}
                        disabled={!!mergingId}
                        className={[
                          "focus-ring mt-4 w-full rounded-2xl px-4 py-2.5 text-sm font-semibold transition disabled:opacity-60",
                          isSelected
                            ? "bg-scs-blue text-white"
                            : "border border-slate-300 bg-white text-slate-700 hover:border-scs-blue hover:text-scs-blue"
                        ].join(" ")}
                      >
                        {isSelected ? "Seleccionado" : "Conservar este"}
                      </button>
                    </div>
                  );
                })}
              </div>

              {keepId && (
                <MergeLossPreview
                  keepRecord={pair.recordA.id === keepId ? pair.recordA : pair.recordB}
                  discardRecord={pair.recordA.id === keepId ? pair.recordB : pair.recordA}
                />
              )}

              <div className="mt-4 flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => handleDismissPair(pair.id)}
                  disabled={!!mergingId}
                  title="Marcar como contactos distintos y no volver a sugerir"
                  aria-label={`No son el mismo contacto: ${pair.recordA.displayName} y ${pair.recordB.displayName}`}
                  className="focus-ring rounded-2xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-slate-400 hover:text-slate-900 disabled:opacity-60"
                >
                  No son el mismo contacto
                </button>
                {keepId && (
                  <button
                    type="button"
                    onClick={() => handleMergeClick(pairState)}
                    disabled={!!mergingId}
                    className="focus-ring rounded-2xl bg-scs-blue px-6 py-3 text-sm font-semibold text-white transition hover:bg-scs-blueDark disabled:opacity-60"
                  >
                    {isMerging ? "Fusionando…" : "Fusionar"}
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>

      <ConfirmDialog
        isOpen={!!confirmState}
        title="Confirmar fusión"
        message={confirmState ? `¿Fusionar "${confirmState.discardRecord.displayName}" en "${confirmState.keepRecord.displayName}"? Esta acción no se puede deshacer.` : ""}
        confirmLabel="Fusionar"
        cancelLabel="Cancelar"
        onConfirm={() => void handleConfirmMerge()}
        onCancel={() => setConfirmState(null)}
        isDestructive={true}
      />
    </section>
  );
};
