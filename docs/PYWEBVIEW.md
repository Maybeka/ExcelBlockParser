# pywebview Desktop Adapter

The `codex/pywebview-desktop` development line adds a Python-owned desktop host
for the existing React/Univer application. Project v3 and extraction behavior
are shared with the Wails application. This adapter is under development and
does not yet have Windows 11 release acceptance.

## Architecture

The Python host owns the native window, project and workbook file dialogs,
authorized reads, project saving, recovery, JSON-only drop handling, and
generated-file export. The frontend waits for `pywebviewready` before creating
its desktop bridge; it does not depend on generated Wails bindings.

A separate console-only Go helper preserves the existing `goccy/go-python`
isolated interpreter, `process(context)` package contract, memory limit,
cancellation, and `mtef-mathml` conversion. Windows EMF/WMF previews use the same
GDI+ implementation as Wails. The helper does not link the Wails window runtime.
The desktop host terminates and reaps the helper on exit. This migration changes
the desktop shell; it does not replace the script interpreter with unrestricted
host CPython.

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

Use Python 3.12, Node.js, and the Go version required by `go.mod`.

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

The command builds the shared frontend and native helper, then opens pywebview.
For an already built frontend/helper, launch `python -m desktop_pywebview
--debug` using the virtual environment. Set `PYWEBVIEW_PYTHON` when using a
different interpreter location. Windows explicitly uses EdgeChromium/WebView2;
macOS uses WKWebView. Recovery is stored separately from the production Wails
application during this migration.

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

Passing the original Electron, browser, and Go suites is shared-code regression
evidence, not proof that all their scenarios have been replayed on pywebview.
Native parity coverage remains partial; target-platform window interaction,
physical drag/drop, directory dialogs, and Windows EMF rendering still require
separate acceptance. Wails remains available during that work.

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

`.github/workflows/pywebview-windows.yml` is a manual-only candidate workflow.
It does not publish a release or replace the Wails workflows. It installs the
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
`--executable "release-pywebview/Excel Block Parser/Excel Block Parser.exe"`
and use a distinct `--logs` directory. Restart children cannot overwrite the
parent suite's report.
The current macOS package passes all eleven runner groups with fresh completion
reports: 50 native state/data scenarios plus both smoke exit paths. The source
host previously passed the original ten groups; the expanded recovery cycle
and new window suite also pass from source. The completion
report and bounded-runner tests pass 10 cases. This evidence does not validate
the Windows-only process-tree termination branch or WebView2 runtime.
A passing Windows hosted-runner job does not establish Windows 11 physical or
visual acceptance. Check the downloaded candidate's native dialogs, JSON drag/drop,
dirty-close choices, maximize/restore, outline hit targets, worksheet selection
flashes, and image/OMML/MathType placement on a Windows 11 machine before retiring
Wails.

On 2026-10-13, the Windows Server 2025 hosted runner passed both source and
packaged WebView2 acceptance at commit `61d2a90`: all 11 groups in each mode
produced fresh `completed=true` reports (50 scenarios plus both smoke exit paths).
Host/helper/harness tests ran 74 cases: 73 passed and the private local MathType
workbook case was explicitly skipped because it is not distributed. The public
MathType fixture and Windows-only real GDI+ EMF-to-PNG check passed.
See the [verified workflow run](https://github.com/Maybeka/ExcelBlockParser/actions/runs/38337167023).
The `pywebview-windows-x64-candidate` artifact is a candidate application directory,
not a release. CI dialog choices are supplied by the harness; physical Windows 11
dialogs, drag/drop, pointer hit targets, and visual placement still need acceptance.

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
bindings, the helper, frontend assets, and smoke-test examples into
`release-pywebview/`. Windows output is an application directory containing
`Excel Block Parser.exe`; macOS also produces `Excel Block Parser.app`.
The launcher keeps its PyInstaller cache in ignored `.tmp/pyinstaller-cache`
unless `PYINSTALLER_CONFIG_DIR` is explicitly provided.
The Windows helper can be cross-built with `python -m
desktop_pywebview.build_helper --windows`, but that does not produce or verify
a complete Windows package.

## Capability Acceptance

| Wails capability | pywebview implementation | Required evidence |
| --- | --- | --- |
| Project open/save/save as | Native dialogs and authorized atomic JSON writes | Host tests, native bridge round trips, native dialogs on target OS |
| Workbook reads | Dialog/project-authorized bounded reads | Host tests and native workbook load |
| Recovery | Separate bounded JSON recovery store | Host and native bridge round trips |
| Window controls | Frameless native window and native state events | Host tests; drag, maximize, minimize and close acceptance on target OS |
| Unsaved close | Native close is deferred to the existing three-choice renderer flow | Native dirty-project close test and target OS acceptance |
| Project drop | Native DOM event with full paths; one JSON only | Host event filtering, native opening event and physical drag/drop acceptance |
| Python execution | Existing isolated interpreter in a managed helper process | Real multi-file execution, failures, cancellation and cleanup tests |
| Generated files | Validated UTF-8 relative paths and replacement confirmation | Export tests and target OS directory/confirmation dialogs |
| MathType | Existing mtef-mathml v0.2.0 helper | Real workbook OLE samples and rendered output acceptance |
| EMF/WMF | Existing Windows GDI+ helper | Windows rendered preview acceptance |
| Distribution | PyInstaller application directory/bundle | Packaged native smoke and Windows 11 manual acceptance |

The adapter is not production-complete until the target OS acceptance items pass.
