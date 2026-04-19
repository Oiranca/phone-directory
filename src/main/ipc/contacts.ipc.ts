import type { EditableContactRecord } from "../../shared/types/contact.js";
import { ipcMain } from "electron";
import { AppDataService } from "../services/app-data.service.js";

const CHANNELS = {
  bootstrap: "contacts:get-bootstrap-data",
  createBackup: "contacts:create-backup",
  createRecord: "contacts:create-record",
  updateRecord: "contacts:update-record"
};

export const registerContactsIpc = (service: AppDataService) => {
  ipcMain.handle(CHANNELS.bootstrap, () => service.getBootstrapData());
  ipcMain.handle(CHANNELS.createBackup, async () => {
    await service.createBackup();
  });
  ipcMain.handle(CHANNELS.createRecord, (_event, payload: EditableContactRecord) =>
    service.createRecord(payload)
  );
  ipcMain.handle(CHANNELS.updateRecord, (_event, recordId: string, payload: EditableContactRecord) =>
    service.updateRecord(recordId, payload)
  );
};

export type ContactsChannels = typeof CHANNELS;
