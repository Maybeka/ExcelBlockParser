# Excel Block Parser: Product and Repository Scope

**Status:** Stabilization release 1.0.0
**Primary runtime:** Electron, React, TypeScript
**Last assessed:** 2026-07-16

## 1. Product Intent

Excel Block Parser is a desktop application for turning semi-structured Excel
workbooks into repeatable, validated JSON datasets.

The product is intended for users who receive business spreadsheets whose
layout is not a clean database table: multiple tables on a sheet, repeated
sections, decorative headers, blank separators, merged cells, inconsistent
values, and evolving source files. Rather than writing one-off spreadsheet
scripts, a user defines an extraction template visually and reuses it with
later versions of the workbook.

The durable output of the product is therefore two related artifacts:

1. An extraction template (the saved session/configuration).
2. Validated JSON produced by applying that template to a workbook.

## 2. Current User Workflow

The implemented application supports this general workflow:

1. Open an Excel workbook in the desktop application.
2. View worksheets in an embedded spreadsheet editor/viewer.
3. Select one or more ranges as extraction blocks.
4. Configure headers, output fields, types, value mappings, and skipped
   columns for each block.
5. Optionally configure regions that are split into blocks by keyword or blank
   row boundaries.
6. Apply row filtering and empty-column removal.
7. Add tags and computed properties.
8. Validate and preview raw versus parsed data.
9. Export JSON and import/export a reusable session.
10. Reconcile existing block definitions after a workbook has changed.

## 3. Implemented Scope

### 3.1 Workbook ingestion and rendering

- Native file selection for `.xlsx` and `.xls` file names through Electron.
- Workbook loading through ExcelJS.
- Conversion from ExcelJS workbook data to Univer workbook data.
- Multi-sheet spreadsheet display via Univer.
- Preservation of common spreadsheet presentation data, including cell values,
  formula results, rich text, styles, fonts, fills, borders, alignment, merged
  cells, row heights, and column widths where supported by the converter.
- Configurable default font behavior for cross-platform rendering.

### 3.2 Block extraction

- Multiple named extraction blocks.
- Range selection and range locking per block.
- Sheet association per block.
- One or more header rows.
- Automatic suggested output keys derived from headers.
- Automatic primitive type inference: string, integer, float, boolean, and
  date.
- Manual output-key editing and column skipping.
- Per-column value mapping, with a fallback type for mapped values.
- Block/key-name validation before export.
- Block-level raw data snapshots and raw/parsed preview data.

### 3.3 Regions and structural detection

- Regions that contain a source range and child blocks.
- Automatic sub-block detection using exact keyword boundaries and blank-row
  boundaries.
- An empty-column split rule is represented in the domain model; the detector
  currently treats it as a separate pre-filter rather than a row boundary.
- Region-level parsing results that preserve the detected block label and rows.

### 3.4 Data transformation

- Row-ignore rules using equality, inequality, substring, empty-value, and
  regular-expression operators.
- Empty-column detection and removal.
- Label and key/value tags on blocks and regions.
- Tag utilities for adding, removing, filtering, and enumerating tags.
- Computed properties with Python-like expression validation.
- Parsed JSON output with block and optional region results.

### 3.5 Session persistence and reconciliation

- Versioned session serialization and deserialization.
- Backward compatibility for session version 1 and current version 2 data.
- Import/export of configuration plus parsed output.
- Unsaved-change tracking and discard confirmation in the UI.
- Reconciliation reports when source workbooks change, including missing
  sheets, changed/shifted columns, shifted rows, unused/new value mappings,
  and content changes.
- Suggested reconciliation fixes, with support for auto-applicable fixes in the
  data model and UI workflow.

### 3.6 Desktop integration and packaging

- Electron main and preload processes with a context-isolated renderer.
- Native file open/save dialogs for workbooks, sessions, and JSON export.
- A separate Electron preview window, as well as a modal preview flow.
- Electron Builder configuration for macOS (DMG), Windows (NSIS), and Linux
  (AppImage).

## 4. Current Technical Architecture

```text
Electron main process
  - native dialogs, filesystem read/write, preview window, IPC data store
        |
        | context-isolated preload API
        v
React renderer
  - application orchestration and editor state
  - Ant Design user interface
  - Univer spreadsheet canvas
  - extraction, preview, serialization, filtering, validation services
        |
        v
ExcelJS
  - workbook ingestion and conversion source
```

The active application path is Electron with `electron-vite`. The repository
also contains a Go/Wails module and Wails configuration. It should be treated
as legacy or an alternative implementation until a product decision formally
selects one desktop shell. Maintaining both as production targets is out of
scope for the prototype's next phase.

## 5. Quality and Verification Status

The repository contains example workbooks and test coverage for domain logic,
session serialization, filtering, tags, Python-expression validation, and UI
behavior.

At the last assessment:

- `npm run test:unit` passed: 8 files and 111 tests.
- `npm run build` passed for the Electron main, preload, and renderer bundles.
- Browser-mode Playwright tests are configured. They cover renderer UI flows,
  not native Electron dialogs or IPC.
- A sandboxed Playwright run could not bind its local development server. This
  is an environment limitation, not evidence of an application test failure;
  it still requires a normal local/CI run for confirmation.

The working tree also contains untracked feature work for regions, filters,
serialization, tags, validation, tests, and supporting UI components. That
work must be reviewed and committed before it can be considered part of a
stable release baseline.

## 6. Explicit Non-Goals Today

The current repository should not be represented as providing the following:

- A general spreadsheet formula engine or full Excel compatibility layer.
- Multi-user collaboration, hosted workspaces, or cloud synchronization.
- A server API, authentication system, or job queue.
- A marketplace or sandboxed plugin platform.
- Arbitrary Python execution as part of data export.
- Guaranteed support for all Excel file features, especially macros, external
  links, pivot tables, complex charts, and every formula behavior.

## 7. Proposed Code-Generation Extension

Generating source files from parsed JSON is a valid product extension. It
should be a separate, explicit phase after extraction and validation:

```text
Workbook -> extraction template -> validated JSON -> generator recipe -> files
```

The generator must consume a documented JSON schema, not workbook coordinates,
React state, or internal block identifiers. This keeps templates reusable and
allows the same extracted data to drive Python, TypeScript, SQL, configuration,
or test-fixture generators.

### Initial scope

- A `Generate Code` action available after a successful preview.
- One bundled Python generator, such as Python dataclasses, Pydantic models,
  configuration modules, or test fixtures.
- User-configurable generator options.
- Previewed output files and a file-tree/diff view before writing.
- User-selected output directory and overwrite confirmation.
- Structured diagnostics and a recorded generation result.

### Generator contract

Each generator should be packaged independently and declare a manifest plus an
entry script:

```text
generator/
  manifest.json
  generate.py
```

The manifest should declare its identifier, display name, compatible input
schema/template versions, option schema, output expectations, and optional
validation command. The runner should provide JSON input and options, then
collect structured diagnostics and generated-file metadata.

### Safety boundary

Python code must not execute in the renderer or be implicitly run during JSON
export. Use a dedicated child-process runner with an explicitly selected
interpreter/environment, stdin or a temporary JSON input file, timeouts,
cancellation, output-size limits, and captured diagnostics. Third-party
generators require an explicit user trust decision.

## 8. Gaps Before a Production Release

### Product and UX

- Establish a documented, versioned extraction-template schema as the core
  product contract.
- Redesign the editor around workbook navigation, canvas selection,
  context-sensitive configuration, diagnostics, and preview rather than a
  collection of expanding configuration panels.
- Define validation severity, recovery behavior, and user-facing error
  messages for incomplete or ambiguous extraction.
- Add keyboard workflows, accessibility review, undo/redo, autosave/recovery,
  and large-workbook performance limits.

### Engineering

- Move parsing/orchestration logic out of the top-level React application into
  independently testable domain services.
- Separate `workbook`, `template`, `extraction`, `validation`, `ui`, and
  `platform` ownership boundaries.
- Decide between Electron and Wails, then remove or isolate the unused path.
- Harden Electron IPC and filesystem boundaries; use the narrowest practical
  privileges and validate all input paths/data at the process boundary.
- Add fixture-based integration tests from real workbooks to expected JSON.
- Add Electron E2E tests for open/save/import/export/preview workflows.
- Add CI for linting, unit tests, builds, and packaging smoke tests.

### Release readiness

- Create a root README with installation, supported formats, examples, and
  troubleshooting.
- Publish a compatibility matrix for Excel features and platform support.
- Define versioning, changelog, migration, crash reporting, and support policy.
- Establish code signing and notarization for distributed desktop installers.

## 9. Recommended Delivery Sequence

1. Review and commit the existing untracked region/filter/session work.
2. Write and stabilize the extraction-template schema and sample templates.
3. Consolidate on Electron and separate domain logic from UI orchestration.
4. Redesign the workspace around the primary extraction workflow.
5. Add workbook-to-JSON integration and native Electron E2E coverage.
6. Ship one bundled Python generator using the documented generator contract.
7. Add release engineering, security hardening, and platform distribution.

## 10. Definition of a Production-Ready First Release

The first production release should reliably open supported workbooks, let a
user create and save a reusable template, reapply that template to a changed
workbook, identify actionable extraction differences, preview validated JSON,
and export it without data loss in documented supported cases. It should be
packaged for its supported desktop platforms, have a tested migration path for
saved templates, and provide clear errors when input falls outside its support
boundary.

Code generation should ship only after this extraction contract is stable; it
is a consumer of reliable JSON rather than a substitute for extraction
correctness.
