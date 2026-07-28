/**
 * Integration tests for the full buscas (pager) data pipeline — OIR-270.
 *
 * Exercises the REAL code paths end-to-end (no mocking of the functions
 * under test) across the three stacked features that make up the buscas
 * pipeline:
 *
 *   (a) OIR-265 — a per-service Agenda-tabular sheet row with an inserted
 *       "Busca 1" / "Corporativo 1" column, parsed via
 *       normalizeTabularAgendaSheet and then converted into a real
 *       ContactRecord via buildImportPreviewFromRows (the same conversion
 *       AppDataService uses for every spreadsheet import).
 *   (b) OIR-266 — a dedicated "Buscas Todos"-style sheet with named
 *       "Busca 1"/"Busca 2" columns, parsed via parseBuscasSheets into
 *       ImportedBuscaRecords for the separate buscas.json store.
 *   (c) OIR-267 — a full reimport merge scenario through AppDataService
 *       (previewCsvImport + importCsvDataset, run twice against a real
 *       in-memory-built .xlsx workbook), asserting busca updates apply,
 *       an unrelated contact's busca is left untouched, and no busca-only
 *       difference is ever surfaced as a false conflict.
 *
 * No UI, no Electron shell beyond the minimal `electron.app.getPath` mock
 * AppDataService itself requires (mirrors app-data.service.test.ts).
 */

import nodeFs from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as XLSX from "xlsx";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeTabularAgendaSheet } from "./spreadsheet-parsers.js";
import type { SheetData, SheetProfile } from "./spreadsheet-parsers.js";
import { buildImportPreviewFromRows } from "./csv-import.service.js";
import { parseBuscasSheets } from "./spreadsheet-buscas-parser.js";
import { writeWorkbook } from "./test-support/xlsxWorkbook.js";
import type { EditableAppSettings } from "../../shared/types/contact.js";

// ---------------------------------------------------------------------------
// (a) OIR-265 — Agenda-tabular sheet row -> real ContactRecord.buscas +
//     corporativo-kind phone entry
// ---------------------------------------------------------------------------

describe("buscas pipeline — (a) Agenda-tabular row through the real import conversion (OIR-265)", () => {
  const AGENDA_HEADER_ROW_WITH_BUSCA_CORPORATIVO = [
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
    "Busca 1",
    "Corporativo 1",
    "Horario",
    "Confidencial",
    "Edificio",
    "Planta",
    "Sector",
    "Sección",
    "Comentarios"
  ];

  const makeSheet = (name: string, rows: string[][]): SheetData => ({
    name,
    slug: "test",
    rows
  });

  const makeAgendaProfile = (): SheetProfile => ({
    parser: "tabular",
    canonicalSlug: "agenda",
    department: "",
    area: undefined,
    rowsToSkip: 1,
    detectedFormat: "exportación cruda de agenda tabular",
    detectionConfidence: "high"
  });

  it("carries a synthetic 'Busca 1' + 'Corporativo 1' row all the way to a real ContactRecord.buscas entry and a corporativo-kind phone", async () => {
    const row = [
      "Ana Pérez", // Nombre
      "Enfermero/a", // Categoría
      "Urgencias", // Servicio
      "10001", "", "", "", "", "", "", // Número 1..7
      "1111", // Busca 1
      "656 12 34 56", // Corporativo 1
      "", "", "", "", "", "", "" // Horario..Comentarios
    ];

    const sheet = makeSheet("Urgencias", [AGENDA_HEADER_ROW_WITH_BUSCA_CORPORATIVO, row]);
    const rows = normalizeTabularAgendaSheet(sheet, makeAgendaProfile());
    expect(rows).toHaveLength(1);

    // Sanity check on the intermediate NormalizedImportRow shape (already
    // covered by spreadsheet-parsers.test.ts) before crossing into the real
    // ContactRecord conversion this test exists to prove.
    const rawBuscas = JSON.parse(rows[0]!.buscas!) as Array<{ number: string; label?: string }>;
    expect(rawBuscas).toEqual([{ number: "1111" }]);

    const { dataset } = await buildImportPreviewFromRows(rows, {
      sourceFilePath: "/tmp/synthetic-agenda.ods",
      fileName: "synthetic-agenda.ods",
      editorName: "Tester",
      detectedFormat: "exportación cruda de agenda tabular",
      detectionConfidence: "high"
    });

    expect(dataset.records).toHaveLength(1);
    const record = dataset.records[0]!;

    // The busca (pager) code lands on the contact's own `buscas` array.
    expect(record.buscas).toEqual([{ number: "1111" }]);

    // It must NEVER be duplicated into contactMethods.phones.
    expect(record.contactMethods.phones.some((phone) => phone.number === "1111")).toBe(false);

    // The corporate mobile number lands as a real phone entry with kind
    // "corporativo", correctly cleaned up (internal spaces stripped).
    const corporativoPhone = record.contactMethods.phones.find((phone) => phone.kind === "corporativo");
    expect(corporativoPhone).toBeDefined();
    expect(corporativoPhone?.number).toBe("656123456");
    expect(corporativoPhone?.label).toBe("Corporativo");
  });

  it("produces an empty ContactRecord.buscas array when the row's 'Busca 1'/'Corporativo 1' cells are blank", async () => {
    const row = [
      "Luis Gómez", // Nombre
      "Enfermero/a", // Categoría
      "Urgencias", // Servicio
      "10002", "", "", "", "", "", "", // Número 1..7
      "", // Busca 1 (empty)
      "", // Corporativo 1 (empty)
      "", "", "", "", "", "", "" // Horario..Comentarios
    ];

    const sheet = makeSheet("Urgencias", [AGENDA_HEADER_ROW_WITH_BUSCA_CORPORATIVO, row]);
    const rows = normalizeTabularAgendaSheet(sheet, makeAgendaProfile());

    const { dataset } = await buildImportPreviewFromRows(rows, {
      sourceFilePath: "/tmp/synthetic-agenda-2.ods",
      fileName: "synthetic-agenda-2.ods",
      editorName: "Tester",
      detectedFormat: "exportación cruda de agenda tabular",
      detectionConfidence: "high"
    });

    expect(dataset.records).toHaveLength(1);
    expect(dataset.records[0]!.buscas).toEqual([]);
    expect(dataset.records[0]!.contactMethods.phones.some((phone) => phone.kind === "corporativo")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// (b) OIR-266 — dedicated "Buscas Todos"-style sheet -> ImportedBuscaRecords
// ---------------------------------------------------------------------------

describe("buscas pipeline — (b) dedicated 'Buscas Todos' sheet through the real pager-sheet parser (OIR-266)", () => {
  it("parses a synthetic 'Buscas Todos' sheet into correct ImportedBuscaRecords, one per non-empty Busca cell", () => {
    const sheet = {
      name: "Buscas Todos",
      rows: [
        [
          "Nombre",
          "Categoría",
          "Servicio",
          "Busca 1",
          "Busca 2",
          "Número 1",
          "Corporativo",
          "Horario",
          "Confidencial",
          "Edificio",
          "Planta",
          "Sector",
          "Sección",
          "Comentarios"
        ],
        // Row with a department-only Busca (no named holder).
        ["", "Doctor/a", "Análisis Clínico", "5153", "", "", "", "", "", "", "", "", "", ""],
        // Row with a named holder carrying two pager codes.
        ["Marta Ruiz", "Celador/a", "Celador Calidad", "5801", "5695", "", "", "", "", "", "", "", "", "Turno de mañana"]
      ]
    };

    const result = parseBuscasSheets([sheet]);

    expect(result.parsedCellCount).toBe(3);
    expect(result.skippedRowCount).toBe(0);
    expect(result.records).toHaveLength(3);

    const [first, second, third] = result.records;

    expect(first).toMatchObject({
      deviceNumber: "5153",
      department: "Análisis Clínico",
      category: "Doctor/a",
      sourceSheet: "Buscas Todos",
      sourceRow: 0
    });
    expect(first!.name).toBeUndefined();

    expect(second).toMatchObject({
      deviceNumber: "5801",
      department: "Celador Calidad",
      category: "Celador/a",
      name: "Marta Ruiz",
      sourceSheet: "Buscas Todos",
      sourceRow: 1
    });

    expect(third).toMatchObject({
      deviceNumber: "5695",
      department: "Celador Calidad",
      name: "Marta Ruiz",
      sourceSheet: "Buscas Todos",
      sourceRow: 1
    });
  });
});

// ---------------------------------------------------------------------------
// (c) OIR-267 — full reimport merge scenario through AppDataService
// ---------------------------------------------------------------------------

const getPathMock = vi.fn();

vi.mock("electron", () => ({
  app: {
    getPath: getPathMock
  }
}));

XLSX.set_fs(nodeFs);

describe("buscas pipeline — (c) full-agenda reimport through AppDataService (OIR-267)", () => {
  let testRoot: string;

  const buildEditableSettings = (): EditableAppSettings => ({
    editorName: "Tester",
    dataFilePath: path.join(testRoot, "data", "contacts.json"),
    backupDirectoryPath: path.join(testRoot, "backups"),
    ui: {
      showInactiveByDefault: false,
      autoBackup: {
        enabled: false,
        trigger: "launch",
        intervalHours: 2,
        editCountThreshold: 10,
        retentionCount: 5
      }
    }
  });

  const AGENDA_HEADER_ROW_WITH_BUSCA = [
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
    "Busca 1",
    "Corporativo 1",
    "Horario",
    "Confidencial",
    "Edificio",
    "Planta",
    "Sector",
    "Sección",
    "Comentarios"
  ];

  /** Two-contact Agenda-tabular sheet: Ana carries `anaBusca`, Luis carries "2222" unchanged across imports. */
  const buildAgendaRows = (anaBusca: string) => [
    AGENDA_HEADER_ROW_WITH_BUSCA,
    [
      "Ana Pérez", "Enfermero/a", "Urgencias",
      "10001", "", "", "", "", "", "",
      anaBusca, "",
      "", "", "", "", "", "", ""
    ],
    [
      "Luis Gómez", "Enfermero/a", "Urgencias",
      "10002", "", "", "", "", "", "",
      "2222", "",
      "", "", "", "", "", "", ""
    ]
  ];

  beforeEach(async () => {
    testRoot = await fs.mkdtemp(path.join(os.tmpdir(), "phone-directory-buscas-pipeline-"));
    getPathMock.mockImplementation(() => testRoot);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(testRoot, { recursive: true, force: true });
    getPathMock.mockReset();
  });

  it("applies a real busca update, preserves an unrelated contact's unchanged busca, and never surfaces a busca-only difference as a conflict", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();
    await service.saveSettings(buildEditableSettings());

    // --- First import: Ana=1111, Luis=2222 --------------------------------
    const firstSourcePath = writeWorkbook(path.join(testRoot, "incoming"), "agenda-buscas-1.xlsx", [
      { name: "Urgencias", data: buildAgendaRows("1111") }
    ]);

    const firstResult = await service.importCsvDataset(firstSourcePath);
    expect(firstResult.createdCount).toBe(2);

    const anaFirst = firstResult.contacts.records.find((record) => record.displayName === "Ana Pérez")!;
    const luisFirst = firstResult.contacts.records.find((record) => record.displayName === "Luis Gómez")!;
    expect(anaFirst.buscas).toEqual([{ number: "1111" }]);
    expect(luisFirst.buscas).toEqual([{ number: "2222" }]);

    // --- Reimport: Ana's busca changes to 9999, Luis's row is unchanged ---
    const secondSourcePath = writeWorkbook(path.join(testRoot, "incoming"), "agenda-buscas-2.xlsx", [
      { name: "Urgencias", data: buildAgendaRows("9999") }
    ]);

    const preview = await service.previewCsvImport(secondSourcePath);

    // A busca-only difference must never be surfaced as a user-facing
    // conflict — Ana's row differs only in `buscas`.
    expect(preview.conflictCount).toBe(0);
    expect(preview.conflictedRecords).toEqual([]);
    // Ana's row is a real (busca) update; Luis's row is byte-for-byte
    // identical to what's already stored, so it must count as unchanged.
    expect(preview.updatedCount).toBe(1);
    expect(preview.unchangedCount).toBe(1);
    expect(preview.createdCount).toBe(0);

    const reimportResult = await service.importCsvDataset(secondSourcePath);
    expect(reimportResult.createdCount).toBe(0);
    expect(reimportResult.updatedCount).toBe(1);
    expect(reimportResult.conflictCount).toBe(0);

    const anaAfter = reimportResult.contacts.records.find((record) => record.id === anaFirst.id)!;
    const luisAfter = reimportResult.contacts.records.find((record) => record.id === luisFirst.id)!;

    // Ana's busca genuinely updated...
    expect(anaAfter.buscas).toEqual([{ number: "9999" }]);
    expect(anaAfter.audit.updatedAt).not.toBe(anaFirst.audit.updatedAt);

    // ...while Luis's busca (and audit trail) is left completely untouched.
    expect(luisAfter.buscas).toEqual([{ number: "2222" }]);
    expect(luisAfter.audit.updatedAt).toBe(luisFirst.audit.updatedAt);
  });

  it("preserves an existing busca (does not wipe it) when a later plain reimport row has no busca column data at all", async () => {
    const { AppDataService } = await import("./app-data.service.js");

    const service = new AppDataService();
    await service.ensureInitialFiles();
    await service.saveSettings(buildEditableSettings());

    const firstSourcePath = writeWorkbook(path.join(testRoot, "incoming"), "agenda-buscas-plain-1.xlsx", [
      { name: "Urgencias", data: buildAgendaRows("1111") }
    ]);
    const firstResult = await service.importCsvDataset(firstSourcePath);
    const anaFirst = firstResult.contacts.records.find((record) => record.displayName === "Ana Pérez")!;
    expect(anaFirst.buscas).toEqual([{ number: "1111" }]);

    // A routine plain-CSV reimport (canonical template columns only — no
    // "Busca 1" column at all) touching up an unrelated field (Notas) must
    // never be read as "the pager number was removed".
    const plainCsv = [
      "externalId,type,displayName,department,service,phone1Number,status,notes",
      `${anaFirst.externalId},person,Ana Pérez,,Urgencias,10001,active,Turno actualizado`
    ].join("\n") + "\n";
    const plainCsvPath = path.join(testRoot, "incoming", "agenda-buscas-plain-2.csv");
    await fs.writeFile(plainCsvPath, plainCsv, "utf-8");

    const preview = await service.previewCsvImport(plainCsvPath);
    expect(preview.conflictCount).toBe(1);
    const conflictedRecord = preview.conflictedRecords[0]!;
    // buscas must never appear as a diffable field on the conflict summary
    // even though the record genuinely still has one.
    expect(conflictedRecord.matchingRecord.buscas).toEqual([{ number: "1111" }]);

    // This case exercises the "merge-fields" ("Combinar") policy, which
    // carries the busca preserve-on-empty fallback via
    // mergeImportedRecordFields. Since PR #158, "overwrite" carries the
    // exact same preserve-on-empty fallback (see the `buscas:
    // importedRecord.buscas.length > 0 ? importedRecord.buscas :
    // currentRecord.buscas` guard in app-data.service.ts) — it does NOT
    // wipe buscas either. That path is covered directly below, and also has
    // a dedicated unit regression from PR #158.
    const mergeFieldsResult = await service.importCsvDataset(plainCsvPath, [
      { recordIndex: conflictedRecord.recordIndex, policy: "merge-fields" }
    ]);
    const anaAfterMergeFields = mergeFieldsResult.contacts.records.find(
      (record) => record.id === anaFirst.id
    )!;

    expect(anaAfterMergeFields.notes).toBe("Turno actualizado");
    // The pager number survives a merge-fields resolution from a parser
    // that has no buscas column at all.
    expect(anaAfterMergeFields.buscas).toEqual([{ number: "1111" }]);

    // A second, distinct plain-CSV reimport (still no "Busca" column) that
    // updates Notas again, this time resolved with "overwrite", to prove the
    // preserve-on-empty fallback also holds on that path (PR #158).
    const secondPlainCsv = [
      "externalId,type,displayName,department,service,phone1Number,status,notes",
      `${anaFirst.externalId},person,Ana Pérez,,Urgencias,10001,active,Turno actualizado de nuevo`
    ].join("\n") + "\n";
    const secondPlainCsvPath = path.join(testRoot, "incoming", "agenda-buscas-plain-3.csv");
    await fs.writeFile(secondPlainCsvPath, secondPlainCsv, "utf-8");

    const overwritePreview = await service.previewCsvImport(secondPlainCsvPath);
    expect(overwritePreview.conflictCount).toBe(1);
    const overwriteConflictedRecord = overwritePreview.conflictedRecords[0]!;

    const overwriteResult = await service.importCsvDataset(secondPlainCsvPath, [
      { recordIndex: overwriteConflictedRecord.recordIndex, policy: "overwrite" }
    ]);
    const anaAfterOverwrite = overwriteResult.contacts.records.find(
      (record) => record.id === anaFirst.id
    )!;

    expect(anaAfterOverwrite.notes).toBe("Turno actualizado de nuevo");
    // The pager number also survives an overwrite resolution from a parser
    // that has no buscas column at all — overwrite is NOT a data-loss path
    // for buscas since PR #158.
    expect(anaAfterOverwrite.buscas).toEqual([{ number: "1111" }]);
  });
});
