"""Nested outlines through live Univer control subscriptions in native WebView."""

from pathlib import Path
import shutil

from .native_suite import NativeSuiteAPI, NativeUI


class NativeOutlineAPI(NativeSuiteAPI):
    def __init__(self, recovery_dir):
        super().__init__(recovery_dir)
        self._reads = 0

    def ReadFile(self, path):
        self._reads += 1
        return super().ReadFile(path)


def run(window, api, directory):
    ui = NativeUI(window)
    samples = Path(directory, 'samples')
    shutil.copytree(Path(__file__).resolve().parents[1] / '.tmp/pywebview-browser-fixtures', samples)
    ui.wait('Boolean(window.__excelBlockParserOutlineControls)')
    api._select('OPEN', samples / 'nested.json')
    ui.button('Open Project')
    ui.wait("window.__excelBlockParserSelectionState()?.sheetName === 'Nested' && window.__excelBlockParserSelectionState()?.a1Notation === 'A1'")
    def selection():
        value = ui.read('window.__excelBlockParserSelectionState()')
        if not value or not value.get('range'):
            return value
        return {**value, 'range': {key: value['range'][key] for key in ('startRow', 'endRow', 'startColumn', 'endColumn')}}

    initial_selection = selection()
    initial_reads = api._reads

    def state(axis, hidden):
        indexes = range(1, 8 if axis == 'row' else 7)
        expression = 'window.__excelBlockParserOutlineState()'
        expected = [f"{expression}['{axis}:{index}'] === {str(index in hidden).lower()}" for index in indexes]
        expected += [f"{expression}['row:10'] === true", f"{expression}['column:7'] === true"]
        ui.wait(' && '.join(expected))
        current_selection = selection()
        if current_selection != initial_selection:
            raise RuntimeError(f'Outline interaction changed the active selection or sheet: {initial_selection} -> {current_selection}')
        if api._reads != initial_reads:
            raise RuntimeError('Outline interaction reloaded the workbook')

    def controls(axis, count):
        try:
            ui.wait(f"window.__excelBlockParserOutlineControls('{axis}').length === {count}")
        except RuntimeError:
            print(f"Native {axis} outline controls: {ui.read(f'window.__excelBlockParserOutlineControls({axis!r})')}", flush=True)
            raise
        return ui.read(f"window.__excelBlockParserOutlineControls('{axis}')")

    def activate(axis, index):
        if not ui.read(f"window.__excelBlockParserActivateOutlineControl('{axis}', {index})"):
            raise RuntimeError('Expected native outline control is missing')

    for axis in ('row', 'column'):
        child = {3, 4}
        state(axis, child)
        items = controls(axis, 2)
        if not (items[0]['collapsed'] is False and items[1]['collapsed'] is True):
            raise RuntimeError(f'Initial nested control states differ: {items}')
        coordinate = 'left' if axis == 'row' else 'top'
        if not items[0][coordinate] < items[1][coordinate]:
            raise RuntimeError('Outer outline control is not outside its child')
        activate(axis, 0)
        state(axis, set(range(1, 8 if axis == 'row' else 7)))
        controls(axis, 1)
        activate(axis, 0)
        state(axis, child)
        controls(axis, 2)
        activate(axis, 1)
        state(axis, set())
        controls(axis, 2)
        activate(axis, 0)
        controls(axis, 1)
        activate(axis, 0)
        state(axis, set())
        controls(axis, 2)
        print(f'PASS pywebview outline: nested {axis} controls preserve child state and selection without reload', flush=True)
    ui.button('Show Excel outlines')
    controls('row', 0)
    controls('column', 0)
    ui.button('Show Excel outlines')
    controls('row', 2)
    controls('column', 2)
    state('row', set())
    state('column', set())
    print('PASS pywebview outline: display toggle removes/restores controls without reload or selection change', flush=True)
    print('pywebview native outline suite: 3 scenarios passed', flush=True)
