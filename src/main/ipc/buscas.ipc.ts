import { ipcMain } from "electron";
import { editableBuscaRecordSchema } from "../../shared/schemas/busca.schema.js";
import type { BuscasService } from "../services/buscas.service.js";

const CHANNELS = {
  list: "buscas:list",
  add: "buscas:add",
  update: "buscas:update",
  remove: "buscas:delete",
  search: "buscas:search"
} as const;

export const registerBuscasIpc = (service: BuscasService) => {
  ipcMain.handle(CHANNELS.list, () => service.list());

  ipcMain.handle(CHANNELS.add, async (_event, rawPayload: unknown) => {
    const parsed = editableBuscaRecordSchema.parse(rawPayload);
    return service.add(parsed);
  });

  ipcMain.handle(CHANNELS.update, async (_event, id: unknown, rawPayload: unknown) => {
    if (typeof id !== "string" || !id.trim()) {
      throw new Error("ID de busca inválido.");
    }
    const parsed = editableBuscaRecordSchema.parse(rawPayload);
    return service.update(id, parsed);
  });

  ipcMain.handle(CHANNELS.remove, async (_event, id: unknown) => {
    if (typeof id !== "string" || !id.trim()) {
      throw new Error("ID de busca inválido.");
    }
    return service.remove(id);
  });

  ipcMain.handle(CHANNELS.search, async (_event, query: unknown) => {
    const q = typeof query === "string" ? query : "";
    return service.search(q);
  });
};

export type BuscasChannels = typeof CHANNELS;
