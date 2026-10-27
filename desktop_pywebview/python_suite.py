"""Python workspace UI, real native execution and generated-file export."""

from collections import deque
import json
from pathlib import Path
import shutil
import threading
import time

from .native_suite import NativeSuiteAPI, NativeUI, fixture


class NativePythonAPI(NativeSuiteAPI):
    def __init__(self, recovery_dir):
        super().__init__(recovery_dir)
        self._runs = []
        self._exports = []
        self._confirmations = deque()
        self._running = threading.Event()
        self._cancels = []

    def Ready(self):
        self._window.evaluate_js("""(() => {
          window.__nativePythonErrors = [];
          window.__nativePythonReads = [];
          const readFile = window.pywebview.api.ReadFile;
          window.pywebview.api.ReadFile = async (...args) => {
            const entry = {path: args[0], started: performance.now(), status: 'pending'};
            window.__nativePythonReads.push(entry);
            try {
              const result = await readFile(...args);
              Object.assign(entry, {status: 'resolved', elapsed: performance.now() - entry.started, length: result?.length});
              return result;
            } catch (error) {
              Object.assign(entry, {status: 'rejected', error: String(error)});
              throw error;
            }
          };
          window.addEventListener('error', event => window.__nativePythonErrors.push(String(event.error || event.message) + '\\n' + (event.error?.stack || '')));
          window.addEventListener('unhandledrejection', event => window.__nativePythonErrors.push(String(event.reason) + '\\n' + (event.reason?.stack || '')));
        })()""")
        super().Ready()

    def ReadFile(self, path):
        started = time.monotonic()
        result = super().ReadFile(path)
        print(f'Python suite workbook read: {Path(path).name} ({time.monotonic() - started:.2f}s)', flush=True)
        return result

    def RunProjectPython(self, project, context_json):
        self._running.set()
        print(f'Python native bridge: starting run {len(self._runs) + 1}', flush=True)
        try:
            result = super().RunProjectPython(project, context_json)
            self._runs.append((project, json.loads(context_json), result))
            print(f'Python native bridge: completed run {len(self._runs)} (ok={result["ok"]})', flush=True)
            return result
        finally:
            self._running.clear()

    def CancelPythonRun(self):
        result = super().CancelPythonRun()
        self._cancels.append(result)
        return result

    def ExportPythonArtifacts(self, name, artifacts_json):
        result = super().ExportPythonArtifacts(name, artifacts_json)
        self._exports.append(result)
        return result

    def _confirmation(self, title, message):
        if title != 'Replace generated files?' or not self._confirmations:
            raise RuntimeError(f'Unexpected native confirmation: {title}')
        return self._confirmations.popleft()


SOURCE = """import json
import sys
import csv, decimal, statistics, ssl, sqlite3, urllib.request
from pathlib import Path
from generators.summary import summarize

def process(context):
    assert decimal.Decimal('0.1') + decimal.Decimal('0.2') == decimal.Decimal('0.3')
    assert statistics.mean([2, 4]) == 3
    with sqlite3.connect(':memory:') as database:
        assert database.execute('select 1').fetchone()[0] == 1
    Path('trusted-runtime-check.txt').write_text('trusted filesystem access', encoding='utf-8')
    assert Path('trusted-runtime-check.txt').read_text(encoding='utf-8') == 'trusted filesystem access'
    summary = summarize(context)
    print('native workspace pipeline complete')
    sys.stderr.write('checked both workbooks\\n')
    return {'result': summary, 'artifacts': [
        {'path': 'models/customer.py', 'content': 'class Customer:\\n    pass\\n'},
        {'path': 'schema/customer.json', 'content': json.dumps(summary)},
        {'path': 'rtl/customer.sv', 'content': 'module customer;\\nendmodule\\n'},
    ]}
"""

HELPER = """def summarize(context):
    assert context['contractVersion'] == 1
    blocks = {block['workbookId']: block for block in context['blockResults']}
    sales = blocks['sales']['data'][0]
    catalog = blocks['catalog']['data'][0]
    assert sales == {'name': 'Alice', 'age': 25}
    assert catalog == {'id': 'P001', 'name': 'Widget A', 'price': 19.99}
    assert len(context['project']['workbooks']) == 2
    assert len(context['regionResults']) == 1
    assert context['regionResults'][0]['label'] == 'catalog_region'
    return {'sales': sales, 'catalog': catalog, 'regionCount': 1}
"""


def run(window, api, directory):
    ui = NativeUI(window)
    root = Path(__file__).resolve().parents[1]
    directory = Path(directory)
    sources = directory / 'workbooks'
    sources.mkdir()
    shutil.copyfile(root / 'examples/test_data.xlsx', sources / 'sales.xlsx')
    shutil.copyfile(root / 'examples/multi_sheet.xlsx', sources / 'catalog.xlsx')
    project = fixture()
    for block in project['project']['blocks']:
        block['selectionLocked'] = True
    project['project']['pythonScript'] = {'entryPath': 'main.py', 'files': [
        {'path': 'main.py', 'source': SOURCE}, {'path': 'generators/summary.py', 'source': HELPER},
    ]}
    path = directory / 'Python workflow.json'
    path.write_text(json.dumps(project), encoding='utf-8')
    ui.wait('Boolean(window.pywebview?.runtimeInfo)')
    api._select('OPEN', path)
    ui.button('Open Project')
    ui.wait("document.querySelectorAll('.workbook-tab').length === 2 && document.querySelector('.card-title-input')?.value === 'records'")
    ui.menu('Project Python')
    ui.wait("Boolean(document.querySelector('.python-project-workspace .cm-editor'))")
    ui.wait("document.querySelector('.python-project-editor > header')?.textContent.includes('main.py')")
    ui.tab('Input')
    ui.button('Refresh Input')
    ui.wait("document.querySelector('.python-project-input-json')?.textContent.includes('Alice') && document.querySelector('.python-project-input-json')?.textContent.includes('catalog_region')")
    if api._runs:
        raise RuntimeError('Refresh Input unexpectedly executed Python')
    print('PASS pywebview Python: real two-workbook/region input without preview or script execution', flush=True)

    ui.button('Run')
    ui.tab('Files (3)')
    if len(api._runs) != 1 or not api._runs[0][2]['ok']:
        raise RuntimeError(f'Native Python execution failed: {api._runs}')
    script, context, result = api._runs[0]
    if len(script['files']) != 2 or not context['data']:
        raise RuntimeError('The UI did not provide the complete package and parsed data')
    print('PASS pywebview Python: real multi-file helper receives both workbook blocks and region context', flush=True)
    for name, text in [('customer.py', 'class Customer'), ('customer.json', 'Alice'), ('customer.sv', 'module customer')]:
        ui.click('.python-artifact-tree .ant-tree-title', name)
        ui.wait(f"document.querySelector('.python-artifact-preview .shiki')?.textContent.includes({json.dumps(text)})")
    ui.tab('Result')
    ui.wait("document.querySelector('.python-project-workspace')?.textContent.includes('Widget A')")
    ui.tab('Output')
    ui.wait("document.querySelector('.python-project-workspace')?.textContent.includes('native workspace pipeline complete') && document.querySelector('.python-project-workspace')?.textContent.includes('checked both workbooks')")
    print('PASS pywebview Python: actual result, stdout/stderr and JSON/Python/SystemVerilog file previews', flush=True)

    destination = directory / 'generated'
    destination.mkdir()

    def export(selected):
        before = len(api._exports)
        ready = f"Boolean({ui.matching('button', 'Save generated files')}) && !({ui.matching('button', 'Save generated files')}).disabled && !({ui.matching('button', 'Save generated files')}).classList.contains('ant-btn-loading')"
        ui.wait(ready)
        api._select('FOLDER', selected)
        ui.button('Save generated files')
        deadline = time.monotonic() + 30
        while len(api._exports) == before:
            if time.monotonic() >= deadline:
                raise RuntimeError(f'Generated-file export did not complete: calls={api._dialog_calls}, pending={list(api._selections)}, exports={api._exports}')
            time.sleep(0.1)
        ui.wait(ready)
        if len(api._exports) != before + 1:
            raise RuntimeError('Generated-file export did not finish through the native bridge')
        return api._exports[-1]

    if export(None).get('error') != 'cancelled' or list(destination.iterdir()):
        raise RuntimeError('Folder-dialog cancellation wrote generated files')
    if not export(destination).get('success'):
        raise RuntimeError('Generated-file save failed')
    if json.loads((destination / 'schema/customer.json').read_text()) != json.loads(result['resultJson'])['result']:
        raise RuntimeError('Saved JSON does not match the actual Python result')
    if (destination / 'models/customer.py').read_text() != 'class Customer:\n    pass\n' or (destination / 'rtl/customer.sv').read_text() != 'module customer;\nendmodule\n':
        raise RuntimeError('Saved Python/SystemVerilog artifacts differ')
    print('PASS pywebview Python: cancelled folder selection and exact nested UTF-8 file writes', flush=True)
    sentinel = destination / 'schema/customer.json'
    sentinel.write_text('keep existing content', encoding='utf-8')
    api._confirmations.append(False)
    if export(destination).get('error') != 'cancelled' or sentinel.read_text() != 'keep existing content':
        raise RuntimeError('Declined overwrite modified an existing file')
    api._confirmations.append(True)
    if not export(destination).get('success') or json.loads(sentinel.read_text()) != json.loads(result['resultJson'])['result']:
        raise RuntimeError('Confirmed overwrite did not restore generated content')
    if api._selections or api._confirmations:
        raise RuntimeError('Unconsumed native dialog selections')
    ui.button('Back to workspace')
    ui.wait("!document.querySelector('.python-project-workspace') && Boolean(document.querySelector('.card-title-input'))")
    print('PASS pywebview Python: overwrite decline/accept and return to workspace', flush=True)
    def open_script(name, source):
        variant = json.loads(json.dumps(project))
        label = name.replace(' ', '_')
        variant['project']['blocks'][0]['label'] = label
        variant['project']['pythonScript']['files'][0]['source'] = source
        selected = directory / f'{name}.json'
        selected.write_text(json.dumps(variant), encoding='utf-8')
        api._select('OPEN', selected)
        ui.button('Open Project')
        deadline = time.monotonic() + 30
        while api._selections and not ui.read(ui.modal_open('Open another project?')):
            if time.monotonic() >= deadline:
                raise RuntimeError('Open Project neither requested a file nor displayed confirmation')
            time.sleep(0.1)
        if ui.read(ui.modal_open('Open another project?')):
            ui.choose('Open another project?', 2)
        ui.wait(f"!document.querySelector('.python-project-workspace') && document.querySelector('.card-title-input')?.value === {json.dumps(label)}")
        ui.wait("(() => { const cached = window.__excelBlockParserStagedCacheState?.().sales; return cached && (!cached.staged || cached.hydrated) && window.__excelBlockParserSelectionState?.()?.sheetName === 'Sheet1'; })()", timeout=60)
        ui.menu('Project Python')
        ui.wait("Boolean(document.querySelector('.python-project-workspace .cm-editor'))")
        errors = ui.read('window.__nativePythonErrors')
        if errors:
            raise RuntimeError(f'Unhandled frontend errors during project/Python transition: {errors}')

    def wait_run(count):
        deadline = time.monotonic() + 60
        while len(api._runs) < count:
            if time.monotonic() >= deadline:
                state = ui.read("({reads: window.__nativePythonReads, errors: window.__nativePythonErrors, text: document.body.innerText.slice(0, 5000), buttons: Array.from(document.querySelectorAll('.python-header-actions button')).map(node => ({text: node.textContent, disabled: node.disabled})), editor: document.querySelector('.cm-content')?.textContent})")
                raise RuntimeError(f'Python UI run did not finish: count={len(api._runs)}, running={api._running.is_set()}, state={state}')
            time.sleep(0.1)
        ui.wait("!Array.from(document.querySelectorAll('button')).some(node => node.textContent.trim() === 'Cancel run')")
        return api._runs[-1][2]

    open_script('Runtime failure', "def process(context):\n    raise ValueError('native UI runtime failure')\n")
    ui.wait(f"Boolean({ui.matching('button', 'Run')}) && !({ui.matching('button', 'Run')}).disabled")
    consumed = ui.read("(() => { const event = new KeyboardEvent('keydown', {key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true}); document.querySelector('.cm-content').dispatchEvent(event); return event.defaultPrevented; })()")
    if not consumed:
        raise RuntimeError('Python Run keyboard shortcut was not handled')
    failure = wait_run(2)
    if failure['ok']:
        raise RuntimeError('Runtime failure was incorrectly reported as successful')
    ui.wait("Array.from(document.querySelectorAll('.python-project-workspace .ant-alert')).some(node => node.textContent.includes('native UI runtime failure'))")
    print('PASS pywebview Python: keyboard run surfaces real runtime error', flush=True)
    ui.button('Back to workspace')
    ui.wait("!document.querySelector('.python-project-workspace')")

    open_script('Cancel execution', 'def process(context):\n    while True:\n        pass\n')
    ui.button('Run')
    if not api._running.wait(60):
        raise RuntimeError('Infinite script never reached the native execution bridge')
    ui.button('Cancel run')
    cancelled = wait_run(3)
    if cancelled['ok'] or not api._cancels or not api._cancels[-1]:
        raise RuntimeError(f'Cancellation failed: {cancelled}, {api._cancels}')
    if 'KeyboardInterrupt' not in cancelled.get('error', ''):
        raise RuntimeError(f'Cancellation did not report cancellation: {cancelled}')
    print('PASS pywebview Python: UI cancels actual infinite execution', flush=True)
    ui.button('Back to workspace')
    ui.wait("!document.querySelector('.python-project-workspace')")

    open_script('Run after cancel', SOURCE)
    ui.button('Run')
    resumed = wait_run(4)
    if not resumed['ok'] or json.loads(resumed['resultJson']) != json.loads(result['resultJson']):
        raise RuntimeError(f'Post-cancellation run did not recover: {resumed}')
    ui.tab('Files (3)')
    if api._selections or api._confirmations:
        raise RuntimeError('Unconsumed native choices after Python regression')
    print('PASS pywebview Python: successful multi-file rerun after cancellation', flush=True)
    print('pywebview native Python workspace suite: 8 scenarios passed', flush=True)
