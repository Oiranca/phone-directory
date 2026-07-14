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

const describeError = (error: unknown): { message: string; stack?: string } => {
  if (error instanceof Error) {
    return { message: error.message, stack: error.stack };
  }
  return { message: typeof error === "string" ? error : JSON.stringify(error) };
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
      `La aplicación ha encontrado un error inesperado y debe cerrarse.\n\n${message}`
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
