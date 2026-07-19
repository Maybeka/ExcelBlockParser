# Architecture

## Runtime ownership

`App.tsx` owns React state, user feedback, and calls into domain services. It does
not define the production parsing contract.

| Area | Owner | Responsibilities |
| --- | --- | --- |
| Workbook | `services/workbook.ts`, `services/exceljsWorkbook.ts` | Stable workbook/sheet interface, Univer adapter, ExcelJS fixture reader, merged-cell expansion. |
| Extraction | `services/extraction.ts` | Mapping suggestions, type inference, parsing, row rules, empty-column handling, region extraction, diagnostics. |
| Template | `services/serializer.ts` | Session serialization, v1-to-v2 normalization, import validation. |
| Validation | `services/extraction.ts`, `components/ConfigPanel.tsx` | Parse-time deterministic diagnostics and UI-time configuration checks. |
| UI | `App.tsx`, `components/` | User interactions, rendering, previews, and notifications. |
| Platform | `services/bridge.ts`, Wails Go bindings, Electron dev adapter | Native file dialogs and filesystem boundaries. |

## Session schema

The current export schema is version `2`. Every new session includes
`config.regions`, using an empty array when no regions are configured. Version `1`
sessions remain importable and are normalized to the v2 in-memory form; a later
export writes v2. Unsupported versions and malformed block definitions are
rejected before they reach UI state.

## Parse diagnostics

`parseWorkbook` returns a deterministic `ParseResult` with structured diagnostics.
Invalid ranges, duplicate output keys, and missing sheets are errors. Type
conversion failures are warnings and yield `null` for that cell. The original
Excel value is used for explicit value-map matches. Unsupported workbook content
is intentionally surfaced through adapters rather than silently guessed.

## Test fixtures

`examples/*.xlsx` are real ExcelJS-generated workbooks. The integration suite
loads them through the same workbook abstraction used by the parser. It covers
headers, value mappings, merged cells, empty rows and columns, multiple sheets,
regions, malformed templates, missing sheets, and reconciliation against a
changed source workbook.

## Deferred Architecture

The v1.0 architecture is limited to the extraction product and a host-neutral
desktop bridge, with Wails as the production adapter. Extension and generator
architecture is intentionally deferred until after v1.0.
