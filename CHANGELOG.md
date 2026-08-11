# Changelog

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
