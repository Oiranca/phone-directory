# Dependency Audit — 2026-08-16

## Summary

The mandatory USB release audit found new high-severity advisories after the
previous validated release. Direct and transitive dependencies were moved to
patched versions. Upgrading Electron also removed the vulnerable `extract-zip`
dependency from the resolved graph. No new audit exception was added.

## Package Manager

- pnpm 10 with committed `pnpm-lock.yaml`
- Evidence: `package.json`, `pnpm-lock.yaml`, and `pnpm audit --json`

## Vulnerabilities

| Severity | Package | Affected version/range | Issue | Action |
| --- | --- | --- | --- | --- |
| High | electron | 40.9.2 | GHSA-9f4c-93c8-jc8g | Upgrade to 43.4.0 |
| High | brace-expansion | legacy 1.x/2.x and 5.0.8 | GHSA-rgw5-rvv9-x895 | Override to 1.1.18, 2.1.4, and 5.0.9 |
| High | fast-uri | 3.x before 3.1.5 | GHSA-7p8r-x3mc-p8w7 | Override to 3.1.5 |
| High | js-yaml | 4.x before 4.3.1 | GHSA-5p4m-2wfm-xmqj | Override to 4.3.1 |
| High | nanoid | 3.x before 3.3.18 | GHSA-2v37-7h3g-55p8 | Override to 3.3.18 |
| High | extract-zip | 2.0.1 through Electron 40 | GHSA-jmr9-qjv8-65gv | Removed from graph by Electron 43.4.0 |

## Outdated Packages

No broad outdated-package migration was attempted. Scope is limited to the
versions required to clear the release-blocking high-severity advisories.

## Recommendations

- Immediate: validate Electron 43 runtime, E2E, packaging, and Windows x64 output.
- Monitor: electron-builder parent chains for removal of legacy minimatch majors.

## Limitations

- Windows artifact is cross-built on macOS; packaged startup smoke must still be
  performed on the target Windows workstation.
- Raw `pnpm audit --audit-level=high --json` reports no remaining high or
  critical advisories after lockfile regeneration.
