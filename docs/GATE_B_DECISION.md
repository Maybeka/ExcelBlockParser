# Gate B Decision and Evidence

**Decision:** Admit Phase B
**Assessed:** 2026-08-09
**Scope:** Compile-time built-in feature modules only

Gate B passes. The evidence supports one small host contract for Block,
Region, and External Structured Result Review while leaving each scenario's
state, editor, validation, execution, and result shape in dedicated code. This
decision does not admit runtime plugins or make External Review a production
feature.

## R0: Ownership Matrix

| Concern | Block extraction | Region detection | External result review | Common host semantic |
| --- | --- | --- | --- | --- |
| Durable state | `ProjectConfig.blocks` | `ProjectConfig.regions` | Future versioned review state | Typed state owned by the feature |
| Transient UI | `ConfigPanel` block editor state | `ConfigPanel` and `RegionPanel` state | Review filters, queue, and diff selection | Host mounts and tears down a view |
| Commands | Add, edit, delete, reorder, select | Add, edit, delete, select | Import, decide, accept, reject | One atomic transaction with history/dirty state |
| Workbook reads | Selected sheet/range and snapshots | Region range and detected sub-blocks | Evidence reads only | Bounded reads by stable workbook ID |
| Execution | Parse configured blocks | Detect and parse regions | Validate and compare candidate | Async execution with cancellation |
| Diagnostics | Range, key, type, and sheet errors | Range, split, and sheet errors | Schema, association, evidence, and diff errors | Owned structured diagnostics and focus targets |
| Result view | Parsed table/JSON | Grouped region blocks | Queue, tree, and diff | Host mounts a bounded scenario-owned result |
| Cleanup | Reconciliation and selection state | Detection and selection state | Candidate buffers, comparison, subscriptions | Deactivate, project-close, cancellation, dispose |

Phase B subsequently removed the identified feature-specific branches from
project/workbook lifecycle, execution coordination, diagnostics focus, save
preparation, preview creation, right-panel selection, and left navigation.
Scenario behavior now enters through compile-time registrations.
Selection, canvas ranges, execution readiness, diagnostic focus, navigation,
panel views, and result views are composed without feature-ID dispatch in the
shell.

## R1: Project v3 Adapter Policy

Project v3 remains the public format. Internal adapters decode its top-level
`blocks`, `regions`, active selections, focus mode, `data`, `blockResults`, and
`regionResults` into typed feature-owned state. Encoding writes those values
back to their existing v3 locations and validates the complete document before
returning it.

- Adapter failure returns owned structured diagnostics and never mutates the
  input or prior project state.
- Recovery and history continue to snapshot the complete `ProjectConfig`; they
  therefore preserve the same Block/Region ownership and active selections.
- Session v1/v2 decoding was removed during Phase B. The adapter accepts strict
  Project v3 only.
- A missing built-in feature must leave its current v3 fields untouched. The
  other feature adapter cannot claim or rewrite them.
- Project v3 has no legal location for unknown future feature state. Lossless
  opaque-state preservation requires a separately approved future schema; the
  application must not silently add a `features` field to v3.

The complete golden fixture and adapter tests prove canonical v3 decode/encode,
selection and result preservation, structured failure, and non-mutation.
Legacy handoff tests and fixtures were removed with the unsupported decoders.

## R2-R4: Contract and Host Evidence

The provisional Gate B runtime was replaced by the production contract in
`features/core/projectFeature.ts`. It registers project lifecycle, validation,
execution, diagnostics, save preparation, preview generation, and cleanup.
Workspace panel/navigation capabilities are bounded in
`features/panel/workspacePanel.ts`; neither contract exposes Electron, Wails,
filesystem, preload, or raw Univer objects.

`FeaturePanelHost` owns the heading, scrolling boundary, focus ring,
accessibility label, render error boundary, retry state, and keyed teardown.
The production Extraction Setup view now mounts through this host. A
development-only External Review fixture provides a materially different queue
and diagnostic view with CSS-module scoping. Browser tests prove both views,
render-failure isolation, shell/canvas survival, focus entry, unmounting, and
style containment.

## R5: Commonality and Complexity

The shared contract removes repeated failure-prone infrastructure without
forcing scenario models together. State, validation rules, editors, and output
types remain feature-owned. There is no generic property bag, unrestricted
mutation callback, raw host access, or feature-ID switch in the host.

Every required operation is meaningful to all three scenarios: state creation,
validation, transactions, workbook discovery, diagnostics, cancellation, and
panel mounting. Execution and lifecycle hooks are optional for capability
reasons rather than keyed by scenario. Host JSON import and detailed result
views remain separate bounded capabilities because only some scenarios need
them.

A fourth built-in scenario needs module code, typed state, registration, and a
panel contribution. It does not require changes to the panel host, project or
workbook lifecycle, diagnostics, execution coordination, or result host. Phase
B verified this boundary after production Block and Region migration.

## R6: Gate Audit

| Gate B condition | Result | Direct evidence |
| --- | --- | --- |
| Third scenario is concrete | Pass | `SCENARIO_EXTERNAL_RESULT_REVIEW.md` defines inputs, state, workbook use, UI, output, diagnostics, security, and lifecycle. |
| Commonality is demonstrated | Pass | Ownership matrix plus one branch-free runtime contract exercised under all three scenario identities. |
| Core orchestration is extracted | Pass | Phase A services and tests keep project/workbook/execution/history/diagnostics outside React composition. |
| Persistence strategy is approved | Pass | Project v3 adapter policy, canonical golden test, and failure/non-mutation tests. |
| UI host contract is prototyped | Pass | Extraction and External Review views plus browser tests for mount, failure, focus, unmount, and CSS scope. |

**Gate B is admitted with no Partial, Fail, or unverified condition.** Phase B
may migrate Block, Region, and the approved third scenario to the operational
contract. Runtime extension work remains blocked by Gate C.
