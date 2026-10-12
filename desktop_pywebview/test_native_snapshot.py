import os
from contextlib import contextmanager
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from .native_snapshot import capture_if_enabled


class NativeSnapshotTests(unittest.TestCase):
    @contextmanager
    def backend(self, visible=False, error=None, deliver=True):
        state = {'visible': visible, 'captures': 0, 'hidden': 0}
        def hide(_):
            state['visible'] = False
            state['hidden'] += 1
        native = SimpleNamespace(isVisible=lambda: state['visible'],
                                 orderBack_=lambda _: state.update(visible=True), orderOut_=hide)
        window = SimpleNamespace(uid='snapshot-test', native=native)
        def write(path, _):
            Path(path).write_bytes(b'native-png')
            return True
        data = SimpleNamespace(writeToFile_atomically_=write)
        bitmap = SimpleNamespace(representationUsingType_properties_=lambda *_: data)
        image = SimpleNamespace(TIFFRepresentation=lambda: b'native-tiff')
        def capture(configuration, finished):
            self.assertTrue(state['visible'])
            state['captures'] += 1
            if deliver:
                finished(image, error)
        view = SimpleNamespace(bounds=lambda: (0, 0, 1400, 900),
                               takeSnapshotWithConfiguration_completionHandler_=capture)
        configuration = SimpleNamespace(setRect_=lambda _: None,
                                        setAfterScreenUpdates_=lambda _: None)
        configuration.init = lambda: configuration
        modules = {
            'AppKit': SimpleNamespace(NSPNGFileType=1, NSBitmapImageRep=SimpleNamespace(imageRepWithData_=lambda _: bitmap)),
            'PyObjCTools': SimpleNamespace(AppHelper=SimpleNamespace(callAfter=lambda function, *args: function(*args))),
            'WebKit': SimpleNamespace(WKSnapshotConfiguration=SimpleNamespace(alloc=lambda: configuration)),
            'webview.platforms.cocoa': SimpleNamespace(BrowserView=SimpleNamespace(instances={window.uid: SimpleNamespace(webview=view)})),
        }
        with tempfile.TemporaryDirectory() as directory:
            with patch.dict(os.environ, {'PYWEBVIEW_NATIVE_SNAPSHOTS': directory}), patch.dict('sys.modules', modules):
                with patch('desktop_pywebview.native_snapshot.sys.platform', 'darwin'):
                    yield window, state

    def test_retry_keeps_window_visible_and_hides_after_validation(self):
        with self.backend() as (window, state):
            def validate(path):
                self.assertTrue(state['visible'])
                self.assertEqual(path.read_bytes(), b'native-png')
                return state['captures'] == 2
            result = capture_if_enabled(window, 'retry', validate=validate)
            self.assertTrue(result.exists())
            self.assertEqual(state, {'visible': False, 'captures': 2, 'hidden': 1})

    def test_ready_failure_restores_window_without_capture(self):
        with self.backend() as (window, state):
            def ready():
                raise RuntimeError('scene not ready')
            with self.assertRaisesRegex(RuntimeError, 'scene not ready'):
                capture_if_enabled(window, 'ready-error', ready=ready)
            self.assertEqual(state, {'visible': False, 'captures': 0, 'hidden': 1})

    def test_native_callback_failure_restores_window(self):
        with self.backend(error='native error') as (window, state):
            with self.assertRaisesRegex(RuntimeError, 'native error'):
                capture_if_enabled(window, 'native-error')
            self.assertFalse(state['visible'])

    def test_visible_window_is_not_hidden(self):
        with self.backend(visible=True) as (window, state):
            capture_if_enabled(window, 'visible')
            self.assertTrue(state['visible'])
            self.assertEqual(state['hidden'], 0)

    def test_validation_exception_restores_window(self):
        with self.backend() as (window, state):
            def validate(_):
                raise RuntimeError('pixel check failed')
            with self.assertRaisesRegex(RuntimeError, 'pixel check failed'):
                capture_if_enabled(window, 'validation-error', validate=validate)
            self.assertFalse(state['visible'])

    def test_timeout_restores_window(self):
        with self.backend(deliver=False) as (window, state):
            with self.assertRaisesRegex(RuntimeError, 'timed out'):
                capture_if_enabled(window, 'timeout', timeout=0.01)
            self.assertFalse(state['visible'])

    def test_blank_pixels_fail_instead_of_accepting_a_written_snapshot(self):
        with self.backend() as (window, state):
            with self.assertRaisesRegex(RuntimeError, 'expected pixels'):
                capture_if_enabled(window, 'blank', timeout=0.01, validate=lambda _: False)
            self.assertFalse(state['visible'])

    def test_disabled_does_not_require_native_window_or_backend(self):
        with patch.dict(os.environ):
            os.environ.pop('PYWEBVIEW_NATIVE_SNAPSHOTS', None)
            self.assertIsNone(capture_if_enabled(None, 'unused'))

    def test_unsupported_backend_fails_instead_of_claiming_a_snapshot(self):
        with patch.dict(os.environ, {'PYWEBVIEW_NATIVE_SNAPSHOTS': '.tmp/snapshots'}):
            with patch('desktop_pywebview.native_snapshot.sys.platform', 'win32'):
                with self.assertRaisesRegex(RuntimeError, 'macOS WKWebView'):
                    capture_if_enabled(None, 'unsupported')
