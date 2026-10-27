"""Minimal, data-free diagnostics for console-free desktop startup failures."""

import json
from pathlib import Path
import sys
import traceback


def run_desktop():
    try:
        from .__main__ import main
        from .test_report import run_with_report
        return run_with_report(main)
    except Exception as error:
        from .host import DesktopAPI
        destination = DesktopAPI._config_dir() / "startup-error.json"
        evidence = {"errorType": type(error).__name__, "python": sys.version.split()[0],
                    "frames": [{"file": Path(frame.filename).name, "line": frame.lineno,
                                "function": frame.name} for frame in traceback.extract_tb(error.__traceback__)[-12:]],
                    "help": "Check WebView2 installation and the complete application build. Retry from a writable local folder."}
        try:
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_text(json.dumps(evidence, indent=2), encoding="utf-8")
        except OSError:
            pass
        raise RuntimeError(f"Desktop startup failed ({type(error).__name__}). "
                           f"Check WebView2 and the application files. Diagnostic: {destination}") from error
