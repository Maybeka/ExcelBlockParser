"""Cancelable filesystem reads isolated from the GUI and bridge threads."""

import multiprocessing
from pathlib import Path
import threading


def _file_worker(connection, path, limit, inspect_only):
    try:
        resolved = Path(path).resolve(strict=True)
        if not resolved.is_file():
            raise ValueError("Selected path is not a regular file")
        if resolved.stat().st_size > limit:
            raise ValueError("File exceeds the size limit")
        data = None
        if not inspect_only:
            with resolved.open("rb") as stream:
                data = stream.read(limit + 1)
            if len(data) > limit:
                raise ValueError("File exceeds the size limit")
        connection.send((True, str(resolved), data))
    except Exception as error:
        connection.send((False, type(error).__name__, str(error)))
    finally:
        connection.close()


class FileReader:
    def __init__(self, timeout=30, worker=_file_worker):
        self.timeout = timeout
        self._worker = worker
        self._context = multiprocessing.get_context("spawn")
        self._lock = threading.Lock()
        self._processes = set()
        self._closed = False

    @staticmethod
    def _stop(process):
        if process.is_alive():
            process.terminate()
        process.join(5)
        if process.is_alive():
            process.kill()
            process.join(5)
        if process.is_alive():
            raise RuntimeError("File worker could not be stopped")

    def read(self, path, limit, inspect_only=False):
        receive, send = self._context.Pipe(duplex=False)
        process = self._context.Process(target=self._worker, args=(send, str(path), limit, inspect_only))
        started = False
        try:
            with self._lock:
                if self._closed:
                    raise RuntimeError("File reader has been closed")
                process.start()
                started = True
                self._processes.add(process)
            send.close()
            if not receive.poll(self.timeout):
                raise TimeoutError(f"File read timed out after {self.timeout:g} seconds")
            try:
                success, value, data = receive.recv()
            except EOFError:
                raise RuntimeError("File read was interrupted") from None
            if not success:
                error_type = {"ValueError": ValueError, "FileNotFoundError": FileNotFoundError,
                              "PermissionError": PermissionError, "OSError": OSError}.get(value, OSError)
                raise error_type(data)
            return Path(value), data
        finally:
            receive.close()
            send.close()
            if started:
                self._stop(process)
                with self._lock:
                    self._processes.discard(process)

    def close(self):
        with self._lock:
            self._closed = True
            processes = list(self._processes)
        for process in processes:
            self._stop(process)
