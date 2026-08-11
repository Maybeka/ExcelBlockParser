# Excel Block Parser

Excel Block Parser is a desktop application for converting repeatable,
semi-structured Excel ranges into validated JSON. It is built with React,
Univer, and ExcelJS; Wails is the production desktop target and Electron is a
development harness.

## Quick Start

Prerequisites: Node.js 22 LTS or later and npm 10 or later.

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
4. Use **Run & Preview** in the extraction panel to inspect the result.
5. Use **Save Project** or **Save Project As** to persist the complete project.

`examples/test_data_v2.xlsx` is a deliberately changed source workbook for
testing reconciliation.

## Verification

```bash
npm run test:main     # main-process file-safety policy
npm run test:unit     # renderer/unit and real-workbook integration tests
npm test              # browser-mode UI tests
npm run test:native   # built Electron end-to-end development workflow
npm run test:packaged # optional Electron package smoke test; not a CI/release gate
npm run test:release  # release-tag/package-version consistency
```

Version 1.2.0 is released as a Wails Windows 11 x64 ZIP package. Create future
Windows candidates with `npm run package:wails:win`; the command rejects a
release tag that does not exactly match `package.json`.

See [Project JSON Contract](docs/SESSION_SCHEMA.md),
[Support and Limitations](docs/SUPPORT.md), and
[Release Acceptance](docs/RELEASE_ACCEPTANCE.md). Test packaged artifacts with the
[Manual Acceptance Test Plan](docs/MANUAL_ACCEPTANCE_TEST_PLAN.md).

## Scope

The product creates reusable extraction templates and JSON output. Computed
properties are validated template metadata, not in-app Python execution. It
does not run arbitrary generators, macros, external workbook links, or a full
Excel formula engine. See [Product Scope](docs/SCOPE.md) for the current
boundary.
