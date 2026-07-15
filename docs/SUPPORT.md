# Support And Limitations

## Supported Runtime

| Platform | Status | Package |
| --- | --- | --- |
| macOS 13+ (Apple Silicon and Intel) | Supported release target | Signed, notarized DMG |
| Windows 10/11 x64 | Supported release target | Authenticode-signed NSIS installer |
| Ubuntu 22.04+ x64 | Supported release target | AppImage |
| Browser/Wails paths | Development only | Not a release target |

Use Node.js 22 LTS or newer and npm 10 or newer when building from source.

## Supported Workbook Behavior

- `.xlsx` and `.xls` selection, up to 100 MB per workbook.
- Worksheet navigation, selected ranges, merged values, headers, mappings,
  row filters, regions, previews, sessions, and reconciliation.
- Session/recovery JSON up to 25 MB. Unsaved workspace configuration is
  recovered after an interrupted session.

## Known Limitations

- `.xls` compatibility depends on ExcelJS decoding support; `.xlsx` is the
  recommended input format.
- Macros, external links, pivot tables, charts, and every Excel formula/result
  are not preserved or executed.
- Browser tests do not cover native dialogs; use `npm run test:native` for the
  Electron open, import, export, preview, and cancellation path.
- The application protects workbook access with a 100 MB and 30-second read/
  conversion guard. Larger workbooks are intentionally rejected.
- Autosave preserves workspace configuration and current parsed state, not an
  external workbook copy.
