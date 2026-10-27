import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from .startup import run_desktop


class StartupTests(unittest.TestCase):
    def test_failure_records_bounded_metadata_without_exception_payload(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch('desktop_pywebview.__main__.main', side_effect=RuntimeError('private script and workbook content')):
                with patch('desktop_pywebview.host.DesktopAPI._config_dir', return_value=Path(directory)):
                    with self.assertRaisesRegex(RuntimeError, 'Check WebView2'):
                        run_desktop()
            content = (Path(directory) / 'startup-error.json').read_text()
            evidence = json.loads(content)
            self.assertEqual(evidence['errorType'], 'RuntimeError')
            self.assertLessEqual(len(evidence['frames']), 12)
            self.assertNotIn('private script', content)

    def test_success_does_not_create_diagnostic(self):
        with patch('desktop_pywebview.__main__.main', return_value=42):
            self.assertEqual(run_desktop(), 42)
