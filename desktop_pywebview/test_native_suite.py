from pathlib import Path
import tempfile
import unittest

from desktop_pywebview.native_suite import NativeSuiteAPI, fixture


class NativeSuiteHarnessTests(unittest.TestCase):
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
