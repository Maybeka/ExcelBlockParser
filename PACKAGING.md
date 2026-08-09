# Packaging Guide - Excel Block Parser

## Release Direction

Wails is the only production packaging path. Electron remains useful
for rapid renderer development, debugging, and its existing native test suite,
but Electron packages must not be published as product releases.

The supported production target is Windows 11 x64. The distributed artifact is
an unsigned ZIP plus a SHA-256 sidecar. Installers and Authenticode signing are
deferred distribution-hardening work.

## Wails Production Build

On a Windows runner with the Wails CLI installed:

```powershell
npm ci
npm run test:release
go test ./...
npm run build:vite
npm run package:wails:win
```

The final command writes `release-wails/` containing a Windows x64 ZIP and its
SHA-256 sidecar. It rejects a Git tag whose name does not exactly match the
version in `package.json`.

## Electron Development Build

```bash
npm run dev
npm run build
npm run test:native
```

Electron builder scripts remain available for development investigation only.
They must not define release platform support or be used to create a production
artifact.

## Development Prerequisites

- Node.js 22 LTS or newer and npm 10 or newer.
- Go version required by `go.mod`.
- Wails CLI and native dependencies required by the development platform.

## Release Checklist

1. Prepare a clean release-candidate commit with its actual prerelease version
   (for example, `1.1.0-rc.1`), then tag it `v1.1.0-rc.1`.
2. Run the tag workflow and retain the generated ZIP and SHA-256 sidecar.
3. Pass [docs/RELEASE_ACCEPTANCE.md](docs/RELEASE_ACCEPTANCE.md) and the
   Windows 11 x64 manual test plan against that candidate.
4. After acceptance, update the version and changelog for the final release,
   rebuild the ZIP, and tag the matching commit.
5. Publish the final ZIP, SHA-256, support notes, and acceptance evidence. Do
   not publish Electron packages as product releases.
