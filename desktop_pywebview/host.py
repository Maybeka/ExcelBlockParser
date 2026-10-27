import base64
import json
import ntpath
import os
from importlib.metadata import version
from pathlib import Path
import sys
import tempfile
import threading

from .artifacts import decode_artifacts, prepare_artifacts, write_artifacts
from .helper import NativeHelper
from .file_io import FileReader


class DesktopAPI:
    """Desktop methods matching the current renderer bridge contract."""

    def __init__(self, recovery_dir=None, helper=None, reader=None):
        self._window = None
        self._workbooks = {}
        self._projects = set()
        self._preview = {}
        self._lock = threading.RLock()
        self._confirmed = False
        self._ready = False
        self._maximized = False
        self._normal_frame = None
        self._recovery = Path(recovery_dir or self._config_dir()) / "recovery.json"
        self._preferences = self._recovery.parent / "preferences.json"
        self._helper = helper or NativeHelper()
        self._reader = reader or FileReader()

    @staticmethod
    def _config_dir():
        if os.name == "nt":
            return Path(os.environ.get("APPDATA", Path.home())) / "Excel Block Parser Pywebview"
        return Path.home() / ".config" / "excel-block-parser-pywebview"

    def _attach(self, window):
        self._window = window

    def Ready(self):
        self._ready = True

    def LoadAppLocale(self):
        with self._lock:
            try:
                _, content = self._read(self._preferences, 4096)
                value = json.loads(content)
            except (OSError, ValueError):
                return None
            locale = value.get("locale") if isinstance(value, dict) else None
            return locale if locale in ("en-US", "zh-CN") else None

    def SaveAppLocale(self, locale):
        if locale not in ("en-US", "zh-CN"):
            raise ValueError("Unsupported application locale")
        with self._lock:
            self._preferences.parent.mkdir(parents=True, exist_ok=True)
            self._write(self._preferences, json.dumps({"locale": locale}))

    def RuntimeInfo(self):
        return {"pywebview": version("pywebview"), "hostPython": sys.version.split()[0],
                "scriptPython": "CPython " + sys.version.split()[0] + " (trusted process)",
                "mathType": "mtef-mathml Python port v0.2.0"}

    def _loaded(self):
        from webview.dom import DOMEventHandler
        self._window.dom.document.events.drop += DOMEventHandler(self._drop, prevent_default=True)
        self._window.dom.document.events.dragover += DOMEventHandler(lambda event: None, prevent_default=True)
        self._window.dom.document.on('desktopquit', DOMEventHandler(self._finish_quit))

    def _drop(self, event):
        files = event.get("dataTransfer", {}).get("files", [])
        if len(files) != 1 or not isinstance(files[0], dict):
            return
        path = files[0].get("pywebviewFullPath")
        if isinstance(path, str) and Path(path).suffix.lower() == ".json":
            self._emit("project:file-drop", [path])

    def _on_maximized(self):
        self._maximized = True

    def _on_restored(self):
        if sys.platform == "darwin" and self._normal_frame is not None:
            self._maximized = self._window.native.frame() != self._normal_frame
            if not self._maximized:
                self._normal_frame = None
            return
        self._maximized = False

    def _emit(self, event, *args):
        if self._window and self._ready:
            payload = json.dumps({"event": event, "args": args})
            self._window.evaluate_js(f"window.dispatchEvent(new CustomEvent('desktop-event', {{detail: {payload}}}))")

    def _read(self, path, limit):
        return self._reader.read(path, limit)

    @staticmethod
    def _write(path, content):
        if Path(path).suffix.lower() != ".json":
            raise ValueError("Project save path must use the .json extension")
        json.loads(content)
        encoded = content.encode("utf-8")
        if len(encoded) > 25 * 1024 * 1024:
            raise ValueError("Project exceeds the 25 MB limit")
        path = Path(path)
        descriptor, temporary = tempfile.mkstemp(dir=path.parent, prefix=".project-")
        try:
            with os.fdopen(descriptor, "wb") as stream:
                stream.write(encoded)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(temporary, path)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)

    def _dialog(self, mode, **kwargs):
        import webview
        return self._window.create_file_dialog(getattr(webview.FileDialog, mode), **kwargs)

    def _confirmation(self, title, message):
        return self._window.create_confirmation_dialog(title, message)

    def _approve(self, alias, source):
        path, _ = self._reader.read(source, 100 * 1024 * 1024, inspect_only=True)
        if path.suffix.lower() not in (".xlsx", ".xls"):
            raise ValueError("Select an .xlsx or .xls workbook")
        with self._lock:
            self._workbooks[self._workbook_key(str(alias))] = path
            self._workbooks[self._workbook_key(str(path))] = path
        return str(path)

    @staticmethod
    def _workbook_key(path):
        return ntpath.normcase(ntpath.normpath(path)) if sys.platform == "win32" else path

    def _authorize_sources(self, content, project_path=None):
        document = json.loads(content)
        # Import validation happens in the renderer. Keep previously approved
        # files usable if it rejects this document and retains the old project.
        if not isinstance(document, dict) or document.get("version") != 3:
            return
        project = document.get("project")
        if not isinstance(project, dict) or not isinstance(project.get("workbooks"), list):
            return
        for workbook in project["workbooks"]:
            if not isinstance(workbook, dict):
                continue
            source = workbook.get("sourcePath")
            if not isinstance(source, str) or not source:
                continue
            resolved = Path(source)
            if not resolved.is_absolute():
                if not project_path:
                    continue
                resolved = Path(project_path).parent / resolved
            try:
                self._approve(source, resolved)
            except (OSError, ValueError):
                # The renderer reconciles unavailable sources with the user.
                continue

    def OpenXlsx(self):
        selected = self._dialog("OPEN", allow_multiple=False, file_types=("Excel (*.xlsx;*.xls)",))
        return self._approve(selected[0], selected[0]) if selected else ""

    def ReadFile(self, path):
        with self._lock:
            approved = self._workbooks.get(self._workbook_key(path)) if isinstance(path, str) else None
        if approved is None:
            raise PermissionError("Select a workbook before reading it")
        resolved, data = self._read(approved, 100 * 1024 * 1024)
        if resolved != approved:
            raise PermissionError("Workbook must be selected through the Open dialog")
        return base64.b64encode(data).decode("ascii")

    def OpenJson(self):
        selected = self._dialog("OPEN", allow_multiple=False, file_types=("JSON (*.json)",))
        return self.OpenDroppedJson(selected[0]) if selected else None

    def OpenDroppedJson(self, path):
        if Path(path).suffix.lower() != ".json":
            raise ValueError("Drop a single project JSON file")
        path, data = self._read(path, 25 * 1024 * 1024)
        content = data.decode("utf-8-sig")
        json.loads(content)
        with self._lock:
            self._projects.add(str(path))
        self._authorize_sources(content, path)
        return {"filePath": str(path), "content": content}

    def SaveJson(self, name, content):
        name = Path(name.replace("\\", "/")).name or "project.json"
        if not name.lower().endswith(".json"):
            name += ".json"
        selected = self._dialog("SAVE", save_filename=name, file_types=("JSON (*.json)",))
        if not selected:
            return {"success": False, "error": "cancelled"}
        path = str(Path(selected if isinstance(selected, str) else selected[0]).resolve())
        self._write(path, content)
        with self._lock:
            self._projects.add(path)
        return {"success": True, "filePath": path}

    def SaveJsonToPath(self, path, content):
        path = str(Path(path).resolve())
        with self._lock:
            if path not in self._projects:
                raise PermissionError("Project must be opened or saved through the application first")
        self._write(path, content)
        return {"success": True, "filePath": path}

    def SaveRecovery(self, content):
        self._recovery.parent.mkdir(parents=True, exist_ok=True)
        self._write(self._recovery, content)

    def LoadRecovery(self):
        if not self._recovery.exists():
            return None
        _, data = self._read(self._recovery, 25 * 1024 * 1024)
        content = data.decode("utf-8")
        self._authorize_sources(content)
        return content

    def ClearRecovery(self):
        self._recovery.unlink(missing_ok=True)

    def _before_close(self):
        with self._lock:
            if self._confirmed or not self._ready:
                return True
        # Native closing callbacks can run on the GUI thread. Return before
        # evaluating JavaScript so WebView dispatch cannot block that thread.
        threading.Thread(target=self.RequestClose, daemon=True).start()
        return False

    def RequestClose(self):
        self._emit("window:close-requested")

    def ConfirmQuit(self):
        with self._lock:
            self._confirmed = True

    def _finish_quit(self, event=None):
        with self._lock:
            if not self._confirmed:
                return
        # This one-way DOM event arrives after the ConfirmQuit RPC response.
        # Destroying inside that RPC strands its response thread on macOS.
        self._shutdown()
        self._window.destroy()

    def _shutdown(self):
        self._reader.close()
        self._helper.close()

    def Minimize(self):
        self._window.minimize()

    def ToggleMaximize(self):
        if sys.platform == "darwin" and getattr(self._window, "native", None) is not None:
            return self._toggle_cocoa_maximize()
        maximized = not self._maximized
        self._maximized = maximized
        if not maximized:
            self._window.restore()
        else:
            self._window.maximize()
        return maximized

    def _toggle_cocoa_maximize(self):
        from PyObjCTools import AppHelper
        completed = threading.Event()
        failures = []
        result = []
        def toggle():
            try:
                if self._normal_frame is None:
                    frame = self._window.native.frame()
                    self._window.maximize()
                    self._normal_frame = frame
                    self._maximized = True
                else:
                    # Cocoa restore only deminiaturizes in pywebview 6.2.1.
                    # A native frame also preserves exact multi-monitor coordinates.
                    self._window.native.setFrame_display_(self._normal_frame, True)
                    self._normal_frame = None
                    self._maximized = False
                result.append(self._maximized)
            except Exception as error:
                failures.append(error)
            finally:
                completed.set()
        AppHelper.callAfter(toggle)
        if not completed.wait(10):
            raise RuntimeError("Native window maximize/restore timed out")
        if failures:
            raise failures[0]
        return result[0]

    def OpenPreviewWindow(self, block_id):
        self._emit("open-preview", block_id)

    def SetPreviewData(self, block_id, data):
        self._preview[block_id] = data

    def GetPreviewData(self, block_id):
        return self._preview.get(block_id)

    def ClosePreviewWindow(self):
        self._preview.clear()
        self._emit("close-preview")

    def CancelPythonRun(self):
        return self._helper.request("cancel")

    def RunProjectPython(self, project, context_json):
        return self._helper.request("run", project=project, context=context_json)

    def ExportPythonArtifacts(self, name, artifacts_json):
        artifacts = decode_artifacts(artifacts_json)
        selected = self._dialog("FOLDER")
        if not selected:
            return {"success": False, "error": "cancelled"}
        directory = selected if isinstance(selected, str) else selected[0]
        root, prepared = prepare_artifacts(directory, artifacts)
        conflicts = sum(exists for _, _, exists in prepared)
        if conflicts and not self._confirmation(
            "Replace generated files?", f"{conflicts} generated file(s) already exist in the selected directory. Replace them?"
        ):
            return {"success": False, "error": "cancelled"}
        write_artifacts(root, prepared)
        return {"success": True, "directory": str(root), "written": len(prepared)}

    def RasterizeLegacyEquationPreview(self, data, extension):
        encoded = base64.b64encode(bytes(data)).decode("ascii")
        result = self._helper.request("rasterize", data=encoded, extension=extension)
        return list(base64.b64decode(result))

    def ConvertMathTypeOLE(self, data):
        encoded = base64.b64encode(bytes(data)).decode("ascii")
        return self._helper.request("mathType", data=encoded)
