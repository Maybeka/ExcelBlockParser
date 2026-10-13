from contextlib import contextmanager
import os
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from .native_background import native_test_background


class NativeBackgroundTests(unittest.TestCase):
    @contextmanager
    def backend(self, allow_policy=True):
        state = {'policy': 0, 'activations': 0, 'removed': [], 'calls': [], 'foreground': None}
        def policy(value):
            state['calls'].append(value)
            if value == 2 and not allow_policy:
                return False
            state['policy'] = value
            return True
        def activate(_):
            state['activations'] += 1
        application = SimpleNamespace(
            activationPolicy=lambda: state['policy'], setActivationPolicy_=policy,
            activateIgnoringOtherApps_=activate, activateWithOptions_=activate,
            isRunning=lambda: True,
        )
        def observe(*args):
            state['callback'] = args[-1]
            return 'observer'
        center = SimpleNamespace(addObserverForName_object_queue_usingBlock_=observe,
                                 removeObserver_=state['removed'].append)
        workspace = SimpleNamespace(notificationCenter=lambda: center,
                                    frontmostApplication=lambda: state['foreground'])
        backend = SimpleNamespace(
            BrowserView=SimpleNamespace(app=application),
            AppKit=SimpleNamespace(NSApplicationActivationPolicyProhibited=2,
                                   NSWorkspaceDidActivateApplicationNotification='activation',
                                   NSWorkspaceApplicationKey='application',
                                   NSWorkspace=SimpleNamespace(sharedWorkspace=lambda: workspace)),
        )
        with patch('desktop_pywebview.native_background.sys.platform', 'darwin'):
            with patch('desktop_pywebview.native_background.import_module', return_value=backend):
                yield backend, application, state

    def test_normal_launch_does_not_import_or_modify_native_backend(self):
        with patch('desktop_pywebview.native_background.import_module') as imported:
            with native_test_background(False):
                pass
            imported.assert_not_called()

    def test_non_cocoa_tests_do_not_modify_the_backend(self):
        with patch('desktop_pywebview.native_background.sys.platform', 'win32'):
            with patch('desktop_pywebview.native_background.import_module') as imported:
                with native_test_background(True):
                    pass
                imported.assert_not_called()

    def test_suppresses_activation_and_delegates_event_loop_methods(self):
        with self.backend() as (backend, original, state):
            with native_test_background(True):
                self.assertEqual(state['policy'], 2)
                backend.BrowserView.app.activateIgnoringOtherApps_(True)
                backend.BrowserView.app.activateWithOptions_(1)
                self.assertTrue(backend.BrowserView.app.isRunning())
                self.assertEqual(state['activations'], 0)
            self.assertIs(backend.BrowserView.app, original)
            self.assertEqual(state['policy'], 0)
            self.assertEqual(state['removed'], ['observer'])

    def test_restores_backend_after_suite_failure(self):
        with self.backend() as (backend, original, state):
            with self.assertRaisesRegex(ValueError, 'suite failed'):
                with native_test_background(True):
                    raise ValueError('suite failed')
            self.assertIs(backend.BrowserView.app, original)
            self.assertEqual(state['policy'], 0)
            self.assertEqual(state['removed'], ['observer'])

    def test_rejects_focus_theft_instead_of_claiming_a_background_pass(self):
        with self.backend() as (backend, original, state):
            with self.assertRaisesRegex(RuntimeError, 'foreground application'):
                with native_test_background(True):
                    active = SimpleNamespace(processIdentifier=os.getpid)
                    state['callback'](SimpleNamespace(userInfo=lambda: {'application': active}))
            self.assertIs(backend.BrowserView.app, original)
            self.assertEqual(state['removed'], ['observer'])

    def test_other_app_activation_does_not_fail_the_test(self):
        with self.backend() as (_, _, state):
            with native_test_background(True):
                active = SimpleNamespace(processIdentifier=lambda: os.getpid() + 1)
                state['callback'](SimpleNamespace(userInfo=lambda: {'application': active}))

    def test_checks_foreground_state_after_policy_restoration(self):
        with self.backend() as (_, _, state):
            with self.assertRaisesRegex(RuntimeError, 'foreground application'):
                with native_test_background(True):
                    state['foreground'] = SimpleNamespace(processIdentifier=os.getpid)
            self.assertEqual(state['policy'], 0)

    def test_policy_failure_prevents_the_suite_and_cleans_up(self):
        with self.backend(allow_policy=False) as (backend, original, state):
            with self.assertRaisesRegex(RuntimeError, 'non-activating Cocoa'):
                with native_test_background(True):
                    self.fail('Suite must not run when background mode fails')
            self.assertIs(backend.BrowserView.app, original)
            self.assertEqual(state['policy'], 0)
            self.assertEqual(state['removed'], ['observer'])
