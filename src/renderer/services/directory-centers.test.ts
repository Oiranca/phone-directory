import { describe, expect, it } from "vitest";
import type { ContactRecord } from "../../shared/types/contact";
import { getHealthCenterNames, getHealthCenterName, matchesDirectoryCenter, matchesHealthCenterName } from "./directory-centers";

const recordAt = (center?: string, sheetSlug = "test"): ContactRecord => ({
  id: "cnt_0001",
  externalId: "external-1",
  type: "service",
  displayName: "Admisión",
  organization: {},
  location: center ? { center } : undefined,
  contactMethods: { phones: [], emails: [], socials: [] },
  beepers: [],
  aliases: [],
  tags: [],
  status: "active",
  source: { externalId: "external-1", sheetSlug, sheetRow: "1" },
  audit: { createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z", createdBy: "test", updatedBy: "test" }
});

describe("matchesDirectoryCenter", () => {
  it("places named Negrín in Directorio", () => {
    expect(matchesDirectoryCenter(recordAt("HUGCDN"))).toBe(true);
    expect(matchesDirectoryCenter(recordAt("Hospital San Roque de Guía"))).toBe(false);
    expect(matchesDirectoryCenter(recordAt(undefined, "centros-de-salud"))).toBe(false);
  });

  it.each(["admision-central", "hospitales-de-dia", "rayos", "secretarias", "umi", "urgencias"])(
    "places centerless %s source rows in Directorio",
    (sheetSlug) => {
      expect(matchesDirectoryCenter(recordAt(undefined, sheetSlug))).toBe(true);
    }
  );

  it("matches each named center independently", () => {
    expect(matchesDirectoryCenter(recordAt("Hospital Polivalente"), "hospital-polivalente")).toBe(true);
    expect(matchesDirectoryCenter(recordAt("HSRG"), "hsrg")).toBe(true);
    expect(matchesDirectoryCenter(recordAt("Hospital Juan Carlos I"), "hjci")).toBe(true);
    expect(matchesDirectoryCenter(recordAt("CAE Arucas"), "cae-arucas")).toBe(true);
    expect(matchesDirectoryCenter(recordAt("CAE Gáldar"), "cae-galdar")).toBe(true);
    expect(matchesDirectoryCenter(recordAt("USM Canalejas"), "usm-canalejas")).toBe(true);
    expect(matchesDirectoryCenter(recordAt("USM Casa del Mar"), "usm-casa-del-mar")).toBe(true);
    expect(matchesDirectoryCenter(recordAt("USM Costa Ayala"), "usm-costa-ayala")).toBe(true);
    expect(matchesDirectoryCenter(recordAt("USM La Feria"), "usm-la-feria")).toBe(true);
    expect(matchesDirectoryCenter(recordAt("CAE Arucas"), "cae-galdar")).toBe(false);
    expect(matchesDirectoryCenter(recordAt("USM Canalejas"), "usm-casa-del-mar")).toBe(false);
  });

  it("collects every centros-de-salud record in the health-center destination", () => {
    expect(matchesDirectoryCenter(recordAt(undefined, "centros-de-salud"), "health-centers")).toBe(true);
    expect(matchesDirectoryCenter(recordAt("HUGCDN", "centros-de-salud"), "health-centers")).toBe(true);
    expect(matchesDirectoryCenter(recordAt("HUGCDN", "centros-de-salud"), "hugcdn")).toBe(false);
    expect(matchesDirectoryCenter(recordAt("HSRG", "centros-de-salud"), "hsrg")).toBe(false);
    expect(matchesDirectoryCenter(recordAt(undefined, "agenda-112-centro-de-salud-banaderos-2026"), "health-centers")).toBe(true);
    expect(matchesDirectoryCenter(recordAt(undefined, "agenda-113-centro-salud-de-la-isleta-2026"), "health-centers")).toBe(true);
    expect(matchesDirectoryCenter(recordAt(undefined, "agenda-114-centro-de-salud-otro-2026"), "health-centers")).toBe(true);
    expect(matchesDirectoryCenter(recordAt("Agaete", "centros-de-salud-agaete-informacion-928118221"), "health-centers")).toBe(true);
    expect(matchesDirectoryCenter(recordAt(undefined, "agenda-112-centro-de-salud-banaderos-2026"), "hugcdn")).toBe(false);
    expect(matchesDirectoryCenter(recordAt(undefined, "agenda-120-centros-concertados-2026"), "health-centers")).toBe(false);
    expect(matchesDirectoryCenter(recordAt(), "health-centers")).toBe(false);
  });

  it("routes Consultorios Locales separately from Centros de Salud", () => {
    const localClinic = recordAt("Mogán Playa, C.L.", "centros-de-salud-mogan-playa");
    const healthCenter = recordAt("Agaete", "centros-de-salud-agaete");

    expect(matchesDirectoryCenter(localClinic, "local-clinics")).toBe(true);
    expect(matchesDirectoryCenter(localClinic, "health-centers")).toBe(false);
    expect(matchesDirectoryCenter(healthCenter, "health-centers")).toBe(true);
    expect(matchesDirectoryCenter(healthCenter, "local-clinics")).toBe(false);
    expect(getHealthCenterNames([localClinic, healthCenter], "local-clinics")).toEqual(["Mogán Playa, C.L."]);
    expect(getHealthCenterNames([localClinic, healthCenter])).toEqual(["Agaete"]);
  });

  it("does not route an explicit unknown center into a known destination", () => {
    expect(matchesDirectoryCenter(recordAt("Hospital desconocido"))).toBe(false);
    expect(matchesDirectoryCenter(recordAt("Hospital desconocido"), "health-centers")).toBe(false);
  });

  it("places a centerless non-health source row in Directorio", () => {
    expect(matchesDirectoryCenter(recordAt(undefined, "future-source"))).toBe(true);
    expect(matchesDirectoryCenter(recordAt(undefined, "future-source"), "health-centers")).toBe(false);
  });
});

describe("health center names", () => {
  it("uses the persisted center and falls back to legacy imported names", () => {
    expect(getHealthCenterName(recordAt("Agaete", "centros-de-salud"))).toBe("Agaete");
    expect(getHealthCenterName({
      ...recordAt(undefined, "centros-de-salud"),
      displayName: "Agaete - Información",
    })).toBe("Agaete");
    expect(getHealthCenterName({
      ...recordAt(undefined, "agenda-112-centro-de-salud-banaderos-centro-de-salud"),
      type: "other",
      displayName: "Centro De Salud Bañaderos"
    })).toBe("Centro De Salud Bañaderos");
    expect(getHealthCenterName(recordAt("Agaete", "urgencias"))).toBe("Agaete");
  });

  it("lists unique health centers in Spanish alphabetical order", () => {
    const records = [
      recordAt("Telde", "centros-de-salud"),
      recordAt("Agaete", "centros-de-salud"),
      recordAt(" agaete ", "centros-de-salud"),
      recordAt("HSRG", "urgent")
    ];

    expect(getHealthCenterNames(records)).toEqual(["Agaete", "Telde"]);
  });

  it("matches selected centers without accent or case differences", () => {
    expect(matchesHealthCenterName(recordAt("Gáldar", "centros-de-salud"), "galdar")).toBe(true);
    expect(matchesHealthCenterName(recordAt("Agaete", "centros-de-salud"), "galdar")).toBe(false);
  });
});
