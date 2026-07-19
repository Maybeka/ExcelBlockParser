# Changelog

## Unreleased: v0.1 refinement toward v1.0

This repository remains at `0.1.0`. The prior `1.0.0` entry was planning
material, not a shipped release.

- Stable session and JSON output contract at schema version 2, including v1
  import migration.
- Workbook extraction, region detection, validation, reconciliation, previews,
  autosave/recovery, and undo/redo.
- Electron-native verification for workbook open, session import/export,
  preview, cancellation, and recovery persistence.
- Wails is the intended production runtime; Electron is retained as a
  development and diagnostic harness while Wails parity is completed.

## Compatibility

- Session version 1 imports and migrates to version 2.
- Version 2 is the current working schema and must remain compatible through
  the v1.0 release. See
  [docs/SESSION_SCHEMA.md](docs/SESSION_SCHEMA.md).
