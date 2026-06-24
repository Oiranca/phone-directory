/**
 * OIR-130 — Unit tests for spreadsheet-buscas-parser.ts
 *
 * Covers:
 *   1. detectBuscasHeaderRowIndex — header detection across first 5 rows
 *   2. parseBuscasSheet — column routing, pager extraction, skipped rows
 *   3. parseBuscasSheets — multi-sheet aggregation
 *   4. Edge cases: empty sheets, no holder columns, non-pager cells, COMENTARIOS column
 *
 * Real ODS sheet shapes tested:
 *   - Buscas_Facultativos: SERVICIO / PRINCIPAL / RESIDENTE / ADJUNTO 1 / COMENTARIOS
 *   - Buscas_Celadores: SERVICIO / PRINCIPAL / PRINCIPAL 2 / COMENTARIOS
 *   - Buscas_Enfermería: SERVICIO / PRINCIPAL / RESIDENTE
 *   - Buscas_Varios: SERVICIO / LOCALIZADOR
 */

import { describe, expect, it } from "vitest";
import {
  detectBuscasHeaderRowIndex,
  parseBuscasSheet,
  parseBuscasSheets
} from "./spreadsheet-buscas-parser.js";

// ---------------------------------------------------------------------------
// detectBuscasHeaderRowIndex
// ---------------------------------------------------------------------------

describe("detectBuscasHeaderRowIndex", () => {
  it("detects header at row 0 when PRINCIPAL is in col 1", () => {
    const rows = [
      ["SERVICIO", "PRINCIPAL", "RESIDENTE", "COMENTARIOS"],
      ["ANESTESIA", "7321", "", ""]
    ];
    expect(detectBuscasHeaderRowIndex(rows)).toBe(0);
  });

  it("detects header at row 1 when row 0 is a title row", () => {
    const rows = [
      ["BUSCAS FACULTATIVOS", "", "", ""],
      ["SERVICIO", "PRINCIPAL / RESIDENTE", "ADJUNTO 1", "COMENTARIOS"],
      ["ANESTESIA", "7321", "", ""]
    ];
    expect(detectBuscasHeaderRowIndex(rows)).toBe(1);
  });

  it("detects RESIDENTE keyword alone in col 1", () => {
    const rows = [
      ["SERVICIO", "RESIDENTE", "COMENTARIOS"],
      ["UCI", "8001", ""]
    ];
    expect(detectBuscasHeaderRowIndex(rows)).toBe(0);
  });

  it("detects ADJUNTO keyword in col 2 (col 1 may be non-holder)", () => {
    const rows = [
      ["SERVICIO", "NUMERO", "ADJUNTO 1", "COMENTARIOS"],
      ["CIRUGÍA", "7500", "7501", ""]
    ];
    expect(detectBuscasHeaderRowIndex(rows)).toBe(0);
  });

  it("detects LOCALIZADOR keyword", () => {
    const rows = [
      ["SERVICIO", "LOCALIZADOR"],
      ["PLANTA 1", "9001"]
    ];
    expect(detectBuscasHeaderRowIndex(rows)).toBe(0);
  });

  it("detects GUARDIA keyword", () => {
    const rows = [
      ["SERVICIO", "GUARDIA", "COMENTARIOS"],
      ["TRAUMATOLOGÍA", "7600", ""]
    ];
    expect(detectBuscasHeaderRowIndex(rows)).toBe(0);
  });

  it("returns -1 when no holder-type keyword is found in cols 1+", () => {
    const rows = [
      ["SERVICIO", "NUMERO", "COMENTARIOS"],
      ["URGENCIAS", "12345", ""]
    ];
    expect(detectBuscasHeaderRowIndex(rows)).toBe(-1);
  });

  it("returns -1 for empty rows", () => {
    expect(detectBuscasHeaderRowIndex([])).toBe(-1);
  });

  it("returns -1 when holder keyword only appears in col 0", () => {
    // PRINCIPAL in the service column should NOT be treated as a holder header
    const rows = [
      ["PRINCIPAL", "7321", ""],
      ["RESIDENTE", "7322", ""]
    ];
    // col 0 is not checked — these look like data rows, not headers
    // (no holder keyword in col 1+) — actually col 1 has "7321" (numeric), not a keyword
    expect(detectBuscasHeaderRowIndex(rows)).toBe(-1);
  });

  it("searches only the first 5 rows", () => {
    const rows = [
      ["", "", ""],
      ["", "", ""],
      ["", "", ""],
      ["", "", ""],
      ["", "", ""],
      // Row 5+ should not be found
      ["SERVICIO", "PRINCIPAL", "COMENTARIOS"],
      ["ANESTESIA", "7321", ""]
    ];
    expect(detectBuscasHeaderRowIndex(rows)).toBe(-1);
  });

  it("detects PRINCIPAL / RESIDENTE combined in one cell", () => {
    const rows = [
      ["SERVICIO", "PRINCIPAL / RESIDENTE", "ADJUNTO 1", "COMENTARIOS"],
      ["CARDIOLOGÍA", "7580", "", ""]
    ];
    expect(detectBuscasHeaderRowIndex(rows)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// parseBuscasSheet
// ---------------------------------------------------------------------------

describe("parseBuscasSheet", () => {
  it("parses a standard Buscas_Facultativos shape correctly", () => {
    const sheet = {
      name: "Buscas_Facultativos",
      rows: [
        ["SERVICIO", "PRINCIPAL / RESIDENTE", "ADJUNTO 1", "COMENTARIOS"],
        ["ANESTESIA", "7321", "", ""],
        ["CARDIOLOGÍA", "7580", "7581", "jefe de guardia"]
      ]
    };

    const result = parseBuscasSheet(sheet);

    // ANESTESIA × PRINCIPAL / RESIDENTE = 1 record; ADJUNTO 1 is empty
    // CARDIOLOGÍA × PRINCIPAL / RESIDENTE = 1 record; ADJUNTO 1 = 1 record
    expect(result.parsedCellCount).toBe(3);
    expect(result.records).toHaveLength(3);

    const first = result.records[0]!;
    expect(first.deviceNumber).toBe("7321");
    expect(first.department).toBe("Anestesia");
    expect(first.holderType).toBe("Principal / Residente");
    expect(first.sourceSheet).toBe("Buscas_Facultativos");
    expect(first.sourceRow).toBe(0); // first data row after header

    const third = result.records[2]!;
    expect(third.deviceNumber).toBe("7581");
    expect(third.department).toBe("Cardiología");
    expect(third.holderType).toBe("Adjunto 1");
  });

  it("ignores COMENTARIOS column (not a holder-type keyword)", () => {
    const sheet = {
      name: "Buscas_Celadores",
      rows: [
        ["SERVICIO", "PRINCIPAL", "PRINCIPAL 2", "COMENTARIOS"],
        ["CELADOR CCEE (A+B)", "7183", "", "turno mañana"],
        ["CELADOR QUIRÓFANO", "7585", "7586", ""]
      ]
    };

    const result = parseBuscasSheet(sheet);

    // COMENTARIOS column is excluded (not a holder keyword)
    // Row 0: PRINCIPAL=7183, PRINCIPAL 2=empty → 1 record
    // Row 1: PRINCIPAL=7585, PRINCIPAL 2=7586 → 2 records
    expect(result.parsedCellCount).toBe(3);
    const departments = result.records.map((r) => r.department);
    expect(departments).toContain("Celador Ccee (A+B)");
    expect(departments).toContain("Celador Quirófano");

    // No record with deviceNumber "turno mañana"
    expect(result.records.every((r) => r.deviceNumber !== "turno mañana")).toBe(true);
  });

  it("skips empty rows (no department label)", () => {
    const sheet = {
      name: "Buscas_Enfermería",
      rows: [
        ["SERVICIO", "PRINCIPAL", "RESIDENTE"],
        ["PLANTA 1", "8001", "8002"],
        ["", "", ""],   // empty row
        ["PLANTA 2", "8003", ""]
      ]
    };

    const result = parseBuscasSheet(sheet);

    expect(result.skippedRowCount).toBe(1);
    expect(result.parsedCellCount).toBe(3); // 2 from PLANTA 1, 1 from PLANTA 2
    expect(result.records).toHaveLength(3);
  });

  it("skips rows where all holder cells are empty (counts as skipped row)", () => {
    const sheet = {
      name: "Buscas_Varios",
      rows: [
        ["SERVICIO", "LOCALIZADOR"],
        ["PLANTA 1", "9001"],
        ["RESERVA", ""],  // department present but no pager numbers
        ["PLANTA 2", "9002"]
      ]
    };

    const result = parseBuscasSheet(sheet);

    expect(result.skippedRowCount).toBe(1); // RESERVA row
    expect(result.parsedCellCount).toBe(2);
    expect(result.records).toHaveLength(2);
  });

  it("returns empty result for a sheet with no detectable header", () => {
    const sheet = {
      name: "Unknown_Sheet",
      rows: [
        ["SERVICIO", "NUMERO"],
        ["URGENCIAS", "12345"]
      ]
    };

    const result = parseBuscasSheet(sheet);

    expect(result.parsedCellCount).toBe(0);
    expect(result.records).toHaveLength(0);
    expect(result.skippedRowCount).toBe(2); // all rows skipped
  });

  it("returns empty result for an empty sheet", () => {
    const result = parseBuscasSheet({ name: "Empty", rows: [] });

    expect(result.parsedCellCount).toBe(0);
    expect(result.records).toHaveLength(0);
    expect(result.skippedRowCount).toBe(0);
  });

  it("sets sourceRow as 0-based index within data rows (after header)", () => {
    const sheet = {
      name: "Buscas_Test",
      rows: [
        ["SERVICIO", "PRINCIPAL"],
        ["A", "1001"],
        ["B", "1002"],
        ["C", "1003"]
      ]
    };

    const result = parseBuscasSheet(sheet);

    expect(result.records[0]!.sourceRow).toBe(0);
    expect(result.records[1]!.sourceRow).toBe(1);
    expect(result.records[2]!.sourceRow).toBe(2);
  });

  it("handles a title row before the header row", () => {
    const sheet = {
      name: "Buscas_Facultativos",
      rows: [
        ["BUSCAS FACULTATIVOS 2024", "", "", ""],
        ["SERVICIO", "PRINCIPAL", "RESIDENTE", "COMENTARIOS"],
        ["ANESTESIA", "7321", "7322", ""]
      ]
    };

    const result = parseBuscasSheet(sheet);

    expect(result.parsedCellCount).toBe(2);
    expect(result.records[0]!.holderType).toBe("Principal");
    expect(result.records[1]!.holderType).toBe("Residente");
  });

  it("normalizes internal whitespace in pager numbers (BUG-2: '7 321' → '7321')", () => {
    const sheet = {
      name: "Buscas_Facultativos",
      rows: [
        ["SERVICIO", "PRINCIPAL", "RESIDENTE"],
        ["ANESTESIA", "7 321", "73 22"]
      ]
    };

    const result = parseBuscasSheet(sheet);

    expect(result.parsedCellCount).toBe(2);
    // Internal whitespace is stripped so the stored number is lookup-ready.
    expect(result.records[0]!.deviceNumber).toBe("7321");
    expect(result.records[1]!.deviceNumber).toBe("7322");
  });

  it("does not treat text cells as pager numbers", () => {
    const sheet = {
      name: "Buscas_Test",
      rows: [
        ["SERVICIO", "PRINCIPAL", "RESIDENTE"],
        ["CIRUGÍA", "7500", "pendiente"],  // "pendiente" is not a pager
        ["TRAUMATOLOGÍA", "sin_asignar", "7600"] // "sin_asignar" is not a pager
      ]
    };

    const result = parseBuscasSheet(sheet);

    // Only numeric cells are parsed
    const numbers = result.records.map((r) => r.deviceNumber);
    expect(numbers).toContain("7500");
    expect(numbers).toContain("7600");
    expect(numbers).not.toContain("pendiente");
    expect(numbers).not.toContain("sin_asignar");
    expect(result.parsedCellCount).toBe(2);
  });

  it("prettifies department names correctly", () => {
    const sheet = {
      name: "Buscas_Facultativos",
      rows: [
        ["SERVICIO", "PRINCIPAL"],
        ["UNIDAD DE CUIDADOS INTENSIVOS", "7001"],
        ["medicina interna", "7002"],
        ["BANCO DE SANGRE (ADMINISTRATIVO)", "7003"]
      ]
    };

    const result = parseBuscasSheet(sheet);

    const departments = result.records.map((r) => r.department);
    expect(departments[0]).toBe("Unidad De Cuidados Intensivos");
    expect(departments[1]).toBe("Medicina Interna");
    expect(departments[2]).toBe("Banco De Sangre (Administrativo)");
  });

  it("preserves sourceSheet name from the sheet", () => {
    const sheet = {
      name: "Buscas_Enfermería",
      rows: [
        ["SERVICIO", "PRINCIPAL"],
        ["PLANTA 1", "8001"]
      ]
    };

    const result = parseBuscasSheet(sheet);

    expect(result.records[0]!.sourceSheet).toBe("Buscas_Enfermería");
  });
});

// ---------------------------------------------------------------------------
// parseBuscasSheets (multi-sheet aggregation)
// ---------------------------------------------------------------------------

describe("parseBuscasSheets", () => {
  it("aggregates records from multiple sheets", () => {
    const sheets = [
      {
        name: "Buscas_Facultativos",
        rows: [
          ["SERVICIO", "PRINCIPAL"],
          ["ANESTESIA", "7321"],
          ["CARDIOLOGÍA", "7580"]
        ]
      },
      {
        name: "Buscas_Enfermería",
        rows: [
          ["SERVICIO", "PRINCIPAL", "RESIDENTE"],
          ["PLANTA 1", "8001", "8002"]
        ]
      }
    ];

    const result = parseBuscasSheets(sheets);

    expect(result.parsedCellCount).toBe(4);
    expect(result.records).toHaveLength(4);

    // Records from both sheets are present
    const sourceSheets = result.records.map((r) => r.sourceSheet);
    expect(sourceSheets).toContain("Buscas_Facultativos");
    expect(sourceSheets).toContain("Buscas_Enfermería");
  });

  it("returns empty result for an empty sheets array", () => {
    const result = parseBuscasSheets([]);

    expect(result.parsedCellCount).toBe(0);
    expect(result.records).toHaveLength(0);
    expect(result.skippedRowCount).toBe(0);
  });

  it("sums skippedRowCount across sheets", () => {
    const sheets = [
      {
        name: "Buscas_Celadores",
        rows: [
          ["SERVICIO", "PRINCIPAL"],
          ["CELADOR", "7183"],
          ["", ""]  // 1 skipped
        ]
      },
      {
        name: "Buscas_Varios",
        rows: [
          ["SERVICIO", "LOCALIZADOR"],
          ["RESERVA", ""],  // 1 skipped (no pager)
          ["PLANTA 3", "9003"]
        ]
      }
    ];

    const result = parseBuscasSheets(sheets);

    expect(result.skippedRowCount).toBe(2);
    expect(result.parsedCellCount).toBe(2);
  });

  it("records from all four production sheet names are parsed", () => {
    const sheetNames = [
      "Buscas_Facultativos",
      "Buscas_Enfermería",
      "Buscas_Celadores",
      "Buscas_Varios"
    ];

    const sheets = sheetNames.map((name) => ({
      name,
      rows: [
        ["SERVICIO", "PRINCIPAL"],
        [`Servicio ${name}`, "7000"]
      ]
    }));

    const result = parseBuscasSheets(sheets);

    expect(result.parsedCellCount).toBe(4);
    const sourceSheets = new Set(result.records.map((r) => r.sourceSheet));
    for (const name of sheetNames) {
      expect(sourceSheets.has(name)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Integration: interim-skip tests updated for OIR-130
// ---------------------------------------------------------------------------

describe("OIR-130: buscas sheets are parsed, not skipped", () => {
  it("parseBuscasSheets produces records matching real ODS fixture shape", () => {
    // Mirrors the real Buscas_Facultativos + Buscas_Celadores structure
    const result = parseBuscasSheets([
      {
        name: "Buscas_Facultativos",
        rows: [
          ["SERVICIO", "PRINCIPAL / RESIDENTE", "ADJUNTO 1", "COMENTARIOS"],
          ["ANESTESIA", "7321", "", ""],
          ["CARDIOLOGÍA", "7580", "7581", ""]
        ]
      },
      {
        name: "Buscas_Celadores",
        rows: [
          ["SERVICIO", "PRINCIPAL", "PRINCIPAL 2", "COMENTARIOS"],
          ["CELADOR CCEE (A+B)", "7183", "", ""],
          ["CELADOR QUIRÓFANO", "7585", "", ""]
        ]
      }
    ]);

    expect(result.parsedCellCount).toBe(5);
    expect(result.records).toHaveLength(5);

    // All records have required fields
    for (const rec of result.records) {
      expect(rec.deviceNumber).toBeTruthy();
      expect(rec.department).toBeTruthy();
      expect(rec.holderType).toBeTruthy();
      expect(rec.sourceSheet).toBeTruthy();
      expect(typeof rec.sourceRow).toBe("number");
    }

    // No contact-directory noise
    const names = result.records.map((r) => r.department);
    expect(names).not.toContain("Principal / Residente");
    expect(names).not.toContain("PRINCIPAL / RESIDENTE");
    expect(names).not.toContain("Comentarios");
  });
});
