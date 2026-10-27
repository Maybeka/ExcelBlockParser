# Release Process

## Supported Artifacts

The supported production artifact is an unsigned pywebview Windows 11 x64 EXE
with a SHA-256 sidecar and build manifest. An installer is not part of the current
distribution scope.

Electron packages are development-only artifacts and are not production releases.

## Deferred Distribution Hardening

Authenticode signing and installer distribution are explicitly deferred work.
They must be designed as protected release infrastructure before a later signed
distribution is published. No signing secrets are required for the current
unsigned single-file workflow. WebView2 is required; a separate installed Python
and an `_internal` directory are not required. Windows can still display
SmartScreen warnings for an unsigned publisher.

## Release Checklist

1. Run `npm run verify:prepush` (includes the Python runtime and formula corpus).
2. Align `package.json`, `package-lock.json` and CHANGELOG; tag the approved version
   as `vX.Y.Z`. Packaging rejects mismatched tag/package versions before building.
3. The release workflow calls the same Windows candidate workflow: host/helper
   tests, source WebView acceptance, onefile build, Internet-zone distribution
   regression, and all eleven downloaded-executable native groups.
4. The candidate records the tested executable's SHA-256. Release preparation
   refuses an incomplete verification, changed executable or mismatched source
   commit. It copies the tested bytes without rebuilding.
5. The publishing job downloads those assets, verifies source/version and checksum,
   then publishes them. Prerelease tags do not replace Latest. A manual untagged
   workflow run creates a candidate only, not a public release.
6. Record optional Windows 11 physical/visual findings separately. Do not treat
   hosted Windows Server verification as a Windows 11 manual pass.

The build manifest records the source commit, app version, Python, Node and
desktop packaging dependency versions. The full Windows workflow is manual or
release-triggered; routine checks run the fast production-host and shared suites
without repeating the full package replay for every documentation change.

Electron package smoke tests deliberately disable signing. They validate a
development package layout and are not release artifacts.
