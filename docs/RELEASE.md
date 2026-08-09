# Release Process

## Supported Artifacts

The supported production artifact is an unsigned Wails Windows 11 x64 ZIP
package with a SHA-256 sidecar. An installer is not part of the current
distribution scope.

Electron packages are development-only artifacts and are not production releases.

## Deferred Distribution Hardening

Authenticode signing and installer distribution are explicitly deferred work.
They must be designed as protected release infrastructure before a later signed
distribution is published. No signing secrets are required for the current
unsigned ZIP workflow.

## Release Checklist

1. Run `npm run test:main`, `npm run test:unit`, `npm test`, and `npm run test:native`.
2. Tag the approved version as `vX.Y.Z` and start the Windows Wails candidate
   workflow.
3. Install the generated artifact in a clean Windows VM and run the example
   workflow.
4. Record manual acceptance from the Windows 11 test machine, including the
   artifact checksum and any Windows security notice for the unsigned package.
5. Publish checksums and note supported/unsupported behavior from `docs/SUPPORT.md`.

Electron package smoke tests deliberately disable signing. They validate a
development package layout and are not release artifacts.
