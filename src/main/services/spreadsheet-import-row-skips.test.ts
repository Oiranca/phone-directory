/**
 * INTERIM — Buscas sheet skip and social-handle row skip.
 *
 * This file covers row-skipping fixes distinct from the multi-sheet phone
 * merge tests in `spreadsheet-import-multisheet.test.ts`.
 *
 * Two categories of non-phone-contact rows were blocking the all-or-nothing
 * import preview:
 *
 *   A. Buscas sheets (Buscas_Facultativos, Buscas_Enfermería, etc.) — these
 *      belong to a separate pager/localizador section that does not yet exist
 *      in this app.  Their "PRINCIPAL / RESIDENTE" header was being parsed as
 *      a rejected contact.  Fix: isDeferredFeatureSheet skips any sheet whose
 *      slug starts with "buscas" before detectSheetProfile runs.
 *
 *   B. Social-media handle rows — e.g. "hospitaldrnegrin" (the hospital's
 *      Instagram handle) stored in the ODS next to the Comunicaciones/Redes
 *      Sociales phone entry.  Fix: isSocialHandle silently skips a resolved
 *      label that is single-token, all-lowercase, no digits, 8+ chars, and
 *      has no phone numbers on the same row.
 *
 * These tests call normalizeWorkbookRowsFromFile (the sync path active when
 * VITEST=true) and write temporary workbook fixtures via xlsx.
 */
import nodeFs from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import XLSX from "xlsx";
import { normalizeWorkbookRowsFromFile } from "./spreadsheet-import.service.js";
import { writeWorkbook } from "./test-support/xlsxWorkbook.js";

XLSX.set_fs(nodeFs);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal service-sheet: header row + data rows. Name must be canonical. */
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

let testRoot: string;

beforeEach(async () => {
  testRoot = await fs.mkdtemp(path.join(os.tmpdir(), "spreadsheet-row-skips-"));
});

afterEach(async () => {
  await fs.rm(testRoot, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// A. Buscas sheet skip
// ---------------------------------------------------------------------------

describe("Buscas sheet skip (isDeferredFeatureSheet)", () => {
  it("produces NO contacts from a Buscas_Celadores sheet", () => {
    // Buscas sheets use 4-digit pager codes, not phone numbers.
    // The "PRINCIPAL / RESIDENTE" header row must NOT become a contact.
    const filePath = writeWorkbook(testRoot, "buscas-celadores.xlsx", [
      {
        name: "Buscas_Celadores",
        data: [
          ["SERVICIO", "PRINCIPAL", "PRINCIPAL 2", "COMENTARIOS"],
          ["CELADOR CCEE (A+B)", "7183", "", ""],
          ["CELADOR QUIRÓFANO", "7585", "", ""]
        ]
      },
      // Include a real data sheet so normalizeWorkbookRowsFromFile does not throw.
      makeServiceSheet("urgencias", [
        { label: "Triaje", numbers: ["12345"] }
      ])
    ]);

    const result = normalizeWorkbookRowsFromFile(filePath);

    // Buscas rows must not appear at all.
    const names = result.rows.map((r) => r.displayName);
    expect(names).not.toContain("PRINCIPAL / RESIDENTE");
    expect(names).not.toContain("CELADOR CCEE (A+B)");
    expect(names).not.toContain("CELADOR QUIRÓFANO");
    // Real data sheet rows are present.
    expect(names).toContain("Triaje");
  });

  it("produces NO contacts from a Buscas_Facultativos sheet including its header", () => {
    const filePath = writeWorkbook(testRoot, "buscas-facultativos.xlsx", [
      {
        name: "Buscas_Facultativos",
        data: [
          ["SERVICIO", "PRINCIPAL / RESIDENTE", "ADJUNTO 1", "COMENTARIOS"],
          ["ANESTESIA", "7321", "", ""],
          ["CARDIOLOGÍA", "7580", "", ""]
        ]
      },
      makeServiceSheet("urgencias", [
        { label: "Mostrador", numbers: ["11111"] }
      ])
    ]);

    const result = normalizeWorkbookRowsFromFile(filePath);
    const names = result.rows.map((r) => r.displayName);
    // Column header "PRINCIPAL / RESIDENTE" must NOT appear as a contact.
    expect(names).not.toContain("PRINCIPAL / RESIDENTE");
    expect(names).not.toContain("ANESTESIA");
    expect(names).not.toContain("CARDIOLOGÍA");
    expect(names).toContain("Mostrador");
  });

  it("produces NO contacts from any sheet whose name starts with Buscas_", () => {
    // All four real Buscas variants must be skipped.
    const buscasNames = [
      "Buscas_Facultativos",
      "Buscas_Enfermería",
      "Buscas_Celadores",
      "Buscas_Varios"
    ];
    const filePath = writeWorkbook(testRoot, "all-buscas.xlsx", [
      ...buscasNames.map((name) => ({
        name,
        data: [
          ["SERVICIO", "PRINCIPAL"],
          ["ALGÚN SERVICIO BUSCA", "7000"]
        ]
      })),
      makeServiceSheet("urgencias", [
        { label: "Triaje", numbers: ["12345"] }
      ])
    ]);

    const result = normalizeWorkbookRowsFromFile(filePath);
    const names = result.rows.map((r) => r.displayName);
    expect(names).not.toContain("ALGÚN SERVICIO BUSCA");
    expect(names).toContain("Triaje");
  });
});

// ---------------------------------------------------------------------------
// B. Social-handle row skip (isSocialHandle)
// ---------------------------------------------------------------------------

describe("Social-handle row import (social rows are first-class contacts)", () => {
  it("imports a social-handle row as a contact with the handle as a social method", () => {
    // The old isSocialHandle skip was removed. Social rows are now imported
    // as first-class contacts. The parser resolves "hospitaldrnegrin" as the
    // label (first cell is ALL-CAPS excluded; fallback finds the all-lowercase
    // token in col 1). The platform is inferred from the row cells (INSTAGRAM).
    const filePath = writeWorkbook(testRoot, "social-handle.xlsx", [
      {
        name: "urgencias",
        data: [
          ["SERVICIO", "NUMERO"],
          ["Triaje", "12345"],
          ["Mostrador urgencias", "12346"],
          // Social-media row: label resolves to "hospitaldrnegrin"; platform from cells.
          ["REDES SOCIALES HOSPITAL - INSTAGRAM", "hospitaldrnegrin", "", ""],
          // Continuation row with empty col-0 and handle in col-2
          ["", "", "hospitaldrnegrin", "", ""],
          ["Control cajas", "12347"]
        ]
      }
    ]);

    const result = normalizeWorkbookRowsFromFile(filePath);
    const names = result.rows.map((r) => r.displayName);

    // Social handle IS now imported as a contact.
    expect(names).toContain("hospitaldrnegrin");
    // Verify social fields are set on the imported contact.
    const socialRow = result.rows.find((r) => r.displayName === "hospitaldrnegrin");
    expect(socialRow?.social1Handle).toBe("hospitaldrnegrin");
    expect(socialRow?.social1Platform).toBe("instagram");
    // Real contacts are preserved.
    expect(names).toContain("Triaje");
    expect(names).toContain("Mostrador urgencias");
    expect(names).toContain("Control cajas");
  });

  it("does not skip a multi-word fallback label when the first cell is excluded", () => {
    // The isSocialHandle check only activates when the label is resolved via
    // resolveServiceRowLabel's fallback (col-0 is excluded).  This test
    // verifies that a multi-word label resolved from a later column is NOT
    // matched by isSocialHandle (which requires no spaces).
    //
    // Row shape: [excluded-ALL-CAPS, "Dr. García asignado pendiente", ""]
    //   - col-0 excluded → fallback resolves "Dr. García asignado pendiente"
    //     from col-1 (has letters, no phone-like digits)
    //   - "Dr. García asignado pendiente" has spaces → isSocialHandle = false
    //   - Row has no phone but col-1 is non-empty → not caught by all-empty guard
    //   - Result: the row IS emitted as a no-phone contact (will be rejected by
    //     buildImportPreviewFromRows, but NOT silently swallowed by isSocialHandle)
    const filePath = writeWorkbook(testRoot, "multi-word-fallback.xlsx", [
      {
        name: "urgencias",
        data: [
          ["SERVICIO", "NUMERO"],
          // Valid contacts to ensure the sheet is accepted.
          ["Triaje urgencias", "12345"],
          ["Mostrador urgencias", "12346"],
          ["Control boxes", "12347"],
          // Row where col-0 is excluded but col-1 resolves a multi-word label.
          ["SECCIÓN ESPECIAL", "Dr. García pendiente", ""]
        ]
      }
    ]);

    const result = normalizeWorkbookRowsFromFile(filePath);
    const names = result.rows.map((r) => r.displayName);

    // The multi-word fallback label must be emitted (has spaces → not a handle).
    expect(names).toContain("Dr. García pendiente");
    // Valid contacts still present.
    expect(names).toContain("Triaje urgencias");
  });

  it("does not skip a contact whose all-lowercase single-word label co-occurs with a phone", () => {
    // e.g. "secretaria 70979" — the label resolves to "secretaria" (one word,
    // all lowercase) BUT there is a phone number → isSocialHandle skip is not
    // triggered (phones present).
    const filePath = writeWorkbook(testRoot, "lowercase-with-phone.xlsx", [
      {
        name: "urgencias",
        data: [
          ["SERVICIO", "NUMERO"],
          ["secretaria", "70979"],
          ["resonancia", "79306"],
          ["Triaje urgencias", "12345"]
        ]
      }
    ]);

    const result = normalizeWorkbookRowsFromFile(filePath);
    const names = result.rows.map((r) => r.displayName);

    // These have phones → they are normal contacts, not skipped.
    expect(names).toContain("secretaria");
    expect(names).toContain("resonancia");
    expect(names).toContain("Triaje urgencias");
  });
});

// ---------------------------------------------------------------------------
// C. buscasSkippedRowCount / socialHandleSkippedRowCount surface
// ---------------------------------------------------------------------------

describe("buscasSkippedRowCount / socialHandleSkippedRowCount in SpreadsheetImportNormalizationResult", () => {
  it("buscasSkippedRowCount counts genuinely-unparseable buscas rows only (empty/comment rows)", () => {
    // Buscas sheets are now parsed into buscasParseResult, not simply skipped.
    // buscasSkippedRowCount reflects only rows that yielded no pager record
    // (empty department label or all holder cells empty/non-numeric).
    // Buscas_Celadores: 2 data rows, both have pager numbers → 0 skipped buscas rows.
    const filePath = writeWorkbook(testRoot, "buscas-count.xlsx", [
      {
        name: "Buscas_Celadores",
        data: [
          ["SERVICIO", "PRINCIPAL", "PRINCIPAL 2"],
          ["CELADOR CCEE (A+B)", "7183", ""],
          ["CELADOR QUIRÓFANO", "7585", ""]
        ]
      },
      makeServiceSheet("urgencias", [
        { label: "Triaje", numbers: ["12345"] }
      ])
    ]);

    const result = normalizeWorkbookRowsFromFile(filePath);

    // Both buscas rows have pager numbers → 0 genuinely-skipped buscas rows.
    expect(result.buscasSkippedRowCount).toBe(0);
    expect(result.socialHandleSkippedRowCount).toBe(0);
    // buscasParseResult carries the parsed records.
    expect(result.buscasParseResult.parsedCellCount).toBe(2);
    expect(result.buscasParseResult.records).toHaveLength(2);
    // Real contacts unaffected.
    expect(result.rows.map((r) => r.displayName)).toContain("Triaje");
  });

  it("social-handle rows are now imported as contacts (socialHandleSkippedRowCount stays 0)", () => {
    // Social rows are no longer skipped — they are mapped to social contacts.
    // Previously this test asserted socialHandleSkippedRowCount === 1 and that
    // "hospitaldrnegrin" was NOT in the result. Now the row becomes a contact
    // with social1Handle = "hospitaldrnegrin" and socialHandleSkippedRowCount === 0.
    const filePath = writeWorkbook(testRoot, "social-count.xlsx", [
      {
        name: "urgencias",
        data: [
          ["SERVICIO", "NUMERO"],
          ["Triaje", "12345"],
          ["Mostrador urgencias", "12346"],
          // Social handle: all-lowercase single token, 8+ chars, no phone.
          ["REDES SOCIALES HOSPITAL - INSTAGRAM", "hospitaldrnegrin", "", ""],
          ["Control cajas", "12347"]
        ]
      }
    ]);

    const result = normalizeWorkbookRowsFromFile(filePath);

    // Social rows are now imported — not skipped.
    expect(result.buscasSkippedRowCount).toBe(0);
    expect(result.socialHandleSkippedRowCount).toBe(0);
    const names = result.rows.map((r) => r.displayName);
    expect(names).toContain("Triaje");
    expect(names).toContain("Mostrador urgencias");
    expect(names).toContain("Control cajas");
    // hospitaldrnegrin is now a valid social contact, not skipped.
    expect(names).toContain("hospitaldrnegrin");
    // Verify it was mapped as a social entry.
    const socialRow = result.rows.find((r) => r.displayName === "hospitaldrnegrin");
    expect(socialRow?.social1Handle).toBe("hospitaldrnegrin");
    expect(socialRow?.social1Platform).toBe("instagram");
    expect(socialRow?.social1IsPrimary).toBe("true");
  });

  it("buscas rows are parsed into buscasParseResult; social rows are imported as contacts", () => {
    // Buscas_Varios data rows are parsed into buscasParseResult.records,
    // not counted in buscasSkippedRowCount (which is now empty/comment-only rows).
    // Social-handle row is imported as a contact.
    const filePath = writeWorkbook(testRoot, "combined-count.xlsx", [
      {
        name: "Buscas_Varios",
        data: [
          ["SERVICIO", "PRINCIPAL"],
          ["ANESTESIA", "7001"],
          ["CARDIOLOGÍA", "7002"],
          ["CIRUGÍA", "7003"]
        ]
      },
      {
        name: "urgencias",
        data: [
          ["SERVICIO", "NUMERO"],
          ["Triaje", "12345"],
          ["REDES SOCIALES HOSPITAL - INSTAGRAM", "hospitaldrnegrin", "", ""],
          ["Mostrador", "12346"]
        ]
      }
    ]);

    const result = normalizeWorkbookRowsFromFile(filePath);

    // All 3 buscas data rows have pager numbers → 0 genuinely-skipped buscas rows.
    expect(result.buscasSkippedRowCount).toBe(0);
    expect(result.buscasParseResult.parsedCellCount).toBe(3);
    expect(result.buscasParseResult.records).toHaveLength(3);
    // Social row is imported (not skipped), so counter stays 0.
    expect(result.socialHandleSkippedRowCount).toBe(0);
    const names = result.rows.map((r) => r.displayName);
    expect(names).toContain("Triaje");
    expect(names).toContain("Mostrador");
    expect(names).toContain("hospitaldrnegrin");
  });

  it("returns both counts as 0 when there are no deferred skips", () => {
    const filePath = writeWorkbook(testRoot, "no-skips.xlsx", [
      makeServiceSheet("urgencias", [
        { label: "Triaje", numbers: ["11111"] },
        { label: "Control boxes", numbers: ["22222"] }
      ])
    ]);

    const result = normalizeWorkbookRowsFromFile(filePath);

    expect(result.buscasSkippedRowCount).toBe(0);
    expect(result.socialHandleSkippedRowCount).toBe(0);
    expect(result.rows).toHaveLength(2);
  });

  it("buildSpreadsheetImportPreview returns buscasParseResult with parsed records", async () => {
    // buildSpreadsheetImportPreview now returns buscasParseResult alongside the preview.
    // The preview.buscasSkippedRowCount reflects genuinely-unparseable buscas rows only.
    // Buscas_Enfermería: 2 data rows both have pager numbers → 0 skipped.
    const { buildSpreadsheetImportPreview } = await import("./spreadsheet-import.service.js");
    const filePath = writeWorkbook(testRoot, "preview-count.xlsx", [
      {
        name: "Buscas_Enfermería",
        data: [
          ["SERVICIO", "PRINCIPAL"],
          ["PLANTA 1", "8001"],
          ["PLANTA 2", "8002"]
        ]
      },
      makeServiceSheet("urgencias", [
        { label: "Triaje", numbers: ["12345"] }
      ])
    ]);

    const { preview, buscasParseResult } = await buildSpreadsheetImportPreview(filePath, "test-editor");

    // Both buscas rows have pager numbers → parsed, not skipped.
    expect(buscasParseResult.parsedCellCount).toBe(2);
    expect(buscasParseResult.records).toHaveLength(2);
    // preview.buscasSkippedRowCount = genuinely-skipped rows only (0 here).
    expect(preview.buscasSkippedRowCount).toBe(0);
    expect(preview.socialHandleSkippedRowCount).toBe(0);
    // Import is not blocked by buscas rows.
    expect(preview.invalidRowCount).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// E. Regression — real flat service sheets still import after both skips
// ---------------------------------------------------------------------------

describe("Regression: real flat service sheets still import after interim skips", () => {
  it("imports contacts from urgencias sheet unchanged", () => {
    const filePath = writeWorkbook(testRoot, "regression-urgencias.xlsx", [
      makeServiceSheet("urgencias", [
        { label: "Triaje", numbers: ["11111"] },
        { label: "Control boxes", numbers: ["22222", "33333"] },
        { label: "Banco de Sangre", numbers: ["44444"] }
      ])
    ]);

    const result = normalizeWorkbookRowsFromFile(filePath);
    const names = result.rows.map((r) => r.displayName);
    expect(names).toContain("Triaje");
    expect(names).toContain("Control boxes");
    expect(names).toContain("Banco de Sangre");
    expect(result.rows).toHaveLength(3);
  });

  it("imports contacts from a canonical sheet (rayos) containing mixed-case labels", () => {
    // Regression guard: canonical sheet parsing must not be disrupted by the
    // buscas-skip or social-handle-skip additions.
    const filePath = writeWorkbook(testRoot, "regression-rayos.xlsx", [
      makeServiceSheet("rayos", [
        { label: "Sala TAC", numbers: ["55555"] },
        { label: "Sala RX", numbers: ["66666"] },
        { label: "Resonancia", numbers: ["79306"] }
      ])
    ]);

    const result = normalizeWorkbookRowsFromFile(filePath);
    const names = result.rows.map((r) => r.displayName);
    expect(names).toContain("Sala TAC");
    expect(names).toContain("Sala RX");
    expect(names).toContain("Resonancia");
    expect(result.rows).toHaveLength(3);
  });
});
