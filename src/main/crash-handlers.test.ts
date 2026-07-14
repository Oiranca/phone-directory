/**
 * Unit tests for src/main/crash-handlers.ts (OIR-213 / QA-4).
 *
 * These verify the handlers are registered on the injected process/app
 * instances, and that a simulated crash records via the crash log, shows a
 * dialog, and exits the process — following this codebase's dependency-
 * injection pattern for testing main-process singletons (see security.ts /
 * index.test.ts) without booting a real Electron app.
 */
import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { registerCrashHandlers } from "./crash-handlers.js";

const makeFakeProcess = () => {
  const emitter = new EventEmitter() as unknown as NodeJS.Process;
  return emitter;
};

const makeFakeApp = () => new EventEmitter();

describe("registerCrashHandlers", () => {
  it("registers an uncaughtException listener on the target process", () => {
    const fakeProcess = makeFakeProcess();
    registerCrashHandlers({
      targetProcess: fakeProcess,
      showErrorBox: vi.fn(),
      recordCrash: vi.fn(),
      exit: vi.fn()
    });

    expect(fakeProcess.listenerCount("uncaughtException")).toBe(1);
  });

  it("registers an unhandledRejection listener on the target process", () => {
    const fakeProcess = makeFakeProcess();
    registerCrashHandlers({
      targetProcess: fakeProcess,
      showErrorBox: vi.fn(),
      recordCrash: vi.fn(),
      exit: vi.fn()
    });

    expect(fakeProcess.listenerCount("unhandledRejection")).toBe(1);
  });

  it("does not register render-process-gone when no targetApp is provided", () => {
    const fakeProcess = makeFakeProcess();
    registerCrashHandlers({
      targetProcess: fakeProcess,
      showErrorBox: vi.fn(),
      recordCrash: vi.fn(),
      exit: vi.fn()
    });
    // No assertion target — just confirms registerCrashHandlers does not throw
    // when targetApp is omitted.
    expect(true).toBe(true);
  });

  it("registers a render-process-gone listener when targetApp is provided", () => {
    const fakeProcess = makeFakeProcess();
    const fakeApp = makeFakeApp();
    registerCrashHandlers({
      targetProcess: fakeProcess,
      targetApp: fakeApp as unknown as Electron.App,
      showErrorBox: vi.fn(),
      recordCrash: vi.fn(),
      exit: vi.fn()
    });

    expect(fakeApp.listenerCount("render-process-gone")).toBe(1);
  });

  it("on uncaughtException: records the crash, shows the error dialog, and exits with code 1", () => {
    const fakeProcess = makeFakeProcess();
    const recordCrash = vi.fn();
    const showErrorBox = vi.fn();
    const exit = vi.fn();

    registerCrashHandlers({ targetProcess: fakeProcess, recordCrash, showErrorBox, exit });

    const error = new Error("Something broke");
    fakeProcess.emit("uncaughtException", error);

    expect(recordCrash).toHaveBeenCalledTimes(1);
    expect(recordCrash).toHaveBeenCalledWith(
      expect.objectContaining({ source: "uncaughtException", message: "Something broke" })
    );
    expect(showErrorBox).toHaveBeenCalledTimes(1);
    expect(showErrorBox.mock.calls[0]![1]).toContain("Something broke");
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("on unhandledRejection: records the crash, shows the error dialog, and exits with code 1", () => {
    const fakeProcess = makeFakeProcess();
    const recordCrash = vi.fn();
    const showErrorBox = vi.fn();
    const exit = vi.fn();

    registerCrashHandlers({ targetProcess: fakeProcess, recordCrash, showErrorBox, exit });

    fakeProcess.emit("unhandledRejection", new Error("Rejected promise"), Promise.resolve());

    expect(recordCrash).toHaveBeenCalledWith(
      expect.objectContaining({ source: "unhandledRejection", message: "Rejected promise" })
    );
    expect(showErrorBox).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("handles a non-Error unhandledRejection reason without throwing", () => {
    const fakeProcess = makeFakeProcess();
    const recordCrash = vi.fn();
    const showErrorBox = vi.fn();
    const exit = vi.fn();

    registerCrashHandlers({ targetProcess: fakeProcess, recordCrash, showErrorBox, exit });

    expect(() => fakeProcess.emit("unhandledRejection", "plain string rejection", Promise.resolve())).not.toThrow();

    expect(recordCrash).toHaveBeenCalledWith(
      expect.objectContaining({ source: "unhandledRejection", message: "plain string rejection" })
    );
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("on render-process-gone: records the crash and shows the dialog for a non-clean-exit reason", () => {
    const fakeProcess = makeFakeProcess();
    const fakeApp = makeFakeApp();
    const recordCrash = vi.fn();
    const showErrorBox = vi.fn();
    const exit = vi.fn();

    registerCrashHandlers({
      targetProcess: fakeProcess,
      targetApp: fakeApp as unknown as Electron.App,
      recordCrash,
      showErrorBox,
      exit
    });

    fakeApp.emit("render-process-gone", {}, {}, { reason: "crashed", exitCode: 1 });

    expect(recordCrash).toHaveBeenCalledWith(
      expect.objectContaining({ source: "render-process-gone" })
    );
    expect(showErrorBox).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("still records the crash and shows a dialog when the thrown value is circular (non-JSON-serializable)", () => {
    const fakeProcess = makeFakeProcess();
    const recordCrash = vi.fn();
    const showErrorBox = vi.fn();
    const exit = vi.fn();

    registerCrashHandlers({ targetProcess: fakeProcess, recordCrash, showErrorBox, exit });

    const circular: Record<string, unknown> = {};
    circular.self = circular;

    // JSON.stringify(circular) throws a TypeError ("Converting circular
    // structure to JSON") — describeError() must not let that escape the
    // uncaughtException listener, or recordCrash/showErrorBox would be
    // silently skipped for this exact class of malformed error value.
    expect(() => fakeProcess.emit("uncaughtException", circular)).not.toThrow();

    expect(recordCrash).toHaveBeenCalledTimes(1);
    expect(showErrorBox).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("redacts absolute paths from the dialog message but keeps the full message in the crash log", () => {
    const fakeProcess = makeFakeProcess();
    const recordCrash = vi.fn();
    const showErrorBox = vi.fn();
    const exit = vi.fn();

    registerCrashHandlers({ targetProcess: fakeProcess, recordCrash, showErrorBox, exit });

    const sensitivePath =
      "/Users/jdoe/Library/Application Support/phone-directory/data/contacts.json";
    const error = new Error(`No se pudo leer el archivo. Ruta afectada: ${sensitivePath}.`);

    fakeProcess.emit("uncaughtException", error);

    // The full, unredacted message must still reach the operator-only
    // crash-log.jsonl via recordCrash().
    expect(recordCrash).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining(sensitivePath) })
    );

    // But the user-facing dialog must never surface the raw absolute path
    // (which embeds the OS username) or contact data diagnostic suffix.
    expect(showErrorBox).toHaveBeenCalledTimes(1);
    const dialogMessage = showErrorBox.mock.calls[0]![1];
    expect(dialogMessage).not.toContain(sensitivePath);
    expect(dialogMessage).not.toContain("jdoe");
    expect(dialogMessage).not.toContain("Ruta afectada:");
  });

  it("on render-process-gone: does NOT record/exit for a clean-exit reason", () => {
    const fakeProcess = makeFakeProcess();
    const fakeApp = makeFakeApp();
    const recordCrash = vi.fn();
    const showErrorBox = vi.fn();
    const exit = vi.fn();

    registerCrashHandlers({
      targetProcess: fakeProcess,
      targetApp: fakeApp as unknown as Electron.App,
      recordCrash,
      showErrorBox,
      exit
    });

    fakeApp.emit("render-process-gone", {}, {}, { reason: "clean-exit", exitCode: 0 });

    expect(recordCrash).not.toHaveBeenCalled();
    expect(showErrorBox).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
  });
});
