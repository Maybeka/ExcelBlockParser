# Changelog

## 1.8.3 - 2026-09-10

- Updated the Wails MathType Equation Native conversion dependency to
  `mtef-mathml` v0.1.1, including its corrected MathML whitespace handling.

## 1.8.2 - 2026-09-10

- Made the embedded Python cancellation regression wait for the interpreter to
  become ready before testing interruption. This avoids a false failure on
  cold Windows CI workers and retains cancellation coverage.

## 1.8.1 - 2026-09-10

- Stabilized workbook switching and display modes: preserving an Excel active
  cell is now optional and disabled by default, while temporary Univer
  selections no longer overwrite the workbook state.
- Completed experimental staged loading sheet navigation. Univer keeps the
  source Sheet order and loads a selected placeholder sheet on demand.
- Show each configured workbook's resolved source path in Project Settings,
  including source paths relative to the project JSON file.
- Improved formula and embedded-object rendering: preserve OMML accents,
  render MathType text EMF previews with source bounds, and use EMF/WMF
  conversion as a fallback where native rasterization is unavailable.
- Wails now converts supported MathType Equation Native OLE objects with
  `mtef-mathml` v0.1.0 and renders the resulting MathML through MathJax before
  falling back to the cached preview image.

## 1.8.0 - 2026-09-09

- Added an experimental, project-level staged workbook loading mode. It is
  disabled by default and loads the active worksheet with its statically
  resolved formula dependencies before loading another selected worksheet.
- Added conservative fallback to complete workbook loading for dynamic,
  external, malformed, or unresolved formula references, and for XLSX files
  whose package directory cannot be safely enumerated.
- Preserved complete workbook sheet navigation while staged mode is enabled;
  selecting an unloaded worksheet loads its own dependency closure.
- Added fixture-based equivalence coverage for staged conversion, including
  images and Office Math resources, plus multi-workbook Electron coverage.
- Moved project-settings controls to the right edge. Performance logging is
  now available only in development and test builds.

## 1.7.8 - 2026-09-09

- Fixed Office Math drawing anchors by converting DrawingML EMU offsets to the
  pixel values expected by Univer. Modern OMML formulas now render at their
  source-cell position rather than far outside the visible sheet.
- Preserved each worksheet's saved active cell through workbook load and sheet
  switches, avoiding invalid used-range or full-column selections.
- Added regression coverage for a populated multi-sheet workbook and a real
  Excel file containing a modern Office Math text box.
- Localized built-in Block, Region, and parse diagnostics in Chinese and
  English. Diagnostics no longer show an empty-state message while issues are
  present, and uniquely named items can be opened from their diagnostic name.
- Kept range and column navigation available only after a Block range is
  confirmed, preventing navigation from interfering with an in-progress range
  selection. Column hover highlighting now survives a navigation click.

## 1.7.8-test.6 - 2026-09-08

- Replaced MathJax's browser component loader with its direct MathML-to-SVG
  source API, eliminating SRE speech-worker requests and rejecting invalid SVG
  geometry before it reaches the workbook canvas.
- Restored selection only for the sheet shown after workbook creation. Univer's
  selection command changes the active sheet, so restoring every sheet had
  incorrectly selected the final sheet and could yield a whole-sheet selection.
- Added Windows title-bar double-click maximize/restore for the non-interactive
  header area.

## 1.7.8-test.5 - 2026-09-08

- Fixed Univer sheet-selection restoration by supplying both required command
  identifiers, preventing an invalid full-sheet selection after sheet changes.
- Added user-visible Diagnostics for Office Math and Equation Editor 3.0
  content that cannot be positioned or rendered.
- Rejected malformed Office Math geometry before it can produce invalid SVG
  dimensions, and disabled MathJax accessibility/SRE features not needed for
  static formula rendering.

## 1.7.8-test.4 - 2026-09-08

- Fixed legacy Equation Editor 3.0 VML preview relationships using the
  real-world `o:relid` attribute used by Excel embedded objects.
- Added a Compound File reader for cached `OlePres` preview streams, including
  mini-FAT storage, so legacy equation EMF and WMF previews can be recovered
  when VML does not directly reference an image.
- Restored saved sheet selections with Univer's `subUnitId` parameter, avoiding
  an unintended switch to the last sheet while opening a project.

## 1.7.8-test.3 - 2026-09-07

- Restored embedded workbook images in the read-only workbook canvas and added
  an Electron regression test against Univer's live drawing facade.
- Added Equation Editor 3.0 OLE preview extraction from XLSX VML drawings.
  Windows Wails packages rasterize EMF and WMF previews to PNG with GDI+.
- Avoided expensive OMML parsing for drawing parts that do not contain Office
  Math, and restored the workbook's active sheet and saved active cells without
  causing an invalid whole-sheet selection.

## 1.7.8-test.2 - 2026-09-07

- Fixed image-disabled loading for workbooks with legacy Excel cell comments.
- Reset only invalid whole-sheet Univer selections after changing worksheets.
- Enabled WebView2 DevTools in test-tag Wails packages; press `Ctrl+Shift+F12`
  on Windows to open the renderer console.

## 1.7.8-test.1 - 2026-09-07

- Added project-level workbook diagnostics: independently disable embedded-image
  or Office Math loading and emit concise stage timing logs for workbook loads.
- Avoided the Office Math full-package inflation path for normal XLSX packages
  by selectively reading only package metadata and required drawing XML parts.
- Reset Univer's initial sheet selection to `A1` after workbook creation.

## 1.7.7 - 2026-09-05

- Added the esbuild version required by Vitest's bundled Vite runtime so clean
  Windows release installs resolve the dependency tree correctly.

## 1.7.6 - 2026-09-05

- Regenerated the dependency lockfile so clean Windows release installs include
  the esbuild platform packages required by `npm ci`.

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
