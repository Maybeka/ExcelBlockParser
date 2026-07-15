# Release Process

## Supported Artifacts

- macOS universal DMG: hardened runtime, Developer ID signing, Apple notarization.
- Windows x64 NSIS: SHA-256 Authenticode signing.
- Linux x64 AppImage: unsigned distribution artifact with published checksum.

## Required Release Secrets

The release workflow reads these GitHub repository secrets only on tag/manual
release builds:

| Platform | Secrets/environment |
| --- | --- |
| macOS signing | `CSC_LINK`, `CSC_KEY_PASSWORD` |
| macOS notarization | `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` or Apple API key credentials |
| Windows signing | `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD` |

`electron-builder` performs macOS notarization automatically when the Apple
credentials are present. Release builds must fail rather than be published as
unsigned on macOS or Windows.

## Release Checklist

1. Run `npm run test:main`, `npm run test:unit`, `npm test`, and `npm run test:native`.
2. Build unpacked packages with `npm run pack:dir` on each supported platform.
3. Tag the approved version as `vX.Y.Z` and start the Release workflow.
4. Install each generated artifact in a clean VM and run the example workflow.
5. Publish checksums and note supported/unsupported behavior from `docs/SUPPORT.md`.

The CI package smoke workflow deliberately disables signing. It validates a
clean-clone package layout; only the protected release workflow receives
signing/notarization credentials.
