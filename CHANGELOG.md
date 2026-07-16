# Changelog

## 1.0.0 - 2026-07-16

Stabilization release for the Electron desktop workflow.

- Stable session and JSON output contract at schema version 2, including v1
  import migration.
- Workbook extraction, region detection, validation, reconciliation, previews,
  autosave/recovery, and undo/redo.
- Electron-native and packaged-app verification for workbook open, session
  import/export, preview, cancellation, and recovery persistence.
- Signed/notarized release configuration for macOS and signed Windows release
  configuration; Linux AppImage packaging.

## Compatibility

- Session version 1 imports and migrates to version 2.
- Version 2 is stable throughout the 1.x line. See
  [docs/SESSION_SCHEMA.md](docs/SESSION_SCHEMA.md).
