# Release Acceptance

pywebview is the production desktop host. Electron and browser checks protect
shared application behavior but do not substitute for production-host tests.
The application-owned feature scope stays at Block, Region and project Python.

## Product Gates

1. Project v3 round-trips without losing workbook sources, extraction settings,
   Python files or results. Unsupported schema versions fail explicitly.
2. Multi-workbook loading, switching, global extraction navigation, filtering,
   preview and source-change reconciliation preserve correct ownership and state.
3. Save, Save As, cancellation, unsaved close and restart/recovery preserve data.
4. Known image, OMML, MathType and Windows EMF fixtures render nonblank resources
   without invalid SVG or speech-service requests. This is fixture coverage,
   not universal Excel-content or typography compatibility.

## Engineering Gates

1. Main-process, renderer/unit, browser, Electron development and production
   host/helper tests pass. Existing skips must be identified, not counted as passes.
2. Disposable CPython execution retains multi-file imports, error reporting,
   bounded output and cancellation tests. Trusted filesystem/network access and
   dynamically imported standard-library modules must work in packaged builds.
   Formula conversion matches the captured original stream and layout corpus.
3. File authorization, regular-file checks, size bounds, 30-second read deadlines,
   JSON save targets, safe generated-file paths and overwrite confirmation have
   regressions. Timeout and shutdown must reap file workers and helper processes.
4. Local GUI acceptance is non-activating on macOS in test mode only. Normal
   application focus behavior is unchanged.
5. No known critical or high-severity data-loss, workflow-blocking or ownership
   regression remains. Repository-wide type checks have a historical baseline;
   new host work must not introduce additional diagnostics or claim a clean
   whole-repository type check without executing the referenced configurations.

## Windows Distribution Gates

1. Build on Windows using pinned desktop dependencies and the required Node/
   Python versions. The shipped application is a single EXE plus checksum and
   provenance assets, not an EXE with a separately shipped `_internal` folder.
2. Source and packaged applications complete all eleven native acceptance groups
   with fresh completion reports. An exit code alone is not completion evidence.
3. The previous Internet-marked directory preview must reproduce its known CLR
   failure. The marked single-file replacement must complete real Save/Discard
   flows and clean temporary runtime files without unblocking its download marker.
4. Full packaged acceptance runs against the downloaded/extracted marked EXE.
   Release preparation checks its hash against the exact tested executable.
5. The publishing job verifies source commit, version and SHA-256, then uploads
   the same bytes. No rebuild is allowed between verification and publication.
6. Signing and installers remain deferred. Windows Server hosted-runner results
   are not Windows 11 physical/visual passes. Optional manual checks cover native
   file dialogs, pointer gestures, IME, DPI and multi-monitor behavior; they are
   not a required migration completion gate.

## Performance and Compatibility

Keep the generated workbook parser benchmark reproducible and record timings
when changing workbook or host I/O. Shared parser timings do not establish cold
onefile startup time, peak WebView2 memory, or large-project end-to-end latency.
These remain explicit measurement gaps, not claimed performance improvements.
Do not enlarge the frozen business scope to close unrelated Excel limitations.

## Recovery Handoff

Saved project files retain the current v3 contract. Existing pywebview profile
paths remain unchanged. Old GUI-host recovery is left untouched and is not
silently imported; users should save old sessions before switching applications.
Keep the previous stable release available for rollback.
