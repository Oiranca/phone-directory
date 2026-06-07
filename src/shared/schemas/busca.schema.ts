import { z } from "zod";

export const BUSCA_SHIFTS = ["mañana", "tarde", "noche"] as const;
export type BuscaShift = (typeof BUSCA_SHIFTS)[number];

export const buscaRecordSchema = z.object({
  id: z.string(),
  deviceNumber: z.string().trim().min(1, "El número de busca es obligatorio."),
  assignedTo: z.string().trim().min(1, "El nombre del asignado es obligatorio."),
  department: z.string().trim().min(1, "El departamento es obligatorio."),
  role: z.string().trim().min(1, "El rol es obligatorio."),
  shift: z.enum(BUSCA_SHIFTS, {
    errorMap: () => ({ message: "El turno debe ser mañana, tarde o noche." })
  }),
  group: z.string().trim().optional()
});

export const editableBuscaRecordSchema = z.object({
  id: z.string().optional(),
  deviceNumber: z.string().trim().min(1, "El número de busca es obligatorio."),
  assignedTo: z.string().trim().min(1, "El nombre del asignado es obligatorio."),
  department: z.string().trim().min(1, "El departamento es obligatorio."),
  role: z.string().trim().min(1, "El rol es obligatorio."),
  shift: z.enum(BUSCA_SHIFTS, {
    errorMap: () => ({ message: "El turno debe ser mañana, tarde o noche." })
  }),
  group: z.string().trim().optional().transform((v) => v || undefined)
});

export const buscasDatasetSchema = z.object({
  version: z.string(),
  records: z.array(buscaRecordSchema)
});

export type BuscaRecord = z.infer<typeof buscaRecordSchema>;
export type EditableBuscaRecord = z.infer<typeof editableBuscaRecordSchema>;
export type BuscasDataset = z.infer<typeof buscasDatasetSchema>;
