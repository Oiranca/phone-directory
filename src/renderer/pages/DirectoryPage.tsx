import { useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAppStore, selectVisibleRecords } from "../store/useAppStore";
import { getPhonePrivacyFlags, getPreferredResultPhone } from "../services/search.service";
import type { PrivacyFlag } from "../services/search.service";
import type { PhoneContact, SocialContact, SocialPlatform } from "../../shared/types/contact";
import { APP_HEADER_HEIGHT_CSS_VAR } from "../components/layout/AppShell";
import { LoadingStatus } from "../components/feedback/LoadingStatus";
import { StatePanel } from "../components/feedback/StatePanel";
import { normalizeDisplayName } from "../../shared/utils/matching";
import { formatLocationFloor, formatLocationRoom } from "../../shared/utils/contacts";
import { useRovingTabIndex } from "../hooks/useRovingTabIndex";

// CSS custom property tracking the rendered height of the sticky
// search/filter bar below, kept in sync via ResizeObserver. Used together with
// APP_HEADER_HEIGHT_CSS_VAR to bound the list/detail columns to the actually
// available viewport height instead of a hardcoded per-breakpoint guess.
const FILTER_BAR_HEIGHT_CSS_VAR = "--directory-filterbar-height";

// Residual page-scroll fix: the vertical "chrome" left over once the
// header and filter bar heights are subtracted from 100vh — i.e. <main>'s own
// top+bottom padding (py-5/sm:py-6/lg:py-8 in AppShell) plus the gap-5 this
// page's root <section> puts between the filter bar and the list/detail row.
// This MUST track those exact Tailwind breakpoints or the bounded columns'
// max-height calc silently under-subtracts and the page grows taller than the
// viewport (the previous flat 3.5rem constant undershot the real lg-breakpoint
// total of 5.25rem by 1.75rem, which is exactly the page-level scroll that
// showed up at typical desktop widths, since lg: applies from 1024px width
// regardless of window height). Defined as a real CSS custom property (via
// Tailwind's responsive arbitrary-property syntax on the root <section> below)
// so it resolves with plain CSS media queries — same breakpoints as <main>'s
// padding — instead of a JS media-query guess that could fall out of sync.
const PAGE_CHROME_CSS_VAR = "--directory-page-chrome";

// A service/area value is only worth its own line when it adds
// information beyond the displayName already shown above it — several real
// records (e.g. "Helipuerto (Secretaría)") have a `service` value that is a
// verbatim duplicate of displayName, which otherwise renders as a redundant
// repeated line right under the title. Case/whitespace-insensitive equality
// is enough here — no fuzzy matching needed, this is only meant to catch
// literal duplicates, not near-misses.
const isDuplicateOfDisplayName = (value: string | null | undefined, displayName: string): boolean =>
  typeof value === "string" && value.trim().toLowerCase() === displayName.trim().toLowerCase();

// Exact equality (isDuplicateOfDisplayName) isn't enough to catch
// cases like service="Cocina Francisco Artíles" / displayName="Francisco
// Artíles" — service already contains the full name as a substring, so
// composing "{service} - {displayName}" still renders a visible duplication
// ("Cocina Francisco Artíles - Francisco Artíles"). Compares using the
// shared NFKD normalizer (normalizeDisplayName) so the check is both
// case- and accent-insensitive.
const serviceContainsDisplayName = (service: string, displayName: string): boolean => {
  const normalizedDisplayName = normalizeDisplayName(displayName);
  return normalizedDisplayName.length > 0 && normalizeDisplayName(service).includes(normalizedDisplayName);
};

// The service alone (e.g. "Alergia") is often the detail that makes
// a contact identifiable at a glance, but it was buried inside the card body
// instead of the title. Compose "{service} - {displayName}" when the service
// adds real context beyond what it already states.
//
// "Adds real context" means service does NOT already contain
// displayName as a substring (case/accent-insensitive) — a strict superset
// of the exact-equality case above, so "Helipuerto (Secretaría)" (whose
// service exactly duplicates displayName) still keeps its title unchanged,
// and "Cocina Francisco Artíles" (whose service merely contains displayName)
// now renders as just "Cocina Francisco Artíles" instead of duplicating the
// name a second time.
const buildDisplayTitle = (displayName: string, organization: { service?: string }): string => {
  const { service } = organization;
  if (!service) {
    return displayName;
  }
  return serviceContainsDisplayName(service, displayName) ? service : `${service} - ${displayName}`;
};

// The offset at which the sticky filter bar itself should stick — right below
// the sticky app header. Must NOT include the filter bar's own height, or the
// bar would push itself further down by that amount every time it renders.
const FILTER_BAR_STICKY_TOP = `var(${APP_HEADER_HEIGHT_CSS_VAR}, 0px)`;

// The offset at which the results list / detail panel should start (right
// below the sticky app header + sticky filter bar), and the vertical breathing
// room (page padding + inter-section gaps) to subtract from 100vh when
// bounding their max-height.
const STICKY_CONTENT_TOP = `calc(var(${APP_HEADER_HEIGHT_CSS_VAR}, 0px) + var(${FILTER_BAR_HEIGHT_CSS_VAR}, 0px) + 1.5rem)`;
const BOUNDED_CONTENT_MAX_HEIGHT = `calc(100vh - var(${APP_HEADER_HEIGHT_CSS_VAR}, 0px) - var(${FILTER_BAR_HEIGHT_CSS_VAR}, 0px) - var(${PAGE_CHROME_CSS_VAR}, 3.75rem))`;

const privacyInlineRiskText = {
  Confidencial: "Número interno confidencial.",
  "No facilitar a pacientes": "No compartir con pacientes."
} as const;

// Quick-search shortcuts for the 8 known ODS "book" sheets that are
// already tagged via `organization.department` (an indexed, weight-5
// Fuse.js search key — see search.service.ts). These are plain shortcuts
// that set the SAME `query` state the free-text search input controls; no
// new filter mechanism is introduced. Order matches the source ODS sheets.
const BOOK_SHORTCUTS = [
  "Sindicatos",
  "UMI",
  "Rehabilitación",
  "Quirófanos",
  "Corporativos",
  "Telecomunicaciones",
  "Almacenes",
  "Juan Carlos 1º"
] as const;

const RESULTS_PER_PAGE = 10;
const PAGINATION_WINDOW = 3;

const getPageRange = (startPage: number, length: number): number[] =>
  Array.from({ length }, (_, index) => startPage + index);

const getPaginationItems = (currentPage: number, totalPages: number): Array<number | "ellipsis-left" | "ellipsis-right"> => {
  if (totalPages <= PAGINATION_WINDOW + 2) {
    return getPageRange(1, totalPages);
  }

  if (currentPage <= PAGINATION_WINDOW) {
    return [...getPageRange(1, PAGINATION_WINDOW), "ellipsis-right", totalPages];
  }

  const trailingWindowStart = totalPages - (PAGINATION_WINDOW - 1);
  if (currentPage >= trailingWindowStart) {
    return [1, "ellipsis-left", ...getPageRange(trailingWindowStart, PAGINATION_WINDOW)];
  }

  const middleWindowStart = currentPage - Math.floor(PAGINATION_WINDOW / 2);
  return [1, "ellipsis-left", ...getPageRange(middleWindowStart, PAGINATION_WINDOW), "ellipsis-right", totalPages];
};

const socialPlatformLabels: Record<SocialPlatform, string> = {
  instagram: "Instagram",
  twitter: "Twitter / X",
  facebook: "Facebook",
  linkedin: "LinkedIn",
  youtube: "YouTube",
  tiktok: "TikTok",
  web: "Sitio web",
  other: "Otro"
};

/**
 * Derives a safe external URL for a social contact.
 * XSS-safe approach: only `http:` and `https:` schemes are allowed.
 * For handle-only entries, a platform-specific base URL is used.
 * Returns null when no safe URL can be derived.
 */
const SAFE_SOCIAL_BASE_URLS: Partial<Record<SocialPlatform, string>> = {
  instagram: "https://instagram.com/",
  twitter: "https://twitter.com/",
  facebook: "https://facebook.com/",
  linkedin: "https://linkedin.com/in/",
  youtube: "https://youtube.com/@",
  tiktok: "https://tiktok.com/@"
};

const ALLOWED_URL_SCHEMES = new Set(["https:", "http:"]);

const getSafeSocialUrl = (social: SocialContact): string | null => {
  // Prefer explicit URL when present.
  if (social.url) {
    try {
      const parsed = new URL(social.url);
      if (ALLOWED_URL_SCHEMES.has(parsed.protocol)) {
        return social.url;
      }
    } catch {
      // Malformed URL — fall through to handle derivation.
    }
  }

  // Derive from handle + platform base URL.
  if (social.handle) {
    const base = SAFE_SOCIAL_BASE_URLS[social.platform];
    if (base) {
      // Encode the handle to prevent injection via handle values.
      return `${base}${encodeURIComponent(social.handle)}`;
    }
    // For platforms without a known base URL (web, other), attempt to treat
    // the handle itself as a direct URL if it is http(s):.
    try {
      const parsed = new URL(social.handle);
      if (ALLOWED_URL_SCHEMES.has(parsed.protocol)) {
        return social.handle;
      }
    } catch {
      // Not a valid URL — fall through to null (rendered as plain text).
    }
  }

  return null;
};

// The list-card "Privacidad sensible" badge must reflect ANY
// sensitive phone on the record, not just the single "preferred" phone whose
// number is shown (getPreferredResultPhone intentionally favors a non-sensitive
// number for display, so a record's ONLY sensitive phone can be a secondary one
// that never becomes "preferred"). Scoping this check to the preferred phone
// alone made the badge silently miss records where the just-edited phone
// wasn't the one being displayed — looking stale until something else (e.g. a
// different phone becoming preferred, or a full reload re-deriving state)
// happened to surface it. Checking every phone on the record keeps the number
// shown privacy-conscious while making the aggregate warning badge accurate
// and immediate.
const getPhoneInlinePrivacyFlags = (phones: PhoneContact[]): PrivacyFlag[] => {
  const flags: PrivacyFlag[] = [];

  if (phones.some((phone) => phone.confidential)) {
    flags.push("Confidencial");
  }

  if (phones.some((phone) => phone.noPatientSharing)) {
    flags.push("No facilitar a pacientes");
  }

  return flags;
};

export const DirectoryPage = () => {
  const {
    contacts,
    settings,
    query,
    selectedRecordId,
    setQuery,
    setSelectedRecordId,
    isLoading,
    ensureBootstrapLoaded
  } = useAppStore();
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    void ensureBootstrapLoaded();
  }, []);
  const deferredQuery = useDeferredValue(query);
  // Filters removed from the UI — only free-text search remains.
  // `showInactive: true` keeps every record (active + inactive) visible since
  // there is no longer any UI control to distinguish or hide by status.
  const visibleRecords = useMemo(
    () =>
      selectVisibleRecords(
        contacts?.records ?? [],
        deferredQuery,
        { selectedType: "all", selectedArea: "all", selectedTags: [], showInactive: true }
      ),
    [contacts, deferredQuery]
  );
  const totalPages = Math.max(1, Math.ceil(visibleRecords.length / RESULTS_PER_PAGE));
  const pageStart = (currentPage - 1) * RESULTS_PER_PAGE;
  const currentPageRecords = useMemo(
    () => visibleRecords.slice(pageStart, pageStart + RESULTS_PER_PAGE),
    [visibleRecords, pageStart]
  );
  const paginationItems = getPaginationItems(currentPage, totalPages);

  useEffect(() => {
    setCurrentPage(1);
  }, [deferredQuery]);

  useEffect(() => {
    setCurrentPage((page) => Math.min(page, totalPages));
  }, [totalPages]);

  useEffect(() => {
    if (currentPageRecords.length === 0) {
      if (selectedRecordId !== null) {
        setSelectedRecordId(null);
      }
      return;
    }

    const hasSelectedRecordOnPage = currentPageRecords.some((record) => record.id === selectedRecordId);

    if (!hasSelectedRecordOnPage) {
      setSelectedRecordId(currentPageRecords[0]!.id);
    }
  }, [currentPageRecords, selectedRecordId, setSelectedRecordId]);

  const listRef = useRef<HTMLUListElement>(null);
  const detailRef = useRef<HTMLElement>(null);
  const filterBarRef = useRef<HTMLDivElement>(null);

  // Keep --directory-filterbar-height in sync with the sticky filter
  // bar's real rendered height (it grows when active-filter chips appear).
  // Guarded for environments without ResizeObserver (e.g. jsdom in tests).
  useLayoutEffect(() => {
    const filterBarEl = filterBarRef.current;
    if (!filterBarEl || typeof ResizeObserver === "undefined") {
      return;
    }

    const applyHeight = () => {
      document.documentElement.style.setProperty(FILTER_BAR_HEIGHT_CSS_VAR, `${filterBarEl.getBoundingClientRect().height}px`);
    };

    applyHeight();
    const observer = new ResizeObserver(applyHeight);
    observer.observe(filterBarEl);

    return () => observer.disconnect();
  }, []);

  // Focuses (and smooth-scrolls into view) the list item button for
  // `recordId`, deferred to the next animation frame so the DOM has settled
  // after the selection state update that precedes this call.
  const focusRecordButton = (recordId: string) => {
    requestAnimationFrame(() => {
      const button = listRef.current?.querySelector<HTMLButtonElement>(
        `[data-record-id="${CSS.escape(recordId)}"]`
      );
      button?.focus();
      if (button && typeof button.scrollIntoView === "function") {
        button.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    });
  };

  const handleRovingKeyDown = useRovingTabIndex({ enableHomeEnd: true });

  const handleListKeyDown = (event: React.KeyboardEvent<HTMLUListElement>) => {
    handleRovingKeyDown(event, {
      itemIds: currentPageRecords.map((record) => record.id),
      fallbackId: selectedRecordId,
      onNavigate: (id) => {
        setSelectedRecordId(id);
        focusRecordButton(id);
      },
      onEnter: () => {
        // Do not call preventDefault() here — let native button activation (Enter/Space) proceed.
        // Schedule scroll via setTimeout macrotask to execute after the button click handler completes.
        setTimeout(() => {
          if (detailRef.current && typeof detailRef.current.scrollIntoView === "function") {
            detailRef.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
          }
        }, 0);
      },
      onEscape: () => {
        if (selectedRecordId !== null) {
          const activeButton = listRef.current?.querySelector<HTMLButtonElement>(
            `[data-record-id="${CSS.escape(selectedRecordId)}"]`
          );
          activeButton?.focus();
        }
      }
    });
  };

  const handleDetailKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "Escape" && selectedRecordId !== null) {
      event.preventDefault();
      const selectedButton = listRef.current?.querySelector<HTMLButtonElement>(
        `[data-record-id="${CSS.escape(selectedRecordId)}"]`
      );
      selectedButton?.focus();
    }
  };

  if (isLoading || !contacts || !settings) {
    return <LoadingStatus message="Cargando datos locales…" busy />;
  }

  const selectedRecord =
    currentPageRecords.find((record) => record.id === selectedRecordId) ?? currentPageRecords[0] ?? null;
  const selectedRecordPrivacyFlags = selectedRecord ? getPhonePrivacyFlags(selectedRecord) : [];

  return (
    <section
      aria-labelledby="directory-page-title"
      // --directory-page-chrome mirrors AppShell's <main> vertical
      // padding (py-5 / sm:py-6 / lg:py-8) plus this section's own gap-5,
      // breakpoint-for-breakpoint, so BOUNDED_CONTENT_MAX_HEIGHT's 100vh
      // subtraction always matches the real rendered chrome — see the
      // PAGE_CHROME_CSS_VAR comment above for the exact math.
      className="flex flex-col gap-5 [--directory-page-chrome:3.75rem] sm:[--directory-page-chrome:4.25rem] lg:[--directory-page-chrome:5.25rem]"
    >
      {/* Search Header — sticky: stays visible below the app header while
          the results list/detail panel scroll. */}
      <div
        ref={filterBarRef}
        style={{ top: FILTER_BAR_STICKY_TOP }}
        className="sticky z-30 rounded-3xl bg-white p-4 shadow-panel sm:p-5"
      >
        <div className="flex flex-col gap-4">
          <h2 id="directory-page-title" className="sr-only">Búsqueda de contactos</h2>
          {/* Filters removed — only the free-text search remains. */}
          <div className="flex flex-col gap-3 md:flex-row md:items-end">
            <div className="flex-1">
              <label htmlFor="directory-search" className="sr-only">
                Buscar contactos
              </label>
              <input
                id="directory-search"
                data-page-search
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Buscar contacto o servicio"
                type="search"
                title="Buscar contactos — pulsa / para enfocar"
                className="w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm outline-none ring-scs-blue transition focus-visible:border-scs-blue focus-visible:bg-white focus-visible:ring-2"
              />
            </div>
          </div>
          {/* Quick-search shortcuts for the 8 known ODS "book" sheets.
              Clicking a chip sets `query` (the same state the search input above
              controls) to the exact department name, reusing the existing
              free-text search — no new filter mechanism. Clicking the active
              chip again clears the query back to an unfiltered view. */}
          <div className="flex flex-wrap gap-2" role="group" aria-label="Accesos rápidos por libro">
            {BOOK_SHORTCUTS.map((book) => {
              const isActive = query === book;
              return (
                <button
                  key={book}
                  type="button"
                  onClick={() => setQuery(isActive ? "" : book)}
                  aria-pressed={isActive}
                  className={[
                    "focus-ring rounded-full border px-3 py-1.5 text-xs font-semibold transition",
                    isActive
                      ? "border-scs-blue bg-scs-blue text-white shadow-sm"
                      : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                  ].join(" ")}
                >
                  {book}
                </button>
              );
            })}
          </div>
          <p
            role="status"
            aria-live="polite"
            aria-atomic="true"
            className="text-xs font-medium text-slate-500"
          >
            {visibleRecords.length} resultados
          </p>
        </div>
      </div>

      {/* Main Layout: List (Left) / Detail (Right) */}
      <div className="grid items-start gap-6 lg:grid-cols-[340px_minmax(0,1fr)] xl:grid-cols-[380px_minmax(0,1fr)]">
        
        {/* Left Column: Results List */}
        {/* The height budget is bounded on THIS column, not just the
            <ul>, so the pagination nav below is always part of the same bounded
            box and never pushed below the fold. The <ul> is a flex child
            (flex-1 min-h-0) that only shrinks and scrolls internally for the
            leftover space once the (always-visible) pagination nav is accounted
            for — previously the nav sat outside the bounded area entirely, so it
            was only reachable via page-level scroll that the internal list's own
            scrollbar silently absorbed. */}
        <div style={{ maxHeight: BOUNDED_CONTENT_MAX_HEIGHT }} className="flex min-h-0 flex-col gap-3">
          <ul
            ref={listRef}
            onKeyDown={handleListKeyDown}
            aria-label="Resultados del directorio"
            // overflow-y-auto turns this into a scroll container, which
            // also computes overflow-x to "auto" per spec and clips any ink outside the
            // padding box — including the selected card's `ring-1 ring-scs-blue` box
            // shadow, which was getting cut off on the left/right edges since the list
            // previously had 0 left padding and only 4px (pr-1) on the right. `px-1`
            // gives the 1px ring room to render fully on both sides; `-mx-1` cancels
            // that padding back out at the box level so the cards stay visually flush
            // with the pagination nav and other siblings below (same rendered width).
            //
            // Follow-up: the same clipping happens on the TOP/BOTTOM edges
            // — the scroll container's padding-box boundary (where scrolling starts
            // and ends) clips the ring's box-shadow there too, most visibly on the
            // first/last card. `py-1 -my-1` mirrors the horizontal fix vertically.
            // This <ul> is `flex-1` with `flex-basis: 0%` inside a `min-h-0` flex
            // column, so its rendered (margin-box) height is whatever main-axis space
            // is left over after the sibling empty-state/pagination nav and `gap-3`
            // are accounted for — that leftover amount is fixed by the flex layout,
            // not by this element's own padding/margin. Pulling in `-my-1` frees up
            // 4px top+bottom from the margin box, which flex-grow then hands straight
            // back to this item's border-box height (net height unchanged), and
            // `py-1` claims that same 4px as padding so the ring has room to render.
            // The <ul>'s outer edges — and therefore the overall bounded column's
            // height budget from BOUNDED_CONTENT_MAX_HEIGHT — are unaffected, so this
            // cannot reintroduce the page-level scroll fixed by the max-height/
            // min-h-0/overflow-y-auto pattern above (verified by the zero-page-scroll
            // e2e assertion).
            className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-1 py-1 -mx-1 -my-1"
          >
          {currentPageRecords.map((record) => {
            const primaryPhone = getPreferredResultPhone(record);
            const isSelected = record.id === selectedRecord?.id;
            const privacyFlags = getPhoneInlinePrivacyFlags(record.contactMethods.phones);
            // Subtitle combines the contact's name (unless it's just a
            // duplicate of organization.service, which happens for ODS-imported
            // records whose blank "Nombre" column fell back to the service
            // value) and their role/job title (ODS "Categoría"), joined with
            // " · " when both are present. Degrades gracefully to nothing when
            // neither is set.
            const nameLine = isDuplicateOfDisplayName(record.organization.service, record.displayName)
              ? null
              : record.displayName;
            const categoryLine = record.organization.role || null;
            const subtitle = [nameLine, categoryLine].filter(Boolean).join(" · ");

            return (
              <li key={record.id}>
                <button
                  type="button"
                  data-record-id={record.id}
                  onClick={() => setSelectedRecordId(record.id)}
                  aria-pressed={isSelected}
                  className={[
                    "w-full rounded-2xl border p-4 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-scs-blue focus-visible:ring-offset-2",
                    isSelected
                      ? "border-scs-blue bg-scs-mist shadow-sm ring-1 ring-scs-blue"
                      : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50 shadow-panel"
                  ].join(" ")}
                >
                  <div className="min-w-0">
                    {/* Prefix the title with the service when it adds context
                        beyond displayName (see buildDisplayTitle). */}
                    <h3 className="truncate font-semibold text-scs-blueDark">
                      {buildDisplayTitle(record.displayName, record.organization)}
                    </h3>
                  </div>
                  {/* Subtitle: name (unless duplicate of service) and role,
                      joined with " · " — renders nothing when both are absent. */}
                  {subtitle ? <p className="mt-2 truncate text-sm text-slate-600">{subtitle}</p> : null}
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-medium text-slate-700">{primaryPhone?.number ?? "Sin teléfono"}</span>
                    {privacyFlags.length > 0 && (
                      <span className="inline-flex items-center gap-2 rounded-full bg-amber-100 px-2.5 py-1 text-xs font-semibold text-amber-900" title="Atención de privacidad">
                        <span className="inline-flex h-2 w-2 rounded-full bg-amber-500" aria-hidden="true"></span>
                        <span>Privacidad sensible</span>
                      </span>
                    )}
                  </div>
                </button>
              </li>
            );
          })}
          </ul>
          {visibleRecords.length === 0 && contacts.records.length === 0 && (
            <StatePanel title="Sin contactos" message="La agenda está vacía. Añade el primer contacto para empezar." />
          )}
          {visibleRecords.length === 0 && contacts.records.length > 0 && (
            <StatePanel title="Sin resultados" message="No se han encontrado resultados para esta búsqueda." />
          )}
          {visibleRecords.length > RESULTS_PER_PAGE && (
            <nav aria-label="Paginación de resultados" className="shrink-0 rounded-2xl border border-slate-200 bg-white p-2">
              <div className="flex flex-wrap items-center justify-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
                  disabled={currentPage === 1}
                  aria-label="Página anterior"
                  className="focus-ring flex h-10 w-10 items-center justify-center rounded-xl text-slate-600 transition hover:bg-slate-50 hover:text-slate-700 disabled:cursor-default disabled:opacity-30"
                >
                  <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5">
                    <path d="m12.5 4.5-5 5 5 5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
                  </svg>
                </button>
                <div className="flex flex-wrap items-center justify-center gap-1.5">
                  {paginationItems.map((item) => {
                    if (typeof item !== "number") {
                      return (
                        <span key={item} aria-hidden="true" className="px-1 text-sm font-semibold text-slate-400">
                          ...
                        </span>
                      );
                    }

                    return (
                      <button
                        key={item}
                        type="button"
                      onClick={() => setCurrentPage(item)}
                      aria-current={item === currentPage ? "page" : undefined}
                      aria-label={`Ir a la página ${item}`}
                      className={[
                          "focus-ring flex h-10 min-w-10 items-center justify-center rounded-xl px-3 text-sm font-semibold transition",
                          item === currentPage
                            ? "bg-scs-blue text-white shadow-sm"
                            : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
                      ].join(" ")}
                    >
                      {item}
                      </button>
                    );
                  })}
                </div>
                <button
                  type="button"
                  onClick={() => setCurrentPage((page) => Math.min(totalPages, page + 1))}
                  disabled={currentPage === totalPages}
                  aria-label="Página siguiente"
                  className="focus-ring flex h-10 w-10 items-center justify-center rounded-xl text-slate-600 transition hover:bg-slate-50 hover:text-slate-700 disabled:cursor-default disabled:opacity-30"
                >
                  <svg aria-hidden="true" viewBox="0 0 20 20" className="h-5 w-5">
                    <path d="m7.5 4.5 5 5-5 5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8" />
                  </svg>
                </button>
              </div>
            </nav>
          )}
        </div>

        {/* Right Column: Detail View (Sticky) */}
        <section
          ref={detailRef}
          aria-label="Detalle del registro seleccionado"
          onKeyDown={handleDetailKeyDown}
          style={{ top: STICKY_CONTENT_TOP }}
          className="lg:sticky"
        >
          {/* Bounded to the available viewport height with overflow-y-auto
              — no scrollbar appears while content fits; it only scrolls internally
              (never growing the page) when a record has enough phones/emails/socials
              to genuinely overflow. */}
          <div
            style={{ maxHeight: BOUNDED_CONTENT_MAX_HEIGHT }}
            className="overflow-y-auto rounded-3xl bg-white p-6 shadow-panel sm:p-8"
          >
            <h3 className="mb-5 text-xs font-semibold uppercase tracking-[0.22em] text-slate-600">Detalle del registro</h3>
            {selectedRecord ? (
              <div className="space-y-6">
                <div className="rounded-[28px] bg-slate-50/80 p-5 ring-1 ring-slate-100 sm:p-6">
                  <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0">
                      {/* The type pill (e.g. "SERVICIO") was removed as noise —
                          only render this row (and its top margin to the title below)
                          when there's an actual privacy-flag pill to show. */}
                      {selectedRecordPrivacyFlags.length > 0 && (
                        <div className="flex flex-wrap items-center gap-2">
                          {selectedRecordPrivacyFlags.map((flag) => (
                            <span
                              key={flag}
                              className="rounded-full border border-red-200 bg-red-100 px-3 py-1 text-xs font-semibold text-red-700"
                            >
                              {flag}
                            </span>
                          ))}
                        </div>
                      )}
                      {/* Prefix the title with the service when it adds context
                          beyond displayName (see buildDisplayTitle). */}
                      <h4 className="mt-4 max-w-4xl text-xl font-semibold leading-tight text-scs-blueDark sm:text-2xl">
                        {buildDisplayTitle(selectedRecord.displayName, selectedRecord.organization)}
                      </h4>
                      {/* Role/job title (ODS "Categoría") shown alongside the
                          detail header so it's visible without extra clicks. */}
                      {selectedRecord.organization.role ? (
                        <p className="mt-1 text-sm font-medium text-slate-600">{selectedRecord.organization.role}</p>
                      ) : null}
                    </div>
                    <Link
                      to={`/contacts/${selectedRecord.id}/edit`}
                      aria-label={`Editar registro: ${selectedRecord.displayName}`}
                      className="focus-ring inline-flex min-h-11 shrink-0 items-center justify-center self-start whitespace-nowrap rounded-2xl bg-slate-900 px-5 py-3 text-sm font-semibold text-white transition hover:bg-slate-800"
                    >
                      Editar registro
                    </Link>
                  </div>
                </div>

                {/* Promoted from a conditional inline subtitle to its
                    own always-visible card, matching Ubicación below — the composed
                    title (buildDisplayTitle) can obscure or reshape the raw name, so the
                    canonical displayName should always be visible on its own, not just
                    when the title happens to be composed.

                    Regression fix: an earlier version rendered selectedRecord.displayName
                    unconditionally, which duplicates the Servicio value whenever
                    displayName is not a genuinely distinct name (e.g. a blank ODS
                    "Nombre" column falls back to the service label itself — see
                    normalizeServiceSheet).

                    Follow-up correction: that regression fix gated this on serviceContainsDisplayName
                    (the broader substring check meant only for title-composition
                    dedup in buildDisplayTitle), which wrongly hid genuine names whose
                    service happens to contain them as a substring for unrelated
                    data-entry reasons (e.g. displayName="Francisco Artíles" /
                    service="Cocina Francisco Artíles" — a real, distinct name, not a
                    fallback copy). The "blank Nombre column falls back to service
                    verbatim" case always produces an EXACT match, never a partial
                    one, so the correct check here is isDuplicateOfDisplayName
                    (the exact-equality helper above), not serviceContainsDisplayName.
                    buildDisplayTitle's use of serviceContainsDisplayName for title
                    composition is a separate concern and is unaffected. */}
                <div className="rounded-2xl border border-slate-200 bg-white p-5">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Nombre y Apellidos</p>
                  <p className="mt-3 break-words text-sm font-medium leading-6 text-slate-800 [overflow-wrap:anywhere]">
                    {isDuplicateOfDisplayName(selectedRecord.organization.service, selectedRecord.displayName)
                      ? "Sin nombre y apellidos registrado"
                      : selectedRecord.displayName}
                  </p>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-white p-5">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Ubicación</p>
                  <p className="mt-3 break-words text-sm font-medium leading-6 text-slate-800 [overflow-wrap:anywhere]">
                    {[
                      selectedRecord.location?.building,
                      formatLocationFloor(selectedRecord.location?.floor),
                      formatLocationRoom(selectedRecord.location?.room),
                      selectedRecord.location?.text
                    ]
                      .filter(Boolean)
                      .join(" · ") || "Sin ubicación detallada"}
                  </p>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Teléfonos</p>
                    <p className="text-xs font-medium text-slate-600">
                      {selectedRecord.contactMethods.phones.length}{" "}
                      {selectedRecord.contactMethods.phones.length === 1 ? "disponible" : "disponibles"}
                    </p>
                  </div>
                  <div className="grid gap-3 xl:grid-cols-2">
                    {selectedRecord.contactMethods.phones.map((phone) => (
                      <div key={phone.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0">
                          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{phone.label ?? "Teléfono"}</p>
                          <p className="mt-2 text-3xl font-semibold leading-none text-scs-blueDark">{phone.number}</p>
                          {phone.extension && <p className="mt-2 text-sm font-medium text-slate-600">Extensión {phone.extension}</p>}
                          {phone.notes && <p className="mt-1 break-words text-sm text-slate-500 [overflow-wrap:anywhere]">{phone.notes}</p>}
                        </div>
                          <div className="flex flex-wrap gap-2 shrink-0">
                            {phone.isPrimary && (
                              <span className="rounded-full bg-scs-mist px-3 py-1.5 text-xs font-semibold text-scs-blueDark">
                                Principal
                              </span>
                            )}
                          </div>
                        </div>
                        <div className="mt-4 flex flex-wrap gap-2">
                          {phone.confidential && (
                            <span className="rounded-full bg-red-100 px-3 py-1 text-xs font-semibold text-red-700 border border-red-200">
                              Confidencial
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                  {selectedRecord.contactMethods.phones.length === 0 && (
                    <p className="text-sm text-slate-500 italic">No hay teléfonos registrados.</p>
                  )}
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Correos electrónicos</p>
                    <p className="text-xs font-medium text-slate-600">
                      {selectedRecord.contactMethods.emails.length}{" "}
                      {selectedRecord.contactMethods.emails.length === 1 ? "disponible" : "disponibles"}
                    </p>
                  </div>
                  <div className="grid gap-3 xl:grid-cols-2">
                    {selectedRecord.contactMethods.emails.map((email) => (
                      <div key={email.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0">
                            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{email.label ?? "Correo electrónico"}</p>
                            <p className="mt-2 break-words text-lg font-semibold text-scs-blueDark [overflow-wrap:anywhere]">
                              {email.address}
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-2 shrink-0">
                            {email.isPrimary ? (
                              <span className="rounded-full bg-scs-mist px-3 py-1.5 text-xs font-semibold text-scs-blueDark">
                                Principal
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                  {selectedRecord.contactMethods.emails.length === 0 && (
                    <p className="text-sm text-slate-500 italic">No hay correos registrados.</p>
                  )}
                </div>

                {(selectedRecord.contactMethods.socials ?? []).length > 0 && (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Redes sociales</p>
                      <p className="text-xs font-medium text-slate-600">
                        {(selectedRecord.contactMethods.socials ?? []).length}{" "}
                        {(selectedRecord.contactMethods.socials ?? []).length === 1 ? "disponible" : "disponibles"}
                      </p>
                    </div>
                    <div className="grid gap-3 xl:grid-cols-2">
                      {(selectedRecord.contactMethods.socials ?? []).map((social) => {
                        const safeUrl = getSafeSocialUrl(social);
                        return (
                          <div key={social.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                              <div className="min-w-0">
                                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                                  {social.label ?? socialPlatformLabels[social.platform]}
                                </p>
                                {/* XSS-safe: only render anchor when URL passes scheme allowlist.
                                    Never use dangerouslySetInnerHTML. React auto-escapes text nodes. */}
                                {safeUrl ? (
                                  <a
                                    href={safeUrl}
                                    onClick={(event) => {
                                      event.preventDefault();
                                      // In Electron, open external URLs through the IPC-safe path.
                                      // window.open with noopener is the renderer-safe fallback.
                                      window.open(safeUrl, "_blank", "noopener,noreferrer");
                                    }}
                                    rel="noopener noreferrer"
                                    className="mt-2 block break-words text-base font-semibold text-scs-blue underline underline-offset-2 hover:text-scs-blueDark [overflow-wrap:anywhere]"
                                  >
                                    {social.handle ?? safeUrl}
                                  </a>
                                ) : (
                                  <p className="mt-2 break-words text-base font-semibold text-scs-blueDark [overflow-wrap:anywhere]">
                                    {social.handle ?? social.url ?? "—"}
                                  </p>
                                )}
                              </div>
                              <div className="flex flex-wrap gap-2 shrink-0">
                                {social.isPrimary ? (
                                  <span className="rounded-full bg-scs-mist px-3 py-1.5 text-xs font-semibold text-scs-blueDark">
                                    Principal
                                  </span>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {selectedRecord.notes && (
                  <div className="rounded-2xl border border-slate-200 bg-slate-50/80 p-5">
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Notas</p>
                    <p className="mt-3 break-words whitespace-pre-wrap text-sm font-medium leading-6 text-slate-800 [overflow-wrap:anywhere]">
                      {selectedRecord.notes}
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex h-64 flex-col items-center justify-center text-center">
                <div className="rounded-full bg-slate-50 p-4 mb-4">
                  <svg aria-hidden="true" className="h-8 w-8 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" />
                  </svg>
                </div>
                <p className="text-base font-medium text-slate-600">Selecciona un registro</p>
                <p className="mt-1 text-sm text-slate-500">Haz clic en un resultado de la lista para ver su detalle.</p>
              </div>
            )}
          </div>
        </section>
      </div>
    </section>
  );
};
