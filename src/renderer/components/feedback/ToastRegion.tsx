import { createContext, PropsWithChildren, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

export type ToastType = "success" | "error" | "warning" | "info";

interface ToastInput {
  type?: ToastType;
  title?: string;
  message: string;
  durationMs?: number;
}

interface ToastRecord {
  id: number;
  type: ToastType;
  title?: string;
  message: string;
}

interface ToastContextValue {
  pushToast: (toast: ToastInput) => void;
}

const DEFAULT_DURATION_MS = 4800;

const toastStyles: Record<ToastType, string> = {
  success: "border-emerald-200 bg-emerald-50 text-emerald-950",
  error: "border-red-200 bg-red-50 text-red-900",
  warning: "border-amber-200 bg-amber-50 text-amber-950",
  info: "border-slate-200 bg-white text-slate-900"
};

const ToastContext = createContext<ToastContextValue | null>(null);

export const ToastProvider = ({ children }: PropsWithChildren) => {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const nextToastId = useRef(1);
  const timersRef = useRef<Map<number, number>>(new Map());

  const dismissToast = useCallback((id: number) => {
    const timer = timersRef.current.get(id);

    if (timer) {
      window.clearTimeout(timer);
      timersRef.current.delete(id);
    }

    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const pushToast = useCallback((toast: ToastInput) => {
    const id = nextToastId.current++;
    const durationMs = toast.durationMs ?? DEFAULT_DURATION_MS;

    setToasts((current) => [
      ...current,
      {
        id,
        type: toast.type ?? "info",
        title: toast.title,
        message: toast.message
      }
    ]);

    const timeout = window.setTimeout(() => {
      dismissToast(id);
    }, durationMs);

    timersRef.current.set(id, timeout);
  }, [dismissToast]);

  useEffect(() => () => {
    timersRef.current.forEach((timer) => {
      window.clearTimeout(timer);
    });
    timersRef.current.clear();
  }, []);

  const value = useMemo(() => ({ pushToast }), [pushToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <section
        aria-label="Notificaciones"
        className="pointer-events-none fixed inset-x-4 top-4 z-50 flex flex-col gap-3 sm:left-auto sm:right-4 sm:w-full sm:max-w-sm"
      >
        {toasts.map((toast) => {
          const isAlert = toast.type === "error" || toast.type === "warning";

          return (
            <div
              key={toast.id}
              role={isAlert ? "alert" : "status"}
              aria-live={isAlert ? "assertive" : "polite"}
              className={[
                "pointer-events-auto rounded-3xl border px-4 py-3 shadow-lg shadow-slate-900/10 backdrop-blur",
                toastStyles[toast.type]
              ].join(" ")}
            >
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  {toast.title ? <p className="text-sm font-semibold">{toast.title}</p> : null}
                  <p className={toast.title ? "mt-1 text-sm" : "text-sm font-medium"}>{toast.message}</p>
                </div>
                <button
                  type="button"
                  onClick={() => dismissToast(toast.id)}
                  aria-label="Cerrar notificación"
                  className="rounded-full px-2 py-1 text-xs font-semibold text-current/70 transition hover:bg-black/5 hover:text-current"
                >
                  Cerrar
                </button>
              </div>
            </div>
          );
        })}
      </section>
    </ToastContext.Provider>
  );
};

export const useToast = () => {
  const context = useContext(ToastContext);

  if (!context) {
    throw new Error("useToast must be used within ToastProvider.");
  }

  return context;
};
