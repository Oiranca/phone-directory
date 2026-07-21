/**
 * Unit tests for spreadsheet-parsers.ts
 *
 * Covers:
 *   - blankRecord: full shape assertion (all expected fields, correct types)
 *   - buildStableExternalId: determinism, ASCII-fold/join behavior,
 *     accent normalization, order sensitivity, empty/edge inputs
 *   - normalizeServiceSheet: rowHasPhone gating regression tests
 */

import { describe, expect, it } from "vitest";
import {
  blankRecord,
  buildStableExternalId,
  normalizeServiceSheet,
  normalizeTabularAgendaSheet,
  isAgendaTabularHeader,
  stripPlantaPrefix,
  AGENDA_TABULAR_HEADER_MARKERS,
} from "./spreadsheet-parsers.js";
import type { SheetData, SheetProfile } from "./spreadsheet-parsers.js";
import { parseSiNoFlag } from "./spreadsheet-normalize.js";

// ---------------------------------------------------------------------------
// blankRecord
// ---------------------------------------------------------------------------

describe("blankRecord", () => {
  it("returns an object (not null, not array)", () => {
    const record = blankRecord();
    expect(record).toBeDefined();
    expect(typeof record).toBe("object");
    expect(Array.isArray(record)).toBe(false);
    expect(record).not.toBeNull();
  });

  it("has all scalar identity fields as empty strings", () => {
    const record = blankRecord();
    expect(record.externalId).toBe("");
    expect(record.type).toBe("");
    expect(record.displayName).toBe("");
    expect(record.firstName).toBe("");
    expect(record.lastName).toBe("");
  });

  it("has all categorization fields as empty strings", () => {
    const record = blankRecord();
    expect(record.area).toBe("");
    expect(record.department).toBe("");
    expect(record.service).toBe("");
    expect(record.specialty).toBe("");
  });

  it("has all location fields as empty strings", () => {
    const record = blankRecord();
    expect(record.building).toBe("");
    expect(record.floor).toBe("");
    expect(record.room).toBe("");
    expect(record.locationText).toBe("");
  });

  it("has all phone1 fields as empty strings", () => {
    const record = blankRecord();
    expect(record.phone1Label).toBe("");
    expect(record.phone1Number).toBe("");
    expect(record.phone1Extension).toBe("");
    expect(record.phone1Kind).toBe("");
    expect(record.phone1IsPrimary).toBe("");
    expect(record.phone1Confidential).toBe("");
    expect(record.phone1NoPatientSharing).toBe("");
    expect(record.phone1Notes).toBe("");
  });

  it("has all phone2 fields as empty strings", () => {
    const record = blankRecord();
    expect(record.phone2Label).toBe("");
    expect(record.phone2Number).toBe("");
    expect(record.phone2Extension).toBe("");
    expect(record.phone2Kind).toBe("");
    expect(record.phone2IsPrimary).toBe("");
    expect(record.phone2Confidential).toBe("");
    expect(record.phone2NoPatientSharing).toBe("");
    expect(record.phone2Notes).toBe("");
  });

  it("has all email fields as empty strings", () => {
    const record = blankRecord();
    expect(record.email1).toBe("");
    expect(record.email1Label).toBe("");
    expect(record.email1IsPrimary).toBe("");
    expect(record.email2).toBe("");
    expect(record.email2Label).toBe("");
    expect(record.email2IsPrimary).toBe("");
  });

  it("has metadata/annotation fields as empty strings", () => {
    const record = blankRecord();
    expect(record.tags).toBe("");
    expect(record.aliases).toBe("");
    expect(record.notes).toBe("");
    expect(record.status).toBe("");
  });

  it("has all field values as strings (not undefined, not null, not boolean)", () => {
    const record = blankRecord();
    for (const [key, value] of Object.entries(record)) {
      expect(typeof value, `field '${key}' should be a string`).toBe("string");
    }
  });

  it("returns a fresh object on each call (not a shared reference)", () => {
    const r1 = blankRecord();
    const r2 = blankRecord();
    expect(r1).not.toBe(r2);
    r1.displayName = "mutated";
    expect(r2.displayName).toBe("");
  });

  it("has exactly the expected set of keys (full shape lock)", () => {
    const record = blankRecord();
    const keys = Object.keys(record).sort();
    expect(keys).toEqual([
      "aliases",
      "area",
      "building",
      "department",
      "displayName",
      "email1",
      "email1IsPrimary",
      "email1Label",
      "email2",
      "email2IsPrimary",
      "email2Label",
      "externalId",
      "firstName",
      "floor",
      "lastName",
      "locationText",
      "notes",
      "phone1Confidential",
      "phone1Extension",
      "phone1IsPrimary",
      "phone1Kind",
      "phone1Label",
      "phone1NoPatientSharing",
      "phone1Notes",
      "phone1Number",
      "phone2Confidential",
      "phone2Extension",
      "phone2IsPrimary",
      "phone2Kind",
      "phone2Label",
      "phone2NoPatientSharing",
      "phone2Notes",
      "phone2Number",
      "role",
      "room",
      "schedule",
      "section",
      "sector",
      "service",
      "social1Handle",
      "social1IsPrimary",
      "social1Label",
      "social1Platform",
      "social1Url",
      "social2Handle",
      "social2IsPrimary",
      "social2Label",
      "social2Platform",
      "social2Url",
      "specialty",
      "status",
      "tags",
      "type",
    ]);
  });
});

// ---------------------------------------------------------------------------
// buildStableExternalId
// ---------------------------------------------------------------------------

describe("buildStableExternalId", () => {
  // Determinism

  it("returns the same id on repeated calls with the same input (determinism)", () => {
    const parts = ["urgencias", "Triaje", "12345"];
    const first = buildStableExternalId(parts);
    const second = buildStableExternalId(parts);
    expect(first).toBe(second);
  });

  it("returns a non-empty string for any input", () => {
    expect(buildStableExternalId(["a"])).toBeTruthy();
    expect(buildStableExternalId([])).toBeTruthy();
    expect(buildStableExternalId(["", undefined, ""])).toBeTruthy();
  });

  // Fallback for fully-empty inputs

  it("falls back to 'row' only when the parts array is completely empty", () => {
    // The || "row" fallback triggers only when the joined result is an empty
    // string, which only happens when parts is an empty array.
    expect(buildStableExternalId([])).toBe("row");
  });

  it("empty-string and undefined parts normalise to 'sheet' (not filtered out)", () => {
    // normalizeAscii("") returns "sheet" as its own fallback, so an empty or
    // undefined part contributes the literal segment "sheet" to the joined id.
    // This documents the actual runtime behavior (golden capture).
    expect(buildStableExternalId([""])).toBe("sheet");
    expect(buildStableExternalId([undefined])).toBe("sheet");
    expect(buildStableExternalId(["", ""])).toBe("sheet-sheet");
  });

  it("whitespace-only parts normalise to 'sheet' (whitespace stripped then fallback)", () => {
    // Spaces become "-" then leading/trailing dashes are stripped, leaving ""
    // which falls back to "sheet".
    expect(buildStableExternalId(["   "])).toBe("sheet");
  });

  // Concrete expected values (ASCII-fold + join behavior)

  it("lowercases segments", () => {
    expect(buildStableExternalId(["Urgencias"])).toBe("urgencias");
    expect(buildStableExternalId(["TRIAJE"])).toBe("triaje");
  });

  it("strips accent diacritics from segments", () => {
    expect(buildStableExternalId(["Café"])).toBe("cafe");
    expect(buildStableExternalId(["Administración"])).toBe("administracion");
    expect(buildStableExternalId(["Núcleo"])).toBe("nucleo");
  });

  it("replaces non-alphanumeric characters with dashes in segments", () => {
    // Space and punctuation become dashes inside a segment, then segments are
    // joined with a dash between them.
    const result = buildStableExternalId(["hello world"]);
    expect(result).toBe("hello-world");
  });

  it("joins multiple segments with a dash separator", () => {
    expect(buildStableExternalId(["urgencias", "triaje", "12345"])).toBe(
      "urgencias-triaje-12345"
    );
  });

  it("empty/undefined parts become 'sheet' segments (not dropped)", () => {
    // Each part is individually normalised: "" → "sheet", undefined → "sheet".
    // The segments are then joined, so gaps become "sheet" placeholders.
    expect(buildStableExternalId(["urgencias", "", "12345"])).toBe(
      "urgencias-sheet-12345"
    );
    expect(buildStableExternalId([undefined, "triaje", undefined])).toBe(
      "sheet-triaje-sheet"
    );
  });

  // Order sensitivity

  it("produces different ids when segment order differs", () => {
    const ab = buildStableExternalId(["alfa", "beta"]);
    const ba = buildStableExternalId(["beta", "alfa"]);
    expect(ab).not.toBe(ba);
    expect(ab).toBe("alfa-beta");
    expect(ba).toBe("beta-alfa");
  });

  // Distinctness for distinct inputs

  it("produces distinct ids for distinct inputs", () => {
    const ids = [
      buildStableExternalId(["urgencias", "12345"]),
      buildStableExternalId(["rayos", "12345"]),
      buildStableExternalId(["urgencias", "99999"]),
    ];
    const unique = new Set(ids);
    expect(unique.size).toBe(3);
  });

  // Single-segment passthrough

  it("returns the normalized single segment directly (no trailing dash)", () => {
    expect(buildStableExternalId(["urgencias"])).toBe("urgencias");
  });

  // Phone-number segments (digits only) pass through unchanged

  it("preserves digit-only segments as-is", () => {
    expect(buildStableExternalId(["12345"])).toBe("12345");
    expect(buildStableExternalId(["urgencias", "12345"])).toBe("urgencias-12345");
  });

  // Real-world example matching service-sheet externalId construction

  it("matches the exact id the service-sheet parser would generate for Urgencias/Triaje/12345", () => {
    // normalizeServiceSheet constructs: `${slug}-${buildStableExternalId([dept, section, phone0, phone1])}`
    // For slug=urgencias, dept=Urgencias, section=Triaje (same as label), phone0=12345, phone1=undefined.
    // undefined → "sheet", so the suffix ends with "-sheet".
    const suffix = buildStableExternalId(["Urgencias", "Triaje", "12345", undefined]);
    expect(suffix).toBe("urgencias-triaje-12345-sheet");

    // When phone1 is also present (two phones), no undefined slot:
    const suffixTwo = buildStableExternalId(["Urgencias", "Triaje", "12345", "67890"]);
    expect(suffixTwo).toBe("urgencias-triaje-12345-67890");
  });
});

// ---------------------------------------------------------------------------
// normalizeServiceSheet — rowHasPhone gating regression
// ---------------------------------------------------------------------------

/**
 * Minimal sheet profile fixture for service-sheet regression tests.
 */
const makeProfile = (department: string): SheetProfile => ({
  parser: "service",
  canonicalSlug: "test",
  department,
  rowsToSkip: 0,
  detectedFormat: "service",
  detectionConfidence: "high"
});

const makeSheet = (name: string, rows: string[][]): SheetData => ({
  name,
  slug: "test",
  rows
});

describe("normalizeServiceSheet — rowHasPhone gating regression", () => {
  it("does NOT emit a contact when the only tail cell is a date (dd/mm/yyyy) — date must not gate rowHasPhone", () => {
    // The label must be ALL-CAPS so that isExcludedLabel() returns true, making
    // the rowHasPhone guard (`if (label && isExcludedLabel(label) && !rowHasPhone)`)
    // observable. Mixed-case labels like "Guardia" are NOT excluded by isExcludedLabel,
    // so that guard never fires regardless of rowHasPhone, and the test cannot isolate
    // the regression.
    //
    // Bug: `phoneNumbers.length > 0` caused extractNumbers("12/03/2024") → ["2024"]
    // (4 digits, within range) to set rowHasPhone=true. rowHasPhone=true then triggers
    // the fallback `label = firstCell` → label becomes "GUARDIA", so the
    // `isExcludedLabel && !rowHasPhone` guard does NOT fire → record is emitted.
    // Fix: looksLikeDateValue("12/03/2024") short-circuits the rowHasPhone check
    // → rowHasPhone stays false → label fallback not triggered → label stays ""
    // → `if (!label) return` fires → no record emitted.
    const sheet = makeSheet("GUARDIA", [["GUARDIA", "12/03/2024"]]);
    const { records } = normalizeServiceSheet(sheet, makeProfile("GUARDIA"));
    expect(records).toHaveLength(0);
  });

  it("does NOT gate rowHasPhone true from a 10-digit number alone (outside 4–9 digit range)", () => {
    // Same rationale as the date test: ALL-CAPS label required so isExcludedLabel()
    // returns true and the rowHasPhone gating path is exercised.
    //
    // Bug: `phoneNumbers.length > 0` caused extractNumbers("1234567890") → ["1234567890"]
    // (10 digits, out of 4–9 range) to set rowHasPhone=true, restoring label "CONTROL"
    // via the fallback and bypassing the guard → record emitted.
    // Fix: only numbers with 4–9 digits qualify for rowHasPhone. The 10-digit number
    // does not qualify → rowHasPhone stays false → label stays "" → `if (!label) return`
    // → no record emitted.
    const sheet = makeSheet("CONTROL", [["CONTROL", "1234567890"]]);
    const { records } = normalizeServiceSheet(sheet, makeProfile("CONTROL"));
    expect(records).toHaveLength(0);
  });

  it("DOES emit a contact when an ALL-CAPS excluded-label row has a real 4–9 digit phone (positive control)", () => {
    // "URGENCIAS" is all-caps → isExcludedLabel() returns true. But "928123456"
    // is 9 digits (within 4–9 range) and not a date → rowHasPhone=true.
    // rowHasPhone=true triggers the label fallback → label = "URGENCIAS" AND
    // causes `isExcludedLabel(label) && !rowHasPhone` to NOT fire → record is emitted.
    // Proves the fix only skips rows that genuinely have no phone-like number.
    const sheet = makeSheet("URGENCIAS", [["URGENCIAS", "928123456"]]);
    const { records } = normalizeServiceSheet(sheet, makeProfile("URGENCIAS"));
    expect(records).toHaveLength(1);
    expect(records[0]!.phone1Number).toBe("928123456");
  });
});

// ---------------------------------------------------------------------------
// normalizeServiceSheet — residual gap (Comentarios must not
// duplicate onto phone-level notes)
// ---------------------------------------------------------------------------

describe("normalizeServiceSheet — residual fix (notes duplication)", () => {
  it("does NOT duplicate note text onto phone-level notes (record.notes stays the source of truth)", () => {
    const sheet = makeSheet("Guardia", [
      ["Guardia", "928123456", "Turno de tarde"],
    ]);
    const { records } = normalizeServiceSheet(sheet, makeProfile("Guardia"));
    const phones = JSON.parse(records[0]!.phones!) as Array<{ notes?: string }>;

    // Record-level notes still carries the note text.
    expect(records[0]!.notes).toBe("Turno de tarde");
    // Phone-level notes must be absent, not a copy of the record-level notes.
    expect(phones[0]!.notes).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// normalizeTabularAgendaSheet / isAgendaTabularHeader / stripPlantaPrefix
// ---------------------------------------------------------------------------

const AGENDA_HEADER_ROW = [
  "Nombre",
  "Categoría",
  "Servicio",
  "Número 1",
  "Número 2",
  "Número 3",
  "Número 4",
  "Número 5",
  "Número 6",
  "Número 7",
  "Horario",
  "Confidencial",
  "Edificio",
  "Planta",
  "Sector",
  "Sección",
  "Comentarios",
];

const makeAgendaProfile = (): SheetProfile => ({
  parser: "tabular",
  canonicalSlug: "agenda",
  department: "",
  area: undefined,
  rowsToSkip: 1,
  detectedFormat: "exportación cruda de agenda tabular",
  detectionConfidence: "high",
});

/** Pads/truncates a sparse row description into the 17-column Agenda shape. */
const agendaRow = (cells: Partial<Record<
  "nombre" | "categoria" | "servicio" | "numero1" | "numero2" | "numero3" | "numero4" |
  "numero5" | "numero6" | "numero7" | "horario" | "confidencial" | "edificio" | "planta" |
  "sector" | "seccion" | "comentarios",
  string
>>): string[] => [
  cells.nombre ?? "",
  cells.categoria ?? "",
  cells.servicio ?? "",
  cells.numero1 ?? "",
  cells.numero2 ?? "",
  cells.numero3 ?? "",
  cells.numero4 ?? "",
  cells.numero5 ?? "",
  cells.numero6 ?? "",
  cells.numero7 ?? "",
  cells.horario ?? "",
  cells.confidencial ?? "",
  cells.edificio ?? "",
  cells.planta ?? "",
  cells.sector ?? "",
  cells.seccion ?? "",
  cells.comentarios ?? "",
];

describe("isAgendaTabularHeader", () => {
  it("matches the exact real 17-column Agenda header", () => {
    expect(isAgendaTabularHeader(AGENDA_HEADER_ROW)).toBe(true);
  });

  it("matches regardless of accent/case/whitespace differences (normalizeMarker)", () => {
    const messy = AGENDA_HEADER_ROW.map((h) => h.toUpperCase());
    expect(isAgendaTabularHeader(messy)).toBe(true);
  });

  it("has exactly 17 markers matching AGENDA_TABULAR_HEADER_MARKERS", () => {
    expect(AGENDA_TABULAR_HEADER_MARKERS).toHaveLength(17);
  });

  it("does NOT match when a column is missing (shorter header)", () => {
    expect(isAgendaTabularHeader(AGENDA_HEADER_ROW.slice(0, 16))).toBe(false);
  });

  it("does NOT match an unrelated header (e.g. legacy service-sheet header)", () => {
    expect(isAgendaTabularHeader(["Servicio", "Número", "Comentarios"])).toBe(false);
  });

  it("does NOT match when columns are reordered", () => {
    const reordered = [...AGENDA_HEADER_ROW];
    [reordered[0], reordered[1]] = [reordered[1]!, reordered[0]!];
    expect(isAgendaTabularHeader(reordered)).toBe(false);
  });
});

describe("stripPlantaPrefix", () => {
  it("strips a leading 'Planta ' (case-insensitive) prefix", () => {
    expect(stripPlantaPrefix("Planta 4")).toBe("4");
    expect(stripPlantaPrefix("planta baja")).toBe("baja");
    expect(stripPlantaPrefix("PLANTA Baja")).toBe("Baja");
  });

  it("leaves a value with no 'Planta ' prefix unchanged", () => {
    expect(stripPlantaPrefix("4")).toBe("4");
    expect(stripPlantaPrefix("Baja")).toBe("Baja");
  });

  it("returns an empty string for an empty/whitespace-only input", () => {
    expect(stripPlantaPrefix("")).toBe("");
    expect(stripPlantaPrefix("   ")).toBe("");
  });
});

describe("parseSiNoFlag", () => {
  it("recognizes 'Si' / 'Sí' case- and accent-insensitively as true", () => {
    expect(parseSiNoFlag("Si")).toBe(true);
    expect(parseSiNoFlag("sí")).toBe(true);
    expect(parseSiNoFlag("SÍ")).toBe(true);
    expect(parseSiNoFlag(" si ")).toBe(true);
  });

  it("treats anything else (including empty string) as false", () => {
    expect(parseSiNoFlag("")).toBe(false);
    expect(parseSiNoFlag("No")).toBe(false);
    expect(parseSiNoFlag("sin")).toBe(false);
    expect(parseSiNoFlag("true")).toBe(false);
  });
});

describe("normalizeTabularAgendaSheet", () => {
  it("maps Servicio -> displayName/service when Nombre is empty", () => {
    const sheet = makeSheet("Agenda", [
      AGENDA_HEADER_ROW,
      agendaRow({ servicio: "Admisión Central", numero1: "79649" }),
    ]);
    const records = normalizeTabularAgendaSheet(sheet, makeAgendaProfile());
    expect(records).toHaveLength(1);
    expect(records[0]!.displayName).toBe("Admisión Central");
    expect(records[0]!.service).toBe("Admisión Central");
  });

  it("prefers Nombre over Servicio for displayName when both are present", () => {
    const sheet = makeSheet("Agenda", [
      AGENDA_HEADER_ROW,
      agendaRow({ nombre: "Nereida", servicio: "Alergia", numero1: "79162" }),
    ]);
    const records = normalizeTabularAgendaSheet(sheet, makeAgendaProfile());
    expect(records[0]!.displayName).toBe("Nereida");
    expect(records[0]!.service).toBe("Alergia");
  });

  it("maps Categoría -> role and Horario -> schedule (new fields)", () => {
    const sheet = makeSheet("Agenda", [
      AGENDA_HEADER_ROW,
      agendaRow({ servicio: "Admisión Central Secretaría", categoria: "Secretario/a", horario: "8:00-22:00", numero1: "70010" }),
    ]);
    const records = normalizeTabularAgendaSheet(sheet, makeAgendaProfile());
    expect(records[0]!.role).toBe("Secretario/a");
    expect(records[0]!.schedule).toBe("8:00-22:00");
  });

  it("maps Edificio -> building and Planta -> floor, stripping the 'Planta ' prefix", () => {
    const sheet = makeSheet("Agenda", [
      AGENDA_HEADER_ROW,
      agendaRow({ servicio: "Enfermedades Emergentes Control (Planta 1)", edificio: "Hospital Polivalente", planta: "Planta 1", numero1: "75348" }),
    ]);
    const records = normalizeTabularAgendaSheet(sheet, makeAgendaProfile());
    expect(records[0]!.building).toBe("Hospital Polivalente");
    expect(records[0]!.floor).toBe("1");
  });

  it("maps Sector -> location.sector and Sección -> location.section (new fields)", () => {
    const sheet = makeSheet("Agenda", [
      AGENDA_HEADER_ROW,
      agendaRow({ servicio: "Anatomía Patológica - Laboratorio", sector: "Laboratorio", numero1: "79543" }),
    ]);
    const records = normalizeTabularAgendaSheet(sheet, makeAgendaProfile());
    expect(records[0]!.sector).toBe("Laboratorio");

    const sheet2 = makeSheet("Agenda", [
      AGENDA_HEADER_ROW,
      agendaRow({ servicio: "Alergia", categoria: "Enfermero/a", seccion: "Enfermería", numero1: "79198" }),
    ]);
    const records2 = normalizeTabularAgendaSheet(sheet2, makeAgendaProfile());
    expect(records2[0]!.section).toBe("Enfermería");
  });

  it("maps Comentarios -> notes", () => {
    const sheet = makeSheet("Agenda", [
      AGENDA_HEADER_ROW,
      agendaRow({ servicio: "Aparcamiento", numero1: "928411034", comentarios: "Personal de la casa" }),
    ]);
    const records = normalizeTabularAgendaSheet(sheet, makeAgendaProfile());
    expect(records[0]!.notes).toBe("Personal de la casa");
  });

  // ---------------------------------------------------------------------------
  // Comentarios must not duplicate onto phone-level notes
  // ---------------------------------------------------------------------------

  it("does NOT duplicate Comentarios onto phone-level notes (record.notes stays the source of truth)", () => {
    const sheet = makeSheet("Agenda", [
      AGENDA_HEADER_ROW,
      agendaRow({
        servicio: "Donaciones",
        numero1: "79454",
        comentarios: "Dónde donar: 8:30-14:30 sala de donantes",
      }),
    ]);
    const records = normalizeTabularAgendaSheet(sheet, makeAgendaProfile());
    const phones = JSON.parse(records[0]!.phones!) as Array<{ notes?: string }>;

    // Record-level notes still carries the Comentarios text.
    expect(records[0]!.notes).toBe("Dónde donar: 8:30-14:30 sala de donantes");
    expect(records[0]!.phone1Notes).toBe("");
    // Phone-level notes must be absent, not a copy of Comentarios.
    expect(phones[0]!.notes).toBeUndefined();
  });

  // ---------------------------------------------------------------------------
  // "Principal" must never be auto-assigned on import
  // ---------------------------------------------------------------------------

  it("does not mark any imported phone as isPrimary by default, even the first one", () => {
    const sheet = makeSheet("Agenda", [
      AGENDA_HEADER_ROW,
      agendaRow({
        servicio: "Admisión Central",
        numero1: "79649",
        numero2: "79650",
      }),
    ]);
    const records = normalizeTabularAgendaSheet(sheet, makeAgendaProfile());
    const phones = JSON.parse(records[0]!.phones!) as Array<{ isPrimary: boolean }>;

    expect(phones.every((p) => p.isPrimary === false)).toBe(true);
    expect(records[0]!.phone1IsPrimary).toBe("false");
    expect(records[0]!.phone2IsPrimary).toBe("false");
  });

  it("extracts a phone from every populated Número 1-7 column (up to 7)", () => {
    const sheet = makeSheet("Agenda", [
      AGENDA_HEADER_ROW,
      agendaRow({
        servicio: "Anatomía Patológica - Laboratorio",
        numero1: "79543",
        numero2: "79544",
        numero3: "79545",
      }),
    ]);
    const records = normalizeTabularAgendaSheet(sheet, makeAgendaProfile());
    const phones = JSON.parse(records[0]!.phones!) as Array<{ number: string }>;
    expect(phones.map((p) => p.number)).toEqual(["79543", "79544", "79545"]);
  });

  it("Confidencial 'Si' sets confidential=true on ALL phones for that row, not just the first", () => {
    const sheet = makeSheet("Agenda", [
      AGENDA_HEADER_ROW,
      agendaRow({
        servicio: "Anatómico Forense (Medicina Legal)",
        numero1: "56884",
        numero2: "677980175",
        confidencial: "Si",
      }),
    ]);
    const records = normalizeTabularAgendaSheet(sheet, makeAgendaProfile());
    const phones = JSON.parse(records[0]!.phones!) as Array<{ number: string; confidential: boolean }>;
    expect(phones).toHaveLength(2);
    expect(phones.every((p) => p.confidential)).toBe(true);
    expect(records[0]!.phone1Confidential).toBe("true");
    expect(records[0]!.phone2Confidential).toBe("true");
  });

  it("leaves confidential=false on all phones when Confidencial is empty", () => {
    const sheet = makeSheet("Agenda", [
      AGENDA_HEADER_ROW,
      agendaRow({ servicio: "Admisión Central", numero1: "79649", numero2: "79650" }),
    ]);
    const records = normalizeTabularAgendaSheet(sheet, makeAgendaProfile());
    const phones = JSON.parse(records[0]!.phones!) as Array<{ confidential: boolean }>;
    expect(phones.every((p) => !p.confidential)).toBe(true);
  });

  it("recognizes 'Sí' (with accent) the same as 'Si'", () => {
    const sheet = makeSheet("Agenda", [
      AGENDA_HEADER_ROW,
      agendaRow({ servicio: "Test", numero1: "12345", confidencial: "Sí" }),
    ]);
    const records = normalizeTabularAgendaSheet(sheet, makeAgendaProfile());
    const phones = JSON.parse(records[0]!.phones!) as Array<{ confidential: boolean }>;
    expect(phones[0]!.confidential).toBe(true);
  });

  it("excludes a section-divider row (single non-empty cell in column 0, e.g. 'Letra A')", () => {
    const sheet = makeSheet("Agenda", [
      AGENDA_HEADER_ROW,
      ["Letra A", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""],
      agendaRow({ servicio: "Admisión Central", numero1: "79649" }),
    ]);
    const records = normalizeTabularAgendaSheet(sheet, makeAgendaProfile());
    expect(records).toHaveLength(1);
    expect(records[0]!.displayName).toBe("Admisión Central");
  });

  it("excludes a row with no Nombre and no Servicio (nothing to build a displayName from)", () => {
    const sheet = makeSheet("Agenda", [
      AGENDA_HEADER_ROW,
      agendaRow({ numero1: "12345" }), // phone with no name/service at all
    ]);
    const records = normalizeTabularAgendaSheet(sheet, makeAgendaProfile());
    expect(records).toHaveLength(0);
  });

  it("produces distinct externalIds for two rows with the same displayName/service", () => {
    const sheet = makeSheet("Agenda", [
      AGENDA_HEADER_ROW,
      agendaRow({ servicio: "Alergia", categoria: "Enfermero/a", numero1: "79198" }),
      agendaRow({ servicio: "Alergia", categoria: "Doctora/or", numero1: "79196" }),
    ]);
    const records = normalizeTabularAgendaSheet(sheet, makeAgendaProfile());
    expect(records).toHaveLength(2);
    expect(records[0]!.externalId).not.toBe(records[1]!.externalId);
  });

  // -------------------------------------------------------------------------
  // Categoría -> type mapping (primary, with heuristic fallback)
  // -------------------------------------------------------------------------

  it("maps a known Categoría value ('Enfermero/a') to type 'person' (primary mechanism)", () => {
    const sheet = makeSheet("Agenda", [
      AGENDA_HEADER_ROW,
      agendaRow({ servicio: "Alergia", categoria: "Enfermero/a", numero1: "79198" }),
    ]);
    const records = normalizeTabularAgendaSheet(sheet, makeAgendaProfile());
    expect(records[0]!.type).toBe("person");
  });

  it("maps a known leadership Categoría value ('Jefe/a') to type 'supervision' (primary mechanism)", () => {
    const sheet = makeSheet("Agenda", [
      AGENDA_HEADER_ROW,
      agendaRow({ servicio: "Almacén", categoria: "Jefe/a", numero1: "70263" }),
    ]);
    const records = normalizeTabularAgendaSheet(sheet, makeAgendaProfile());
    expect(records[0]!.type).toBe("supervision");
  });

  it("matches a Categoría value case-insensitively (real-file case variant 'Jefe/a de estudio' vs 'Jefe/a De Estudio')", () => {
    const sheet = makeSheet("Agenda", [
      AGENDA_HEADER_ROW,
      agendaRow({ servicio: "Test", categoria: "jefe/a de estudio", numero1: "11111" }),
    ]);
    const records = normalizeTabularAgendaSheet(sheet, makeAgendaProfile());
    expect(records[0]!.type).toBe("supervision");
  });

  it("defaults to 'other' (no keyword guessing) when Categoría is blank", () => {
    const sheet = makeSheet("Agenda", [
      AGENDA_HEADER_ROW,
      agendaRow({ servicio: "Supervisión de Enfermería", numero1: "22222" }),
    ]);
    const records = normalizeTabularAgendaSheet(sheet, makeAgendaProfile());
    // No Categoría mapping applies (blank) — type is never guessed
    // from displayName keywords, so it defaults to the neutral "other".
    expect(records[0]!.type).toBe("other");
  });

  it("defaults to 'other' (no keyword guessing) when Categoría has no mapped entry", () => {
    const sheet = makeSheet("Agenda", [
      AGENDA_HEADER_ROW,
      agendaRow({ servicio: "Sala De Espera", categoria: "Un Valor Sin Mapear", numero1: "33333" }),
    ]);
    const records = normalizeTabularAgendaSheet(sheet, makeAgendaProfile());
    // Unmapped Categoría — type is never guessed from displayName
    // keywords, so it defaults to the neutral "other".
    expect(records[0]!.type).toBe("other");
  });

  it("still populates role from Categoría even when Categoría also drives type", () => {
    const sheet = makeSheet("Agenda", [
      AGENDA_HEADER_ROW,
      agendaRow({ servicio: "Enfermedades Emergentes (Despacho)", categoria: "Auxiliar Administrativo/a", numero1: "75340" }),
    ]);
    const records = normalizeTabularAgendaSheet(sheet, makeAgendaProfile());
    expect(records[0]!.role).toBe("Auxiliar Administrativo/a");
    expect(records[0]!.type).toBe("person");
  });

  // -------------------------------------------------------------------------
  // Área is left blank for Agenda-imported records
  // -------------------------------------------------------------------------

  it("leaves área blank instead of guessing one from Servicio/displayName (no genuine Área column in the real file)", () => {
    const sheet = makeSheet("Agenda", [
      AGENDA_HEADER_ROW,
      // "Admisión" would previously have driven inferAreaFromLabel to guess
      // "gestion-administracion" — that guess must no longer happen.
      agendaRow({ servicio: "Admisión Central", numero1: "79649" }),
    ]);
    const records = normalizeTabularAgendaSheet(sheet, makeAgendaProfile());
    expect(records[0]!.area).toBe("");
  });

  // -------------------------------------------------------------------------
  // Inserted "Fax" column (e.g. the real "Sindicatos" sheet)
  // -------------------------------------------------------------------------

  const AGENDA_HEADER_ROW_WITH_FAX = [
    ...AGENDA_HEADER_ROW.slice(0, 10),
    "Fax",
    ...AGENDA_HEADER_ROW.slice(10),
  ];

  it("maps a value in an inserted Fax column to a phone entry with kind 'fax'", () => {
    const rowWithFax = [
      "Juan Pérez", // Nombre
      "Enfermero/a", // Categoría
      "Urgencias", // Servicio
      "11111", "", "", "", "", "", "", // Número 1..7
      "912345678", // Fax
      "", "", "", "", "", "", "", // Horario..Comentarios
    ];
    const sheet = makeSheet("Sindicatos", [AGENDA_HEADER_ROW_WITH_FAX, rowWithFax]);
    const records = normalizeTabularAgendaSheet(sheet, makeAgendaProfile());
    expect(records).toHaveLength(1);
    const phones = JSON.parse(records[0]!.phones!) as Array<{ number: string; kind: string }>;
    const faxEntry = phones.find((entry) => entry.kind === "fax");
    expect(faxEntry).toBeDefined();
    expect(faxEntry?.number).toBe("912345678");
  });

  it("does not add a fax phone entry when the inserted Fax column is empty", () => {
    const rowWithoutFax = [
      "Juan Pérez", // Nombre
      "Enfermero/a", // Categoría
      "Urgencias", // Servicio
      "11111", "", "", "", "", "", "", // Número 1..7
      "", // Fax (empty)
      "", "", "", "", "", "", "", // Horario..Comentarios
    ];
    const sheet = makeSheet("Sindicatos", [AGENDA_HEADER_ROW_WITH_FAX, rowWithoutFax]);
    const records = normalizeTabularAgendaSheet(sheet, makeAgendaProfile());
    expect(records).toHaveLength(1);
    const phones = JSON.parse(records[0]!.phones!) as Array<{ kind: string }>;
    expect(phones.some((entry) => entry.kind === "fax")).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Inserted "Busca 1" / "Corporativo 1" columns (OIR-265)
  // -------------------------------------------------------------------------

  const AGENDA_HEADER_ROW_WITH_BUSCA_CORPORATIVO = [
    ...AGENDA_HEADER_ROW.slice(0, 10),
    "Busca 1",
    "Corporativo 1",
    ...AGENDA_HEADER_ROW.slice(10),
  ];

  it("maps a value in an inserted 'Busca 1' column onto record.buscas, not phones", () => {
    const rowWithBusca = [
      "Juan Pérez", // Nombre
      "Enfermero/a", // Categoría
      "Urgencias", // Servicio
      "11111", "", "", "", "", "", "", // Número 1..7
      "4321", // Busca 1
      "", // Corporativo 1
      "", "", "", "", "", "", "", // Horario..Comentarios
    ];
    const sheet = makeSheet("ConBusca", [AGENDA_HEADER_ROW_WITH_BUSCA_CORPORATIVO, rowWithBusca]);
    const records = normalizeTabularAgendaSheet(sheet, makeAgendaProfile());
    expect(records).toHaveLength(1);

    const buscas = JSON.parse(records[0]!.buscas!) as Array<{ number: string; label?: string }>;
    expect(buscas).toHaveLength(1);
    expect(buscas[0]!.number).toBe("4321");

    // Must NOT be present in contactMethods.phones.
    const phones = JSON.parse(records[0]!.phones!) as Array<{ number: string }>;
    expect(phones.some((entry) => entry.number === "4321")).toBe(false);
  });

  it("maps a value in an inserted 'Corporativo 1' column to a phone entry with kind 'corporativo'", () => {
    const rowWithCorporativo = [
      "Juan Pérez", // Nombre
      "Enfermero/a", // Categoría
      "Urgencias", // Servicio
      "11111", "", "", "", "", "", "", // Número 1..7
      "", // Busca 1
      "656 12 34 56", // Corporativo 1
      "", "", "", "", "", "", "", // Horario..Comentarios
    ];
    const sheet = makeSheet("ConBusca", [AGENDA_HEADER_ROW_WITH_BUSCA_CORPORATIVO, rowWithCorporativo]);
    const records = normalizeTabularAgendaSheet(sheet, makeAgendaProfile());
    expect(records).toHaveLength(1);

    const phones = JSON.parse(records[0]!.phones!) as Array<{ number: string; kind: string; label?: string }>;
    const corporativoEntry = phones.find((entry) => entry.kind === "corporativo");
    expect(corporativoEntry).toBeDefined();
    expect(corporativoEntry?.number).toBe("656123456");
    expect(corporativoEntry?.label).toBe("Corporativo");
  });

  it("does not add a busca entry or a corporativo phone entry when both inserted columns are empty", () => {
    const rowWithoutEither = [
      "Juan Pérez", // Nombre
      "Enfermero/a", // Categoría
      "Urgencias", // Servicio
      "11111", "", "", "", "", "", "", // Número 1..7
      "", // Busca 1 (empty)
      "", // Corporativo 1 (empty)
      "", "", "", "", "", "", "", // Horario..Comentarios
    ];
    const sheet = makeSheet("ConBusca", [AGENDA_HEADER_ROW_WITH_BUSCA_CORPORATIVO, rowWithoutEither]);
    const records = normalizeTabularAgendaSheet(sheet, makeAgendaProfile());
    expect(records).toHaveLength(1);

    const buscas = JSON.parse(records[0]!.buscas!) as unknown[];
    expect(buscas).toHaveLength(0);

    const phones = JSON.parse(records[0]!.phones!) as Array<{ kind: string }>;
    expect(phones.some((entry) => entry.kind === "corporativo")).toBe(false);
  });

  it("does not populate record.buscas or an inserted-column phone entry on a sheet without Busca/Corporativo columns (regression guard)", () => {
    const sheet = makeSheet("Agenda", [
      AGENDA_HEADER_ROW,
      agendaRow({ servicio: "Admisión Central", numero1: "79649" }),
    ]);
    const records = normalizeTabularAgendaSheet(sheet, makeAgendaProfile());
    expect(records).toHaveLength(1);

    const buscas = JSON.parse(records[0]!.buscas!) as unknown[];
    expect(buscas).toHaveLength(0);

    const phones = JSON.parse(records[0]!.phones!) as Array<{ kind: string }>;
    expect(phones.every((entry) => entry.kind !== "corporativo")).toBe(true);
    expect(phones).toHaveLength(1);
  });
});
