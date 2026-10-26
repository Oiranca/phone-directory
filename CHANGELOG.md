# Changelog

## [0.1.10] - 2026-10-26

### Changed

- Hide duplicate search and redirect its legacy route without running the finder.

## [0.1.9] - 2026-10-26

### Fixed

- Show confidential primary phone numbers on directory cards while preserving patient-sharing restrictions.

## [0.1.8] - 2026-10-26

### Changed

- Keep navigation labels visible and remove the collapse control.

## [0.1.7] - 2026-10-26

### Changed

- Remove the primary-contact copy action and use an icon-only edit link beside the detail title.

## [0.1.6] - 2026-10-26

### Changed

- Place “Nuevo registro” with “Configuración” at the bottom of the navigation rail.

## [0.1.5] - 2026-10-26

### Fixed

- Avoid repeating department labels as person-name subtitles in directory cards.

## [0.1.4] - 2026-10-26

### Fixed

- Hide phone extensions from the detail view while preserving imported extension data.

## [0.1.3] - 2026-10-24

### Fixed

- Classify hospital areas as `department`, union organizations as `other`, and named contacts as people when their service is an area.
- Exclude department and supervision labels from shared-person-name review flags.
- Split confirmed shared-extension names into individual person contacts with distinct import identities.
- Keep medical titles in person names and title-case visible contact and service names without changing known acronyms.

## [0.1.2] - 2026-10-22

### Fixed

- Classify plausible person names before using department services as a fallback.
- Preserve titles as evidence that a contact is a person, including names such as "Dr. Endoscopia".
- Add an isolated E2E path for importing and checking a provided master JSON file.

## [0.1.1] - 2026-10-22

### Fixed

- Preserve beeper-only contact details while keeping those records out of the phone directory.
