# Changelog

## 1.4.2 - 2026-08-31

- Added an explicit Block range-reset migration choice: preserve compatible
  column configuration by normalized header, with positional fallback, or
  regenerate the target columns.
- Range-reset review now identifies retained, regenerated, unmatched, and
  filter/property-referenced column configuration before applying changes.
- Retained the project-open recovery flow that surfaces all unavailable
  workbook sources together while preserving configuration for available sources.

## 1.4.1 - 2026-08-31

- Added a persistent Extractions-panel collapse control so the workbook canvas
  can use the full workspace width without rebuilding the active workbook.
- Added read-only selected-cell copy and workbook search with case-sensitive
  and whole-cell matching options. Search only reads and focuses matching cells.

## 1.4.0 - 2026-08-31

- Refined project workflows: saving now confirms success, switching workbooks
  preserves the selected Block or Region, and Project Python runs with
  Cmd/Ctrl+Enter.
- Separated Block configuration editing from a dedicated range-reset workflow.
  The reset flow shows the current source, lets users choose a project
  workbook, sheet, and range, requires a before/after review, preserves
  configuration, and focuses the newly applied range.

## 1.3.5 - 2026-08-31

- Preserved Excel worksheet tab colors in the spreadsheet canvas and workspace
  navigation after opening or refreshing a workbook.

## 1.3.4 - 2026-08-31

- Refined workspace controls and disabled extraction creation when no workbook
  is active, including the empty Block configuration state.
- Improved project settings section boundaries and extraction action spacing.

## 1.3.3 - 2026-08-31

- Added explicit Row Filter behavior for retaining or removing matching rows.
- Added Chinese Row Filter labels and verified matching against Chinese column
  keys and values.

## 1.3.2 - 2026-08-31

- Added English and Simplified Chinese interface support outside the Python
  workspace, including project workflows, extraction configuration, previews,
  reconciliation, and diagnostics.

## 1.3.1 - 2026-08-29

- Preserved Row Filter values when changing condition operators, restricted
  checkbox interaction to the controls themselves, and added confirmation
  before clearing conditions.
- Kept parsed Block rows aligned with their original workbook rows after row
  filtering in the preview.
- Added a resizable workspace sidebar and prevented long workbook names from
  pushing tree controls outside the sidebar.
- Improved XLSX rendering for theme and tinted colors and for plain and rich
  multi-line cell text.
- Refreshed application icons, using the opaque rounded-square asset by
  default and the transparent asset for Electron on macOS.

## 1.3.0 - 2026-08-16

- Added the project-owned embedded Python workspace with an isolated runtime,
  explicit project-wide input preparation, cancellation, diagnostics, and
  validated JSON result handling.
- Added multi-file Python packages with a protected entry file, file tree,
  cross-file definition navigation, semantic highlighting, symbols, member
  completion, and a Catppuccin Latte editor and preview theme.
- Added validated generated text artifacts, including Python, JSON, Verilog,
  and SystemVerilog syntax previews and host-controlled file export.
- Added project-relative workbook source persistence and recovery-path support
  for portable multi-workbook Project v3 documents.

## 1.2.0 - 2026-08-11

- Scoped locked Block, Region, and column highlights to their source sheet so
  annotations no longer remain visible after sheet navigation.
- Expanded Block row filtering with nested `all`/`any` groups, list,
  containment, emptiness, and regular-expression operators.
- Added optional empty-row removal over non-skipped columns and optional
  treatment of fully struck-through cells as empty.
- Preserved released Project v3 `ignoreRules` files through deterministic
  normalization to the canonical row-filter condition tree.
- Added workbook style metadata coverage, strict Project v3 filter validation,
  and renderer regression tests for the new behavior.

## 1.1.0 - 2026-08-11

- Added Project v3 as the current persistence contract, with stable workbook
  identity and workbook-owned Block and Region configuration.
- Added project New, Open, Save, Save As, Settings, and Close workflows with
  multi-workbook loading, switching, unavailable-source resolution, and
  project-wide parsing.
- Established host-neutral project lifecycle, workbook runtime, spreadsheet
  capability, execution, history, and diagnostics boundaries in Phase A.
- Completed Phase B with one compile-time registry for Block, Region, and the
  bounded External Result Review prototype, including lifecycle, execution,
  diagnostics, save preparation, panels, and navigation contributions.
- Removed legacy Session v1/v2 import and migration; Project v3 is now the only
  supported persisted format.
- Refined Block validation and row filtering, completed two-dimensional Region
  detection and persistence, and added Region-aware preview and Electron tests.

## 1.0.0 - 2026-08-09

The prior `v1.0.0` tag was planning material and is superseded by this Wails
Windows 11 x64 release.

- Stable session and JSON output contract at schema version 2, including v1
  import migration.
- Workbook extraction, region detection, validation, reconciliation, previews,
  autosave/recovery, and undo/redo.
- Electron-native verification for workbook open, session import/export,
  preview, cancellation, and recovery persistence.
- Wails is the Windows 11 x64 production runtime. Electron is retained as a
  development and diagnostic harness.

## Compatibility

- Project version 3 is the current saved-project format.
- Versions 1 and 2 are rejected as unsupported. See
  [docs/SESSION_SCHEMA.md](docs/SESSION_SCHEMA.md).
