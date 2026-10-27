from pathlib import Path
import json
import subprocess
import tempfile
import unittest

from desktop_pywebview.native_suite import NativeSuiteAPI, SAVE_COMPLETION_OBSERVER, fixture


class NativeSuiteHarnessTests(unittest.TestCase):
    def test_save_completion_latches_new_notice_after_it_disappears(self):
        script = """
const assert = require('node:assert/strict');
global.window = {};
let notice = {textContent: 'Saved Project'};
global.document = {body: {}, querySelector: () => notice};
global.MutationObserver = class {
  constructor(callback) { this.callback = callback; this.disconnected = false; }
  observe() {}
  disconnect() { this.disconnected = true; }
};
const arm = () => eval(OBSERVER);
arm();
window.__pywebviewSaveObserver.callback();
assert.equal(window.__pywebviewSaveCompletion.text, null);
notice = {textContent: 'Saved Project'};
window.__pywebviewSaveObserver.callback();
notice = null;
assert.equal(window.__pywebviewSaveCompletion.text, 'Saved Project');
assert.equal(window.__pywebviewSaveObserver.disconnected, true);
arm();
assert.equal(window.__pywebviewSaveCompletion.text, null);
notice = {textContent: 'Saved Next project'};
window.__pywebviewSaveObserver.callback();
assert.equal(window.__pywebviewSaveCompletion.text, 'Saved Next project');
"""
        subprocess.run(['node', '-e', 'const OBSERVER = ' + json.dumps(SAVE_COMPLETION_OBSERVER) + ';' + script],
                       check=True, capture_output=True, text=True, timeout=10)

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.api = NativeSuiteAPI(Path(self.directory.name) / "recovery")
        self.addCleanup(self.api._shutdown)

    def test_dialog_queue_preserves_selections_and_cancel(self):
        self.api._select("OPEN", "/tmp/project.json")
        self.api._select("SAVE", None)
        self.assertEqual(self.api._dialog("OPEN"), ("/tmp/project.json",))
        self.assertIsNone(self.api._dialog("SAVE"))
        self.assertFalse(self.api._selections)

    def test_unexpected_or_wrong_dialog_fails_instead_of_accepting(self):
        with self.assertRaisesRegex(RuntimeError, "Unexpected native dialog"):
            self.api._dialog("OPEN")
        self.api._select("SAVE", "/tmp/project.json")
        with self.assertRaisesRegex(RuntimeError, "Expected SAVE dialog, received OPEN"):
            self.api._dialog("OPEN")

    def test_fixture_uses_separate_workbook_scopes_and_relative_paths(self):
        project = fixture()["project"]
        self.assertEqual([block["workbookId"] for block in project["blocks"]], ["sales", "catalog"])
        self.assertEqual([block["label"] for block in project["blocks"]], ["records", "records"])
        self.assertTrue(all(not Path(item["sourcePath"]).is_absolute() for item in project["workbooks"]))


if __name__ == "__main__":
    unittest.main()
