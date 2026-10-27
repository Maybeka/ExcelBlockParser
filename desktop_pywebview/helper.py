"""Bounded, serialized transport to a Python-owned desktop service process."""

from concurrent.futures import Future
import json
import multiprocessing
import threading

from .worker import serve


class NativeHelper:
    def __init__(self):
        self._lock = threading.RLock()
        self._write_lock = threading.Lock()
        self._process = self._connection = self._reader = None
        self._pending = {}
        self._counter = 0
        self._closed = False
        self._failure = None

    def _start(self):
        if self._closed:
            raise RuntimeError('Desktop helper has been closed')
        if self._failure:
            raise RuntimeError(f'Desktop helper protocol failed: {self._failure}')
        if self._process is not None:
            if not self._process.is_alive():
                raise RuntimeError('Desktop helper exited unexpectedly')
            return
        ctx = multiprocessing.get_context('spawn')
        self._connection, child = ctx.Pipe()
        self._process = ctx.Process(target=serve, args=(child,))
        try:
            self._process.start()
        finally:
            child.close()
        self._reader = threading.Thread(target=self._read_responses, daemon=True)
        self._reader.start()

    def _read_responses(self):
        try:
            while True:
                response = json.loads(self._connection.recv_bytes(96 << 20))
                with self._lock:
                    future = self._pending.pop(response['id'], None)
                if future:
                    if response.get('error'):
                        future.set_exception(RuntimeError(response['error']))
                    else:
                        future.set_result(response.get('value'))
        except Exception as error:
            with self._lock:
                self._failure = error
                pending, self._pending = self._pending, {}
            for future in pending.values():
                future.set_exception(error)

    def request(self, method, **payload):
        with self._write_lock:
            with self._lock:
                self._start()
                self._counter += 1
                identifier = self._counter
                future = Future()
                self._pending[identifier] = future
            try:
                encoded = json.dumps(dict(id=identifier, method=method, **payload), ensure_ascii=False, allow_nan=False).encode('utf-8')
                if len(encoded) > 96 << 20:
                    raise ValueError('Desktop helper request exceeds the size limit')
                self._connection.send_bytes(encoded)
            except Exception:
                with self._lock:
                    self._pending.pop(identifier, None)
                raise
        try:
            return future.result(timeout=None if method == 'run' else 60)
        except TimeoutError:
            self.close()
            raise RuntimeError('Desktop helper request timed out') from None

    def close(self):
        with self._write_lock:
            with self._lock:
                if self._closed:
                    return
                self._closed = True
                process = self._process
                pending, self._pending = self._pending, {}
            for future in pending.values():
                future.set_exception(RuntimeError('Desktop helper has been closed'))
            if process and process.is_alive():
                try:
                    self._connection.send_bytes(b'{"id":0,"method":"close"}')
                except (OSError, EOFError):
                    pass
        if process:
            process.join(10)
            if process.is_alive():
                process.terminate()
                process.join(5)
            if process.is_alive():
                process.kill()
                process.join(5)
            if self._reader:
                self._reader.join(5)
            self._connection.close()
