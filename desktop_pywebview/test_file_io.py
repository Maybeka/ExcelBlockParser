import multiprocessing
from pathlib import Path
import tempfile
import threading
import time
import unittest
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace

from .file_io import FileReader


def blocked_worker(connection, path, limit, inspect_only):
    time.sleep(60)


def exited_worker(connection, path, limit, inspect_only):
    connection.close()


class FileReaderTests(unittest.TestCase):
    def test_concurrent_cleanup_serializes_process_polling_and_joining(self):
        reader = FileReader()
        active = peak = 0
        lock = threading.Lock()
        def is_alive():
            nonlocal active, peak
            with lock:
                active += 1
                peak = max(peak, active)
            time.sleep(0.002)
            with lock:
                active -= 1
            return False
        process = SimpleNamespace(is_alive=is_alive, join=lambda _: None)
        with ThreadPoolExecutor(max_workers=8) as executor:
            list(executor.map(reader._stop, [process] * 24))
        self.assertEqual(peak, 1)
        reader.close()

    def test_worker_exit_does_not_wait_for_read_timeout(self):
        reader = FileReader(worker=exited_worker)
        self.addCleanup(reader.close)
        started = time.monotonic()
        with self.assertRaises(RuntimeError):
            reader.read("unused", 10)
        self.assertLess(time.monotonic() - started, 5)
        self.assertFalse(reader._processes)

    def test_read_inspect_limits_and_failure_cleanup(self):
        reader = FileReader()
        self.addCleanup(reader.close)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory, "book.xlsx")
            path.write_bytes(b"abc")
            self.assertEqual(reader.read(path, 3), (path.resolve(), b"abc"))
            self.assertEqual(reader.read(path, 3, inspect_only=True), (path.resolve(), None))
            with self.assertRaisesRegex(ValueError, "size limit"):
                reader.read(path, 2)
            with self.assertRaises(FileNotFoundError):
                reader.read(path.with_name("missing"), 3)
            self.assertFalse(reader._processes)

    def test_timeout_kills_worker_and_next_read_can_succeed(self):
        reader = FileReader(timeout=0.5, worker=blocked_worker)
        self.addCleanup(reader.close)
        before = {process.pid for process in multiprocessing.active_children()}
        with self.assertRaisesRegex(TimeoutError, "timed out"):
            reader.read("unused", 10)
        self.assertFalse(reader._processes)
        self.assertEqual({process.pid for process in multiprocessing.active_children()}, before)
        from .file_io import _file_worker
        reader._worker = _file_worker
        reader.timeout = 10
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory, "retry")
            path.write_bytes(b"ok")
            self.assertEqual(reader.read(path, 10)[1], b"ok")

    def test_close_interrupts_pending_read_and_rejects_new_work(self):
        reader = FileReader(worker=blocked_worker)
        errors = []
        def read():
            try:
                reader.read("unused", 10)
            except Exception as error:
                errors.append(error)
        thread = threading.Thread(target=read)
        thread.start()
        try:
            deadline = time.monotonic() + 5
            while not reader._processes and time.monotonic() < deadline:
                time.sleep(0.01)
            reader.close()
        finally:
            reader.close()
            thread.join(10)
        self.assertFalse(thread.is_alive())
        self.assertTrue(errors)
        self.assertFalse(reader._processes)
        with self.assertRaisesRegex(RuntimeError, "closed"):
            reader.read("unused", 10)
