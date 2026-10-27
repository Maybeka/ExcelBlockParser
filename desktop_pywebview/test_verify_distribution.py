import ast
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch
import zipfile

from .verify_distribution import RUNTIME_ERROR, download_archive, expect_original_failure, extract_download, make_archive


class DistributionTests(unittest.TestCase):
    def test_negative_control_requires_exact_failure_and_always_reaps_process(self):
        cases = (({"completed": False, "error": RUNTIME_ERROR}, True),
                 ({"completed": False, "error": "unrelated failure"}, False),
                 ({"completed": True}, False))
        for result, accepted in cases:
            with self.subTest(result=result), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                log = root / "control.log"
                process = Mock()
                def poll():
                    log.with_suffix(".result.json").write_text(json.dumps(result))
                    return None
                process.poll.side_effect = poll
                with patch("desktop_pywebview.verify_distribution.subprocess.Popen", return_value=process):
                    with patch("desktop_pywebview.verify_distribution.stop_tree") as cleanup:
                        with patch("desktop_pywebview.verify_distribution.time.sleep"):
                            if accepted:
                                self.assertEqual(expect_original_failure(root / "App.exe", log, 2), result)
                            else:
                                with self.assertRaisesRegex(RuntimeError, "did not reproduce"):
                                    expect_original_failure(root / "App.exe", log, 2)
                        cleanup.assert_called_once_with(process)

    def test_single_executable_archive_survives_http_download(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            executable = root / "App with spaces.exe"
            executable.write_bytes(b"test-executable")
            archive, downloaded = root / "release.zip", root / "downloaded.zip"
            make_archive(executable, archive)
            download_archive(archive, downloaded)
            self.assertEqual(archive.read_bytes(), downloaded.read_bytes())
            with zipfile.ZipFile(downloaded) as source:
                self.assertEqual(source.namelist(), [executable.name])
                self.assertEqual(source.read(executable.name), executable.read_bytes())

    def test_extraction_propagates_download_marker_to_each_file(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive = root / "release.zip"
            with zipfile.ZipFile(archive, "w") as output:
                output.writestr("App.exe", b"exe")
                output.writestr("_internal/runtime.dll", b"dll")
            with patch("desktop_pywebview.verify_distribution.assert_marked") as checked:
                with patch("desktop_pywebview.verify_distribution.mark_download") as marked:
                    extract_download(archive, root / "extracted")
            checked.assert_called_once_with(archive)
            self.assertEqual({call.args[0].relative_to(root / "extracted").as_posix() for call in marked.call_args_list},
                             {"App.exe", "_internal/runtime.dll"})

    def test_extraction_rejects_path_traversal_before_writing(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive = root / "release.zip"
            with zipfile.ZipFile(archive, "w") as output:
                output.writestr("../escape.dll", b"dll")
            with patch("desktop_pywebview.verify_distribution.assert_marked"):
                with self.assertRaisesRegex(RuntimeError, "escapes"):
                    extract_download(archive, root / "extracted")
            self.assertFalse((root / "escape.dll").exists())

    def test_windows_spec_embeds_binaries_and_data_without_collect(self):
        spec = ast.parse((Path(__file__).resolve().parents[1] / "scripts/pywebview.spec").read_text())
        executable = next(node.value for node in spec.body if isinstance(node, ast.Assign)
                          and any(isinstance(target, ast.Name) and target.id == "executable" for target in node.targets))
        self.assertIsInstance(executable.args[2], ast.IfExp)
        self.assertEqual(ast.unparse(executable.args[2].body), "analysis.binaries")
        self.assertEqual(ast.unparse(executable.args[3].body), "analysis.datas")
        excluded = next(item.value for item in executable.keywords if item.arg == "exclude_binaries")
        self.assertEqual(ast.unparse(excluded), "not windows")


if __name__ == "__main__":
    unittest.main()
