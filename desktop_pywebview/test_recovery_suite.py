from pathlib import Path
import subprocess
import sys
import unittest
from unittest.mock import patch

from desktop_pywebview.recovery_suite import main


class RecoveryLauncherTests(unittest.TestCase):
    def test_source_and_frozen_launchers_share_only_temporary_state(self):
        for frozen in (False, True):
            with self.subTest(frozen=frozen), patch('builtins.print'), patch.object(sys, 'frozen', frozen, create=True), patch(
                'desktop_pywebview.recovery_suite.subprocess.run'
            ) as run:
                main()
                self.assertEqual(run.call_count, 5)
                states = []
                for stage, call in zip(('seed', 'recover', 'discard', 'seed-discard-close', 'recover'), run.call_args_list):
                    command = call.args[0]
                    prefix = [sys.executable] if frozen else [sys.executable, '-m', 'desktop_pywebview']
                    self.assertEqual(command[:-4], prefix)
                    self.assertEqual(command[-4:-1], ['--native-recovery-stage', stage, '--native-state-dir'])
                    self.assertTrue(call.kwargs['check'])
                    states.append(command[-1])
                self.assertEqual(len(set(states[:3])), 1)
                self.assertEqual(len(set(states[3:])), 1)
                self.assertEqual(len(set(states)), 2)
                self.assertTrue(all(not Path(state).exists() for state in states))

    def test_failed_stage_stops_later_launches_and_cleans_state(self):
        with patch('desktop_pywebview.recovery_suite.subprocess.run') as run:
            run.side_effect = subprocess.CalledProcessError(1, 'test-host')
            with self.assertRaises(subprocess.CalledProcessError):
                main()
            self.assertEqual(run.call_count, 1)
            self.assertFalse(Path(run.call_args.args[0][-1]).exists())

    def test_failed_actual_exit_restart_cleans_both_cycles(self):
        with patch('desktop_pywebview.recovery_suite.subprocess.run') as run:
            run.side_effect = [None, None, None, None, subprocess.CalledProcessError(1, 'test-host')]
            with self.assertRaises(subprocess.CalledProcessError):
                main()
            self.assertEqual(run.call_count, 5)
            self.assertTrue(all(not Path(call.args[0][-1]).exists() for call in run.call_args_list))


if __name__ == '__main__':
    unittest.main()
