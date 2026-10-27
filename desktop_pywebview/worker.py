"""Python desktop service protocol: conversions and disposable trusted scripts."""

import base64
from concurrent.futures import ThreadPoolExecutor
import multiprocessing
import platform
import json
import threading
import time
import tempfile

from .process_tree import ProcessTree
from .python_runtime import execute, validate, MAX_OUTPUT


def run_project(project, context, cancelled):
    started = time.monotonic()
    result = dict(ok=False, resultJson='', stdout='', stderr='', error='', hostError='', durationMs=0)
    process = tree = None
    receive = send = None
    directory = None
    try:
        validate(project, context)
        ctx = multiprocessing.get_context('spawn')
        receive, send = ctx.Pipe(duplex=False)
        proceed = ctx.Event()
        directory = tempfile.TemporaryDirectory(prefix='ebp-python-')
        process = ctx.Process(target=execute, args=(send, project, context, proceed, directory.name))
        process.start()
        send.close()
        tree = ProcessTree(process)
        proceed.set()
        output_bytes = 0
        while True:
            if cancelled.is_set():
                result['error'] = 'KeyboardInterrupt: Execution cancelled'
                break
            if receive.poll(0.05):
                try:
                    kind, value = receive.recv()
                except EOFError:
                    break
                if kind in ('stdout', 'stderr'):
                    output_bytes += len(value.encode('utf-8'))
                    if output_bytes > MAX_OUTPUT:
                        result['hostError'] = 'Python output exceeds the 1 MB limit.'
                        break
                    result[kind] += value
                elif kind == 'overflow':
                    result['hostError'] = 'Python output exceeds the 1 MB limit.'
                    break
                elif kind in ('error', 'hostError', 'resultJson'):
                    result[kind] = value
                    result['ok'] = kind == 'resultJson'
                    break
            elif not process.is_alive() and not receive.poll(0):
                break
        if not result['ok'] and not result['error'] and not result['hostError']:
            result['hostError'] = f'Python worker exited without a result (exit code {process.exitcode})'
    except Exception as error:
        result['hostError'] = str(error)
    finally:
        if tree:
            tree.close()
        elif process and process.pid:
            process.terminate()
            process.join(5)
        if receive:
            receive.close()
        if send:
            send.close()
        if directory:
            directory.cleanup()
        result['durationMs'] = round((time.monotonic() - started) * 1000)
    return result


def serve(connection):
    lock = threading.Lock()
    active = threading.Event()
    cancelled = threading.Event()
    slots = threading.BoundedSemaphore(4)
    def reply(identifier, value=None, error=None):
        with lock:
            connection.send_bytes(json.dumps(dict(id=identifier, value=value, error=error), ensure_ascii=False, allow_nan=False).encode('utf-8'))
    def dispatch(request):
        method, identifier = request['method'], request['id']
        try:
            if method == 'run':
                value = run_project(request.get('project'), request.get('context'), cancelled)
            else:
                data = base64.b64decode(request.get('data', ''), validate=True)
                if not 0 < len(data) <= 32 << 20:
                    raise ValueError('Equation payload must contain between 1 byte and 32 MB')
                if method == 'mathType':
                    from .equations import convert_ole
                    value = convert_ole(data)
                elif method == 'rasterize':
                    from .rasterize import rasterize
                    value = base64.b64encode(rasterize(data, request.get('extension', ''))).decode('ascii')
                else:
                    raise ValueError('unknown desktop helper method')
            if method == 'run':
                active.clear()
            reply(identifier, value=value)
        except Exception as error:
            if method == 'run':
                active.clear()
            reply(identifier, error=str(error))
        finally:
            slots.release()
    try:
        with ThreadPoolExecutor(max_workers=4) as executor:
            try:
                while True:
                    request = json.loads(connection.recv_bytes(96 << 20))
                    method, identifier = request['method'], request['id']
                    if method == 'close':
                        break
                    if method == 'hello':
                        reply(identifier, dict(protocol=1, python=f'CPython {platform.python_version()} (trusted process)', mathType='mtef-mathml Python port v0.2.0'))
                    elif method == 'cancel':
                        running = active.is_set()
                        if running:
                            cancelled.set()
                        reply(identifier, running)
                    elif method == 'run' and active.is_set():
                        reply(identifier, error='another Python run is already active')
                    elif not slots.acquire(blocking=False):
                        reply(identifier, error='desktop helper is busy')
                    else:
                        if method == 'run':
                            cancelled.clear()
                            active.set()
                        executor.submit(dispatch, request)
            except EOFError:
                pass
            finally:
                cancelled.set()
    finally:
        connection.close()
