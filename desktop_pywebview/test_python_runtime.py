from pathlib import Path
import tempfile
import sys
import unittest
import zipfile

from .python_runtime import validate, MAX_SOURCE
from .stdlib_bundle import prepare


class PythonRuntimeValidationTests(unittest.TestCase):
    def package(self, entry='main.py', files=None):
        return dict(entryPath=entry, files=files if files is not None else [dict(path=entry, source='pass')])

    def test_paths_duplicates_missing_entry_and_source_limits(self):
        for path in ('../main.py', '/main.py', 'C:/main.py', './main.py', 'dir//main.py', 'x/../main.py', ''):
            with self.subTest(path=path), self.assertRaises(ValueError):
                validate(self.package(path), '{}')
        for files in ([dict(path='other.py', source='')],
                      [dict(path='main.py', source=''), dict(path='MAIN.py', source='')],
                      [dict(path='main.py', source='x' * (MAX_SOURCE + 1))],
                      [dict(path=f'f{i}.py', source='x' * MAX_SOURCE) for i in range(5)]):
            with self.assertRaises(ValueError):
                validate(self.package(files=files), '{}')
        entry, files = validate(self.package('MAIN.py', [dict(path='main.py', source='')]), '{}')
        self.assertEqual(entry, 'main.py')
        self.assertEqual(files, [('main.py', '')])

    def test_standard_library_bundle_includes_dynamic_imports_not_site_packages(self):
        with tempfile.TemporaryDirectory() as directory:
            archive, binaries = prepare(directory)
            with zipfile.ZipFile(archive) as library:
                names = set(library.namelist())
                for name in ('csv.py', 'decimal.py', 'statistics.py', 'ssl.py', 'urllib/request.py', 'sqlite3/__init__.py'):
                    self.assertIn(name, names)
                self.assertFalse(any('site-packages/' in name or name.startswith(('tkinter/', 'ensurepip/')) for name in names))
            self.assertTrue('_sqlite3' in sys.builtin_module_names or any('_sqlite3' in source for source, _ in binaries))

    def test_build_inputs_have_no_go_dependency(self):
        root = Path(__file__).resolve().parents[1]
        self.assertFalse((root / 'go.mod').exists())
        self.assertFalse((root / 'go.sum').exists())
        self.assertFalse(list((root / 'cmd').rglob('*.go')))
        self.assertNotIn('build_helper', (root / 'scripts/run-pywebview.mjs').read_text())
        for name in ('verify.yml', 'pywebview-windows.yml'):
            workflow = (root / '.github/workflows' / name).read_text()
            self.assertNotIn('setup-go', workflow)
            self.assertNotIn('go test', workflow)
