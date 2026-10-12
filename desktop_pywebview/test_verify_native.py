from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from .verify_native import SUITES, run_case, stop_tree


class NativeVerificationRunnerTests(unittest.TestCase):
    def test_captures_success_output(self):
        with tempfile.TemporaryDirectory() as directory:
            log = Path(directory, "nested", "case.log")
            run_case([sys.executable, "-c", "print('verified')"], log, 10, directory)
            self.assertIn("verified", log.read_text())

    def test_nonzero_exit_is_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            log = Path(directory, "failure.log")
            with self.assertRaisesRegex(RuntimeError, "exited 7"):
                run_case([sys.executable, "-c", "raise SystemExit(7)"], log, 10, directory)

    def test_zero_exit_without_completion_rejects_stale_report(self):
        with tempfile.TemporaryDirectory() as directory:
            log = Path(directory, "case.log")
            log.with_suffix(".result.json").write_text('{"completed":true}')
            with self.assertRaisesRegex(RuntimeError, "completion report"):
                run_case([sys.executable, "-c", "pass"], log, 10, directory, require_report=True)

    def test_explicit_completion_is_required_and_accepted(self):
        with tempfile.TemporaryDirectory() as directory:
            log = Path(directory, "case.log")
            script = "from desktop_pywebview.test_report import run_with_report; run_with_report(lambda: None)"
            run_case([sys.executable, "-c", script], log, 10,
                     Path(__file__).resolve().parents[1], require_report=True)
            self.assertIn('"completed": true', log.with_suffix(".result.json").read_text())

    def test_failed_completion_report_rejects_zero_exit(self):
        with tempfile.TemporaryDirectory() as directory:
            log = Path(directory, "case.log")
            script = "import os; from pathlib import Path; Path(os.environ['PYWEBVIEW_TEST_REPORT']).write_text('{\"completed\":false}')"
            with self.assertRaisesRegex(RuntimeError, "did not complete"):
                run_case([sys.executable, "-c", script], log, 10, directory, require_report=True)

    def test_timeout_is_failure_and_reaps_process(self):
        with tempfile.TemporaryDirectory() as directory:
            with patch("desktop_pywebview.verify_native.stop_tree", wraps=stop_tree) as cleanup:
                with self.assertRaises(subprocess.TimeoutExpired):
                    run_case([sys.executable, "-c", "import time; time.sleep(30)"],
                             Path(directory, "timeout.log"), 0.1, directory)
                cleanup.assert_called_once()
                self.assertIsNotNone(cleanup.call_args.args[0].poll())

    def test_inventory_includes_restart_and_both_exit_paths(self):
        self.assertEqual(len(SUITES), 11)
        self.assertEqual(len({name for name, _ in SUITES}), 11)
        self.assertIn(("window", ["--native-window-suite"]), SUITES)
        self.assertIn(("close-save", ["--smoke-test", "--smoke-close-action", "save"]), SUITES)
        self.assertIn(("close-discard", ["--smoke-test", "--smoke-close-action", "discard"]), SUITES)
        self.assertIn(("recovery", ["--native-recovery-suite"]), SUITES)


if __name__ == "__main__":
    unittest.main()
