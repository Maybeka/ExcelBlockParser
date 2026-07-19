# Release Process

## Supported Artifacts

The v1 production artifact is a Wails Windows x64 package. The current tag
workflow produces an unsigned ZIP candidate with a SHA-256 sidecar; an
installer is not a release artifact until it has been selected and accepted.

Electron packages are development-only artifacts and are not v1 releases.

## Required Release Secrets

The release workflow reads these GitHub repository secrets only on tag/manual
release builds:

| Platform | Secrets/environment |
| --- | --- |
| Windows signing | Windows certificate reference and password, configured as protected CI secrets |

The Wails Windows release workflow must fail rather than publish an unsigned
release once Authenticode signing is configured. Candidate ZIP artifacts remain
unsigned until that protected-release gate is implemented.

## Release Checklist

1. Run `npm run test:main`, `npm run test:unit`, `npm test`, and `npm run test:native`.
2. Tag the approved version as `vX.Y.Z` and start the Windows Wails candidate
   workflow.
3. Install the generated artifact in a clean Windows VM and run the example
   workflow.
4. Verify Authenticode signing and installer behavior before publishing.
5. Publish checksums and note supported/unsupported behavior from `docs/SUPPORT.md`.

Electron package smoke tests deliberately disable signing. They validate a
development package layout; only the protected Wails release workflow may
receive signing credentials.
