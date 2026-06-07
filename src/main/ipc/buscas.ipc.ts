import { ipcMain } from "electron";
import type { BuscaService } from "../services/busca.service.js";
import type { EditableBuscaRecord } from "../../shared/types/busca.js";

const CHANNELS = {
  list: "buscas:list",
  create: "buscas:create",
  update: "buscas:update",
  delete: "buscas:delete"
};

export const registerBuscasIpc = (service: BuscaService) => {
  ipcMain.handle(CHANNELS.list, () => service.listBuscas());
  ipcMain.handle(CHANNELS.create, (_event, payload: EditableBuscaRecord) =>
    service.createBusca(payload)
  );
  ipcMain.handle(CHANNELS.update, (_event, id: string, payload: EditableBuscaRecord) =>
    service.updateBusca(id, payload)
  );
  ipcMain.handle(CHANNELS.delete, (_event, id: string) => service.deleteBusca(id));
};

export type BuscasChannels = typeof CHANNELS;
