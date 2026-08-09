# Changelog

## 1.1.0 - Unreleased

- Added Project v3 as the current persistence contract, with stable workbook
  identity and workbook-owned Block and Region configuration.
- Added project New, Open, Save, Save As, Settings, and Close workflows with
  multi-workbook loading, switching, unavailable-source resolution, and
  project-wide parsing.
- Established host-neutral project lifecycle, workbook runtime, spreadsheet
  capability, execution, history, and diagnostics boundaries in Phase A.
- Retained import compatibility for legacy Session v1 and v2 files.

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
- Legacy Session versions 1 and 2 remain importable and migrate to a
  single-workbook Project v3 representation. See
  [docs/SESSION_SCHEMA.md](docs/SESSION_SCHEMA.md).
