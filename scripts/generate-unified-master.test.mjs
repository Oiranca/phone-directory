import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import XLSX from "xlsx";
import { it, vi } from "vitest";
import { buildUnifiedMaster, extractPersonName, inferRecordType, normalizeString } from "./generate-unified-master.mjs";
import { parseAndValidateJson } from "../dist-electron/main/services/json-data-reader.js";

const writeWorkbook = (filePath, sheets) => {
  const workbook = XLSX.utils.book_new();
  for (const [name, rows] of sheets) XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), name);
  XLSX.writeFile(workbook, filePath);
};

it("classifies punctuated roles and extracts clean person names", () => {
  assert.equal(normalizeString("  MÉDICO  "), "medico");
  assert.equal(normalizeString("Biopsias (Eco)"), "biopsias eco");
  assert.deepEqual(inferRecordType("Endoscopia", "Enfermero/a", "Servicio Endoscopia"), { type: "other", confidence: "high" });
  assert.deepEqual(inferRecordType("Dra. Alergia", "Enfermero/a", "Alergia"), { type: "person", confidence: "high" });
  assert.deepEqual(inferRecordType("Dr. Endoscopia", "", "Endoscopia"), { type: "person", confidence: "high" });
  assert.deepEqual(inferRecordType("Dra. Serrano", "", "Endoscopia"), { type: "person", confidence: "high" });
  assert.deepEqual(inferRecordType("Dra. Endoscopia", "", "Otro servicio"), { type: "person", confidence: "high" });
  assert.deepEqual(inferRecordType("Don José Pérez", "", "Medicina"), { type: "person", confidence: "high" });
  assert.deepEqual(inferRecordType("Doña Ana Pérez", "", "Medicina"), { type: "person", confidence: "high" });
  assert.deepEqual(inferRecordType("María López", "Supervisora/a", "Endoscopia"), { type: "supervision", confidence: "high" });
  assert.deepEqual(inferRecordType("MARTA", "", "Otro servicio"), { type: "other", confidence: "high" });
  assert.deepEqual(inferRecordType("TURNO 24H", "", "Otro servicio"), { type: "other", confidence: "high" });
  assert.deepEqual(inferRecordType("María López", "Rol sin catalogar", "Endoscopia"), { type: "person", confidence: "high" });
  assert.deepEqual(inferRecordType("María López", "Rol sin catalogar", "Servicio sin clasificar"), { type: "person", confidence: "high" });
  assert.deepEqual(inferRecordType("Ana Valle", "", "Bomba Colostomía Estomas"), { type: "person", confidence: "high" });
  assert.equal(inferRecordType("Javier", "", "Mantenimiento").type, "person");
  assert.equal(inferRecordType("Lucia Valencia Sola", "", "Anestesia").type, "person");
  assert.deepEqual(inferRecordType("Analíticas", "", "Analiticas"), { type: "other", confidence: "high" });
  assert.deepEqual(inferRecordType("Bomba Colostomía", "", "Bomba Colostomía"), { type: "other", confidence: "high" });
  for (const keyword of ["comedor", "central", "ascensor", "ascensores", "guagua", "fax", "gestion", "coordinacion", "registro", "policia", "juzgado", "prision", "clinica", "instituto", "bomba", "caldera", "camara", "telefono", "tv", "televisores", "monitor", "monitores", "taller", "talleres", "informacion", "citas", "traslado", "transporte", "tarjeta", "receta", "aislados", "analiticas", "animalario", "aparcamiento", "avericum", "capturas", "crohn", "despertar", "citoscopia", "fribroscan", "paff", "saf", "cobas", "sepca"]) {
    assert.equal(inferRecordType(keyword, "", "Otro servicio").type, "other", keyword);
  }
  for (const role of ["calefactor", "frigorista", "carpintero", "mecanico", "delineante", "gestor", "gestora", "inspector", "inspectora"]) {
    assert.equal(inferRecordType("Personal", role, "Otro servicio").type, "person", role);
  }
  for (const role of ["ingeniero", "ingeniera", "Ingeniero/a", "Ingeniera/o"]) {
    assert.equal(inferRecordType("Paloma", role, "Ingeniera").type, "person", role);
  }
  assert.deepEqual(inferRecordType("Saf", "", "Otro servicio"), { type: "other", confidence: "high" });
  assert.deepEqual(inferRecordType("Orlando", "Comunicaciones", "Jefe/a Comunicaciones"), { type: "supervision", confidence: "high" });
  assert.deepEqual(inferRecordType("Alexis, Francis, Javier y Cayetano", "", "Comunicaciones"), { type: "other", confidence: "high", flag: "shared-person-name" });
  assert.deepEqual(inferRecordType("Pilar e Isabel", "Enfermero/a", "COBAS"), { type: "other", confidence: "high", flag: "shared-person-name" });
  assert.deepEqual(inferRecordType("Joaquín o Samuel", "", "SEPCA"), { type: "other", confidence: "high", flag: "shared-person-name" });
  assert.deepEqual(inferRecordType("Hemostasia y Coagulación", "Doctor/a", "Hemostasia y Coagulación"), { type: "other", confidence: "high" });
  assert.deepEqual(inferRecordType("Dra. Ana García", "", "Dra. Ana García"), { type: "other", confidence: "high" });
  assert.deepEqual(extractPersonName("Dr Hurtado"), { lastName: "Hurtado" });
  assert.equal(extractPersonName("Dr. Endoscopia"), undefined);
  assert.deepEqual(extractPersonName("Dra. Serrano"), { lastName: "Serrano" });
  assert.deepEqual(extractPersonName("Dra. Ana García"), { firstName: "Ana", lastName: "García" });
  assert.deepEqual(extractPersonName("Dña. Ana María García"), { firstName: "Ana", lastName: "María García" });
  assert.deepEqual(extractPersonName("Don José Pérez"), { firstName: "José", lastName: "Pérez" });
  assert.deepEqual(extractPersonName("Doña Ana Pérez"), { firstName: "Ana", lastName: "Pérez" });
  assert.equal(extractPersonName("Pilar e Isabel"), undefined);
  assert.equal(extractPersonName("Joaquín o Samuel"), undefined);
  assert.deepEqual(inferRecordType("Turno 24h", "Rol sin catalogar", ""), { type: "other", confidence: "low", flag: "Ambigüedad manual requerida" });
});

it("reports ambiguous records without changing the master schema", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hospiagenda-master-ambiguity-"));
  try {
    const agendaPath = path.join(root, "agenda.xlsx");
    const beeperPath = path.join(root, "buscas.xlsx");
    const phonesPath = path.join(root, "telefonos.json");
    const header = ["Nombre", "Categoría", "Servicio", "Número 1", "Horario", "Confidencial", "Edificio", "Planta", "Sector", "Sección", "Comentarios", "Número 2"];
    writeWorkbook(agendaPath, [["Agenda", [header,
      ["Dra. Serrano", "", "Endoscopia", "70001", "", "", "", "", "", "", "", ""],
      ["Dr. Endoscopia", "", "Endoscopia", "70009", "", "", "", "", "", "", "", ""],
      ["Endoscopia", "Enfermero/a", "Endoscopia", "70002", "", "", "", "", "", "", "", ""],
      ["Dr. Alergia", "", "Alergia", "70006", "", "", "", "", "", "", "", ""],
      ["María López", "Supervisora/a", "Endoscopia", "70003", "", "", "", "", "", "", "", ""],
      ["Pilar e Isabel", "Enfermero/a", "", "70005", "", "", "", "", "", "", "", ""],
      ["Equipo Externo", "", "Equipo Externo", "70007", "", "", "", "", "", "", "", ""],
      ["Ana Valle", "", "Bomba Colostomía Estomas", "70008", "", "", "", "", "", "", "", ""],
      ["Turno 24h", "Rol sin catalogar", "", "70004", "", "", "", "", "", "", "", ""]
    ]]]);
    writeWorkbook(beeperPath, [["Buscas Todos", [["Nombre", "Categoría", "Servicio", "Busca 1"], ["Prueba", "", "Prueba", "9001"]]]]);
    await fs.writeFile(phonesPath, JSON.stringify([{ "Ext.": 70007, Servicio: "Equipo Externo", Titular: "Equipo Externo" }]));

    const { envelope, report } = await buildUnifiedMaster(agendaPath, beeperPath, phonesPath);
    assert.equal(parseAndValidateJson(JSON.stringify(envelope), "combined").kind, "combined");
    assert.equal(envelope.contacts.records.find((record) => record.displayName === "Dra. Serrano").type, "person");
    const doctorArea = envelope.contacts.records.find((record) => record.displayName === "Dr. Endoscopia");
    assert.equal(doctorArea.type, "person");
    assert.deepEqual(doctorArea.person, {});
    assert.equal(envelope.contacts.records.find((record) => record.displayName === "Endoscopia").type, "other");
    assert.equal(envelope.contacts.records.find((record) => record.displayName === "Dr. Alergia").type, "person");
    assert.equal(envelope.contacts.records.find((record) => record.displayName === "María López").type, "supervision");
    assert.equal(envelope.contacts.records.find((record) => record.displayName === "Equipo Externo").type, "other");
    assert.deepEqual(envelope.contacts.records.find((record) => record.displayName === "Ana Valle").person, { firstName: "Ana", lastName: "Valle" });
    const sharedName = envelope.contacts.records.find((record) => record.displayName === "Pilar e Isabel");
    assert.equal(sharedName.type, "other");
    assert.deepEqual(sharedName.person, {});
    assert.deepEqual(report.review.find((item) => item.kind === "shared-person-name"), {
      kind: "shared-person-name", displayName: "Pilar e Isabel", role: "Enfermero/a", service: undefined, flag: "Shared name requires manual review"
    });
    assert.equal(report.review.filter((item) => item.displayName === "Pilar e Isabel").length, 1);
    assert.equal(report.review.find((item) => item.displayName === "Pilar e Isabel").kind, "shared-person-name");
    assert.equal(envelope.contacts.records.find((record) => record.displayName === "Turno 24h").type, "other");
    assert.deepEqual(report.review.find((item) => item.kind === "ambiguous-record-type" && item.displayName === "Turno 24h"), {
      kind: "ambiguous-record-type", displayName: "Turno 24h", role: "Rol sin catalogar", service: undefined, flag: "Ambigüedad manual requerida"
    });
    assert.equal(report.review.some((item) => item.kind === "ambiguous-record-type" && item.displayName === "Equipo Externo"), false);
    assert.equal(report.review.some((item) => item.kind === "ambiguous-record-type" && item.displayName === "Ana Valle"), false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

it("preserves beeper-only contact details while cataloging the pager separately", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hospiagenda-master-beeper-only-"));
  try {
    const agendaPath = path.join(root, "agenda.xlsx");
    const beeperPath = path.join(root, "buscas.xlsx");
    const phonesPath = path.join(root, "telefonos.json");
    const header = ["Nombre", "Categoría", "Servicio", "Número 1", "Número 2", "Número 3", "Número 4", "Número 5", "Número 6", "Número 7", "Horario", "Confidencial", "Edificio", "Planta", "Sector", "Sección", "Comentarios", "Busca 1"];
    writeWorkbook(agendaPath, [["Agenda", [header,
      ["Sin teléfono ni busca", "", "Servicio", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""],
      ["Neurocirugia – Planta", "Doctor/a", "Neurocirugia – Planta", "", "", "", "", "", "", "", "Horario E2E", "", "", "", "", "", "Nota E2E", "7157"],
      ["Teléfono sin busca", "", "Servicio teléfono", "70010", "", "", "", "", "", "", "", "", "", "", "", "", "", ""]
    ]]]);
    writeWorkbook(beeperPath, [["Buscas Todos", [
      ["Nombre", "Categoría", "Servicio", "Busca 1"],
      ["Neurocirugia – Planta", "Doctor/a", "Neurocirugia – Planta", "7157"]
    ]]]);
    await fs.writeFile(phonesPath, "[]");

    const { envelope } = await buildUnifiedMaster(agendaPath, beeperPath, phonesPath);

    assert.equal(envelope.contacts.records.some((record) => record.displayName === "Sin teléfono ni busca"), false);
    const beeperContact = envelope.contacts.records.find((record) => record.displayName === "Neurocirugia – Planta");
    assert.deepEqual(beeperContact.contactMethods.phones, []);
    assert.deepEqual(beeperContact.beepers, [{ number: "7157" }]);
    assert.equal(beeperContact.organization.schedule, "Horario E2E");
    assert.equal(beeperContact.notes, "Nota E2E");
    assert.equal(envelope.contacts.records.some((record) => record.displayName === "Teléfono sin busca"), true);
    assert.equal(envelope.beepers.importedRecords.some((record) => record.name === "Teléfono sin busca"), false);
    assert.equal(envelope.beepers.importedRecords.some((record) =>
      record.deviceNumber === "7157" && record.department === "Neurocirugia – Planta"
    ), true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

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
    assert.equal(merged.location.building, "Center C");
    assert.equal(merged.location.sector, "North block");
    assert.equal(merged.location.floor, undefined);
    assert.equal(merged.location.center, undefined);
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
    assert.equal(deskI[0].location.building, "Center I");
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

it("master enriches identities, locations, phone extensions, areas, and tags", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hospiagenda-master-enrichment-"));
  try {
    const agendaPath = path.join(root, "agenda.xlsx");
    const beeperPath = path.join(root, "buscas.xlsx");
    const phonesPath = path.join(root, "telefonos.json");
    const header = ["Nombre", "Categoría", "Servicio", "Número 1", "Horario", "Confidencial", "Edificio", "Planta", "Sector", "Sección", "Comentarios", "Número 2"];
    const row = (name, category, service, number) => [name, category, service, number, "", "", "", "", "", "", "", ""];
    writeWorkbook(agendaPath, [["Agenda", [header,
      row("Dra. Serrano", "Doctora/or", "Endoscopia", "70001"),
      row("Ana Valle", "", "Bomba Colostomía Estomas", "70055"),
      row("Javier", "", "Mantenimiento", "70002"),
      row("Lucia Valencia Sola", "", "Anestesia", "70005"),
      row("Ángel Aranda", "", "Comunicaciones", "70006"),
      row("Alergia", "Enfermero/a", "Alergia", "70007"),
      row("Endoscopia", "Enfermero/a", "Endoscopia", "70003"),
      row("Secretaría Admisión", "Enfermero/a", "Admisión", "70004"),
      row("Urgencias", "Enfermero/a", "Urgencias", "70008"),
      row("Suministros", "Enfermero/a", "Suministros", "70009"),
      row("Contrataciones Suministros", "Enfermero/a", "Contrataciones Suministros", "70010"),
      row("Distribución Celadores", "Enfermero/a", "Distribución Celadores", "70011"),
      row("Contratación Administrativa", "Enfermero/a", "Contratación Administrativa", "70012"),
      row("Celador Quirófano", "Enfermero/a", "Celador Quirófano", "70013"),
      row("Celador Hemodinámica", "Enfermero/a", "Celador Hemodinámica", "70014"),
      row("Celador Transplante", "Enfermero/a", "Celador Transplante", "70015"),
      row("Celador Trasplante", "Enfermero/a", "Celador Trasplante", "70016")
    ]]]);
    writeWorkbook(beeperPath, [["Buscas Todos", [
      ["Nombre", "Categoría", "Servicio", "Busca 1"],
      ["Prueba", "", "Prueba", "9001"]
    ]]]);
    await fs.writeFile(phonesPath, JSON.stringify([
      { "Número": 618798671, "Ext.": 70055, Servicio: "Bomba Colostomía Estomas", Titular: "Ana Valle", "Ubicación": "BLOQUE NORTE / SECTOR A / CONTROL" }
    ]));

    const { envelope, report } = await buildUnifiedMaster(agendaPath, beeperPath, phonesPath);
    assert.equal(parseAndValidateJson(JSON.stringify(envelope), "combined").kind, "combined");

    const doctor = envelope.contacts.records.find((record) => record.displayName === "Dra. Serrano");
    assert.equal(doctor.displayName, "Dra. Serrano");
    assert.equal(doctor.type, "person");
    assert.equal(doctor.person.lastName, "Serrano");

    const ana = envelope.contacts.records.find((record) => record.displayName === "Ana Valle");
    assert.equal(ana.type, "person");
    assert.deepEqual(ana.person, { firstName: "Ana", lastName: "Valle" });
    assert.deepEqual(ana.location, { building: "BLOQUE NORTE", sector: "SECTOR A", text: "CONTROL" });
    assert.deepEqual(ana.tags, ["bomba", "colostomia", "estomas"]);
    assert.equal(ana.contactMethods.phones.find((entry) => entry.number === "618798671").extension, undefined);
    assert.equal(report.review.some((item) => item.kind === "ambiguous-record-type" && item.displayName === "Ana Valle"), false);

    const javier = envelope.contacts.records.find((record) => record.displayName === "Javier");
    assert.equal(javier.type, "person");
    assert.deepEqual(javier.person, { firstName: "Javier" });

    const lucia = envelope.contacts.records.find((record) => record.displayName === "Lucia Valencia Sola");
    assert.equal(lucia.type, "person");
    assert.deepEqual(lucia.person, { firstName: "Lucia", lastName: "Valencia Sola" });

    const angel = envelope.contacts.records.find((record) => record.displayName === "Ángel Aranda");
    assert.equal(angel.type, "person");
    assert.deepEqual(angel.person, { firstName: "Ángel", lastName: "Aranda" });

    const alergia = envelope.contacts.records.find((record) => record.displayName === "Alergia");
    assert.equal(alergia.type, "other");
    assert.equal(alergia.organization.role, "Enfermero/a");

    const endoscopia = envelope.contacts.records.find((record) => record.displayName === "Endoscopia");
    assert.equal(endoscopia.type, "other");
    assert.equal(endoscopia.organization.role, "Enfermero/a");
    assert.equal(endoscopia.organization.area, "especialidades");

    const secretaria = envelope.contacts.records.find((record) => record.displayName === "Secretaría Admisión");
    assert.equal(secretaria.type, "other");
    assert.equal(secretaria.organization.role, "Enfermero/a");
    assert.equal(secretaria.organization.area, "gestion-administracion");

    assert.deepEqual(envelope.contacts.metadata.areaCounts, {
      "sanitaria-asistencial": 5,
      "gestion-administracion": 2,
      especialidades: 3,
      otros: 8
    });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

it("maps ODS and JSON location columns without emitting empty location objects", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hospiagenda-master-location-map-"));
  try {
    const agendaPath = path.join(root, "agenda.xlsx");
    const beeperPath = path.join(root, "buscas.xlsx");
    const phonesPath = path.join(root, "telefonos.json");
    const header = ["Nombre", "Categoría", "Servicio", "Número 1", "Horario", "Confidencial", "Edificio", "Planta", "Sector", "Sección", "Comentarios", "Número 2"];
    writeWorkbook(agendaPath, [["Agenda", [header,
      ["ODS Location", "", "ODS Service", "70001", "", "", "Edificio ODS", "Planta 1", "Sector ODS", "Sección ODS", "", ""]
    ]]]);
    writeWorkbook(beeperPath, [["Buscas Todos", [["Nombre", "Categoría", "Servicio", "Busca 1"], ["Prueba", "", "Prueba", "9001"]]]]);
    await fs.writeFile(phonesPath, JSON.stringify([
      { "Ext.": 70002, Servicio: "JSON Service", Titular: "JSON Location", Centro: "Centro JSON", Nivel: "Nivel 3", "Ubicación": "BLOQUE NORTE / SECTOR A / CONTROL" },
      { "Ext.": 70003, Servicio: "JSON Alternate", Titular: "JSON Alternate Location", Edificio: "Edificio JSON", Piso: "Piso 2", Sector: "Sector JSON", "Sección": "Sección JSON" },
      { "Ext.": 70004, Servicio: "Empty Service", Titular: "No Location" }
    ]));

    const { envelope } = await buildUnifiedMaster(agendaPath, beeperPath, phonesPath);
    const ods = envelope.contacts.records.find((record) => record.displayName === "ODS Location");
    assert.deepEqual(ods.location, {
      building: "Edificio ODS", floor: "1", sector: "Sector ODS", section: "Sección ODS"
    });

    const json = envelope.contacts.records.find((record) => record.displayName === "JSON Location");
    assert.deepEqual(json.location, {
      building: "BLOQUE NORTE", floor: "Nivel 3", sector: "SECTOR A", text: "CONTROL"
    });

    const alternate = envelope.contacts.records.find((record) => record.displayName === "JSON Alternate Location");
    assert.deepEqual(alternate.location, {
      building: "Edificio JSON", floor: "Piso 2", sector: "Sector JSON", section: "Sección JSON"
    });

    const noLocation = envelope.contacts.records.find((record) => record.displayName === "No Location");
    assert.equal(noLocation.location, undefined);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

it("master enrichment preserves populated person fields", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hospiagenda-master-person-"));
  try {
    const agendaPath = path.join(root, "agenda.xlsx");
    const beeperPath = path.join(root, "buscas.xlsx");
    const phonesPath = path.join(root, "telefonos.json");
    const header = ["Nombre", "Categoría", "Servicio", "Número 1", "Horario", "Confidencial", "Edificio", "Planta", "Sector", "Sección", "Comentarios", "Número 2"];
    writeWorkbook(agendaPath, [["Agenda", [header, ["Ana Valle", "", "Bomba Colostomía Estomas", "70055", "", "", "", "", "", "", "", ""]]]]);
    writeWorkbook(beeperPath, [["Buscas Todos", [["Nombre", "Categoría", "Servicio", "Busca 1"], ["Prueba", "", "Prueba", "9001"]]]]);
    await fs.writeFile(phonesPath, "[]");

    vi.resetModules();
    vi.doMock("../dist-electron/main/services/spreadsheet-import.service.js", async (importOriginal) => {
      const actual = await importOriginal();
      return {
        ...actual,
        buildSpreadsheetImportPreview: async (...args) => {
          const preview = await actual.buildSpreadsheetImportPreview(...args);
          if (args[0] === agendaPath) preview.dataset.records[0].person = { firstName: "Ana María", lastName: "García" };
          return preview;
        }
      };
    });
    const { buildUnifiedMaster: buildWithPerson } = await import("./generate-unified-master.mjs");
    const { envelope } = await buildWithPerson(agendaPath, beeperPath, phonesPath);
    const ana = envelope.contacts.records.find((record) => record.displayName === "Ana Valle");
    assert.deepEqual(ana.person, { firstName: "Ana María", lastName: "García" });
  } finally {
    vi.doUnmock("../dist-electron/main/services/spreadsheet-import.service.js");
    vi.resetModules();
    await fs.rm(root, { recursive: true, force: true });
  }
});
