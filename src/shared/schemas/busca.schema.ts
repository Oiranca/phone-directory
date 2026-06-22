import { z } from "zod";

export const BUSCA_SHIFTS = ["mañana", "tarde", "noche"] as const;
export type BuscaShift = (typeof BUSCA_SHIFTS)[number];

export const buscaRecordSchema = z.object({
  id: z.string().regex(/^bsc_[0-9a-f]{8}$/, "ID must be bsc_ prefix + 8 hex chars"),
  deviceNumber: z.string().trim().min(1, "El número de busca es obligatorio.").max(255),
  assignedTo: z.string().trim().min(1, "El nombre del asignado es obligatorio.").max(255),
  department: z.string().trim().min(1, "El departamento es obligatorio.").max(255),
  role: z.string().trim().min(1, "El rol es obligatorio.").max(255),
  shift: z.enum(BUSCA_SHIFTS, {
    errorMap: () => ({ message: "El turno debe ser mañana, tarde o noche." })
  }),
  group: z.string().trim().max(255).optional()
});

export const editableBuscaRecordSchema = z.object({
  deviceNumber: z.string().trim().min(1, "El número de busca es obligatorio.").max(255),
  assignedTo: z.string().trim().min(1, "El nombre del asignado es obligatorio.").max(255),
  department: z.string().trim().min(1, "El departamento es obligatorio.").max(255),
  role: z.string().trim().min(1, "El rol es obligatorio.").max(255),
  shift: z.enum(BUSCA_SHIFTS, {
    errorMap: () => ({ message: "El turno debe ser mañana, tarde o noche." })
  }),
  group: z.string().trim().max(255).optional().transform((v) => v || undefined)
});

/**
 * OIR-130 — Imported buscas record.
 *
 * ODS buscas sheets (Buscas_Facultativos, Buscas_Enfermería, etc.) use a
 * column-per-holder-type layout. Each cell in a data row holds a 4-digit pager
 * code for a given holder type (PRINCIPAL, RESIDENTE, ADJUNTO, etc.) and
 * service/department (the row label). These records are parsed from the ODS at
 * import time and stored separately from manually-managed buscas.
 *
 * Fields differ from the manual BuscaRecord intentionally:
 *   - no `shift` (not present in ODS data)
 *   - `holderType` is the normalised column header (e.g. "Principal", "Residente")
 *   - `sourceSheet` + `sourceRow` provide traceability back to the ODS
 */
export const importedBuscaRecordSchema = z.object({
  id: z.string().regex(/^ibsc_[0-9a-f]{8}$/, "ID must be ibsc_ prefix + 8 hex chars"),
  deviceNumber: z.string().trim().min(1, "El número de busca es obligatorio.").max(255),
  department: z.string().trim().min(1, "El servicio/departamento es obligatorio.").max(255),
  holderType: z.string().trim().min(1, "El tipo de titular es obligatorio.").max(255),
  sourceSheet: z.string().trim().min(1).max(255),
  sourceRow: z.number().int().nonnegative()
});

export const buscasDatasetSchema = z.object({
  version: z.literal("1.0.0"),
  records: z.array(buscaRecordSchema),
  importedRecords: z.array(importedBuscaRecordSchema).optional().default([])
});

export type BuscaRecord = z.infer<typeof buscaRecordSchema>;
export type EditableBuscaRecord = z.infer<typeof editableBuscaRecordSchema>;
export type ImportedBuscaRecord = z.infer<typeof importedBuscaRecordSchema>;
export type BuscasDataset = z.infer<typeof buscasDatasetSchema>;
