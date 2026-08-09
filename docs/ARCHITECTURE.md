# Architecture

## Runtime ownership

`App.tsx` is the application composition root. It mounts theme, workbook runtime,
and the workspace application, but does not own project persistence, workbook
runtime transitions, extraction execution, or diagnostics decisions.

| Area | Owner | Responsibilities |
| --- | --- | --- |
| Workbook | `services/workbook.ts`, `services/exceljsWorkbook.ts` | Stable workbook/sheet interface, Univer adapter, ExcelJS fixture reader, merged-cell expansion. |
| Extraction | `services/extraction.ts` | Mapping suggestions, type inference, parsing, row rules, empty-column handling, region extraction, diagnostics. |
| Project | `services/serializer.ts`, `services/project.ts`, `services/projectLifecycle.ts` | Project v3 serialization, legacy migration, import validation, source inspection, save/save-as, and pure state commands. |
| Workbook runtime | `services/workbookRuntime.ts`, `services/spreadsheetCapability.ts` | Authorized paths, load generations, attachment/selection state, and bounded workbook/sheet/range capabilities. |
| Execution | `services/projectExecution.ts`, `services/extractionPersistence.ts` | Reader collection, stale-run rejection, parse result/snapshot ownership, preview preparation, and save-time extraction snapshots. |
| Workspace | `services/workspaceHistory.ts`, `services/diagnostics.ts` | Atomic history/dirty transitions, deterministic diagnostics, and cross-workbook focus targets. |
| Validation | `services/extraction.ts`, `components/ConfigPanel.tsx` | Parse-time deterministic diagnostics and UI-time configuration checks. |
| UI | `WorkspaceApplication.tsx`, `components/` | User interactions, rendering, previews, and notifications. |
| Platform | `services/bridge.ts`, Wails Go bindings, Electron dev adapter | Native file dialogs and filesystem boundaries. |

## Project schema

The current saved-project schema is version `3`. It persists project identity,
multiple workbook sources, workbook-owned blocks and regions, editor state, and
the most recent successful result. Legacy session versions `1` and `2` remain
importable and are migrated to a single-workbook v3 project in memory. New saves
always write v3. Unsupported versions and malformed definitions are rejected
before they reach UI state. See `SESSION_SCHEMA.md` and
`project-v3.schema.json` for the public contract.

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

Post-v1 scenario growth will first use compile-time built-in feature modules,
not dynamically installed plugins. The exact boundaries, adoption gates, exit
standards, and current readiness assessment are defined in
`FEATURE_MODULE_ARCHITECTURE.md`.
