# Dependency Audit — 2026-09-15

## Summary

`pnpm audit --json` reports zero advisories after updating only the patched
dependencies required by the release audit. `scripts/audit-allowlist.json`
remains an empty array.

## Package Manager

- pnpm 10.33.0 with committed `pnpm-lock.yaml`.
- `pnpm install --frozen-lockfile` completed successfully.
- `pnpm audit --json` exited 0 with 0 critical, 0 high, 0 moderate, and 0 low
  advisories across 650 resolved dependencies.

## Vulnerabilities

| Severity | Package | Previous version | Resolved version | Issue | Action |
| --- | --- | --- | --- | --- |
| High | js-yaml | 4.3.1 | 4.3.2 | GHSA-2883-xcg3-v3hh | Existing override updated to 4.3.2 |
| Moderate | vitest | 4.1.9 | 4.1.11 | GHSA-82fw-gwwq-j7x9 | Direct development dependency updated |
| Moderate | @vitest/mocker | 4.1.9 | 4.1.11 | GHSA-82fw-gwwq-j7x9 | Updated through Vitest's lockfile graph |
| Low | joi | 18.2.3 | 18.2.5 | GHSA-6w3j-5fw6-r9vr | Transitive override added |
| Low | joi | 18.2.3 | 18.2.5 | GHSA-gg4h-3hg2-grpc | Transitive override added |

Resolved chains:

- `electron-builder@26.15.3 > app-builder-lib@26.15.3 > js-yaml@4.3.2`
- `vitest@4.1.11 > @vitest/mocker@4.1.11`
- `wait-on@9.1.0 > joi@18.2.5`

## Outdated Packages

Further upgrades were outside issue #443 and not attempted. Any upgrade
requires separate scoped work.

## Recommendations

- Immediate action complete: retain the patched `js-yaml`, Vitest, and Joi
  resolutions.
- Monitor only: the registry advisory feed; the current audit is clean.

## Limitations

- Results reflect the npm advisory registry at 2026-09-15 and the resolved
  lockfile graph, not future disclosures.
- The audit does not replace runtime, packaged-artifact, or Windows validation.
- No allowlist entry or audit bypass was introduced; `run_audit_gate` passed
  with `allowlist 0 entries`.
