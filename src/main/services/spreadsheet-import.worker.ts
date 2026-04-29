import { parentPort, workerData } from "node:worker_threads";
import { normalizeWorkbookRowsFromFile, type SpreadsheetImportNormalizationResult } from "./spreadsheet-import.service.js";

type SpreadsheetImportWorkerData = {
  sourceFilePath?: string;
};

type SpreadsheetImportWorkerResponse =
  | { type: "success"; result: SpreadsheetImportNormalizationResult }
  | { type: "error"; message: string };

if (!parentPort) {
  throw new Error("Spreadsheet import worker requires a parent port.");
}

const { sourceFilePath } = workerData as SpreadsheetImportWorkerData;

if (!sourceFilePath) {
  parentPort.postMessage({
    type: "error",
    message: "No se pudo leer la hoja de cálculo seleccionada. Falta la ruta de origen."
  } satisfies SpreadsheetImportWorkerResponse);
} else {
  try {
    parentPort.postMessage({
      type: "success",
      result: normalizeWorkbookRowsFromFile(sourceFilePath)
    } satisfies SpreadsheetImportWorkerResponse);
  } catch (error) {
    const rawMessage = error instanceof Error && error.message ? error.message : "";
    const message =
      rawMessage.startsWith("No se pudo leer la hoja de cálculo seleccionada.")
      || rawMessage.startsWith("No se encontraron hojas soportadas para importar.")
      || rawMessage.startsWith("El archivo supera el tamaño máximo permitido")
        ? rawMessage
        : "No se pudo leer la hoja de cálculo seleccionada.";

    parentPort.postMessage({
      type: "error",
      message
    } satisfies SpreadsheetImportWorkerResponse);
  }
}
