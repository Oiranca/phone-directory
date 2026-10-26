import type { ReactNode } from "react";
import { NavLink } from "react-router";
import { useAppStore } from "../../store/useAppStore";

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

const BeepersIcon = () => (
  <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" className="h-[18px] w-[18px] shrink-0">
    <rect x="5" y="2" width="10" height="16" rx="2" />
    <line x1="8" y1="6" x2="12" y2="6" />
    <circle cx="10" cy="13" r="1" fill="currentColor" stroke="none" />
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

interface RailNavItem {
  to: string;
  label: string;
  title: string;
  icon: ReactNode;
}

// Visual order in the rail (top-to-bottom). Kept separate from the Alt+N
// keyboard shortcut mapping in AppShell, which is documented in
// docs/KEYBOARD_SHORTCUTS.md and must not change just because the rail's
// visual grouping (Nuevo registro and Configuración pinned to the bottom)
// differs from it.
const primaryNavItems: RailNavItem[] = [
  { to: "/", label: "Directorio", title: "Directorio — Alt+1", icon: <DirectoryIcon /> },
  { to: "/beeper", label: "Buscas", title: "Buscas — Alt+4", icon: <BeepersIcon /> }
];

const bottomNavItems: RailNavItem[] = [
  { to: "/contacts/new", label: "Nuevo registro", title: "Nuevo registro — Alt+2", icon: <NewRecordIcon /> },
  { to: "/settings", label: "Configuración", title: "Configuración — Alt+3", icon: <SettingsIcon /> }
];

const baseItemClasses =
  "focus-ring flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-[10px] px-1 text-center text-[10px] font-semibold leading-tight transition-colors sm:flex-none sm:flex-row sm:text-left sm:text-[13px]";
const expandedItemClasses = "sm:h-10 sm:w-full sm:justify-start sm:gap-[10px] sm:px-[11px]";
const activeItemClasses = "bg-scs-blue text-white";
const inactiveItemClasses = "bg-transparent text-white/55 hover:text-white/80";

const RailNavLink = ({ item }: { item: RailNavItem }) => {
  const setQuery = useAppStore((state) => state.setQuery);
  const clearsSearch = item.to === "/" || item.to === "/beeper";

  return (
  <NavLink
    to={item.to}
    title={item.title}
    onClick={clearsSearch ? () => setQuery("") : undefined}
    className={({ isActive }) =>
      [baseItemClasses, expandedItemClasses, isActive ? activeItemClasses : inactiveItemClasses].join(" ")
    }
  >
    {item.icon}
    <span>{item.label}</span>
  </NavLink>
  );
};

export const NavRail = () => {
  return (
    <div
      className="fixed inset-x-0 bottom-0 z-50 flex h-[72px] w-full bg-scs-ink px-2 py-2 sm:sticky sm:inset-auto sm:top-0 sm:h-screen sm:w-[192px] sm:shrink-0 sm:flex-col sm:items-stretch sm:overflow-hidden sm:px-[10px] sm:py-[14px]"
      style={{ gap: "6px" }}
    >
      <div className="hidden h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-scs-blue text-[11px] font-bold text-white sm:flex">
        HA
      </div>

      <nav
        aria-label="Navegación principal"
        className="flex min-w-0 flex-1 flex-row items-stretch sm:flex-col sm:items-stretch"
        style={{ gap: "6px" }}
      >
        {primaryNavItems.map((item) => (
          <RailNavLink key={item.to} item={item} />
        ))}
        <div aria-hidden="true" className="hidden sm:flex-1" />
        {bottomNavItems.map((item) => (
          <RailNavLink key={item.to} item={item} />
        ))}
      </nav>
    </div>
  );
};
