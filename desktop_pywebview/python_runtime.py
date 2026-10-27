"""Trusted project execution in disposable CPython processes, not a security sandbox."""

import contextlib
import importlib
import json
import os
from pathlib import Path, PurePosixPath
import sys
import threading
import traceback


MAX_SOURCE = 2 << 20
MAX_PROJECT = 8 << 20
MAX_CONTEXT = 25 << 20
MAX_RESULT = 32 << 20
MAX_OUTPUT = 1 << 20
_dll_directories = []


def validate(project, context):
    def normalize(path):
        if not isinstance(path, str):
            raise ValueError('Python package requires an entry Python file')
        value = path.strip().replace('\\', '/')
        parsed = PurePosixPath(value)
        if not value.endswith('.py') or parsed.is_absolute() or ':' in value or '..' in parsed.parts or str(parsed) != value:
            raise ValueError(f'Python package contains an invalid file: {value}')
        return value
    if not isinstance(project, dict) or not isinstance(project.get('files'), list) or not project['files']:
        raise ValueError('Python package requires an entry Python file')
    entry = normalize(project.get('entryPath'))
    total, files, names = 0, [], set()
    for file in project['files']:
        if not isinstance(file, dict):
            raise ValueError('Python package contains an invalid file')
        path, source = normalize(file.get('path')), file.get('source')
        if not isinstance(source, str) or len(source.encode('utf-8')) > MAX_SOURCE:
            raise ValueError(f'Python package contains an invalid file: {path}')
        if path.casefold() in names:
            raise ValueError(f'Python package contains duplicate file path: {path}')
        names.add(path.casefold())
        total += len(source.encode('utf-8'))
        if total > MAX_PROJECT:
            raise ValueError('Python package exceeds the 8 MB limit')
        files.append((path, source))
    if entry.casefold() not in names:
        raise ValueError('Python package entry file is missing')
    # Use the actual spelling so case-insensitive validation works on every OS.
    entry = next(path for path, _ in files if path.casefold() == entry.casefold())
    if not isinstance(context, str) or len(context.encode('utf-8')) > MAX_CONTEXT:
        raise ValueError('Python context exceeds the 25 MB limit')
    try:
        json.loads(context, parse_constant=lambda value: (_ for _ in ()).throw(ValueError(value)))
    except (ValueError, TypeError):
        raise ValueError('Python context is not valid JSON') from None
    return entry, files


def enable_bundled_stdlib():
    if getattr(sys, 'frozen', False):
        base = Path(sys._MEIPASS)
        for path in (base / 'python-stdlib.zip', base / 'python-extensions'):
            if path.exists():
                sys.path.append(str(path))
        if os.name == 'nt':
            _dll_directories.append(os.add_dll_directory(str(base / 'python-extensions')))


def execute(connection, project, context, proceed, directory):
    """The parent owns lifetime and output limits, even if user code catches errors."""
    if os.name != 'nt':
        os.setsid()
    proceed.wait()
    enable_bundled_stdlib()
    lock = threading.Lock()
    def send(kind, value):
        with lock:
            connection.send((kind, value))
    class Output:
        encoding = 'utf-8'
        def __init__(self, name):
            self.name, self.size = name, 0
        def write(self, value):
            if not isinstance(value, str):
                raise TypeError('write() argument must be str')
            self.size += len(value.encode('utf-8'))
            if self.size > MAX_OUTPUT:
                send('overflow', None)
                raise RuntimeError('Python output exceeds the 1 MB limit.')
            if value:
                send(self.name, value)
            return len(value)
        def flush(self):
            pass
        def isatty(self):
            return False
    try:
        entry, files = validate(project, context)
        with contextlib.nullcontext(directory):
            for name, source in files:
                path = Path(directory, name)
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(source, encoding='utf-8')
            os.chdir(directory)
            sys.path.insert(0, directory)
            module = entry[:-3].replace('/', '.')
            with contextlib.redirect_stdout(Output('stdout')), contextlib.redirect_stderr(Output('stderr')):
                script = importlib.import_module(module)
                process = getattr(script, 'process', None)
                if not callable(process):
                    raise TypeError('Python package entry file must define callable process(context)')
                value = process(json.loads(context))
                result = json.dumps(value, ensure_ascii=False, allow_nan=False)
                if len(result.encode('utf-8')) > MAX_RESULT:
                    send('hostError', 'Python result exceeds the 32 MB limit.')
                else:
                    send('resultJson', result)
    except BaseException:
        send('error', traceback.format_exc(limit=20)[:MAX_OUTPUT])
    finally:
        connection.close()
