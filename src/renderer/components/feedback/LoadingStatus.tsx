/**
 *  /  — shared primitive for the `role="status" aria-live="polite"`
 * + "Cargando…" loading pattern that was hand-rewritten independently across
 * App.tsx, DirectoryPage.tsx, RecordFormPage.tsx, BuscasPage.tsx,
 * SettingsPage.tsx and DataManagementSection.tsx.
 *
 * Intentionally narrow: this only covers the simple "one-line loading
 * message in a status region" case those call sites already shared. It is
 * not a replacement for `StatePanel` (error/empty states with title+message)
 * or the bespoke spinner-based loading state in DeduplicatePage.
 */
type LoadingStatusProps = {
  message: string;
  /** Defaults to the most common call-site className (rounded panel, p-8). */
  className?: string;
  /** Sets `aria-busy`. Omitted call sites simply don't render the attribute. */
  busy?: boolean;
};

export const LoadingStatus = ({
  message,
  className = "rounded-3xl bg-white p-8 shadow-panel",
  busy
}: LoadingStatusProps) => (
  <section role="status" aria-live="polite" aria-busy={busy} className={className}>
    {message}
  </section>
);
