# Packaging Guide - Excel Block Parser

## Release Direction

Wails is the only production packaging path for v1.0. Electron remains useful
for rapid renderer development, debugging, and its existing native test suite,
but Electron packages must not be published as product releases.

The current repository is `0.1.0`; package names and release artifacts must use
the actual pre-release version until the v1.0 acceptance gates pass.

## Wails Production Build

```bash
# Prerequisites: Go, the Wails CLI, and platform GUI/WebView dependencies.
wails build
```

Expected output:

```text
build/bin/excel-block-parser.app  # macOS
build/bin/excel-block-parser      # Linux
build/bin/excel-block-parser.exe  # Windows
```

Before a production release, the Wails build process must add platform-specific
installer creation, signing/notarization, reproducible artifact naming, and a
packaged-app smoke suite. See [docs/RELEASE_ACCEPTANCE.md](docs/RELEASE_ACCEPTANCE.md).

## Electron Development Build

```bash
npm run dev
npm run build
npm run test:native
```

Electron builder scripts remain available for development investigation only.
They must not define release platform support or be used to create a v1.0
artifact.

## Development Prerequisites

- Node.js 22 LTS or newer and npm 10 or newer.
- Go version required by `go.mod`.
- Wails CLI and native dependencies required by the development platform.

## Release Checklist

1. Pass [docs/RELEASE_ACCEPTANCE.md](docs/RELEASE_ACCEPTANCE.md) on the release
   candidate.
2. Update the version to `1.0.0`, changelog, support matrix, and release notes
   only after acceptance is recorded.
3. Build, sign, and manually smoke-test Wails artifacts for the declared
   platforms.
