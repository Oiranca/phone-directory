export const RECORD_TYPES = [
  "person",
  "service",
  "department",
  "control",
  "supervision",
  "room",
  "external-center",
  "other"
] as const;

export const AREAS = [
  "sanitaria-asistencial",
  "gestion-administracion",
  "especialidades",
  "otros"
] as const;

export type RecordType = (typeof RECORD_TYPES)[number];
export type AreaType = (typeof AREAS)[number];
