import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";

/**
 * localStorage key persisting the rail's collapsed/expanded preference.
 * Scoped globally (not per-dataset) since it's a pure UI layout preference,
 * not tied to which contacts.json is loaded.
 */
const RAIL_COLLAPSED_STORAGE_KEY = "nav-rail-collapsed:v1";

const DirectoryIcon = () => (
  <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" className="h-[18px] w-[18px] shrink-0">
    <circle cx="4" cy="5" r="1.3" fill="currentColor" stroke="none" />
    <line x1="8" y1="5" x2="17" y2="5" />
    <circle cx="4" cy="10" r="1.3" fill="currentColor" stroke="none" />
    <line x1="8" y1="10" x2="17" y2="10" />
    <circle cx="4" cy="15" r="1.3" fill="currentColor" stroke="none" />
    <line x1="8" y1="15" x2="17" y2="15" />
  </svg>
);

const NewRecordIcon = () => (
  <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" className="h-[18px] w-[18px] shrink-0">
    <circle cx="8" cy="7" r="3" />
    <path d="M2.5 17c0-3 2.5-5 5.5-5s5.5 2 5.5 5" />
    <line x1="15.5" y1="6" x2="15.5" y2="11" />
    <line x1="13" y1="8.5" x2="18" y2="8.5" />
  </svg>
);

const BuscasIcon = () => (
  <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" className="h-[18px] w-[18px] shrink-0">
    <rect x="5" y="2" width="10" height="16" rx="2" />
    <line x1="8" y1="6" x2="12" y2="6" />
    <circle cx="10" cy="13" r="1" fill="currentColor" stroke="none" />
  </svg>
);

const DuplicatesIcon = () => (
  <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" className="h-[18px] w-[18px] shrink-0">
    <path d="M3 6h6l-2-2M3 6l2 2" />
    <path d="M17 14h-6l2 2M17 14l-2-2" />
  </svg>
);

const SettingsIcon = () => (
  <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" className="h-[18px] w-[18px] shrink-0">
    <circle cx="10" cy="10" r="3" />
    <line x1="10" y1="2" x2="10" y2="4.4" />
    <line x1="10" y1="15.6" x2="10" y2="18" />
    <line x1="2" y1="10" x2="4.4" y2="10" />
    <line x1="15.6" y1="10" x2="18" y2="10" />
    <line x1="4.5" y1="4.5" x2="6.1" y2="6.1" />
    <line x1="13.9" y1="13.9" x2="15.5" y2="15.5" />
    <line x1="15.5" y1="4.5" x2="13.9" y2="6.1" />
    <line x1="6.1" y1="13.9" x2="4.5" y2="15.5" />
  </svg>
);

const ToggleIcon = () => (
  <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" className="h-[18px] w-[18px] shrink-0">
    <rect x="3" y="4" width="14" height="12" rx="2" />
    <line x1="8.5" y1="4" x2="8.5" y2="16" />
  </svg>
);

interface RailNavItem {
  to: string;
  label: string;
  title: string;
  icon: ReactNode;
}

// Visual order in the rail (top-to-bottom). Kept separate from the Alt+N
// keyboard shortcut mapping in AppShell, which is documented in
// docs/KEYBOARD_SHORTCUTS.md and must not change just because the rail's
// visual grouping (Configuración pinned to the bottom) differs from it.
const primaryNavItems: RailNavItem[] = [
  { to: "/", label: "Directorio", title: "Directorio — Alt+1", icon: <DirectoryIcon /> },
  { to: "/contacts/new", label: "Nuevo registro", title: "Nuevo registro — Alt+2", icon: <NewRecordIcon /> },
  { to: "/buscas", label: "Buscas", title: "Buscas — Alt+4", icon: <BuscasIcon /> },
  { to: "/deduplicate", label: "Duplicados", title: "Duplicados — Alt+5", icon: <DuplicatesIcon /> }
];

const settingsNavItem: RailNavItem = {
  to: "/settings",
  label: "Configuración",
  title: "Configuración — Alt+3",
  icon: <SettingsIcon />
};

const baseItemClasses =
  "focus-ring flex items-center rounded-[10px] text-[13px] font-semibold whitespace-nowrap overflow-hidden transition-colors";
const collapsedItemClasses = "h-10 w-10 justify-center p-0";
const expandedItemClasses = "h-10 w-full justify-start gap-[10px] px-[11px]";
const activeItemClasses = "bg-scs-blue text-white";
const inactiveItemClasses = "bg-transparent text-white/55 hover:text-white/80";

const readStoredCollapsed = (): boolean => {
  try {
    const stored = localStorage.getItem(RAIL_COLLAPSED_STORAGE_KEY);
    // Default collapsed when nothing (or a corrupt value) has been stored.
    return stored === "false" ? false : true;
  } catch {
    return true;
  }
};

const RailNavLink = ({ item, collapsed }: { item: RailNavItem; collapsed: boolean }) => (
  <NavLink
    to={item.to}
    title={item.title}
    className={({ isActive }) =>
      [baseItemClasses, collapsed ? collapsedItemClasses : expandedItemClasses, isActive ? activeItemClasses : inactiveItemClasses].join(
        " "
      )
    }
  >
    {item.icon}
    <span className={collapsed ? "hidden" : "inline"}>{item.label}</span>
  </NavLink>
);

export const NavRail = () => {
  const [collapsed, setCollapsed] = useState<boolean>(readStoredCollapsed);

  useEffect(() => {
    try {
      localStorage.setItem(RAIL_COLLAPSED_STORAGE_KEY, String(collapsed));
    } catch {
      // ignore write failures (quota exceeded, private browsing, etc.)
    }
  }, [collapsed]);

  const toggleLabel = collapsed ? "Mostrar títulos" : "Ocultar títulos";

  return (
    <div
      className={[
        "sticky top-0 flex h-screen shrink-0 flex-col overflow-hidden bg-scs-ink px-[10px] py-[14px]",
        collapsed ? "w-[60px] items-center" : "w-[192px] items-stretch"
      ].join(" ")}
      style={{ transition: "width .15s ease", gap: "6px" }}
    >
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-scs-blue text-[11px] font-bold text-white">
        HA
      </div>

      <nav
        aria-label="Navegación principal"
        className={["flex flex-1 flex-col", collapsed ? "items-center" : "items-stretch"].join(" ")}
        style={{ gap: "6px" }}
      >
        {primaryNavItems.map((item) => (
          <RailNavLink key={item.to} item={item} collapsed={collapsed} />
        ))}
        <div aria-hidden="true" className="flex-1" />
        <RailNavLink item={settingsNavItem} collapsed={collapsed} />
      </nav>

      <button
        type="button"
        onClick={() => setCollapsed((prev) => !prev)}
        title={toggleLabel}
        aria-pressed={!collapsed}
        className={[baseItemClasses, collapsed ? collapsedItemClasses : expandedItemClasses, inactiveItemClasses].join(" ")}
      >
        <ToggleIcon />
        <span className={collapsed ? "hidden" : "inline"}>{toggleLabel}</span>
      </button>
    </div>
  );
};
