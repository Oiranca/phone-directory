import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import XLSX from "xlsx";
import { buildSpreadsheetImportPreview, normalizeWorkbookRowsFromFile } from "../dist-electron/main/services/spreadsheet-import.service.js";
import { combinedDataEnvelopeSchema, COMBINED_DATA_FORMAT, COMBINED_DATA_VERSION } from "../dist-electron/shared/schemas/combined-data.schema.js";
import { RECORD_TYPES, AREAS } from "../dist-electron/shared/constants/catalogs.js";
import { parseAndValidateJson } from "../dist-electron/main/services/json-data-reader.js";

XLSX.set_fs(fs);

const clean = (value) => String(value ?? "").trim().replace(/\s+/g, " ");
const fold = (value) => clean(value).normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase();
const digits = (value) => clean(value).replace(/\D/g, "");
const filled = (value) => clean(value).length > 0;
const isPagerNumber = (value) => /^\d[\d\s.\-]*$/.test(value) && value.length <= 20;
const locationColumnMap = {
  building: ["Edificio", "Centro", "building"],
  floor: ["Planta", "Nivel", "Piso", "floor"],
  sector: ["Sector", "Ubicación", "sector"],
  section: ["Sección", "section"],
  room: ["room"],
  text: ["locationText", "text"],
  center: ["center"]
};

const buildLocationObject = (rawRecord) => {
  const location = {};
  for (const [standardKey, possibleColumns] of Object.entries(locationColumnMap)) {
    for (const column of possibleColumns) {
      const value = rawRecord?.[column];
      if (value !== undefined && value !== null && clean(value)) {
        location[standardKey] = clean(value);
        break;
      }
    }
  }
  if (location.sector?.includes("/")) {
    const parts = location.sector.split("/").map(clean).filter(Boolean);
    if (parts[0]) location.building = parts[0];
    if (parts[1]) location.sector = parts[1];
    else delete location.sector;
    if (parts.length > 2) location.text = [location.text, parts.slice(2).join(" / ")].filter(Boolean).join(" / ");
  }
  return Object.keys(location).length ? location : undefined;
};

export const departmentKeywords = new Set([
  'unidad', 'consulta', 'quirofano', 'hospital', 'sala', 'almacen', 'admision', 'mostrador', 'urgencias', 'archivo', 'planta', 'habitacion', 'pasillo', 'bloque', 'sector', 'ccee', 'uci', 'umi', 'rea', 'urpa', 'centro', 'consultorio', 'laboratorio', 'despacho', 'recepcion', 'control', 'office', 'puerta', 'box', 'anexo', 'area', 'tanatorio', 'capilla', 'cafeteria', 'parking', 'helipuerto', 'cibercentro', 'auditorio', 'aula', 'biblioteca', 'banco', 'comedor', 'central', 'ascensor', 'ascensores', 'guagua', 'fax', 'registro', 'policia', 'juzgado', 'prision', 'clinica', 'instituto', 'bomba', 'caldera', 'camara', 'telefono', 'tv', 'televisores', 'monitor', 'monitores', 'taller', 'talleres', 'traslado', 'transporte', 'tarjeta', 'receta', 'aislados', 'analiticas', 'animalario', 'aparcamiento', 'avericum', 'capturas', 'crohn', 'despertar',
  'alergia', 'alergologia', 'anatomia', 'patologica', 'anestesia', 'reanimacion', 'cardiologia', 'cirugia', 'dermatologia', 'digestivo', 'endocrino', 'endocrinologia', 'ginecologia', 'obstetricia', 'tocologia', 'hematologia', 'hemoterapia', 'infecciosos', 'medicina', 'interna', 'intensiva', 'preventiva', 'microbiologia', 'parasitologia', 'nefrologia', 'neumologia', 'neurocirugia', 'neurologia', 'oftalmologia', 'oncologia', 'otorrino', 'otorrinolaringologia', 'pediatria', 'psiquiatria', 'radiologia', 'radiodiagnostico', 'rehabilitacion', 'reumatologia', 'traumatologia', 'ortopedica', 'urologia', 'vascular', 'angiologia', 'geriatria', 'maxilofacial', 'plastica', 'reparadora', 'toracica', 'paliativos', 'inmunologia', 'radiofisica', 'farmacogenetica',
  'ecografia', 'tac', 'scaner', 'resonancia', 'espirometria', 'holter', 'ergometria', 'endoscopia', 'colonoscopia', 'broncoscopia', 'mamografia', 'densitometria', 'biopsia', 'analitica', 'extraccion', 'extracciones', 'electro', 'electrocardiograma', 'electromiograma', 'ecmo', 'marcapasos', 'litotricia', 'audiometria', 'citologia', 'citoscopia', 'radioterapia', 'braquiterapia', 'fototerapia', 'ozonoterapia', 'quimioterapia', 'dialisis', 'puncion', 'cpre', 'fibroscan', 'fribroscan', 'paaf', 'paff', 'serologia', 'cultivo', 'antibiograma', 'urocultivo', 'coprocultivo', 'transfusion', 'sangria', 'defecografia', 'dacriocistografia', 'renograma', 'polisomnografia', 'hemodinamica', 'electrofisiologia', 'saf', 'cobas', 'sepca',
  'direccion', 'subdireccion', 'gerencia', 'secretaria', 'mantenimiento', 'hosteleria', 'lenceria', 'cocina', 'limpieza', 'recursos', 'humanos', 'rrhh', 'informatica', 'drago', 'prevencion', 'sindicato', 'farmacia', 'suministros', 'facturacion', 'calidad', 'docencia', 'investigacion', 'telecomunicaciones', 'electromedicina', 'roperia', 'seguridad', 'comite', 'asociacion', 'voluntariado', 'costura', 'lavanderia', 'esterilizacion', 'dietetica', 'estadistica', 'reprografia', 'logistica', 'nominas', 'compras', 'gestion', 'coordinacion', 'informacion', 'citas'
]);
export const roleKeywords = new Set([
  'doctor', 'doctora', 'dr', 'dra', 'facultativo', 'medico', 'especialista', 'residente', 'adjunto', 'mir', 'pir', 'eir', 'fea', 'cirujano', 'patologo',
  'enfermero', 'enfermera', 'due', 'ats', 'matron', 'matrona', 'auxiliar', 'tcae',
  'tecnico', 'tecnica', 'ingeniero', 'ingeniera', 'fisioterapeuta', 'psicologo', 'psicologa', 'dietista', 'nutricionista', 'foniatra', 'logopeda', 'perfusionista', 'farmaceutico', 'farmaceutica', 'fisico', 'biologo', 'optometrista',
  'celador', 'celadora', 'jefe', 'jefa', 'supervisor', 'supervisora', 'secretario', 'secretaria', 'trabajador', 'trabajadora', 'gobernante', 'gobernanta', 'limpiador', 'limpiadora', 'informatico', 'capellan', 'electricista', 'fontanero', 'mecanico', 'conductor', 'chofer', 'ilustrador', 'fotografo', 'periodista', 'administrativo', 'administrativa', 'coordinador', 'coordinadora', 'director', 'directora', 'subdirector', 'subdirectora', 'pinche', 'peluquero', 'peluquera', 'calefactor', 'frigorista', 'carpintero', 'delineante', 'gestor', 'gestora', 'inspector', 'inspectora'
]);
export const supervisionKeywords = new Set(['jefe', 'jefa', 'supervisor', 'supervisora', 'director', 'directora', 'subdirector', 'subdirectora', 'coordinador', 'coordinadora']);
const tagStopwords = new Set(["a", "al", "con", "de", "del", "el", "en", "la", "las", "los", "para", "por", "y"]);

export const normalizeString = (value) => String(value ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[(),.*–-]/g, " ").replace(/\s+/g, " ").trim();
const wordsFrom = (value) => normalizeString(value).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
const containsKeyword = (words, keywords) => words.some((word) => keywords.has(word));
const titlePrefix = /^(?:dña\.?|dna\.?|doña|dona|don|dra\.?|dr\.?|d\.?)\s+/i;
const hasSharedPersonName = (value) => wordsFrom(clean(value).replace(titlePrefix, "")).some((word) => ["e", "o", "y"].includes(word));
const directPersonTitles = new Set(["dr", "dra", "d", "dña", "dna", "don", "doña", "dona"]);

export const inferRecordType = (displayName, role, service) => {
  const normRole = normalizeString(role);
  const normName = normalizeString(displayName);
  const normService = normalizeString(service);
  const roleWords = wordsFrom(normRole);
  const nameWords = wordsFrom(normName);
  const serviceWords = wordsFrom(normService);

  if (normName === normService && normName !== "") return { type: "other", confidence: "high" };
  if (nameWords.slice(0, 2).some((word) => directPersonTitles.has(word))) return resolvePersonOrShared(normName);
  if (!role && displayName === displayName?.toUpperCase() && /[A-Z]/.test(displayName ?? "")) {
    return { type: "other", confidence: "high" };
  }

  const isPlausibleName = nameWords.length > 0 && nameWords.length <= 6 && !/\d/.test(displayName ?? "");
  if (!role && !isPlausibleName) return { type: "other", confidence: "high" };
  if (containsKeyword(roleWords, supervisionKeywords) || containsKeyword(nameWords.slice(0, 2), supervisionKeywords) || containsKeyword(serviceWords, supervisionKeywords)) {
    return { type: "supervision", confidence: "high" };
  }
  if (containsKeyword(nameWords, departmentKeywords)) {
    return { type: "other", confidence: "high" };
  }
  if (containsKeyword(roleWords, roleKeywords) || (!normRole && containsKeyword(nameWords.slice(0, 2), roleKeywords))) {
    return resolvePersonOrShared(normName);
  }
  if (isPlausibleName && normName !== normService) return resolvePersonOrShared(normName);
  if (containsKeyword(serviceWords, departmentKeywords)) return { type: "other", confidence: "high" };
  return { type: "other", confidence: "low", flag: "Ambigüedad manual requerida" };
};

const resolvePersonOrShared = (normName) => {
  const words = wordsFrom(normName);
  if (words.includes("y") || words.includes("e") || words.includes("o")) {
    return { type: "other", confidence: "high", flag: "shared-person-name" };
  }
  return { type: "person", confidence: "high" };
};

export const extractPersonName = (displayName) => {
  const name = clean(displayName);
  const stripped = name.replace(titlePrefix, "");
  if (hasSharedPersonName(name)) return undefined;
  const [firstName, ...lastName] = stripped.split(" ");
  if (!firstName) return undefined;
  if (stripped !== name && !lastName.length && containsKeyword(wordsFrom(stripped), departmentKeywords)) return undefined;
  if (stripped !== name && !lastName.length) return { lastName: firstName };
  return { firstName, ...(lastName.length ? { lastName: lastName.join(" ") } : {}) };
};

const inferArea = (service) => {
  const normalized = fold(service);
  const words = normalized.split(/[^a-z0-9]+/).filter(Boolean);
  if (words.some((word) => /^(suministr|distribucion)/.test(word))) return "otros";
  if (/(admision|secretari|citas|historia|archivo|informacion|factur|gestion|administracion|usuario|almacen|contratacion)/.test(normalized)) return "gestion-administracion";
  if (/(enfermer|hospitaliz|planta|urgencia|quirofan|critico|reanimacion|cuidados|hemodin|transplant|trasplant)/.test(normalized) || words.some((word) => word === "umi" || word === "uci")) return "sanitaria-asistencial";
  if (/(aferesis|alergia|dermatolog|endoscop|hematolog|radiolog|neurolog|oncolog|nefrolog|neumolog|especialidad|consulta)/.test(normalized)) return "especialidades";
  return undefined;
};

const tagsFrom = (value) => fold(value).split(/[^\p{L}\p{N}]+/u)
  .filter((word) => word.length > 1 && !tagStopwords.has(word));

const enrichRecord = (record, review, identityConfirmed) => {
  const existingPerson = record.person?.firstName || record.person?.lastName;
  const confirmedPerson = confirmedPersonLink(record);
  const inferred = inferRecordType(record.displayName, record.organization.role, record.organization.service);
  const classification = inferred.confidence === "low" && (existingPerson || confirmedPerson || (identityConfirmed && inferred.type === "person"))
    ? { type: "person", confidence: "high" }
    : inferred;
  const displayNameWithoutTitle = clean(record.displayName).replace(titlePrefix, "");
  if (classification.type === "other" && displayNameWithoutTitle !== record.displayName && containsKeyword(wordsFrom(displayNameWithoutTitle), departmentKeywords)) {
    record.displayName = displayNameWithoutTitle;
  }
  const sharedNameWords = wordsFrom(displayNameWithoutTitle);
  const plausibleSharedName = sharedNameWords.length > 0 && sharedNameWords.length <= 6 && !/\d/.test(record.displayName);
  const sharedName = plausibleSharedName && (inferred.flag === "shared-person-name" || (
    hasSharedPersonName(record.displayName) &&
    normalizeString(record.displayName) !== normalizeString(record.organization.service) &&
    !containsKeyword(sharedNameWords, departmentKeywords)
  )) && !existingPerson && !confirmedPerson;
  record.type = classification.type;
  if (classification.type === "person") {
    const person = extractPersonName(record.displayName) ?? (confirmedPerson ? { firstName: confirmedPerson.firstName } : undefined);
    record.person = {
      ...record.person,
      ...(record.person?.firstName || person?.firstName ? { firstName: record.person?.firstName ?? person?.firstName } : {}),
      ...(record.person?.lastName || person?.lastName ? { lastName: record.person?.lastName ?? person?.lastName } : {})
    };
  }
  if (sharedName) {
    review.push({ kind: "shared-person-name", displayName: record.displayName, role: record.organization.role, service: record.organization.service, flag: "Shared name requires manual review" });
  }
  if (classification.confidence === "low" && !sharedName) review.push({ kind: "ambiguous-record-type", displayName: record.displayName, role: record.organization.role, service: record.organization.service, flag: classification.flag });
  const inferredArea = inferArea(record.organization.service);
  record.organization.area = inferredArea ?? record.organization.area ?? "otros";
  const tags = new Map();
  for (const tag of [...record.tags, ...tagsFrom(record.organization.service || record.displayName)]) {
    if (filled(tag) && !tags.has(fold(tag))) tags.set(fold(tag), tag);
  }
  record.tags = [...tags.values()];
  for (const entry of record.contactMethods.phones) {
    if (entry.kind === "external" && /^[67]\d{8}$/.test(digits(entry.number))) delete entry.extension;
  }
};
const confirmedPersonLinks = [
  { firstName: "Rosa", service: "Asesoría Jurídica", extension: "70907", title: "SECRETARÍA ASESORÍA JURÍDICA" }
];
const confirmedPersonLink = (record) => confirmedPersonLinks.find((person) =>
  fold(record.displayName) === fold(person.firstName) &&
  fold(record.organization.service) === fold(person.service) &&
  record.contactMethods.phones.some((entry) => digits(entry.number) === person.extension)
);

const phone = (number, kind, label, extension, id) => ({
  id,
  number: clean(number),
  extension: filled(extension) ? clean(extension) : undefined,
  kind,
  label,
  isPrimary: false,
  confidential: false,
  noPatientSharing: false
});

const addPhone = (record, candidate) => {
  const existing = record.contactMethods.phones.find((entry) => digits(entry.number) === digits(candidate.number));
  if (existing) {
    if (!existing.extension && candidate.extension) existing.extension = candidate.extension;
    existing.confidential ||= candidate.confidential;
    existing.noPatientSharing ||= candidate.noPatientSharing;
    if (candidate.isPrimary) {
      for (const entry of record.contactMethods.phones) entry.isPrimary = entry === existing;
    }
    return;
  }
  if (candidate.isPrimary) {
    for (const entry of record.contactMethods.phones) entry.isPrimary = false;
  }
  record.contactMethods.phones.push(candidate);
};

const addBeeper = (record, number) => {
  const code = clean(number);
  if (code && !record.beepers.some((entry) => fold(entry.number) === fold(code))) {
    record.beepers.push({ number: code });
  }
};

const blankContact = (id, externalId, displayName, service, now) => ({
  id,
  externalId,
  type: "other",
  displayName,
  organization: { service: service || undefined },
  contactMethods: { phones: [], emails: [], socials: [] },
  beepers: [],
  aliases: [],
  tags: [],
  status: "active",
  source: { externalId },
  audit: { createdAt: now, updatedAt: now, createdBy: "Master import", updatedBy: "Master import" }
});

const readBeeperRows = (filePath) => {
  const workbook = XLSX.readFile(filePath);
  return workbook.SheetNames.filter((name) => /^Buscas /i.test(name)).flatMap((sheet) =>
    XLSX.utils.sheet_to_json(workbook.Sheets[sheet], { defval: "", raw: false })
      .map((raw, index) => ({
        source: path.basename(filePath), sheet, row: index + 2,
        name: clean(raw.Nombre), category: clean(raw["Categoría"]), service: clean(raw.Servicio),
        beepers: [clean(raw["Busca 1"]), clean(raw["Busca 2"])].filter((value) => value && isPagerNumber(value)),
        invalidBeepers: [clean(raw["Busca 1"]), clean(raw["Busca 2"])].filter((value) => value && !isPagerNumber(value)),
        extension: clean(raw.Extensión ?? raw["Número 1"]),
        corporate: clean(raw.Corporativo), schedule: clean(raw.Horario),
        confidential: fold(raw.Confidencial) === "si", comments: clean(raw.Comentarios)
      }))
      .filter((row) => row.service)
  );
};

const beeperKey = (row) => row.beepers.length
  ? [fold(row.service), ...row.beepers.map(fold).sort()].join("|")
  : [fold(row.service), fold(row.name), fold(row.category), digits(row.extension), digits(row.corporate)].join("|");
const compatible = (left, right) => {
  if (Boolean(left.name) !== Boolean(right.name) || fold(left.name) !== fold(right.name)) return false;
  return ["category", "schedule"].every((field) =>
    !left[field] || !right[field] || fold(left[field]) === fold(right[field])
  );
};

const mergeBeeperRows = (rows, review) => {
  const groups = new Map();
  for (const row of rows) {
    const key = beeperKey(row);
    const matches = groups.get(key) ?? [];
    const target = matches.find((candidate) => compatible(candidate, row));
    if (!target) {
      matches.push({ ...row, comments: row.comments ? [row.comments] : [], sources: [{ file: row.source, sheet: row.sheet, row: row.row }] });
      groups.set(key, matches);
      continue;
    }
    for (const field of ["name", "category", "schedule", "extension", "corporate"]) {
      if (!target[field]) target[field] = row[field];
      else if (row[field] && fold(target[field]) !== fold(row[field])) {
        review.push({ kind: "beeper-field", field, service: row.service, beepers: row.beepers, values: [target[field], row[field]], sources: [target.source, row.source], rows: [target.row, row.row] });
        if (["extension", "corporate"].includes(field)) target[`${field}Alternates`] = [...(target[`${field}Alternates`] ?? []), row[field]];
      }
    }
    if (row.comments && !target.comments.some((comment) => fold(comment) === fold(row.comments))) target.comments.push(row.comments);
    target.confidential ||= row.confidential;
    target.sources.push({ file: row.source, sheet: row.sheet, row: row.row });
  }
  return [...groups.values()].flat();
};

const matchUnique = (records, predicate) => {
  const matches = records.filter(predicate);
  return matches.length === 1 ? matches[0] : undefined;
};

export const buildUnifiedMaster = async (agendaPath, beeperPath, phonesPath) => {
  const now = new Date().toISOString();
  const [agenda, list, jsonText] = await Promise.all([
    buildSpreadsheetImportPreview(agendaPath, "Master import"),
    buildSpreadsheetImportPreview(beeperPath, "Master import"),
    fsPromises.readFile(phonesPath, "utf8")
  ]);
  const jsonRows = JSON.parse(jsonText);
  if (!Array.isArray(jsonRows) || jsonRows.some((row) => !row || typeof row !== "object" || Array.isArray(row))) {
    throw new Error("Phone source must be an array of objects.");
  }

  let records = structuredClone(agenda.dataset.records).filter((record) =>
    record.contactMethods.phones.length || record.beepers.length
  );
  for (const record of records) {
    const location = buildLocationObject(record.location);
    if (location) record.location = location;
    else delete record.location;
    const sourcePhones = record.contactMethods.phones;
    record.contactMethods.phones = [];
    for (const entry of sourcePhones) addPhone(record, entry);
    const person = confirmedPersonLink(record);
    if (person) record.person = { ...record.person, firstName: person.firstName };
  }
  const review = [];
  const sourceRows = normalizeWorkbookRowsFromFile(agendaPath).rows;
  let skippedAgendaRows = 0;
  for (const issue of agenda.preview.rowIssues) {
    const raw = sourceRows[issue.rowNumber - 2];
    if (!raw?.displayName || !issue.messages.every((message) => message.includes("Cada fila necesita al menos"))) {
      throw new Error(`Agenda row ${issue.rowNumber} needs manual correction before generating the master.`);
    }
    skippedAgendaRows += 1;
  }

  const agendaRecords = [...records];
  let matchedJson = 0;
  let separateSharedExtensionCount = 0;
  const conflictedLocationFields = new Map();
  const jsonOnlyRecords = new Map();
  const identityConfirmedRecords = new Set();
  const mergeLocation = (record, incomingLocation) => {
    if (!incomingLocation) return;
    const location = record.location ?? {};
    const conflicts = conflictedLocationFields.get(record.id) ?? new Set();
    for (const [field, incoming] of Object.entries(incomingLocation)) {
      if (!incoming || conflicts.has(field)) continue;
      const current = location[field];
      if (current && fold(current) !== fold(incoming)) {
        delete location[field];
        conflicts.add(field);
      } else if (!current) {
        location[field] = incoming;
      }
    }
    if (Object.keys(location).length) record.location = location;
    else delete record.location;
    conflictedLocationFields.set(record.id, conflicts);
  };
  for (const [index, row] of jsonRows.entries()) {
    const extension = clean(row["Ext."]);
    const fullNumber = clean(row["Número"]);
    const service = clean(row.Servicio);
    const title = clean(row.Titular);
    if (!extension && !fullNumber) continue;
    const candidates = agendaRecords.filter((record) => extension && record.contactMethods.phones.some((entry) =>
      digits(entry.number) === digits(extension) || digits(entry.extension) === digits(extension)
    ));
    const sourceLocation = buildLocationObject(row);
    const identityMatches = candidates.filter((record) => {
      if (service && fold(record.organization.service) !== fold(service)) return false;
      const person = confirmedPersonLink(record);
      return title && [record.displayName, record.organization.role, person?.title]
        .some((value) => value && fold(value) === fold(title));
    });
    const match = identityMatches.length === 1 ? identityMatches[0] : undefined;
    const addJsonPhones = (record) => {
      if (extension) {
        const primary = phone(extension, "internal", undefined, undefined, `ph_master_json_ext_${index + 1}`);
        primary.isPrimary = true;
        addPhone(record, primary);
      }
      if (fullNumber) addPhone(record, phone(fullNumber, "external", undefined, extension, `ph_master_json_${index + 1}`));
    };
    if (match) {
      matchedJson += 1;
      addJsonPhones(match);
      mergeLocation(match, sourceLocation);
      if (title && fold(match.displayName) === fold(title)) identityConfirmedRecords.add(match.id);
      const person = confirmedPersonLink(match);
      if (person && fold(person.title) === fold(title)) match.organization.role ??= title;
      continue;
    }
    if (candidates.length) separateSharedExtensionCount += 1;
    const jsonKey = [title, service, extension, fullNumber].map(fold).join("|");
    const prior = jsonOnlyRecords.get(jsonKey);
    if (prior) {
      mergeLocation(prior, sourceLocation);
      continue;
    }
    const record = blankContact(`cnt_master_json_${index + 1}`, `telefonos-json-${index + 1}`, title || service || `Teléfono ${index + 1}`, service, now);
    const location = buildLocationObject(row);
    if (location) record.location = location;
    record.source = { externalId: record.externalId, sheetSlug: "telefonos-json", sheetRow: String(index + 1) };
    addJsonPhones(record);
    records.push(record);
    jsonOnlyRecords.set(jsonKey, record);
  }

  const allBeeperRows = [...readBeeperRows(agendaPath), ...readBeeperRows(beeperPath)];
  for (const row of allBeeperRows) if (row.invalidBeepers.length) {
    review.push({ kind: "invalid-beeper-cell", source: row.source, sheet: row.sheet, row: row.row, values: row.invalidBeepers });
  }
  const beeperRows = mergeBeeperRows(allBeeperRows, review);
  const contactCandidates = [...records];
  let matchedBeeperContacts = 0;
  for (const [index, row] of beeperRows.entries()) {
    if (!row.beepers.length && !row.extension && !row.corporate) continue;
    const candidate = matchUnique(contactCandidates, (record) =>
      row.name && fold(record.displayName) === fold(row.name) &&
      fold(record.organization.service) === fold(row.service) &&
      row.beepers.some((code) => record.beepers.some((entry) => fold(entry.number) === fold(code)))
    );
    const metadataCompatible = candidate && [
      [candidate.organization.role, row.category],
      [candidate.organization.schedule, row.schedule]
    ].every(([left, right]) => !left || !right || fold(left) === fold(right));
    const match = metadataCompatible ? candidate : undefined;
    const record = match ?? blankContact(`cnt_master_beeper_${index + 1}`, `beeper-${index + 1}`, row.name || row.service, row.service, now);
    if (match) matchedBeeperContacts += 1;
    if (!match) records.push(record);
    if (row.name && fold(row.name) !== fold(record.displayName) && !record.aliases.some((alias) => fold(alias) === fold(row.name))) {
      record.aliases.push(row.name);
    }
    record.organization.role ??= row.category || undefined;
    record.organization.schedule ??= row.schedule || undefined;
    if (row.comments.length) record.notes = [...new Set([record.notes, ...row.comments].filter(Boolean))].join(" | ");
    for (const code of row.beepers) addBeeper(record, code);
    for (const number of [row.extension, ...(row.extensionAlternates ?? [])]) if (number) {
      const entry = phone(number, "internal", "Extensión", undefined, `ph_beeper_ext_${index}_${digits(number)}`);
      entry.confidential = row.confidential;
      addPhone(record, entry);
    }
    for (const number of [row.corporate, ...(row.corporateAlternates ?? [])]) if (number) {
      const entry = phone(number, "corporativo", "Corporativo", undefined, `ph_beeper_corp_${index}_${digits(number)}`);
      entry.confidential = row.confidential;
      addPhone(record, entry);
    }
  }

  for (const record of records) {
    const phones = record.contactMethods.phones;
    if (!phones.some((entry) => digits(entry.number).length >= 7)) continue;
    const primary = phones.find((entry) => digits(entry.number).length <= 6 && entry.isPrimary) ??
      phones.find((entry) => digits(entry.number).length <= 6);
    if (!primary) continue;
    for (const entry of phones) {
      entry.isPrimary = entry === primary;
      if (entry !== primary && digits(entry.number).length >= 7) {
        entry.kind = "external";
        entry.extension ||= primary.number;
      }
    }
    phones.splice(phones.indexOf(primary), 1);
    phones.unshift(primary);
  }

  for (const record of records) enrichRecord(record, review, identityConfirmedRecords.has(record.id));

  const importedBeepers = new Map();
  for (const source of [...agenda.beepersParseResult.records, ...list.beepersParseResult.records]) {
    const key = `${fold(source.department)}|${fold(source.deviceNumber)}`;
    const candidates = importedBeepers.get(key) ?? [];
    const current = candidates.find((candidate) => {
      if (!source.name || !candidate.name) {
        return !source.name && !candidate.name &&
          ["category", "service"].every((field) => !candidate[field] || !source[field] || fold(candidate[field]) === fold(source[field]));
      }
      return fold(candidate.name) === fold(source.name) && ["category", "service"].every((field) =>
        !candidate[field] || !source[field] || fold(candidate[field]) === fold(source[field])
      );
    });
    if (!current) {
      candidates.push({ ...source });
      importedBeepers.set(key, candidates);
    } else {
      for (const field of ["name", "category", "service"]) if (!current[field]) current[field] = source[field];
    }
  }
  const beeperRecords = [...importedBeepers.values()].flat().map((row, index) => ({ ...row, id: `ibsc_${(index + 1).toString(16).padStart(8, "0")}` }));
  const typeCounts = Object.fromEntries(RECORD_TYPES.map((type) => [type, records.filter((record) => record.type === type).length]));
  const areaCounts = Object.fromEntries(AREAS.map((area) => [area, records.filter((record) => record.organization.area === area).length]));
  const envelope = combinedDataEnvelopeSchema.parse({
    format: COMBINED_DATA_FORMAT,
    version: COMBINED_DATA_VERSION,
    exportedAt: now,
    contacts: {
      ...agenda.dataset,
      exportedAt: now,
      metadata: {
        ...agenda.dataset.metadata,
        recordCount: records.length,
        generatedFrom: "Agenda Normalizada.ods + Lista de buscas.ods + telefonos.json",
        generatedBy: "generate-unified-master.mjs",
        typeCounts, areaCounts
      },
      records
    },
    beepers: { version: "1.0.0", records: [], importedRecords: beeperRecords }
  });
  const summary = {
    agendaContacts: agenda.dataset.records.length,
    agendaRowsSkipped: skippedAgendaRows,
    jsonRows: jsonRows.length,
    jsonMatched: matchedJson,
    separateSharedExtensionCount,
    beeperSourceRows: allBeeperRows.length,
    beeperContacts: beeperRows.length,
    beeperContactsMatched: matchedBeeperContacts,
    contacts: records.length,
    catalogBeepers: beeperRecords.length,
    reviewItems: review.length
  };
  return { envelope, report: { summary, review } };
};

const runningDirectly = process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (runningDirectly) {
  const [agendaPath, beeperPath, phonesPath, outputPath] = process.argv.slice(2);
  if (!agendaPath || !beeperPath || !phonesPath || !outputPath) {
    console.error("Usage: node scripts/generate-unified-master.mjs <agenda.ods> <buscas.ods> <telefonos.json> <output.json>");
    process.exitCode = 2;
  } else {
    const { envelope, report } = await buildUnifiedMaster(agendaPath, beeperPath, phonesPath);
    const reportPath = outputPath.replace(/\.json$/i, "") + "-review.json";
    const outputText = JSON.stringify(envelope);
    parseAndValidateJson(outputText, "combined");
    const outputHandle = await fsPromises.open(outputPath, "wx", 0o600);
    try { await outputHandle.writeFile(outputText); } finally { await outputHandle.close(); }
    const reportHandle = await fsPromises.open(reportPath, "wx", 0o600);
    try { await reportHandle.writeFile(JSON.stringify(report, null, 2)); } finally { await reportHandle.close(); }
    console.log(JSON.stringify({ outputPath, reportPath, summary: report.summary }));
  }
}
