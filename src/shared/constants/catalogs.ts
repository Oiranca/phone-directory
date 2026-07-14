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

// Single source of truth for the Spanish display label of each
// RecordType value. Originally defined ad hoc inside DirectoryPage.tsx's
// filter UI — hoisted here so any other renderer surface (e.g. the CSV/ODS
// import preview's "Tipos detectados" chips) can reuse the exact same
// mapping instead of showing the raw English enum value.
export const RECORD_TYPE_LABELS = {
  person: "Persona",
  service: "Servicio",
  department: "Departamento",
  control: "Control",
  supervision: "Supervisión",
  room: "Sala",
  "external-center": "Centro externo",
  other: "Otro"
} as const satisfies Record<RecordType, string>;
