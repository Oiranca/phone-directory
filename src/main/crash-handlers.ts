/**
 * OIR-213 (QA-4) — Main-process crash safety net.
 *
 * Complements OIR-205 (renderer ErrorBoundary, PR #131) which only covers
 * exceptions thrown while rendering React. Before this, an unhandled
 * rejection or synchronous throw outside a try/catch anywhere in the main
 * process (IPC handlers, the auto-backup scheduler, bootstrap, ...) would
 * silently kill the app with no log and no user-facing message.
 *
 * Pure-ish and dependency-injectable (mirrors security.ts's extraction
 * pattern) so it can be unit tested without booting a real Electron app.
 */
import path from "node:path";
import type { App } from "electron";
import { dialog } from "electron";
import { logCrash, type CrashSource } from "./services/crash-log.service.js";

export interface CrashHandlerDeps {
  /** Defaults to the real Node.js `process`. Inject a stub in tests. */
  targetProcess?: NodeJS.Process;
  /** When provided, also registers the `render-process-gone` handler on this app instance. */
  targetApp?: App;
  /** Defaults to Electron's `dialog.showErrorBox`. Inject a stub in tests. */
  showErrorBox?: typeof dialog.showErrorBox;
  /** Defaults to the real crash-log writer. Inject a stub in tests. */
  recordCrash?: typeof logCrash;
  /** Defaults to `targetProcess.exit`. Inject a stub in tests to avoid killing the test runner. */
  exit?: (code: number) => void;
}

const CRASH_DIALOG_TITLE = "Error inesperado";

/**
 * JSON.stringify throws (rather than returning undefined) for values that
 * are non-serializable — e.g. an object with a circular reference, or one
 * containing a BigInt. Because a thrown/rejected value is exactly the kind
 * of thing that can be in a malformed shape when the program is already
 * failing, this must never throw itself: describeError() runs inside the
 * uncaughtException/unhandledRejection listener, so an uncaught throw here
 * would skip recordCrash/showErrorBox entirely for this class of input —
 * defeating the point of the crash safety net for its own edge case.
 */
const safeStringify = (error: unknown): string => {
  try {
    return JSON.stringify(error);
  } catch {
    try {
      return String(error);
    } catch {
      return "Unknown error";
    }
  }
};

const describeError = (error: unknown): { message: string; stack?: string } => {
  if (error instanceof Error) {
    return { message: error.message, stack: error.stack };
  }
  return { message: typeof error === "string" ? error : safeStringify(error) };
};

const DIALOG_DIAGNOSTIC_SUFFIX_PATTERNS = [
  /\s+Ruta afectada:.*$/u,
  /\s+Ruta de origen:.*$/u,
  /\s+Ruta de destino:.*$/u,
  /\s+Archivo afectado:.*$/u
];

// Matches absolute POSIX paths (leading `/`) and Windows paths (`C:\...`),
// stopping at whitespace/quote/bracket characters.
const ABSOLUTE_PATH_PATTERN = /(?:[A-Za-z]:)?[/\\][^\s"'<>]+/gu;

/**
 * Redacts absolute filesystem paths from a crash message before it is shown
 * in a user-facing dialog. Mirrors the diagnostic-suffix stripping already
 * used for renderer toasts (src/renderer/utils/toastMessage.ts, OIR-213) —
 * which exists specifically to avoid leaking "Ruta afectada:"/"Archivo
 * afectado:" suffixes that can embed absolute paths (and thus the OS
 * username) — plus a generic absolute-path redaction, since a raw
 * uncaughtException/unhandledRejection message is not guaranteed to carry
 * one of those known suffixes. This app is a PII-handling phone directory
 * deployed as a shared-workstation USB install, so the dialog (visible to
 * anyone at the machine) must never surface a raw absolute path. The full,
 * unredacted message is still written to the operator-only crash-log.jsonl
 * via recordCrash() before this redaction is applied.
 */
const redactMessageForDialog = (message: string): string => {
  const withoutDiagnosticSuffixes = DIALOG_DIAGNOSTIC_SUFFIX_PATTERNS.reduce(
    (current, pattern) => current.replace(pattern, ""),
    message
  );

  return withoutDiagnosticSuffixes.replace(ABSOLUTE_PATH_PATTERN, (match) => {
    try {
      return path.basename(match) || "<ruta oculta>";
    } catch {
      return "<ruta oculta>";
    }
  });
};

/**
 * Registers process-level crash handlers:
 *   - `uncaughtException` on the Node process
 *   - `unhandledRejection` on the Node process
 *   - `render-process-gone` on the Electron app (only if `targetApp` is provided)
 *
 * Each handler logs the failure via the dedicated crash log, shows a
 * user-facing error dialog, then exits the process — the app is in an
 * unreliable state after any of these and must not silently keep running.
 */
export const registerCrashHandlers = (deps: CrashHandlerDeps = {}): void => {
  const proc = deps.targetProcess ?? process;
  const showErrorBox = deps.showErrorBox ?? dialog.showErrorBox;
  const recordCrash = deps.recordCrash ?? logCrash;
  const exit = deps.exit ?? ((code: number) => proc.exit(code));

  const handleFatal = (source: CrashSource, error: unknown) => {
    const { message, stack } = describeError(error);

    recordCrash({ source, message, stack });

    showErrorBox(
      CRASH_DIALOG_TITLE,
      `La aplicación ha encontrado un error inesperado y debe cerrarse.\n\n${redactMessageForDialog(message)}`
    );

    exit(1);
  };

  proc.on("uncaughtException", (error) => {
    handleFatal("uncaughtException", error);
  });

  proc.on("unhandledRejection", (reason) => {
    handleFatal("unhandledRejection", reason);
  });

  if (deps.targetApp) {
    deps.targetApp.on("render-process-gone", (_event, _webContents, details) => {
      // "clean-exit" is a normal, expected shutdown (e.g. window closed while
      // navigating) — not a crash. Anything else (crashed, killed, oom, ...) is.
      if (details.reason === "clean-exit") {
        return;
      }

      handleFatal(
        "render-process-gone",
        new Error(`Renderer process gone: ${details.reason}`)
      );
    });
  }
};
