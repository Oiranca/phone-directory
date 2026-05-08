import type { PropsWithChildren } from "react";
import { NavLink } from "react-router-dom";

const navItems = [
  { to: "/", label: "Directorio" },
  { to: "/contacts/new", label: "Nuevo registro" },
  { to: "/import-export", label: "Importar/Exportar" },
  { to: "/settings", label: "Configuración" }
];

interface AppShellProps extends PropsWithChildren {
  isRecoveryMode?: boolean;
}

export const AppShell = ({ children, isRecoveryMode = false }: AppShellProps) => {
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
