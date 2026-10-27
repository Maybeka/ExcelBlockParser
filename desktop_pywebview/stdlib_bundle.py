"""Ship CPython's standard library for modules imported dynamically by scripts."""

import importlib.machinery
from pathlib import Path
import sys
import sysconfig
import zipfile


def prepare(root):
    source = Path(sysconfig.get_path('stdlib'))
    destination = Path(root, '.tmp/python-stdlib.zip')
    destination.parent.mkdir(parents=True, exist_ok=True)
    excluded = {'site-packages', 'test', 'tests', 'tkinter', 'turtledemo', 'idlelib',
                'ensurepip', '__pycache__', 'venv', 'config-3.12-darwin'}
    with zipfile.ZipFile(destination, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(source.rglob('*.py')):
            relative = path.relative_to(source)
            if not any(part in excluded or part.startswith('config-') for part in relative.parts):
                archive.write(path, relative.as_posix())
    binaries = []
    native = Path(sys.base_prefix, 'DLLs') if sys.platform == 'win32' else source / 'lib-dynload'
    for path in sorted(native.iterdir()):
        if path.is_file() and (any(path.name.endswith(s) for s in importlib.machinery.EXTENSION_SUFFIXES) or path.suffix.lower() == '.dll'):
            if not path.name.startswith(('_tkinter', 'tcl', 'tk8', '_test')):
                binaries.append((str(path), 'python-extensions'))
    return str(destination), binaries
