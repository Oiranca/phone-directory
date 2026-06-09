import { ipcMain } from "electron";
import { ZodError } from "zod";
import { editableBuscaRecordSchema } from "../../shared/schemas/busca.schema.js";
import type { BuscasService } from "../services/buscas.service.js";

const CHANNELS = {
  list: "buscas:list",
  add: "buscas:add",
  update: "buscas:update",
  remove: "buscas:delete",
  search: "buscas:search"
} as const;

/**
 * Maps a caught error to a renderer-safe message.
 * - ZodError: returns the first validation message (controlled, no internal paths).
 * - Known domain Error: returns err.message directly (already user-facing).
 * - Unexpected/unknown: logs details to main-process stderr only, returns a generic message.
 */
const toRendererError = (err: unknown, channel: string): Error => {
  if (err instanceof ZodError) {
    const firstIssue = err.issues[0];
    return new Error(firstIssue?.message ?? "Datos de busca inválidos.");
  }
  if (err instanceof Error) {
    return err;
  }
  // Unexpected non-Error throw — log internally, do not leak details to renderer
  console.error(`[buscas.ipc] Unexpected error on channel ${channel}:`, err);
  return new Error("Error inesperado. Consulte los registros del proceso principal.");
};

export const registerBuscasIpc = (service: BuscasService) => {
  ipcMain.handle(CHANNELS.list, async () => {
    try {
      return await service.list();
    } catch (err) {
      throw toRendererError(err, CHANNELS.list);
    }
  });

  ipcMain.handle(CHANNELS.add, async (_event, rawPayload: unknown) => {
    try {
      const parsed = editableBuscaRecordSchema.parse(rawPayload);
      return await service.add(parsed);
    } catch (err) {
      throw toRendererError(err, CHANNELS.add);
    }
  });

  ipcMain.handle(CHANNELS.update, async (_event, id: unknown, rawPayload: unknown) => {
    if (typeof id !== "string" || !id.trim()) {
      throw new Error("ID de busca inválido.");
    }
    try {
      const parsed = editableBuscaRecordSchema.parse(rawPayload);
      return await service.update(id, parsed);
    } catch (err) {
      throw toRendererError(err, CHANNELS.update);
    }
  });

  ipcMain.handle(CHANNELS.remove, async (_event, id: unknown) => {
    if (typeof id !== "string" || !id.trim()) {
      throw new Error("ID de busca inválido.");
    }
    try {
      return await service.remove(id);
    } catch (err) {
      throw toRendererError(err, CHANNELS.remove);
    }
  });

  ipcMain.handle(CHANNELS.search, async (_event, query: unknown) => {
    try {
      const q = typeof query === "string" ? query : "";
      return await service.search(q);
    } catch (err) {
      throw toRendererError(err, CHANNELS.search);
    }
  });
};

export type BuscasChannels = typeof CHANNELS;
