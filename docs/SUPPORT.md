# Support And Limitations

## Runtime Status

| Runtime | Status | Purpose |
| --- | --- | --- |
| pywebview | Production desktop target | Windows single-file application; macOS development |
| Electron | Development-only | Fast renderer development and diagnostic E2E |
| Browser mode | Development-only | Renderer tests without native bridge behavior |

The supported release platform is Windows 11 x64 through pywebview and the system
WebView2 Runtime. CPython, its standard library and the desktop services are bundled in one EXE.
Electron packaging is not a supported distribution channel.

The tag workflow verifies and publishes an unsigned EXE, SHA-256 sidecar and
build provenance. Windows automated acceptance runs on a hosted Server 2025
runner; physical Windows 11 behavior is not asserted by those tests. Manual
checks are supplementary, not a required migration gate. Signing remains deferred.

## Supported Workbook Behavior

- `.xlsx` and `.xls` selection, up to 100 MB per workbook.
- Worksheet navigation, selected ranges, merged values, headers, mappings,
  nested all/any keep-row filters, configurable empty-row removal,
  two-dimensional Region detection, previews,
  projects, and reconciliation.
- Project/recovery JSON up to 25 MB. Unsaved workspace configuration is
  recovered after an interrupted session when the production host supports it.

## Known Limitations

- `.xls` compatibility depends on ExcelJS decoding support; `.xlsx` is the
  recommended input format.
- Macros, external links, pivot tables, charts, and every Excel formula/result
  are not preserved or executed.
- Browser and Electron tests do not constitute production-host acceptance.
- Workbook reads/source inspection have a 100 MB limit and 30-second worker
  deadline. Conversion has separate renderer limits; the I/O deadline is not
  a claim that every workbook renders within 30 seconds.
- Autosave preserves workspace configuration and current parsed state, not an
  external workbook copy.
- Project Python is available in the pywebview runtime. It executes one
  explicitly invoked `process(context)` script in a disposable CPython process.
  Scripts are trusted and have current-user filesystem, network and child-process
  access. There is no security sandbox, pip management, terminal, debugger or LSP. A script may
  return bounded UTF-8 text artifacts; after preview and user directory
  selection, the desktop host validates and writes them.

## Upgrading From The Previous Desktop Host

Save open projects before changing applications. Saved Project v3 JSON uses the
same contract. Existing unsaved recovery from the old host is not automatically
imported or deleted. The new Windows profile remains under
`%APPDATA%/Excel Block Parser Pywebview/` with `recovery.json` and `preferences.json`.
The old host used `%APPDATA%/Excel Block Parser/recovery/workspace-session.json`.
Profiles remain separate so upgrading or rolling back does not overwrite recovery.
