import type { ContactRecord } from "../../shared/types/contact";

export const DIRECTORY_CENTER_DESTINATIONS = [
  {
    id: "hugcdn",
    label: "Directorio",
    title: "Directorio — Alt+1",
    aliases: [
      "HUGCDN",
      "Hospital Universitario de Gran Canaria Doctor Negrín",
      "Hospital Universitario de Gran Canaria Dr. Negrín",
      "Hospital Doctor Negrín",
      "Doctor Negrín"
    ]
  },
  {
    id: "hospital-polivalente",
    label: "Hospital Polivalente",
    title: "Hospital Polivalente",
    aliases: ["Hospital Polivalente"]
  },
  {
    id: "hsrg",
    label: "San Roque Guía",
    title: "Hospital San Roque de Guía",
    aliases: ["HSRG", "Hospital San Roque de Guía"]
  },
  {
    id: "hjci",
    label: "Juan Carlos I",
    title: "Hospital Juan Carlos I",
    aliases: ["HJCI", "Hospital Juan Carlos I"]
  },
  {
    id: "cae-arucas",
    label: "CAE Arucas",
    title: "CAE Arucas",
    aliases: ["CAE Arucas"]
  },
  {
    id: "cae-galdar",
    label: "CAE Gáldar",
    title: "CAE Gáldar",
    aliases: ["CAE Gáldar"]
  },
  {
    id: "usm-canalejas",
    label: "Unidad de Salud Mental de Canalejas",
    title: "Unidad de Salud Mental de Canalejas",
    aliases: ["USM Canalejas", "USM de Canalejas", "Unidad de Salud Mental de Canalejas"]
  },
  {
    id: "usm-casa-del-mar",
    label: "Unidad de Salud Mental de Casa del Mar",
    title: "Unidad de Salud Mental de Casa del Mar",
    aliases: ["USM Casa del Mar", "USM de Casa del Mar", "Unidad de Salud Mental de Casa del Mar"]
  },
  {
    id: "usm-costa-ayala",
    label: "Unidad de Salud Mental de Costa Ayala",
    title: "Unidad de Salud Mental de Costa Ayala",
    aliases: ["USM Costa Ayala", "USM de Costa Ayala", "Unidad de Salud Mental de Costa Ayala"]
  },
  {
    id: "usm-la-feria",
    label: "Unidad de Salud Mental de La Feria",
    title: "Unidad de Salud Mental de La Feria",
    aliases: ["USM La Feria", "USM de La Feria", "Unidad de Salud Mental de La Feria"]
  },
  {
    id: "health-centers",
    label: "Centros de Salud",
    title: "Centros de Salud",
    aliases: []
  },
  {
    id: "local-clinics",
    label: "Consultorios Locales",
    title: "Consultorios Locales",
    aliases: []
  }
] as const;

export type DirectoryCenterId = (typeof DIRECTORY_CENTER_DESTINATIONS)[number]["id"];

type DirectoryCenterDestination = (typeof DIRECTORY_CENTER_DESTINATIONS)[number];

const normalizeCenter = (value: string) =>
  value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\s+/gu, " ")
    .trim()
    .toLocaleUpperCase("es");

const HEALTH_CENTERS_SHEET_SLUG = "centros-de-salud";
const LEGACY_HEALTH_CENTERS_SHEET_PATTERN = /(?:^|-)centro(?:-de)?-salud(?:-|$)/u;
const isLocalClinicName = (name: string) => /,\s*C\.L\.$/iu.test(name);

export const getDirectoryCenterDestination = (id?: string): DirectoryCenterDestination | undefined =>
  DIRECTORY_CENTER_DESTINATIONS.find((destination) => destination.id === (id ?? "hugcdn"));

const isHealthCentersSheet = (sheetSlug?: string) =>
  sheetSlug === HEALTH_CENTERS_SHEET_SLUG ||
  sheetSlug?.startsWith(`${HEALTH_CENTERS_SHEET_SLUG}-`) === true ||
  LEGACY_HEALTH_CENTERS_SHEET_PATTERN.test(sheetSlug ?? "");

export const getHealthCenterName = (record: ContactRecord): string | undefined => {
  const center = record.location?.center?.trim();
  if (center) return center;
  if (!isHealthCentersSheet(record.source?.sheetSlug)) return undefined;

  const legacyCenter = record.displayName.split(/\s+-\s+/u, 1)[0]?.trim();
  return legacyCenter || undefined;
};

export const getHealthCenterNames = (
  records: ContactRecord[],
  destinationId: "health-centers" | "local-clinics" = "health-centers"
): string[] => {
  const names = new Map<string, string>();
  for (const record of records) {
    if (!isHealthCentersSheet(record.source?.sheetSlug)) continue;
    const name = getHealthCenterName(record);
    if (!name) continue;
    if (isLocalClinicName(name) !== (destinationId === "local-clinics")) continue;
    const normalizedName = normalizeCenter(name);
    if (!names.has(normalizedName)) names.set(normalizedName, name);
  }
  return [...names.values()].sort((a, b) => a.localeCompare(b, "es"));
};

export const matchesHealthCenterName = (record: ContactRecord, selectedName: string): boolean =>
  !selectedName || normalizeCenter(getHealthCenterName(record) ?? "") === normalizeCenter(selectedName);

export const matchesDirectoryCenter = (record: ContactRecord, destinationId?: string): boolean => {
  const destination = getDirectoryCenterDestination(destinationId);
  if (!destination) return false;

  if (isHealthCentersSheet(record.source?.sheetSlug)) {
    const centerName = getHealthCenterName(record) ?? "";
    return destination.id === (isLocalClinicName(centerName) ? "local-clinics" : "health-centers");
  }

  const center = record.location?.center;

  if (center) {
    const normalizedCenter = normalizeCenter(center);
    return destination.aliases.some((alias) => normalizeCenter(alias) === normalizedCenter);
  }

  if (destination.id === "health-centers") return false;

  return destination.id === "hugcdn";
};
