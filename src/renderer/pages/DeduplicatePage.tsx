import { useEffect, useState } from "react";
import type { DuplicatePair } from "../../shared/types/duplicate";
import { useToast } from "../components/feedback/ToastRegion";

interface PairState {
  pair: DuplicatePair;
  keepId: string | null;
}

export const DeduplicatePage = () => {
  const { pushToast } = useToast();
  const [isLoading, setIsLoading] = useState(true);
  const [pairStates, setPairStates] = useState<PairState[]>([]);
  const [mergingId, setMergingId] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        setIsLoading(true);
        const result = await window.hospitalDirectory.detectDuplicates();
        setPairStates(result.pairs.map((pair) => ({ pair, keepId: null })));
      } finally {
        setIsLoading(false);
      }
    };

    void load();
  }, []);

  const handleKeepSelect = (pairId: string, keepId: string) => {
    setPairStates((current) =>
      current.map((ps) =>
        ps.pair.id === pairId ? { ...ps, keepId } : ps
      )
    );
  };

  const handleMerge = async (pairState: PairState) => {
    if (!pairState.keepId) {
      return;
    }

    const discardId =
      pairState.pair.recordA.id === pairState.keepId
        ? pairState.pair.recordB.id
        : pairState.pair.recordA.id;

    try {
      setMergingId(pairState.pair.id);
      await window.hospitalDirectory.mergeContacts({
        keepId: pairState.keepId,
        discardId
      });
      setPairStates((current) =>
        current.filter((ps) => ps.pair.id !== pairState.pair.id)
      );
      pushToast({ type: "success", message: "Duplicado fusionado correctamente" });
    } catch {
      pushToast({ type: "error", message: "No se pudo fusionar el duplicado. Inténtalo de nuevo." });
    } finally {
      setMergingId(null);
    }
  };

  if (isLoading) {
    return (
      <section role="status" aria-live="polite" className="rounded-3xl bg-white p-8 shadow-panel">
        Buscando duplicados…
      </section>
    );
  }

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
          const discardId = keepId === pair.recordA.id ? pair.recordB.id : pair.recordA.id;
          void discardId;

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
                      <p className="font-semibold text-scs-blueDark">{record.displayName}</p>
                      {record.organization.department && (
                        <p className="mt-1 text-xs text-slate-500">{record.organization.department}</p>
                      )}
                      {record.contactMethods.phones.length > 0 && (
                        <ul className="mt-3 space-y-1">
                          {record.contactMethods.phones.map((phone) => (
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
                        disabled={isMerging}
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
                <div className="mt-4 flex justify-end">
                  <button
                    type="button"
                    onClick={() => void handleMerge(pairState)}
                    disabled={isMerging}
                    className="focus-ring rounded-2xl bg-scs-blue px-6 py-3 text-sm font-semibold text-white transition hover:bg-scs-blueDark disabled:opacity-60"
                  >
                    {isMerging ? "Fusionando…" : "Fusionar"}
                  </button>
                </div>
              )}
            </article>
          );
        })}
      </div>
    </section>
  );
};
