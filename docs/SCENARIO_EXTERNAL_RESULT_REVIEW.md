# Contract-Driving Scenario: External Structured Result Review

**Status:** Bounded development fixture implemented; production workflow deferred
**Purpose:** Shape the built-in feature-module contract before Gate B
**Last assessed:** 2026-08-09

## 1. User Intent

Some extraction or code-generation work may be performed outside Excel Block
Parser, including by an LLM. The external tool produces structured JSON that
conforms to the application's documented result contract. A user then loads
that candidate into the current project, compares it with the configured
workbooks and the application's own latest result, resolves differences, and
accepts or rejects it through human review.

This scenario deliberately differs from Block and Region:

- It starts from external structured data rather than a selected range.
- Its primary UI is a review queue and diff, not a form for range extraction.
- It may read workbook ranges for evidence but does not own workbook ranges.
- Its result is a review decision and accepted structured result.
- It exercises imported data, provenance, diagnostics, and non-table previews.

It is therefore suitable for testing whether a future feature contract is
actually scenario-neutral.

## 2. User Workflow

1. Open an existing project whose workbook sources and extraction definitions
   are available.
2. Choose **Import candidate result** from the review feature.
3. Select a JSON file through the host-owned file dialog.
4. Validate its schema, size, project association, workbook ownership, result
   identifiers, and value types before it reaches feature state.
5. Show candidate, current local result, and workbook evidence side by side or
   through a focused diff.
6. Navigate from a difference to the relevant workbook, sheet, and range when
   that relationship is available.
7. Record per-item decisions or accept/reject the candidate as a whole.
8. On acceptance, update the project's latest reviewed result through one
   atomic project transaction; never replace workbook sources or extraction
   configuration from the candidate file.
9. Save the project normally. Closing or replacing a project with an unfinished
   review follows the core unsaved-change policy.

## 3. Inputs

The scenario requires:

- The currently open Project v3 document and stable project/workbook IDs.
- A host-selected JSON candidate, treated as untrusted input.
- The project's most recent successful local result, when available.
- Read-only workbook and range access for user-requested evidence navigation.

The initial accepted candidate format is a Project v3-shaped document because
that is the current public output contract. Only these result fields are
consumed:

- `data`
- `blockResults`
- optional `regionResults`

The candidate's `project` object is association metadata only. It must never
overwrite the open project's name, workbook paths, blocks, regions, active
selection, or focus mode. A future dedicated result schema may replace this
input shape through an explicit versioned migration.

## 4. Durable State

The Phase B fixture does not persist review state because Project v3 has no
feature-state envelope. The following remains a requirement for any future
production promotion:

The future module owns a serializable, versioned review state with these
semantics:

```text
review ID
candidate source name, content hash, and import time
candidate schema version and associated project ID
review status: pending, accepted, or rejected
per-result decisions and reviewer notes
structured validation and comparison summary
accepted result reference or snapshot
```

Raw native paths, file handles, workbook runtime objects, React elements, and
LLM credentials are not durable feature state. Candidate payload retention must
respect the project's size limit and an explicit future persistence decision.

Project v3 is not changed during Phase A. Until a later schema provides a
feature-state envelope, this scenario remains a contract-driving specification
only.

## 5. Core Capabilities Used

The scenario needs the following core-owned capabilities:

| Capability | Use |
| --- | --- |
| Project snapshot | Read stable IDs and the latest local result. |
| Project transaction | Atomically record review state and an accepted result. |
| Host JSON import | Select and read bounded untrusted JSON without filesystem access in the feature. |
| Workbook discovery | Resolve workbook IDs to user-visible names and availability. |
| Sheet/range read | Show workbook evidence on explicit user navigation. |
| Selection activation | Focus the spreadsheet canvas on associated evidence. |
| Diagnostics | Publish schema, association, comparison, and review errors. |
| Result-view host | Mount a diff/tree/table view independent of the standard extraction preview. |
| Cancellation | Stop validation or comparison when the candidate or project changes. |

It does not require workbook writes, formulas, macros, network access, process
execution, an LLM API, or direct Electron/Wails access.

## 6. Right-Panel and Result UI

The feature owns its right-panel content:

- Candidate source and validation status.
- Review progress and filters.
- Difference list grouped by workbook and result owner.
- Accept, reject, and reset-review commands.
- Reviewer notes and structured diagnostics scoped to the feature.

The application shell owns:

- Panel mounting, width constraints, error boundary, theme tokens, focus
  restoration, and teardown.
- The native file dialog.
- Global unsaved-state and close-project confirmation.
- Spreadsheet canvas navigation.
- The global diagnostics drawer.

Large candidate values and detailed diffs belong in a host-provided result view
or modal, not in an ever-growing right panel.

## 7. Validation and Diagnostics

At minimum, the scenario reports stable diagnostics for:

| Condition | Severity |
| --- | --- |
| Malformed or unsupported JSON/schema version | Error |
| Candidate exceeds the configured input-size limit | Error |
| Candidate project ID differs from the open project | Error unless the user completes an explicit future reassociation flow |
| Candidate references an unknown workbook or result owner | Error |
| Candidate attempts to alter project configuration | Warning; configuration is ignored |
| Candidate value shape differs from the declared result shape | Error |
| Local result is unavailable for comparison | Information; workbook evidence review remains possible |
| Workbook evidence is unavailable | Warning; candidate review remains open |
| Candidate changed after decisions were recorded | Error; decisions are invalidated |

Diagnostics contain identifiers and locations, not raw workbook or candidate
values, unless the user is viewing the local review UI.

## 8. Lifecycle and Failure Behavior

- **Activate:** restore pending review state and validate that its candidate
  association still matches the open project.
- **Import:** cancel any previous comparison before validating a new candidate.
- **Workbook switch:** keep the review active and update only the evidence view.
- **Project save/recovery:** participate through core transactions and standard
  dirty-state handling.
- **Project close:** cancel work, release candidate buffers and subscriptions,
  and rely on the core unsaved-change decision.
- **Feature failure:** preserve opaque review state, report a diagnostic, and
  leave the rest of the project usable and savable.
- **Feature unavailable:** do not silently delete persisted review state.

## 9. Security Boundary

Candidate JSON is data, never executable instructions. The feature must not:

- Run code, Python expressions, generated scripts, macros, or commands found in
  the candidate.
- Follow file paths, URLs, workbook links, or network instructions from it.
- Send workbook or project content to an LLM or network service.
- Accept candidate project configuration as trusted application state.

LLM invocation remains outside the application for this scenario. A future
in-app LLM integration would require a separate product and security decision.

## 10. Scenario Acceptance Criteria

This specification is sufficient to shape Gate B only when a prototype or
contract test proves all of the following:

- The feature can mount without Block/Region-specific props.
- It imports candidate data only through a bounded core capability.
- It renders a non-table diff/result view through the host contract.
- Workbook evidence navigation uses stable workbook IDs and published APIs.
- Acceptance is one undoable project transaction.
- Deactivation cancels work and removes every subscription.
- Invalid candidate data cannot mutate project configuration or another
  feature's state.
- Project save/open and recovery preserve the review state according to its
  approved persistence policy.

## 11. Non-Goals

- Calling an LLM from the application.
- Prompt management or model selection.
- Executing generated code.
- Automatically accepting candidate results.
- Editing Excel workbook contents.
- Replacing the existing extraction workflow.
- Defining the final feature-module TypeScript interface before Phase A exits.
