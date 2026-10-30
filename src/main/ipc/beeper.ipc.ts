import type { IpcMain } from "electron";
import { ZodError } from "zod";
import { editableBeeperRecordSchema, editableBeeperTeamSchema, editableImportedBeeperRecordSchema } from "../../shared/schemas/beeper.schema.js";
import type { BeepersService } from "../services/beeper.service.js";
import type { AppDataService } from "../services/app-data.service.js";
import { BEEPERS_CHANNELS } from "../../shared/ipc/channels.js";
import { MAX_DATASET_RECORDS } from "../../shared/constants/json-limits.js";

const FILESYSTEM_ERROR_CODES = new Set([
  "EACCES", "EBUSY", "EEXIST", "EIO", "EISDIR", "ELOOP", "EMFILE", "ENAMETOOLONG", "ENFILE",
  "ENOENT", "ENOSPC", "ENOTDIR", "ENOTEMPTY", "EPERM", "EROFS", "EXDEV"
]);

/**
 * Maps a caught error to a renderer-safe message.
 * - ZodError: returns the first validation message (controlled, no internal paths).
 * - Filesystem Error: logs its private details in main and returns stable copy.
 * - Known domain Error: returns err.message directly (already user-facing).
 * - Unexpected/unknown: logs details to main-process stderr only, returns a generic message.
 */
const toRendererError = (err: unknown, channel: string): Error => {
  if (err instanceof ZodError) {
    const firstIssue = err.issues[0];
    return new Error(firstIssue?.message ?? "Datos de busca inválidos.");
  }
  if (err instanceof Error) {
    if ("code" in err && typeof err.code === "string" && FILESYSTEM_ERROR_CODES.has(err.code)) {
      console.error(`[beeper.ipc] Filesystem error on channel ${channel}:`, err);
      return new Error("No se pudo completar la operación con el archivo de buscas.");
    }
    return err;
  }
  // Unexpected non-Error throw — log internally, do not leak details to renderer
  console.error(`[beeper.ipc] Unexpected error on channel ${channel}:`, err);
  return new Error("Error inesperado. Consulte los registros del proceso principal.");
};

export const registerBeepersIpc = (
  service: BeepersService,
  appDataService: AppDataService,
  handle: IpcMain["handle"]
) => {
  handle(BEEPERS_CHANNELS.list, async () => {
    try {
      return await service.list();
    } catch (err) {
      throw toRendererError(err, BEEPERS_CHANNELS.list);
    }
  });

  handle(BEEPERS_CHANNELS.add, async (_event, rawPayload: unknown) => {
    try {
      const parsed = editableBeeperRecordSchema.parse(rawPayload);
      return await service.add(parsed);
    } catch (err) {
      throw toRendererError(err, BEEPERS_CHANNELS.add);
    }
  });

  handle(BEEPERS_CHANNELS.update, async (_event, id: unknown, rawPayload: unknown) => {
    if (typeof id !== "string" || !id.trim()) {
      throw new Error("ID de busca inválido.");
    }
    try {
      const parsed = editableBeeperRecordSchema.parse(rawPayload);
      return await service.update(id, parsed);
    } catch (err) {
      throw toRendererError(err, BEEPERS_CHANNELS.update);
    }
  });

  handle(BEEPERS_CHANNELS.remove, async (_event, id: unknown) => {
    if (typeof id !== "string" || !id.trim()) {
      throw new Error("ID de busca inválido.");
    }
    try {
      return await service.remove(id, await appDataService.getBeeperBackupOptions());
    } catch (err) {
      throw toRendererError(err, BEEPERS_CHANNELS.remove);
    }
  });

  handle(BEEPERS_CHANNELS.listImported, async () => {
    try {
      return await service.listImported();
    } catch (err) {
      throw toRendererError(err, BEEPERS_CHANNELS.listImported);
    }
  });

  handle(BEEPERS_CHANNELS.updateImported, async (_event, id: unknown, rawPayload: unknown) => {
    if (typeof id !== "string" || !id.trim()) {
      throw new Error("ID de busca importada inválido.");
    }
    try {
      const parsed = editableImportedBeeperRecordSchema.parse(rawPayload);
      return await service.updateImported(id, parsed);
    } catch (err) {
      throw toRendererError(err, BEEPERS_CHANNELS.updateImported);
    }
  });

  handle(BEEPERS_CHANNELS.listTeams, async () => {
    try {
      return await service.listTeams();
    } catch (err) {
      throw toRendererError(err, BEEPERS_CHANNELS.listTeams);
    }
  });

  handle(BEEPERS_CHANNELS.listMemberships, async () => {
    try {
      return await service.listTeamMemberships();
    } catch (err) {
      throw toRendererError(err, BEEPERS_CHANNELS.listMemberships);
    }
  });

  handle(BEEPERS_CHANNELS.addTeam, async (_event, rawPayload: unknown) => {
    try {
      return await service.addTeam(editableBeeperTeamSchema.parse(rawPayload));
    } catch (err) {
      throw toRendererError(err, BEEPERS_CHANNELS.addTeam);
    }
  });

  handle(BEEPERS_CHANNELS.updateTeam, async (_event, id: unknown, rawPayload: unknown) => {
    if (typeof id !== "string" || id.length > 255 || !id.trim()) throw new Error("ID de equipo inválido.");
    try {
      return await service.updateTeam(id, editableBeeperTeamSchema.parse(rawPayload));
    } catch (err) {
      throw toRendererError(err, BEEPERS_CHANNELS.updateTeam);
    }
  });

  handle(BEEPERS_CHANNELS.removeTeam, async (_event, id: unknown) => {
    if (typeof id !== "string" || id.length > 255 || !id.trim()) throw new Error("ID de equipo inválido.");
    try {
      return await service.removeTeam(id, await appDataService.getBeeperBackupOptions());
    } catch (err) {
      throw toRendererError(err, BEEPERS_CHANNELS.removeTeam);
    }
  });

  handle(BEEPERS_CHANNELS.setTeamMembers, async (_event, teamId: unknown, rawBeeperIds: unknown) => {
    if (typeof teamId !== "string" || teamId.length > 255 || !teamId.trim()) throw new Error("ID de equipo inválido.");
    if (
      !Array.isArray(rawBeeperIds) ||
      rawBeeperIds.length > MAX_DATASET_RECORDS ||
      rawBeeperIds.some((id) => typeof id !== "string" || id.length > 255 || !id.trim())
    ) {
      throw new Error("Los miembros del equipo no son válidos.");
    }
    try {
      return await service.setTeamMembers(teamId, rawBeeperIds);
    } catch (err) {
      throw toRendererError(err, BEEPERS_CHANNELS.setTeamMembers);
    }
  });

};

export type BeepersChannels = typeof BEEPERS_CHANNELS;
