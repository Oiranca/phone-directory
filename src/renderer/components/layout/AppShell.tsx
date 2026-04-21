import { NavLink } from "react-router-dom";
import type { PropsWithChildren } from "react";

const navItems = [
  { to: "/", label: "Directorio" },
  { to: "/contacts/new", label: "Nuevo registro" },
  { to: "/import-export", label: "Importar/Exportar" },
  { to: "/settings", label: "Configuración" }
];

interface AppShellProps extends PropsWithChildren {
  isRecoveryMode?: boolean;
}

export const AppShell = ({ children, isRecoveryMode = false }: AppShellProps) => (
  <div className="min-h-screen bg-gradient-to-br from-scs-mist via-white to-slate-100 text-scs-ink">
    <header className="border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-scs-blue">Agenda Hospitalaria</p>
            <h1 className="font-serif text-2xl font-semibold text-scs-blueDark sm:text-3xl">MVP local</h1>
          </div>
          <div className="inline-flex w-fit rounded-full bg-scs-yellow px-3 py-1.5 text-sm font-semibold text-scs-blueDark">
            {isRecoveryMode ? "Recuperación" : "Offline"}
          </div>
        </div>
        {isRecoveryMode ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
            El directorio está bloqueado hasta importar una copia JSON válida o restablecer un dataset vacío.
          </div>
        ) : (
          <nav className="grid grid-cols-2 gap-2 md:flex md:flex-wrap">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  [
                    "rounded-2xl px-4 py-3 text-center text-sm font-medium transition-colors md:rounded-full md:px-4 md:py-2",
                    isActive ? "bg-scs-blue text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
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
    <main className="mx-auto w-full max-w-7xl px-4 py-5 sm:px-6 sm:py-6 lg:px-8 lg:py-8">{children}</main>
  </div>
);
