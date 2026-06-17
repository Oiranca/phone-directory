/**
 * OIR-102 — ODS multi-sheet phone-number data-loss regression tests.
 *
 * Two root causes fixed:
 *   1. 2-phone cap: normalizeServiceSheet only emitted phone1/phone2; 3rd+
 *      numbers were silently dropped.
 *   2. No cross-sheet merge: the same contact name across multiple sheets
 *      produced separate records, each holding only a slice of the numbers.
 *
 * These tests call normalizeWorkbookRowsFromFile (the sync normalizer used
 * when IS_VITEST_RUNTIME is true) and buildImportPreviewFromRows to exercise
 * the full pipeline end-to-end.
 *
 * Fixtures are built programmatically with xlsx-republish and written to a
 * temporary directory so no binary fixture files need to be committed.
 */
import nodeFs from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import XLSX from "xlsx-republish";
import { normalizeWorkbookRowsFromFile } from "./spreadsheet-import.service.js";
import { buildImportPreviewFromRows } from "./csv-import.service.js";

XLSX.set_fs(nodeFs);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Write a multi-sheet workbook to disk as .xlsx and return the file path. */
const writeWorkbook = (
  dir: string,
  fileName: string,
  sheets: Array<{ name: string; data: string[][] }>
): string => {
  const wb = XLSX.utils.book_new();

  for (const { name, data } of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(data);
    XLSX.utils.book_append_sheet(wb, ws, name);
  }

  const filePath = path.join(dir, fileName);
  XLSX.writeFile(wb, filePath);
  return filePath;
};

/**
 * Minimal service-sheet layout understood by the parser:
 *   Row 0: header  ["SERVICIO", "NUMERO"]
 *   Row N: data    [label, number1, number2?, ...]
 *
 * The sheet name must match a known canonical slug (e.g. "urgencias") so
 * detectSheetProfile returns a "service" profile.
 */
const makeServiceSheet = (
  name: string,
  rows: Array<{ label: string; numbers: string[] }>
): { name: string; data: string[][] } => ({
  name,
  data: [
    ["SERVICIO", "NUMERO"],
    ...rows.map(({ label, numbers }) => [label, ...numbers])
  ]
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

let testRoot: string;

beforeEach(async () => {
  testRoot = await fs.mkdtemp(path.join(os.tmpdir(), "oir102-test-"));
});

afterEach(async () => {
  await fs.rm(testRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Root cause 1 — single row with more than 2 phone numbers
// ---------------------------------------------------------------------------

describe("single-row multi-phone (root cause 1)", () => {
  it("retains all numbers when a single row has >2 phones", () => {
    const filePath = writeWorkbook(testRoot, "multi-phone.xlsx", [
      makeServiceSheet("urgencias", [
        { label: "Banco de Sangre", numbers: ["11111", "22222", "33333", "44444"] }
      ])
    ]);

    const result = normalizeWorkbookRowsFromFile(filePath);

    expect(result.rows).toHaveLength(1);
    const row = result.rows[0]!;

    // The phones JSON field must contain all 4 numbers.
    const phones = JSON.parse(row.phones!) as Array<{ number: string }>;
    expect(phones.map((p) => p.number)).toEqual(["11111", "22222", "33333", "44444"]);
  });

  it("retains exactly 3 numbers when a row has 3 phones", () => {
    const filePath = writeWorkbook(testRoot, "three-phones.xlsx", [
      makeServiceSheet("urgencias", [
        { label: "Laboratorio", numbers: ["10001", "10002", "10003"] }
      ])
    ]);

    const result = normalizeWorkbookRowsFromFile(filePath);
    expect(result.rows).toHaveLength(1);

    const phones = JSON.parse(result.rows[0]!.phones!) as Array<{ number: string }>;
    expect(phones).toHaveLength(3);
    expect(phones.map((p) => p.number)).toEqual(["10001", "10002", "10003"]);
  });

  it("marks only the first phone as primary", () => {
    const filePath = writeWorkbook(testRoot, "primary.xlsx", [
      makeServiceSheet("urgencias", [
        { label: "Mostrador", numbers: ["55555", "66666", "77777"] }
      ])
    ]);

    const result = normalizeWorkbookRowsFromFile(filePath);
    const phones = JSON.parse(result.rows[0]!.phones!) as Array<{ number: string; isPrimary: boolean }>;

    expect(phones[0]!.isPrimary).toBe(true);
    expect(phones[1]!.isPrimary).toBe(false);
    expect(phones[2]!.isPrimary).toBe(false);
  });

  it("labels each phone with the source sheet name", () => {
    const filePath = writeWorkbook(testRoot, "labels.xlsx", [
      makeServiceSheet("urgencias", [
        { label: "Triaje", numbers: ["88888", "99999"] }
      ])
    ]);

    const result = normalizeWorkbookRowsFromFile(filePath);
    const phones = JSON.parse(result.rows[0]!.phones!) as Array<{ number: string; label: string }>;

    // Every phone must have a non-empty label (the sheet name).
    for (const phone of phones) {
      expect(phone.label).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// Root cause 2 — cross-sheet merge by normalized displayName
// ---------------------------------------------------------------------------

describe("cross-sheet merge by normalized displayName (root cause 2)", () => {
  it("merges same contact from ≥3 sheets into one record with all distinct numbers", () => {
    const filePath = writeWorkbook(testRoot, "banco-sangre.xlsx", [
      makeServiceSheet("urgencias", [
        { label: "Banco de Sangre", numbers: ["11111"] }
      ]),
      makeServiceSheet("umi", [
        { label: "Banco de Sangre", numbers: ["22222"] }
      ]),
      makeServiceSheet("rayos", [
        { label: "Banco de Sangre", numbers: ["33333"] }
      ])
    ]);

    const result = normalizeWorkbookRowsFromFile(filePath);

    // Three sheets → ONE merged contact.
    const bancoDeSangreRows = result.rows.filter((r) => r.displayName === "Banco de Sangre");
    expect(bancoDeSangreRows).toHaveLength(1);

    const phones = JSON.parse(bancoDeSangreRows[0]!.phones!) as Array<{ number: string }>;
    const numbers = phones.map((p) => p.number);
    expect(numbers).toContain("11111");
    expect(numbers).toContain("22222");
    expect(numbers).toContain("33333");
    expect(numbers).toHaveLength(3);
  });

  it("deduplicates numbers that appear on more than one sheet", () => {
    const filePath = writeWorkbook(testRoot, "dedup.xlsx", [
      makeServiceSheet("urgencias", [
        { label: "Banco de Sangre", numbers: ["11111", "22222"] }
      ]),
      makeServiceSheet("umi", [
        // 11111 is repeated — must appear only once in the merged result.
        { label: "Banco de Sangre", numbers: ["11111", "33333"] }
      ])
    ]);

    const result = normalizeWorkbookRowsFromFile(filePath);
    const rows = result.rows.filter((r) => r.displayName === "Banco de Sangre");
    expect(rows).toHaveLength(1);

    const phones = JSON.parse(rows[0]!.phones!) as Array<{ number: string }>;
    const numbers = phones.map((p) => p.number);

    // 11111 must appear exactly once.
    expect(numbers.filter((n) => n === "11111")).toHaveLength(1);
    expect(numbers).toContain("22222");
    expect(numbers).toContain("33333");
    expect(numbers).toHaveLength(3);
  });

  it("preserves a single primary phone on the merged contact", () => {
    const filePath = writeWorkbook(testRoot, "primary-merged.xlsx", [
      makeServiceSheet("urgencias", [
        { label: "Banco de Sangre", numbers: ["11111"] }
      ]),
      makeServiceSheet("umi", [
        { label: "Banco de Sangre", numbers: ["22222"] }
      ])
    ]);

    const result = normalizeWorkbookRowsFromFile(filePath);
    const row = result.rows.find((r) => r.displayName === "Banco de Sangre")!;
    const phones = JSON.parse(row.phones!) as Array<{ isPrimary: boolean }>;

    const primaryCount = phones.filter((p) => p.isPrimary).length;
    expect(primaryCount).toBe(1);
    expect(phones[0]!.isPrimary).toBe(true);
  });

  it("keeps the first record's externalId for the merged contact (stable re-import key)", () => {
    const filePath = writeWorkbook(testRoot, "extid.xlsx", [
      makeServiceSheet("urgencias", [
        { label: "Banco de Sangre", numbers: ["11111"] }
      ]),
      makeServiceSheet("umi", [
        { label: "Banco de Sangre", numbers: ["22222"] }
      ])
    ]);

    // Run twice — both runs must produce the same externalId.
    const run1 = normalizeWorkbookRowsFromFile(filePath);
    const run2 = normalizeWorkbookRowsFromFile(filePath);

    const id1 = run1.rows.find((r) => r.displayName === "Banco de Sangre")?.externalId;
    const id2 = run2.rows.find((r) => r.displayName === "Banco de Sangre")?.externalId;

    expect(id1).toBeTruthy();
    expect(id1).toBe(id2);
  });
});

// ---------------------------------------------------------------------------
// Variant names stay as separate contacts (no fuzzy matching)
// ---------------------------------------------------------------------------

describe("variant names stay as separate contacts", () => {
  it("treats distinct normalized names as different contacts", () => {
    const filePath = writeWorkbook(testRoot, "variants.xlsx", [
      makeServiceSheet("urgencias", [
        { label: "Banco de Sangre", numbers: ["11111"] },
        { label: "Banco de Sangre (Secretaria)", numbers: ["22222"] },
        { label: "Aféresis Banco de Sangre", numbers: ["33333"] }
      ])
    ]);

    const result = normalizeWorkbookRowsFromFile(filePath);

    const names = result.rows.map((r) => r.displayName);
    expect(names).toContain("Banco de Sangre");
    expect(names).toContain("Banco de Sangre (Secretaria)");
    expect(names).toContain("Aféresis Banco de Sangre");

    // Verify each is a separate record (total row count includes all three).
    const bancoRows = result.rows.filter((r) =>
      r.displayName.toLowerCase().includes("banco de sangre") ||
      r.displayName.toLowerCase().includes("aferesis")
    );
    expect(bancoRows).toHaveLength(3);
  });

  it("matches names that differ only in accents and extra spaces", () => {
    // "Laboratorio Análisis" and "Laboratorio Analisis" differ only by accent.
    // Both should normalize to the same key and be merged into one record.
    //
    // Note: all-uppercase labels like "BANCO DE SANGRE" are filtered by the
    // existing EXCLUDED_PATTERNS rule (section-header heuristic), so we use
    // a mixed-case label that survives that filter.
    const filePath = writeWorkbook(testRoot, "accents.xlsx", [
      makeServiceSheet("urgencias", [
        { label: "Laboratorio Análisis", numbers: ["11111"] }
      ]),
      makeServiceSheet("umi", [
        // Same name without the accent — normalizes to the same merge key.
        { label: "Laboratorio Analisis", numbers: ["22222"] }
      ])
    ]);

    const result = normalizeWorkbookRowsFromFile(filePath);

    // Both rows normalize to the same key → merged into ONE record.
    const labRows = result.rows.filter((r) =>
      r.displayName === "Laboratorio Análisis" ||
      r.displayName === "Laboratorio Analisis"
    );
    expect(labRows).toHaveLength(1);

    const phones = JSON.parse(labRows[0]!.phones!) as Array<{ number: string }>;
    expect(phones.map((p) => p.number)).toContain("11111");
    expect(phones.map((p) => p.number)).toContain("22222");
  });
});

// ---------------------------------------------------------------------------
// Full pipeline — normalizeWorkbookRowsFromFile → buildImportPreviewFromRows
// ---------------------------------------------------------------------------

describe("full pipeline: normalize → buildImportPreviewFromRows", () => {
  it("produces a ContactRecord with all phones for a merged multi-sheet contact", async () => {
    const filePath = writeWorkbook(testRoot, "pipeline.xlsx", [
      makeServiceSheet("urgencias", [
        { label: "Banco de Sangre", numbers: ["11111", "22222", "33333"] }
      ]),
      makeServiceSheet("umi", [
        // 22222 repeated — dedup should keep it once; 44444 is new.
        { label: "Banco de Sangre", numbers: ["22222", "44444"] }
      ])
    ]);

    const normalized = normalizeWorkbookRowsFromFile(filePath);
    const { dataset } = await buildImportPreviewFromRows(normalized.rows, {
      sourceFilePath: filePath,
      fileName: "pipeline.xlsx",
      editorName: "TestEditor"
    });

    const record = dataset.records.find((r) => r.displayName === "Banco de Sangre");
    expect(record).toBeDefined();

    const phoneNumbers = record!.contactMethods.phones.map((p) => p.number);
    // All 4 distinct numbers must be present.
    expect(phoneNumbers).toContain("11111");
    expect(phoneNumbers).toContain("22222");
    expect(phoneNumbers).toContain("33333");
    expect(phoneNumbers).toContain("44444");
    // 22222 must appear only once.
    expect(phoneNumbers.filter((n) => n === "22222")).toHaveLength(1);
    expect(phoneNumbers).toHaveLength(4);

    // Exactly one primary phone.
    const primaryCount = record!.contactMethods.phones.filter((p) => p.isPrimary).length;
    expect(primaryCount).toBe(1);
  });

  it("produces separate ContactRecords for variant names", async () => {
    const filePath = writeWorkbook(testRoot, "pipeline-variants.xlsx", [
      makeServiceSheet("urgencias", [
        { label: "Banco de Sangre", numbers: ["11111"] },
        { label: "Banco de Sangre (Secretaria)", numbers: ["22222"] }
      ])
    ]);

    const normalized = normalizeWorkbookRowsFromFile(filePath);
    const { dataset } = await buildImportPreviewFromRows(normalized.rows, {
      sourceFilePath: filePath,
      fileName: "pipeline-variants.xlsx",
      editorName: "TestEditor"
    });

    const names = dataset.records.map((r) => r.displayName);
    expect(names).toContain("Banco de Sangre");
    expect(names).toContain("Banco de Sangre (Secretaria)");
    expect(dataset.records).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Bug A + Bug B — flat label+phone sheets and ALL-CAPS label preservation
// ---------------------------------------------------------------------------

/**
 * A helper to create a flat sheet with NO header row and NO section rows —
 * just raw [label, phone] rows, as found in Banco de Sangre index sheets
 * (A, B, S, D), Telefonos_emergencias, Corporativos, etc.
 */
const makeFlatSheet = (
  name: string,
  rows: Array<{ label: string; numbers: string[] }>
): { name: string; data: string[][] } => ({
  name,
  data: rows.map(({ label, numbers }) => [label, ...numbers])
});

describe("Bug A — flat label+phone sheet acceptance (no section/continuation rows)", () => {
  it("accepts a flat sheet with ALL-CAPS labels and produces contacts (not dropped)", () => {
    // No header row, no section rows, no continuation rows — threshold is 3
    // phone-bearing rows so real ODS index sheets (A/B/S/D) are accepted while
    // 1- or 2-row scheduling tables are still rejected.
    const filePath = writeWorkbook(testRoot, "flat-allcaps.xlsx", [
      makeFlatSheet("Banco_Sangre_A", [
        { label: "BANCO DE SANGRE (ADMINISTRATIVO)", numbers: ["79457"] },
        { label: "AFERESIS BANCO DE SANGRE", numbers: ["79458"] },
        { label: "CELADOR BANCO DE SANGRE", numbers: ["79459"] }
      ])
    ]);

    const result = normalizeWorkbookRowsFromFile(filePath);

    // All three rows should survive.
    const names = result.rows.map((r) => r.displayName);
    expect(names).toContain("BANCO DE SANGRE (ADMINISTRATIVO)");
    expect(names).toContain("AFERESIS BANCO DE SANGRE");
    expect(names).toContain("CELADOR BANCO DE SANGRE");
  });

  it("flat ALL-CAPS contacts from ≥3 sheets merge into ONE record with all distinct numbers", () => {
    // Simulates the real-world scenario: BANCO DE SANGRE rows scattered across
    // alphabetic index sheets A, B, S.  Each sheet must have ≥3 phone-bearing
    // rows to cross the generic flat-sheet acceptance threshold.
    const filePath = writeWorkbook(testRoot, "flat-merge.xlsx", [
      makeFlatSheet("Hoja_A", [
        { label: "BANCO DE SANGRE (ADMINISTRATIVO)", numbers: ["11111"] },
        { label: "LABORATORIO HEMATOLOGIA", numbers: ["11112"] },
        { label: "BANCO DE SANGRE GUARDIA", numbers: ["11113"] }
      ]),
      makeFlatSheet("Hoja_B", [
        { label: "BANCO DE SANGRE (ADMINISTRATIVO)", numbers: ["22222"] },
        { label: "LABORATORIO BIOQUIMICA", numbers: ["22223"] },
        { label: "BANCO DE SANGRE GUARDIA", numbers: ["22224"] }
      ]),
      makeFlatSheet("Hoja_S", [
        { label: "BANCO DE SANGRE (ADMINISTRATIVO)", numbers: ["33333"] },
        { label: "SUPERVISORA PLANTA", numbers: ["33334"] },
        { label: "BANCO DE SANGRE GUARDIA", numbers: ["33335"] }
      ])
    ]);

    const result = normalizeWorkbookRowsFromFile(filePath);

    // Three sheets → ONE merged contact for BANCO DE SANGRE (ADMINISTRATIVO).
    const rows = result.rows.filter((r) =>
      r.displayName === "BANCO DE SANGRE (ADMINISTRATIVO)"
    );
    expect(rows).toHaveLength(1);

    const phones = JSON.parse(rows[0]!.phones!) as Array<{ number: string }>;
    const numbers = phones.map((p) => p.number);
    expect(numbers).toContain("11111");
    expect(numbers).toContain("22222");
    expect(numbers).toContain("33333");
    expect(numbers).toHaveLength(3);
  });
});

describe("Bug B — phone-bearing ALL-CAPS labels are contacts, not section headers", () => {
  it("keeps ALL-CAPS label as displayName when the row has a phone number", () => {
    // Uses a canonical sheet (urgencias) with a mixed-case row alongside the
    // ALL-CAPS row so the canonical acceptance path activates; the ALL-CAPS row
    // with phone tests Bug B specifically.
    const filePath = writeWorkbook(testRoot, "allcaps-contact.xlsx", [
      makeServiceSheet("urgencias", [
        { label: "BANCO DE SANGRE (ADMINISTRATIVO)", numbers: ["79457"] },
        { label: "Mostrador urgencias", numbers: ["79458"] }
      ])
    ]);

    const result = normalizeWorkbookRowsFromFile(filePath);
    const names = result.rows.map((r) => r.displayName);
    expect(names).toContain("BANCO DE SANGRE (ADMINISTRATIVO)");
    expect(names).toContain("Mostrador urgencias");
  });

  it("still treats a phone-less all-caps row as a section header (not a bogus contact)", () => {
    // A lone ALL-CAPS banner with no phone on the same row must NOT produce a
    // contact record — it is a section header.
    const filePath = writeWorkbook(testRoot, "allcaps-section.xlsx", [
      makeServiceSheet("urgencias", [
        // Section header (ALL-CAPS, no phone) followed by two real contacts.
        { label: "URGENCIAS", numbers: [] },
        { label: "Mostrador", numbers: ["12345"] },
        { label: "Control boxes", numbers: ["12346"] }
      ])
    ]);

    const result = normalizeWorkbookRowsFromFile(filePath);

    // Only real contacts should appear; "URGENCIAS" is a section.
    const names = result.rows.map((r) => r.displayName);
    expect(names).not.toContain("URGENCIAS");
    expect(names).toContain("Mostrador");
    expect(names).toContain("Control boxes");
  });

  it("three ALL-CAPS variant names from the same canonical sheet stay as separate contacts", () => {
    const filePath = writeWorkbook(testRoot, "allcaps-variants.xlsx", [
      makeServiceSheet("urgencias", [
        { label: "BANCO DE SANGRE (ADMINISTRATIVO)", numbers: ["11111"] },
        { label: "AFERESIS BANCO DE SANGRE", numbers: ["22222"] },
        { label: "CELADOR BANCO DE SANGRE", numbers: ["33333"] }
      ])
    ]);

    // The flat-sheet acceptance path kicks in here (3 flat phone-bearing rows).
    const result = normalizeWorkbookRowsFromFile(filePath);
    const names = result.rows.map((r) => r.displayName);
    expect(names).toContain("BANCO DE SANGRE (ADMINISTRATIVO)");
    expect(names).toContain("AFERESIS BANCO DE SANGRE");
    expect(names).toContain("CELADOR BANCO DE SANGRE");
    expect(result.rows).toHaveLength(3);
  });
});

describe("Navigation sheet skipping (isNavigationSheet)", () => {
  it("skips a sheet named like 'Índice_Agenda_Telefónica' and produces no contacts", () => {
    // slug = normalizeAscii("Índice_Agenda_Telefónica") = "indice-agenda-telefonica"
    // → starts with "indice" → navigation sheet → skipped
    const filePath = writeWorkbook(testRoot, "nav-indice.xlsx", [
      {
        name: "Índice_Agenda_Telefónica",
        data: [
          ["Hoja", "Descripción"],
          ["A", "Banco de Sangre"],
          ["B", "Banco de Sangre B"]
        ]
      },
      // Include a real data sheet so normalizeWorkbookRowsFromFile does not throw.
      makeServiceSheet("urgencias", [
        { label: "Triaje", numbers: ["12345"] }
      ])
    ]);

    const result = normalizeWorkbookRowsFromFile(filePath);
    // Navigation sheet rows must NOT appear.
    const names = result.rows.map((r) => r.displayName);
    expect(names).not.toContain("Hoja");
    expect(names).not.toContain("Descripción");
    expect(names).toContain("Triaje");
  });

  it("skips a sheet named 'ORIGINAL' (slug 'original') and produces no contacts", () => {
    const filePath = writeWorkbook(testRoot, "nav-original.xlsx", [
      {
        name: "ORIGINAL",
        data: [
          ["SERVICIO", "NUMERO"],
          ["Algún servicio", "99999"]
        ]
      },
      makeServiceSheet("urgencias", [
        { label: "Triaje", numbers: ["12345"] }
      ])
    ]);

    const result = normalizeWorkbookRowsFromFile(filePath);
    const names = result.rows.map((r) => r.displayName);
    expect(names).not.toContain("Algún servicio");
    expect(names).toContain("Triaje");
  });
});

// ---------------------------------------------------------------------------
// Regression guard — canonical sheets still parse unchanged after all fixes
// ---------------------------------------------------------------------------

describe("Regression: canonical sheets (urgencias / rayos) parse unchanged", () => {
  it("urgencias canonical sheet still produces contacts with phones (regression guard)", () => {
    const filePath = writeWorkbook(testRoot, "regression-urgencias.xlsx", [
      makeServiceSheet("urgencias", [
        { label: "Triaje", numbers: ["11111"] },
        { label: "Consulta 1", numbers: ["22222", "33333"] },
        { label: "Banco de Sangre", numbers: ["44444"] }
      ])
    ]);

    const result = normalizeWorkbookRowsFromFile(filePath);
    const names = result.rows.map((r) => r.displayName);
    expect(names).toContain("Triaje");
    expect(names).toContain("Consulta 1");
    expect(names).toContain("Banco de Sangre");

    const consulta = result.rows.find((r) => r.displayName === "Consulta 1")!;
    const phones = JSON.parse(consulta.phones!) as Array<{ number: string }>;
    expect(phones.map((p) => p.number)).toEqual(["22222", "33333"]);
  });

  it("rayos canonical sheet still produces contacts with phones (regression guard)", () => {
    const filePath = writeWorkbook(testRoot, "regression-rayos.xlsx", [
      makeServiceSheet("rayos", [
        { label: "Sala TAC", numbers: ["55555"] },
        { label: "Sala RX", numbers: ["66666"] }
      ])
    ]);

    const result = normalizeWorkbookRowsFromFile(filePath);
    const names = result.rows.map((r) => r.displayName);
    expect(names).toContain("Sala TAC");
    expect(names).toContain("Sala RX");
    expect(result.rows).toHaveLength(2);
  });
});
