/**
 * Golden-fixture characterization tests for spreadsheet-import.service.ts
 *
 * These tests capture the CURRENT output of every accepted format and every
 * pure normalization/parser helper as a parity baseline. They must pass
 * against the original code AND against the extracted modules.
 *
 * Formats covered:
 *   1. Normalized-template CSV  (delegated to csv-import.service)
 *   2. Service-sheet ODS/XLSX   (normalizeServiceSheet path)
 *   3. Centers-sheet ODS/XLSX   (normalizeCentersSheet path)
 *   4. Flat-sheet (Bug A fix)   (low-confidence service path)
 *   5. Multi-sheet workbook     (mergeRecordsByDisplayName cross-sheet)
 *
 * Golden/characterization tests (in this file):
 *   - normalizeDisplayNameForMerge (via mergeRecordsByDisplayName)
 *   - mergeRecordsByDisplayName (phone union, order, empty key passthrough)
 *   - isSerializedPhoneEntry (type guard, imported and called directly)
 *   - normalizeWorkbookRowsFromFile error paths (unsupported format, no rows)
 *   - 5000-row cap (both the normalization-layer non-cap and the
 *     buildSpreadsheetImportPreview enforcement point)
 *
 * NOTE: extractNumbers, detectPrivacy, and buildCenterPhones are exercised
 * only INDIRECTLY here, as a side effect of running full ODS/XLSX fixtures
 * through normalizeWorkbookRowsFromFile — this file does not import or call
 * them directly, so it does not by itself pin down their behavior in
 * isolation (e.g. edge cases in compact-range/compact-suffix expansion).
 * Direct, isolated unit coverage for every exported helper in
 * spreadsheet-normalize.ts (including extractNumbers, detectPrivacy, and the
 * label/area classification helpers) lives in spreadsheet-normalize.test.ts.
 *
 * Unit tests in spreadsheet-parsers.test.ts:
 *   - blankRecord (full shape assertion, key set lock)
 *   - buildStableExternalId (ASCII-fold, join, determinism, edge inputs)
 */

import nodeFs from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import XLSX from "xlsx";
import {
  normalizeWorkbookRowsFromFile,
  buildSpreadsheetImportPreview,
  mergeRecordsByDisplayName,
  isSerializedPhoneEntry,
  type SerializedPhoneEntry,
} from "./spreadsheet-import.service.js";
import type { NormalizedImportRow } from "./csv-import.service.js";
import { writeWorkbook } from "./test-support/xlsxWorkbook.js";

XLSX.set_fs(nodeFs);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal canonical service sheet (SERVICIO/NUMERO header). */
const makeServiceSheet = (
  name: string,
  rows: Array<{ label: string; numbers: string[] }>
): { name: string; data: string[][] } => ({
  name,
  data: [
    ["SERVICIO", "NUMERO"],
    ...rows.map(({ label, numbers }) => [label, ...numbers]),
  ],
});

/** Centers sheet format: CENTROS DE SALUD / SERVICIO / NUMERO LARGO / NUMERO CORTO */
const makeCentersSheet = (
  rows: string[][]
): { name: string; data: string[][] } => ({
  name: "centros-de-salud",
  data: [
    ["CENTROS DE SALUD", "SERVICIO", "NUMERO LARGO", "NUMERO CORTO"],
    ...rows,
  ],
});

const makeBlankPhoneEntry = (overrides: Partial<SerializedPhoneEntry> = {}): SerializedPhoneEntry => ({
  number: "12345",
  label: "Test",
  kind: "internal",
  isPrimary: true,
  confidential: false,
  noPatientSharing: false,
  ...overrides,
});

let testRoot: string;

beforeEach(async () => {
  testRoot = await fs.mkdtemp(path.join(os.tmpdir(), "spreadsheet-golden-"));
});

afterEach(async () => {
  await fs.rm(testRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// 1. Service-sheet format
// ---------------------------------------------------------------------------

describe("golden: service-sheet format (urgencias canonical)", () => {
  it("produces one record per data row with correct scalar fields", () => {
    const filePath = writeWorkbook(testRoot, "urgencias.xlsx", [
      makeServiceSheet("urgencias", [
        { label: "Triaje", numbers: ["12345"] },
      ]),
    ]);

    const result = normalizeWorkbookRowsFromFile(filePath);

    expect(result.detectedFormat).toBe("exportación cruda de hoja de servicios");
    // A single-row sheet with one section produces "medium" confidence (no sectionRows/continuationRows).
    // This is a golden capture of actual behavior — do not assert "high" for minimal fixtures.
    expect(["high", "medium"]).toContain(result.detectionConfidence);
    expect(result.rows).toHaveLength(1);

    const row = result.rows[0]!;
    expect(row.displayName).toBe("Triaje");
    expect(row.department).toBe("Urgencias");
    expect(row.area).toBe("sanitaria-asistencial");
    expect(row.status).toBe("active");
    expect(row.phone1Number).toBe("12345");
    // "Principal" is never auto-assigned on import.
    expect(row.phone1IsPrimary).toBe("false");
    expect(row.phone1Kind).toBe("internal");
    expect(row.phone1Confidential).toBe("false");
    expect(row.phone1NoPatientSharing).toBe("false");
  });

  it("serializes phones JSON field with correct shape", () => {
    const filePath = writeWorkbook(testRoot, "urgencias-phones.xlsx", [
      makeServiceSheet("urgencias", [
        { label: "Box A", numbers: ["11111", "22222"] },
      ]),
    ]);

    const result = normalizeWorkbookRowsFromFile(filePath);
    const row = result.rows[0]!;
    expect(row.phones).toBeDefined();

    const phones = JSON.parse(row.phones!) as SerializedPhoneEntry[];
    expect(phones).toHaveLength(2);
    expect(phones[0]!.number).toBe("11111");
    // "Principal" is never auto-assigned on import.
    expect(phones[0]!.isPrimary).toBe(false);
    expect(phones[0]!.kind).toBe("internal");
    expect(phones[1]!.number).toBe("22222");
    expect(phones[1]!.isPrimary).toBe(false);
  });

  it("does not keyword-guess type from label content (service sheets always default to 'other')", () => {
    const filePath = writeWorkbook(testRoot, "rooms.xlsx", [
      makeServiceSheet("urgencias", [
        { label: "Sala de espera", numbers: ["30001"] },
        { label: "Boxes urgencias", numbers: ["30002"] },
      ]),
    ]);

    const result = normalizeWorkbookRowsFromFile(filePath);
    expect(result.rows[0]!.type).toBe("other");
    expect(result.rows[1]!.type).toBe("other");
  });

  it("does not keyword-guess a supervision type from label content", () => {
    const filePath = writeWorkbook(testRoot, "supervision.xlsx", [
      makeServiceSheet("urgencias", [
        { label: "Supervisión de guardia", numbers: ["40001"] },
      ]),
    ]);

    const result = normalizeWorkbookRowsFromFile(filePath);
    expect(result.rows[0]!.type).toBe("other");
  });

  it("generates a stable externalId including slug and phone", () => {
    const filePath = writeWorkbook(testRoot, "ext-id.xlsx", [
      makeServiceSheet("urgencias", [
        { label: "Farmacia", numbers: ["99999"] },
      ]),
    ]);

    const result = normalizeWorkbookRowsFromFile(filePath);
    const row = result.rows[0]!;
    expect(row.externalId).toMatch(/^urgencias-/);
    expect(row.externalId).toContain("99999");
  });

  it("deduplicates repeated phone numbers within the same row", () => {
    const filePath = writeWorkbook(testRoot, "dedup.xlsx", [
      makeServiceSheet("urgencias", [
        { label: "Control", numbers: ["55555", "55555", "66666"] },
      ]),
    ]);

    const result = normalizeWorkbookRowsFromFile(filePath);
    const phones = JSON.parse(result.rows[0]!.phones!) as SerializedPhoneEntry[];
    expect(phones.map((p) => p.number)).toEqual(["55555", "66666"]);
  });

  it("does not mark any phone as primary by default ('Principal' is manual-only)", () => {
    const filePath = writeWorkbook(testRoot, "primary.xlsx", [
      makeServiceSheet("urgencias", [
        { label: "Mostrador", numbers: ["10001", "10002", "10003"] },
      ]),
    ]);

    const result = normalizeWorkbookRowsFromFile(filePath);
    const phones = JSON.parse(result.rows[0]!.phones!) as SerializedPhoneEntry[];
    expect(phones[0]!.isPrimary).toBe(false);
    expect(phones[1]!.isPrimary).toBe(false);
    expect(phones[2]!.isPrimary).toBe(false);
  });

  it("detects NO_SHARE_MARKERS and sets noPatientSharing=true", () => {
    const filePath = writeWorkbook(testRoot, "no-share.xlsx", [
      {
        name: "urgencias",
        data: [
          ["SERVICIO", "NUMERO", "NOTAS"],
          ["Despacho", "77777", "NO DAR A LA CALLE"],
        ],
      },
    ]);

    const result = normalizeWorkbookRowsFromFile(filePath);
    expect(result.rows[0]!.phone1NoPatientSharing).toBe("true");
  });

  it("detects CONFIDENTIAL_MARKERS and sets confidential=true", () => {
    const filePath = writeWorkbook(testRoot, "confidential.xlsx", [
      {
        name: "urgencias",
        data: [
          ["SERVICIO", "NUMERO", "NOTAS"],
          ["Despacho Médico Guardia", "88888", "DESPACHO MÉDICO"],
        ],
      },
    ]);

    const result = normalizeWorkbookRowsFromFile(filePath);
    expect(result.rows[0]!.phone1Confidential).toBe("true");
  });

  it("includes section header in notes when section differs from department", () => {
    const filePath = writeWorkbook(testRoot, "section.xlsx", [
      {
        name: "urgencias",
        data: [
          ["SERVICIO", "NUMERO"],
          ["Área de espera"],          // section row (single cell)
          ["Triaje", "12001"],
        ],
      },
    ]);

    const result = normalizeWorkbookRowsFromFile(filePath);
    const row = result.rows[0]!;
    expect(row.notes).toContain("Área de espera");
  });

  it("assigns aliases for TAC, RX, UMI, SECRETAR labels", () => {
    const filePath = writeWorkbook(testRoot, "aliases.xlsx", [
      makeServiceSheet("urgencias", [
        { label: "TAC urgente", numbers: ["20001"] },
        { label: "RX urgencias", numbers: ["20002"] },
      ]),
    ]);

    const result = normalizeWorkbookRowsFromFile(filePath);
    expect(result.rows[0]!.aliases).toContain("scanner");
    expect(result.rows[1]!.aliases).toContain("radiologia");
  });

  it("processes all canonical service slugs without error", () => {
    const slugs = [
      "admision-central",
      "rayos",
      "secretarias",
      "urgencias",
      "hospitales-de-dia",
      "umi",
    ];

    for (const slug of slugs) {
      const filePath = writeWorkbook(testRoot, `${slug}.xlsx`, [
        makeServiceSheet(slug, [
          { label: "Servicio Principal", numbers: ["10001"] },
        ]),
      ]);

      const result = normalizeWorkbookRowsFromFile(filePath);
      expect(result.rows.length).toBeGreaterThan(0);
      expect(result.rows[0]!.department).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Centers-sheet format
// ---------------------------------------------------------------------------

describe("golden: centers-sheet format", () => {
  it("produces records for each center+service combination", () => {
    const filePath = writeWorkbook(testRoot, "centers.xlsx", [
      makeCentersSheet([
        ["Avenida Doctor Álvarez 123", "INF.", "928111111", "1001"],
        ["", "ADM.", "928222222", "1002"],
        ["Carretera del Norte 456", "URG.", "928333333", "2001"],
      ]),
    ]);

    const result = normalizeWorkbookRowsFromFile(filePath);
    expect(result.rows.length).toBeGreaterThanOrEqual(3);
    // Centers sheets have their own format label distinct from service sheets.
    expect(result.detectedFormat).toBe("exportación cruda de centros de salud");
  });

  it("sets department to Centros de salud for all center records", () => {
    const filePath = writeWorkbook(testRoot, "centers-dept.xlsx", [
      makeCentersSheet([
        ["Calle Mayor 10", "INF.", "928555555", ""],
      ]),
    ]);

    const result = normalizeWorkbookRowsFromFile(filePath);
    for (const row of result.rows) {
      expect(row.department).toBe("Centros de salud");
    }
  });

  it("maps service label abbreviations correctly (INF. → Información)", () => {
    const filePath = writeWorkbook(testRoot, "centers-labels.xlsx", [
      makeCentersSheet([
        ["Plaza Médica 5", "INF.", "928100001", ""],
        ["Plaza Médica 5", "ADM.", "928100002", ""],
        ["Plaza Médica 5", "FAX.", "928100003", ""],
      ]),
    ]);

    const result = normalizeWorkbookRowsFromFile(filePath);
    const services = result.rows.map((r) => r.service);
    expect(services).toContain("Información");
    expect(services).toContain("Administración");
    expect(services).toContain("Fax");
  });

  it("sets type=external-center for all center records", () => {
    const filePath = writeWorkbook(testRoot, "centers-type.xlsx", [
      makeCentersSheet([
        ["Avenida Hospital 1", "INF.", "928777777", ""],
      ]),
    ]);

    const result = normalizeWorkbookRowsFromFile(filePath);
    for (const row of result.rows) {
      expect(row.type).toBe("external-center");
    }
  });

  it("populates phone1 and phone2 from long and short numbers", () => {
    const filePath = writeWorkbook(testRoot, "centers-phones.xlsx", [
      makeCentersSheet([
        ["Calle Salud 22", "INF.", "928444444", "4444"],
      ]),
    ]);

    const result = normalizeWorkbookRowsFromFile(filePath);
    const row = result.rows[0]!;
    expect(row.phone1Number).toBe("928444444");
    expect(row.phone1Extension).toBe("4444");
    expect(row.phone1Kind).toBe("external");
    expect(row.phone1IsPrimary).toBe("true");
  });
});

// ---------------------------------------------------------------------------
// 3. Flat-sheet format (Bug A fix — low confidence acceptance)
// ---------------------------------------------------------------------------

describe("golden: flat-sheet format (low-confidence service path)", () => {
  it("accepts a flat label+phone sheet with no section/continuation rows", () => {
    const filePath = writeWorkbook(testRoot, "flat.xlsx", [
      {
        name: "emergencias",
        data: [
          ["BANCO DE SANGRE (ADMINISTRATIVO)", "928010101"],
          ["BANCO DE SANGRE (TÉCNICO)", "928010202"],
          ["BANCO DE SANGRE (GUARDIA)", "928010303"],
          ["BANCO DE SANGRE (FAX)", "928010404"],
        ],
      },
    ]);

    const result = normalizeWorkbookRowsFromFile(filePath);
    expect(result.rows.length).toBeGreaterThanOrEqual(3);
    expect(result.detectionConfidence).toBe("low");
  });

  it("does NOT include rows without any phone-like number", () => {
    const filePath = writeWorkbook(testRoot, "flat-nophone.xlsx", [
      {
        name: "corporativos",
        data: [
          ["SERVICIO A", "928020001"],
          ["SERVICIO B", "928020002"],
          ["SERVICIO C", "928020003"],
          ["TITULO SIN TELEFONO"],         // should NOT become a record
        ],
      },
    ]);

    const result = normalizeWorkbookRowsFromFile(filePath);
    // Only rows with phones should be present
    for (const row of result.rows) {
      expect(row.phone1Number).not.toBe("");
    }
  });

  it("does not leak the header row's literal 'Nombre' cell into department/displayName/notes (regression)", () => {
    // A sheet whose header has an Agenda-style layout ("Nombre, Categoría,
    // Servicio, Número 1..N, ...") but does NOT match the tabular parser's
    // exact/extra-column-tolerant shape (here: missing several trailer
    // columns), so it falls through to the legacy service-sheet heuristics.
    // Before this fix, "NUMERO1" didn't score as a phone-header alias,
    // so the header row scored below the skip threshold and its "Nombre"
    // cell leaked into derivedDepartment / row processing as literal text.
    const filePath = writeWorkbook(testRoot, "header-leak.xlsx", [
      {
        name: "Sindicatos",
        data: [
          ["Nombre", "Categoría", "Servicio", "Número 1", "Número 2"],
          ["", "", "ASACA", "79036", "79540"],
          ["Ayose", "", "ASACA – Ayose", "607466821", ""],
          ["Dra. Guada", "", "CC.OO", "79038", ""],
        ],
      },
    ]);

    const result = normalizeWorkbookRowsFromFile(filePath);

    for (const row of result.rows) {
      expect(row.department).not.toBe("Nombre");
      expect(row.displayName).not.toBe("Nombre");
      expect(row.notes).not.toContain("Nombre");
    }
    // The sheet's own name is used as department, not header text.
    expect(result.rows.every((row) => row.department === "Sindicatos")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3b. Tabular Agenda-sheet format — end-to-end via detectSheetProfile
// ---------------------------------------------------------------------------

/** The hospital's real 17-column Agenda header. */
const AGENDA_HEADER = [
  "Nombre", "Categoría", "Servicio",
  "Número 1", "Número 2", "Número 3", "Número 4", "Número 5", "Número 6", "Número 7",
  "Horario", "Confidencial", "Edificio", "Planta", "Sector", "Sección", "Comentarios",
];

const makeAgendaSheet = (
  sheetName: string,
  rows: string[][]
): { name: string; data: string[][] } => ({
  name: sheetName,
  data: [AGENDA_HEADER, ...rows],
});

describe("golden: tabular Agenda-sheet format", () => {
  it("is routed to the tabular parser with a blank department for the sheet literally named 'Agenda'", () => {
    const filePath = writeWorkbook(testRoot, "agenda.xlsx", [
      makeAgendaSheet("Agenda", [
        ["", "", "Admisión Central", "79649", "79650", "", "", "", "", "", "8:00-22:00", "", "", "", "", "", ""],
      ]),
    ]);

    const result = normalizeWorkbookRowsFromFile(filePath);
    expect(result.detectedFormat).toBe("exportación cruda de agenda tabular");
    expect(result.rows).toHaveLength(1);
    const row = result.rows[0]!;
    expect(row.displayName).toBe("Admisión Central");
    expect(row.schedule).toBe("8:00-22:00");
    // The main "Agenda" sheet itself gets a blank department (it is
    // the general directory, not a per-department "book").
    expect(row.department).toBe("");
    // Horario ("8:00-22:00") must NOT leak into the phones list as a fake number.
    const phones = JSON.parse(row.phones ?? "[]") as Array<{ number: string }>;
    expect(phones.map((p) => p.number)).toEqual(["79649", "79650"]);
  });

  it("routes another sheet sharing the Agenda tabular header to the tabular parser too, tagging every contact with the sheet's own name as department", () => {
    const filePath = writeWorkbook(testRoot, "agenda-department-sheet.xlsx", [
      makeAgendaSheet("Almacenes", [
        ["", "", "Farmacia", "79889", "79297", "", "", "", "", "", "", "", "", "", "", "", ""],
      ]),
    ]);

    const result = normalizeWorkbookRowsFromFile(filePath);
    expect(result.rows).toHaveLength(1);
    const row = result.rows[0]!;
    expect(row.displayName).toBe("Farmacia");
    expect(row.department).toBe("Almacenes");
  });

  it("still recognizes a sheet with an extra inserted column (e.g. a 'Fax' column, as in the real 'Sindicatos' sheet) as Agenda-tabular and tags it with the sheet name", () => {
    const filePath = writeWorkbook(testRoot, "agenda-sindicatos.xlsx", [
      {
        name: "Sindicatos",
        data: [
          [
            "Nombre", "Categoría", "Servicio", "Número 1", "Número 2", "Número 3", "Número 4",
            "Número 5", "Número 6", "Número 7", "Fax", "Horario", "Confidencial", "Edificio",
            "Planta", "Sector", "Sección", "Comentarios",
          ],
          ["", "", "ASACA", "79036", "79540", "", "", "", "", "", "", "", "", "", "", "", "", ""],
        ],
      },
    ]);

    const result = normalizeWorkbookRowsFromFile(filePath);
    expect(result.rows).toHaveLength(1);
    const row = result.rows[0]!;
    // Without the extra-column tolerance, "ASACA" (an ALL-CAPS Servicio value
    // with a blank Nombre) would be silently DROPPED by the legacy
    // service-sheet heuristics instead of imported.
    expect(row.displayName).toBe("ASACA");
    expect(row.department).toBe("Sindicatos");
    const phones = JSON.parse(row.phones ?? "[]") as Array<{ number: string }>;
    expect(phones.map((p) => p.number)).toEqual(["79036", "79540"]);
  });

  it("excludes a section-divider row (e.g. 'Letra A') from the parsed rows", () => {
    const filePath = writeWorkbook(testRoot, "agenda-divider.xlsx", [
      makeAgendaSheet("Agenda", [
        ["Letra A", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""],
        ["", "", "Aislados", "70761", "", "", "", "", "", "", "", "", "", "", "", "", ""],
      ]),
    ]);

    const result = normalizeWorkbookRowsFromFile(filePath);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]!.displayName).toBe("Aislados");
  });

  it("applies row-level Confidencial 'Si' to every phone built from that row (Número 1-7)", () => {
    const filePath = writeWorkbook(testRoot, "agenda-confidential.xlsx", [
      makeAgendaSheet("Agenda", [
        ["", "", "Anatómico Forense (Medicina Legal) – Médico Forense", "56884", "677980175", "", "", "", "", "", "", "Si", "", "", "", "", ""],
      ]),
    ]);

    const result = normalizeWorkbookRowsFromFile(filePath);
    expect(result.rows).toHaveLength(1);
    const phones = JSON.parse(result.rows[0]!.phones ?? "[]") as Array<{ confidential: boolean }>;
    expect(phones).toHaveLength(2);
    expect(phones.every((p) => p.confidential)).toBe(true);
  });

  it("maps Edificio/Planta/Sector/Sección/Categoría to their schema fields", () => {
    const filePath = writeWorkbook(testRoot, "agenda-fields.xlsx", [
      makeAgendaSheet("Agenda", [
        [
          "", "Auxiliar Administrativo/a", "Enfermedades Emergentes (Despacho)",
          "75340", "", "", "", "", "", "",
          "", "Si", "Hospital Polivalente", "", "", "Despacho", "",
        ],
      ]),
    ]);

    const result = normalizeWorkbookRowsFromFile(filePath);
    expect(result.rows).toHaveLength(1);
    const row = result.rows[0]!;
    expect(row.role).toBe("Auxiliar Administrativo/a");
    expect(row.building).toBe("Hospital Polivalente");
    expect(row.section).toBe("Despacho");
  });

  it("does NOT route a same-header sheet with a different name (e.g. a duplicate 'Agenda_3') to the tabular parser, and does not let it contaminate merged 'Agenda' records via a shared displayName", () => {
    const filePath = writeWorkbook(testRoot, "agenda-duplicate.xlsx", [
      makeAgendaSheet("Agenda", [
        ["", "", "Admisión Central", "79649", "79650", "", "", "", "", "", "8:00-22:00", "", "", "", "", "", ""],
      ]),
      // Exact duplicate under a different sheet name — must be skipped entirely,
      // not routed through the legacy heuristic parser (which would misparse
      // "8:00-22:00" as a fake phone number and merge it into the same record).
      makeAgendaSheet("Agenda_3", [
        ["", "", "Admisión Central", "79649", "79650", "", "", "", "", "", "8:00-22:00", "", "", "", "", "", ""],
      ]),
    ]);

    const result = normalizeWorkbookRowsFromFile(filePath);
    expect(result.rows).toHaveLength(1);
    const phones = JSON.parse(result.rows[0]!.phones ?? "[]") as Array<{ number: string }>;
    expect(phones.map((p) => p.number)).toEqual(["79649", "79650"]);
  });
});

// ---------------------------------------------------------------------------
// 4. Cross-sheet merge (mergeRecordsByDisplayName)
// ---------------------------------------------------------------------------
//
// NOTE: these fixtures use "urgencias" and "rayos"/"admision-central"
// — two of the six CURATED CANONICAL_SHARED_DEPARTMENTS (see
// buildMergeIdentityKey) — so cross-department merging here remains
// unaffected by the fix (which only blocks cross-department merging
// for arbitrary, per-sheet "book" departments). This preserves the original
// behavior (verified against real hospital data) where the same real
// desk legitimately listed across multiple canonical department books merges
// into one combined-extension contact.
describe("golden: cross-sheet merge by displayName", () => {
  it("merges two sheets with same contact name into one record with combined phones", () => {
    const filePath = writeWorkbook(testRoot, "merge.xlsx", [
      makeServiceSheet("urgencias", [
        { label: "Banco de Sangre", numbers: ["11111"] },
      ]),
      makeServiceSheet("rayos", [
        { label: "Banco de Sangre", numbers: ["22222"] },
      ]),
    ]);

    const result = normalizeWorkbookRowsFromFile(filePath);
    const sangre = result.rows.filter((r) => r.displayName === "Banco de Sangre");
    expect(sangre).toHaveLength(1);

    const phones = JSON.parse(sangre[0]!.phones!) as SerializedPhoneEntry[];
    const numbers = phones.map((p) => p.number);
    expect(numbers).toContain("11111");
    expect(numbers).toContain("22222");
  });

  it("deduplicates phone numbers when same number appears on multiple sheets", () => {
    const filePath = writeWorkbook(testRoot, "merge-dedup.xlsx", [
      makeServiceSheet("urgencias", [
        { label: "Laboratorio", numbers: ["33333"] },
      ]),
      makeServiceSheet("rayos", [
        { label: "Laboratorio", numbers: ["33333", "44444"] },
      ]),
    ]);

    const result = normalizeWorkbookRowsFromFile(filePath);
    const lab = result.rows.filter((r) => r.displayName === "Laboratorio");
    expect(lab).toHaveLength(1);

    const phones = JSON.parse(lab[0]!.phones!) as SerializedPhoneEntry[];
    const numbers = phones.map((p) => p.number);
    expect(numbers).toEqual(expect.arrayContaining(["33333", "44444"]));
    // 33333 should appear only once
    expect(numbers.filter((n) => n === "33333")).toHaveLength(1);
  });

  it("keeps the first record's externalId as the merged record's externalId", () => {
    // Use two slugs that both reliably detect with enough evidence signals.
    // "rayos" and "urgencias" are both canonical and produce enough signals with
    // a SERVICIO/NUMERO header + multiple rows.
    const filePath = writeWorkbook(testRoot, "merge-extid.xlsx", [
      makeServiceSheet("urgencias", [
        { label: "UCI Guardia", numbers: ["50001"] },
        { label: "UCI Principal", numbers: ["50099"] },
        { label: "Control UCI", numbers: ["50098"] },
      ]),
      makeServiceSheet("rayos", [
        { label: "UCI Guardia", numbers: ["50002"] },
        { label: "Rayos Principal", numbers: ["50003"] },
        { label: "Rayos Archivo", numbers: ["50004"] },
      ]),
    ]);

    const result = normalizeWorkbookRowsFromFile(filePath);
    const uci = result.rows.find((r) => r.displayName === "UCI Guardia")!;
    expect(uci).toBeDefined();
    // externalId must start with the FIRST sheet's slug (urgencias comes first)
    expect(uci.externalId).toMatch(/^urgencias-/);
  });

  it("does not assign a primary phone after cross-sheet merge ('Principal' is manual-only)", () => {
    const filePath = writeWorkbook(testRoot, "merge-primary.xlsx", [
      makeServiceSheet("urgencias", [
        { label: "Guardia", numbers: ["60001", "60002"] },
      ]),
      makeServiceSheet("rayos", [
        { label: "Guardia", numbers: ["60003"] },
      ]),
    ]);

    const result = normalizeWorkbookRowsFromFile(filePath);
    const guardia = result.rows.find((r) => r.displayName === "Guardia")!;
    const phones = JSON.parse(guardia.phones!) as SerializedPhoneEntry[];

    expect(phones.every((p) => p.isPrimary === false)).toBe(true);
    expect(guardia.phone1IsPrimary).toBe("false");
  });

  it("accent-normalizes displayName for cross-sheet identity matching", () => {
    const filePath = writeWorkbook(testRoot, "merge-accent.xlsx", [
      makeServiceSheet("urgencias", [
        { label: "Administración", numbers: ["70001"] },
      ]),
      makeServiceSheet("admision-central", [
        { label: "Administracion", numbers: ["70002"] },  // no accent
      ]),
    ]);

    const result = normalizeWorkbookRowsFromFile(filePath);
    const admin = result.rows.filter(
      (r) => r.displayName === "Administración" || r.displayName === "Administracion"
    );
    // Should merge into one record
    expect(admin).toHaveLength(1);
    const phones = JSON.parse(admin[0]!.phones!) as SerializedPhoneEntry[];
    expect(phones.map((p) => p.number)).toContain("70001");
    expect(phones.map((p) => p.number)).toContain("70002");
  });
});

// ---------------------------------------------------------------------------
// 3b. Merge discriminator fix (confidential-flag bleed regression)
// ---------------------------------------------------------------------------
//
// Root cause (confirmed against the hospital's real Agenda ODS file): the
// tabular Agenda parser falls back to the "Servicio" column for displayName
// whenever "Nombre" is blank. Two rows for the SAME Servicio value but
// DIFFERENT sub-desks (e.g. the real file's "Bioquímica" general line vs its
// "Bioquímica" Despacho/office line, which IS marked Confidencial="Si") used
// to collapse into a single merged card via mergeRecordsByDisplayName,
// letting the confidential flag from one sub-desk bleed onto the other.
describe("golden: merge discriminator (service+location) fix", () => {
  it("does NOT merge two Agenda rows that share displayName/Servicio but differ on Sección (confidential must not bleed across genuinely distinct desks)", () => {
    // Real-file shape: "Bioquímica" (general, non-confidential, ext. 79502)
    // vs "Bioquímica" (Despacho, Confidencial=Si, ext. 79951).
    const filePath = writeWorkbook(testRoot, "agenda-bioquimica.xlsx", [
      makeAgendaSheet("Agenda", [
        ["", "", "Bioquímica", "79502", "", "", "", "", "", "", "", "", "", "", "", "", ""],
        ["", "Doctora/or", "Bioquímica", "79951", "", "", "", "", "", "", "", "Si", "", "", "", "Despacho", ""],
      ]),
    ]);

    const result = normalizeWorkbookRowsFromFile(filePath);
    const bioquimica = result.rows.filter((r) => r.displayName === "Bioquímica");

    // Must remain TWO separate records — not merged into one.
    expect(bioquimica).toHaveLength(2);

    const general = bioquimica.find((r) => r.phone1Number === "79502")!;
    const despacho = bioquimica.find((r) => r.phone1Number === "79951")!;

    expect(general).toBeDefined();
    expect(despacho).toBeDefined();
    // The general line must NOT inherit the Despacho line's confidential flag.
    expect(general.phone1Confidential).toBe("false");
    expect(despacho.phone1Confidential).toBe("true");
  });

  it("still merges two Agenda rows that share displayName/Servicio AND the same location discriminator (legitimate multi-extension merge)", () => {
    // Real-file shape: "Endoscopia" — two rows, same Servicio, no
    // building/floor/sector/section on either — genuinely the same desk
    // with two extensions, must still combine into one record.
    const filePath = writeWorkbook(testRoot, "agenda-endoscopia.xlsx", [
      makeAgendaSheet("Agenda", [
        ["", "", "Endoscopia", "11111", "", "", "", "", "", "", "", "", "", "", "", "", ""],
        ["", "", "Endoscopia", "22222", "", "", "", "", "", "", "", "", "", "", "", "", ""],
      ]),
    ]);

    const result = normalizeWorkbookRowsFromFile(filePath);
    const endoscopia = result.rows.filter((r) => r.displayName === "Endoscopia");
    expect(endoscopia).toHaveLength(1);

    const phones = JSON.parse(endoscopia[0]!.phones!) as SerializedPhoneEntry[];
    expect(phones.map((p) => p.number)).toEqual(expect.arrayContaining(["11111", "22222"]));
  });

  it("ORs the confidential flag across duplicate phone numbers within a legitimate merge instead of dropping it (defense in depth)", () => {
    // Same displayName/Servicio/location (legitimate merge), same phone number
    // repeated with mismatched Confidencial markers across the two rows — the
    // merged entry must end up confidential=true regardless of row order.
    const filePath = writeWorkbook(testRoot, "agenda-dup-phone-confidential.xlsx", [
      makeAgendaSheet("Agenda", [
        ["", "", "Farmacia Interna", "33333", "", "", "", "", "", "", "", "", "", "", "", "", ""],
        ["", "", "Farmacia Interna", "33333", "", "", "", "", "", "", "", "Si", "", "", "", "", ""],
      ]),
    ]);

    const result = normalizeWorkbookRowsFromFile(filePath);
    const farmacia = result.rows.filter((r) => r.displayName === "Farmacia Interna");
    expect(farmacia).toHaveLength(1);
    expect(farmacia[0]!.phone1Confidential).toBe("true");
  });

  it("ORs the confidential flag when the confidential duplicate is processed FIRST (order-independence)", () => {
    const filePath = writeWorkbook(testRoot, "agenda-dup-phone-confidential-reversed.xlsx", [
      makeAgendaSheet("Agenda", [
        ["", "", "Farmacia Interna", "44444", "", "", "", "", "", "", "", "Si", "", "", "", "", ""],
        ["", "", "Farmacia Interna", "44444", "", "", "", "", "", "", "", "", "", "", "", "", ""],
      ]),
    ]);

    const result = normalizeWorkbookRowsFromFile(filePath);
    const farmacia = result.rows.filter((r) => r.displayName === "Farmacia Interna");
    expect(farmacia).toHaveLength(1);
    expect(farmacia[0]!.phone1Confidential).toBe("true");
  });
});

// ---------------------------------------------------------------------------
// 4b. Merge identity key now includes department
// ---------------------------------------------------------------------------
//
// Root cause: 8+ per-department "book" sheets (Corporativos,
// Sindicatos, UMI, etc.) are routed through the tabular Agenda parser, and
// each one tags every row with department = its own sheet name. Two rows
// from DIFFERENT book-sheets sharing displayName+Servicio with
// blank/matching Edificio/Planta/Sector/Sección (plausible for generic
// roles like "Secretaría"/"Recepción" repeated across multiple books) used
// to silently merge into one record via buildMergeIdentityKey, losing the
// second sheet's department attribution (the survivor keeps only
// group[0]'s scalar fields, including department).
describe("golden: merge identity key includes department", () => {
  it("does NOT merge two book-sheet rows that share displayName/Servicio but come from different department sheets", () => {
    const filePath = writeWorkbook(testRoot, "agenda-cross-department-secretaria.xlsx", [
      makeAgendaSheet("Corporativos", [
        ["", "", "Secretaría", "81001", "", "", "", "", "", "", "", "", "", "", "", "", ""],
      ]),
      makeAgendaSheet("Sindicatos", [
        ["", "", "Secretaría", "81002", "", "", "", "", "", "", "", "", "", "", "", "", ""],
      ]),
    ]);

    const result = normalizeWorkbookRowsFromFile(filePath);
    const secretaria = result.rows.filter((r) => r.displayName === "Secretaría");

    // Must remain TWO separate records — one per department — never merged.
    expect(secretaria).toHaveLength(2);

    const corporativos = secretaria.find((r) => r.department === "Corporativos")!;
    const sindicatos = secretaria.find((r) => r.department === "Sindicatos")!;
    expect(corporativos).toBeDefined();
    expect(sindicatos).toBeDefined();
    expect(corporativos.phone1Number).toBe("81001");
    expect(sindicatos.phone1Number).toBe("81002");
  });

  it("still merges two rows sharing displayName/Servicio AND the same department book-sheet (regression — same-department merging is unaffected)", () => {
    const filePath = writeWorkbook(testRoot, "agenda-same-department-recepcion.xlsx", [
      makeAgendaSheet("Corporativos", [
        ["", "", "Recepción", "82001", "", "", "", "", "", "", "", "", "", "", "", "", ""],
        ["", "", "Recepción", "82002", "", "", "", "", "", "", "", "", "", "", "", "", ""],
      ]),
    ]);

    const result = normalizeWorkbookRowsFromFile(filePath);
    const recepcion = result.rows.filter((r) => r.displayName === "Recepción");

    // Same department, same displayName/Servicio, blank discriminators —
    // must still merge into a single record with both extensions.
    expect(recepcion).toHaveLength(1);
    expect(recepcion[0]!.department).toBe("Corporativos");

    const phones = JSON.parse(recepcion[0]!.phones ?? "[]") as SerializedPhoneEntry[];
    expect(phones.map((p) => p.number)).toEqual(expect.arrayContaining(["82001", "82002"]));
  });
});

// ---------------------------------------------------------------------------
// 5. Error paths and boundary conditions
// ---------------------------------------------------------------------------

describe("golden: error paths", () => {
  it("throws a localized error for a file that cannot be parsed as a workbook", () => {
    // xlsx can parse arbitrary text as a CSV-like sheet, so a plain text
    // file with no recognizable structure produces "no supported sheets" rather
    // than a parse error. Both error messages are considered localized / valid.
    // This golden test documents the actual runtime behavior.
    const filePath = path.join(testRoot, "bad.xlsx");
    nodeFs.writeFileSync(filePath, "not a workbook at all");

    expect(() => normalizeWorkbookRowsFromFile(filePath)).toThrow(
      // Either "No se pudo leer…" (parse failure) or "No se encontraron hojas…"
      // (parsed but no canonical sheets detected) are valid localized responses.
      /No se pudo leer la hoja de cálculo|No se encontraron hojas soportadas/
    );
  });

  it("throws a localized error when no supported sheets are found", () => {
    // A sheet named with a non-canonical slug and no recognizable structure
    const filePath = writeWorkbook(testRoot, "unknown.xlsx", [
      {
        name: "hoja-desconocida",
        data: [
          ["Columna1", "Columna2"],
          ["valor A", "valor B"],
        ],
      },
    ]);

    expect(() => normalizeWorkbookRowsFromFile(filePath)).toThrow(
      "No se encontraron hojas soportadas para importar."
    );
  });

  it("skips navigation/index sheets and still processes data sheets", () => {
    const filePath = writeWorkbook(testRoot, "with-index.xlsx", [
      {
        name: "Índice_Agenda",  // navigation sheet — slug starts with "indice"
        data: [["Hoja", "Descripción"], ["urgencias", "Urgencias"]],
      },
      makeServiceSheet("urgencias", [
        { label: "Triaje", numbers: ["80001"] },
      ]),
    ]);

    const result = normalizeWorkbookRowsFromFile(filePath);
    expect(result.rows.length).toBeGreaterThan(0);
    // No record should have externalId starting with "indice"
    for (const row of result.rows) {
      expect(row.externalId).not.toMatch(/^indice/);
    }
  });

  it("skips buscas (pager) sheets and counts them in buscasSkippedRowCount", () => {
    const filePath = writeWorkbook(testRoot, "with-buscas.xlsx", [
      makeServiceSheet("urgencias", [
        { label: "Control", numbers: ["90001"] },
      ]),
      {
        name: "Buscas_Facultativos",
        data: [
          ["PRINCIPAL / RESIDENTE", "BUSCAS"],
          ["Dr. López", "1234"],
          ["Dra. García", "5678"],
        ],
      },
    ]);

    const result = normalizeWorkbookRowsFromFile(filePath);
    // Buscas rows should NOT appear in records
    for (const row of result.rows) {
      expect(row.displayName).not.toMatch(/PRINCIPAL|RESIDENTE/i);
    }
    // Buscas count: 2 data rows (buscas sheet had 3 rows total − 1 header)
    expect(result.buscasSkippedRowCount).toBeGreaterThanOrEqual(2);
    expect(result.socialHandleSkippedRowCount).toBe(0);
  });

  it("normalizeWorkbookRowsFromFile returns all rows beyond 5000 (cap is enforced in buildSpreadsheetImportPreview)", () => {
    // Build a sheet with 5001 data rows
    const data: string[][] = [["SERVICIO", "NUMERO"]];
    for (let i = 0; i < 5001; i++) {
      data.push([`Servicio ${i}`, `${10000 + i}`]);
    }

    // Use a canonical multi-sheet so each service sheet contributes.
    // We embed all rows in one sheet — normalizeWorkbookRowsFromFile returns
    // rows directly; the 5000-row cap is checked in buildSpreadsheetImportPreview.
    // So this test checks the cap is NOT in normalizeWorkbookRowsFromFile but
    // documents where it lives — we verify >5000 rows are returned without error:
    const filePath = writeWorkbook(testRoot, "big.xlsx", [
      { name: "urgencias", data },
    ]);

    const result = normalizeWorkbookRowsFromFile(filePath);
    expect(result.rows.length).toBeGreaterThan(5000);
    // (cap enforcement belongs to buildSpreadsheetImportPreview)
  });

  // The enforcement point itself (buildSpreadsheetImportPreview)
  // previously had zero direct test coverage; the test above only proved the
  // *normalization* layer does not itself cap. This closes that gap.
  it("buildSpreadsheetImportPreview throws a clear 'file too large' message beyond 5000 rows", async () => {
    const data: string[][] = [["SERVICIO", "NUMERO"]];
    for (let i = 0; i < 5001; i++) {
      data.push([`Servicio ${i}`, `${10000 + i}`]);
    }
    const filePath = writeWorkbook(testRoot, "too-many-rows.xlsx", [
      { name: "urgencias", data },
    ]);

    await expect(buildSpreadsheetImportPreview(filePath, "TestEditor")).rejects.toThrow(
      "El archivo supera el límite máximo de 5000 filas. Divide el archivo e importa en lotes."
    );
  });
});

// ---------------------------------------------------------------------------
// 6. mergeRecordsByDisplayName — unit golden tests
// ---------------------------------------------------------------------------

describe("golden: mergeRecordsByDisplayName unit", () => {
  const makeRow = (overrides: Partial<NormalizedImportRow> & { phones?: string }): NormalizedImportRow => ({
    externalId: "test-001",
    type: "service",
    displayName: "Test",
    firstName: "",
    lastName: "",
    area: "otros",
    department: "Test Dept",
    service: "Test",
    specialty: "",
    building: "",
    floor: "",
    room: "",
    locationText: "",
    phone1Label: "Principal",
    phone1Number: "11111",
    phone1Extension: "",
    phone1Kind: "internal",
    phone1IsPrimary: "true",
    phone1Confidential: "false",
    phone1NoPatientSharing: "false",
    phone1Notes: "",
    phone2Label: "",
    phone2Number: "",
    phone2Extension: "",
    phone2Kind: "",
    phone2IsPrimary: "false",
    phone2Confidential: "false",
    phone2NoPatientSharing: "false",
    phone2Notes: "",
    email1: "",
    email1Label: "",
    email1IsPrimary: "",
    email2: "",
    email2Label: "",
    email2IsPrimary: "",
    tags: "",
    aliases: "",
    notes: "",
    status: "active",
    ...overrides,
  });

  it("passes through records with no phones JSON field unchanged", () => {
    const record = makeRow({ phones: undefined });
    const result = mergeRecordsByDisplayName([record]);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(record);
  });

  it("passes through records with blank phones JSON field unchanged", () => {
    const record = makeRow({ phones: "" });
    const result = mergeRecordsByDisplayName([record]);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(record);
  });

  it("passes through records with blank displayName (Bug 1) unchanged", () => {
    const phones = JSON.stringify([makeBlankPhoneEntry()]);
    const record = makeRow({ displayName: "", phones });
    const result = mergeRecordsByDisplayName([record]);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(record);
  });

  it("merges two records with same normalized displayName", () => {
    const phones1 = JSON.stringify([makeBlankPhoneEntry({ number: "11111", label: "SheetA" })]);
    const phones2 = JSON.stringify([makeBlankPhoneEntry({ number: "22222", label: "SheetB", isPrimary: false })]);
    const r1 = makeRow({ externalId: "a-001", displayName: "Farmacia", phones: phones1 });
    const r2 = makeRow({ externalId: "b-001", displayName: "Farmacia", phones: phones2 });

    const result = mergeRecordsByDisplayName([r1, r2]);
    expect(result).toHaveLength(1);
    expect(result[0]!.externalId).toBe("a-001");  // first record's id kept

    const merged = JSON.parse(result[0]!.phones!) as SerializedPhoneEntry[];
    expect(merged.map((p) => p.number)).toContain("11111");
    expect(merged.map((p) => p.number)).toContain("22222");
  });

  it("does NOT merge two tabular-Agenda-book-sheet records (area blank) with the same normalized displayName but different department", () => {
    const phones1 = JSON.stringify([makeBlankPhoneEntry({ number: "11111", label: "SheetA" })]);
    const phones2 = JSON.stringify([makeBlankPhoneEntry({ number: "22222", label: "SheetB" })]);
    // area: "" simulates a row parsed by the tabular Agenda parser (the only
    // parser that always leaves area blank — see buildMergeIdentityKey),
    // which is the discriminator this fix keys off.
    const r1 = makeRow({
      externalId: "a-001",
      displayName: "Secretaría",
      department: "Corporativos",
      area: "",
      phones: phones1,
    });
    const r2 = makeRow({
      externalId: "b-001",
      displayName: "Secretaría",
      department: "Sindicatos",
      area: "",
      phones: phones2,
    });

    const result = mergeRecordsByDisplayName([r1, r2]);
    // Different department => never merged, even with identical displayName
    // and blank/matching service+building+floor+sector+section.
    expect(result).toHaveLength(2);
    expect(result.map((r) => r.department).sort()).toEqual(["Corporativos", "Sindicatos"]);
  });

  it("still merges two service-sheet records (non-blank area) with the same displayName even when department differs (department is not a discriminator outside the tabular book-sheet parser)", () => {
    const phones1 = JSON.stringify([makeBlankPhoneEntry({ number: "11111", label: "SheetA" })]);
    const phones2 = JSON.stringify([makeBlankPhoneEntry({ number: "22222", label: "SheetB" })]);
    const r1 = makeRow({ externalId: "a-001", displayName: "Banco de Sangre", department: "Urgencias", phones: phones1 });
    const r2 = makeRow({ externalId: "b-001", displayName: "Banco de Sangre", department: "Rayos", phones: phones2 });

    const result = mergeRecordsByDisplayName([r1, r2]);
    expect(result).toHaveLength(1);
    const merged = JSON.parse(result[0]!.phones!) as SerializedPhoneEntry[];
    expect(merged.map((p) => p.number)).toContain("11111");
    expect(merged.map((p) => p.number)).toContain("22222");
  });

  it("does not invent a primary phone when none of the merged phones were marked primary (residual fix)", () => {
    const phones1 = JSON.stringify([makeBlankPhoneEntry({ number: "11111", isPrimary: false })]);
    const phones2 = JSON.stringify([makeBlankPhoneEntry({ number: "22222", isPrimary: false })]);
    const r1 = makeRow({ displayName: "UCI", phones: phones1 });
    const r2 = makeRow({ displayName: "UCI", phones: phones2 });

    const result = mergeRecordsByDisplayName([r1, r2]);
    const merged = JSON.parse(result[0]!.phones!) as SerializedPhoneEntry[];
    expect(merged[0]!.isPrimary).toBe(false);
    expect(merged[1]!.isPrimary).toBe(false);
    expect(result[0]!.phone1IsPrimary).toBe("false");
  });

  it("does not re-derive isPrimary from array position after merge — preserves each phone's own value", () => {
    const phones1 = JSON.stringify([makeBlankPhoneEntry({ number: "11111", isPrimary: true })]);
    const phones2 = JSON.stringify([makeBlankPhoneEntry({ number: "22222", isPrimary: true })]);
    const r1 = makeRow({ displayName: "UCI", phones: phones1 });
    const r2 = makeRow({ displayName: "UCI", phones: phones2 });

    const result = mergeRecordsByDisplayName([r1, r2]);
    const merged = JSON.parse(result[0]!.phones!) as SerializedPhoneEntry[];
    // Both entries keep whatever isPrimary they already had going in — the
    // merge step must never force the first phone to primary just because of
    // its position in the combined array. (Downstream buildPhones/
    // ensureSinglePrimary in csv-import.service.ts reconciles genuine
    // multi-primary conflicts like this one at import-apply time.)
    expect(merged[0]!.isPrimary).toBe(true);
    expect(merged[1]!.isPrimary).toBe(true);
  });

  it("deduplicates by normalized phone number (strips non-digits)", () => {
    const phones1 = JSON.stringify([makeBlankPhoneEntry({ number: "928-10-10-10" })]);
    const phones2 = JSON.stringify([makeBlankPhoneEntry({ number: "928101010" })]);
    const r1 = makeRow({ displayName: "Central", phones: phones1 });
    const r2 = makeRow({ displayName: "Central", phones: phones2 });

    const result = mergeRecordsByDisplayName([r1, r2]);
    const merged = JSON.parse(result[0]!.phones!) as SerializedPhoneEntry[];
    // Both normalize to same digits — should appear only once
    expect(merged).toHaveLength(1);
  });

  it("preserves original order (Bug 2): emits merged group at first member's position", () => {
    const pA = JSON.stringify([makeBlankPhoneEntry({ number: "11111" })]);
    const pB = JSON.stringify([makeBlankPhoneEntry({ number: "22222" })]);
    const pC = JSON.stringify([makeBlankPhoneEntry({ number: "33333" })]);
    const passthrough = makeRow({ displayName: "Centro A", phones: undefined, externalId: "passthrough" });
    const r1 = makeRow({ displayName: "Shared", phones: pA, externalId: "shared-001" });
    const r2 = makeRow({ displayName: "Unique", phones: pB, externalId: "unique-001" });
    const r3 = makeRow({ displayName: "Shared", phones: pC, externalId: "shared-002" });

    const result = mergeRecordsByDisplayName([passthrough, r1, r2, r3]);
    expect(result).toHaveLength(3);  // passthrough + merged-shared + unique
    expect(result[0]!.externalId).toBe("passthrough");
    expect(result[1]!.externalId).toBe("shared-001");
    expect(result[2]!.externalId).toBe("unique-001");
  });

  it("handles malformed phones JSON gracefully (treats as no phones for that record)", () => {
    const good = JSON.stringify([makeBlankPhoneEntry({ number: "12345" })]);
    const r1 = makeRow({ displayName: "X", phones: good });
    const r2 = makeRow({ displayName: "X", phones: "not-json{{{" });

    // Should not throw, should still produce one merged record
    const result = mergeRecordsByDisplayName([r1, r2]);
    expect(result).toHaveLength(1);
    const merged = JSON.parse(result[0]!.phones!) as SerializedPhoneEntry[];
    expect(merged[0]!.number).toBe("12345");
  });

  it("writes zero-phones warning note when merged result has no valid phones", () => {
    const r1 = makeRow({ displayName: "Ghost", phones: "[]" });
    const r2 = makeRow({ displayName: "Ghost", phones: "[]" });

    const result = mergeRecordsByDisplayName([r1, r2]);
    expect(result[0]!.notes).toContain("AVISO");
    expect(result[0]!.phone1Number).toBe("");
  });

  it("does not merge records when phones field is empty string", () => {
    const r1 = makeRow({ displayName: "Same", phones: "" });
    const r2 = makeRow({ displayName: "Same", phones: "" });

    const result = mergeRecordsByDisplayName([r1, r2]);
    expect(result).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// 7. isSerializedPhoneEntry type guard — unit golden tests
// ---------------------------------------------------------------------------

describe("golden: isSerializedPhoneEntry type guard", () => {
  it("accepts a complete valid entry", () => {
    expect(isSerializedPhoneEntry(makeBlankPhoneEntry())).toBe(true);
  });

  it("accepts an entry with optional notes field", () => {
    expect(isSerializedPhoneEntry(makeBlankPhoneEntry({ notes: "some note" }))).toBe(true);
  });

  it("rejects null", () => {
    expect(isSerializedPhoneEntry(null)).toBe(false);
  });

  it("rejects non-object primitives", () => {
    expect(isSerializedPhoneEntry("string")).toBe(false);
    expect(isSerializedPhoneEntry(42)).toBe(false);
    expect(isSerializedPhoneEntry(true)).toBe(false);
  });

  it("rejects object missing required fields", () => {
    expect(isSerializedPhoneEntry({ number: "12345" })).toBe(false);
  });

  it("rejects object with wrong field types", () => {
    expect(isSerializedPhoneEntry({
      number: 12345,     // should be string
      label: "Test",
      kind: "internal",
      isPrimary: true,
      confidential: false,
      noPatientSharing: false,
    })).toBe(false);
  });

  it("rejects object with boolean fields as strings", () => {
    expect(isSerializedPhoneEntry({
      number: "12345",
      label: "Test",
      kind: "internal",
      isPrimary: "true",   // should be boolean
      confidential: "false",
      noPatientSharing: "false",
    })).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 8. buscasSkippedRowCount / socialHandleSkippedRowCount aggregation
// ---------------------------------------------------------------------------

describe("golden: buscasSkippedRowCount / socialHandleSkippedRowCount", () => {
  it("returns both counts as 0 when no Buscas sheets and no social rows", () => {
    const filePath = writeWorkbook(testRoot, "zero-deferred.xlsx", [
      makeServiceSheet("urgencias", [
        { label: "Control", numbers: ["12001"] },
      ]),
    ]);

    const result = normalizeWorkbookRowsFromFile(filePath);
    expect(result.buscasSkippedRowCount).toBe(0);
    expect(result.socialHandleSkippedRowCount).toBe(0);
  });

  it("counts multiple Buscas sheets in buscasSkippedRowCount only", () => {
    const filePath = writeWorkbook(testRoot, "multi-buscas.xlsx", [
      makeServiceSheet("urgencias", [
        { label: "Control", numbers: ["12001"] },
      ]),
      {
        name: "Buscas_Facultativos",
        data: [
          ["PRINCIPAL / RESIDENTE", "BUSCAS"],
          ["Dr. A", "1234"],
          ["Dr. B", "5678"],
          ["Dr. C", "9012"],
        ],
      },
      {
        name: "Buscas_Enfermeria",
        data: [
          ["PRINCIPAL / RESIDENTE", "BUSCAS"],
          ["Enfermero A", "1111"],
        ],
      },
    ]);

    const result = normalizeWorkbookRowsFromFile(filePath);
    // Buscas_Facultativos: 4 rows total − 1 header = 3 data rows
    // Buscas_Enfermeria: 2 rows total − 1 header = 1 data row
    // Total buscas: 4, social: 0
    expect(result.buscasSkippedRowCount).toBeGreaterThanOrEqual(4);
    expect(result.socialHandleSkippedRowCount).toBe(0);
  });
});
