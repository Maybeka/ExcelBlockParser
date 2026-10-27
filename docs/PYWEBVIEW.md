# pywebview Desktop Host

The application uses a Python-owned desktop host for the React/Univer frontend.
It replaces the previous Wails GUI host while preserving Project v3, Block,
Region and the project Python input/result contract. Windows 11 x64 is the production target;
macOS supports local development. Automated Windows acceptance does not assert
physical Windows 11 or general font/placement fidelity.

## Architecture

The Python host owns the native window, project and workbook file dialogs,
authorized reads, project saving, recovery, JSON-only drop handling, and
generated-file export. The frontend waits for `pywebviewready` before creating
its desktop bridge; it does not depend on generated Wails bindings.

A Python service process provides the `process(context)` package contract and
starts a disposable bundled CPython process for each explicit run. Organization
scripts are trusted, with current-user filesystem, network and process access;
this is not a sandbox. Cancellation stops the run and descendants, not prior
external side effects. Output/result bounds remain; the former WASM memory cap
does not. See `PROJECT_PYTHON.md` for the complete execution contract.

MathType conversion is a Python port of `mtef-mathml` v0.2.0, checked against 31
captured stream cases and 771 node/layout outputs. Windows EMF/WMF previews use
GDI+ through `ctypes`. No Go source, build tool or compiled Go helper is needed.

Workbook authorization keys use Windows path rules on Windows, accepting slash
and case variants of already-approved paths without authorizing other files.
Drive and UNC aliases have regression coverage; these simulated path tests do
not substitute for a Windows runtime replay.

Protocol writes have their own serialization lock. The response reader does not
need that lock, so a write waiting for pipe capacity cannot block dispatch of an
earlier response. Regression tests reproduce the old lock dependency and check
concurrent request/response matching without interleaved messages.

Confirmed exit uses a two-stage handshake: the confirmation RPC returns before
the frontend emits a one-way native DOM notification to destroy the window.
Closing inside the RPC can leave a macOS WebView response thread waiting on a
page that no longer exists. Native smoke verification clicks Discard and checks
that the process exits, rather than only calling the host's quit method.

Installation and desktop builds apply the existing outline patch and a formula
startup-buffer patch to Univer. The latter flushes queued registrations once when
calculation starts, then retains direct registration. It avoids recursive
resubscription to an already-true BehaviorSubject. ESM/CommonJS behavior and
idempotency are covered by tests; incompatible dependency layouts fail the patch
rather than silently building without it.

## Setup and Development

Use Python 3.12 and Node.js 22.

On Windows:

```powershell
py -3.12 -m venv .venv-pywebview
.venv-pywebview\Scripts\python.exe -m pip install -r desktop_pywebview/requirements.txt
npm ci
npm run dev:pywebview
```

On macOS:

```sh
python3.12 -m venv .venv-pywebview
.venv-pywebview/bin/python -m pip install -r desktop_pywebview/requirements.txt
npm ci
npm run dev:pywebview
```

The command builds the shared frontend, then opens pywebview.
For an already built frontend, launch `python -m desktop_pywebview
--debug` using the virtual environment. Set `PYWEBVIEW_PYTHON` when using a
different interpreter location. Windows explicitly uses EdgeChromium/WebView2;
macOS uses WKWebView. Recovery remains in the existing pywebview profile,
separate from old Wails recovery. Save old sessions before switching; old
recovery is neither automatically imported nor deleted. See `SUPPORT.md`.

## Verification

Install `desktop_pywebview/requirements-build.txt` in the virtual environment
before running the complete host tests. The Windows EMF test uses Pillow to
decode the native GDI+ output and check nonblank pixels; packaging and optional
macOS snapshots also need these build dependencies.

```sh
npm run test:pywebview
npm run test:pywebview:native
npm run test:pywebview:parity
npm run test:pywebview:recovery
npm run test:pywebview:project
npm run test:pywebview:browser
npm run test:pywebview:drawings
npm run test:pywebview:preferences
npm run test:pywebview:outline
npm run test:pywebview:python
npm run test:pywebview:window
```

The host suite covers workbook authorization, relative paths, project
open/save/recovery, close events, safe export paths, conflict confirmation,
multi-file Python input and output, runtime failures, cancellation, and helper
cleanup. The native smoke check opens a hidden real WebView, loads an example
project and workbook, executes Python through the JavaScript bridge, and checks
save/recovery before automatically closing the window and local asset server.
It also modifies an extraction, triggers the OS close callback, verifies the
three-choice confirmation, and cancels without losing the modification. Hidden
WebViews pause animation frames, so the background test checks the dialog's
exit state rather than waiting for its exit animation. It stores project and
recovery state in temporary directories.

The native smoke first triggers the OS close callback and cancels the three-choice
dialog. It then clicks the actual custom titlebar Close button and chooses
Discard, checking that edits were not written. Also exercise Save before exit
with the virtual-environment Python:
`python -m desktop_pywebview --smoke-test --smoke-close-action save`. This checks
the saved block label after native window closure. Both runs must exit without
leaving a host or helper process; the packaged executable accepts the same flags.

The local MathType integration test uses `.tmp/征地col.xlsx` when available;
it reports a skip if the private reference workbook is absent.

A Windows-only test reads the public fixture's EMF preview and calls the actual
host byte-array bridge through the native helper/GDI+ implementation. It requires
a valid, positive-size PNG with nonwhite pixels after compositing transparency
onto white. This test is explicitly skipped on macOS, not counted as a Windows
runtime pass. The manual Windows workflow runs it in the complete host suite.

The native parity suite exercises twelve renderer project scenarios with two real
relative-path workbooks: progressive cache switching, sidebar navigation,
global preview, Save As result isolation, cancellation, unsaved project close,
and reopening exported JSON. It also checks normal Save without a file dialog, failed
import retaining the current project, and New Project's first Save As.
Only native file-dialog selections are supplied by the test harness. It runs in
a hidden real WebView with test-only timer-driven
animation-frame callbacks and completes modal exit animation events after the
active leave phase, so it checks behavior and data, not visual painting
or physical interaction with OS dialogs. The packaged executable accepts
`--native-suite` as well.

On macOS, native test flags also install a non-activating Cocoa application
policy and suppress the backend's hidden-window activation request. Test windows
cannot become key windows. A native workspace observer detects activation of
the test process, and its foreground state is checked again after cleanup;
focus theft fails the test instead of producing a background pass. The original
backend object, observer and activation policy are restored on every exit path.
Normal startup does not install this handling or change its window focus policy.
Windows geometry acceptance still shows its test window and is not a background
interaction test.
On 2026-10-14, both macOS source and rebuilt packaged runs passed all 11 groups
with fresh completion reports; all 17 native processes in each mode passed the
activation observer and final foreground-state checks. Eight focused tests cover
normal/non-Cocoa no-ops, native method delegation, activation rejection, and
cleanup on failure. The complete host/helper/harness suite ran 82 cases: 81
passed and the Windows-only GDI+ case was explicitly skipped on macOS.

The recovery suite uses five fresh native application processes in two isolated
cycles: renderer autosave, restart and Recover, then restart and Discard; and
actual titlebar Discard exit followed by a fresh restart and Recover. It checks real reachable workbook restoration without
reassignment, restored unsaved-close protection through the custom titlebar,
Cancel preserving edits, Discard clearing recovery, and recoverable unsaved
state after the actual application exit without writing the project. The packaged executable
accepts `--native-recovery-suite`; its child processes use the same application
binary rather than an external Python installation.

The project/settings suite checks the complete v3 golden fixture against the
renderer-exported JSON, excluding only its timestamp and separately verified
rebased source paths. It also checks workbook-dialog cancellation, adding a real
source with its full path and no automatic extraction, Cancel retaining a source,
and confirmed removal clearing both live tabs and saved definitions. The packaged
executable accepts `--native-project-suite` and includes the same golden fixture.

The browser suite generates populated 12-by-8 ExcelJS workbooks with hidden
rows/columns, frozen panes, saved active cells, and multiple sheets. It checks
single-cell selection with restoration disabled, cached active-cell restoration
when enabled, sidebar sheet synchronization, global extraction focus, outline
toggles on a sheet without groups, and read-only browser tool gating. Its hidden
WebView assertions do not establish absence of transient visual flashes. The
packaged executable accepts `--native-browser-suite`; packaging includes these
generated fixtures, not private reference workbooks.

The drawing suite imports workbooks through the real project UI and checks live
Univer drawing resources in the native WebView. It covers an embedded PNG,
modern text-box OMML, and a public MathType OLE fixture using the native helper.
Each resource must decode with nonzero dimensions and nonblank canvas pixels;
SVG XML and viewBox geometry must be valid. Formula warnings/errors and speech
service resource requests fail the run. The packaged executable accepts
`--native-drawing-suite` and includes the same fixtures. Hidden ZIP loading has a
separate 90-second test wait; application timeouts are unchanged. These resource
checks do not verify drawing placement, font fidelity, or actual window painting.

The preferences suite uses three fresh native processes with different localhost
origins. It changes language through Project settings, verifies Chinese after
restart, switches back to English, and verifies the next restart. The packaged
executable accepts `--native-preferences-suite`. Test preferences and recovery
are isolated in a temporary directory. The host stores language in
`preferences.json` alongside its recovery file and hydrates it before React
starts; saving uses atomic replacement and serialized bridge calls. This avoids
depending on WebView private-mode storage or a fixed localhost port. Side-panel
widths are not persisted by the existing frontend; this change does not add that
separate feature.

The outline suite uses a populated workbook containing nested row and column
groups plus ordinary hidden rows/columns. It emits events on the live native
outline control subscriptions, checks visibility and parent/child placement,
preserves child expansion state, verifies no workbook reads during toggles,
and checks that selection and ordinary hidden rows/columns remain unchanged.
The packaged executable accepts `--native-outline-suite`. Inspection/activation
hooks exist only with `navigator.webdriver`; these semantic tests do not cover
physical canvas hit-testing or compositor painting. View hydration uses native
visibility mutations instead of facade commands that also change selections.

The window suite checks actual native geometry through the titlebar button and
the blank-header double-click handler, including normal position/size restoration
and exclusion of control-area double-clicks. It accepts `--native-window-suite`
in source and packaged modes. macOS restores a saved native frame because
pywebview 6.2.1 Cocoa restore only deminiaturizes. Windows retains native
maximize/restore behavior. These tests do not establish physical dragging,
resize-edge behavior, minimizing, or Windows 11 acceptance.
The Windows geometry suite shows its test window because a hidden WinForms form
does not exercise actual maximized bounds. Other behavior suites remain hidden.
Its normal 1000-by-600 frame fits the hosted CI desktop; exact position and size
restoration are still required.

Passing the original Electron and browser suites is shared-code regression
evidence, not proof that all their scenarios have been replayed on pywebview.
Automated parity does not cover physical target-platform window interaction,
drag/drop, directory dialogs, or visual Windows EMF placement. No physical
acceptance is claimed. Historical Wails releases remain available as rollback
artifacts, not as a second source/build runtime.

The Python workspace suite uses actual renderer actions and the real isolated
helper. It checks refreshed two-workbook Block/Region input without executing a
script, multi-file imports, stdout/stderr/result, JSON/Python/SystemVerilog
artifact previews, folder cancellation, exact nested file writes, overwrite
decline/accept, runtime errors, run cancellation, and successful rerun after
cancellation. The packaged executable accepts `--native-python-suite`. Only OS
dialog choices are supplied by the harness; keyboard shortcut dispatch is a
semantic handler check, not a physical keyboard assertion. Hidden native tests
do not establish visual layout or target-platform dialog acceptance.
All eight scenarios pass in source and rebuilt macOS packaged modes (2026-10-12).
Hidden native suites additionally pump zero-delay timer macrotasks through
MessageChannel, retaining asynchronous FIFO delivery, cancellation and original
timer IDs; positive delays are unchanged. This test-only driver prevents hidden
WKWebView throttling from delaying ExcelJS tasks by nearly a minute. It is never
installed in normal application startup, and these timings are not production
performance measurements. Four scheduler tests check delivery, cancellation,
arguments, timer races and idempotency.

The current macOS package passes 50 native state/data scenarios:
12 project, 5 source/settings, 5 recovery, 7 browser, 4 drawing, 3 preferences,
3 outline, 3 window and 8 Python. The same rebuild also passes actual native
close Cancel and custom-titlebar Save/Discard exit paths. Shared frontend
regression passes 337 tests, formula-buffer patch tests pass 3, and
host/helper/harness tests pass 70, with the Windows-only GDI+ test explicitly
skipped on macOS. Original browser regression passes 45 tests
with 4 existing skips; Electron source regression passes 33 with 2 existing
skips. Main-process tests pass 5 and release-script tests pass 7. These shared
and Electron results are not pywebview-native acceptance. Windows 11 acceptance and physical/visual
checks remain separate and incomplete.

## Packaging

### macOS Native Snapshots

Set `PYWEBVIEW_NATIVE_SNAPSHOTS` to an ignored output directory when running
`--native-browser-suite` or `--native-drawing-suite` from source or the macOS
package. The opt-in helper
uses WKWebView's native snapshot API. It temporarily orders the test window behind
other windows without activating it, waits for native painting, then restores
its hidden state. Fully hidden snapshots do not reliably contain canvas content.
This helper is not installed during normal application startup and does not
support Windows yet.

Current screenshots show populated worksheet grids with a single A1
selection, the Office Math textbox, and the MathType formula after scrolling
to its actual K13 anchor. These are stable-frame checks, not proof against a
transient selection flash. Source and packaged drawing runs now check actual
pixels within the registered drawing's window-space bounds, including viewport
scroll and native snapshot scale. The PNG fixture passes on first load and after
project transitions; OMML and MathType pass too. Earlier blank PNG snapshots were
taken before drawing readiness, and an initial pixel check mistakenly selected
an off-screen editor canvas. No production image-loading workaround was added.
Nine isolated snapshot tests cover retry/blank-pixel failure, readiness failure,
native errors, timeout, disabled/unsupported modes, and visibility restoration.
This fixture evidence does not establish general font/placement fidelity.

### Windows CI Candidate

`.github/workflows/pywebview-windows.yml` is a manual and reusable candidate workflow.
The tag release workflow calls it before publishing the same verified bytes.
It installs the
Python runtime, runs pywebview host/helper regressions, builds the application,
and replays all source and packaged native suites through WebView2. Each suite
has a ten-minute limit, its own log and completion report, and process-tree
termination on timeout or interruption. Zero exit status without a fresh,
successful completion report is a failure, including console-free builds.
Logs are uploaded even when verification fails; the candidate application is
uploaded only after all preceding steps succeed.

The same bounded source runner is available locally after building the frontend,
helper and fixtures: `.venv-pywebview/Scripts/python.exe -m
desktop_pywebview.verify_native`. To test the packaged application, append
`--executable "release-pywebview/Excel Block Parser.exe"`
and use a distinct `--logs` directory. Restart children cannot overwrite the
parent suite's report.
The current macOS package passes all eleven runner groups with fresh completion
reports: 50 native state/data scenarios plus both smoke exit paths. The source
host previously passed the original ten groups; the expanded recovery cycle
and new window suite also pass from source. The completion
report and bounded-runner tests pass 10 cases. This evidence does not validate
the Windows-only process-tree termination branch or WebView2 runtime.
A passing Windows hosted-runner job does not establish Windows 11 physical or
visual acceptance. Manual checking of dialogs, drag/drop, pointer hit targets,
selection flashes and formula placement is outside the current migration goal:
the user explicitly excluded Windows manual acceptance on 2026-10-14.

On 2026-10-13, the Windows Server 2025 hosted runner passed both source and
packaged WebView2 acceptance at commit `61d2a90`: all 11 groups in each mode
produced fresh `completed=true` reports (50 scenarios plus both smoke exit paths).
Host/helper/harness tests ran 74 cases: 73 passed and the private local MathType
workbook case was explicitly skipped because it is not distributed. The public
MathType fixture and Windows-only real GDI+ EMF-to-PNG check passed.
See the [verified workflow run](https://github.com/Maybeka/ExcelBlockParser/actions/runs/38337167023).
That historical run tested an application directory before download/extraction,
not an Internet-marked distribution. The resulting preview failed on a user's
Windows machine during Python.NET initialization. CI dialog choices are supplied
by the harness; physical Windows 11
dialogs, drag/drop, pointer hit targets, and visual placement still need acceptance.

The Windows candidate now builds a single EXE. Distribution acceptance downloads
the release ZIP over a local HTTP connection, verifies its bytes, and explicitly
applies NTFS `Zone.Identifier` Internet-zone markers to the ZIP and every extracted
file, reproducing Explorer's downloaded-ZIP propagation (Python's extractor does
not propagate those markers itself). A negative control must reproduce the exact
CLR loader failure using the previous public onedir preview. The new single-file
EXE must complete both Save and Discard smoke scenarios with markers unchanged,
and report an isolated runtime directory that no longer exists after exit.
The full eleven packaged suites then run against that same marked, extracted EXE,
not the build-directory copy. This is automated Internet-zone simulation, not a
claim of driving a real browser download or Explorer UI.

The `pywebview-windows-x64-candidate` artifact contains the standalone EXE,
`SHA256SUMS.txt`, and a build manifest recording source and runtime versions.
It is uploaded only after all acceptance checks pass, without rebuilding the
verified executable. The distribution requires no separately shipped `_internal` directory,
automatic unblocking, a changed .NET trust configuration, or installed Python.

The Windows replay exposed a display-load completion race that cleared newer
extraction results before Save As. Results now invalidate before explicit source
attachment, addition, reassignment or refresh, not when a display load completes.
The same multi-workbook preview/save/reopen assertions passed on Windows after
the fix. The source-path golden test now distinguishes same-drive relative paths
from cross-drive absolute paths using platform path rules; application path
persistence logic was not changed for that test correction.

Install build dependencies in the same virtual environment:

```sh
python -m pip install -r desktop_pywebview/requirements-build.txt
npm run package:pywebview
```

Build on the target OS. PyInstaller packages Python, the platform WebView
bindings, standard library, Python services, frontend assets, and smoke-test examples into
`release-pywebview/`. Windows output is the standalone `Excel Block Parser.exe`;
macOS still produces `Excel Block Parser.app`. Windows onefile startup extracts
its bundled dependencies to a private temporary runtime directory and removes it
on normal exit. Those new temporary DLLs do not inherit the downloaded EXE's
Internet-zone marker. The original EXE stays marked; system security settings and
project files are not modified. This is single-file distribution, not in-memory
execution; startup needs temporary disk space and may take longer than onedir.
The launcher keeps its PyInstaller cache in ignored `.tmp/pyinstaller-cache`
unless `PYINSTALLER_CONFIG_DIR` is explicitly provided.
There is no native-helper cross-build step. Windows GDI+ and the complete
Windows single-file package must be tested on Windows.

## Capability Acceptance

| Desktop capability | pywebview implementation | Automated evidence |
| --- | --- | --- |
| Project open/save/save as | Native dialogs and authorized atomic JSON writes | Host tests, native bridge round trips and complete v3 golden documents |
| Workbook reads | Dialog/project-authorized bounded reads | Host tests and native workbook load |
| Recovery | Separate bounded JSON recovery store | Host and native bridge round trips |
| Window controls | Frameless native window and native state events | Host tests and real native maximize/restore geometry in source and package |
| Unsaved close | Native close is deferred to the existing three-choice renderer flow | Native Cancel/Discard/Save and recovery restart tests |
| Project drop | Native DOM event with full paths; one JSON only | Host event filtering and authorized JSON opening tests |
| Python execution | Disposable trusted CPython processes | Multi-file execution, standard-library imports, host file/network access, failures, cancellation and cleanup tests |
| Generated files | Validated UTF-8 relative paths and replacement confirmation | Actual nested writes, cancellation and overwrite decline/accept tests |
| MathType | Python port of mtef-mathml v0.2.0 | Captured conformance corpus, real workbook OLE samples and native resource/pixel checks |
| EMF/WMF | Windows GDI+ through ctypes | Windows real EMF rasterization, decoded PNG dimensions and nonwhite pixels |
| Distribution | Windows single-file EXE; macOS application bundle | Source/native regressions plus downloaded-package Internet-zone and cleanup checks in Windows CI |

The production host is verified using automated source and packaged evidence.
Physical Windows 11 interaction and visual acceptance are not claimed and are
not completion requirements for the host migration. Publication remains a
separate operation from merging source changes.

## Filesystem and Startup Boundaries

Source inspection and reads run in spawn-based worker processes with a 30-second
deadline. Timeouts and application exit terminate and join those workers, so a
blocked read cannot strand a bridge thread indefinitely. Packaged entry points
divert multiprocessing workers before starting the GUI. The frontend still owns
source availability reconciliation; project/recovery reads stay bounded at 25 MB
and workbook reads at 100 MB. Final project save targets must end in `.json`
(case-insensitive); an invalid or missing extension is rejected without writing.

Windowless startup exceptions write bounded, data-free metadata to
`startup-error.json` in the application profile and show an actionable error.
No project payload or exception message is copied into that diagnostic file.
Build manifests record actual dependency and tool versions; Windows Python.NET,
CLR loader and packager versions are pinned to the tested versions.
