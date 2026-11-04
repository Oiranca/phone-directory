import { createHash } from "node:crypto";
import { beepersDatasetSchema } from "../../shared/schemas/beeper.schema.js";
import type { BeepersDataset, IMessageBeeperExport, ImportedBeeperRecord } from "../../shared/schemas/beeper.schema.js";

const sourceFingerprint = (sourceId: string): string =>
  createHash("sha256").update(sourceId).digest("hex");

const importedBeeperId = (sourceId: string): string =>
  `ibsc_${sourceFingerprint(sourceId).slice(0, 8)}`;

const displayName = (user: IMessageBeeperExport["datos"]["usuarios"][number]): string => {
  const name = [user.firstName, user.surName].filter((part): part is string => Boolean(part?.trim())).join(" ").trim();
  return name || user.userName?.trim() || user.displayId;
};

const normalizeDeviceNumber = (value: string): string => value.trim().toLowerCase();

const preferNonBlank = (current: string | null | undefined, incoming: string | null | undefined): string | undefined =>
  current?.trim() ? current : incoming?.trim() ? incoming : undefined;

export const convertIMessageBeeperExport = (source: IMessageBeeperExport): BeepersDataset => {
  const users = source.datos.usuarios.filter((user) => user.textEnabled);
  const sourceIds = new Set<string>();
  const importedIds = new Set<string>();
  const importedIdsBySourceId = new Map<string, string>();
  const importedByDeviceNumber = new Map<string, ImportedBeeperRecord>();
  const sourceUserIds = new Set(source.datos.usuarios.map((user) => user.id));
  const sourceTeamIds = new Set(source.datos.equipos.map((team) => team.id));
  const sourceMemberships = new Set<string>();

  for (const user of source.datos.usuarios) {
    if (sourceIds.has(user.id)) throw new Error("El export de buscas contiene IDs de usuario duplicados.");
    sourceIds.add(user.id);
  }

  for (const { teamId, userId } of source.datos.teamMemberships ?? []) {
    if (!sourceUserIds.has(userId)) {
      throw new Error("El export de buscas contiene una membresía de equipo para un usuario desconocido.");
    }
    if (!sourceTeamIds.has(teamId)) {
      throw new Error("Team memberships must reference existing teams and beepers.");
    }
    const membershipKey = `${teamId}:${userId}`;
    if (sourceMemberships.has(membershipKey)) {
      throw new Error("Team memberships must be unique.");
    }
    sourceMemberships.add(membershipKey);
  }

  for (const [index, user] of users.entries()) {
    const deviceNumberKey = normalizeDeviceNumber(user.displayId);
    const current = importedByDeviceNumber.get(deviceNumberKey);

    if (current) {
      const merged = {
        ...current,
        name: preferNonBlank(current.name, displayName(user)),
        category: preferNonBlank(current.category, user.position)
      };
      importedByDeviceNumber.set(deviceNumberKey, merged);
      importedIdsBySourceId.set(user.id, current.id);
      continue;
    }

    const id = importedBeeperId(user.id);
    if (importedIds.has(id)) throw new Error("El export de buscas contiene IDs que no se pueden importar de forma única.");
    importedIds.add(id);
    importedIdsBySourceId.set(user.id, id);
    importedByDeviceNumber.set(deviceNumberKey, {
      id,
      deviceNumber: user.displayId.trim(),
      department: user.department,
      name: displayName(user),
      category: user.position?.trim() || undefined,
      sourceSheet: "iMessage",
      sourceRow: index + 1,
      sourceFingerprint: sourceFingerprint(user.id),
      sourceId: user.id
    });
  }

  const importedRecords = Array.from(importedByDeviceNumber.values());

  const teamMembershipsByKey = new Map<string, { teamId: string; beeperId: string }>();
  for (const { teamId, userId } of source.datos.teamMemberships ?? []) {
    const beeperId = importedIdsBySourceId.get(userId);
    if (beeperId) teamMembershipsByKey.set(`${teamId}:${beeperId}`, { teamId, beeperId });
  }
  const teamMemberships = Array.from(teamMembershipsByKey.values());

  return beepersDatasetSchema.parse({
    version: "1.0.0",
    records: [],
    importedRecords,
    teams: source.datos.equipos.map((team) => ({
      id: team.id,
      name: team.name,
      displayId: team.displayId
    })),
    teamMemberships
  });
};
