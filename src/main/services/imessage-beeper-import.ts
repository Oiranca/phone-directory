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

export const convertIMessageBeeperExport = (source: IMessageBeeperExport): BeepersDataset => {
  const users = source.datos.usuarios.filter((user) => user.textEnabled);
  const sourceIds = new Set<string>();
  const deviceNumbers = new Set<string>();
  const importedIds = new Set<string>();

  const importedRecords: ImportedBeeperRecord[] = users.map((user, index) => {
    if (sourceIds.has(user.id)) throw new Error("El export de buscas contiene IDs de usuario duplicados.");
    if (deviceNumbers.has(user.displayId)) throw new Error("El export de buscas contiene números de busca duplicados.");

    const id = importedBeeperId(user.id);
    if (importedIds.has(id)) throw new Error("El export de buscas contiene IDs que no se pueden importar de forma única.");
    sourceIds.add(user.id);
    deviceNumbers.add(user.displayId);
    importedIds.add(id);

    return {
      id,
      deviceNumber: user.displayId,
      department: user.department,
      name: displayName(user),
      category: user.position?.trim() || undefined,
      sourceSheet: "iMessage",
      sourceRow: index + 1,
      sourceFingerprint: sourceFingerprint(user.id),
      sourceId: user.id
    };
  });

  return beepersDatasetSchema.parse({
    version: "1.0.0",
    records: [],
    importedRecords,
    teams: source.datos.equipos.map((team) => ({
      id: team.id,
      name: team.name,
      displayId: team.displayId
    })),
    teamMemberships: []
  });
};
