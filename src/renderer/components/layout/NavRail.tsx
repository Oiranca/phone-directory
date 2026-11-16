import type { MouseEvent, ReactNode } from "react";
import { useEffect, useRef } from "react";
import { NavLink, useLocation } from "react-router";
import { useAppStore } from "../../store/useAppStore";
import { DIRECTORY_CENTER_DESTINATIONS } from "../../services/directory-centers";

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

const NewBeeperIcon = () => (
  <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" className="h-[18px] w-[18px] shrink-0">
    <rect x="3" y="4" width="10" height="14" rx="2" />
    <line x1="6" y1="8" x2="10" y2="8" />
    <circle cx="8" cy="14" r="1" fill="currentColor" stroke="none" />
    <line x1="16" y1="2.5" x2="16" y2="7.5" />
    <line x1="13.5" y1="5" x2="18.5" y2="5" />
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

interface RailNavSection {
  label: string;
  items: RailNavItem[];
}

const directoryNavItem: RailNavItem = {
  to: "/",
  label: "Agenda",
  title: "Agenda — Alt+1",
  icon: <DirectoryIcon />
};

const centerNavItems: RailNavItem[] = DIRECTORY_CENTER_DESTINATIONS.filter((center) => center.id !== "hugcdn").map((center) => ({
  to: `/centers/${center.id}`,
  label: center.label,
  title: center.title,
  icon: <DirectoryIcon />
}));

const getCenterNavItem = (id: string) => {
  const item = centerNavItems.find((center) => center.to === `/centers/${id}`);
  if (!item) throw new Error(`Missing navigation item for ${id}`);
  return item;
};

const buscasNavItem: RailNavItem = { to: "/beeper", label: "Buscas", title: "Buscas — Alt+4", icon: <BeepersIcon /> };

const directoryNavSections: RailNavSection[] = [
  { label: "Doctor Negrín", items: [directoryNavItem, buscasNavItem] },
  { label: "Hospital Polivalente", items: [{ ...getCenterNavItem("hospital-polivalente"), label: "Polivalente" }] },
  { label: "Juan Carlos I", items: [getCenterNavItem("hjci")] },
  { label: "Otros centros", items: [getCenterNavItem("hsrg"), getCenterNavItem("cae-arucas"), getCenterNavItem("cae-galdar")] },
  { label: "Centros de Salud", items: [getCenterNavItem("health-centers"), getCenterNavItem("local-clinics")] },
  {
    label: "Unidad de Salud Mental",
    items: ["usm-canalejas", "usm-casa-del-mar", "usm-costa-ayala", "usm-la-feria"].map((id) => {
      const item = getCenterNavItem(id);
      return { ...item, label: `USM · ${item.label.replace("Unidad de Salud Mental de ", "")}` };
    })
  }
];

const mobileCenterNavSections = directoryNavSections.slice(1);

const bottomNavItems: RailNavItem[] = [
  { to: "/contacts/new", label: "Nuevo registro", title: "Nuevo registro — Alt+2", icon: <NewRecordIcon /> },
  { to: "/beeper/new", label: "Gestión Buscas", title: "Gestión Buscas", icon: <NewBeeperIcon /> },
  { to: "/settings", label: "Configuración", title: "Configuración — Alt+3", icon: <SettingsIcon /> }
];

const baseItemClasses =
  "focus-ring flex min-h-11 min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-[10px] px-1 text-center text-[10px] font-semibold leading-tight transition-colors sm:min-h-0 sm:flex-none sm:flex-row sm:text-left sm:text-[13px]";
const expandedItemClasses = "sm:min-h-10 sm:h-auto sm:w-full sm:justify-start sm:gap-[10px] sm:px-[11px]";
const compactExpandedItemClasses = "sm:min-h-8 sm:h-auto sm:w-full sm:justify-start sm:gap-2 sm:px-2";
const mobileCenterMenuItemClasses =
  "focus-ring flex min-h-11 items-center gap-2 rounded-[10px] px-3 text-left text-base font-semibold leading-tight transition-colors";
const activeItemClasses = "bg-scs-blue text-white";
const inactiveItemClasses = "bg-transparent text-white/55 hover:text-white/80";
const disabledItemClasses = "cursor-not-allowed bg-transparent text-white/40";
export const NAV_RAIL_HEIGHT_CSS_VAR = "--nav-rail-height";

const RailNavLink = ({ item, onNavigate, itemClasses = baseItemClasses, compact = false, disabled = false }: { item: RailNavItem; onNavigate?: () => void; itemClasses?: string; compact?: boolean; disabled?: boolean }) => {
  const setQuery = useAppStore((state) => state.setQuery);
  const clearsSearch = item.to === "/" || item.to.startsWith("/centers/") || item.to === "/beeper";
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (disabled) {
      event.preventDefault();
      return;
    }

    if (clearsSearch) setQuery("");
    onNavigate?.();
  };

  return (
  <NavLink
    to={item.to}
    end={item.to === "/beeper"}
    title={disabled ? `${item.title} — No disponible durante la migración` : item.title}
    aria-disabled={disabled || undefined}
    aria-label={disabled ? `${item.label} no disponible durante la migración` : undefined}
    tabIndex={disabled ? -1 : undefined}
    onClick={handleClick}
    className={({ isActive }) =>
      [itemClasses, compact ? compactExpandedItemClasses : expandedItemClasses, disabled ? disabledItemClasses : isActive ? activeItemClasses : inactiveItemClasses].join(" ")
    }
  >
    {item.icon}
    <span>{item.label}</span>
  </NavLink>
  );
};

const MobileCenterMenu = ({ disabled = false }: { disabled?: boolean }) => {
  const { pathname } = useLocation();
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const activeCenter = centerNavItems.find((item) => item.to === pathname);
  const summaryClasses = activeCenter ? activeItemClasses : "text-white/55 hover:text-white/80";

  useEffect(() => {
    if (detailsRef.current) detailsRef.current.open = false;
  }, [pathname]);

  if (disabled) {
    return (
      <span
        role="link"
        aria-disabled="true"
        aria-label="Centros no disponible durante la migración"
        className={`${baseItemClasses} w-full cursor-not-allowed ${disabledItemClasses} sm:hidden`}
      >
        <DirectoryIcon />
        <span>Centros</span>
      </span>
    );
  }

  return (
  <details ref={detailsRef} data-center-menu className="relative min-w-0 w-full sm:hidden">
    <summary className={`${baseItemClasses} w-full ${summaryClasses} list-none cursor-pointer [&::-webkit-details-marker]:hidden`}>
      <DirectoryIcon />
      <span>Centros</span>
    </summary>
    <div className="absolute bottom-[calc(100%+8px)] left-0 z-10 grid max-h-[calc(100dvh-var(--nav-rail-height,72px)-24px)] min-w-[192px] gap-3 overflow-y-auto rounded-xl bg-scs-ink p-2 shadow-lg">
      {mobileCenterNavSections.map((section) => (
        <section key={section.label} aria-label={section.label} className="grid gap-2 border-t border-white/15 pt-2 first:border-t-0 first:pt-0">
          {section.items.map((item) => (
            <RailNavLink key={item.to} item={item} itemClasses={mobileCenterMenuItemClasses} onNavigate={() => { if (detailsRef.current) detailsRef.current.open = false; }} />
          ))}
        </section>
      ))}
    </div>
  </details>
  );
};

export const NavRail = ({ disabled = false }: { disabled?: boolean }) => {
  const railRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const rail = railRef.current;
    if (!rail || typeof ResizeObserver === "undefined") return;

    const applyHeight = () => {
      document.documentElement.style.setProperty(NAV_RAIL_HEIGHT_CSS_VAR, `${rail.getBoundingClientRect().height}px`);
    };

    applyHeight();
    const observer = new ResizeObserver(applyHeight);
    observer.observe(rail);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={railRef}
      className="fixed inset-x-0 bottom-0 z-50 flex min-h-[72px] w-screen overflow-visible bg-scs-ink px-2 py-2 sm:sticky sm:inset-auto sm:top-0 sm:h-screen sm:w-[192px] sm:shrink-0 sm:flex-col sm:items-stretch sm:overflow-y-auto sm:overflow-x-hidden sm:px-[10px] sm:py-[14px]"
      style={{ gap: "6px" }}
    >
      <div className="hidden h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-scs-blue text-[11px] font-bold text-white sm:flex">
        HA
      </div>

      <nav
        aria-label="Navegación principal"
        className="grid min-w-0 flex-1 grid-cols-6 items-stretch sm:flex sm:flex-col sm:items-stretch"
        style={{ gap: "6px" }}
      >
        <div data-navigation-sections="desktop" className="hidden sm:flex sm:flex-col sm:gap-3">
          {directoryNavSections.map((section) => (
            <section key={section.label} aria-label={section.label} className="flex flex-col gap-1 border-t border-white/15 pt-3 first:border-t-0 first:pt-0">
              {section.items.map((item) => (
                <RailNavLink key={item.to} item={item} compact disabled={disabled} />
              ))}
            </section>
          ))}
        </div>
        <div className="contents sm:hidden">
          <RailNavLink item={directoryNavItem} disabled={disabled} />
          <MobileCenterMenu disabled={disabled} />
          <RailNavLink item={buscasNavItem} disabled={disabled} />
        </div>
        <div aria-hidden="true" className="hidden sm:block sm:flex-1" />
        {bottomNavItems.map((item) => (
          <RailNavLink key={item.to} item={item} disabled={disabled} />
        ))}
      </nav>
    </div>
  );
};
