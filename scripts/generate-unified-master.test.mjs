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
    const header = ["Nombre", "Categoría", "Servicio", "Número 1", "Horario", "Confidencial", "Edificio", "Planta", "Sector", "Sección", "Comentarios", "Número 2"];
    const row = (name, service, number, floor = "", number2 = "") => [name, "", service, number, "", "", "", floor, "", "", "", number2];
    writeWorkbook(agendaPath, [["Agenda", [header, row("Desk A", "Service A", "12345"), row("Desk B", "Service B", "12345"), row("Desk C", "Service C", "55555", "4"), row("Desk E", "Service E", "77777"), row("No Phone", "Service F", ""), row("Rosa", "Asesoría Jurídica", "70907"), row("Desk H", "Service H", "928009000", "", "90000")]]]);
    writeWorkbook(beeperPath, [["Buscas Todos", [
      ["Nombre", "Categoría", "Servicio", "Busca 1", "Busca 2", "Extensión", "Corporativo", "Horario", "Confidencial", "Comentarios"],
      ["Pager D", "Nurse", "Service D", "7001", "", "66666", "699000001", "Morning", "", "Desk note"],
      ["Pager D", "Nurse", "Service D", "7001", "", "66666", "699000001", "Morning", "", "Desk note"],
      ["Pager E", "Nurse", "Service D", "7001", "", "66666", "699000002", "Morning", "", "Another holder"]
    ]]]);
    await fs.writeFile(phonesPath, JSON.stringify([
      { "Número": 928000001, "Ext.": 55555, Servicio: "Service C", Centro: "Center C", Titular: "Desk C", "Ubicación": "North block", Nivel: "2" },
      { "Número": 928000002, "Ext.": 12345, Servicio: "Service A", Centro: "Center A", Titular: "Desk A", "Ubicación": "South block", Nivel: "3" },
      { "Número": 928000003, "Ext.": 77777, Servicio: "Service E", Centro: "Center E", Titular: "Subunit", "Ubicación": "South block", Nivel: "3" },
      { "Ext.": 88888, Servicio: "Service G", Titular: "Extension Only" },
      { "Número": 928000004, "Ext.": 12345, Servicio: "Service A", Titular: "Desk D" },
      { "Número": 928450155, "Ext.": 70907, Servicio: "Asesoría Jurídica", Titular: "SECRETARÍA ASESORÍA JURÍDICA" },
      { "Número": 928000005, "Ext.": 99999, Servicio: "Service I", Centro: "Center I", Nivel: "2", Titular: "Desk I" },
      { "Número": 928000005, "Ext.": 99999, Servicio: "Service I", Centro: "Center I", Nivel: "3", Titular: "Desk I" }
    ]));

    const { envelope, report } = await buildUnifiedMaster(agendaPath, beeperPath, phonesPath);
    assert.equal(parseAndValidateJson(JSON.stringify(envelope), "combined").kind, "combined");
    assert.equal(report.summary.jsonMatched, 3);
    assert.equal(report.summary.separateSharedExtensionCount, 2);
    assert.equal(report.summary.agendaRowsSkipped, 1);
    assert.equal(envelope.contacts.records.length, 12);
    assert.equal(envelope.contacts.records.some((record) => record.displayName === "No Phone"), false);
    const merged = envelope.contacts.records.find((record) => record.displayName === "Desk C");
    assert.equal(merged.location.center, "Center C");
    assert.equal(merged.location.floor, undefined);
    assert.equal(merged.location.text, "North block");
    assert.deepEqual(merged.contactMethods.phones.map((entry) => entry.number).sort(), ["55555", "928000001"]);
    assert.equal(merged.contactMethods.phones.find((entry) => entry.number === "55555").isPrimary, true);
    assert.equal(merged.contactMethods.phones.find((entry) => entry.number === "928000001").isPrimary, false);
    assert.equal(merged.contactMethods.phones.find((entry) => entry.number === "928000001").label, undefined);
    assert.equal(envelope.contacts.records.filter((record) => record.displayName === "Desk A").length, 1);
    assert.equal(envelope.contacts.records.filter((record) => record.displayName === "Desk D").length, 1);
    assert.equal(envelope.contacts.records.filter((record) => record.displayName === "Desk E" || record.displayName === "Subunit").length, 2);
    assert.deepEqual(envelope.contacts.records.find((record) => record.displayName === "Subunit").contactMethods.phones.map((entry) => entry.number), ["77777", "928000003"]);
    assert.deepEqual(envelope.contacts.records.find((record) => record.displayName === "Extension Only").contactMethods.phones.map((entry) => entry.number), ["88888"]);
    const deskI = envelope.contacts.records.filter((record) => record.displayName === "Desk I");
    assert.equal(deskI.length, 1);
    assert.equal(deskI[0].location.center, "Center I");
    assert.equal(deskI[0].location.floor, undefined);
    const rosa = envelope.contacts.records.find((record) => record.displayName === "Rosa");
    assert.equal(rosa.person.firstName, "Rosa");
    assert.equal(rosa.organization.role, "SECRETARÍA ASESORÍA JURÍDICA");
    assert.deepEqual(rosa.contactMethods.phones.map((entry) => entry.number), ["70907", "928450155"]);
    const deskH = envelope.contacts.records.find((record) => record.displayName === "Desk H");
    assert.equal(deskH.contactMethods.phones.find((entry) => entry.number === "90000").isPrimary, true);
    assert.equal(deskH.contactMethods.phones.find((entry) => entry.number === "928009000").isPrimary, false);
    assert.equal(deskH.contactMethods.phones[0].number, "90000");
    assert.equal(deskH.contactMethods.phones[1].kind, "external");
    assert.equal(deskH.contactMethods.phones[1].extension, "90000");
    const beeperContact = envelope.contacts.records.find((record) => record.displayName === "Pager D");
    assert.deepEqual(beeperContact.beepers.map((entry) => entry.number), ["7001"]);
    assert.deepEqual(beeperContact.contactMethods.phones.map((entry) => entry.number).sort(), ["66666", "699000001"]);
    assert.equal(envelope.contacts.records.filter((record) => record.displayName === "Pager D").length, 1);
    assert.deepEqual(envelope.contacts.records.find((record) => record.displayName === "Pager E").beepers.map((entry) => entry.number), ["7001"]);
    assert.equal(envelope.beepers.importedRecords.length, 2);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
