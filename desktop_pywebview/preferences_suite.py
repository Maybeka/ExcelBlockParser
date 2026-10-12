"""Application-language persistence through fresh native processes and origins."""

import json
from pathlib import Path
import subprocess
import sys
import tempfile
import time

from .native_suite import NativeSuiteAPI, NativeUI


class NativePreferencesAPI(NativeSuiteAPI):
    def __init__(self, recovery_dir):
        super().__init__(recovery_dir)
        self._test_locale = None


def run_stage(window, api, directory, stage):
    ui = NativeUI(window)
    expected = 'zh-CN' if stage == 'chinese' else 'en-US'
    ui.wait(f"document.documentElement.lang === {json.dumps(expected)} && Boolean(window.pywebview?.runtimeInfo) && Boolean(document.querySelector('.app-header'))")
    origin = ui.read('location.origin')
    Path(directory, f'{stage}-origin.json').write_text(json.dumps(origin), encoding='utf-8')
    if stage == 'verify-english':
        if api.LoadAppLocale() != 'en-US':
            raise RuntimeError('Native language changed after the final restart')
        print(f'PASS pywebview preferences: final English restart at {origin}', flush=True)
        return

    ui.button('项目操作' if expected == 'zh-CN' else 'Project actions')
    ui.click('[role="menuitem"]', '项目设置' if expected == 'zh-CN' else 'Project settings')
    selector = "Array.from(document.querySelectorAll('.project-settings-field')).find(node => node.textContent.includes('" + ('语言' if expected == 'zh-CN' else 'Language') + "'))?.querySelector('.ant-select-selector')"
    ui.wait(f'Boolean({selector})')
    ui.read(f"({selector}).dispatchEvent(new MouseEvent('mousedown', {{bubbles: true}}))")
    target = 'Chinese (Simplified)' if stage == 'english' else 'English'
    ui.click('.ant-select-item-option', target)
    next_locale = 'zh-CN' if stage == 'english' else 'en-US'
    ui.wait(f"document.documentElement.lang === {json.dumps(next_locale)}")
    deadline = time.monotonic() + 10
    while api.LoadAppLocale() != next_locale:
        if time.monotonic() >= deadline:
            raise RuntimeError('Settings UI did not persist its language through the native bridge')
        time.sleep(0.1)
    print(f'PASS pywebview preferences: {expected} startup and UI switch to {next_locale} at {origin}', flush=True)


def main():
    with tempfile.TemporaryDirectory(prefix='pywebview-preferences-') as directory:
        recovery = Path(directory, 'recovery')
        recovery.mkdir()
        (recovery / 'preferences.json').write_text('{"locale":"en-US"}', encoding='utf-8')
        command = [sys.executable] if getattr(sys, 'frozen', False) else [sys.executable, '-m', 'desktop_pywebview']
        stages = ('english', 'chinese', 'verify-english')
        for stage in stages:
            subprocess.run([*command, '--native-preferences-stage', stage,
                            '--native-state-dir', directory], check=True)
        origins = [json.loads(Path(directory, f'{stage}-origin.json').read_text()) for stage in stages]
        if len(set(origins)) < 2:
            raise RuntimeError('Language persistence was not exercised across different WebView origins')
    print('pywebview native preferences restart suite: 3 scenarios passed', flush=True)
