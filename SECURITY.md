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

The following advisories are **accepted as low-risk** for this deployment model:

#### 1. vitest (GHSA-5xrq-8626-4rwp — Critical)
- **Status**: Vitest `3.2.6` (vulnerable version `<4.1.0`)
- **Vulnerability**: Arbitrary file read/execution when Vitest UI server is listening
- **Mitigation**: 
  - Vitest UI is **not enabled** in this project (no `--ui` flag in scripts or CI)
  - Application never runs vitest in production
  - Upgrade to vitest `>=4.1.0` requires Node.js `>=22` (current: Node.js 20.11.1)
- **Risk Assessment**: Low — vulnerable surface not exposed
- **Remediation Path**: Upgrade Node.js to `>=22` when feasible, then upgrade vitest to `>=4.1.0`

#### 2. tmp (GHSA-ph9p-34f9-6g65 — High)
- **Status**: `tmp <0.2.6` (transitive dependency via `electron-builder > app-builder-lib > @malept/flatpak-bundler > tmp-promise > tmp`)
- **Vulnerability**: Path traversal via unsanitized prefix/postfix enabling directory escape
- **Mitigation**:
  - Flatpak bundler is **not used** in this deployment (Windows/macOS/Linux USB distribution)
  - Build toolchain runs in controlled CI/local dev environment only
  - No patch available in current electron-builder chain
- **Risk Assessment**: Low — flatpak packaging not part of release workflow
- **Remediation Path**: Monitor electron-builder for upstream fix

## Import Rate Limiting

To protect against resource exhaustion attacks, the following limits are enforced:

- **CSV Import**: Maximum 5,000 rows per file
- **Spreadsheet Import** (XLSX, ODS, XLS): Maximum 5,000 rows per file
- **File Size**: Maximum 5 MB per import file

Files exceeding these limits will be rejected with an error message instructing the user to split the file and import in batches.

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
