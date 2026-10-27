# Packaging Guide - Excel Block Parser

## Release Direction

pywebview is the only production packaging path. Electron remains useful
for rapid renderer development, debugging, and its existing native test suite,
but Electron packages must not be published as product releases.

The supported production target is Windows 11 x64. The distributed artifact is
an unsigned single EXE plus SHA-256 and build-provenance files. Installers and Authenticode signing are
deferred distribution-hardening work.

## Production Build

On Windows with Python 3.12 and Node.js 22:

```powershell
py -3.12 -m venv .venv-pywebview
.venv-pywebview\Scripts\python.exe -m pip install -r desktop_pywebview/requirements-build.txt
npm ci
npm run verify:prepush
npm run package:pywebview
```

The final command writes `release-pywebview/Excel Block Parser.exe` and a build
manifest. It bundles CPython, the standard library, Python desktop services and
frontend assets. There is no separately distributed `_internal` directory, Go
helper, or requirement to install Python on the user's machine. WebView2 is
required. Build on the target OS; macOS produces an application bundle for local
development, not a Windows executable.

Packaging rejects a versioned Git tag that does not match `package.json`.
The Windows candidate workflow additionally verifies Internet-marked extraction,
source and packaged native scenarios, exact executable bytes and runtime cleanup.
Only after passing does it prepare the EXE, checksum and provenance artifacts.

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
- Python 3.12 and `desktop_pywebview/requirements-build.txt`.
- The platform WebView backend (WebView2 on Windows, WKWebView on macOS).

## Release Checklist

1. Pass local pre-push and [docs/RELEASE_ACCEPTANCE.md](docs/RELEASE_ACCEPTANCE.md).
2. For an untagged candidate, manually run the Windows candidate workflow on the
   intended branch. This builds and verifies without publishing a release.
3. For a separately authorized release, set the package/lockfile version and
   changelog, then push the matching `v<version>` tag.
4. The release workflow builds and verifies once, then publishes those same EXE
   bytes with SHA-256 and provenance. It must not rebuild after verification.
5. Keep the previous stable release available for rollback. Do not publish
   Electron packages as product releases. See [docs/RELEASE.md](docs/RELEASE.md).
