import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildCsvImportPreview, buildImportPreviewFromRows } from "./csv-import.service.js";

describe("buildCsvImportPreview", () => {
  let testRoot: string;

  beforeEach(async () => {
    testRoot = await fs.mkdtemp(path.join(os.tmpdir(), "csv-import-test-"));
  });

  afterEach(async () => {
    await fs.rm(testRoot, { recursive: true, force: true });
  });

  const writeFile = async (name: string, content: string) => {
    const filePath = path.join(testRoot, name);
    await fs.writeFile(filePath, content, "utf-8");
    return filePath;
  };

  it("returns valid records for a minimal valid CSV", async () => {
    const filePath = await writeFile(
      "valid.csv",
      [
        "type,displayName,phone1Number",
        "person,Ana Pérez,12345",
        "service,Mostrador,55555"
      ].join("\n") + "\n"
    );

    const { preview, dataset } = await buildCsvImportPreview(filePath, "TestEditor");

    expect(preview.totalRowCount).toBe(2);
    expect(preview.validRowCount).toBe(2);
    expect(preview.invalidRowCount).toBe(0);
    expect(preview.rowIssues).toHaveLength(0);
    expect(dataset.records).toHaveLength(2);
    expect(dataset.records[0]?.displayName).toBe("Ana Pérez");
    expect(dataset.records[1]?.displayName).toBe("Mostrador");
  });

  it("throws when required column headers are missing", async () => {
    const filePath = await writeFile(
      "missing-cols.csv",
      ["displayName,phone1Number", "Ana Pérez,12345"].join("\n") + "\n"
    );

    await expect(buildCsvImportPreview(filePath, "TestEditor")).rejects.toThrow(
      "columnas obligatorias"
    );
  });

  it("throws when the header contains unsupported columns", async () => {
    const filePath = await writeFile(
      "unsupported-cols.csv",
      ["type,displayName,phone1Number,legacyDesk", "person,Ana Pérez,12345,Mostrador antiguo"].join("\n") + "\n"
    );

    await expect(buildCsvImportPreview(filePath, "TestEditor")).rejects.toThrow(
      "no pertenecen a la plantilla oficial"
    );
  });

  it("throws when the header repeats a column", async () => {
    const filePath = await writeFile(
      "duplicate-cols.csv",
      ["type,displayName,displayName,phone1Number", "person,Ana Pérez,Ana duplicada,12345"].join("\n") + "\n"
    );

    await expect(buildCsvImportPreview(filePath, "TestEditor")).rejects.toThrow(
      "repite columnas"
    );
  });

  it("throws when the header contains empty column names", async () => {
    const filePath = await writeFile(
      "empty-header.csv",
      ["type,displayName,,phone1Number", "person,Ana Pérez,,12345"].join("\n") + "\n"
    );

    await expect(buildCsvImportPreview(filePath, "TestEditor")).rejects.toThrow(
      "columnas vacías"
    );
  });

  // The row-count ceiling itself has been enforced since
  // MAX_CSV_IMPORT_ROWS was introduced, but had zero direct test coverage. This
  // confirms it triggers a clear "file too large" message right past the
  // threshold, and does NOT trigger exactly at the threshold.
  it("throws a clear 'file too large' message when the CSV exceeds the 5000-row cap", async () => {
    const header = "type,displayName,phone1Number";
    const rows = Array.from({ length: 5001 }, (_, i) => `person,Persona ${i},${10000 + i}`);
    const filePath = await writeFile("too-many-rows.csv", [header, ...rows].join("\n") + "\n");

    await expect(buildCsvImportPreview(filePath, "TestEditor")).rejects.toThrow(
      "El CSV supera el límite máximo de 5000 filas. Divide el archivo e importa en lotes."
    );
  }, 15000);

  it("accepts a CSV at exactly the 5000-row cap", async () => {
    const header = "type,displayName,phone1Number";
    const rows = Array.from({ length: 5000 }, (_, i) => `person,Persona ${i},${10000 + i}`);
    const filePath = await writeFile("at-cap-rows.csv", [header, ...rows].join("\n") + "\n");

    const { preview } = await buildCsvImportPreview(filePath, "TestEditor");
    expect(preview.totalRowCount).toBe(5000);
  }, 15000);

  it("skips row and adds issue when displayName is missing", async () => {
    const filePath = await writeFile(
      "no-displayname.csv",
      [
        "type,displayName,phone1Number",
        "person,,12345"
      ].join("\n") + "\n"
    );

    const { preview } = await buildCsvImportPreview(filePath, "TestEditor");

    expect(preview.validRowCount).toBe(0);
    expect(preview.invalidRowCount).toBe(1);
    expect(preview.rowIssues[0]?.messages).toContain("El nombre visible es obligatorio.");
  });

  it("skips row and adds issue when type is missing", async () => {
    const filePath = await writeFile(
      "no-type.csv",
      [
        "type,displayName,phone1Number",
        ",Ana Pérez,12345"
      ].join("\n") + "\n"
    );

    const { preview } = await buildCsvImportPreview(filePath, "TestEditor");

    expect(preview.validRowCount).toBe(0);
    expect(preview.invalidRowCount).toBe(1);
    expect(preview.rowIssues[0]?.messages).toContain("El tipo es obligatorio.");
  });

  it("skips row and adds issue when both phone and email are missing", async () => {
    const filePath = await writeFile(
      "no-contact.csv",
      [
        "type,displayName,department",
        "person,Ana Pérez,Admisión"
      ].join("\n") + "\n"
    );

    const { preview } = await buildCsvImportPreview(filePath, "TestEditor");

    expect(preview.validRowCount).toBe(0);
    expect(preview.invalidRowCount).toBe(1);
    expect(preview.rowIssues[0]?.messages).toContain(
      "Cada fila necesita al menos un teléfono, un correo, una red social o un dato de ubicación."
    );
  });

  it("normalizes unsupported phone kind to 'other' and emits warning", async () => {
    const filePath = await writeFile(
      "bad-kind.csv",
      [
        "type,displayName,phone1Number,phone1Kind",
        "service,Mostrador,55555,desk"
      ].join("\n") + "\n"
    );

    const { preview, dataset } = await buildCsvImportPreview(filePath, "TestEditor");

    expect(preview.validRowCount).toBe(1);
    expect(preview.warningCount).toBe(1);
    expect(preview.warnings[0]?.message).toContain("desk");
    expect(preview.warnings[0]?.message).toContain("other");
    expect(dataset.records[0]?.contactMethods.phones[0]?.kind).toBe("other");
  });

  it("emits a warning and omits area when area is invalid", async () => {
    const filePath = await writeFile(
      "bad-area.csv",
      [
        "type,displayName,phone1Number,area",
        "person,Ana Pérez,12345,desconocida"
      ].join("\n") + "\n"
    );

    const { preview, dataset } = await buildCsvImportPreview(filePath, "TestEditor");

    expect(preview.validRowCount).toBe(1);
    expect(preview.warningCount).toBe(1);
    expect(preview.warnings[0]?.message).toContain("desconocida");
    expect(dataset.records[0]?.organization.area).toBeUndefined();
  });

  it("deduplicates aliases and emits a warning", async () => {
    const filePath = await writeFile(
      "dup-aliases.csv",
      [
        "type,displayName,phone1Number,aliases",
        "person,Ana Pérez,12345,ana|ana|Ana"
      ].join("\n") + "\n"
    );

    const { preview, dataset } = await buildCsvImportPreview(filePath, "TestEditor");

    expect(preview.validRowCount).toBe(1);
    // Tightened: exactly 1 warning (the dedup warning for aliases).
    expect(preview.warningCount).toBe(1);
    const record = dataset.records[0];
    const lowerAliases = record?.aliases.map((a) => a.toLowerCase()) ?? [];
    const uniqueCount = new Set(lowerAliases).size;
    expect(uniqueCount).toBe(record?.aliases.length);
  });

  it("deduplicates tags and emits a warning", async () => {
    const filePath = await writeFile(
      "dup-tags.csv",
      [
        "type,displayName,phone1Number,tags",
        "service,Mostrador,55555,front|front|Front"
      ].join("\n") + "\n"
    );

    const { preview, dataset } = await buildCsvImportPreview(filePath, "TestEditor");

    expect(preview.validRowCount).toBe(1);
    // Tightened: exactly 1 warning (the dedup warning for tags).
    expect(preview.warningCount).toBe(1);
    const record = dataset.records[0];
    const lowerTags = record?.tags.map((t) => t.toLowerCase()) ?? [];
    const uniqueCount = new Set(lowerTags).size;
    expect(uniqueCount).toBe(record?.tags.length);
  });

  it("throws when the file exceeds the 5 MB size limit", async () => {
    const filePath = await writeFile("too-large.csv", "a".repeat(5 * 1024 * 1024 + 1));

    await expect(buildCsvImportPreview(filePath, "TestEditor")).rejects.toThrow(
      "5 MB"
    );
  });

  it("returns 0 records and no errors for a headers-only CSV", async () => {
    const filePath = await writeFile(
      "headers-only.csv",
      "type,displayName,phone1Number\n"
    );

    const { preview, dataset } = await buildCsvImportPreview(filePath, "TestEditor");

    expect(preview.totalRowCount).toBe(0);
    expect(preview.validRowCount).toBe(0);
    expect(preview.invalidRowCount).toBe(0);
    expect(preview.rowIssues).toHaveLength(0);
    expect(dataset.records).toHaveLength(0);
  });

  // Role/schedule/sector/section CSV columns (mirrors ODS Categoría/
  // Horario/Sector/Sección) map to organization.role/schedule and
  // location.sector/section.
  it("maps role/schedule/sector/section columns to organization/location fields", async () => {
    const filePath = await writeFile(
      "custom-fields.csv",
      [
        "type,displayName,phone1Number,role,schedule,building,floor,sector,section",
        "service,Alergia,79196,Doctora/or,8:00-22:00,Hospital Polivalente,4,Enfermería,Consulta"
      ].join("\n") + "\n"
    );

    const { dataset } = await buildCsvImportPreview(filePath, "TestEditor");

    expect(dataset.records).toHaveLength(1);
    const record = dataset.records[0]!;
    expect(record.organization.role).toBe("Doctora/or");
    expect(record.organization.schedule).toBe("8:00-22:00");
    expect(record.location?.building).toBe("Hospital Polivalente");
    expect(record.location?.floor).toBe("4");
    expect(record.location?.sector).toBe("Enfermería");
    expect(record.location?.section).toBe("Consulta");
  });

  it("accepts a CSV without role/schedule/sector/section columns (backward compatible)", async () => {
    const filePath = await writeFile(
      "backward-compat.csv",
      ["type,displayName,phone1Number", "service,Mostrador,55555"].join("\n") + "\n"
    );

    const { preview, dataset } = await buildCsvImportPreview(filePath, "TestEditor");

    expect(preview.validRowCount).toBe(1);
    expect(dataset.records[0]?.organization.role).toBeUndefined();
    expect(dataset.records[0]?.organization.schedule).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// "Principal" must never be auto-assigned to the first phone
// ---------------------------------------------------------------------------
//
// buildPhones() has two branches: the `phones` JSON branch (used by the
// spreadsheet/Agenda import path) and the flat phone1/phone2 branch (used by
// the plain CSV template). Both funnel through ensureSinglePrimary(), which
// used to force index 0 to isPrimary=true whenever nothing was explicitly
// marked primary. These tests lock in that neither branch invents a primary
// phone anymore.
describe("buildImportPreviewFromRows — isPrimary is never auto-assigned", () => {
  let isPrimaryTestRoot: string;

  beforeEach(async () => {
    isPrimaryTestRoot = await fs.mkdtemp(path.join(os.tmpdir(), "csv-import-isprimary-test-"));
  });

  afterEach(async () => {
    await fs.rm(isPrimaryTestRoot, { recursive: true, force: true });
  });

  const writeIsPrimaryTestFile = async (name: string, content: string) => {
    const filePath = path.join(isPrimaryTestRoot, name);
    await fs.writeFile(filePath, content, "utf-8");
    return filePath;
  };

  it("respects isPrimary=false on every entry in the `phones` JSON branch (Agenda/spreadsheet path)", async () => {
    const row = {
      type: "service",
      displayName: "Admisión Central",
      phones: JSON.stringify([
        { number: "79649", label: "Número 1", kind: "internal", isPrimary: false, confidential: false, noPatientSharing: false },
        { number: "79650", label: "Número 2", kind: "internal", isPrimary: false, confidential: false, noPatientSharing: false }
      ])
    };

    const { dataset } = await buildImportPreviewFromRows([row], {
      sourceFilePath: "/tmp/test.csv",
      fileName: "test.csv",
      editorName: "TestEditor"
    });

    const phones = dataset.records[0]!.contactMethods.phones;
    expect(phones).toHaveLength(2);
    expect(phones.every((p) => p.isPrimary === false)).toBe(true);
  });

  it("does not force phone1 to be primary on the flat CSV column path when phone1IsPrimary is absent", async () => {
    const filePath = await writeIsPrimaryTestFile(
      "no-isprimary-column.csv",
      ["type,displayName,phone1Number", "service,Mostrador,55555"].join("\n") + "\n"
    );

    const { dataset } = await buildCsvImportPreview(filePath, "TestEditor");

    expect(dataset.records[0]?.contactMethods.phones[0]?.isPrimary).toBe(false);
  });

  it("collapses to a single primary when the `phones` JSON branch has more than one marked primary", async () => {
    const row = {
      type: "service",
      displayName: "Conflicto",
      phones: JSON.stringify([
        { number: "10001", label: "Número 1", kind: "internal", isPrimary: true, confidential: false, noPatientSharing: false },
        { number: "10002", label: "Número 2", kind: "internal", isPrimary: true, confidential: false, noPatientSharing: false }
      ])
    };

    const { dataset, preview } = await buildImportPreviewFromRows([row], {
      sourceFilePath: "/tmp/test.csv",
      fileName: "test.csv",
      editorName: "TestEditor"
    });

    const phones = dataset.records[0]!.contactMethods.phones;
    expect(phones[0]!.isPrimary).toBe(true);
    expect(phones[1]!.isPrimary).toBe(false);
    expect(preview.warningCount).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// PR #156 review fix — record.buscas silently dropped by the real import
// pipeline (OIR-265).
//
// normalizeTabularAgendaSheet (spreadsheet-parsers.ts) sets
// `record.buscas = JSON.stringify(buscaEntries)` on the NormalizedImportRow,
// but buildImportPreviewFromRows never read that field back out into the
// ContactRecord it constructs — buscas were parsed correctly and then
// silently dropped at actual import time, even though the lower-level
// normalizeTabularAgendaSheet unit tests were green. These tests exercise
// the REAL end-to-end pipeline (buildImportPreviewFromRows), not just the
// row-normalization step, so they would have caught the regression.
// ---------------------------------------------------------------------------
describe("buildImportPreviewFromRows — buscas flow through to the ContactRecord", () => {
  it("parses the row's `buscas` JSON field into ContactRecord.buscas (end-to-end import path)", async () => {
    const row = {
      type: "service",
      displayName: "Consulta 3",
      phone1Number: "55555",
      buscas: JSON.stringify([{ number: "1234", label: "Busca 1" }])
    };

    const { dataset } = await buildImportPreviewFromRows([row], {
      sourceFilePath: "/tmp/test.csv",
      fileName: "test.csv",
      editorName: "TestEditor"
    });

    expect(dataset.records).toHaveLength(1);
    expect(dataset.records[0]!.buscas).toEqual([{ number: "1234", label: "Busca 1" }]);
  });

  it("supports multiple busca entries and an entry without a label", async () => {
    const row = {
      type: "service",
      displayName: "Consulta 4",
      phone1Number: "55556",
      buscas: JSON.stringify([
        { number: "1111", label: "Busca 1" },
        { number: "2222" }
      ])
    };

    const { dataset } = await buildImportPreviewFromRows([row], {
      sourceFilePath: "/tmp/test.csv",
      fileName: "test.csv",
      editorName: "TestEditor"
    });

    const buscas = dataset.records[0]!.buscas;
    expect(buscas).toHaveLength(2);
    expect(buscas[0]).toEqual({ number: "1111", label: "Busca 1" });
    expect(buscas[1]).toEqual({ number: "2222" });
  });

  it("resolves to an empty array when the row has no `buscas` field (plain CSV import path)", async () => {
    const row = {
      type: "service",
      displayName: "Consulta 5",
      phone1Number: "55557"
    };

    const { dataset } = await buildImportPreviewFromRows([row], {
      sourceFilePath: "/tmp/test.csv",
      fileName: "test.csv",
      editorName: "TestEditor"
    });

    expect(dataset.records[0]!.buscas).toEqual([]);
  });

  it("drops malformed busca entries at runtime instead of crashing the import, and warns", async () => {
    const row = {
      type: "service",
      displayName: "Consulta 6",
      phone1Number: "55558",
      // A crafted/corrupt row: one valid entry, one with a non-string `number`.
      buscas: JSON.stringify([{ number: "1234" }, { number: null }])
    };

    const { dataset, preview } = await buildImportPreviewFromRows([row], {
      sourceFilePath: "/tmp/test.csv",
      fileName: "test.csv",
      editorName: "TestEditor"
    });

    expect(dataset.records[0]!.buscas).toEqual([{ number: "1234" }]);
    expect(preview.warningCount).toBeGreaterThan(0);
  });
});
