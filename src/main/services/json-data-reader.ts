import fs from "node:fs/promises";
import path from "node:path";
import { Worker } from "node:worker_threads";
import { fileURLToPath, pathToFileURL } from "node:url";
import { appSettingsSchema, directoryDatasetSchema } from "../../shared/schemas/contact.js";
import { beepersDatasetSchema } from "../../shared/schemas/beeper.schema.js";
import { combinedDataEnvelopeSchema } from "../../shared/schemas/combined-data.schema.js";
import {
  MAX_JSON_DEPTH,
  MAX_JSON_ARRAY_ITEMS,
  MAX_JSON_FILE_SIZE_BYTES,
  MAX_JSON_FILE_SIZE_MB,
  MAX_JSON_OBJECT_FIELDS,
  MAX_JSON_TOTAL_FIELDS
} from "../../shared/constants/json-limits.js";

export type JsonDataKind = "contacts" | "beepers" | "settings" | "combined" | "auto";
export type ParsedJsonData = { kind: Exclude<JsonDataKind, "auto">; data: unknown };
export type JsonDataErrorCode =
  | "too-large"
  | "too-deep"
  | "too-many-fields"
  | "invalid-json"
  | "invalid-data"
  | "timeout"
  | "aborted"
  | "worker";

export class JsonDataError extends Error {
  constructor(readonly code: JsonDataErrorCode, message: string) {
    super(message);
    this.name = "JsonDataError";
  }
}

const messages: Record<JsonDataErrorCode, string> = {
  "too-large": `El archivo JSON supera el tamaño máximo permitido de ${MAX_JSON_FILE_SIZE_MB} MB.`,
  "too-deep": `El archivo JSON supera el límite seguro de ${MAX_JSON_DEPTH} niveles anidados.`,
  "too-many-fields": "El archivo JSON contiene demasiados campos para procesarlo de forma segura.",
  "invalid-json": "El archivo no es un JSON válido.",
  "invalid-data": "El archivo JSON no tiene una estructura válida de HospiAgenda.",
  timeout: "El procesamiento del archivo JSON tardó demasiado. Prueba con un archivo más pequeño.",
  aborted: "La importación JSON fue cancelada.",
  worker: "No se pudo procesar el archivo JSON seleccionado."
};

const assertBoundedStructure = (root: unknown): void => {
  const pending: Array<{ value: unknown; depth: number }> = [{ value: root, depth: 0 }];
  let totalFields = 0;

  while (pending.length > 0) {
    const { value, depth } = pending.pop()!;
    if (depth > MAX_JSON_DEPTH) throw new JsonDataError("too-deep", messages["too-deep"]);
    if (!value || typeof value !== "object") continue;

    if (Array.isArray(value)) {
      if (value.length > MAX_JSON_ARRAY_ITEMS) {
        throw new JsonDataError("too-many-fields", messages["too-many-fields"]);
      }
      for (const item of value) pending.push({ value: item, depth: depth + 1 });
      continue;
    }

    const values = Object.values(value);
    if (values.length > MAX_JSON_OBJECT_FIELDS) {
      throw new JsonDataError("too-many-fields", messages["too-many-fields"]);
    }
    totalFields += values.length;
    if (totalFields > MAX_JSON_TOTAL_FIELDS) {
      throw new JsonDataError("too-many-fields", messages["too-many-fields"]);
    }
    for (const item of values) pending.push({ value: item, depth: depth + 1 });
  }
};

const schemas = {
  contacts: directoryDatasetSchema,
  beepers: beepersDatasetSchema,
  settings: appSettingsSchema,
  combined: combinedDataEnvelopeSchema
} as const;

export const parseAndValidateJson = (contents: string, requestedKind: JsonDataKind): ParsedJsonData => {
  let raw: unknown;
  try {
    raw = JSON.parse(contents) as unknown;
  } catch {
    throw new JsonDataError("invalid-json", messages["invalid-json"]);
  }

  assertBoundedStructure(raw);
  const kinds = requestedKind === "auto"
    ? (["combined", "contacts", "beepers", "settings"] as const)
    : [requestedKind];

  for (const kind of kinds) {
    const parsed = schemas[kind].safeParse(raw);
    if (parsed.success) return { kind, data: parsed.data };
  }

  throw new JsonDataError("invalid-data", messages["invalid-data"]);
};

type JsonWorkerResponse =
  | { type: "success"; result: ParsedJsonData }
  | { type: "error"; code: JsonDataErrorCode; message: string };
type JsonWorker = Pick<Worker, "once" | "terminate">;
type JsonWorkerFactory = (filePath: string, kind: JsonDataKind) => JsonWorker;

const createJsonWorker: JsonWorkerFactory = (filePath, kind) => new Worker(
  pathToFileURL(fileURLToPath(new URL("./json-data.worker.js", import.meta.url))),
  {
    execArgv: [],
    resourceLimits: {
      maxOldGenerationSizeMb: 128,
      maxYoungGenerationSizeMb: 32,
      stackSizeMb: 4
    },
    workerData: { filePath, kind }
  }
);

export type ReadJsonDataOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
  workerFactory?: JsonWorkerFactory;
};

const readInWorker = (
  filePath: string,
  kind: JsonDataKind,
  options: ReadJsonDataOptions
): Promise<ParsedJsonData> => new Promise((resolve, reject) => {
  if (options.signal?.aborted) {
    reject(new JsonDataError("aborted", messages.aborted));
    return;
  }

  const worker = (options.workerFactory ?? createJsonWorker)(filePath, kind);
  let settled = false;
  const finish = (callback: () => void) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abort);
    callback();
  };
  const abort = () => {
    void worker.terminate().catch(() => undefined);
    finish(() => reject(new JsonDataError("aborted", messages.aborted)));
  };
  const timeout = setTimeout(() => {
    void worker.terminate().catch(() => undefined);
    finish(() => reject(new JsonDataError("timeout", messages.timeout)));
  }, options.timeoutMs ?? 10_000);

  options.signal?.addEventListener("abort", abort, { once: true });
  worker.once("message", (payload: JsonWorkerResponse) => {
    finish(() => payload?.type === "success"
      ? resolve(payload.result)
      : reject(new JsonDataError(payload?.code ?? "worker", payload?.message ?? messages.worker)));
  });
  worker.once("error", () => finish(() => reject(new JsonDataError("worker", messages.worker))));
  worker.once("exit", (code) => {
    if (!settled) finish(() => reject(new JsonDataError("worker", code === 0 ? messages.worker : "El proceso de importación JSON terminó de forma inesperada.")));
  });
});

export const readJsonData = async (
  filePath: string,
  kind: JsonDataKind,
  options: ReadJsonDataOptions = {}
): Promise<ParsedJsonData> => {
  const stats = await fs.stat(filePath);
  if (!stats.isFile()) throw Object.assign(new Error("La ruta JSON no apunta a un archivo."), { code: "EISDIR" });
  if (stats.size > MAX_JSON_FILE_SIZE_BYTES) {
    throw new JsonDataError("too-large", messages["too-large"]);
  }

  if (process.env.VITEST === "true" && !options.workerFactory) {
    return parseAndValidateJson(await fs.readFile(filePath, "utf-8"), kind);
  }

  return readInWorker(path.resolve(filePath), kind, options);
};
