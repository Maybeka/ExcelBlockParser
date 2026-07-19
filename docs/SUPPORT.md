# Support And Limitations

## Runtime Status

| Runtime | Status | Purpose |
| --- | --- | --- |
| Wails | v1.0 production target | Distributed desktop application |
| Electron | Development-only | Fast renderer development and diagnostic E2E |
| Browser mode | Development-only | Renderer tests without native bridge behavior |

The v1.0 release platform is Windows x64 through Wails. The minimum supported
Windows version and installer format remain provisional until Wails packaging
and acceptance testing are complete.
Electron packaging is not a supported distribution channel.

No Wails Windows release candidate has been accepted yet. Publishing waits for
Windows packaging, Authenticode signing, installer, and manual-acceptance
gates.

## Supported Workbook Behavior

- `.xlsx` and `.xls` selection, up to 100 MB per workbook.
- Worksheet navigation, selected ranges, merged values, headers, mappings,
  row filters, regions, previews, sessions, and reconciliation.
- Session/recovery JSON up to 25 MB. Unsaved workspace configuration is
  recovered after an interrupted session when the production host supports it.

## Known Limitations

- `.xls` compatibility depends on ExcelJS decoding support; `.xlsx` is the
  recommended input format.
- Macros, external links, pivot tables, charts, and every Excel formula/result
  are not preserved or executed.
- Browser and Electron tests do not constitute Wails production acceptance.
- The application protects workbook access with a 100 MB and 30-second read/
  conversion guard. Larger workbooks are intentionally rejected.
- Autosave preserves workspace configuration and current parsed state, not an
  external workbook copy.
- Computed properties are validated template metadata. v1 does not execute
  Python-like expressions or include their derived values in parsed JSON.
