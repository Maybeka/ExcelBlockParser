"""Native populated-sheet selection, sidebar synchronization and extraction focus."""

import json
from pathlib import Path
import shutil

from .native_suite import NativeUI
from .native_snapshot import capture_if_enabled
from .smoke import evaluate_async


def run(window, api, directory):
    ui = NativeUI(window)
    def ready_to_capture():
        ui.wait("window.__excelBlockParserDrawingRenderState?.().stage >= 2")
        evaluate_async(window, "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))")
    ui.wait('Boolean(window.__excelBlockParserSelectionState) && Boolean(window.pywebview?.runtimeInfo)')
    root = Path(__file__).resolve().parents[1]
    prepared = root / '.tmp/pywebview-browser-fixtures'
    if not (prepared / 'normal.json').is_file():
        raise RuntimeError('Prepare browser fixtures with scripts/prepare-pywebview-browser-fixtures.mjs first')
    samples = Path(directory) / 'samples'
    shutil.copytree(prepared, samples)

    def open_project(name, existing=False):
        api._select('OPEN', samples / f'{name}.json')
        ui.button('Open Project')
        if existing:
            ui.choose('Open another project?', 2)
        ui.wait(f"document.querySelector('.workspace-file-name')?.title === {json.dumps(name)}")
        ui.wait("document.querySelectorAll('.workbook-tab').length === 2")

    def selection(sheet, cell):
        ui.wait(f"window.__excelBlockParserSelectionState()?.sheetName === {json.dumps(sheet)} && window.__excelBlockParserSelectionState()?.a1Notation === {json.dumps(cell)}")
        ui.wait("(() => { const range = window.__excelBlockParserSelectionState()?.range; return range && range.startRow === range.endRow && range.startColumn === range.endColumn })()")
        ui.wait(f"document.querySelector('.workspace-sheet-item.is-active .workspace-item-label')?.textContent === {json.dumps(sheet)}")

    ui.button('Show workspace navigation')
    open_project('normal')
    selection('First', 'A1')
    capture_if_enabled(window, 'browser-first-sheet', ready=ready_to_capture)
    print('PASS pywebview browser: populated hidden/frozen source opens with a single native default cell', flush=True)

    for sheet in ('Second', 'First', 'Second'):
        ui.tab(sheet)
        selection(sheet, 'A1')
    print('PASS pywebview browser: populated sheet switching retains single-cell selection and updates the sidebar', flush=True)

    for workbook, sheet in [('second.xlsx', 'Other'), ('first.xlsx', 'Second'), ('second.xlsx', 'Other')]:
        ui.tab(workbook)
        selection(sheet, 'A1')
    print('PASS pywebview browser: cached populated workbook switching does not select its used range', flush=True)
    capture_if_enabled(window, 'browser-cached-workbook', ready=ready_to_capture)

    open_project('restore', existing=True)
    selection('First', 'C4')
    for workbook, sheet, cell in [('second.xlsx', 'Other', 'F9'), ('first.xlsx', 'First', 'C4'), ('second.xlsx', 'Other', 'F9')]:
        ui.tab(workbook)
        selection(sheet, cell)
    print('PASS pywebview browser: enabled source active-cell restoration survives cached workbook switching', flush=True)

    open_project('blocks', existing=True)
    ui.wait("document.querySelector('.card-title-input')?.value === 'first_block'")
    ui.tab('second.xlsx')
    ui.wait("document.querySelector('.card-title-input')?.value === 'first_block'")
    ui.tab('Ungrouped')
    ui.wait("document.querySelector('.card-title-input')?.value === 'first_block'")
    if ui.read("Array.from(document.querySelectorAll('.card-title-input')).some(node => node.value === 'other_block')"):
        raise RuntimeError('Workbook or sheet navigation changed the active extraction')
    print('PASS pywebview browser: active extraction is independent of workbook and sheet navigation', flush=True)

    outline_button = ui.matching('button', 'Show Excel outlines')
    ui.button('Show Excel outlines')
    ui.wait(f"({outline_button})?.getAttribute('aria-pressed') === 'true'")
    selection('Ungrouped', 'A1')
    ui.button('Show Excel outlines')
    ui.wait(f"({outline_button})?.getAttribute('aria-pressed') === 'false'")
    selection('Ungrouped', 'A1')
    print('PASS pywebview browser: outline toggles on a sheet without groups do not navigate or expand selection', flush=True)

    filter_button = ui.matching('button', 'Filter worksheet')
    ui.wait(f'!({filter_button})')
    ui.button('Enter Excel browser mode')
    ui.wait(f'Boolean({filter_button})')
    ui.button('Exit Excel browser mode')
    ui.wait(f'!({filter_button})')
    ui.wait("document.querySelector('.card-title-input')?.value === 'first_block'")
    print('PASS pywebview browser: readonly browser tools are gated and exiting preserves the active extraction', flush=True)
    if api._selections:
        raise RuntimeError('Browser fixture native file-dialog selections remain unconsumed')
    print('pywebview native browser suite: 7 scenarios passed', flush=True)
