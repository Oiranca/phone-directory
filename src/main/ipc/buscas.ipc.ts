import { ipcMain } from "electron";
import { ZodError } from "zod";
import { editableBuscaRecordSchema } from "../../shared/schemas/busca.schema.js";
import type { BuscasService } from "../services/buscas.service.js";
import { BUSCAS_CHANNELS, SERVER_CHANNELS } from "../../shared/ipc/channels.js";

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
  ipcMain.handle(BUSCAS_CHANNELS.list, async () => {
    try {
      return await service.list();
    } catch (err) {
      throw toRendererError(err, BUSCAS_CHANNELS.list);
    }
  });

  ipcMain.handle(BUSCAS_CHANNELS.add, async (_event, rawPayload: unknown) => {
    try {
      const parsed = editableBuscaRecordSchema.parse(rawPayload);
      return await service.add(parsed);
    } catch (err) {
      throw toRendererError(err, BUSCAS_CHANNELS.add);
    }
  });

  ipcMain.handle(BUSCAS_CHANNELS.update, async (_event, id: unknown, rawPayload: unknown) => {
    if (typeof id !== "string" || !id.trim()) {
      throw new Error("ID de busca inválido.");
    }
    try {
      const parsed = editableBuscaRecordSchema.parse(rawPayload);
      return await service.update(id, parsed);
    } catch (err) {
      throw toRendererError(err, BUSCAS_CHANNELS.update);
    }
  });

  ipcMain.handle(BUSCAS_CHANNELS.remove, async (_event, id: unknown) => {
    if (typeof id !== "string" || !id.trim()) {
      throw new Error("ID de busca inválido.");
    }
    try {
      return await service.remove(id);
    } catch (err) {
      throw toRendererError(err, BUSCAS_CHANNELS.remove);
    }
  });

  ipcMain.handle(SERVER_CHANNELS.buscasSearch, async (_event, query: unknown) => {
    try {
      const q = typeof query === "string" ? query : "";
      return await service.search(q);
    } catch (err) {
      throw toRendererError(err, SERVER_CHANNELS.buscasSearch);
    }
  });
};

export type BuscasChannels = typeof BUSCAS_CHANNELS;
