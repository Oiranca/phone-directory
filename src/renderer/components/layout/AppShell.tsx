import { NavLink } from "react-router-dom";
import type { PropsWithChildren } from "react";

const navItems = [
  { to: "/", label: "Directorio" },
  { to: "/contacts/new", label: "Nuevo registro" },
  { to: "/import-export", label: "Importar/Exportar" },
  { to: "/settings", label: "Configuración" }
];

export const AppShell = ({ children }: PropsWithChildren) => (
  <div className="min-h-screen bg-gradient-to-br from-scs-mist via-white to-slate-100 text-scs-ink">
    <header className="border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-5 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-scs-blue">Agenda Hospitalaria</p>
            <h1 className="font-serif text-3xl font-semibold text-scs-blueDark">MVP local</h1>
          </div>
          <div className="rounded-full bg-scs-yellow px-4 py-2 text-sm font-semibold text-scs-blueDark">
            Offline
          </div>
        </div>
        <nav className="flex flex-wrap gap-2">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                [
                  "rounded-full px-4 py-2 text-sm font-medium transition-colors",
                  isActive ? "bg-scs-blue text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                ].join(" ")
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
      </div>
    </header>
    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">{children}</main>
  </div>
);
