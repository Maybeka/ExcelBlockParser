# Changelog

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

- Session version 1 imports and migrates to version 2.
- Version 2 is the current working schema and must remain compatible through
  the v1.0 release. See
  [docs/SESSION_SCHEMA.md](docs/SESSION_SCHEMA.md).
