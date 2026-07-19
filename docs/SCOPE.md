# Excel Block Parser: Product and Repository Scope

**Status:** v0.1 refinement; v1.0 not yet released
**Production runtime target:** Wails, React, TypeScript, Go
**Development runtime:** Electron, React, TypeScript
**Last assessed:** 2026-07-19

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
7. Add tags and computed-property metadata.
8. Validate and preview raw versus parsed data.
9. Export JSON and import/export a reusable session.
10. Reconcile existing block definitions after a workbook has changed.

## 3. Implemented Scope

### 3.1 Workbook ingestion and rendering

- Native file selection for `.xlsx` and `.xls` file names through the desktop
  bridge.
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
- Computed properties with Python-like expression validation. They are stored
  as template metadata for downstream code-generation workflows; v1 does not
  execute Python expressions or add computed values to parsed JSON.
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

### 3.6 Desktop integration

- Electron main and preload processes for fast local development and native
  workflow diagnostics.
- Wails bindings and Go application code, intended to become the v1.0
  production desktop host.
- Native file open/save dialogs for workbooks, sessions, and JSON export.
- Modal preview flow. The Electron-only preview window is not a v1 requirement.

## 4. Current Technical Architecture

```text
Wails production host / Electron development host
  - native dialogs, constrained filesystem access, recovery persistence
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

Wails is the selected production desktop host for v1.0. Electron remains a
development-only shell for rapid renderer work and diagnostic E2E coverage.
The renderer must use the narrow bridge contract so both hosts retain behavioral
parity during the v0.1 refinement period.

## 5. Quality and Verification Status

The repository contains example workbooks plus unit, browser, Electron-native,
Electron-main, Go safety, and Wails-build checks. Electron remains development
coverage only; Wails production E2E and installed-artifact acceptance are
required before v1.0 can be released. See `docs/RELEASE_ACCEPTANCE.md` for the
authoritative release gates rather than treating a historical test count as a
release claim.

## 6. Explicit Non-Goals Today

The current repository should not be represented as providing the following:

- A general spreadsheet formula engine or full Excel compatibility layer.
- Multi-user collaboration, hosted workspaces, or cloud synchronization.
- A server API, authentication system, or job queue.
- A marketplace or sandboxed plugin platform.
- Arbitrary Python execution as part of data export.
- Guaranteed support for all Excel file features, especially macros, external
  links, pivot tables, complex charts, and every formula behavior.

## 7. Post-v1 Code Generation and Extensions

Generating source files from parsed JSON is a valid post-v1 extension. It must
not delay the v1.0 extraction product. After the extraction contract is stable,
it should be a separate, explicit phase:

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

## 8. v1.0 Release Gaps

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
- Define a single host-neutral desktop bridge and bring Wails behavior to
  parity with the supported workflow.
- Harden Wails filesystem and dialog boundaries; use the narrowest practical
  privileges and validate all input paths/data at the Go boundary.
- Add fixture-based integration tests from real workbooks to expected JSON.
- Add fixture-based bridge integration and Wails production E2E tests for
  open/save/import/export/preview/recovery workflows.
- Add CI for linting, unit tests, builds, and packaging smoke tests.

### Release readiness

- Create a root README with installation, supported formats, examples, and
  troubleshooting.
- Publish a compatibility matrix for Excel features and platform support.
- Define versioning, changelog, migration, crash reporting, and support policy.
- Establish Windows code signing for the distributed desktop installer.

## 9. Delivery Boundary

The v1.0 path is limited to refining the existing extraction product and
making the Wails host production-ready. Extensions and generators begin only
after the v1.0 acceptance gate is passed.

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
