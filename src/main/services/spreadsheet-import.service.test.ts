import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import XLSX from "xlsx";
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
  detectionConfidence: "high",
  beepersParseResult: { records: [], parsedCellCount: 0, skippedRowCount: 0 },
  beepersSkippedRowCount: 0,
  socialHandleSkippedRowCount: 0
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.resetModules();
});

const buildCentralDirectoryOnlyZip = (entries: Array<{
  fileName: string;
  compressedSize: number;
  uncompressedSize: number;
}>) => {
  const localHeaders: Buffer[] = [];
  const centralEntries: Buffer[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const fileName = Buffer.from(entry.fileName, "utf-8");
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(8, 8);
    localHeader.writeUInt32LE(entry.compressedSize, 18);
    localHeader.writeUInt32LE(entry.uncompressedSize, 22);
    localHeader.writeUInt16LE(fileName.length, 26);
    localHeaders.push(Buffer.concat([localHeader, fileName, Buffer.alloc(entry.compressedSize)]));

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt32LE(entry.compressedSize, 20);
    centralHeader.writeUInt32LE(entry.uncompressedSize, 24);
    centralHeader.writeUInt16LE(fileName.length, 28);
    centralHeader.writeUInt32LE(localOffset, 42);
    centralEntries.push(Buffer.concat([centralHeader, fileName]));
    localOffset += 30 + fileName.length + entry.compressedSize;
  }

  const localData = Buffer.concat(localHeaders);
  const centralDirectory = Buffer.concat(centralEntries);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(localData.length, 16);

  return Buffer.concat([localData, centralDirectory, eocd]);
};

const buildZipWithMismatchedCentralDirectory = () => {
  const fileName = Buffer.from("xl/worksheets/sheet1.xml", "utf-8");
  const localHeader = Buffer.alloc(30);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(8, 8);
  localHeader.writeUInt32LE(100, 18);
  localHeader.writeUInt32LE(1_000, 22);
  localHeader.writeUInt16LE(fileName.length, 26);
  const localData = Buffer.concat([localHeader, fileName, Buffer.alloc(100)]);

  const centralHeader = Buffer.alloc(46);
  centralHeader.writeUInt32LE(0x02014b50, 0);
  centralHeader.writeUInt16LE(20, 6);
  centralHeader.writeUInt16LE(8, 10);
  centralHeader.writeUInt32LE(1, 20);
  centralHeader.writeUInt32LE(1, 24);
  centralHeader.writeUInt16LE(fileName.length, 28);
  centralHeader.writeUInt32LE(0, 42);
  const centralDirectory = Buffer.concat([centralHeader, fileName]);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(localData.length, 16);

  return Buffer.concat([localData, centralDirectory, eocd]);
};

const buildZipWithDataDescriptorSizes = ({
  descriptorCompressedSize = 100,
  descriptorUncompressedSize = 1_000
}: {
  descriptorCompressedSize?: number;
  descriptorUncompressedSize?: number;
} = {}) => {
  const fileName = Buffer.from("xl/worksheets/sheet1.xml", "utf-8");
  const localHeader = Buffer.alloc(30);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(0x08, 6);
  localHeader.writeUInt16LE(8, 8);
  localHeader.writeUInt16LE(fileName.length, 26);
  const descriptor = Buffer.alloc(16);
  descriptor.writeUInt32LE(0x08074b50, 0);
  descriptor.writeUInt32LE(0, 4);
  descriptor.writeUInt32LE(descriptorCompressedSize, 8);
  descriptor.writeUInt32LE(descriptorUncompressedSize, 12);
  const localData = Buffer.concat([localHeader, fileName, Buffer.alloc(100), descriptor]);

  const centralHeader = Buffer.alloc(46);
  centralHeader.writeUInt32LE(0x02014b50, 0);
  centralHeader.writeUInt16LE(20, 6);
  centralHeader.writeUInt16LE(0x08, 8);
  centralHeader.writeUInt16LE(8, 10);
  centralHeader.writeUInt32LE(100, 20);
  centralHeader.writeUInt32LE(1_000, 24);
  centralHeader.writeUInt16LE(fileName.length, 28);
  centralHeader.writeUInt32LE(0, 42);
  const centralDirectory = Buffer.concat([centralHeader, fileName]);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(localData.length, 16);

  return Buffer.concat([localData, centralDirectory, eocd]);
};

const buildZipWithMismatchedNames = () => {
  const localFileName = Buffer.from("xl/worksheets/sheet1.xml", "utf-8");
  const centralFileName = Buffer.from("not-xml.bin", "utf-8");
  const localHeader = Buffer.alloc(30);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(8, 8);
  localHeader.writeUInt32LE(1, 18);
  localHeader.writeUInt32LE(1, 22);
  localHeader.writeUInt16LE(localFileName.length, 26);
  const localData = Buffer.concat([localHeader, localFileName, Buffer.alloc(1)]);

  const centralHeader = Buffer.alloc(46);
  centralHeader.writeUInt32LE(0x02014b50, 0);
  centralHeader.writeUInt16LE(20, 6);
  centralHeader.writeUInt16LE(8, 10);
  centralHeader.writeUInt32LE(1, 20);
  centralHeader.writeUInt32LE(1, 24);
  centralHeader.writeUInt16LE(centralFileName.length, 28);
  centralHeader.writeUInt32LE(0, 42);
  const centralDirectory = Buffer.concat([centralHeader, centralFileName]);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(centralDirectory.length, 12);
  eocd.writeUInt32LE(localData.length, 16);

  return Buffer.concat([localData, centralDirectory, eocd]);
};

const writeTempFile = async (name: string, bytes: Buffer) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "spreadsheet-preflight-"));
  const filePath = path.join(dir, name);
  await fs.writeFile(filePath, bytes);
  return { dir, filePath };
};

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

  it("classifies localized ZIP validation messages as safe worker responses", async () => {
    const { isLocalizedSpreadsheetImportErrorMessage } = await import("./spreadsheet-import.service.js");

    expect(
      isLocalizedSpreadsheetImportErrorMessage(
        "No se pudo validar la hoja de cálculo seleccionada. Los tamaños internos del ZIP no coinciden."
      )
    ).toBe(true);
    expect(isLocalizedSpreadsheetImportErrorMessage("Cannot find module /private/tmp/secret-loader.mjs")).toBe(false);
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

  it("terminates a worker when preview processing is cancelled", async () => {
    const { readWorkbookRowsInWorker } = await import("./spreadsheet-import.service.js");
    const worker = new FakeWorker();
    const controller = new AbortController();
    const promise = readWorkbookRowsInWorker("/tmp/source.xlsx", {
      workerFactory: () => worker,
      signal: controller.signal
    });

    controller.abort();

    await expect(promise).rejects.toHaveProperty("name", "ImportPreviewAbortError");
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("starts a fresh worker successfully after a worker crash", async () => {
    const { readWorkbookRowsInWorker } = await import("./spreadsheet-import.service.js");
    const crashedWorker = new FakeWorker();
    const failedAttempt = readWorkbookRowsInWorker("/tmp/source.xlsx", {
      workerFactory: () => crashedWorker
    });
    crashedWorker.emit("exit", 1);
    await expect(failedAttempt).rejects.toThrow("terminó de forma inesperada");

    const retryWorker = new FakeWorker();
    const retry = readWorkbookRowsInWorker("/tmp/source.xlsx", {
      workerFactory: () => retryWorker
    });
    retryWorker.emit("message", { type: "success", result: sampleResult });

    await expect(retry).resolves.toEqual(sampleResult);
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

  it("rejects zero-code exits that never send a response", async () => {
    const { readWorkbookRowsInWorker } = await import("./spreadsheet-import.service.js");
    const worker = new FakeWorker();
    const promise = readWorkbookRowsInWorker("/tmp/source.xlsx", {
      workerFactory: () => worker,
      timeoutMs: 50
    });

    worker.emit("exit", 0);

    await expect(promise).rejects.toThrow("El proceso terminó sin respuesta.");
  });
});

describe("spreadsheet import preflight", () => {
  it("accepts bounded ODS-like XML compression before SheetJS reads the workbook", async () => {
    const { normalizeWorkbookRowsFromFile } = await import("./spreadsheet-import.service.js");
    const readFileSpy = vi.spyOn(XLSX, "readFile").mockReturnValue({
      SheetNames: ["Urgencias"],
      Sheets: {
        Urgencias: XLSX.utils.aoa_to_sheet([
          ["Servicio", "Número"],
          ["Admisión", "70001"],
          ["Triaje", "70002"],
          ["Observación", "70003"]
        ])
      }
    });
    const { dir, filePath } = await writeTempFile(
      "ods-like.xlsx",
      buildCentralDirectoryOnlyZip([
        {
          fileName: "content.xml",
          compressedSize: 100,
          uncompressedSize: 4_000
        }
      ])
    );

    try {
      expect(normalizeWorkbookRowsFromFile(filePath).rows).toHaveLength(3);
      expect(readFileSpy).toHaveBeenCalledOnce();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects ZIP spreadsheets with suspicious expansion before SheetJS reads the workbook", async () => {
    const { normalizeWorkbookRowsFromFile } = await import("./spreadsheet-import.service.js");
    const readFileSpy = vi.spyOn(XLSX, "readFile");
    const { dir, filePath } = await writeTempFile(
      "inflated.xlsx",
      buildCentralDirectoryOnlyZip([
        {
          fileName: "xl/worksheets/sheet1.xml",
          compressedSize: 1,
          uncompressedSize: 1_000
        }
      ])
    );

    try {
      expect(() => normalizeWorkbookRowsFromFile(filePath)).toThrow(
        "La hoja de cálculo está demasiado comprimida para importarla con seguridad."
      );
      expect(readFileSpy).not.toHaveBeenCalled();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects ZIP-backed workbooks even when the file is renamed to .xls", async () => {
    const { normalizeWorkbookRowsFromFile } = await import("./spreadsheet-import.service.js");
    const readFileSpy = vi.spyOn(XLSX, "readFile");
    const { dir, filePath } = await writeTempFile(
      "renamed.xls",
      buildCentralDirectoryOnlyZip([
        {
          fileName: "xl/worksheets/sheet1.xml",
          compressedSize: 1,
          uncompressedSize: 1_000
        }
      ])
    );

    try {
      expect(() => normalizeWorkbookRowsFromFile(filePath)).toThrow(
        "La hoja de cálculo está demasiado comprimida para importarla con seguridad."
      );
      expect(readFileSpy).not.toHaveBeenCalled();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects prefixed ZIP-backed workbooks before SheetJS reads", async () => {
    const { normalizeWorkbookRowsFromFile } = await import("./spreadsheet-import.service.js");
    const readFileSpy = vi.spyOn(XLSX, "readFile");
    const { dir, filePath } = await writeTempFile(
      "prefixed.xls",
      Buffer.concat([
        Buffer.from("JUNK!"),
        buildCentralDirectoryOnlyZip([
          {
            fileName: "xl/worksheets/sheet1.xml",
            compressedSize: 1,
            uncompressedSize: 1_000
          }
        ])
      ])
    );

    try {
      expect(() => normalizeWorkbookRowsFromFile(filePath)).toThrow(
        "La hoja de cálculo está demasiado comprimida para importarla con seguridad."
      );
      expect(readFileSpy).not.toHaveBeenCalled();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects mismatched ZIP local and central directory sizes before SheetJS reads", async () => {
    const { normalizeWorkbookRowsFromFile } = await import("./spreadsheet-import.service.js");
    const readFileSpy = vi.spyOn(XLSX, "readFile");
    const { dir, filePath } = await writeTempFile("mismatch.xlsx", buildZipWithMismatchedCentralDirectory());

    try {
      expect(() => normalizeWorkbookRowsFromFile(filePath)).toThrow(
        "No se pudo validar la hoja de cálculo seleccionada. Los tamaños internos del ZIP no coinciden."
      );
      expect(readFileSpy).not.toHaveBeenCalled();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("accepts bounded ZIP data descriptors and lets SheetJS read the workbook", async () => {
    const { normalizeWorkbookRowsFromFile } = await import("./spreadsheet-import.service.js");
    const readFileSpy = vi.spyOn(XLSX, "readFile").mockReturnValue({
      SheetNames: ["Urgencias"],
      Sheets: {
        Urgencias: XLSX.utils.aoa_to_sheet([
          ["Servicio", "Número"],
          ["Admisión", "70001"],
          ["Triaje", "70002"],
          ["Observación", "70003"]
        ])
      }
    });
    const { dir, filePath } = await writeTempFile("descriptor.xlsx", buildZipWithDataDescriptorSizes());

    try {
      expect(normalizeWorkbookRowsFromFile(filePath).rows).toHaveLength(3);
      expect(readFileSpy).toHaveBeenCalledOnce();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects ZIP data descriptors that disagree with the central directory", async () => {
    const { normalizeWorkbookRowsFromFile } = await import("./spreadsheet-import.service.js");
    const readFileSpy = vi.spyOn(XLSX, "readFile");
    const { dir, filePath } = await writeTempFile(
      "descriptor-mismatch.xlsx",
      buildZipWithDataDescriptorSizes({ descriptorCompressedSize: 99 })
    );

    try {
      expect(() => normalizeWorkbookRowsFromFile(filePath)).toThrow(
        "No se pudo validar la hoja de cálculo seleccionada. El descriptor de datos del ZIP no coincide."
      );
      expect(readFileSpy).not.toHaveBeenCalled();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects mismatched ZIP local and central directory filenames before SheetJS reads", async () => {
    const { normalizeWorkbookRowsFromFile } = await import("./spreadsheet-import.service.js");
    const readFileSpy = vi.spyOn(XLSX, "readFile");
    const { dir, filePath } = await writeTempFile("name-mismatch.xlsx", buildZipWithMismatchedNames());

    try {
      expect(() => normalizeWorkbookRowsFromFile(filePath)).toThrow(
        "No se pudo validar la hoja de cálculo seleccionada. Los nombres internos del ZIP no coinciden."
      );
      expect(readFileSpy).not.toHaveBeenCalled();
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("rejects workbooks whose declared cell range exceeds the import cap", async () => {
    const { normalizeWorkbookRowsFromFile } = await import("./spreadsheet-import.service.js");
    const { dir, filePath } = await writeTempFile("wide.xls", Buffer.from("placeholder"));
    vi.spyOn(XLSX, "readFile").mockReturnValue({
      SheetNames: ["Urgencias"],
      Sheets: {
        Urgencias: {
          "!ref": "A1:XFD32"
        }
      }
    } as unknown as XLSX.WorkBook);

    try {
      expect(() => normalizeWorkbookRowsFromFile(filePath)).toThrow(
        "El archivo supera el límite máximo de 250000 celdas."
      );
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
