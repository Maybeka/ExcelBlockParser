# Excel Block Parser

Excel Block Parser is a desktop application for converting repeatable,
semi-structured Excel ranges into validated JSON. It is built with Electron,
React, Univer, and ExcelJS.

## Quick Start

Prerequisites: Node.js 22 LTS or later and npm 10 or later.

```bash
npm ci
npm run dev
```

For a production-style local run:

```bash
npm run build
npx electron out/main/index.js
```

## Example Workflow

1. Open `examples/test_data.xlsx`.
2. Select a table range in the spreadsheet canvas.
3. Configure the block name, headers, field keys, types, mappings, and filters.
4. Use **Parse & Preview** to inspect raw and parsed rows.
5. Export the JSON session, or save the configuration and reuse it against a changed workbook.

`examples/test_data_v2.xlsx` is a deliberately changed source workbook for
testing reconciliation.

## Verification

```bash
npm run test:main     # main-process file-safety policy
npm run test:unit     # renderer/unit and real-workbook integration tests
npm test              # browser-mode UI tests
npm run test:native   # built Electron end-to-end workflow
npm run pack:dir      # unpacked package smoke build
```

See [Support and Limitations](docs/SUPPORT.md) and [Release Process](docs/RELEASE.md).

## Scope

The product creates reusable extraction templates and JSON output. It does not
run arbitrary generators, macros, external workbook links, or a full Excel
formula engine. See [Product Scope](docs/SCOPE.md) for the current boundary.
