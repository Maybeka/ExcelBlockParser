"""Bounded source/package acceptance with completion reports and process cleanup."""

import argparse
import json
import os
from pathlib import Path
import signal
import subprocess
import sys


SUITES = (
    ("project", ["--native-suite"]),
    ("sources", ["--native-project-suite"]),
    ("browser", ["--native-browser-suite"]),
    ("window", ["--native-window-suite"]),
    ("outline", ["--native-outline-suite"]),
    ("drawings", ["--native-drawing-suite"]),
    ("python", ["--native-python-suite"]),
    ("recovery", ["--native-recovery-suite"]),
    ("preferences", ["--native-preferences-suite"]),
    ("close-discard", ["--smoke-test", "--smoke-close-action", "discard"]),
    ("close-save", ["--smoke-test", "--smoke-close-action", "save"]),
)


def stop_tree(process):
    if os.name == "nt":
        subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
    else:
        try:
            os.killpg(process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    process.wait()


def run_case(command, log_path, timeout, cwd, require_report=False):
    log_path = Path(log_path)
    log_path.parent.mkdir(parents=True, exist_ok=True)
    report = log_path.with_suffix(".result.json")
    environment = os.environ.copy()
    if require_report:
        report.unlink(missing_ok=True)
        environment["PYWEBVIEW_TEST_REPORT"] = str(report.resolve())
    with log_path.open("w", encoding="utf-8") as output:
        process = subprocess.Popen(command, cwd=cwd, stdout=output,
                                   stderr=subprocess.STDOUT,
                                   start_new_session=os.name != "nt", env=environment)
        try:
            code = process.wait(timeout=timeout)
        except BaseException:
            stop_tree(process)
            raise
    if code:
        raise RuntimeError(f"Native verification exited {code}; see {log_path}")
    if require_report:
        try:
            result = json.loads(report.read_text(encoding="utf-8"))
        except (OSError, ValueError) as error:
            raise RuntimeError(f"Missing or invalid native completion report: {report}") from error
        if not isinstance(result, dict) or result.get("completed") is not True:
            raise RuntimeError(f"Native verification did not complete: {result}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--timeout", type=float, default=600)
    parser.add_argument("--logs", default=".tmp/pywebview-native-logs")
    parser.add_argument("--executable", help="Replay the packaged application instead of the source host")
    args = parser.parse_args()
    if args.timeout <= 0:
        parser.error("--timeout must be positive")
    root = Path(__file__).resolve().parents[1]
    if args.executable:
        executable = Path(args.executable).resolve()
        if not executable.is_file():
            parser.error(f"Packaged executable not found: {executable}")
        command = [str(executable)]
    else:
        command = [sys.executable, "-u", "-m", "desktop_pywebview"]
    for name, flags in SUITES:
        log = Path(args.logs) / f"{name}.log"
        if not log.is_absolute():
            log = root / log
        print(f"Running pywebview native {name}: {log}", flush=True)
        run_case([*command, *flags], log, args.timeout, root, require_report=True)
        print(f"PASS pywebview native {name}", flush=True)


if __name__ == "__main__":
    main()
