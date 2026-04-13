# CSV Import Template

## Purpose

This document defines the MVP CSV contract for importing hospital directory data into the application.

The importer is designed for a **normalized CSV template**, not for arbitrary raw spreadsheet exports. If the original `.ods` file is visually structured or inconsistent, it should be cleaned into this template before import.

## File Rules

- Encoding: `UTF-8`
- Separator: comma `,`
- First row: header row required
- One row = one normalized record
- Boolean values: `true` or `false`
- Empty values are allowed for optional columns
- Multiple values in a single cell use pipe separator: `|`

Example:

- `tags`: `urgencias|admisión|mostrador`
- `aliases`: `adm urg|admisión urgencias`

## Required Columns

The following columns are required in the CSV file:

- `type`
- `displayName`

In addition, each row must contain at least one of the following after normalization:

- one valid phone number
- one valid email
- one non-empty location field

## Supported Columns

### Identity

- `externalId`
- `type`
- `displayName`

### Person Fields

- `firstName`
- `lastName`

### Classification

- `area`
- `department`
- `service`
- `specialty`

### Location

- `building`
- `floor`
- `room`
- `locationText`

### Phones

- `phone1Label`
- `phone1Number`
- `phone1Extension`
- `phone1Kind`
- `phone1IsPrimary`
- `phone1Confidential`
- `phone1NoPatientSharing`
- `phone1Notes`
- `phone2Label`
- `phone2Number`
- `phone2Extension`
- `phone2Kind`
- `phone2IsPrimary`
- `phone2Confidential`
- `phone2NoPatientSharing`
- `phone2Notes`

### Emails

- `email1`
- `email1Label`
- `email1IsPrimary`
- `email2`
- `email2Label`
- `email2IsPrimary`

### Other Fields

- `tags`
- `aliases`
- `notes`
- `status`

## Column Semantics

### `type`

Allowed values:

- `person`
- `service`
- `department`
- `control`
- `supervision`
- `room`
- `external-center`
- `other`

### `area`

Recommended MVP values:

- `sanitaria-asistencial`
- `gestion-administracion`
- `especialidades`
- `otros`

### `phoneXKind`

Recommended values:

- `internal`
- `external`
- `mobile`
- `fax`
- `other`

### `status`

Allowed values:

- `active`
- `inactive`

## Mapping Rules

### Base Record Mapping

- `externalId` -> `record.externalId`
- `type` -> `record.type`
- `displayName` -> `record.displayName`
- `firstName` + `lastName` -> `record.person`
- `area`, `department`, `service`, `specialty` -> `record.organization`
- `building`, `floor`, `room`, `locationText` -> `record.location`
- `tags` -> `record.tags`
- `aliases` -> `record.aliases`
- `notes` -> `record.notes`
- `status` -> `record.status`

### Split Rules

- `tags` uses `|`
- `aliases` uses `|`

### Phone Mapping

Each `phoneX*` group becomes one item in `record.contactMethods.phones` if `phoneXNumber` is present.

### Email Mapping

Each `emailX` becomes one item in `record.contactMethods.emails` if the value is present.

## Validation Rules

The importer should reject a row when:

- `type` is empty
- `displayName` is empty
- all phone, email, and location fields are empty

The importer should warn when:

- `area` is unknown
- `phone kind` is unknown
- more than one phone is marked as primary
- more than one email is marked as primary
- tags or aliases contain duplicate values

## Recommended Migration Workflow

1. Export or derive data from the source `.ods`
2. Clean and normalize the spreadsheet into this CSV template
3. Review values for `type`, `area`, `status`, and phone flags
4. Import the CSV into the application
5. Review the preview summary before confirming replacement

## Example CSV

See:

- [csv/contacts-import-template.csv](/Users/samuelromeroarbelo/Projects/phone-directory/csv/contacts-import-template.csv)
