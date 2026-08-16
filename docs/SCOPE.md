# Excel Block Parser: Product and Repository Scope

**Status:** development after v1.2.0
**Production runtime target:** Wails, React, TypeScript, Go
**Development runtime:** Electron, React, TypeScript
**Last assessed:** 2026-08-16

## 1. Product Intent

Excel Block Parser is a desktop application for turning semi-structured Excel
workbooks into repeatable, validated JSON datasets.

The product is intended for users who receive business spreadsheets whose
layout is not a clean database table: multiple tables on a sheet, repeated
sections, decorative headers, blank separators, merged cells, inconsistent
values, and evolving source files. Rather than writing one-off spreadsheet
scripts, a user defines an extraction template visually and reuses it with
later versions of the workbook.

The durable output of the product is therefore three related artifacts:

1. An extraction project (the saved Project v3 configuration).
2. Validated JSON produced by applying that template to a workbook.
3. Optional UTF-8 text files generated explicitly by the project Python script.

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
11. Optionally run the project Python script, preview returned files, and save
    them to a user-selected directory through the Wails host.

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
- Automatic project-relative workbook paths on Save and Save As, with absolute
  paths retained only when a relative path cannot represent the source.

### 3.2 Block extraction

- Multiple named extraction blocks.
- Project-level Block navigation across all configured workbooks; selecting a
  Block activates its owning workbook and sheet.
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
- Project-level Region navigation across all configured workbooks; selecting a
  Region activates its owning workbook and sheet.
- Automatic rectangular sub-block detection using exact keyword, blank-row,
  and blank-column boundaries with configurable consecutive-gap thresholds.
- Region-level parsing results that preserve the detected block label and rows.

### 3.4 Data transformation

- Nested all/any keep-row filters with equality, inequality, membership,
  substring, empty-value, and regular-expression operators.
- Optional empty-row removal across non-skipped columns, with an independent
  option to treat fully struck-through cell contents as empty.
- Empty-column detection and removal.
- Label and key/value tags on blocks and regions.
- Tag utilities for adding, removing, filtering, and enumerating tags.
- Computed properties with Python-like expression validation. They are stored
  as template metadata for downstream code-generation workflows; v1 does not
  execute Python expressions or add computed values to parsed JSON.
- Parsed JSON output with block and optional region results.
- One project-owned, self-contained multi-file Python package with a fixed
  `process(context)` entry point, explicit execution, semantic editing support,
  JSON input/result views,
  captured output and errors, cancellation, and bounded UTF-8 generated-file
  preview/export in the Wails runtime.

### 3.5 Project persistence and reconciliation

- Versioned v3 project serialization and deserialization.
- Strict Project v3 import; versions 1 and 2 are explicitly unsupported.
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
parity during ongoing development.

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
- Implicit Python execution during parsing, project open, save, or export.
- Python package management, terminal access, debugger integration, LSP, or a
  generator workspace.
- Guaranteed support for all Excel file features, especially macros, external
  links, pivot tables, complex charts, and every formula behavior.

## 7. Project Python Generation and Extensions

The project Python runner provides one unified transformation and generation
phase:

```text
Workbook -> extraction template -> validated JSON -> project Python package -> previewed files
```

The script consumes the documented project context rather than workbook runtime
objects or React state. It returns JSON by value. An optional top-level
`artifacts` list describes relative UTF-8 text files; Python never receives an
output directory or direct host filesystem access. The Wails host validates,
previews, confirms conflicts, and writes those files.

Finite application-owned scenarios will first be implemented as compile-time
built-in feature modules. A runtime plugin system is not justified by scenario
count alone and remains gated on independent distribution, external ownership,
and an approved trust model. See `FEATURE_MODULE_ARCHITECTURE.md`.

The current design intentionally has no generator workspace, per-Block/Region
entry points, pip management, or independently packaged generator manifests.
Those abstractions should be introduced only if concrete scenarios demonstrate
that the project-owned package is insufficient.

### Safety boundary

Python code does not execute in the renderer and is never implicitly run. The
Wails host owns an isolated embedded interpreter with memory, source, context,
and result-size limits; cancellation and diagnostics are captured. Host files,
network access, and child processes are denied. Generated files cross the
runtime boundary only as validated result data. Third-party scripts still
require a separate trust decision and are not part of this project-owned script
surface.

## 8. Current Refinement Priorities

Version 1.2.0 is released, Phase A is complete, and Phase B established the
compile-time built-in module architecture. Current development is validating
the unified Project Python workflow without opening Gate C or weakening Block
and Region extraction quality.

### Baseline maintenance

- Keep version, changelog, support, release, schema, and architecture documents
  synchronized with the tagged release and current development line.
- Preserve the complete automated Electron development suite and Windows/Wails
  release acceptance without expanding GitHub verification unnecessarily.
- Treat reported data loss, workbook identity, recovery, and persistence
  defects as higher priority than architecture expansion.

### Phase B implementation status

- Block and Region use the admitted registration, lifecycle, transaction,
  diagnostics, execution, panel, preview, save-preparation, and navigation contracts.
- Strict Project v3 schema/runtime conformance, complete golden round-trips,
  malformed input, ownership, and persistence tests protect the current format.
- Session v1/v2 import is removed; only Project v3 is supported.
- External Structured Result Review remains a bounded development fixture with
  strict candidate validation and no filesystem, execution, or production navigation.
- Runtime plugins, in-app LLM calls, and generated-code execution remain deferred.

Large-file decomposition is not an independent product goal. The remaining
`WorkspaceApplication`, `ConfigPanel`, and reconciliation code should be split
only where module ownership or defect isolation establishes a concrete ownership
boundary and focused tests.

## 9. Delivery Boundary

The v1.1 release preserves the extraction product while operationalizing
compile-time built-in feature modules. Runtime extensions and generators remain
outside the current delivery boundary.

## 10. Definition of a Production-Ready First Release

Every production release should reliably open supported workbooks, let a
user create and save a reusable template, reapply that template to a changed
workbook, identify actionable extraction differences, preview validated JSON,
and export it without data loss in documented supported cases. It should be
packaged for its supported desktop platforms, preserve the supported Project v3
contract, reject unsupported versions clearly, and provide clear errors when input falls outside its support
boundary.

Code generation remains a consumer of reliable JSON rather than a substitute
for extraction correctness. Its implementation is not part of Phase B.
