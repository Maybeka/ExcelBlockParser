import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from .test_report import run_with_report


class CompletionReportTests(unittest.TestCase):
    def test_success_report_is_written_after_main_and_not_inherited(self):
        with tempfile.TemporaryDirectory() as directory:
            report = Path(directory, "result.json")
            with patch.dict(os.environ, {"PYWEBVIEW_TEST_REPORT": str(report)}):
                def main():
                    self.assertNotIn("PYWEBVIEW_TEST_REPORT", os.environ)
                    self.assertFalse(report.exists())
                    return 42
                self.assertEqual(run_with_report(main), 42)
            self.assertEqual(json.loads(report.read_text()), {"completed": True})

    def test_failure_is_recorded_and_reraised(self):
        with tempfile.TemporaryDirectory() as directory:
            report = Path(directory, "result.json")
            with patch.dict(os.environ, {"PYWEBVIEW_TEST_REPORT": str(report)}):
                def main():
                    raise RuntimeError("native failure")
                with self.assertRaisesRegex(RuntimeError, "native failure"):
                    run_with_report(main)
            result = json.loads(report.read_text())
            self.assertFalse(result["completed"])
            self.assertIn("native failure", result["error"])

    def test_normal_launch_without_report_is_unchanged(self):
        with patch.dict(os.environ):
            os.environ.pop("PYWEBVIEW_TEST_REPORT", None)
            self.assertEqual(run_with_report(lambda: 7), 7)
