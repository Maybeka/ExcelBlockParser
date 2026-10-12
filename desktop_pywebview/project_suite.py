"""Complete v3 document and source-management UI acceptance in a native WebView."""

import json
import ntpath
import os
from pathlib import Path
import time

from .native_suite import NativeUI, read_saved


def expected_external_source_path(source_path, destination, windows=os.name == 'nt'):
    if windows and ntpath.splitdrive(source_path)[0].lower() == ntpath.splitdrive(str(destination))[0].lower():
        return ntpath.relpath(source_path, ntpath.dirname(str(destination))).replace('\\', '/')
    return source_path


def wait_saved(path):
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        value = read_saved(path)
        if value and value.get('version') == 3:
            return value
        time.sleep(0.1)
    raise RuntimeError(f'Project was not saved: {path}')


def run(window, api, directory):
    ui = NativeUI(window)
    ui.wait('Boolean(window.__excelBlockParserStagedCacheState) && Boolean(window.pywebview?.runtimeInfo)')
    root = Path(__file__).resolve().parents[1]
    temporary = Path(directory)
    source = json.loads((root / 'src/renderer/__tests__/fixtures/project-v3-complete.json').read_text(encoding='utf-8'))
    input_directory = temporary / 'input'
    output_directory = temporary / 'output'
    input_directory.mkdir()
    output_directory.mkdir()
    project_path = input_directory / 'Complete v3 fixture.json'
    project_path.write_text(json.dumps(source), encoding='utf-8')
    api._select('OPEN', project_path)
    ui.button('Open Project')
    ui.wait(ui.modal_open('Project settings'))
    ui.wait("document.querySelectorAll('.project-workbook-setting').length === 2")
    for workbook in source['project']['workbooks']:
        ui.wait(f"Array.from(document.querySelectorAll('.project-workbook-source-name')).some(node => node.textContent === {json.dumps(workbook['name'])})")
        ui.wait(f"Array.from(document.querySelectorAll('.project-workbook-source-path')).some(node => node.textContent === {json.dumps(workbook['sourcePath'])})")
    ui.wait("Array.from(document.querySelectorAll('.project-workbook-source-title small')).filter(node => node.textContent === 'Unavailable').length === 2")
    ui.button('Done')
    ui.finish_exit(ui.modal('Project settings'))

    output = output_directory / 'Complete v3 fixture.json'
    api._select('SAVE', output)
    ui.menu('Save Project As')
    ui.choose('Validation errors', 2)
    saved = wait_saved(output)
    saved_paths = [workbook.get('sourcePath') for workbook in saved['project']['workbooks']]
    external_source = source['project']['workbooks'][1]['sourcePath']
    expected_external = expected_external_source_path(external_source, output)
    if saved_paths != ['../input/workbooks/sales.xlsx', expected_external]:
        raise RuntimeError(f'Golden source paths were not rebased correctly: {saved_paths}')
    expected = json.loads(json.dumps(source))
    actual = json.loads(json.dumps(saved))
    for document in (expected, actual):
        document.pop('exportedAt', None)
        for workbook in document['project']['workbooks']:
            workbook.pop('sourcePath', None)
    if actual != expected:
        raise RuntimeError(f'Complete v3 golden document changed: {json.dumps(actual)}')
    print('PASS pywebview project: complete v3 golden round trip preserves every non-path field and rebases paths', flush=True)

    ui.menu('New Project')
    ui.choose('Create a new project?', 2)
    ui.wait(ui.modal_open('Project settings'))
    api._select('OPEN', None)
    ui.button('Add workbook source')
    ui.wait("document.querySelectorAll('.project-workbook-setting').length === 0")
    ui.wait("document.querySelectorAll('.workbook-tab').length === 0 && !document.querySelector('.card-title-input')")
    if api._selections:
        raise RuntimeError('Cancelled workbook dialog was not consumed')
    print('PASS pywebview project: cancelled Add workbook source leaves an empty project unchanged', flush=True)

    workbook = (root / 'examples/test_data.xlsx').resolve()
    api._select('OPEN', workbook)
    ui.button('Add workbook source')
    ui.wait("document.querySelectorAll('.project-workbook-setting').length === 1 && document.querySelectorAll('.workbook-tab').length === 1")
    ui.wait(f"document.querySelector('.project-workbook-source-path')?.textContent === {json.dumps(str(workbook))}")
    ui.wait("document.querySelector('.project-workbook-source-title small')?.textContent === 'Available'")
    if ui.read("Boolean(document.querySelector('.card-title-input'))"):
        raise RuntimeError('Adding a workbook unexpectedly created an extraction')
    print('PASS pywebview project: real workbook source is available with its full path and no automatic block', flush=True)

    ui.button('Remove')
    ui.choose('Remove project workbook?', 1)
    ui.wait("document.querySelectorAll('.project-workbook-setting').length === 1 && document.querySelectorAll('.workbook-tab').length === 1")
    print('PASS pywebview project: cancelling source removal retains the source and live workbook', flush=True)

    ui.button('Remove')
    ui.choose('Remove project workbook?', 2)
    ui.wait("document.querySelectorAll('.project-workbook-setting').length === 0 && document.querySelectorAll('.workbook-tab').length === 0")
    ui.button('Done')
    ui.finish_exit(ui.modal('Project settings'))
    empty_path = temporary / 'after removal.json'
    api._select('SAVE', empty_path)
    ui.menu('Save Project')
    empty = wait_saved(empty_path)
    if empty['project']['workbooks'] or empty['project']['blocks'] or empty['project']['regions']:
        raise RuntimeError('Saving after source removal retained detached definitions')
    print('PASS pywebview project: confirmed source removal clears live tabs and saved source definitions', flush=True)
    if api._selections:
        raise RuntimeError('Native file-dialog selections remain unconsumed')
    print('pywebview native project/settings suite: 5 scenarios passed', flush=True)
