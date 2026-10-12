"""Recovery acceptance through three separate hidden native application launches."""

import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import threading
import time

from .native_suite import NativeUI, fixture, read_saved


def wait_recovery(api, predicate):
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline:
        content = api.LoadRecovery()
        document = json.loads(content) if content else None
        if predicate(document):
            return document
        time.sleep(0.1)
    raise RuntimeError("Recovery file did not reach its expected state")


def run_stage(window, api, directory, stage):
    ui = NativeUI(window)
    root = Path(__file__).resolve().parents[1]
    directory = Path(directory)
    ui.wait("Boolean(window.__excelBlockParserStagedCacheState) && Boolean(window.pywebview?.runtimeInfo)")
    if stage in ('seed', 'seed-discard-close'):
        sources = directory / 'workbooks'
        sources.mkdir()
        shutil.copyfile(root / 'examples/test_data.xlsx', sources / 'sales.xlsx')
        shutil.copyfile(root / 'examples/multi_sheet.xlsx', sources / 'catalog.xlsx')
        project_path = directory / 'recovery-source.json'
        project_path.write_text(json.dumps(fixture()), encoding='utf-8')
        api._select('OPEN', project_path)
        ui.button('Open Project')
        ui.wait("document.querySelectorAll('.workbook-tab').length === 2 && document.querySelector('.card-title-input')?.value === 'records'")
        ui.rename('recovered_edit')
        recovered = wait_recovery(api, lambda value: value and any(
            block['label'] == 'recovered_edit' for block in value['project']['blocks']))
        if any(not Path(source['sourcePath']).is_absolute() for source in recovered['project']['workbooks']):
            raise RuntimeError('Renderer recovery did not resolve workbook paths')
        if read_saved(project_path)['project']['blocks'][0]['label'] != 'records':
            raise RuntimeError('Recovery autosave wrote unsaved edits to the original project')
        print('PASS pywebview recovery: renderer autosave preserves edits and absolute workbook paths', flush=True)
        if stage == 'seed-discard-close':
            ui.read("document.querySelector('.window-control-close').click()")
            ui.wait(ui.modal_open('Close application?'))
            def discard_and_exit():
                try:
                    window.run_js(f"({ui.modal('Close application?')}).querySelector('.ant-modal-footer button:nth-child(2)').click()")
                except Exception:
                    # Closing can destroy the view before evaluation returns.
                    # Native closure and persisted state are checked separately.
                    pass
            threading.Thread(target=discard_and_exit, daemon=True).start()
            if not window.events.closed.wait(30):
                raise RuntimeError('Discard did not close the native application')
            recovery = json.loads(api._recovery.read_text(encoding='utf-8'))
            if recovery['project']['blocks'][0]['label'] != 'recovered_edit':
                raise RuntimeError('Actual Discard exit lost the recoverable unsaved workspace')
            if read_saved(project_path)['project']['blocks'][0]['label'] != 'records':
                raise RuntimeError('Discard exit saved unsaved project changes')
            print('PASS pywebview recovery: actual titlebar Discard exit preserves recovery but does not save the project', flush=True)
            return
        # Host test shutdown deliberately preserves the recovery file, like an
        # interrupted session; the next stage starts a new application process.
        return

    ui.wait(ui.modal_open('Recover unsaved workspace?'))
    if stage == 'discard':
        ui.choose('Recover unsaved workspace?', 1)
        wait_recovery(api, lambda value: value is None)
        ui.wait("document.querySelectorAll('.workbook-tab').length === 0 && !document.querySelector('.card-title-input')")
        print('PASS pywebview recovery: fresh launch Discard clears persisted recovery without opening workbooks', flush=True)
        return

    ui.choose('Recover unsaved workspace?', 2)
    ui.wait("document.querySelectorAll('.workbook-tab').length === 2 && document.querySelector('.card-title-input')?.value === 'recovered_edit'")
    ui.wait("Boolean(window.__excelBlockParserSelectionState()?.sheetName)")
    if api._dialog_calls:
        raise RuntimeError('Reachable recovery sources unexpectedly required a native reassignment dialog')
    print('PASS pywebview recovery: fresh process restores both authorized real workbooks and unsaved edits', flush=True)
    ui.read("document.querySelector('.window-control-close').click()")
    ui.wait(ui.modal_open('Close application?'))
    labels = ui.read(f"Array.from(({ui.modal('Close application?')}).querySelectorAll('.ant-modal-footer button')).map(node => node.textContent.trim())")
    if labels != ['Cancel', 'Discard and close', 'Save and close']:
        raise RuntimeError(f'Recovered workspace close options differ: {labels}')
    ui.choose('Close application?', 1)
    ui.wait("document.querySelector('.card-title-input')?.value === 'recovered_edit'")
    print('PASS pywebview recovery: restored workspace remains unsaved and Cancel preserves it', flush=True)


def main():
    # Running stages separately proves host authorization and renderer state are
    # reconstructed rather than retained in the previous native process.
    command = [sys.executable] if getattr(sys, 'frozen', False) else [sys.executable, '-m', 'desktop_pywebview']
    for stages in (('seed', 'recover', 'discard'), ('seed-discard-close', 'recover')):
        with tempfile.TemporaryDirectory(prefix='pywebview-restart-') as directory:
            for stage in stages:
                subprocess.run([*command,
                                '--native-recovery-stage', stage, '--native-state-dir', directory], check=True)
    print('pywebview native recovery restart suite: 5 scenarios passed', flush=True)


if __name__ == '__main__':
    main()
