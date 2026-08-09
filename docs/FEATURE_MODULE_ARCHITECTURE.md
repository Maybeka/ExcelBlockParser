# Feature Module Architecture and Adoption Gates

**Status:** Phase A complete; Gate B not admitted
**Applies to:** Post-v1 scenario growth
**Last assessed:** 2026-08-09 after Phase A verification

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
| Persistence strategy is approved | v3 adapters and any future schema migration preserve existing projects and unknown state. |
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
- Contract tests and end-to-end tests cover activation, execution, persistence,
  migration, failure, teardown, and multi-workbook ownership.
- Project v3 compatibility or an explicitly versioned migration is proven with
  fixtures.

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

Assessment is against the working tree based on commit `19147c9` on
2026-08-09, including the Gate A preparation changes described below.

| Gate A condition | Status | Current evidence |
| --- | --- | --- |
| Baseline is reproducible | Pass | The current working tree passed type checks, 166 renderer/unit tests, 3 main-process tests, Go tests, 29 browser tests with 4 skipped, 17 hidden Electron E2E tests, release-script tests, and the production build. |
| Current contract is explicit | Pass | Project v3 is documented and has `project-v3.schema.json`; legacy v1/v2 migration is implemented. |
| Current behavior is protected | Pass | Direct tests cover project lifecycle, multi-workbook isolation and switching, save/recovery, Block, Region, diagnostics, and preview workflows. |
| Change isolation is possible | Pass | Initial project/workbook commands are pure functions in `services/project.ts`, are exercised without rendering React, and are used by `App.tsx` for initialization, source maintenance, load completion, switching, removal, active-sheet changes, and save normalization. This creates a tested incremental boundary while Project v3 and UI behavior remain unchanged. |
| Ownership is recorded | Pass after this decision | This document defines the intended dependency and responsibility boundaries. |

**Gate A decision:** admitted. Phase A may incrementally extract project
lifecycle, workbook runtime coordination, execution, dirty state/history, and
diagnostics behind host-neutral interfaces. Every increment must retain the
pure-command tests, Project v3 round-trip behavior, and existing E2E workflows.
Project v3 changes remain outside Phase A.

| Gate B condition | Status | Current evidence |
| --- | --- | --- |
| A third scenario is concrete | Pass | `SCENARIO_EXTERNAL_RESULT_REVIEW.md` defines inputs, state, workbook operations, right-panel and result UI, output, diagnostics, security, and lifecycle for external/LLM-generated result review. |
| Commonality is demonstrated | Partial | The third scenario confirms shared needs for transactions, diagnostics, cancellation, workbook navigation, panel hosting, and persistence, but no common contract prototype exists yet. |
| Core orchestration is extracted | Pass | `App.tsx` is an 18-line composition root. Project lifecycle, workbook runtime, execution/preview preparation, workspace history/dirty transitions, and diagnostic focus decisions have UI-independent services and tests. |
| Persistence strategy is approved | Partial | Project v3 is stable, but its top-level `blocks` and `regions` fields encode current scenarios directly; no feature-state adapter policy is implemented. |
| UI host contract is prototyped | Fail | The right panel renders Block and Region through application-owned branches rather than a feature registration host. |

**Gate B decision:** not admitted. Core extraction is no longer the blocker, but
the common feature contract, v3 adapter policy, and two-view panel-host prototype
are not yet proven. The repository must not freeze or broadly implement a
feature-module API yet.

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
| Persistence compatibility | Existing serializer migration and Project v3 round-trip tests pass; native open/save/save-as workflows pass. |
| Scenario isolation | Config, preview, reconciliation, execution persistence, and diagnostics use capability or reader interfaces rather than bridge or raw Univer objects. |
| Workflow regression | Type check; 188 renderer tests; 3 main tests; 29 browser tests with 4 expected skips; 17 Electron tests; Go tests; 5 release tests; production build. |

## 10. Approved Next Work

Do not start runtime plugins. The next architecture work is limited to Gate B
evidence: prototype two materially different built-in right-panel views, define
the v3 compatibility adapter policy, and validate the common contract against
Block, Region, and External Structured Result Review. Gate B must be reassessed
after that evidence exists.
