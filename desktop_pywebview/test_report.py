"""Explicit completion evidence for source and console-free packaged test runs."""

import json
import os
from pathlib import Path
import traceback


def run_with_report(main):
    # Restart children must not overwrite the parent suite's completion report.
    destination = os.environ.pop("PYWEBVIEW_TEST_REPORT", None)
    if not destination:
        return main()
    report = Path(destination)
    report.parent.mkdir(parents=True, exist_ok=True)
    try:
        result = main()
    except BaseException:
        report.write_text(json.dumps({"completed": False, "error": traceback.format_exc()}), encoding="utf-8")
        raise
    report.write_text(json.dumps({"completed": True}), encoding="utf-8")
    return result
