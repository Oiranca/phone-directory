import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import XLSX from "xlsx";
import { it } from "vitest";
import { buildUnifiedMaster } from "./generate-unified-master.mjs";
import { parseAndValidateJson } from "../dist-electron/main/services/json-data-reader.js";

const writeWorkbook = (filePath, sheets) => {
  const workbook = XLSX.utils.book_new();
  for (const [name, rows] of sheets) XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), name);
  XLSX.writeFile(workbook, filePath);
};

it("master fills a confirmed match and keeps a shared-extension match separate", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hospiagenda-master-"));
  try {
    const agendaPath = path.join(root, "agenda.xlsx");
    const beeperPath = path.join(root, "buscas.xlsx");
    const phonesPath = path.join(root, "telefonos.json");
    const header = ["Nombre", "Categoría", "Servicio", "Número 1", "Horario", "Confidencial", "Edificio", "Planta", "Sector", "Sección", "Comentarios"];
    const row = (name, service, number) => [name, "", service, number, "", "", "", "", "", "", ""];
    writeWorkbook(agendaPath, [["Agenda", [header, row("Desk A", "Service A", "12345"), row("Desk B", "Service B", "12345"), row("Desk C", "Service C", "55555")]]]);
    writeWorkbook(beeperPath, [["Buscas Todos", [
      ["Nombre", "Categoría", "Servicio", "Busca 1", "Busca 2", "Extensión", "Corporativo", "Horario", "Confidencial", "Comentarios"],
      ["Pager D", "Nurse", "Service D", "7001", "", "66666", "699000001", "Morning", "", "Desk note"]
    ]]]);
    await fs.writeFile(phonesPath, JSON.stringify([
      { "Número": 928000001, "Ext.": 55555, Servicio: "Service C", Centro: "Center C", Titular: "Desk C", "Ubicación": "North block", Nivel: "2" },
      { "Número": 928000002, "Ext.": 12345, Servicio: "Service A", Centro: "Center A", Titular: "Desk A", "Ubicación": "South block", Nivel: "3" }
    ]));

    const { envelope, report } = await buildUnifiedMaster(agendaPath, beeperPath, phonesPath);
    assert.equal(parseAndValidateJson(JSON.stringify(envelope), "combined").kind, "combined");
    assert.equal(report.summary.jsonMatched, 1);
    assert.equal(report.review.filter((entry) => entry.kind === "json-identity").length, 1);
    assert.equal(envelope.contacts.records.length, 5);
    const merged = envelope.contacts.records.find((record) => record.displayName === "Desk C");
    assert.equal(merged.location.center, "Center C");
    assert.deepEqual(merged.contactMethods.phones.map((entry) => entry.number).sort(), ["55555", "928000001"]);
    assert.equal(merged.contactMethods.phones.find((entry) => entry.number === "928000001").label, undefined);
    assert.equal(envelope.contacts.records.filter((record) => record.displayName === "Desk A").length, 2);
    const beeperContact = envelope.contacts.records.find((record) => record.displayName === "Pager D");
    assert.deepEqual(beeperContact.beepers.map((entry) => entry.number), ["7001"]);
    assert.deepEqual(beeperContact.contactMethods.phones.map((entry) => entry.number).sort(), ["66666", "699000001"]);
    assert.equal(envelope.beepers.importedRecords.length, 1);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
