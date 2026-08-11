# Feature Module Architecture and Adoption Gates

**Status:** Gate B admitted; Phase B implementation complete
**Applies to:** Post-v1 scenario growth
**Last assessed:** 2026-08-10 after Phase B strict-exit verification

## 1. Decision

Excel Block Parser will first adopt a compile-time built-in feature-module
architecture. It will not start with dynamically installed or third-party
plugins.

Each supported scenario still has dedicated implementation code. The module
architecture standardizes how that code uses workbook capabilities, persists
project state, contributes right-panel UI, runs work, and reports results. It
does not attempt to make unrelated scenarios share one generic data model.

The architecture has three deliberately separate levels:

1. Application core and capability APIs.
2. Built-in scenario modules registered at compile time.
3. Optional runtime extensions, deferred until independent distribution is a
   demonstrated product requirement.

Moving to level 2 does not imply that level 3 must ever be built.

## 2. Exact Boundaries

### 2.1 Application core

The core owns behavior that must remain consistent for every scenario:

- Project New, Open, Save, Save As, Close, migration, dirty state, recovery,
  undo, and redo.
- Workbook source authorization, loading, identity, switching, sheet state,
  and unavailable-source resolution.
- The host-neutral Electron/Wails bridge and all native file access.
- Univer lifecycle, active selection, and read-only workbook/range access.
- Feature registration, activation, state envelopes, command transactions,
  diagnostics aggregation, and task cancellation.
- Shared application shell: top bar, workbook navigation, spreadsheet canvas,
  left navigation, right-panel host, diagnostics, and global error handling.
- Project schema versioning and feature-state migration orchestration.

The core MUST NOT:

- Contain Block, Region, or future-scenario parsing rules.
- Know a feature's editor fields or render feature-specific controls.
- Branch on feature identifiers to save, validate, run, or render a feature.
- Expose unrestricted filesystem, Electron, Wails, or Univer internals to a
  feature.
- Treat a React component's local state as durable project state.

The first capability surface should remain small and task-oriented. It should
cover workbook discovery, sheet discovery, range reads, selection observation,
selection activation, project transactions, diagnostics, and cancellation. It
is not an Excel automation API and does not promise arbitrary workbook edits,
formula evaluation, macros, charts, or Excel object-model compatibility.

### 2.2 Built-in scenario modules

A built-in module is source code in this repository, reviewed and shipped with
the application. Block and Region are the first two modules; at least one
concrete third scenario must shape the contract before the contract is frozen.

Each module owns:

- Its typed configuration and result models.
- Initial state, validation, execution, reconciliation, and state migration.
- Its right-panel React components and feature-specific local styling.
- Optional left-navigation contributions and preview/result views.
- Feature-specific commands and diagnostics.
- Unit tests, fixtures, and scenario-level integration tests.

Each module MUST:

- Use only published core capabilities and shared UI primitives.
- Persist data through a versioned feature-state envelope.
- Keep durable state serializable and free of runtime workbook objects,
  functions, DOM nodes, and host handles.
- Scope workbook-owned data by stable workbook ID.
- Return structured diagnostics and results rather than directly controlling
  global dialogs or notifications.
- Clean up subscriptions and cancel outstanding work when deactivated or when
  a project closes.

Each module MUST NOT:

- Import Electron, Wails bindings, preload APIs, or raw filesystem APIs.
- Access another module's private state or components.
- Mutate the project outside a core transaction.
- Add feature-specific branches to the application shell.
- Inject global CSS selectors that can alter the shell, workbook canvas, or
  another feature.

Right-panel customization is complete within the panel host, not across the
whole application. A module can compose its own components and scoped styles,
but the host owns panel mounting, dimensions, error boundaries, accessibility,
theme tokens, and teardown.

### 2.3 Runtime extensions

A runtime extension is installed, enabled, disabled, or upgraded independently
of the application release. This level is not approved for implementation.

If approved later, it must add boundaries that built-in modules do not need:

- Signed or otherwise trusted package identity and a manifest.
- Extension API and compatibility versions.
- Installation, enable, disable, upgrade, rollback, and removal lifecycle.
- Explicit capability permissions and a user trust decision.
- Code, stylesheet, failure, and resource isolation.
- Data ownership and migration when an extension is missing or incompatible.
- Windows/Wails packaging and loading rules.
- Time, memory, output-size, cancellation, and diagnostics controls for
  generators or other executable workloads.

Runtime extensions may use the same conceptual feature contract, but must not
load repository React modules directly or receive privileged core objects.

## 3. Dependency Direction

The allowed dependency direction is:

```text
Electron adapter ----\
                      > platform bridge -> application core <- shared UI
Wails adapter -------/                         ^
                                                |
                               built-in feature modules
                                                ^
                                                |
                              future runtime-extension adapter
```

Core interfaces cannot import feature types. Feature modules can import core
interfaces. Platform adapters implement core interfaces but cannot implement
scenario behavior.

## 4. Minimum Feature Contract

The exact TypeScript shape is an implementation result, not fixed by this
document. The contract must nevertheless provide these semantics:

| Concern | Required contract behavior |
| --- | --- |
| Identity | Stable feature ID and feature schema version. |
| State | Create, decode, validate, migrate, and serialize durable state. |
| UI | Contribute a right-panel view through a host-owned mount point. |
| Commands | Change state through atomic project transactions. |
| Workbook access | Read only through capability APIs using workbook IDs. |
| Selection | Observe and request selection through disposable subscriptions. |
| Execution | Run asynchronously with cancellation and structured results. |
| Diagnostics | Return stable codes, severity, ownership, and focus targets. |
| Lifecycle | Activate, deactivate, project-open, and project-close cleanup. |
| Testing | Run the feature against an in-memory core test harness. |

Preview is not assumed to mean a table. A feature may contribute a table,
tree, diff, generated files, or another bounded result view.

## 5. Persistence Boundary

Project v3 remains the current public format. It must not be broken merely to
begin the refactor. Block and Region data can be adapted to the internal module
contract while v3 serialization remains compatible.

A later project schema may introduce versioned feature envelopes such as:

```json
{
  "features": {
    "builtin.blocks": { "version": 1, "state": {} },
    "builtin.regions": { "version": 1, "state": {} }
  }
}
```

That schema change requires its own migration decision. Unknown feature state
must be preserved losslessly when possible; opening a project without a needed
feature must never silently delete its state.

## 6. Entry Gates

### Gate A: begin core-boundary preparation

All conditions are required before behavior-changing refactoring begins:

| Condition | Required evidence |
| --- | --- |
| Baseline is reproducible | Type checks, unit tests, browser tests, Electron E2E, and production build pass from a clean checkout. |
| Current contract is explicit | Project v3 schema, migration behavior, and supported workflow are documented. |
| Current behavior is protected | Multi-workbook switching, project lifecycle, save/recovery, Block, Region, diagnostics, and preview have regression coverage. |
| Change isolation is possible | Refactor can be delivered incrementally without changing Project v3 output or supported user behavior. |
| Ownership is recorded | Core, platform, and feature dependency rules are accepted in architecture documentation. |

### Gate B: implement and freeze the built-in module contract

Gate A must pass, plus all of the following:

| Condition | Required evidence |
| --- | --- |
| A third scenario is concrete | A written use case defines its inputs, project state, workbook operations, UI, output, diagnostics, and lifecycle. |
| Commonality is demonstrated | Block, Region, and the third scenario share lifecycle needs that can be expressed without feature-ID branches. |
| Core orchestration is extracted | Project/workbook commands, execution coordination, dirty state, history, and diagnostics are testable without rendering `App.tsx`. |
| Persistence strategy is approved | v3 adapters preserve Project v3 documents; any future schema migration preserves current-project and unknown state. |
| UI host contract is prototyped | Two materially different right-panel views mount, fail, and unmount without leaking state or global styles. |

The third scenario is a hard gate. Without it, an interface derived only from
Block and Region is likely to encode their current assumptions as supposedly
generic APIs.

### Gate C: implement runtime extensions

Gate B must have exited successfully. Runtime work additionally requires:

| Condition | Required evidence |
| --- | --- |
| Independent delivery is necessary | At least two concrete product cases require updates or installation independently of the main application. |
| Ownership is external or variable | A real third-party, customer-specific, or separately released extension exists. |
| Trust model is approved | The allowed code, file, network, process, and UI capabilities are documented. |
| Failure model is approved | Missing, incompatible, crashed, and malicious extensions have defined project and UI behavior. |
| Distribution is proven | Windows/Wails loading, update, rollback, and support procedures have a working prototype. |
| Maintenance is funded | API compatibility, SDK documentation, conformance tests, and support ownership are assigned. |

Scenario count alone is not a Gate C justification. A finite set of scenarios
owned and released with the app should remain built-in modules.

## 7. Exit Standards

### Phase A exit: core boundary established

- `App.tsx` is an application-shell composition root, not the owner of feature
  parsing, persistence, or scenario lifecycle.
- Project and workbook orchestration are independently unit tested.
- The capability API has no Block or Region types.
- Current Project v3 files round-trip without semantic data loss.
- Existing user workflows and regression suites remain green.
- No feature imports a platform adapter or raw Univer runtime object.

### Phase B exit: built-in modules operational

- Block, Region, and the approved third scenario use the same registration,
  lifecycle, transaction, diagnostics, execution, and panel-host contracts.
- Adding a fourth built-in module requires registration and module code only;
  it does not require feature-specific edits to the shell, project lifecycle,
  workbook lifecycle, or diagnostics aggregator.
- Module state survives save/open, recovery, undo/redo, workbook switching, and
  unavailable workbook resolution.
- Module errors are isolated by the panel host and do not make the project
  unsavable or corrupt another module's state.
- Contract tests and end-to-end tests cover activation, execution, Project v3
  persistence, failure, teardown, and multi-workbook ownership.
- Project v3 compatibility is proven by strict schema/runtime agreement,
  complete-field golden round-trips, malformed-input and ownership matrices,
  persistence workflow tests, and before/after module-extraction semantic comparisons.
  Session v1/v2 import has been removed; Project v3 is the only supported format.

### Phase C exit: runtime extensions supportable

- Installation through removal works on the Windows 11 Wails distribution.
- Compatibility and permission checks run before extension code is activated.
- A failed or incompatible extension cannot corrupt core project state and its
  opaque state remains recoverable.
- CSS, UI errors, subscriptions, workload limits, and privileged operations are
  isolated and auditable.
- At least one separately delivered extension passes the public conformance
  suite without importing repository-private code.
- Upgrade, rollback, diagnostics, and support procedures are documented and
  manually accepted on the production artifact.

## 8. Current Repository Assessment

Assessment is against Phase A commit `8e08a22` on 2026-08-09 and the v1.1.0
development baseline established afterward.

| Gate A condition | Status | Current evidence |
| --- | --- | --- |
| Baseline is reproducible | Pass | Phase A passed type checks, 188 renderer/unit tests, 3 main-process tests, Go tests, 29 browser tests with 4 skipped, 17 hidden Electron E2E tests, release-script tests, and the production build. |
| Current contract is explicit | Pass | Project v3 is documented, strictly validated by schema and runtime, and versions 1/2 are rejected. |
| Current behavior is protected | Pass | Direct tests cover project lifecycle, multi-workbook isolation and switching, save/recovery, Block, Region, diagnostics, and preview workflows. |
| Change isolation is possible | Pass | Project/workbook commands and coordinators are pure or host-neutral, are exercised without rendering React, and preserve Project v3 and current UI behavior. |
| Ownership is recorded | Pass after this decision | This document defines the intended dependency and responsibility boundaries. |

**Gate A decision:** completed. Phase A extracted project lifecycle, workbook
runtime coordination, execution, dirty state/history, and diagnostics behind
host-neutral interfaces while retaining Project v3 and existing workflows.

| Gate B condition | Status | Current evidence |
| --- | --- | --- |
| A third scenario is concrete | Pass | `SCENARIO_EXTERNAL_RESULT_REVIEW.md` defines inputs, state, workbook operations, right-panel and result UI, output, diagnostics, security, and lifecycle for external/LLM-generated result review. |
| Commonality is demonstrated | Pass | `GATE_B_DECISION.md` records the ownership matrix; the production registry exercises lifecycle, transactions, diagnostics, execution isolation, panels, and bounded workbook capabilities for all three scenarios. |
| Core orchestration is extracted | Pass | `App.tsx` is an 18-line composition root. Project lifecycle, workbook runtime, execution/preview preparation, workspace history/dirty transitions, and diagnostic focus decisions have UI-independent services and tests. |
| Persistence strategy is approved | Pass | Typed internal adapters round-trip a complete Project v3 fixture canonically, validate encoded state, and return structured failures without mutating prior state. |
| UI host contract is prototyped | Pass | Extraction Setup and a materially different development-only External Review view mount through `FeaturePanelHost`; browser tests cover render failure, shell survival, focus, unmount, and scoped styles. |

**Gate B decision:** admitted on 2026-08-09. The direct R0-R6 evidence and
scope decision are recorded in `GATE_B_DECISION.md`. Phase B completed the
compile-time built-in module contract on 2026-08-10; Gate C remains explicitly
closed.

| Gate C condition | Status | Current evidence |
| --- | --- | --- |
| Independent delivery is necessary | Fail | Current scenarios are finite and maintained with the application. |
| External or variable ownership exists | Fail | No separately owned extension is identified. |
| Trust and failure models exist | Fail | No runtime-extension security or compatibility specification exists. |
| Windows/Wails distribution is proven | Fail | No runtime package loading path exists or is currently required. |

**Gate C decision:** explicitly not admitted. Dynamic plugin loading, plugin
installation, a marketplace, and third-party execution are out of the current
implementation scope.

## 9. Phase A Exit Evidence

Phase A completed on 2026-08-09 without changing Project v3 or adding a feature
registry.

| Exit standard | Evidence |
| --- | --- |
| Composition root | `App.tsx` is 18 lines and only mounts theme, Univer, and `WorkspaceApplication`. |
| Independent orchestration | `projectLifecycle`, `workbookRuntime`, `projectExecution`, `workspaceHistory`, and `diagnostics` have direct unit tests. |
| Bounded capabilities | `SpreadsheetCapability` contains workbook/sheet/range operations and imports no Block or Region type. |
| Persistence compatibility | Strict Project v3 schema/runtime, canonical round-trip, persistence, and native open/save/save-as tests pass; Project versions 1 and 2 are rejected. |
| Scenario isolation | Config, preview, reconciliation, execution persistence, and diagnostics use capability or reader interfaces rather than bridge or raw Univer objects. |
| Workflow regression | Type check; 188 renderer tests; 3 main tests; 29 browser tests with 4 expected skips; 17 Electron tests; Go tests; 5 release tests; production build. |

## 10. Phase B Exit Evidence

Phase B completed on 2026-08-10 without adding runtime plugin loading or
Project v1/v2 compatibility.

| Exit standard | Evidence |
| --- | --- |
| Common operational contract | Block, Region, and External Review register schema identity, lifecycle, validation, diagnostics, execution, and panel contributions through the same registries. |
| Branch-free host composition | Selection, canvas ranges, active items, execution readiness, diagnostic focus, navigation, panels, and result views are registry contributions; the shell does not dispatch on Block or Region IDs. |
| Strict Project v3 | AJV schema and runtime validation use one complete-field golden fixture, 20 malformed structural cases, semantic ownership cases, canonical round-trips, non-mutation checks, and explicit v1/v2 rejection. |
| Persistence | The complete fixture passes Save, Save As, recovery, undo/redo, workbook switching, reassignment/removal, unavailable-source handling, and Electron native open/save without semantic loss. |
| Failure and cancellation | Contract tests isolate execution/save failures, lifecycle cleanup, panel render failures, and late async cancellation. |
| Verification | Type check; 206 renderer tests; 3 main tests; 33 browser tests with 4 expected Electron-only skips; 18 Electron E2E tests; Go tests; 7 release-script tests; production build. |

## 11. Approved Next Work

Do not start runtime plugins. Phase B is complete. Continue feature refinement,
Project v3 regression coverage, and Windows 11 release preparation. External
Structured Result Review remains development-only until a separate product and
persistence decision promotes it; Gate C remains closed.
