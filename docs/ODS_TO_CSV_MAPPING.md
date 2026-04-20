# ODS to CSV Mapping Guide

## Source File

This mapping guide is based on the current hospital directory workbook used during discovery and migration design.

## Goal

The purpose of this document is to convert the current `.ods` hospital directory into the normalized CSV template used by the MVP importer.

Reference template files:

- [CSV_IMPORT_TEMPLATE.md](./CSV_IMPORT_TEMPLATE.md)
- [csv/contacts-import-template.csv](./csv/contacts-import-template.csv)

## 1. Key Finding About the Source File

The source `.ods` is not a single clean table. It is a visual directory workbook with multiple sheet families:

- alphabetic sheets: `A` to `Z`
- thematic sheets: `Urgencias`, `Rayos`, `Quirófanos`, `Secretarías`, `Centros_de_salud`, etc.
- switchboard / internal search sheets: `Buscas_Facultativos`, `Buscas_Enfermería`, `Buscas_Celadores`, `Buscas_Varios`
- overview/index sheets

This means the migration should not try to preserve sheet structure. It should extract normalized records.

## 2. Recommended Migration Strategy

Use a two-step normalization approach:

1. Extract data from selected `.ods` sheets into working CSV files
2. Normalize those working files into the project import template

For the MVP, do **not** attempt a universal automatic import of all sheets at once. Instead, process the workbook by sheet family.

## 3. Sheet Families and Recommended Mapping

### 3.1 Alphabetic Sheets (`A` to `Z`)

Typical structure:

- first column: service or visible name
- following columns: phone numbers
- last column: comments

Examples:

- `A`
- `B`
- `C`
- `D`

Recommended mapping:

- `displayName` <- first column
- `type` <- default to `service`
- `phone1Number`, `phone2Number`, etc. <- numeric columns
- `notes` <- comments column
- `aliases` <- optional abbreviations manually added later
- `status` <- `active`

Recommended defaults:

- `area`: infer from sheet or leave empty for first-pass normalization
- `department`: leave empty unless clearly derivable
- `service`: use `displayName` or extracted service context where useful

Special note:

Comments such as `NO DAR A LA CALLE` should map to:

- `phoneXNoPatientSharing = true`

Comments such as `DESPACHO MÉDICO` or internal-only operational text should map to:

- `phoneXConfidential = true` when clearly sensitive
- otherwise remain in `phoneXNotes`

### 3.2 Thematic Service Sheets

Examples:

- `Urgencias`
- `Rayos`
- `Quirófanos`
- `Hospitales_de_día`
- `Admisión_Central`
- `Almacenes`
- `UMI`
- `Secretarías`

These sheets usually carry stronger contextual information than the alphabetic sheets.

Recommended mapping:

- `displayName` <- visible row title or service label
- `type` <- `service`, `control`, `room`, or `supervision` depending on row meaning
- `department` <- derive from sheet name when stable
- `service` <- row-level service label
- `area` <- infer from hospital function
- `building`, `floor`, `room`, `locationText` <- derive from headers and row labels
- `notes` <- comments and operational notes

Examples:

- `Supervisión Enfermería Urgencias` -> `type = supervision`
- `Puerta 4 – Médico` -> `type = control` or `other`, depending on final modeling rule
- `QX 1 - Oftalmología` -> `type = room`
- `Mostrador` entries -> usually `type = control` or `service`

### 3.3 Personnel-Oriented Sheets

Examples:

- `Trabajadores_Sociales`
- parts of `Telecomunicaciones`
- parts of `Secretarías`
- some named entries in alphabetic sheets

Recommended mapping:

- `type` <- `person`
- `displayName` <- full visible label
- `firstName`, `lastName` <- only when the person name is cleanly separable
- `department` / `service` <- infer from sheet section
- `phone1Number`, `phone2Number` <- office, corporate, or internal numbers
- `notes` <- role, schedule, or section notes

Important rule:

If the source text mixes role and person name, keep `displayName` intact for the MVP.

Example:

- `ANA (COORDINADORA)` should keep a stable `displayName`
- `firstName` and `lastName` may remain empty if parsing would be unreliable

### 3.4 Internal Search / Pager Sheets (`Buscas_*`)

Examples:

- `Buscas_Facultativos`
- `Buscas_Enfermería`
- `Buscas_Celadores`
- `Buscas_Varios`

These are usually not standard direct phone contacts. They represent internal short codes, beeper-style references, or role-based operational contacts.

Recommended mapping:

- `type` <- `person` or `other`, depending on row meaning
- `displayName` <- visible service/person label
- main numeric fields <- map as phones only if they are valid contact numbers in operational practice
- if the numbers are internal search/pager codes rather than phones, keep them in:
  - `notes`
  - or `aliases`
  - or a later custom field if added after MVP

MVP recommendation:

- do not force all `busca` values into phone fields
- if a value is clearly a usable internal contact number, map it as `phoneXNumber`
- if it is an operational code rather than a phone, store it in `notes`

This is an area where domain review is required before full automation.

### 3.5 External Centers

Primary example:

- `Centros_de_salud`

Typical structure:

- center heading with address
- multiple service rows below the same center
- long and short numbers

Recommended mapping:

- create one record per center service row
- `type` <- `external-center`
- `displayName` <- combine center name and service when needed
- `service` <- row-level service label such as `Inf.` or `Urgencias`
- `locationText` <- address
- `phone1Number` <- long number
- `phone2Number` <- short number if operationally useful
- `area` <- `otros`
- `notes` <- keep extra organizational context

Recommended displayName pattern:

- `Agaete - Información`
- `Agaete - Urgencias`
- `Agüimes - Información`

## 4. Recommended Initial Area Inference

For the MVP migration, use the following initial area heuristics:

- `gestion-administracion`
  - admissions
  - appointments
  - secretariats
  - records
  - information desks
  - billing
  - management
- `sanitaria-asistencial`
  - nursing controls
  - hospitalization floors
  - urgent care
  - operating rooms
  - UMI/critical units
  - direct care units
- `especialidades`
  - allergy
  - dermatology
  - hematology
  - radiology
  - neurology
  - specialty consultations
- `otros`
  - external centers
  - unions
  - maintenance
  - security
  - logistics
  - telecom

These values should be treated as a first-pass classification and manually corrected where needed.

## 5. Recommended Type Inference

Recommended default rules:

- named person with role -> `person`
- service desk, admissions, appointments, office -> `service`
- department-level organizational entry -> `department`
- nursing or operational control point -> `control`
- supervision entries -> `supervision`
- room, surgery room, consultation room, bed sector -> `room`
- health centers outside the hospital -> `external-center`
- unclear operational entries -> `other`

## 6. Sensitive Number Detection Rules

The source file contains explicit warning phrases that should be normalized into privacy flags.

Map these phrases to:

### `noPatientSharing = true`

Examples:

- `NO DAR A LA CALLE`
- `NO PASAR DESPACHO MÉDICO`
- `NO DAR EL NÚMERO LARGO A LA CALLE`

### `confidential = true`

Use when:

- the comment clearly indicates internal-only, physician office, or protected operational use
- the row refers to a private dispatch or restricted professional line

If the meaning is ambiguous, prefer:

- `confidential = false`
- keep the wording in `phoneXNotes`
- review manually later

## 7. Data Cleanup Rules Before Import

Before generating the final CSV template:

- remove pure index rows
- remove repeated visual separators
- remove header rows embedded in the middle of sheets
- split compound number strings where possible
- normalize spaces and punctuation
- preserve accents in names
- keep comments that affect privacy or routing

Rows that should be excluded:

- `ÍNDICE AGENDA`
- `ÍNDICE AGENDAHOSPITALARIA`
- pure section separators
- long free-text guidance blocks that are not contacts

## 8. Known Hard Cases

These structures will need manual or semi-manual review:

- rows that contain number ranges such as `70311 / 12-15`
- rows with mixed internal and external numbers
- `Buscas_*` sheets where numbers may be pager-style codes instead of phones
- sheets with multi-column visual layouts such as `Quirófanos` or `CCEE_5ª`
- rows where a service name and a person name are combined

## 9. Recommended Practical Extraction Order

To reduce risk, normalize in this order:

1. `Admisión_Central`
2. `Urgencias`
3. `Rayos`
4. `Secretarías`
5. `Hospitales_de_día`
6. `UMI`
7. `Centros_de_salud`
8. alphabetic sheets `A-Z`
9. `Buscas_*` sheets last

This order gives a useful MVP dataset early and postpones the noisiest sources.

## 10. Suggested Intermediate Workflow

Recommended workflow:

1. open the `.ods`
2. export one target sheet or family at a time to CSV
3. normalize that CSV into the project template
4. review sensitive phone flags
5. import into the app
6. correct remaining records through the app form

## 11. Suggested First Migration Scope

For the first usable MVP dataset, prioritize these sheets:

- `Admisión_Central`
- `Urgencias`
- `Rayos`
- `Secretarías`
- `Hospitales_de_día`
- `UMI`
- `Centros_de_salud`

This provides high operational value without forcing the full workbook migration on day one.
