"""Native UI parity checks; only OS file-dialog selections are supplied by tests."""

from collections import deque
import json
from pathlib import Path
import shutil

from .host import DesktopAPI
from .native_clock import ZERO_DELAY_TASK_PUMP
from .smoke import wait_for


class NativeSuiteAPI(DesktopAPI):
    def __init__(self, recovery_dir):
        super().__init__(recovery_dir)
        self._selections = deque()
        self._dialog_calls = []
        self._test_locale = 'en-US'

    def Ready(self):
        # Enable existing read-only inspection hooks before React is imported.
        self._window.evaluate_js(ZERO_DELAY_TASK_PUMP)
        self._window.evaluate_js("""(() => {
          Object.defineProperty(navigator, 'webdriver', {get: () => true, configurable: true});
          // Hidden WKWebViews suspend frame callbacks. Pump callback-only
          // frames for behavior tests; this is not a visual paint assertion.
          window.requestAnimationFrame = callback => window.setTimeout(() => callback(performance.now()), 16);
          window.cancelAnimationFrame = handle => window.clearTimeout(handle);
        })()""")
        if self._test_locale:
            self._window.evaluate_js(f"localStorage.setItem('excel-block-parser.locale', {json.dumps(self._test_locale)})")
        super().Ready()

    def _select(self, mode, path):
        self._selections.append((mode, None if path is None else (str(path),)))

    def _dialog(self, mode, **kwargs):
        self._dialog_calls.append((mode, kwargs))
        if not self._selections:
            raise RuntimeError(f"Unexpected native dialog: {mode}")
        expected, selection = self._selections.popleft()
        if mode != expected:
            raise RuntimeError(f"Expected {expected} dialog, received {mode}")
        return selection


class NativeUI:
    def __init__(self, window):
        self.window = window

    def read(self, expression):
        return self.window.evaluate_js(expression)

    def wait(self, expression, timeout=30):
        try:
            wait_for(self.window, expression, timeout=timeout)
        except RuntimeError:
            state = self.read("({cache: window.__excelBlockParserStagedCacheState?.(), selection: window.__excelBlockParserSelectionState?.(), modals: Array.from(document.querySelectorAll('.ant-modal')).map(node => ({classes: node.className, wrapDisplay: getComputedStyle(node.closest('.ant-modal-wrap')).display, buttons: Array.from(node.querySelectorAll('button')).map(button => ({label: button.getAttribute('aria-label') || button.textContent, disabled: button.disabled}))})), text: document.body.innerText.slice(0, 3000)})")
            print(json.dumps(state, ensure_ascii=False), flush=True)
            raise

    def matching(self, selector, label):
        return f"Array.from(document.querySelectorAll({json.dumps(selector)})).find(node => (node.getAttribute('aria-label') || node.title || node.textContent.trim()).startsWith({json.dumps(label)}))"

    def click(self, selector, label):
        target = self.matching(selector, label)
        self.wait(f"Boolean({target})")
        self.read(f"({target}).click()")

    def button(self, label):
        self.click('button', label)

    def menu(self, label):
        self.button('Project actions')
        self.click('[role="menuitem"]', label)

    def tab(self, label):
        target = self.matching('[role=tab]', label)
        self.wait(f"Boolean({target})")
        self.read(f"""(() => {{
          const tab = {target};
          if (tab.getAttribute('data-u-comp') === 'slide-tab-item') {{
            tab.focus();
            tab.dispatchEvent(new KeyboardEvent('keydown', {{key: 'Enter', bubbles: true}}));
          }} else tab.click();
        }})()""")
        self.wait(f"({target})?.getAttribute('aria-selected') === 'true'")

    def modal(self, title):
        return f"({self.matching('.ant-modal-title', title)})?.closest('.ant-modal')"

    def modal_open(self, title):
        modal = self.modal(title)
        return f"Boolean({modal}) && !({modal}).classList.contains('ant-zoom-leave') && getComputedStyle(({modal}).closest('.ant-modal-wrap')).display !== 'none'"

    def choose(self, title, index):
        self.wait(self.modal_open(title))
        self.read(f"({self.modal(title)}).querySelector('.ant-modal-footer button:nth-child({index})').click()")
        self.wait(f"!({self.modal_open(title)})")
        self.finish_exit(self.modal(title))

    def finish_exit(self, target):
        self.wait(f"!({target}) || ({target}).classList.contains('ant-zoom-leave-active') || getComputedStyle(({target}).closest('.ant-modal-wrap')).display === 'none'")
        self.read(f"({target})?.dispatchEvent(new AnimationEvent('animationend', {{bubbles: true}}))")
        # The mask has its own CSS leave animation and completion handler.
        self.read("document.querySelectorAll('.ant-modal-mask.ant-fade-leave-active').forEach(mask => mask.dispatchEvent(new AnimationEvent('animationend', {bubbles: true})))")

    def rename(self, label):
        self.read(f"""(() => {{
          const input = document.querySelector('.card-title-input');
          if (!input) throw new Error('No extraction title input');
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, {json.dumps(label)});
          input.dispatchEvent(new Event('input', {{bubbles: true}}));
        }})()""")
        self.wait(f"document.querySelector('.card-title-input')?.value === {json.dumps(label)}")


def fixture():
    def column(index, letter, key, kind):
        return dict(colIndex=index, colLetter=letter, suggestedKey=key, key=key,
                    type=kind, skip=False, valueMap=[])

    def block(identifier, workbook, sheet, columns):
        return dict(id=identifier, label="records", workbookId=workbook, activeSheet=sheet,
                    range=dict(startRow=0, startCol=0, endRow=2, endCol=len(columns) - 1,
                               a1Notation=f"A1:{columns[-1]['colLetter']}3"),
                    headerRows=[0], collapsed=False, selectionLocked=False,
                    columns=columns, dataSnapshot=None)

    return dict(version=3, exportedAt="2026-10-11T00:00:00.000Z", project=dict(
        id="multi-workbook-project", name="Stale embedded name",
        workbooks=[
            dict(id="sales", name="test_data.xlsx", sourcePath="workbooks/sales.xlsx", sheetNames=[], activeSheetName="Sheet1"),
            dict(id="catalog", name="multi_sheet.xlsx", sourcePath="workbooks/catalog.xlsx", sheetNames=[], activeSheetName="Products"),
        ], activeWorkbookId="sales", activeBlockId="sales-records", activeRegionId=None,
        focusMode="always-editable", blocks=[
            block("sales-records", "sales", "Sheet1", [column(0, "A", "name", "string"), column(1, "B", "age", "integer")]),
            block("catalog-records", "catalog", "Products", [column(0, "A", "id", "string"), column(1, "B", "name", "string"), column(2, "C", "price", "float")]),
        ], regions=[dict(id="catalog-region", label="catalog_region", workbookId="catalog",
                         activeSheet="Products", range=dict(startRow=0, startCol=0, endRow=2, endCol=2, a1Notation="A1:C3"),
                         splitRules=[], blocks=[], collapsed=False, selectionLocked=True)],
        workbookLoadSettings=dict(parseImages=True, parseOfficeMath=True, restoreExcelActiveCell=False,
                                  performanceLogging=False, experimentalStagedLoading=True)),
        data={}, blockResults=[])


def read_saved(path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def run(window, api, directory):
    ui = NativeUI(window)
    ui.wait("Boolean(window.__excelBlockParserStagedCacheState) && Boolean(window.pywebview?.runtimeInfo)")
    root = Path(__file__).resolve().parents[1]
    temporary = Path(directory)
    sources = temporary / "workbooks"
    sources.mkdir()
    shutil.copyfile(root / "examples/test_data.xlsx", sources / "sales.xlsx")
    shutil.copyfile(root / "examples/multi_sheet.xlsx", sources / "catalog.xlsx")
    project_path = temporary / "Multi workbook regression.json"
    project_path.write_text(json.dumps(fixture()), encoding="utf-8")
    passed = []

    def record(name):
        passed.append(name)
        print(f"PASS pywebview: {name}", flush=True)

    def wait_saved(path, label=None):
        import time
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            document = read_saved(path)
            if document and document.get("version") == 3 and (label is None or any(
                block.get("label") == label for block in document["project"]["blocks"]
            )):
                return document
            time.sleep(0.1)
        raise RuntimeError(f"Project was not saved: {path}")

    api._select("OPEN", project_path)
    ui.button('Open Project')
    ui.wait("document.querySelectorAll('.workbook-tab').length === 2 && document.querySelector('.card-title-input')?.value === 'records'")
    if ui.read("document.querySelector('.workbook-tabs button[aria-label^=Close]') !== null"):
        raise RuntimeError('Workbook tabs unexpectedly expose close actions')
    record('open project with two real relative-path workbook sources')

    ui.tab('multi_sheet.xlsx')
    ui.wait("window.__excelBlockParserStagedCacheState().catalog?.hydrated === true")
    ui.tab('Orders')
    ui.wait("window.__excelBlockParserStagedCacheState().catalog?.staged === false")
    ui.tab('Products')
    for name, sheet in [('test_data.xlsx', 'Sheet1'), ('multi_sheet.xlsx', 'Products'), ('test_data.xlsx', 'Sheet1')]:
        ui.tab(name)
        ui.wait(f"Boolean({ui.matching('[role=tab]', sheet)})")
        ui.wait(f"window.__excelBlockParserSelectionState()?.sheetName === {json.dumps(sheet)}")
    record('cached workbook and sheet switching with progressive hydration')

    ui.button('Show workspace navigation')
    ui.wait("document.querySelector('.workspace-file-name')?.title === 'Multi workbook regression'")
    ui.wait("document.querySelector('[aria-label=\"multi_sheet.xlsx sheets\"]')?.textContent.includes('Orders')")
    ui.read("Array.from(document.querySelectorAll('.workspace-item-main')).find(node => node.textContent.includes('multi_sheet.xlsx')).click()")
    ui.wait(f"({ui.matching('[role=tab]', 'multi_sheet.xlsx')})?.getAttribute('aria-selected') === 'true'")
    ui.read("Array.from(document.querySelectorAll('.workspace-item-main')).find(node => node.textContent.includes('test_data.xlsx')).click()")
    ui.wait(f"({ui.matching('[role=tab]', 'test_data.xlsx')})?.getAttribute('aria-selected') === 'true'")
    record('sidebar extraction navigation switches the associated workbook')

    ui.button('Preview')
    ui.wait("document.body.textContent.includes('PARSE REVIEW')")
    ui.tab('Regions')
    ui.wait("document.querySelector('.preview-modal .region-preview-shell')?.textContent.includes('Widget A') && document.querySelector('.preview-modal').textContent.includes('catalog_region')")
    ui.button('Close preview')
    # Hidden WKWebView does not finish CSS animations. Deliver the event the
    # visible native view emits, then still require the preview to unmount.
    ui.finish_exit("document.querySelector('.preview-modal')")
    ui.wait("!document.querySelector('.preview-shell')")
    record('global block/region preview with non-active workbook data')

    output = temporary / "output.json"
    api._select("SAVE", output)
    ui.menu('Save Project As')
    saved = wait_saved(output)
    if saved['project']['name'] != 'output':
        raise RuntimeError('Save As did not derive project name from the filename')
    if saved['data']['sales']['records'][0] != {'name': 'Alice', 'age': 25}:
        raise RuntimeError(f"Sales results were not isolated: {saved['data']}")
    catalog = saved['data']['catalog']['records'][0]
    if catalog != {'id': 'P001', 'name': 'Widget A', 'price': 19.99}:
        raise RuntimeError(f"Catalog results were not isolated: {catalog}")
    if saved['regionResults'][0]['blocks'][0]['range']['a1Notation'] != 'A1:C3':
        raise RuntimeError('Region results did not preserve their source range')
    record('renderer Save As preserves both workbook results and region mappings')

    api._select("SAVE", None)
    ui.menu('Save Project As')
    ui.wait("document.querySelector('.workspace-file-name')?.title === 'output'")
    if read_saved(output) != saved:
        raise RuntimeError('Cancelled Save As changed the project file')
    record('cancelled Save As preserves current project')

    ui.rename('unsaved_changed')
    calls = len(api._dialog_calls)
    ui.button('Open Project')
    ui.wait(ui.modal_open('Open another project?'))
    if len(api._dialog_calls) != calls:
        raise RuntimeError('Open dialog ran before unsaved confirmation')
    ui.choose('Open another project?', 1)
    if ui.read("document.querySelector('.card-title-input').value") != 'unsaved_changed':
        raise RuntimeError('Cancelled Open lost the unsaved extraction')
    record('cancel opening a project before the native file dialog')

    ui.menu('Close Project')
    ui.choose('Close project?', 1)
    ui.wait("document.querySelector('.card-title-input')?.value === 'unsaved_changed'")
    ui.menu('Close Project')
    ui.choose('Close project?', 2)
    ui.wait("document.querySelectorAll('.workbook-tab').length === 0")
    if read_saved(output) != saved:
        raise RuntimeError('Discard-and-close wrote unsaved edits')
    record('cancel and discard closing a dirty project without exiting the host')

    api._select("OPEN", output)
    ui.button('Open Project')
    ui.wait("document.querySelectorAll('.workbook-tab').length === 2 && document.querySelector('.card-title-input')?.value === 'records'")
    ui.tab('multi_sheet.xlsx')
    ui.wait(f"Boolean({ui.matching('[role=tab]', 'Products')})")
    record('reopen renderer-exported Project v3 with relative workbook paths')

    calls = len(api._dialog_calls)
    ui.rename('saved_current')
    ui.menu('Save Project')
    current = wait_saved(output, 'saved_current')
    if len(api._dialog_calls) != calls:
        raise RuntimeError('Normal Save unexpectedly opened a native file dialog')
    if current['project']['workbooks'] != saved['project']['workbooks']:
        raise RuntimeError('Normal Save changed workbook source definitions')
    record('normal Save writes current path without a native file dialog')

    invalid = temporary / 'invalid.json'
    invalid.write_text('{"version":3,"project":{"blocks":[null]}}', encoding='utf-8')
    api._select('OPEN', invalid)
    ui.button('Open Project')
    ui.choose('Open another project?', 2)
    ui.wait("document.querySelector('.ant-alert')?.textContent.includes('Project import failed')")
    ui.wait("document.querySelectorAll('.workbook-tab').length === 2 && document.querySelector('.card-title-input')?.value === 'saved_current'")
    if read_saved(output) != current:
        raise RuntimeError('Invalid import changed the existing saved project')
    ui.button('Preview')
    ui.wait("document.querySelector('.preview-modal')?.textContent.includes('PARSE REVIEW')")
    ui.button('Close preview')
    ui.finish_exit("document.querySelector('.preview-modal')")
    ui.wait("!document.querySelector('.preview-shell')")
    record('invalid Project JSON retains the existing workbook and extraction')

    ui.menu('New Project')
    ui.choose('Create a new project?', 2)
    ui.wait(ui.modal_open('Project settings'))
    ui.wait("document.querySelectorAll('.workbook-tab').length === 0 && !document.querySelector('.card-title-input')")
    ui.button('Done')
    ui.finish_exit(ui.modal('Project settings'))
    first_save = temporary / 'new project.json'
    api._select('SAVE', first_save)
    calls = len(api._dialog_calls)
    ui.menu('Save Project')
    empty = wait_saved(first_save)
    if len(api._dialog_calls) != calls + 1 or api._dialog_calls[-1][0] != 'SAVE':
        raise RuntimeError('First normal Save did not use the native Save As dialog')
    if empty['project']['name'] != 'new project' or empty['project']['workbooks'] or empty['project']['blocks'] or empty['project']['regions']:
        raise RuntimeError('New project retained old workbook or extraction definitions')
    record('New Project detaches sources and its first Save uses Save As')

    if api._selections:
        raise RuntimeError(f"Native dialog selections were not consumed: {list(api._selections)}")
    print(f"pywebview native parity suite: {len(passed)} scenarios passed", flush=True)
