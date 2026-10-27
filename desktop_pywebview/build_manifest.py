"""Record build provenance without machine paths or user data."""

from importlib.metadata import PackageNotFoundError, version
import json
from pathlib import Path
import platform
import subprocess


def main():
    root = Path(__file__).resolve().parents[1]
    def command(*args):
        return subprocess.check_output(args, cwd=root, text=True).strip()
    packages = {}
    for name in ("pywebview", "pyinstaller", "pythonnet", "clr_loader", "Pillow"):
        try:
            packages[name] = version(name)
        except PackageNotFoundError:
            pass
    evidence = {"sourceCommit": command("git", "rev-parse", "HEAD"),
                "version": json.loads((root / "package.json").read_text())["version"],
                "python": platform.python_version(), "platform": platform.system(),
                "machine": platform.machine(),
                "node": command("node", "--version"), "packages": packages}
    (root / "release-pywebview/build-manifest.json").write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
