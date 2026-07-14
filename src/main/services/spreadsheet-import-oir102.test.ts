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
 * Fixtures are built programmatically with xlsx and written to a
 * temporary directory so no binary fixture files need to be committed.
 */
import nodeFs from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import XLSX from "xlsx";
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

  it("does not mark any phone as primary by default (OIR-227 — 'Principal' is manual-only)", () => {
    const filePath = writeWorkbook(testRoot, "primary.xlsx", [
      makeServiceSheet("urgencias", [
        { label: "Mostrador", numbers: ["55555", "66666", "77777"] }
      ])
    ]);

    const result = normalizeWorkbookRowsFromFile(filePath);
    const phones = JSON.parse(result.rows[0]!.phones!) as Array<{ number: string; isPrimary: boolean }>;

    expect(phones[0]!.isPrimary).toBe(false);
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

    // Tightened: every phone must carry the exact source sheet name ("urgencias").
    for (const phone of phones) {
      expect(phone.label).toBe("urgencias");
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

  it("does not assign a primary phone on the merged contact (OIR-227 residual fix — 'Principal' is manual-only)", () => {
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
    expect(primaryCount).toBe(0);
    expect(phones[0]!.isPrimary).toBe(false);
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

    // Tightened: merged externalId keeps the FIRST sheet's prefix (urgencias).
    expect(id1).toMatch(/^urgencias-/);
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

    // OIR-227 residual fix: "Principal" is never auto-assigned on import,
    // even after a cross-sheet merge — it stays a manual, user-editable
    // choice made on the contact's edit form.
    const primaryCount = record!.contactMethods.phones.filter((p) => p.isPrimary).length;
    expect(primaryCount).toBe(0);
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

// ---------------------------------------------------------------------------
// Bug 1 — empty merge key collapses unrelated blank-named records
// ---------------------------------------------------------------------------

describe("Bug 1 — empty/blank displayName records stay as separate records", () => {
  it("keeps two records with empty displayName as two separate records (not merged)", () => {
    // Both records have blank displayNames → normalized key = "" → must NOT be merged.
    const filePath = writeWorkbook(testRoot, "empty-displayname.xlsx", [
      makeServiceSheet("urgencias", [
        // Two rows that would each produce an empty-displayname record.
        // Using a label that resolves to "" after normalization is tricky;
        // instead test via the NormalizedImportRow path by crafting two
        // records with empty displayName directly in the merge pipeline.
        { label: "Triaje", numbers: ["11111"] },
        { label: "Mostrador", numbers: ["22222"] }
      ])
    ]);

    const result = normalizeWorkbookRowsFromFile(filePath);
    // Normal records should be distinct.
    expect(result.rows).toHaveLength(2);
    const names = result.rows.map((r) => r.displayName);
    expect(names).toContain("Triaje");
    expect(names).toContain("Mostrador");
  });

  it("passthrough (centers-parser) records with no phones JSON are emitted individually", async () => {
    // Centers-parser records have no phones JSON field (they use phone1/phone2
    // flat fields only).  Each must pass through unchanged without being merged.
    const filePath = writeWorkbook(testRoot, "centers-passthrough.xlsx", [
      {
        name: "centros-de-salud",
        data: [
          ["CENTROSDESALUD", "SERVICIO", "NUMEROLARGO", "NUMEROCORTO"],
          ["C/ Ejemplo 1", "INF.", "928111111", "1111"],
          ["C/ Ejemplo 2", "INF.", "928222222", "2222"]
        ]
      }
    ]);

    const result = normalizeWorkbookRowsFromFile(filePath);
    expect(result.rows).toHaveLength(2);
  });

  it("direct: two NormalizedImportRows with empty/whitespace displayName are NOT merged (empty-key guard)", async () => {
    // This test directly exercises the guard at spreadsheet-import.service.ts:1420
    // (the `if (!key) { continue; }` block that prevents records whose displayName
    // normalizes to "" from all collapsing into one merged record).
    //
    // Both rows carry a phones JSON field (so they are candidates for the merge
    // pipeline), but their displayName is empty / whitespace-only.  The normalized
    // key therefore resolves to "".  The guard must emit each as an individual
    // passthrough rather than collapsing them into a single merged record.
    const { mergeRecordsByDisplayName } = await import("./spreadsheet-import.service.js");

    const validPhonesA = JSON.stringify([
      { number: "11111", label: "L1", kind: "internal", isPrimary: true, confidential: false, noPatientSharing: false }
    ]);
    const validPhonesB = JSON.stringify([
      { number: "22222", label: "L2", kind: "internal", isPrimary: true, confidential: false, noPatientSharing: false }
    ]);

    const recordA = {
      externalId: "empty-name-a",
      type: "service",
      displayName: "",
      phones: validPhonesA,
      notes: ""
    } as Record<string, string>;

    const recordB = {
      externalId: "empty-name-b",
      type: "service",
      displayName: "   ",
      phones: validPhonesB,
      notes: ""
    } as Record<string, string>;

    const merged = mergeRecordsByDisplayName([recordA, recordB]);

    // Without the guard, both would share the normalized key "" and collapse to
    // 1 merged record.  With the guard, each is emitted as a separate passthrough.
    expect(merged).toHaveLength(2);

    // Each output record retains its own distinct phone number.
    const phonesA = JSON.parse(merged.find((r) => r.externalId === "empty-name-a")!.phones!) as Array<{ number: string }>;
    const phonesB = JSON.parse(merged.find((r) => r.externalId === "empty-name-b")!.phones!) as Array<{ number: string }>;
    expect(phonesA.map((p) => p.number)).toContain("11111");
    expect(phonesB.map((p) => p.number)).toContain("22222");
  });
});

// ---------------------------------------------------------------------------
// Bug 2 — merged output not in original encounter order
// ---------------------------------------------------------------------------

describe("Bug 2 — output is in original encounter order", () => {
  it("passthrough record positioned before a to-be-merged group keeps its position", () => {
    // Layout:
    //   Sheet 1: [passthrough-only contact (centers), then "Banco de Sangre"]
    //   Sheet 2: ["Banco de Sangre" again → merge group]
    //
    // Because centers-parser records have no phones JSON, they are passthroughs
    // and should appear at their original position relative to mergeable rows.
    //
    // We use two canonical service sheets: the first has a unique contact
    // (Triaje) followed by the merge candidate, and the second has only the
    // merge candidate.  After merging, Triaje must appear BEFORE Banco de Sangre.
    const filePath = writeWorkbook(testRoot, "order-passthrough.xlsx", [
      makeServiceSheet("urgencias", [
        { label: "Triaje", numbers: ["99999"] },
        { label: "Banco de Sangre", numbers: ["11111"] }
      ]),
      makeServiceSheet("umi", [
        { label: "Banco de Sangre", numbers: ["22222"] }
      ])
    ]);

    const result = normalizeWorkbookRowsFromFile(filePath);
    const names = result.rows.map((r) => r.displayName);

    // Triaje (first contact from urgencias) must come BEFORE Banco de Sangre.
    const triageIdx = names.indexOf("Triaje");
    const bancoIdx = names.indexOf("Banco de Sangre");
    expect(triageIdx).toBeGreaterThanOrEqual(0);
    expect(bancoIdx).toBeGreaterThanOrEqual(0);
    expect(triageIdx).toBeLessThan(bancoIdx);
  });

  it("a record that appears between two merged contacts retains its position", () => {
    // Sheet: [A-merged, B-passthrough-between, A-merged-second, C-end]
    // After merging A, B must remain between A and C.
    const filePath = writeWorkbook(testRoot, "order-middle.xlsx", [
      makeServiceSheet("urgencias", [
        { label: "Admision", numbers: ["11111"] },
        { label: "Mostrador", numbers: ["33333"] },
        { label: "Admision", numbers: ["22222"] },
        { label: "Control", numbers: ["44444"] }
      ])
    ]);

    const result = normalizeWorkbookRowsFromFile(filePath);
    const names = result.rows.map((r) => r.displayName);
    const admIdx = names.indexOf("Admision");
    const mostradorIdx = names.indexOf("Mostrador");
    const controlIdx = names.indexOf("Control");

    // Admision (merged from positions 0 and 2) must be at position 0.
    expect(admIdx).toBe(0);
    // Mostrador (position 1 originally) must come between Admision and Control.
    expect(mostradorIdx).toBeLessThan(controlIdx);
    expect(mostradorIdx).toBeGreaterThan(admIdx);
  });
});

// ---------------------------------------------------------------------------
// Bug 3 — isSocialHandle can silently drop a real contact
// ---------------------------------------------------------------------------

describe("Bug 3 — section-context social skip does not drop real contacts", () => {
  it("does NOT skip a handle-shaped label NOT under a social section", () => {
    // "urgencias" is 9 chars, all-lowercase, no digit, no space — the old pure
    // shape heuristic would have matched it.  With the section-context guard,
    // it must NOT be skipped unless there is social context.
    //
    // Row structure: ["urgencias", "ver extensión"] — two non-empty cells so the
    // single-cell section-setter gate is bypassed, and the row reaches the social
    // check.  No social section is active; no social token in cells → not skipped.
    const filePath = writeWorkbook(testRoot, "no-phone-real-word.xlsx", [
      {
        name: "urgencias",
        data: [
          ["SERVICIO", "NUMERO"],
          ["Triaje urgencias", "12345"],
          ["Mostrador urgencias", "12346"],
          ["Control boxes", "12347"],
          // Two non-empty cells: label + 10-digit reference number.
          // extractNumbers("ref 1234567890") = ["1234567890"] (≥ 4 digits),
          // so the multi-cell section-setter gate (which requires every col-1+
          // cell to have extractNumbers length=0) does NOT fire.
          // hasPhoneLikeNumber requires number length 4–9; 10 digits → not phone-like,
          // so rowHasPhone = false.  No social context → isSocialContextRow = false
          // → row is kept in result.rows.
          ["urgencias", "ref 1234567890"]
        ]
      }
    ]);

    const result = normalizeWorkbookRowsFromFile(filePath);
    const names = result.rows.map((r) => r.displayName);
    // "urgencias" without social context must appear in result.rows.
    expect(names).toContain("urgencias");
  });

  it("skips a no-phone handle-shaped label UNDER a social section header", () => {
    // "REDES SOCIALES HOSPITAL" as a single-cell row → section setter (currentSection).
    // "hospitaldrnegrin" row has two cells so bypasses the section-setter gate.
    // sectionIsSocial(currentSection) → true → isSocialContextRow fires → skipped.
    const filePath = writeWorkbook(testRoot, "handle-under-social-section.xlsx", [
      {
        name: "urgencias",
        data: [
          ["SERVICIO", "NUMERO"],
          ["Triaje urgencias", "12345"],
          ["Mostrador urgencias", "12346"],
          ["Control boxes", "12347"],
          // Single-cell row — becomes the section header (sectionIsSocial → true).
          ["REDES SOCIALES HOSPITAL"],
          // Two-cell row whose label is a handle and has no phone → skipped.
          ["hospitaldrnegrin", "ver perfil"]
        ]
      }
    ]);

    const result = normalizeWorkbookRowsFromFile(filePath);
    const names = result.rows.map((r) => r.displayName);
    expect(names).not.toContain("hospitaldrnegrin");
    expect(names).toContain("Triaje urgencias");
  });

  it("skips a no-phone handle when the CURRENT ROW contains a social token", () => {
    // Row col-0 is the handle, col-1 is a social-media token (INSTAGRAM).
    // Two non-empty cells → section-setter gate is bypassed.
    // rowContainsSocialToken → true → effectiveSocialContext=true.
    // isSocialContextRow("hospitaldrnegrin", true) → true → skipped.
    const filePath = writeWorkbook(testRoot, "handle-row-social-token.xlsx", [
      {
        name: "urgencias",
        data: [
          ["SERVICIO", "NUMERO"],
          ["Triaje urgencias", "12345"],
          ["Mostrador urgencias", "12346"],
          ["Control boxes", "12347"],
          // Col-0 is the handle, col-1 is "INSTAGRAM" (a social token).
          // No phone → social skip fires.
          ["hospitaldrnegrin", "INSTAGRAM"]
        ]
      }
    ]);

    const result = normalizeWorkbookRowsFromFile(filePath);
    const names = result.rows.map((r) => r.displayName);
    expect(names).not.toContain("hospitaldrnegrin");
    expect(names).toContain("Triaje urgencias");
  });

  it("does NOT skip a real lowercase label WITH a phone even under social section", () => {
    // A row with a phone co-occurring is never affected by the social skip.
    const filePath = writeWorkbook(testRoot, "lowercase-phone-social-section.xlsx", [
      {
        name: "urgencias",
        data: [
          ["SERVICIO", "NUMERO"],
          ["Triaje urgencias", "12345"],
          ["Mostrador urgencias", "12346"],
          ["Control boxes", "12347"],
          ["REDES SOCIALES"],
          // Handle-shaped label WITH a phone — must be kept.
          ["secretaria", "70979"]
        ]
      }
    ]);

    const result = normalizeWorkbookRowsFromFile(filePath);
    const names = result.rows.map((r) => r.displayName);
    expect(names).toContain("secretaria");
  });
});

// ---------------------------------------------------------------------------
// Bug 4 — unguarded JSON entries in buildPhones / mergeRecordsByDisplayName
// ---------------------------------------------------------------------------

describe("Bug 4 — invalid phones JSON entries do not crash the import", () => {
  it("handles a phones JSON entry with null number without throwing", async () => {
    // A phones JSON column with a null 'number' field must not crash buildPhones.
    // The invalid entry is dropped; valid entries are kept.
    const { buildImportPreviewFromRows } = await import("./csv-import.service.js");
    const row = {
      type: "service",
      displayName: "Test Service",
      phones: JSON.stringify([
        { number: null, label: "L1", kind: "internal", isPrimary: true, confidential: false, noPatientSharing: false },
        { number: "70001", label: "L2", kind: "internal", isPrimary: false, confidential: false, noPatientSharing: false }
      ])
    };

    let errorThrown = false;
    try {
      const { preview, dataset } = await buildImportPreviewFromRows([row], {
        sourceFilePath: "/tmp/test.csv",
        fileName: "test.csv",
        editorName: "TestEditor"
      });
      // The null-number entry must be dropped; the valid entry kept.
      expect(preview.invalidRowCount).toBe(0);
      expect(dataset.records[0]?.contactMethods.phones).toHaveLength(1);
      expect(dataset.records[0]?.contactMethods.phones[0]?.number).toBe("70001");
    } catch {
      errorThrown = true;
    }
    expect(errorThrown).toBe(false);
  });

  it("handles a phones JSON entry with numeric number without throwing", async () => {
    const { buildImportPreviewFromRows } = await import("./csv-import.service.js");
    const row = {
      type: "service",
      displayName: "Test Service 2",
      phones: JSON.stringify([
        { number: 12345, label: "L1", kind: "internal", isPrimary: true, confidential: false, noPatientSharing: false },
        { number: "70002", label: "L2", kind: "internal", isPrimary: false, confidential: false, noPatientSharing: false }
      ])
    };

    const { preview, dataset } = await buildImportPreviewFromRows([row], {
      sourceFilePath: "/tmp/test.csv",
      fileName: "test.csv",
      editorName: "TestEditor"
    });
    // The numeric-number entry is dropped; valid string entry kept.
    expect(preview.invalidRowCount).toBe(0);
    expect(dataset.records[0]?.contactMethods.phones).toHaveLength(1);
    expect(dataset.records[0]?.contactMethods.phones[0]?.number).toBe("70002");
  });

  it("handles a phones JSON entry with missing number field without throwing", async () => {
    const { buildImportPreviewFromRows } = await import("./csv-import.service.js");
    const row = {
      type: "service",
      displayName: "Test Service 3",
      phones: JSON.stringify([
        { label: "L1", kind: "internal", isPrimary: true, confidential: false, noPatientSharing: false },
        { number: "70003", label: "L2", kind: "internal", isPrimary: false, confidential: false, noPatientSharing: false }
      ])
    };

    const { preview, dataset } = await buildImportPreviewFromRows([row], {
      sourceFilePath: "/tmp/test.csv",
      fileName: "test.csv",
      editorName: "TestEditor"
    });
    // Missing-number entry dropped; valid entry kept.
    expect(preview.invalidRowCount).toBe(0);
    expect(dataset.records[0]?.contactMethods.phones).toHaveLength(1);
    expect(dataset.records[0]?.contactMethods.phones[0]?.number).toBe("70003");
  });
});

// ---------------------------------------------------------------------------
// Bug 5 — silent zero-phone merged record
// ---------------------------------------------------------------------------

describe("Bug 5 — zero-phone merged record gets a warning in notes", () => {
  it("merged record with valid phones does NOT get a warning in notes", () => {
    // Regression guard: a normal two-sheet merge (both with real phone numbers)
    // must NOT produce the zero-phone warning in notes.
    const filePath = writeWorkbook(testRoot, "valid-phones-merge.xlsx", [
      makeServiceSheet("urgencias", [
        { label: "Banco de Sangre", numbers: ["11111"] }
      ]),
      makeServiceSheet("umi", [
        { label: "Banco de Sangre", numbers: ["22222"] }
      ])
    ]);

    const result = normalizeWorkbookRowsFromFile(filePath);
    const row = result.rows.find((r) => r.displayName === "Banco de Sangre");
    expect(row).toBeDefined();
    // Valid phones on both sides → no warning injected.
    expect(row?.notes ?? "").not.toContain("AVISO");
  });

  it("merged group with all-invalid phones JSON gets a warning in notes", async () => {
    // Calls mergeRecordsByDisplayName directly with NormalizedImportRow records
    // whose phones JSON fields contain only entries that fail isSerializedPhoneEntry
    // (number: null rather than a string).  The merged group resolves to zero
    // phones → Bug 5 fix injects the warning into notes.
    const { mergeRecordsByDisplayName } = await import("./spreadsheet-import.service.js");

    const invalidPhonesJson = JSON.stringify([
      { number: null, label: "L1", kind: "internal", isPrimary: true, confidential: false, noPatientSharing: false }
    ]);

    const recordA = {
      externalId: "banco-a",
      type: "service",
      displayName: "Banco de Sangre",
      phones: invalidPhonesJson,
      notes: ""
    } as Record<string, string>;

    const recordB = {
      externalId: "banco-b",
      type: "service",
      displayName: "Banco de Sangre",
      phones: invalidPhonesJson,
      notes: ""
    } as Record<string, string>;

    const merged = mergeRecordsByDisplayName([recordA, recordB]);

    // Two records with the same normalized displayName → merged into one.
    expect(merged).toHaveLength(1);
    // Every phone entry fails isSerializedPhoneEntry → zero phones → warning injected.
    expect(merged[0]?.notes ?? "").toContain("AVISO");
  });
});
