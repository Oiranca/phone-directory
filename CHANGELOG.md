# Changelog

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
