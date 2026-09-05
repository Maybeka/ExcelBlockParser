# Changelog

## 1.7.5 - 2026-09-05

- Added Wails, Electron, and Univer runtime versions to the About dialog.
- Automatically dismiss the temporary Excel browser-mode hint after it appears,
  and when the mode is turned off.
- Made disabled outline display reveal rows and columns hidden solely by Excel
  grouping, while retaining ordinary source-hidden cells.

## 1.7.4 - 2026-09-05

- Improved workbook rendering for embedded images, formulas, rich values, and
  Office Math drawings, while retaining temporary, read-only presentation.
- Added project-load progress state so large configured workbooks do not flash
  an unrelated empty-workbook action before conversion begins.
- Updated the local Univer outline controller for nested groups and added an
  Excel browser-only native filter action for a selected range.

## 1.7.3 - 2026-09-05

- Added Wails native-window close interception so the Windows production build
  now uses the same save, discard, or cancel confirmation flow as Electron.

## 1.7.2 - 2026-09-03

- Confirmed unsaved project changes before closing the application, with
  discard, save, or cancel. A recovered workspace stays unsaved until the user
  writes a project file.
- Quit the process after that confirmation on macOS as well, matching Wails
  production instead of leaving a Dock-resident empty session.
- Replaced the two-workbook Univer cache cap with an estimated 384 MiB data
  budget so several small workbooks can stay warm without retaining unbounded
  large sheets.
- Reapplied Excel outline groups after canvas layout, surfaced a refresh action
  when the outline view cannot be applied, and patched Univer nested-outline
  rendering for Electron development.

## 1.7.1 - 2026-09-01

- Added a temporary Excel browser mode that hides workspace navigation and
  Extractions, and suppresses Block, Region, and column highlights until the
  prior workspace view is restored.

## 1.7.0 - 2026-09-01

- Bounded the in-memory Univer cache to the active workbook and one recently
  used workbook. Opening additional project workbooks now releases the least
  recently used canvas instance while keeping the workbook configured and
  transparently reloadable when selected again.
- Loaded the Project Python workspace only when opened, moving its editor and
  syntax tooling out of the initial renderer bundle.
- Limited workbook search to each sheet's populated data range rather than the
  full spreadsheet grid, avoiding large empty-array allocations on normal
  Excel files.
- Added cache-eviction tests and retained the 50,000-cell benchmark. The local
  release benchmark completed in 133 ms on this development machine.

## 1.6.0 - 2026-09-01

- Saved per-workbook read-only display preferences for Excel outlines and frozen
  panes. Both are disabled by default and never modify the source workbook.
- Added an outline-group controller for rows and columns without Univer Pro,
  including nested groups and independent expand/collapse actions.
- Added source-change confirmation before regenerating Preview data or Project
  Python input, so changes to an Excel source are explicit and intentional.
- Fixed cross-workbook range focusing, extended Project v3 validation for
  `sourceRowIndices`, and added a browser regression that opens a project JSON
  exported by the application itself.
- Moved JSON validation and About into the application More menu.

## 1.4.7 - 2026-09-01

- Added read-only Excel display toggles for source workbook frozen panes and
  collapsed outline rows and columns. These toggles do not modify the source
  workbook or saved project data.
- Added Project JSON validation from Project actions. The validator checks a
  selected file without importing it and shows schema diagnostics in place.
- Expanded import diagnostics for block and region results with precise JSON
  paths, result identities, and field-level causes.

## 1.4.6 - 2026-09-01

- Added an About dialog under Project actions with the build version, project
  format, and desktop runtime roles.
- Improved project-import errors with Block paths, labels, field-level reasons,
  and readable multi-line details.
- Added the branded transparent application icon to the renderer assets.

## 1.4.5 - 2026-09-01

- Fixed a renderer startup failure in 1.4.4 caused by a local navigation
  variable shadowing the browser `navigator` object.

## 1.4.4 - 2026-09-01

- Moved workbook copy and search into the canvas heading. Search is a window-level
  panel that can be dragged across the application, lists matches, and can scan
  the active sheet or every sheet.
- Search runs from Enter or the in-field search button, uses the Block/Region
  focus API to bring off-screen cells into view, and no longer caps matches at
  250 unless a caller supplies a limit. Cmd/Ctrl+F opens search and Cmd/Ctrl+C
  copies the selected cells.
- Moved Extractions collapse to an edge control without persisting that state,
  and used a shared success notice for project save and cell copy.

## 1.4.3 - 2026-08-31

- Migrated the real Electron multi-workbook regression to the current
  project-first navigation, Blocks, Preview, and project-save workflows.
- Kept the native smoke suite focused on current project creation and
  cross-workbook selection, while the expanded multi-workbook suite remains a
  release-candidate regression rather than a routine pre-push cost.

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
