import type { PropsWithChildren } from "react";
import { useEffect, useRef } from "react";
import { NavLink, useNavigate, useLocation } from "react-router-dom";
import { useAppStore } from "../../store/useAppStore";

/**
 * CSS custom property name exposing the app header's rendered height,
 * kept in sync via ResizeObserver below. Pages (e.g. DirectoryPage) read this
 * to position their own sticky elements directly below the header without
 * hardcoding a breakpoint-specific offset.
 */
export const APP_HEADER_HEIGHT_CSS_VAR = "--app-header-height";

/**
 * Renders the last-import watermark as `DD-MM-YYYY HH:mm`.
 * Returns null for an invalid/empty timestamp so the header text is hidden
 * entirely rather than showing a placeholder like "never" or "N/A".
 */
const formatLastImportedAt = (value: string | undefined): string | null => {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  const pad = (n: number) => String(n).padStart(2, "0");
  const day = pad(date.getDate());
  const month = pad(date.getMonth() + 1);
  const year = date.getFullYear();
  const hours = pad(date.getHours());
  const minutes = pad(date.getMinutes());

  return `${day}-${month}-${year} ${hours}:${minutes}`;
};

const navItems = [
  { to: "/", label: "Directorio", title: "Directorio — Alt+1" },
  { to: "/contacts/new", label: "Nuevo registro", title: "Nuevo registro — Alt+2" },
  { to: "/settings", label: "Configuración", title: "Configuración — Alt+3" },
  { to: "/buscas", label: "Buscas", title: "Buscas — Alt+4" },
  { to: "/deduplicate", label: "Duplicados", title: "Duplicados — Alt+5" }
];

const shortcutRoutes: Record<string, string> = {
  Digit1: "/",
  Numpad1: "/",
  Digit2: "/contacts/new",
  Numpad2: "/contacts/new",
  Digit3: "/settings",
  Numpad3: "/settings",
  Digit4: "/buscas",
  Numpad4: "/buscas",
  Digit5: "/deduplicate",
  Numpad5: "/deduplicate"
};

const isTextEntryElement = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable) {
    return true;
  }

  const tagName = target.tagName.toLowerCase();
  return tagName === "input" || tagName === "textarea" || tagName === "select";
};

const clickKeyboardCancelTarget = () => {
  const cancelTarget = document.querySelector<HTMLElement>("[data-keyboard-cancel]");
  cancelTarget?.click();
};

const submitKeyboardForm = () => {
  const form = document.querySelector<HTMLFormElement>("form[data-keyboard-submit]");
  form?.requestSubmit();
};

interface AppShellProps extends PropsWithChildren {
  isRecoveryMode?: boolean;
}

export const AppShell = ({ children, isRecoveryMode = false }: AppShellProps) => {
  const navigate = useNavigate();
  const location = useLocation();
  const lastImportedAtLabel = useAppStore((state) => formatLastImportedAt(state.settings?.lastImportedAt));
  const headerRef = useRef<HTMLElement>(null);

  // T1: move focus to #main-content on route change so keyboard users
  // land at the top of the new page content instead of retaining stale focus.
  useEffect(() => {
    const main = document.getElementById("main-content");
    if (main) {
      main.focus();
    }
  }, [location.pathname]);

  // Keep --app-header-height in sync with the header's real rendered
  // height (it varies as nav wraps to 2 rows on narrow viewports, or the
  // recovery banner appears/disappears). Consumers (DirectoryPage's sticky
  // filter bar) read this instead of a hardcoded per-breakpoint offset.
  // Guarded for environments without ResizeObserver (e.g. jsdom in tests) —
  // the CSS var simply stays unset there, which is harmless (calc() falls
  // back to the provided default of 0px at each call site).
  useEffect(() => {
    const headerEl = headerRef.current;
    if (!headerEl || typeof ResizeObserver === "undefined") {
      return;
    }

    const applyHeight = () => {
      document.documentElement.style.setProperty(APP_HEADER_HEIGHT_CSS_VAR, `${headerEl.getBoundingClientRect().height}px`);
    };

    applyHeight();
    const observer = new ResizeObserver(applyHeight);
    observer.observe(headerEl);

    return () => observer.disconnect();
  }, [isRecoveryMode]);

  useEffect(() => {
    if (isRecoveryMode) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      const isModifierShortcut = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();

      const shortcutRoute = shortcutRoutes[event.code];
      if (event.altKey && shortcutRoute && !isTextEntryElement(event.target)) {
        event.preventDefault();
        navigate(shortcutRoute);
        return;
      }

      if (isModifierShortcut && key === "n") {
        // Ctrl/Cmd+N always jumps to "Nuevo registro", but some pages (e.g. Buscas'
        // inline create/edit form, or an existing contact being edited) keep unsaved
        // work in local component state that isn't tied to the URL and has no
        // dirty-check guard yet. Reuse the same `[data-keyboard-cancel]` marker the
        // Escape shortcut already relies on to detect "there is an open form on this
        // screen right now" and suppress the navigation in that case instead of
        // silently discarding it. When no such form is open, the shortcut behaves as
        // before and navigates immediately.
        const hasOpenForm = document.querySelector<HTMLElement>("[data-keyboard-cancel]");
        if (hasOpenForm) {
          // Still consume the keypress: without preventDefault, Chromium/Electron
          // keeps its native Ctrl/Cmd+N behavior (new window) available while
          // unsaved form state is on screen.
          event.preventDefault();
          return;
        }

        event.preventDefault();
        navigate("/contacts/new");
        return;
      }

      if (isModifierShortcut && key === "s") {
        const form = document.querySelector<HTMLFormElement>("form[data-keyboard-submit]");
        if (form) {
          event.preventDefault();
          submitKeyboardForm();
        }
        return;
      }

      if (event.key === "/" && !isTextEntryElement(event.target)) {
        // Focus the search input of the CURRENT page (T9): use data-page-search attribute first,
        // then fall back to known page-specific IDs.
        const searchInput =
          (document.querySelector<HTMLInputElement>("[data-page-search]")) ??
          (document.getElementById("directory-search") as HTMLInputElement | null) ??
          (document.getElementById("buscas-search") as HTMLInputElement | null);
        if (searchInput) {
          event.preventDefault();
          searchInput.focus();
        }
        return;
      }

      if (event.key === "Escape" && !isTextEntryElement(event.target)) {
        const cancelTarget = document.querySelector<HTMLElement>("[data-keyboard-cancel]");
        if (cancelTarget) {
          event.preventDefault();
          clickKeyboardCancelTarget();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isRecoveryMode, navigate]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-scs-mist via-white to-slate-100 text-scs-ink">
      <a
        href="#main-content"
        className="sr-only left-4 top-4 z-[60] rounded-full bg-scs-blue px-4 py-2 text-sm font-semibold text-white focus:not-sr-only focus:fixed"
      >
        Saltar al contenido principal
      </a>
      <header ref={headerRef} className="sticky top-0 z-50 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-col gap-5 px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-scs-blue">Agenda Hospitalaria</p>
            </div>
            {isRecoveryMode ? (
              <div className="inline-flex w-fit rounded-full bg-scs-yellow px-3 py-1.5 text-sm font-semibold text-scs-blueDark shadow-sm">
                Recuperación
              </div>
            ) : lastImportedAtLabel ? (
              <p className="w-fit text-xs font-medium text-slate-500">
                Última actualización: {lastImportedAtLabel}
              </p>
            ) : null}
          </div>
          {isRecoveryMode ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
              El directorio está bloqueado hasta importar una copia JSON válida o restablecer el directorio vacío.
            </div>
          ) : (
            <nav aria-label="Navegación principal" className="grid grid-cols-1 gap-2 sm:grid-cols-2 md:flex md:flex-wrap md:gap-3">
              {navItems.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  title={item.title}
                  className={({ isActive }) =>
                    [
                      "focus-ring rounded-2xl px-4 py-3 text-center text-sm font-medium transition-colors md:rounded-full md:px-4 md:py-2.5",
                      isActive
                        ? "bg-scs-blue text-white shadow-sm"
                        : "border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100"
                    ].join(" ")
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>
          )}
        </div>
      </header>
      <main
        id="main-content"
        tabIndex={-1}
        // `<main>` receives programmatic focus on every route change
        // (T1, above) purely so assistive tech announces the new page — it must
        // NOT show the shared `focus-ring` visual treatment. Since this element's
        // height is bounded to (almost exactly) the viewport, that ring's
        // left/right edges rendered as two full-viewport-height vertical blue
        // lines flanking the page on every load. `focus:outline-none` alone still
        // suppresses the native focus outline without introducing a visible ring.
        className="mx-auto w-full max-w-7xl px-4 py-5 focus:outline-none sm:px-6 sm:py-6 lg:px-8 lg:py-8"
      >
        {children}
      </main>
    </div>
  );
};
