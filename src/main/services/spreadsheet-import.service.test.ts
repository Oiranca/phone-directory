import { afterEach, describe, expect, it, vi } from "vitest";
import type { SpreadsheetImportNormalizationResult } from "./spreadsheet-import.service.js";

type WorkerEvent = "message" | "error" | "exit";

class FakeWorker {
  private readonly listeners = new Map<WorkerEvent, (value: unknown) => void>();
  terminate = vi.fn(async () => 0);

  once(event: WorkerEvent, listener: (value: unknown) => void) {
    this.listeners.set(event, listener);
    return this;
  }

  emit(event: WorkerEvent, value: unknown) {
    this.listeners.get(event)?.(value);
  }
}

const sampleResult: SpreadsheetImportNormalizationResult = {
  rows: [],
  detectedFormat: "exportación cruda de hoja de servicios",
  detectionConfidence: "high"
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("readWorkbookRowsInWorker", () => {
  it("resolves normalized rows from a successful worker response", async () => {
    const { readWorkbookRowsInWorker } = await import("./spreadsheet-import.service.js");
    const worker = new FakeWorker();
    const promise = readWorkbookRowsInWorker("/tmp/source.xlsx", {
      workerFactory: () => worker,
      timeoutMs: 50
    });

    worker.emit("message", { type: "success", result: sampleResult });

    await expect(promise).resolves.toEqual(sampleResult);
  });

  it("rejects localized worker error payloads", async () => {
    const { readWorkbookRowsInWorker } = await import("./spreadsheet-import.service.js");
    const worker = new FakeWorker();
    const promise = readWorkbookRowsInWorker("/tmp/source.xlsx", {
      workerFactory: () => worker,
      timeoutMs: 50
    });

    worker.emit("message", {
      type: "error",
      message: "No se encontraron hojas soportadas para importar."
    });

    await expect(promise).rejects.toThrow("No se encontraron hojas soportadas para importar.");
  });

  it("rejects malformed worker payloads", async () => {
    const { readWorkbookRowsInWorker } = await import("./spreadsheet-import.service.js");
    const worker = new FakeWorker();
    const promise = readWorkbookRowsInWorker("/tmp/source.xlsx", {
      workerFactory: () => worker,
      timeoutMs: 50
    });

    worker.emit("message", { ok: true });

    await expect(promise).rejects.toThrow("El proceso de importación devolvió una respuesta no válida.");
  });

  it("redacts raw worker bootstrap errors", async () => {
    const { readWorkbookRowsInWorker } = await import("./spreadsheet-import.service.js");
    const worker = new FakeWorker();
    const promise = readWorkbookRowsInWorker("/tmp/source.xlsx", {
      workerFactory: () => worker,
      timeoutMs: 50
    });

    worker.emit("error", new Error("Cannot find module /private/tmp/secret-loader.mjs"));

    const error = await promise.catch((reason) => reason as Error);

    expect(error.message).toContain("No se pudo leer la hoja de cálculo seleccionada.");
    expect(error.message).not.toContain("secret-loader");
  });

  it("terminates timed-out workers and reports a recoverable error", async () => {
    vi.useFakeTimers();
    const { readWorkbookRowsInWorker } = await import("./spreadsheet-import.service.js");
    const worker = new FakeWorker();
    const promise = readWorkbookRowsInWorker("/tmp/source.xlsx", {
      workerFactory: () => worker,
      timeoutMs: 25
    });
    const assertion = expect(promise).rejects.toThrow("El procesamiento tardó demasiado.");

    await vi.advanceTimersByTimeAsync(25);

    await assertion;
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("rejects unexpected worker exits", async () => {
    const { readWorkbookRowsInWorker } = await import("./spreadsheet-import.service.js");
    const worker = new FakeWorker();
    const promise = readWorkbookRowsInWorker("/tmp/source.xlsx", {
      workerFactory: () => worker,
      timeoutMs: 50
    });

    worker.emit("exit", 1);

    await expect(promise).rejects.toThrow("El proceso de importación terminó de forma inesperada.");
  });
});
