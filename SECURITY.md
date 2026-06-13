# Security Policy

## Deployment Model

This application is designed for **local USB installation on shared workstations** within a controlled environment. It is not distributed over the internet and does not have a public release channel.

## Code Signing Status

### macOS
- **Hardened Runtime**: Enabled (`hardenedRuntime: true`)
- **Gatekeeper Assessment**: Disabled (`gatekeeperAssess: false`)
- **Entitlements**: Configured for local execution
- **Distribution**: No notarization required for USB deployment

### Windows
- **Code Signing**: None
- **SmartScreen**: Not applicable (local USB deployment)
- **Distribution**: Direct file copy to workstation

### Linux
- **Code Signing**: None
- **Distribution**: Direct file copy to workstation

## Known Security Advisories

### Patched Vulnerabilities

The following vulnerabilities have been addressed as of this release:

- **react-router / react-router-dom**: Upgraded to `>=6.30.4` (patches GHSA-2j2x-hqr9-3h42 — moderate severity open redirect vulnerability)
- **esbuild** (via vite): Upgraded to vite `>=6.4.3` which pulls esbuild `>=0.25.0` (patches GHSA-67mh-4wv8-2f99 — moderate severity CORS bypass during development)

### Accepted Risks

> **Source of truth:** The machine-readable allowlist of explicitly accepted advisory IDs is
> [`scripts/audit-allowlist.json`](scripts/audit-allowlist.json).
> The audit gate in `scripts/release-usb.sh` reads this file at release time and filters out
> allowlisted advisories before failing — any newly appearing high/critical advisory that is NOT
> in the allowlist will still abort the release.
> The entries below summarise each accepted risk; the allowlist JSON contains the full rationale.

The following advisories are **accepted as low-risk** for this deployment model:

#### 1. shell-quote (GHSA-w7jw-789q-3m8p — Critical, CVE-2026-9277)
- **Status**: `shell-quote <=1.8.3` (transitive via `concurrently > shell-quote`)
- **Vulnerability**: `quote()` does not escape newline characters in object `.op` values, enabling shell command injection when attacker-controlled object tokens are passed to `quote()`.
- **Mitigation**:
  - `concurrently` is a **dev-only tool** used to run renderer/electron watchers during local development — it is never bundled into the Electron application or executed at runtime.
  - `concurrently` uses `shell-quote` internally with fixed, developer-authored command strings. No attacker-influenced input reaches `quote()` in this project.
  - Deployment model: local USB install on a controlled workstation with no external network attack surface.
- **Risk Assessment**: Low — vulnerable code path not reachable in this project
- **Remediation Path**: Update `concurrently` when a version transitively pulling `shell-quote >=1.8.4` becomes available.

#### 2. tmp (GHSA-ph9p-34f9-6g65 — High, CVE-2026-44705)
- **Status**: `tmp <0.2.6` (transitive dependency via `electron-builder > app-builder-lib > @malept/flatpak-bundler > tmp-promise > tmp`)
- **Vulnerability**: Path traversal via unsanitized prefix/postfix enabling directory escape
- **Mitigation**:
  - Flatpak bundler is **not used** in this deployment (Windows/macOS/Linux USB distribution)
  - Build toolchain runs in controlled CI/local dev environment only
  - No patch available in current electron-builder chain
- **Risk Assessment**: Low — flatpak packaging not part of release workflow
- **Remediation Path**: Monitor electron-builder for upstream fix that updates tmp to >=0.2.6.

#### 3. esbuild (GHSA-gv7w-rqvm-qjhr — High)
- **Status**: `esbuild >=0.17.0 <0.28.1` (transitive via `vite > esbuild`)
- **Vulnerability**: Missing SHA-256 binary integrity verification in the **Deno module** (`lib/deno/mod.ts`) when `NPM_CONFIG_REGISTRY` is attacker-controlled, enabling arbitrary code execution.
- **Mitigation**:
  - This project uses esbuild via the **Node.js npm package** (through vite), not the Deno distribution. The vulnerable `lib/deno/mod.ts` code path is never executed.
  - The Node.js npm package includes `binaryIntegrityCheck()` and is not affected.
  - Upgrading esbuild directly would conflict with vite's peer dependency constraints.
- **Risk Assessment**: Low — vulnerable Deno module code path not used
- **Remediation Path**: Upgrade vite to a version that requires esbuild >=0.28.1 when available without breaking Node 20.11.1 compatibility.

## Import Rate Limiting

To protect against resource exhaustion attacks, the following limits are enforced:

- **CSV Import**: Maximum 5,000 rows per file
- **Spreadsheet Import** (XLSX, ODS, XLS): Maximum 5,000 rows per file
- **File Size**: Maximum 5 MB per import file

Files exceeding these limits will be rejected with an error message instructing the user to split the file and import in batches.

## Dependency Update Cadence

### Pre-Release Audit Gate

The USB release script (`scripts/release-usb.sh`) sources `scripts/lib/audit-gate.sh` and runs `pnpm audit --json` automatically before every build. The raw JSON output is filtered through `scripts/audit-allowlist.json`: advisories whose GHSA ID appears in the allowlist are accepted; any remaining high-severity or critical advisory that is **not** in the allowlist aborts the release with a non-zero exit code. Infrastructure errors (missing lockfile, registry unreachable, invalid output) also abort the release — the gate fails safe rather than fail-open. No USB artifact will be produced until the gate passes.

### Manual Update Cadence

Before each release:

1. **Review and update Electron** — check the [Electron releases page](https://releases.electronjs.org/) for security releases. Update `electron` in `package.json` and validate the build passes.
2. **Review critical dependencies** — check `react`, `react-router-dom`, `vite`, and any IPC/file-system utilities for known advisories.
3. **Run `pnpm audit`** — review all reported advisories. Resolve high-severity and critical findings before producing USB artifacts. For advisories that cannot be patched (e.g. transitive dependency with no upstream fix), document them in the **Accepted Risks** section above with a clear mitigation rationale.
4. **Document accepted risks** — any advisory explicitly accepted must be recorded in this file with severity, CVE/GHSA identifier, mitigation rationale, and remediation path.

### SKIP_AUDIT Override

The preferred way to handle a known advisory is to add it to `scripts/audit-allowlist.json` (see above). The gate will then pass without any bypass.

When the allowlist cannot be updated in time (e.g. an emergency release), the gate can be bypassed with `SKIP_AUDIT=1`. A non-empty `SKIP_AUDIT_REASON` is **required** — the release aborts if the reason is missing:

```bash
SKIP_AUDIT=1 \
  SKIP_AUDIT_REASON="GHSA-w7jw-789q-3m8p accepted per SECURITY.md §Accepted Risks" \
  pnpm run release:usb
```

The value must be exactly `1` — other values (`true`, `yes`, `2`, or empty string) are ignored and the gate remains active.

**Bypass status is recorded in `RELEASE_MANIFEST.txt`** inside the produced USB package, so every artifact is traceable:

```
Dependency audit: BYPASSED — reason: GHSA-w7jw-789q-3m8p accepted per SECURITY.md §Accepted Risks
```

A normal audited release records:

```
Dependency audit: PASSED (allowlist 3 entries)
```

**This override is for explicit, reviewed risk acceptance only.** Use it when:
- A known advisory is already documented and accepted in this file and adding it to the allowlist is not yet possible.
- An upstream fix is not yet available and the risk has been assessed as acceptable for this deployment model.

Do **not** use `SKIP_AUDIT=1` to suppress unknown or uninvestigated advisories. Any use of the override must be intentional and traceable.

## Future Distribution Recommendations

If this application is ever distributed publicly (via GitHub releases, app stores, or direct download):

1. **Enable Platform Code Signing**:
   - macOS: Obtain Apple Developer ID certificate, enable notarization (`notarize: true` in electron-builder config)
   - Windows: Obtain code signing certificate, configure `win.certificateFile` and `win.certificatePassword`
   - Linux: Configure GPG signing for `.deb`/`.rpm` packages if applicable

2. **Enable electron-builder Publish Configuration**:
   - Configure `publish` targets in `electron-builder.json5`
   - Enable automatic update channels
   - Implement release artifact checksums and signature verification

3. **Regular Dependency Audits**:
   - Run `pnpm audit` before every release
   - Address all critical and high severity vulnerabilities
   - Document accepted risks in this file

## Reporting a Vulnerability

If you discover a security vulnerability in this project, please contact the development team directly rather than opening a public issue.

**Contact**: jeseromeroarbelo@gmail.com
