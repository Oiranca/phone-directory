import { z } from "zod";

const isoDateTimeString = z.string().datetime({ offset: true });

const optionalTextField = () =>
  z.string().trim().optional().transform((value) => value || undefined);

export const buscaRecordSchema = z.object({
  id: z.string(),
  number: z.string(),
  assignedTo: z.string(),
  department: optionalTextField(),
  cargo: optionalTextField(),
  shift: optionalTextField(),
  team: optionalTextField(),
  notes: optionalTextField(),
  status: z.enum(["active", "inactive"]),
  createdAt: isoDateTimeString,
  updatedAt: isoDateTimeString
});

export const editableBuscaRecordSchema = z.object({
  number: z.string().trim().min(1, "El número de busca es obligatorio."),
  assignedTo: z.string().trim().min(1, "El asignado es obligatorio."),
  department: optionalTextField(),
  cargo: optionalTextField(),
  shift: optionalTextField(),
  team: optionalTextField(),
  notes: optionalTextField(),
  status: z.enum(["active", "inactive"], {
    errorMap: () => ({ message: "Selecciona un estado válido." })
  })
});

export const buscaDatasetSchema = z.object({
  records: z.array(buscaRecordSchema)
});
