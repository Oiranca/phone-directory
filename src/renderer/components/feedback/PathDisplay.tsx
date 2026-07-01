import { useEffect, useRef, useState } from "react";

/** Extract the last non-empty path segment (basename) from any absolute or relative path.
 *  Handles trailing separators (e.g. "/foo/bar/") and both POSIX/Windows separators.
 *  Falls back to the full path if no non-empty segment is found (e.g. empty string input).
 */
const basename = (fullPath: string): string => {
  // Split on both "/" and "\", discard empty segments produced by leading/trailing separators.
  const parts = fullPath.split(/[\\/]+/).filter(Boolean);
  const segment = parts[parts.length - 1];
  return segment ?? fullPath;
};

type Props = {
  /**
   * The full absolute path to display. By default only the basename is shown;
   * the full path is accessible via an explicit reveal toggle and a copy button.
   */
  path: string;
  /** Additional class names applied to the root wrapper element. */
  className?: string;
  /**
   * Class names applied to the basename/path text span, controlling font size and
   * any other text-level styles.  Defaults to `text-sm`.  Callers that need a
   * different size (e.g. `text-xs` for compact backup cards) can pass it here so
   * the hardcoded size does not override their intent.
   */
  textClassName?: string;
};

/**
 * PathDisplay — renders only the basename of an absolute filesystem path by
 * default.  The full path is accessible through an explicit "reveal" toggle
 * and a "copy full path" button.  This prevents screenshots from leaking
 * usernames, share names, or workstation directory structure (OIR-115).
 */
export const PathDisplay = ({ path, className, textClassName = "text-sm" }: Props) => {
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);

  // FIX 1: keep a ref to the pending reset timer so we can clear it on unmount
  // and on each repeated copy click, preventing setState-after-unmount.
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // FIX 3: reset revealed + copied whenever the path prop changes so that a
  // reused component instance (same key, new path) never auto-exposes the
  // incoming absolute path — it must restart in basename-only / hidden state.
  useEffect(() => {
    setRevealed(false);
    setCopied(false);
    clearTimeout(copyTimerRef.current);
  }, [path]);

  // Clear any pending timer when the component unmounts.
  useEffect(() => {
    return () => {
      clearTimeout(copyTimerRef.current);
    };
  }, []);

  const name = basename(path);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(path);
      // Clear any prior pending reset before starting a new one (repeated clicks).
      clearTimeout(copyTimerRef.current);
      setCopied(true);
      copyTimerRef.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard access can fail in restricted contexts; fail silently.
    }
  };

  const handleToggle = () => {
    setRevealed((prev) => !prev);
  };

  return (
    <span className={["inline-flex flex-col gap-1", className].filter(Boolean).join(" ")}>
      {/* FIX 2: text size cascades from caller via textClassName (default "text-sm"). */}
      <span className={["break-all font-mono", textClassName].filter(Boolean).join(" ")}>
        {revealed ? path : name}
      </span>
      <span className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handleToggle}
          aria-label={revealed ? "Ocultar ruta completa" : "Mostrar ruta completa"}
          aria-pressed={revealed}
          className="focus-ring rounded px-1.5 py-0.5 text-xs font-medium text-slate-500 underline hover:text-slate-700"
        >
          {revealed ? "Ocultar" : "Mostrar ruta"}
        </button>
        <button
          type="button"
          onClick={() => void handleCopy()}
          aria-label="Copiar ruta completa"
          className="focus-ring rounded px-1.5 py-0.5 text-xs font-medium text-slate-500 underline hover:text-slate-700"
        >
          {copied ? "Copiado" : "Copiar ruta"}
        </button>
      </span>
    </span>
  );
};
