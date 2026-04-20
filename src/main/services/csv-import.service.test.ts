import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildCsvImportPreview } from "./csv-import.service.js";

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
      "columnas fuera de la plantilla MVP"
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
      "Cada fila necesita al menos un teléfono, un correo o un dato de ubicación."
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
    expect(preview.warningCount).toBeGreaterThanOrEqual(1);
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
    expect(preview.warningCount).toBeGreaterThanOrEqual(1);
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
});
