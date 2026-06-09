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

export const buscasDatasetSchema = z.object({
  version: z.literal("1.0.0"),
  records: z.array(buscaRecordSchema)
});

export type BuscaRecord = z.infer<typeof buscaRecordSchema>;
export type EditableBuscaRecord = z.infer<typeof editableBuscaRecordSchema>;
export type BuscasDataset = z.infer<typeof buscasDatasetSchema>;
