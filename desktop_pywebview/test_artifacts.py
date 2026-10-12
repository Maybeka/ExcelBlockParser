import json
from pathlib import Path
import tempfile
import unittest

from desktop_pywebview.artifacts import decode_artifacts, prepare_artifacts, write_artifacts
from desktop_pywebview.host import DesktopAPI


class ArtifactTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)

    def test_nested_utf8_output(self):
        artifacts = decode_artifacts(json.dumps([{"path": "rtl/demo.sv", "content": "// 中文\nmodule demo; endmodule"}]))
        root, prepared = prepare_artifacts(self.root, artifacts)
        write_artifacts(root, prepared)
        self.assertEqual((self.root / "rtl/demo.sv").read_text(), artifacts[0]["content"])

    def test_rejects_unsafe_paths_duplicates_and_limits(self):
        for path in ["../escape", "/absolute", "C:/file", "NUL.txt", "a/./b", "a//b", "a\\b", "a/", "a.", "b "]:
            with self.subTest(path=path), self.assertRaises(ValueError):
                decode_artifacts(json.dumps([{"path": path, "content": "text"}]))
        for artifacts in [[], [{"path": "a", "content": "x"}, {"path": "A", "content": "x"}], [{"path": "a", "content": "x" * (5 * 1024 * 1024 + 1)}], [{"path": "a", "content": "x", "extra": 1}]]:
            with self.assertRaises(ValueError):
                decode_artifacts(json.dumps(artifacts))

    def test_symlink_and_late_conflict_rejection(self):
        (self.root / "link").symlink_to(self.root, target_is_directory=True)
        with self.assertRaises(ValueError):
            prepare_artifacts(self.root, [{"path": "link/file.txt", "content": "x"}])
        root, prepared = prepare_artifacts(self.root, [{"path": "later.txt", "content": "new"}])
        (self.root / "later.txt").write_text("old")
        with self.assertRaises(ValueError):
            write_artifacts(root, prepared)
        self.assertEqual((self.root / "later.txt").read_text(), "old")

    def test_export_cancel_and_replace_confirmation(self):
        class Window:
            def __init__(self):
                self.replace = False
                self.confirmations = 0

            def create_confirmation_dialog(self, title, message):
                self.confirmations += 1
                return self.replace

        api = DesktopAPI(self.root)
        self.addCleanup(api._shutdown)
        window = Window()
        api._attach(window)
        api._dialog = lambda *args, **kwargs: None
        content = json.dumps([{"path": "demo.txt", "content": "new"}])
        self.assertEqual(api.ExportPythonArtifacts("Demo", content)["error"], "cancelled")
        api._dialog = lambda *args, **kwargs: [str(self.root)]
        (self.root / "demo.txt").write_text("old")
        self.assertEqual(api.ExportPythonArtifacts("Demo", content)["error"], "cancelled")
        self.assertEqual((self.root / "demo.txt").read_text(), "old")
        window.replace = True
        self.assertTrue(api.ExportPythonArtifacts("Demo", content)["success"])
        self.assertEqual((self.root / "demo.txt").read_text(), "new")
        self.assertEqual(window.confirmations, 2)


if __name__ == "__main__":
    unittest.main()
