# Release Acceptance

Version 1.0.0 was accepted and tagged on 2026-08-09. The gates below are the
baseline for subsequent release candidates unless a version-specific release
plan explicitly strengthens them. Wails is the production runtime. Electron
checks protect the shared renderer and bridge contract during development; they
do not produce release artifacts.

## Current Verification Status

Automated desktop UI coverage currently runs through Electron only. The Wails
Go layer has tests and build checks, but no Wails desktop/WebView E2E suite
exists yet; that coverage is not a current release requirement. Electron is
the automated desktop regression path for the current development line.

## Product Gates

1. The documented workbook-to-JSON workflow works without data loss for every
   supported fixture: project open/save, workbook loading, sheet navigation,
   range capture, Block and Region configuration, parse, diagnostics, preview,
   reconciliation, and recovery.
2. All destructive or context-changing actions have clear, correct state
   handling: switching workbooks, removing workbook sources, closing projects,
   discard confirmation, and left-navigation synchronization.
3. The workspace is dense, keyboard-accessible, responsive at supported window
   sizes, and has no stale sheet, selection, preview, or diagnostic state.
4. Project v3 round-trips through JSON serialization/import without semantic
   data loss. Legacy Session v1 and v2 imports retain their documented
   migration behavior.

## Engineering Gates

1. Type checking, configured quality checks, unit tests, and fixture-based
   integration tests pass in continuous integration. A linter is required only
   after it is intentionally configured as a repository check.
2. Tests cover extraction semantics, malformed sessions, reconciliation,
   recovery, bridge errors, workbook lifecycle, and regression cases for every
   fixed release-blocking defect.
3. Browser renderer tests and Electron development E2E pass. Wails
   desktop/WebView E2E is not a current gate; native bridge behavior is covered by
   Go tests and the Windows 11 manual-acceptance gate.
4. The Wails Go layer has unit/integration coverage for path authorization,
   size and time limits, recovery persistence, import/export, and bridge error
   translation.
5. No known critical or high-severity defect remains. A defect that corrupts
   template/output data, loses recoverable state, bypasses a filesystem policy,
   blocks the documented workflow, or creates materially inconsistent UI state
   blocks release.

## Wails Production Gates

1. The Wails bridge implements every production capability used by the renderer
   with stable typed behavior: workbook/project open, project save,
   recovery save/load/clear, preview events, and error reporting.
2. Wails uses explicit, tested path and size controls. Arbitrary renderer file
   access is prohibited.
3. A packaged Wails build is smoke-tested on Windows 11 x64. Electron packages
   are not release candidates.
4. Launch, open, export, recovery, and close behavior is documented and
   manually accepted from the Wails ZIP candidate on Windows 11 x64.
5. The candidate ZIP and its SHA-256 sidecar are retained with the release
   evidence. Authenticode signing and installer metadata remain deferred.

## Performance Gate

A generated 50,000-cell workbook loads and extracts to JSON in under 12
seconds on the designated release runner. Workbooks that exceed documented
limits are rejected with actionable diagnostics rather than partially
processed.

## Architecture Boundary

Runtime plugins, Python code-generation execution, and in-app LLM integration
are not part of the 1.1.0 development baseline. Built-in feature-module work is
governed by `FEATURE_MODULE_ARCHITECTURE.md` and may begin only after its Gate B
entry evidence is complete.
