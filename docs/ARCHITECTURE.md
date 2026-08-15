# Architecture

## Runtime ownership

`App.tsx` is the application composition root. It mounts theme, workbook runtime,
and the workspace application, but does not own project persistence, workbook
runtime transitions, extraction execution, or diagnostics decisions.

| Area | Owner | Responsibilities |
| --- | --- | --- |
| Workbook | `services/workbook.ts`, `services/exceljsWorkbook.ts` | Stable workbook/sheet interface, Univer adapter, ExcelJS fixture reader, merged-cell expansion. |
| Features | `features/` | Compile-time Block, Region, and development-only External Review modules; lifecycle, validation, execution, panels, and navigation contributions. |
| Project | `services/serializer.ts`, `services/project.ts`, `services/projectLifecycle.ts` | Strict Project v3 serialization, import validation, source inspection, save/save-as, and feature-neutral state commands. |
| Workbook runtime | `services/workbookRuntime.ts`, `services/spreadsheetCapability.ts` | Authorized paths, load generations, attachment/selection state, and bounded workbook/sheet/range capabilities. |
| Execution | `services/projectExecution.ts`, feature registry | Reader collection and stale-run rejection; registered modules own parsing, snapshots, previews, and save preparation. |
| Project Python | `services/pythonProject.ts`, `python_runtime.go` | Versioned JSON context construction, isolated interpreter lifecycle, cancellation, and structured result transport. |
| Workspace | `services/workspaceHistory.ts`, `services/diagnostics.ts` | Atomic history/dirty transitions, deterministic diagnostics, and cross-workbook focus targets. |
| Validation | `services/extraction.ts`, `components/ConfigPanel.tsx` | Parse-time deterministic diagnostics and UI-time configuration checks. |
| UI | `WorkspaceApplication.tsx`, `components/` | User interactions, rendering, previews, and notifications. |
| Platform | `services/bridge.ts`, Wails Go bindings, Electron dev adapter | Native file dialogs and filesystem boundaries. |

## Project schema

The current and only supported saved-project schema is version `3`. It persists
project identity, multiple workbook sources, workbook-owned blocks and regions,
editor state, the optional project Python source, and the most recent successful result. Versions `1` and `2` are
rejected without migration. Unsupported versions and malformed definitions are rejected
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

## Feature Architecture Direction

The production architecture uses compile-time built-in modules and a
host-neutral desktop bridge, with Wails as the production adapter. Phase A core
boundaries and Gate B evidence are complete; Phase B operationalizes the admitted
module contract while runtime plugins remain deferred.

Post-v1 scenario growth will first use compile-time built-in feature modules,
not dynamically installed plugins. The exact boundaries, adoption gates, exit
standards, and current readiness assessment are defined in
`FEATURE_MODULE_ARCHITECTURE.md`.
