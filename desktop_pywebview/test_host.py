import base64
import json
from pathlib import Path
import tempfile
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from desktop_pywebview.host import DesktopAPI


class HostTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.api = DesktopAPI(self.root / "recovery")
        self.addCleanup(self.api._shutdown)

    def test_project_authorizes_relative_workbook_and_round_trip(self):
        workbook = self.root / "source.xlsx"
        workbook.write_bytes(b"fixture")
        content = json.dumps({"version": 3, "project": {"workbooks": [{"sourcePath": "source.xlsx"}]}})
        project = self.root / "project.json"
        project.write_text(content)
        self.assertEqual(self.api.OpenDroppedJson(str(project))["content"], content)
        self.assertEqual(base64.b64decode(self.api.ReadFile("source.xlsx")), b"fixture")
        self.api.SaveJsonToPath(str(project), content)
        self.assertEqual(json.loads(project.read_text()), json.loads(content))

    def test_locale_survives_new_host_and_recovery_cleanup(self):
        self.assertIsNone(self.api.LoadAppLocale())
        self.api.SaveAppLocale("zh-CN")
        other = DesktopAPI(self.root / "recovery")
        self.addCleanup(other._shutdown)
        self.assertEqual(other.LoadAppLocale(), "zh-CN")
        other.ClearRecovery()
        self.assertEqual(other.LoadAppLocale(), "zh-CN")
        other.SaveAppLocale("en-US")
        self.assertEqual(self.api.LoadAppLocale(), "en-US")

    def test_invalid_locale_cannot_overwrite_saved_preferences(self):
        self.api.SaveAppLocale("en-US")
        for value in ("invalid", None, 1, {}, []):
            with self.assertRaises(ValueError):
                self.api.SaveAppLocale(value)
        self.assertEqual(self.api.LoadAppLocale(), "en-US")

    def test_invalid_preferences_are_ignored_without_crashing_startup(self):
        self.api._preferences.parent.mkdir(parents=True)
        for content in ('{', '[]', '{"locale":"invalid"}', '"en-US"', 'x' * 4097):
            self.api._preferences.write_text(content)
            self.assertIsNone(self.api.LoadAppLocale())

    def test_rejects_unapproved_read_and_overwrite(self):
        workbook = self.root / "source.xlsx"
        workbook.write_bytes(b"fixture")
        with self.assertRaises(PermissionError):
            self.api.ReadFile(str(workbook))
        with self.assertRaises(PermissionError):
            self.api.SaveJsonToPath(str(self.root / "other.json"), "{}")

    def test_cancelled_open_preserves_current_workbook_authorization(self):
        workbook = self.root / "source.xlsx"
        workbook.write_bytes(b"fixture")
        self.api._approve(str(workbook), workbook)
        self.api._dialog = Mock(return_value=None)
        self.assertEqual(self.api.OpenXlsx(), "")
        self.assertIsNone(self.api.OpenJson())
        self.assertEqual(base64.b64decode(self.api.ReadFile(str(workbook))), b"fixture")

    def test_selected_workbook_is_authorized_without_opening_a_project(self):
        workbook = self.root / "source.xlsx"
        workbook.write_bytes(b"fixture")
        self.api._dialog = Mock(return_value=(str(workbook),))
        self.assertEqual(self.api.OpenXlsx(), str(workbook))
        self.assertEqual(base64.b64decode(self.api.ReadFile(str(workbook))), b"fixture")
        self.api._dialog.assert_called_once_with(
            "OPEN", allow_multiple=False, file_types=("Excel (*.xlsx;*.xls)",))

    def test_save_as_accepts_platform_dialog_return_shapes_and_authorizes_save(self):
        for selection_shape in (str, lambda path: (path,)):
            with self.subTest(selection_shape=selection_shape):
                destination = self.root / "saved.json"
                self.api._dialog = Mock(return_value=selection_shape(str(destination)))
                result = self.api.SaveJson("C:\\projects\\demo", '{"value":1}')
                self.assertTrue(result["success"])
                self.assertEqual(result["filePath"], str(destination))
                self.api._dialog.assert_called_once_with(
                    "SAVE", save_filename="demo.json", file_types=("JSON (*.json)",))
                self.api.SaveJsonToPath(str(destination), '{"value":2}')
                self.assertEqual(json.loads(destination.read_text()), {"value": 2})

    def test_cancelled_or_invalid_save_as_does_not_authorize_or_overwrite(self):
        destination = self.root / "existing.json"
        destination.write_text('{"original":true}')
        self.api._dialog = Mock(return_value=None)
        self.assertEqual(self.api.SaveJson("demo", "{}"), {"success": False, "error": "cancelled"})
        self.api._dialog = Mock(return_value=str(destination))
        with self.assertRaises(ValueError):
            self.api.SaveJson("demo", "invalid JSON")
        self.assertEqual(json.loads(destination.read_text()), {"original": True})
        with self.assertRaises(PermissionError):
            self.api.SaveJsonToPath(str(destination), "{}")

    def test_rejects_non_json_drop(self):
        with self.assertRaises(ValueError):
            self.api.OpenDroppedJson(str(self.root / "source.xlsx"))

    def test_malformed_project_shape_reaches_renderer_validation(self):
        project = self.root / "invalid.json"
        for document in ([], {"version": 3, "project": []},
                         {"version": 3, "project": {"workbooks": [None, 12, {}]}}):
            with self.subTest(document=document):
                content = json.dumps(document)
                project.write_text(content)
                self.assertEqual(self.api.OpenDroppedJson(str(project))["content"], content)

    def test_bad_save_preserves_existing_file(self):
        project = self.root / "project.json"
        project.write_text("{}")
        self.api.OpenDroppedJson(str(project))
        with self.assertRaises(ValueError):
            self.api.SaveJsonToPath(str(project), "invalid JSON")
        self.assertEqual(project.read_text(), "{}")

    def test_invalid_project_import_does_not_revoke_existing_workbook_read(self):
        workbook = self.root / 'source.xlsx'
        workbook.write_bytes(b'previously approved workbook')
        self.api._approve(str(workbook), workbook)
        invalid = self.root / 'invalid.json'
        invalid.write_text('{"version":3,"project":{"blocks":[null]}}')
        self.api.OpenDroppedJson(str(invalid))
        self.assertEqual(base64.b64decode(self.api.ReadFile(str(workbook))), b'previously approved workbook')

    def test_recovery_round_trip_and_clear(self):
        self.assertIsNone(self.api.LoadRecovery())
        self.api.SaveRecovery('{"version":3,"project":{}}')
        self.assertEqual(json.loads(self.api.LoadRecovery())["version"], 3)
        self.api.ClearRecovery()
        self.assertIsNone(self.api.LoadRecovery())

    def test_native_close_defers_to_renderer_until_confirmed(self):
        class Window:
            def __init__(self):
                self.messages = []
                self.destroyed = False
                self.emitted = threading.Event()

            def evaluate_js(self, source):
                self.messages.append(source)
                self.emitted.set()

            def destroy(self):
                self.destroyed = True

        window = Window()
        self.api._attach(window)
        self.api.Ready()
        self.assertFalse(self.api._before_close())
        self.assertTrue(window.emitted.wait(5))
        self.assertIn("window:close-requested", window.messages[0])
        self.api.ConfirmQuit()
        self.assertTrue(self.api._before_close())
        self.assertFalse(window.destroyed)
        self.api._finish_quit()
        self.assertTrue(window.destroyed)

    def test_native_drop_accepts_only_one_json(self):
        emitted = []
        self.api._emit = lambda event, *args: emitted.append((event, args))
        self.api._drop({"dataTransfer": {"files": [{"pywebviewFullPath": "/tmp/source.xlsx"}]}})
        self.api._drop({"dataTransfer": {"files": [{"pywebviewFullPath": "/tmp/a.json"}, {"pywebviewFullPath": "/tmp/b.json"}]}})
        self.assertEqual(emitted, [])
        self.api._drop({"dataTransfer": {"files": [{"pywebviewFullPath": "/tmp/a.JSON"}]}})
        self.assertEqual(emitted, [("project:file-drop", (["/tmp/a.JSON"],))])

    def test_quit_notification_without_confirmation_cannot_close_window(self):
        class Window:
            def destroy(self):
                raise AssertionError("An unconfirmed notification closed the window")
        self.api._attach(Window())
        self.api._finish_quit()
        self.assertFalse(self.api._confirmed)

    def test_native_maximize_state_tracks_external_restore(self):
        class Window:
            def maximize(self):
                pass

            def restore(self):
                pass

        self.api._attach(Window())
        self.assertTrue(self.api.ToggleMaximize())
        self.api._on_restored()
        self.assertTrue(self.api.ToggleMaximize())
        self.api._on_maximized()
        self.assertFalse(self.api.ToggleMaximize())

    def test_cocoa_restores_exact_frame_and_preserves_maximized_during_deminimize(self):
        normal = ((-1400, 70), (1100, 700))
        current = [normal]
        native = SimpleNamespace(frame=lambda: current[0],
                                 setFrame_display_=lambda frame, _: current.__setitem__(0, frame))
        window = SimpleNamespace(native=native, maximize=lambda: current.__setitem__(0, ((0, 0), (2560, 1440))))
        self.api._attach(window)
        helper = SimpleNamespace(AppHelper=SimpleNamespace(callAfter=lambda callback: callback()))
        with patch('desktop_pywebview.host.sys.platform', 'darwin'), patch.dict('sys.modules', {'PyObjCTools': helper}):
            self.assertTrue(self.api.ToggleMaximize())
            self.api._on_restored()
            self.assertTrue(self.api._maximized)
            self.assertFalse(self.api.ToggleMaximize())
            self.assertEqual(current[0], normal)
            resized = ((-1380, 80), (1200, 750))
            current[0] = resized
            self.assertTrue(self.api.ToggleMaximize())
            self.assertFalse(self.api.ToggleMaximize())
            self.assertEqual(current[0], resized)
            self.assertTrue(self.api.ToggleMaximize())
            current[0] = resized
            self.api._on_restored()
            self.assertFalse(self.api._maximized)
            self.assertIsNone(self.api._normal_frame)
            self.assertTrue(self.api.ToggleMaximize())
            self.assertFalse(self.api.ToggleMaximize())

    def test_cocoa_maximize_failure_does_not_store_a_restore_frame(self):
        self.api._attach(SimpleNamespace(native=SimpleNamespace(frame=lambda: ((0, 0), (1100, 700))),
                                         maximize=Mock(side_effect=RuntimeError('maximize failed'))))
        helper = SimpleNamespace(AppHelper=SimpleNamespace(callAfter=lambda callback: callback()))
        with patch('desktop_pywebview.host.sys.platform', 'darwin'), patch.dict('sys.modules', {'PyObjCTools': helper}):
            with self.assertRaisesRegex(RuntimeError, 'maximize failed'):
                self.api.ToggleMaximize()
        self.assertIsNone(self.api._normal_frame)
        self.assertFalse(self.api._maximized)

    def test_cocoa_restore_failure_retains_the_frame_for_retry(self):
        normal = ((60, 70), (1100, 700))
        restore = Mock(side_effect=RuntimeError('restore failed'))
        self.api._attach(SimpleNamespace(native=SimpleNamespace(frame=lambda: normal, setFrame_display_=restore),
                                         maximize=Mock()))
        helper = SimpleNamespace(AppHelper=SimpleNamespace(callAfter=lambda callback: callback()))
        with patch('desktop_pywebview.host.sys.platform', 'darwin'), patch.dict('sys.modules', {'PyObjCTools': helper}):
            self.assertTrue(self.api.ToggleMaximize())
            with self.assertRaisesRegex(RuntimeError, 'restore failed'):
                self.api.ToggleMaximize()
            self.assertEqual(self.api._normal_frame, normal)
            self.assertTrue(self.api._maximized)
            restore.side_effect = None
            self.assertFalse(self.api.ToggleMaximize())

    def test_cocoa_unresponsive_gui_reports_timeout(self):
        self.api._attach(SimpleNamespace(native=Mock()))
        helper = SimpleNamespace(AppHelper=SimpleNamespace(callAfter=lambda callback: None))
        with patch('desktop_pywebview.host.sys.platform', 'darwin'), patch.dict('sys.modules', {'PyObjCTools': helper}), patch('desktop_pywebview.host.threading.Event') as event:
            event.return_value.wait.return_value = False
            with self.assertRaisesRegex(RuntimeError, 'timed out'):
                self.api.ToggleMaximize()
        self.assertIsNone(self.api._normal_frame)

    def test_windows_keeps_native_maximize_restore_methods(self):
        window = SimpleNamespace(native=Mock(), maximize=Mock(), restore=Mock())
        self.api._attach(window)
        with patch('desktop_pywebview.host.sys.platform', 'win32'):
            self.assertTrue(self.api.ToggleMaximize())
            self.assertFalse(self.api.ToggleMaximize())
        window.maximize.assert_called_once_with()
        window.restore.assert_called_once_with()
        window.native.frame.assert_not_called()

    def test_windows_workbook_authorization_accepts_equivalent_separators_and_case(self):
        workbook = self.root / 'MixedCase.xlsx'
        workbook.write_bytes(b'authorized workbook')
        with patch('desktop_pywebview.host.sys.platform', 'win32'):
            self.api._approve('data\\MixedCase.xlsx', workbook)
            self.assertEqual(self.api.ReadFile('DATA/MIXEDCASE.XLSX'), base64.b64encode(b'authorized workbook').decode())
            alternate = str(workbook).replace('/', '\\').upper()
            self.assertEqual(self.api.ReadFile(alternate), base64.b64encode(b'authorized workbook').decode())

    def test_windows_path_normalization_does_not_authorize_other_workbooks(self):
        workbook = self.root / 'allowed.xlsx'
        workbook.write_bytes(b'allowed')
        with patch('desktop_pywebview.host.sys.platform', 'win32'):
            self.api._approve('data/allowed.xlsx', workbook)
            with self.assertRaises(PermissionError):
                self.api.ReadFile('data/other.xlsx')

    def test_windows_drive_and_unc_workbook_aliases_use_native_path_rules(self):
        workbook = self.root / 'book.xlsx'
        workbook.write_bytes(b'approved')
        aliases = [(r'C:\Project\Book.xlsx', 'c:/PROJECT/book.xlsx'),
                   (r'\\server\share\Folder\Book.xlsx', '//SERVER/SHARE/folder/book.xlsx')]
        with patch('desktop_pywebview.host.sys.platform', 'win32'):
            for approved, requested in aliases:
                with self.subTest(approved=approved):
                    self.api._approve(approved, workbook)
                    self.assertEqual(self.api.ReadFile(requested), base64.b64encode(b'approved').decode())


if __name__ == "__main__":
    unittest.main()
