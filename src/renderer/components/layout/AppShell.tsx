import type { PropsWithChildren } from "react";
import { useEffect } from "react";
import { NavLink, useNavigate } from "react-router-dom";

const navItems = [
  { to: "/", label: "Directorio", title: "Directorio — Alt+1" },
  { to: "/contacts/new", label: "Nuevo registro", title: "Nuevo registro — Alt+2" },
  { to: "/import-export", label: "Importar/Exportar", title: "Importar/Exportar — Alt+3" },
  { to: "/settings", label: "Configuración", title: "Configuración — Alt+4" },
  { to: "/buscas", label: "Buscas", title: "Buscas — Alt+5" },
  { to: "/deduplicate", label: "Duplicados", title: "Duplicados — Alt+6" }
];

const shortcutRoutes: Record<string, string> = {
  Digit1: "/",
  Numpad1: "/",
  Digit2: "/contacts/new",
  Numpad2: "/contacts/new",
  Digit3: "/import-export",
  Numpad3: "/import-export",
  Digit4: "/settings",
  Numpad4: "/settings",
  Digit5: "/buscas",
  Numpad5: "/buscas",
  Digit6: "/deduplicate",
  Numpad6: "/deduplicate"
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
        const searchInput = document.getElementById("directory-search") as HTMLInputElement | null;
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
      <header className="sticky top-0 z-50 border-b border-slate-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-col gap-5 px-4 py-4 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-scs-blue">Agenda Hospitalaria</p>
              <h1 className="font-serif text-2xl font-semibold leading-none text-scs-blueDark sm:text-3xl">MVP local</h1>
            </div>
            <div className="inline-flex w-fit rounded-full bg-scs-yellow px-3 py-1.5 text-sm font-semibold text-scs-blueDark shadow-sm">
              {isRecoveryMode ? "Recuperación" : "Offline"}
            </div>
          </div>
          {isRecoveryMode ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
              El directorio está bloqueado hasta importar una copia JSON válida o restablecer un dataset vacío.
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
        className="focus-ring mx-auto w-full max-w-7xl px-4 py-5 focus:outline-none sm:px-6 sm:py-6 lg:px-8 lg:py-8"
      >
        {children}
      </main>
    </div>
  );
};
