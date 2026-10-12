"""Build a console-only helper; no Wails runtime is linked into it."""

import argparse
import os
from pathlib import Path
import subprocess
import sys


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--windows", action="store_true", help="Cross-build the Windows amd64 helper")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    windows = args.windows or sys.platform == "win32"
    destination = root / "desktop_pywebview" / "bin" / ("native-helper.exe" if windows else "native-helper")
    destination.parent.mkdir(parents=True, exist_ok=True)
    environment = os.environ.copy()
    if args.windows:
        environment.update(GOOS="windows", GOARCH="amd64", CGO_ENABLED="0")
    subprocess.run([
        "go", "build", "-trimpath", "-o", str(destination), "pywebview_helper.go",
        "python_runtime.go", "legacy_equation_windows.go" if windows else "legacy_equation_stub.go",
    ], cwd=root, env=environment, check=True)
    print(destination)


if __name__ == "__main__":
    main()
