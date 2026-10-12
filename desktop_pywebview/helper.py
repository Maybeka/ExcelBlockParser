"""Bounded transport to the existing isolated Python and equation implementations."""

from concurrent.futures import Future
import json
from pathlib import Path
import subprocess
import sys
import threading


class NativeHelper:
    def __init__(self, executable=None):
        root = Path(__file__).resolve().parents[1]
        self._executable = Path(executable or root / "desktop_pywebview" / "bin" /
                                ("native-helper.exe" if sys.platform == "win32" else "native-helper"))
        self._lock = threading.RLock()
        self._write_lock = threading.Lock()
        self._process = None
        self._pending = {}
        self._counter = 0
        self._reader = None
        self._closed = False
        self._failure = None

    def _start(self):
        if self._closed:
            raise RuntimeError("Desktop helper has been closed")
        if self._failure:
            raise RuntimeError(f"Desktop helper protocol failed: {self._failure}")
        if self._process is not None:
            if self._process.poll() is not None:
                raise RuntimeError("Desktop helper exited unexpectedly")
            return
        if not self._executable.is_file():
            raise RuntimeError("Native helper is missing. Run: python -m desktop_pywebview.build_helper")
        self._process = subprocess.Popen(
            [str(self._executable)], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
            # Keep stdout strictly reserved for the JSON protocol.
            stderr=None, creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
        )
        self._reader = threading.Thread(target=self._read_responses, daemon=True)
        self._reader.start()

    def _read_responses(self):
        try:
            while True:
                line = self._process.stdout.readline(96 * 1024 * 1024 + 1)
                if not line:
                    raise RuntimeError("Desktop helper exited before replying")
                if len(line) > 96 * 1024 * 1024:
                    raise RuntimeError("Desktop helper response exceeds the size limit")
                response = json.loads(line)
                with self._lock:
                    future = self._pending.pop(response["id"], None)
                if future:
                    if response.get("error"):
                        future.set_exception(RuntimeError(response["error"]))
                    else:
                        future.set_result(response.get("value"))
        except Exception as error:
            with self._lock:
                self._failure = error
                pending, self._pending = self._pending, {}
            for future in pending.values():
                future.set_exception(error)

    def request(self, method, **payload):
        # Serialize complete protocol messages without preventing the reader
        # from dispatching replies while a pipe write waits for capacity.
        with self._write_lock:
            with self._lock:
                self._start()
                self._counter += 1
                identifier = self._counter
                future = Future()
                self._pending[identifier] = future
                process = self._process
            try:
                message = json.dumps({"id": identifier, "method": method, **payload}, ensure_ascii=False, allow_nan=False)
                encoded = (message + "\n").encode("utf-8")
                if len(encoded) > 96 * 1024 * 1024:
                    raise ValueError("Desktop helper request exceeds the size limit")
                process.stdin.write(encoded)
                process.stdin.flush()
            except Exception:
                with self._lock:
                    self._pending.pop(identifier, None)
                raise
        # Script runs remain user-controlled; control/conversion calls are bounded.
        try:
            return future.result(timeout=None if method == "run" else 60)
        except TimeoutError:
            self.close()
            raise RuntimeError("Desktop helper request timed out") from None

    def close(self):
        with self._lock:
            self._closed = True
            process = self._process
        if process:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait()
            if self._reader:
                self._reader.join(timeout=5)
            process.stdin.close()
            process.stdout.close()
