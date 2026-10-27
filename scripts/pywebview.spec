from pathlib import Path
import sys
from PyInstaller.utils.hooks import collect_data_files

root = Path(SPECPATH).parent
windows = sys.platform == "win32"
sys.path.insert(0, str(root))
from desktop_pywebview.stdlib_bundle import prepare
stdlib, extensions = prepare(root)

analysis = Analysis(
    [str(root / "scripts" / "pywebview_entry.py")],
    pathex=[str(root)],
    binaries=extensions,
    datas=[(stdlib, '.'), (str(root / 'desktop_pywebview/equations/fontmaps'), 'desktop_pywebview/equations/fontmaps'),
           (str(root / "dist"), "dist"), (str(root / "examples/project.json"), "examples"),
           (str(root / "examples/test_data.xlsx"), "examples"),
           (str(root / "examples/multi_sheet.xlsx"), "examples"),
           (str(root / "src/renderer/__tests__/fixtures/project-v3-complete.json"), "src/renderer/__tests__/fixtures"),
           (str(root / ".tmp/pywebview-browser-fixtures"), ".tmp/pywebview-browser-fixtures"),
           (str(root / ".tmp/pywebview-drawing-fixtures"), ".tmp/pywebview-drawing-fixtures"),
           (str(root / "tests-native/fixtures/office-math-textbox.xlsx"), "tests-native/fixtures"),
           (str(root / "tests-native/fixtures/mathtype-equation-dsmt4.xlsx"), "tests-native/fixtures"),
           *collect_data_files("webview")],
    hiddenimports=["webview.platforms.winforms" if windows else "webview.platforms.cocoa"],
    excludes=["PyQt5", "PyQt6", "PySide2", "PySide6", "tkinter", "matplotlib", "numpy"],
    noarchive=False,
)
archive = PYZ(analysis.pure)
executable = EXE(
    archive, analysis.scripts, analysis.binaries if windows else [],
    analysis.datas if windows else [], exclude_binaries=not windows,
    name="Excel Block Parser", debug=False, strip=False, upx=False, console=False,
    icon=str(root / "build" / ("icon.png" if windows else "icon-transparent.png")),
)
if sys.platform == "darwin":
    collection = COLLECT(executable, analysis.binaries, analysis.datas, strip=False, upx=False, name="Excel Block Parser")
    app = BUNDLE(collection, name="Excel Block Parser.app", icon=str(root / "build/icon-transparent.png"),
                 bundle_identifier="io.excelblockparser.pywebview")
