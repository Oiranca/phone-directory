import { createContext, CSSProperties, PropsWithChildren, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

export type ToastType = "success" | "error" | "warning" | "info";

/** Prefijos sr-only por tipo — los lectores de pantalla los anuncian antes del mensaje. */
const TOAST_SR_PREFIXES: Record<ToastType, string> = {
  success: "Correcto:",
  error: "Error:",
  warning: "Aviso:",
  info: "Información:",
};

/** Iconos SVG decorativos por tipo, ocultos a tecnologías asistivas (aria-hidden). */
const ToastIcon = ({ type }: { type: ToastType }) => {
  if (type === "success") {
    return (
      <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="mt-0.5 h-4 w-4 shrink-0">
        <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.5" />
        <path d="M6.5 10.5l2.5 2 4.5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (type === "error") {
    return (
      <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="mt-0.5 h-4 w-4 shrink-0">
        <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.5" />
        <path d="M7.5 7.5l5 5M12.5 7.5l-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  }
  if (type === "warning") {
    return (
      <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="mt-0.5 h-4 w-4 shrink-0">
        <path d="M10 3L18 17H2L10 3Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        <path d="M10 9v3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        <circle cx="10" cy="14.5" r="0.75" fill="currentColor" />
      </svg>
    );
  }
  // info
  return (
    <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="mt-0.5 h-4 w-4 shrink-0">
      <circle cx="10" cy="10" r="8" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10 9.5V14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <circle cx="10" cy="7" r="0.75" fill="currentColor" />
    </svg>
  );
};

interface ToastInput {
  type?: ToastType;
  title?: string;
  message: string;
  durationMs?: number;
}

interface ToastRecord {
  durationMs?: number;
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

const isFocusableControl = (element: HTMLElement) => element.matches(
  'a[href], button, input, select, summary, textarea, [contenteditable="true"], [tabindex]:not([tabindex="-1"])'
);

const rectanglesIntersect = (first: DOMRect, second: DOMRect) =>
  first.left < second.right && first.right > second.left && first.top < second.bottom && first.bottom > second.top;

const isInViewport = (rect: DOMRect) =>
  rect.left < window.innerWidth && rect.right > 0 && rect.top < window.innerHeight && rect.bottom > 0;

const positionPersistentToast = (target: DOMRect, toast: DOMRect): CSSProperties => {
  const gap = 16;
  const spaceAbove = target.top - gap;
  const spaceBelow = window.innerHeight - target.bottom - gap;
  const placeBelow = spaceBelow >= toast.height || spaceBelow >= spaceAbove;
  const top = Math.min(Math.max(0, target.bottom + gap), window.innerHeight);
  const bottom = Math.min(Math.max(0, window.innerHeight - target.top + gap), window.innerHeight);

  return placeBelow
    ? {
        maxHeight: Math.max(0, window.innerHeight - top),
        overflowY: "auto",
        position: "fixed",
        top
      }
    : {
        bottom,
        maxHeight: Math.max(0, window.innerHeight - bottom),
        overflowY: "auto",
        position: "fixed",
        top: "auto"
      };
};

const ToastContext = createContext<ToastContextValue | null>(null);

export const ToastProvider = ({ children }: PropsWithChildren) => {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const nextToastId = useRef(1);
  const timersRef = useRef<Map<number, number>>(new Map());
  const toastKeysByIdRef = useRef<Map<number, string>>(new Map());
  const toastElementsRef = useRef<Map<number, HTMLDivElement>>(new Map());
  const toastRegionRef = useRef<HTMLElement>(null);
  const [toastPosition, setToastPosition] = useState<CSSProperties>();

  const dismissToast = useCallback((id: number) => {
    const timer = timersRef.current.get(id);

    if (timer !== undefined) {
      window.clearTimeout(timer);
      timersRef.current.delete(id);
    }

    const toastKey = toastKeysByIdRef.current.get(id);
    if (toastKey !== undefined) {
      toastKeysByIdRef.current.delete(id);
    }
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const pushToast = useCallback((toast: ToastInput) => {
    const type = toast.type ?? "info";
    const toastKey = JSON.stringify([type, toast.title ?? null, toast.message]);
    const activeToast = [...toastKeysByIdRef.current].find(([, key]) => key === toastKey);
    if (activeToast) dismissToast(activeToast[0]);

    const id = nextToastId.current++;
    const durationMs = toast.durationMs ?? DEFAULT_DURATION_MS;
    const isPersistentAlert = (toast.type === "error" || toast.type === "warning") && toast.durationMs === undefined;
    toastKeysByIdRef.current.set(id, toastKey);

    setToasts((current) => [
      ...current,
      {
        durationMs: isPersistentAlert ? undefined : durationMs,
        id,
        type,
        title: toast.title,
        message: toast.message
      }
    ]);

    if (isPersistentAlert) {
      return;
    }

    const timeout = window.setTimeout(() => {
      dismissToast(id);
    }, durationMs);

    timersRef.current.set(id, timeout);
  }, [dismissToast]);

  const handleToastsObscuring = useCallback((target: EventTarget | null, dismissTransient: boolean) => {
    if (!(target instanceof HTMLElement) || !isFocusableControl(target)) return;

    const targetRect = target.getBoundingClientRect();
    if (targetRect.width === 0 || targetRect.height === 0 || !isInViewport(targetRect)) return;

    let persistentToastOverlaps = false;
    for (const toast of toasts) {
      const toastElement = toastElementsRef.current.get(toast.id);
      if (!toastElement || toastElement.contains(target)) continue;
      if (!rectanglesIntersect(targetRect, toastElement.getBoundingClientRect())) continue;

      if (dismissTransient && toast.durationMs !== undefined) {
        dismissToast(toast.id);
      } else persistentToastOverlaps = true;
    }
    if (persistentToastOverlaps) {
      const toastRegion = toastRegionRef.current;
      if (toastRegion) setToastPosition(positionPersistentToast(targetRect, toastRegion.getBoundingClientRect()));
    }
  }, [dismissToast, toasts]);

  useEffect(() => {
    const handleFocus = (event: FocusEvent) => handleToastsObscuring(event.target, true);

    document.addEventListener("focusin", handleFocus);
    handleToastsObscuring(document.activeElement, false);
    return () => document.removeEventListener("focusin", handleFocus);
  }, [handleToastsObscuring]);

  useEffect(() => {
    if (!toasts.some((toast) => toast.durationMs === undefined) && toastPosition) setToastPosition(undefined);
  }, [toastPosition, toasts]);

  useEffect(() => {
    const handleResize = () => {
      const target = document.activeElement;
      const toastRegion = toastRegionRef.current;
      if (!(target instanceof HTMLElement) || !isFocusableControl(target) || !toastRegion) return;
      if (!isInViewport(target.getBoundingClientRect())) {
        setToastPosition(undefined);
        return;
      }
      if (toastPosition) setToastPosition(positionPersistentToast(target.getBoundingClientRect(), toastRegion.getBoundingClientRect()));
      else handleToastsObscuring(target, false);
    };

    window.addEventListener("resize", handleResize);
    window.addEventListener("scroll", handleResize, true);
    return () => {
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("scroll", handleResize, true);
    };
  }, [handleToastsObscuring, toastPosition]);

  useEffect(() => {
    const scrollToastRegion = (clientX: number, clientY: number, deltaY: number) => {
      const toastRegion = toastRegionRef.current;
      if (!toastRegion || toastRegion.scrollHeight <= toastRegion.clientHeight) return false;

      const rect = toastRegion.getBoundingClientRect();
      if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return false;

      const nextScrollTop = Math.min(
        Math.max(0, toastRegion.scrollTop + deltaY),
        toastRegion.scrollHeight - toastRegion.clientHeight
      );
      if (nextScrollTop === toastRegion.scrollTop) return false;
      toastRegion.scrollTop = nextScrollTop;
      return true;
    };

    const handleWheel = (event: WheelEvent) => {
      if (scrollToastRegion(event.clientX, event.clientY, event.deltaY)) event.preventDefault();
    };

    document.addEventListener("wheel", handleWheel, { capture: true, passive: false });
    return () => {
      document.removeEventListener("wheel", handleWheel, true);
    };
  }, []);

  useEffect(() => () => {
    timersRef.current.forEach((timer) => {
      window.clearTimeout(timer);
    });
    timersRef.current.clear();
    toastKeysByIdRef.current.clear();
  }, []);

  const value = useMemo(() => ({ pushToast }), [pushToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {toasts.length > 0 ? (
        <section
          ref={toastRegionRef}
          aria-label="Notificaciones"
          style={toastPosition}
          className="pointer-events-none fixed inset-x-4 top-4 z-50 flex max-h-[calc(100dvh-2rem)] flex-col gap-3 overflow-y-auto sm:left-auto sm:right-4 sm:w-full sm:max-w-sm"
        >
          {toasts.map((toast) => {
            const isAlert = toast.type === "error" || toast.type === "warning";

            return (
              <div
                key={toast.id}
                ref={(element) => {
                  if (element) toastElementsRef.current.set(toast.id, element);
                  else toastElementsRef.current.delete(toast.id);
                }}
                role={isAlert ? "alert" : "status"}
                aria-live={isAlert ? "assertive" : "polite"}
                aria-atomic="true"
                className={[
                  "pointer-events-none rounded-3xl border px-4 py-3 shadow-lg shadow-slate-900/10 backdrop-blur",
                  toastStyles[toast.type]
                ].join(" ")}
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                  <ToastIcon type={toast.type} />
                  <div className="min-w-0 flex-1">
                    <span className="sr-only">{TOAST_SR_PREFIXES[toast.type]}</span>
                    {toast.title ? <p className="text-sm font-semibold">{toast.title}</p> : null}
                    <p className={toast.title ? "mt-1 text-sm" : "text-sm font-medium"}>{toast.message}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => dismissToast(toast.id)}
                    aria-label="Cerrar notificación"
                    className="pointer-events-auto sticky bottom-0 min-h-11 min-w-11 self-end rounded-full px-3 py-2 text-xs font-semibold text-current/70 transition hover:bg-black/5 hover:text-current sm:self-auto"
                  >
                    Cerrar
                  </button>
                </div>
              </div>
            );
          })}
        </section>
      ) : null}
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
