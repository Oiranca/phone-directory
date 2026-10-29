import { z } from "zod";
import { MAX_DATASET_RECORDS } from "../constants/json-limits.js";

export const BEEPER_SHIFTS = ["mañana", "tarde", "noche"] as const;

export const beeperRecordSchema = z.object({
  id: z.string().regex(/^bsc_[0-9a-f]{8}$/, "ID must be bsc_ prefix + 8 hex chars"),
  deviceNumber: z.string().trim().min(1, "El número de busca es obligatorio.").max(255),
  assignedTo: z.string().trim().min(1, "El nombre del asignado es obligatorio.").max(255),
  department: z.string().trim().min(1, "El departamento es obligatorio.").max(255),
  role: z.string().trim().min(1, "El rol es obligatorio.").max(255),
  shift: z.enum(BEEPER_SHIFTS, {
    errorMap: () => ({ message: "El turno debe ser mañana, tarde o noche." })
  }),
  group: z.string().trim().max(255).optional()
});

export const editableBeeperRecordSchema = z.object({
  deviceNumber: z.string().trim().min(1, "El número de busca es obligatorio.").max(255),
  assignedTo: z.string().trim().min(1, "El nombre del asignado es obligatorio.").max(255),
  department: z.string().trim().min(1, "El departamento es obligatorio.").max(255),
  role: z.string().trim().min(1, "El rol es obligatorio.").max(255),
  shift: z.enum(BEEPER_SHIFTS, {
    errorMap: () => ({ message: "El turno debe ser mañana, tarde o noche." })
  }),
  group: z.string().trim().max(255).optional().transform((v) => v || undefined)
});

/**
 * Imported beeper record.
 *
 * ODS beeper sheets (Buscas_Facultativos, Buscas_Enfermería, etc.) use a
 * column-per-holder-type layout. Each cell in a data row holds a 4-digit pager
 * code for a given holder type (PRINCIPAL, RESIDENTE, ADJUNTO, etc.) and
 * service/department (the row label). These records are parsed from the ODS at
 * import time and stored separately from manually-managed beepers.
 *
 * Fields differ from the manual BeeperRecord intentionally:
 *   - no `shift` (not present in ODS data)
 *   - `holderType` is the normalised column header (e.g. "Principal", "Residente")
 *   - `sourceSheet` + `sourceRow` provide traceability back to the ODS
 *
 * OIR-264: `holderType` is now optional and `name`/`category`/`service` were
 * added to support the new "Busca 1"/"Corporativo 1" style column layout
 * (parsing itself is out of scope — reserved for OIR-265/266). BACKWARD
 * COMPAT: all four are optional so existing persisted beepers.json entries
 * (written before this change) still parse without these keys.
 */
export const importedBeeperRecordSchema = z.object({
  id: z.string().regex(/^ibsc_[0-9a-f]{8}$/, "ID must be ibsc_ prefix + 8 hex chars"),
  deviceNumber: z.string().trim().min(1, "El número de busca es obligatorio.").max(255),
  department: z.string().trim().min(1, "El servicio/departamento es obligatorio.").max(255),
  holderType: z.string().trim().min(1, "El tipo de titular es obligatorio.").max(255).optional(),
  // Holder's name, when the source sheet identifies a specific person rather
  // than just a holder-type/department combination.
  name: z.string().trim().max(255).optional(),
  // Category/role of the holder (e.g. "Enfermero/a", "Jefe/a").
  category: z.string().trim().max(255).optional(),
  // Service the beeper belongs to, distinct from `department` when the sheet
  // distinguishes the two (e.g. a department with multiple services).
  service: z.string().trim().max(255).optional(),
  // Retained when pager-only contacts are routed out of the directory records.
  schedule: z.string().trim().max(1000).optional(),
  notes: z.string().trim().max(4000).optional(),
  sourceSheet: z.string().trim().min(1).max(255),
  sourceRow: z.number().int().nonnegative(),
  sourceFingerprint: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  // Source-system identifiers are retained without persisting arbitrary source fields.
  sourceId: z.string().trim().min(1).max(255).optional(),
  // Manual corrections are reapplied when the same source record is imported again.
  manuallyEdited: z.boolean().optional()
});

export const editableImportedBeeperRecordSchema = z.object({
  deviceNumber: z.string().trim().min(1, "El número de busca es obligatorio.").max(255),
  assignedTo: z.string().trim().max(255).optional().transform((v) => v || undefined),
  department: z.string().trim().min(1, "El departamento es obligatorio.").max(255),
  role: z.string().trim().max(255).optional().transform((v) => v || undefined)
});

const iMessageBeeperUserSchema = z.object({
  id: z.string().trim().min(1).max(255),
  displayId: z.string().trim().min(1).max(255),
  department: z.string().trim().min(1).max(255),
  firstName: z.string().nullable().optional(),
  surName: z.string().nullable().optional(),
  userName: z.string().nullable().optional(),
  position: z.string().nullable().optional(),
  textEnabled: z.boolean()
}).passthrough();

const iMessageBeeperTeamSchema = z.object({
  id: z.string().trim().min(1).max(255),
  displayId: z.string().trim().min(1).max(255),
  name: z.string().trim().min(1).max(255)
}).passthrough();

/** The external pager export is converted into BeepersDataset in main. */
export const iMessageBeeperExportSchema = z.object({
  datos: z.object({
    usuarios: z.array(iMessageBeeperUserSchema).max(MAX_DATASET_RECORDS),
    equipos: z.array(iMessageBeeperTeamSchema).max(MAX_DATASET_RECORDS)
  })
});

export const beeperTeamSchema = z.object({
  id: z.string().trim().min(1).max(255),
  name: z.string().trim().min(1).max(255),
  displayId: z.string().trim().min(1).max(255)
});

export const editableBeeperTeamSchema = beeperTeamSchema.omit({ id: true });

export const beeperTeamMembershipSchema = z.object({
  teamId: z.string().trim().min(1).max(255),
  beeperId: z.string().trim().min(1).max(255)
});

export const beepersDatasetSchema = z.object({
  version: z.literal("1.0.0"),
  records: z.array(beeperRecordSchema).max(MAX_DATASET_RECORDS),
  importedRecords: z
    .array(importedBeeperRecordSchema)
    .max(MAX_DATASET_RECORDS)
    .nullable()
    .optional()
    .transform((v) => v ?? []),
  teams: z.array(beeperTeamSchema).max(MAX_DATASET_RECORDS).nullable().optional().transform((v) => v ?? []),
  teamMemberships: z.array(beeperTeamMembershipSchema).max(MAX_DATASET_RECORDS).nullable().optional().transform((v) => v ?? [])
}).superRefine((dataset, ctx) => {
  const beeperIds = new Set([...dataset.records, ...dataset.importedRecords].map((record) => record.id));
  const teamIds = new Set<string>();
  const teamDisplayIds = new Set<string>();
  const memberships = new Set<string>();

  for (const team of dataset.teams) {
    if (teamIds.has(team.id)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Team IDs must be unique." });
    }
    teamIds.add(team.id);
    const normalizedDisplayId = team.displayId.trim().toLowerCase();
    if (teamDisplayIds.has(normalizedDisplayId)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Team display IDs must be unique." });
    }
    teamDisplayIds.add(normalizedDisplayId);
  }

  for (const membership of dataset.teamMemberships) {
    const key = `${membership.teamId}:${membership.beeperId}`;
    if (!teamIds.has(membership.teamId) || !beeperIds.has(membership.beeperId)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Team memberships must reference existing teams and beepers." });
    }
    if (memberships.has(key)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Team memberships must be unique." });
    }
    memberships.add(key);
  }
});

export type BeeperRecord = z.infer<typeof beeperRecordSchema>;
export type EditableBeeperRecord = z.infer<typeof editableBeeperRecordSchema>;
export type ImportedBeeperRecord = z.infer<typeof importedBeeperRecordSchema>;
export type EditableImportedBeeperRecord = z.infer<typeof editableImportedBeeperRecordSchema>;
export type IMessageBeeperExport = z.infer<typeof iMessageBeeperExportSchema>;
export type BeeperTeam = z.infer<typeof beeperTeamSchema>;
export type EditableBeeperTeam = z.infer<typeof editableBeeperTeamSchema>;
export type BeeperTeamMembership = z.infer<typeof beeperTeamMembershipSchema>;
export type BeepersDataset = z.infer<typeof beepersDatasetSchema>;
