#!/usr/bin/env node
/**
 * Regenerates the small, synthetic ODS fixture used by the "Confidencial flag
 * correctness against the tabular Agenda fixture" tests in
 * src/main/services/app-data.service.test.ts.
 *
 * IMPORTANT — this fixture is 100% synthetic test data. No real operator,
 * hospital, or patient data was used to build it. It exists only to
 * reproduce the 17-column tabular Agenda header/row shape (see
 * AGENDA_TABULAR_HEADER_MARKERS in src/main/services/spreadsheet-parsers.ts)
 * with one confidential and one non-confidential row, so the row-level
 * Confidencial-flag tests always run (in CI and on every machine) instead of
 * silently skipping when a real, operator-provided export isn't present
 * (OIR-255).
 *
 * The phone numbers below (1000 / 1001) are deliberately short,
 * internal-extension-shaped placeholder values — NOT real, routable Spanish
 * phone numbers — chosen only to satisfy extractNumbers' >=4-digit minimum
 * (see spreadsheet-normalize.ts) while being unambiguously non-real.
 *
 * Run with: node scripts/generate-agenda-confidencial-fixture.cjs
 */

const XLSX = require("xlsx");
const path = require("path");

const HEADER = [
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
  "Horario",
  "Confidencial",
  "Edificio",
  "Planta",
  "Sector",
  "Sección",
  "Comentarios"
];

// Synthetic placeholder numbers — internal-extension-shaped, not real phone
// numbers. See module comment above.
const NOT_CONFIDENTIAL_PHONE = "1000";
const CONFIDENTIAL_PHONE = "1001";

const ROWS = [
  HEADER,
  ["Admisión Central", "", "Admisión", NOT_CONFIDENTIAL_PHONE, "", "", "", "", "", "", "", "", "", "", "", "", ""],
  ["Admisión Central (Interno)", "", "Admisión", CONFIDENTIAL_PHONE, "", "", "", "", "", "", "", "Si", "", "", "", "", ""]
];

const sheet = XLSX.utils.aoa_to_sheet(ROWS);
const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(workbook, sheet, "Agenda");

const outputPath = path.join(__dirname, "..", "src", "main", "services", "__fixtures__", "agenda-confidencial.ods");
XLSX.writeFile(workbook, outputPath, { bookType: "ods" });

console.log(`Wrote synthetic fixture: ${outputPath}`);
