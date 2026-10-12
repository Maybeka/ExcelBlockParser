import json
from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch

from desktop_pywebview.preferences_suite import main


class PreferencesLauncherTests(unittest.TestCase):
    def test_source_and_package_use_fresh_processes_and_isolated_state(self):
        for frozen in (False, True):
            def launch(command, **kwargs):
                stage, directory = command[-3], command[-1]
                Path(directory, f'{stage}-origin.json').write_text(json.dumps(f'http://127.0.0.1:{len(stage)}'))

            with self.subTest(frozen=frozen), patch('builtins.print'), patch.object(sys, 'frozen', frozen, create=True), patch(
                'desktop_pywebview.preferences_suite.subprocess.run', side_effect=launch
            ) as run:
                main()
                self.assertEqual(run.call_count, 3)
                states = []
                for stage, call in zip(('english', 'chinese', 'verify-english'), run.call_args_list):
                    prefix = [sys.executable] if frozen else [sys.executable, '-m', 'desktop_pywebview']
                    command = call.args[0]
                    self.assertEqual(command[:-4], prefix)
                    self.assertEqual(command[-4:-1], ['--native-preferences-stage', stage, '--native-state-dir'])
                    self.assertTrue(call.kwargs['check'])
                    states.append(command[-1])
                self.assertEqual(len(set(states)), 1)
                self.assertFalse(Path(states[0]).exists())

    def test_failed_stage_stops_later_processes_and_cleans_state(self):
        with patch('desktop_pywebview.preferences_suite.subprocess.run') as run:
            run.side_effect = subprocess.CalledProcessError(1, 'test-host')
            with self.assertRaises(subprocess.CalledProcessError):
                main()
            self.assertEqual(run.call_count, 1)
            self.assertFalse(Path(run.call_args.args[0][-1]).exists())
