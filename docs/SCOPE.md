# Excel Block Parser: Product and Repository Scope

**Status:** v1.0.0 released; `main` is the unreleased v1.1.0 development baseline
**Production runtime target:** Wails, React, TypeScript, Go
**Development runtime:** Electron, React, TypeScript
**Last assessed:** 2026-08-09

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

1. Create or open a project JSON file.
2. Load every workbook source configured by that project.
3. Select one or more ranges as extraction blocks.
4. Configure headers, output fields, types, value mappings, and skipped
   columns for each block.
5. Optionally configure regions that are split into blocks by keyword or blank
   row boundaries.
6. Apply row filtering and empty-column removal.
7. Add tags and computed-property metadata.
8. Run extractors and preview raw versus parsed data from the extraction panel.
9. Save or save-as the complete project JSON through the desktop lifecycle.
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

### 3.5 Project persistence and reconciliation

- Versioned v3 project serialization and deserialization.
- Import compatibility for legacy session versions 1 and 2.
- New, Open, Save, Save As, Settings, and Close project lifecycle controls.
- Complete project persistence including workbook sources, configuration, and
  the most recent run output.
- Unsaved-change tracking and discard confirmation in the UI.
- Reconciliation reports when source workbooks change, including missing
  sheets, changed/shifted columns, shifted rows, unused/new value mappings,
  and content changes.
- Suggested reconciliation fixes, with support for auto-applicable fixes in the
  data model and UI workflow.

### 3.6 Desktop integration

- Electron main and preload processes for fast local development and native
  workflow diagnostics.
- Wails bindings and Go application code for the production desktop host.
- Native file open/save dialogs for workbooks and project JSON.
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

Wails is the production desktop host. Electron remains a
development-only shell for rapid renderer work and diagnostic E2E coverage.
The renderer must use the narrow bridge contract so both hosts retain behavioral
parity during v1.1 development.

## 5. Quality and Verification Status

The repository contains example workbooks plus unit, browser, Electron-native,
Electron-main, Go safety, and Wails-build checks. Electron remains development
coverage only; Wails desktop/WebView E2E is not a current requirement. Windows
11 artifact acceptance is required for each production release. See
`docs/RELEASE_ACCEPTANCE.md` for the authoritative release gates rather than
treating a historical test count as a release claim.

## 6. Explicit Non-Goals Today

The current repository should not be represented as providing the following:

- A general spreadsheet formula engine or full Excel compatibility layer.
- Multi-user collaboration, hosted workspaces, or cloud synchronization.
- A server API, authentication system, or job queue.
- A marketplace or sandboxed plugin platform.
- Arbitrary Python execution as part of data export.
- Guaranteed support for all Excel file features, especially macros, external
  links, pivot tables, complex charts, and every formula behavior.

## 7. Future Code Generation and Extensions

Generating source files from parsed JSON remains a valid future capability. It
is separate from the current Gate B readiness work and should consume the
stable extraction contract through an explicit phase:

```text
Workbook -> extraction template -> validated JSON -> generator recipe -> files
```

The generator must consume a documented JSON schema, not workbook coordinates,
React state, or internal block identifiers. This keeps templates reusable and
allows the same extracted data to drive Python, TypeScript, SQL, configuration,
or test-fixture generators.

Finite application-owned scenarios will first be implemented as compile-time
built-in feature modules. A runtime plugin system is not justified by scenario
count alone and remains gated on independent distribution, external ownership,
and an approved trust model. See `FEATURE_MODULE_ARCHITECTURE.md`.

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

## 8. Current Refinement Priorities

Version 1.0.0 is released and Phase A core-boundary extraction is complete.
Current work should preserve Project v3 and the supported extraction workflow.

### Baseline maintenance

- Keep version, changelog, support, release, schema, and architecture documents
  synchronized with the tagged release and current development line.
- Preserve the complete automated Electron development suite and Windows/Wails
  release acceptance without expanding GitHub verification unnecessarily.
- Treat reported data loss, workbook identity, recovery, and persistence
  defects as higher priority than architecture expansion.

### Gate B readiness

- Prototype a host-owned right-panel boundary with two materially different
  built-in views, including failure and teardown behavior.
- Define a Project v3 compatibility-adapter policy before considering a new
  persistence schema.
- Validate common lifecycle, transaction, diagnostics, cancellation, workbook
  navigation, and result-view needs against Block, Region, and External
  Structured Result Review.
- Reassess Gate B from evidence. Do not freeze a module API, migrate all
  features, or implement runtime plugins before the gate passes.

Large-file decomposition is not an independent product goal. The remaining
`WorkspaceApplication`, `ConfigPanel`, and reconciliation code should be split
only where Gate B prototypes or defect isolation establish a concrete ownership
boundary and focused tests.

## 9. Delivery Boundary

The v1.1 development line is limited to preserving the extraction product while
collecting Gate B evidence for compile-time built-in feature modules. Runtime
extensions and generators remain outside the current delivery boundary.

## 10. Definition of a Production-Ready First Release

Every production release should reliably open supported workbooks, let a
user create and save a reusable template, reapply that template to a changed
workbook, identify actionable extraction differences, preview validated JSON,
and export it without data loss in documented supported cases. It should be
packaged for its supported desktop platforms, have a tested migration path for
saved templates, and provide clear errors when input falls outside its support
boundary.

Code generation remains a consumer of reliable JSON rather than a substitute
for extraction correctness. Its implementation is not part of Gate B readiness.
