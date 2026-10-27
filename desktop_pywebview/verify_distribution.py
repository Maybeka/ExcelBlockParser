"""Windows downloaded single-file regression, including a legacy ZIP control."""

import argparse
import hashlib
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from functools import partial
import json
import os
from pathlib import Path
import subprocess
import sys
import threading
import time
from urllib.request import urlopen
import zipfile

from .verify_native import run_case, stop_tree


ZONE = b"[ZoneTransfer]\r\nZoneId=3\r\nHostUrl=https://github.com/Maybeka/ExcelBlockParser/releases/\r\n"
RUNTIME_ERROR = "Failed to resolve Python.Runtime.Loader.Initialize"
BASELINE_SHA256 = "4c6ea9419cb36caef61a1b14611c66a184baa02a3cb1ef941260275a2df8ba02"


def mark_download(path):
    Path(f"{path}:Zone.Identifier").write_bytes(ZONE)


def assert_marked(path):
    if Path(f"{path}:Zone.Identifier").read_bytes() != ZONE:
        raise RuntimeError(f"Download marker changed: {path}")


def make_archive(executable, archive):
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED) as output:
        output.write(executable, executable.name)


def download_archive(source, destination):
    # HTTP round-trip validates the release ZIP, independently of the build tree.
    class QuietHandler(SimpleHTTPRequestHandler):
        def log_message(self, *_):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(QuietHandler, directory=str(source.parent)))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        with urlopen(f"http://127.0.0.1:{server.server_port}/{source.name}", timeout=30) as response:
            destination.write_bytes(response.read())
    finally:
        server.shutdown()
        server.server_close()
        thread.join()
    if hashlib.sha256(source.read_bytes()).digest() != hashlib.sha256(destination.read_bytes()).digest():
        raise RuntimeError("Downloaded ZIP does not match the release archive")


def extract_download(archive, directory):
    assert_marked(archive)
    with zipfile.ZipFile(archive) as source:
        for entry in source.infolist():
            target = (directory / entry.filename).resolve()
            if not target.is_relative_to(directory.resolve()):
                raise RuntimeError(f"ZIP entry escapes extraction directory: {entry.filename}")
        source.extractall(directory)
    # zipfile/Expand-Archive do not propagate MOTW like Explorer does. Reproduce
    # Explorer's stricter downloaded-ZIP behavior explicitly, without unblocking.
    for path in directory.rglob("*"):
        if path.is_file():
            mark_download(path)


def expect_original_failure(executable, log, timeout):
    """A failing GUI executable can display a modal crash dialog: reap it promptly."""
    report = log.with_suffix(".result.json")
    report.unlink(missing_ok=True)
    environment = os.environ.copy()
    environment["PYWEBVIEW_TEST_REPORT"] = str(report)
    process = None
    try:
        with log.open("w", encoding="utf-8") as output:
            process = subprocess.Popen([str(executable), "--smoke-test"], cwd=executable.parent,
                                       stdout=output, stderr=subprocess.STDOUT, env=environment)
            deadline = time.monotonic() + timeout
            while time.monotonic() < deadline:
                if report.is_file():
                    try:
                        result = json.loads(report.read_text(encoding="utf-8"))
                    except (ValueError, OSError):
                        time.sleep(0.1)
                        continue
                    if result.get("completed") is not False or RUNTIME_ERROR not in result.get("error", ""):
                        raise RuntimeError(f"Negative control did not reproduce the reported CLR failure: {result}")
                    return result
                if process.poll() is not None:
                    raise RuntimeError(f"Negative control exited without a failure report; see {log}")
                time.sleep(0.1)
            raise TimeoutError(f"Negative control produced no CLR failure report; see {log}")
    finally:
        if process is not None:
            stop_tree(process)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--executable", default="release-pywebview/Excel Block Parser.exe")
    parser.add_argument("--baseline-archive", required=True, help="Previous public onedir ZIP (negative control)")
    parser.add_argument("--archive", default="release-pywebview/ExcelBlockParser-pywebview-windows-x64.zip")
    parser.add_argument("--workspace", default=".tmp/pywebview-downloaded-distribution")
    parser.add_argument("--timeout", type=float, default=120)
    args = parser.parse_args()
    if sys.platform != "win32":
        parser.error("Distribution acceptance requires Windows/NTFS")
    if args.timeout <= 0:
        parser.error("--timeout must be positive")
    source, archive, workspace = Path(args.executable).resolve(), Path(args.archive).resolve(), Path(args.workspace).resolve()
    baseline = Path(args.baseline_archive).resolve()
    if not source.is_file() or not baseline.is_file():
        parser.error("Build the single-file Windows EXE and download the previous ZIP first")
    if hashlib.sha256(baseline.read_bytes()).hexdigest() != BASELINE_SHA256:
        parser.error("The previous public preview ZIP does not match its recorded release checksum")
    executable_name = source.name
    workspace.mkdir(parents=True, exist_ok=False)
    archive.parent.mkdir(parents=True, exist_ok=True)
    make_archive(source, archive)
    downloaded = workspace / archive.name
    download_archive(archive, downloaded)
    mark_download(downloaded)
    extracted = workspace / "Downloaded app with spaces"
    extract_download(downloaded, extracted)
    executable = extracted / executable_name
    if sorted(path.name for path in extracted.iterdir()) != [executable_name]:
        raise RuntimeError("The downloaded application must contain only one executable")
    legacy_archive = workspace / "previous-preview.zip"
    legacy_archive.write_bytes(baseline.read_bytes())
    mark_download(legacy_archive)
    legacy = workspace / "Previous onedir preview"
    extract_download(legacy_archive, legacy)
    failure = expect_original_failure(legacy / "Excel Block Parser.exe", workspace / "legacy-failure.log", args.timeout)
    assert_marked(legacy / "_internal/pythonnet/runtime/Python.Runtime.dll")
    print("PASS: downloaded previous preview reproduces the CLR loader failure", flush=True)
    runtime_temp = workspace / "runtime-temp"
    runtime_temp.mkdir()
    for name, flags in (("discard", ["--smoke-test"]), ("save", ["--smoke-test", "--smoke-close-action", "save"])):
        log = workspace / f"single-file-{name}.log"
        run_case([str(executable), *flags], log, args.timeout,
                 extracted, require_report=True, extra_env={"TEMP": str(runtime_temp), "TMP": str(runtime_temp)})
        result = json.loads(log.with_suffix(".result.json").read_text(encoding="utf-8"))
        bundle = Path(result.get("bundleDirectory", ""))
        if not bundle.is_absolute() or not bundle.is_relative_to(runtime_temp) or bundle.exists():
            raise RuntimeError(f"Onefile runtime extraction was not isolated and cleaned: {result}")
        if list(runtime_temp.iterdir()):
            raise RuntimeError("Onefile execution left temporary runtime files behind")
        print(f"PASS: downloaded single-file EXE starts and completes {name} acceptance", flush=True)
    for path in extracted.rglob("*"):
        if path.is_file() and ":" not in path.name:
            assert_marked(path)
    (workspace / "distribution.result.json").write_text(json.dumps({
        "completed": True, "negativeControl": failure, "downloadMarkersPreserved": True,
        "archive": str(archive), "sha256": hashlib.sha256(archive.read_bytes()).hexdigest(),
        "extractedExecutable": str(executable), "singleFile": True,
        "executableSha256": hashlib.sha256(executable.read_bytes()).hexdigest(),
    }, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
