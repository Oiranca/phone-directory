import { useCallback, useEffect, useRef, useState } from "react";
import type { DuplicatePair } from "../../shared/types/duplicate";
import { useToast } from "../components/feedback/ToastRegion";
import { ConfirmDialog } from "../components/feedback/ConfirmDialog";
import { MergeLossPreview } from "../components/deduplicate/MergeLossPreview";
import { useAppStore } from "../store/useAppStore";

interface PairState {
  pair: DuplicatePair;
  keepId: string | null;
}

/** Spanish labels for duplicate-detection reason codes. */
const REASON_LABELS: Record<string, string> = {
  externalId: "ID externo idéntico",
  displayName: "Nombre idéntico",
  "displayName:fuzzy": "Nombre similar",
  "displayName:levenshtein": "Nombre similar (Levenshtein)",
  "dept+name": "Departamento y nombre coinciden",
};

function translateReason(reason: string): string {
  if (REASON_LABELS[reason]) return REASON_LABELS[reason]!;
  // phone reasons are "phone:<normalized-number>" — translate the prefix
  if (reason.startsWith("phone:")) return "Teléfono coincide";
  return reason;
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

  // Focus restoration refs
  // triggerRef — the "Fusionar" button that opened the confirm dialog
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  // headingRef — the page heading, focused when no pairs remain after merge
  const headingRef = useRef<HTMLHeadingElement>(null);
  // pendingFocusRef — flag set before state updates to trigger focus restore in effect
  const pendingFocusRef = useRef<boolean>(false);
  // radioButtonRefs — tracks the "Conservar este" radio buttons by record id so
  // arrow-key navigation can move DOM focus to the newly-selected option
  // (roving tabindex pattern: only one radio per pair stays in the tab order).
  const radioButtonRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  // Restore focus after pairStates changes following a merge confirmation
  useEffect(() => {
    if (!pendingFocusRef.current) return;
    pendingFocusRef.current = false;
    // Try to focus the first "Conservar este" button in the updated list
    const firstKeepBtn = document.querySelector<HTMLButtonElement>("[data-keep-btn]");
    if (firstKeepBtn) {
      firstKeepBtn.focus();
    } else {
      // No more pairs — focus the heading (which is rendered only when pairs exist,
      // so fall back to the section heading ref; if the empty state is shown instead,
      // headingRef.current will be null and focus gracefully stays on body).
      headingRef.current?.focus();
    }
  }, [pairStates]);

  const handleDismissPair = (pairId: string) => {
    setPairStates((current) => current.filter((ps) => ps.pair.id !== pairId));
    writeDismissedPairId(storageKey, pairId);
  };

  // loadPairs is also called by the "Reintentar" error-state button for targeted retry
  const loadPairs = useCallback(async () => {
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
  // storageKey is stable in normal operation (set once at bootstrap); include it
  // so that if the operator changes dataFilePath the list reloads under the new scope.
  }, [storageKey]);

  useEffect(() => {
    void loadPairs();
  }, [loadPairs]);

  const handleKeepSelect = (pairId: string, keepId: string) => {
    setPairStates((current) =>
      current.map((ps) =>
        ps.pair.id === pairId ? { ...ps, keepId } : ps
      )
    );
  };

  // Roving-tabindex arrow key navigation for the "keep this / keep both" radiogroup.
  // ArrowUp/ArrowLeft moves to the previous option, ArrowDown/ArrowRight to the
  // next one, wrapping at both ends. Moves BOTH selection and DOM focus, per the
  // WAI-ARIA radiogroup keyboard contract.
  const handleRadioGroupKeyDown = (
    event: React.KeyboardEvent<HTMLDivElement>,
    pairId: string,
    optionIds: string[],
    currentId: string
  ) => {
    const previousKeys = ["ArrowUp", "ArrowLeft"];
    const nextKeys = ["ArrowDown", "ArrowRight"];
    if (!previousKeys.includes(event.key) && !nextKeys.includes(event.key)) return;

    event.preventDefault();
    const currentIndex = optionIds.indexOf(currentId);
    const delta = nextKeys.includes(event.key) ? 1 : -1;
    const nextIndex = (currentIndex + delta + optionIds.length) % optionIds.length;
    const nextId = optionIds[nextIndex]!;

    handleKeepSelect(pairId, nextId);
    radioButtonRefs.current.get(nextId)?.focus();
  };

  const handleMergeClick = (pairState: PairState, triggerEl: HTMLButtonElement) => {
    if (!pairState.keepId) {
      return;
    }

    // Store trigger so focus can be restored on cancel
    triggerRef.current = triggerEl;

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

  const handleCancelDialog = () => {
    setConfirmState(null);
    // Restore focus to the button that triggered the dialog
    requestAnimationFrame(() => {
      triggerRef.current?.focus();
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
      // Restore focus to the trigger button on failure too
      requestAnimationFrame(() => {
        triggerRef.current?.focus();
      });
      return;
    }

    // Stage B: merge committed — show success, then refresh the list
    pushToast({ type: "success", message: "Duplicado fusionado correctamente" });
    // Signal that the next pairStates update should restore focus
    pendingFocusRef.current = true;

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
      pendingFocusRef.current = false;
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
      <section role="status" aria-live="polite" aria-busy="true" className="rounded-3xl bg-white p-8 shadow-panel">
        <div className="flex items-center gap-3 text-slate-700">
          <svg
            className="h-5 w-5 animate-spin text-scs-blue"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span>Buscando duplicados…</span>
        </div>
      </section>
    );
  }

  // Error state: detection failure
  if (loadError) {
    return (
      <section
        role="alert"
        className="rounded-3xl border-2 border-red-200 bg-red-50 p-8 shadow-panel"
      >
        <div className="flex flex-col items-start gap-4">
          <div className="flex items-start gap-3">
            <svg
              className="mt-1 h-6 w-6 flex-shrink-0 text-red-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4v2m0-10a8 8 0 110 16 8 8 0 010-16z"
              />
            </svg>
            <div>
              <p className="font-semibold text-red-900">No se pudo cargar duplicados</p>
              <p className="mt-1 text-sm text-red-700">{loadError}</p>
            </div>
          </div>
          <button
            onClick={() => void loadPairs()}
            aria-label="Reintentar detección de duplicados"
            className="focus-ring rounded-2xl bg-red-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-700"
          >
            Reintentar
          </button>
        </div>
      </section>
    );
  }

  // Empty state: no duplicates found
  if (pairStates.length === 0) {
    return (
      <section className="rounded-3xl bg-white p-8 shadow-panel">
        <div className="flex flex-col items-center justify-center gap-4 py-8 text-center">
          <div className="rounded-full bg-emerald-50 p-4">
            <svg className="h-8 w-8 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <p className="text-base font-semibold text-slate-700">No se encontraron duplicados</p>
          <p className="text-sm text-slate-500">El directorio no tiene registros con datos coincidentes.</p>
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby="deduplicate-page-title" className="flex flex-col gap-5">
      <div className="rounded-3xl bg-white p-5 shadow-panel">
        {/* tabIndex={-1} allows programmatic focus after all pairs are merged */}
        <h2
          id="deduplicate-page-title"
          ref={headingRef}
          tabIndex={-1}
          className="text-2xl font-semibold text-scs-blueDark focus:outline-none"
        >
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
                      {translateReason(reason)}
                    </span>
                  ))}
                </div>
              </div>

              {/* aria-live region: announces blocked/active status to screen readers */}
              <p aria-live="polite" className="sr-only">
                {isMerging
                  ? "Fusionando contactos…"
                  : (mergingId ? "Par en espera mientras se fusionan otros contactos." : "")}
              </p>

              <div
                role="radiogroup"
                aria-label="Elegir cuál conservar"
                className="grid gap-4 sm:grid-cols-2"
                onKeyDown={(event) =>
                  handleRadioGroupKeyDown(
                    event,
                    pair.id,
                    [pair.recordA.id, pair.recordB.id],
                    keepId ?? pair.recordA.id
                  )
                }
              >
                {[pair.recordA, pair.recordB].map((record) => {
                  const isSelected = keepId === record.id;
                  // Roving tabindex: only the selected option (or the first option
                  // when nothing is selected yet) stays in the tab order.
                  const isTabbable = (keepId ?? pair.recordA.id) === record.id;

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
                      {/* Fix 5: min-h-[44px] min-w-[44px] ensures WCAG 2.5.5 touch target ≥44×44px */}
                      <button
                        type="button"
                        role="radio"
                        aria-checked={isSelected}
                        aria-label={`Conservar ${record.displayName}`}
                        data-keep-btn
                        ref={(el) => {
                          if (el) radioButtonRefs.current.set(record.id, el);
                          else radioButtonRefs.current.delete(record.id);
                        }}
                        tabIndex={isTabbable ? 0 : -1}
                        onClick={() => handleKeepSelect(pair.id, record.id)}
                        disabled={!!mergingId}
                        className={[
                          "focus-ring mt-4 min-h-[44px] min-w-[44px] w-full rounded-2xl px-4 py-2.5 text-sm font-semibold transition disabled:opacity-60",
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
                  /* Fix 1: amber/warning styling + ⚠ icon to communicate destructive/irreversible action */
                  <button
                    type="button"
                    onClick={(e) => handleMergeClick(pairState, e.currentTarget)}
                    disabled={!!mergingId}
                    className="focus-ring inline-flex items-center gap-2 rounded-2xl bg-amber-500 px-6 py-3 text-sm font-semibold text-white transition hover:bg-amber-600 disabled:opacity-60"
                  >
                    {isMerging ? (
                      <>
                        <svg className="h-4 w-4 animate-spin" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" aria-hidden="true">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Fusionando…
                      </>
                    ) : (
                      <>
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                        </svg>
                        Fusionar
                      </>
                    )}
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>

      {/* Fix 2: unambiguous copy — explicitly states which contact will be deleted */}
      <ConfirmDialog
        isOpen={!!confirmState}
        title="Confirmar fusión"
        message={
          confirmState
            ? `Se eliminará el contacto "${confirmState.discardRecord.displayName}" y sus datos únicos se añadirán a "${confirmState.keepRecord.displayName}". Esta acción no se puede deshacer.`
            : ""
        }
        confirmLabel="Fusionar"
        cancelLabel="Cancelar"
        onConfirm={() => void handleConfirmMerge()}
        onCancel={handleCancelDialog}
        isDestructive={true}
      />
    </section>
  );
};
