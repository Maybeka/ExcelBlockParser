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
| Project Python | `services/pythonProject.ts`, `desktop_pywebview/python_runtime.py`, `worker.py` | Versioned JSON context, disposable trusted CPython execution, process-tree cancellation, and structured result transport. |
| Workspace | `services/workspaceHistory.ts`, `services/diagnostics.ts` | Atomic history/dirty transitions, deterministic diagnostics, and cross-workbook focus targets. |
| Validation | `services/extraction.ts`, `components/ConfigPanel.tsx` | Parse-time deterministic diagnostics and UI-time configuration checks. |
| UI | `WorkspaceApplication.tsx`, `components/` | User interactions, rendering, previews, and notifications. |
| Platform | `services/bridge.ts`, `desktop_pywebview/`, Electron dev adapter | Typed desktop contract, native dialogs, bounded worker-process reads, filesystem boundaries and close handshake. |

## Project schema

The current development saved-project schema is version `3`. It persists
project identity, multiple workbook sources, workbook-owned blocks and regions,
editor state, the optional project Python source, and the most recent successful result. Versions `1` and `2` are
rejected without migration. Unsupported versions and malformed definitions are rejected
before they reach UI state. Before 2.0.0, v3 is an evolving development format,
not a compatibility promise. See `SESSION_SCHEMA.md` and
`project-v3.schema.json` for the current format.

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

The production architecture uses a host-neutral desktop bridge, with pywebview as
the production adapter. The historical compile-time feature-module work and
Gate B evidence are recorded in `FEATURE_MODULE_ARCHITECTURE.md`.

As of `v1.9.0`, the application-owned feature set is frozen at Block, Region,
and project Python workflows. New scenario modules are not planned. A modular
extension interface will be considered only when a concrete new scenario proves
that these workflows are insufficient; its contract must be designed around
that scenario rather than introduced speculatively.

The Python desktop host owns the window and filesystem operations. A separately
managed Python service owns disposable CPython script processes, the Python
MathType converter and ctypes-based Windows GDI+ rasterization. No Go compiler,
runtime or helper binary is used. Script process isolation is not a permission
sandbox: organization scripts are trusted. File reads and
source inspection run in cancelable worker processes with a 30-second deadline;
shutdown terminates both file workers and the helper. Windows production builds
are onefile EXEs whose temporary runtime dependencies are cleaned on normal exit.
