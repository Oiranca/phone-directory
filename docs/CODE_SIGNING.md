# Code Signing

## Purpose

This project ships unsigned portable builds by default. To reduce SmartScreen and Gatekeeper warnings for USB-distributed releases, release builds should be code signed before distribution.

## Current repository support

- `package.json` now enables macOS hardened runtime and points electron-builder at the checked-in entitlement files in `build-resources/`
- Windows signing is expected to be provided by electron-builder when the appropriate certificate configuration or signing environment variables are present
- macOS notarization is expected to be handled by electron-builder when the required Apple credentials are present in the environment

## Windows

Recommended release path:

1. Use an EV code-signing certificate if immediate SmartScreen trust is required
2. If EV hardware-token signing is not practical, use Azure Trusted Signing or a standard code-signing certificate and accept SmartScreen reputation warm-up
3. Run the existing Windows packaging command from a signing-capable environment:

```bash
pnpm run build:dist:win
```

Common electron-builder signing inputs:

- `WIN_CSC_LINK`
- `WIN_CSC_KEY_PASSWORD`
- `CSC_LINK`
- `CSC_KEY_PASSWORD`
- `AZURE_TENANT_ID`
- `AZURE_CLIENT_ID`
- `AZURE_CLIENT_SECRET`

Notes:

- electron-builder signs Windows output automatically when valid signing configuration is available
- since June 2023, Microsoft recommends EV signing for warning-free distribution on fresh machines

## macOS

Recommended release path:

1. Import a `Developer ID Application` certificate into the macOS keychain, or provide it via `CSC_LINK` / `CSC_KEY_PASSWORD`
2. Provide one notarization credential set supported by electron-builder:
   - `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`
   - or `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`
   - or `APPLE_KEYCHAIN`, `APPLE_KEYCHAIN_PROFILE`
3. Run the existing macOS packaging command from a macOS machine:

```bash
pnpm run build:dist:mac
```

The checked-in entitlements enable the Electron requirements called out by the official notarization tooling:

- `com.apple.security.cs.allow-jit`
- `com.apple.security.cs.disable-library-validation`

## Verification checklist

- Windows: verify the packaged executable shows a valid signature in file properties and does not trigger SmartScreen on a fresh test machine
- macOS: run `codesign --verify --deep --strict <App>.app`
- macOS: run `spctl --assess --type execute <App>.app`
- macOS: confirm the notarized app launches on a clean machine without a Gatekeeper bypass flow

## Credential handling

- Never commit certificates, API keys, or passwords to the repository
- Store signing credentials in CI secrets or platform keychains only
- Keep local signing material outside the project directory
