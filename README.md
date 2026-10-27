# Excel Block Parser

Excel Block Parser is a desktop application for converting repeatable,
semi-structured Excel ranges into validated JSON. It is built with React,
Univer, and ExcelJS; pywebview is the production desktop target and Electron is a
development harness.

## Quick Start

For desktop development, install Node.js 22, Python 3.12 and the Go version in
`go.mod`. Windows uses the system Microsoft Edge WebView2 Runtime.

```powershell
py -3.12 -m venv .venv-pywebview
.venv-pywebview\Scripts\python.exe -m pip install -r desktop_pywebview/requirements-build.txt
npm ci
npm run dev:pywebview
```

For the Electron development harness (not the production host):

```bash
npm ci
npm run dev
```

For an Electron development build:

```bash
npm run build
npx electron out/main/index.js
```

## Example Workflow

1. Create a project or open an existing project JSON file.
2. Add `examples/test_data.xlsx` as a workbook source in **Project settings**.
3. Select a table range and configure its extractor.
4. Use **Preview** in the Extractions header to inspect the result.
5. Use **Save Project** or **Save Project As** to persist the complete project.

`examples/test_data_v2.xlsx` is a deliberately changed source workbook for
testing reconciliation.

## Verification

```bash
npm run test:main     # main-process file-safety policy
npm run test:unit     # generates the large fixture, then runs unit/integration tests
npm test              # browser-mode UI tests
npm run test:native   # built Electron end-to-end development workflow
npm run test:packaged # optional Electron package smoke test; not a CI/release gate
npm run test:release  # release-tag/package-version consistency
npm run test:pywebview # production host, real helper, bounded I/O and cleanup
```

Releases use a single unsigned Windows 11 x64 EXE with checksums and build
provenance. Build on Windows with `npm run package:pywebview`; no separate
`_internal` folder or installed Python is needed by end users. The full candidate
workflow verifies source and downloaded-executable behavior before publication.
See [Desktop setup and verification](docs/PYWEBVIEW.md).

See [Project JSON Contract](docs/SESSION_SCHEMA.md),
[Support and Limitations](docs/SUPPORT.md), and
[Release Acceptance](docs/RELEASE_ACCEPTANCE.md). Test packaged artifacts with the
[Manual Acceptance Test Plan](docs/MANUAL_ACCEPTANCE_TEST_PLAN.md).

## Scope

The product creates reusable extraction templates and JSON output. The pywebview
runtime also supports one explicitly invoked, project-owned Python script that
receives the complete parsed result through a versioned JSON contract and may
return previewable, host-written UTF-8 text artifacts. It does not provide pip
management, a terminal, debugger, LSP, direct filesystem access, macros, external
workbook links, or a full Excel formula engine. See [Project Python](docs/PROJECT_PYTHON.md)
and [Product Scope](docs/SCOPE.md) for the current boundary.
