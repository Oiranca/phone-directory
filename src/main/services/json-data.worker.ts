import fs from "node:fs";
import { parentPort, workerData } from "node:worker_threads";
import {
  JsonDataError,
  parseAndValidateJson,
  type JsonDataKind
} from "./json-data-reader.js";
import { MAX_JSON_FILE_SIZE_BYTES, MAX_JSON_FILE_SIZE_MB } from "../../shared/constants/json-limits.js";

if (!parentPort) throw new Error("JSON data worker requires a parent port.");

const { filePath, kind } = workerData as { filePath: string; kind: JsonDataKind };

try {
  const descriptor = fs.openSync(filePath, "r");
  let contents: string;
  try {
    if (fs.fstatSync(descriptor).size > MAX_JSON_FILE_SIZE_BYTES) {
      throw new JsonDataError(
        "too-large",
        `El archivo JSON supera el tamaño máximo permitido de ${MAX_JSON_FILE_SIZE_MB} MB.`
      );
    }
    contents = fs.readFileSync(descriptor, "utf-8");
  } finally {
    fs.closeSync(descriptor);
  }
  parentPort.postMessage({
    type: "success",
    result: parseAndValidateJson(contents, kind)
  });
} catch (error) {
  parentPort.postMessage({
    type: "error",
    code: error instanceof JsonDataError ? error.code : "worker",
    message: error instanceof Error ? error.message : "No se pudo procesar el archivo JSON seleccionado."
  });
}
