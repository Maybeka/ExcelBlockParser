# v1.0 Release Acceptance

Version 1.0 is not released until every gate below passes on the release
candidate. Wails is the production runtime. Electron checks are retained to
protect the shared renderer and bridge contract during development; they do not
produce release artifacts.

## Product Gates

1. The documented workbook-to-JSON workflow works without data loss for every
   supported fixture: open, sheet navigation, range capture, block and region
   configuration, parse, diagnostics, preview, export, session export/import,
   reconciliation, and recovery.
2. All destructive or context-changing actions have clear, correct state
   handling: switching workbooks, closing workbooks, discard confirmation, and
   left-navigation synchronization.
3. The workspace is dense, keyboard-accessible, responsive at supported window
   sizes, and has no stale sheet, selection, preview, or diagnostic state.
4. Session schema v2 round-trips through JSON serialization/import without a
   changed configuration or output. Version 1 imports retain their documented
   migration behavior.

## Engineering Gates

1. Type checking, configured quality checks, unit tests, and fixture-based
   integration tests pass in continuous integration. A linter is required only
   after it is intentionally configured as a repository check.
2. Tests cover extraction semantics, malformed sessions, reconciliation,
   recovery, bridge errors, workbook lifecycle, and regression cases for every
   fixed release-blocking defect.
3. Browser renderer tests, Electron development E2E, and Wails production E2E
   pass. The Wails suite covers native dialogs/bridge operations through a
   controlled test seam, not only browser mocks.
4. The Wails Go layer has unit/integration coverage for path authorization,
   size and time limits, recovery persistence, import/export, and bridge error
   translation.
5. No known critical or high-severity defect remains. A defect that corrupts
   template/output data, loses recoverable state, bypasses a filesystem policy,
   blocks the documented workflow, or creates materially inconsistent UI state
   blocks release.

## Wails Production Gates

1. The Wails bridge implements every production capability used by the renderer
   with stable typed behavior: workbook/session open, JSON/session save,
   recovery save/load/clear, preview events, and error reporting.
2. Wails uses explicit, tested path and size controls. Arbitrary renderer file
   access is prohibited.
3. A packaged Wails build is smoke-tested on each supported release platform.
   Electron packages are not release candidates.
4. Install, upgrade, launch, open, export, recovery, and uninstall behavior is
   documented and manually accepted on the release platforms.
5. Windows Authenticode signing, installer metadata, and release artifact
   retention are configured for the Windows target declared in `SUPPORT.md`.

## Performance Gate

A generated 50,000-cell workbook loads and extracts to JSON in under 12
seconds on the designated release runner. Workbooks that exceed documented
limits are rejected with actionable diagnostics rather than partially
processed.

## Deferred Work

The extension platform, external plugins, Python code-generation runner, and
LLM generation-artifact import are post-v1 work. They must not be introduced
into the v1.0 release branch.
