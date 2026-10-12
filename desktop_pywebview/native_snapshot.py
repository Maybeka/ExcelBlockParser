"""Opt-in native WKWebView snapshots; no browser DOM reconstruction."""

import os
from pathlib import Path
import sys
import threading
import time


def capture_if_enabled(window, name, timeout=30, ready=None, validate=None):
    directory = os.environ.get("PYWEBVIEW_NATIVE_SNAPSHOTS")
    if not directory:
        return None
    if sys.platform != "darwin":
        raise RuntimeError("Native snapshots currently require the macOS WKWebView backend")
    from AppKit import NSBitmapImageRep, NSPNGFileType
    from PyObjCTools import AppHelper
    from WebKit import WKSnapshotConfiguration
    from webview.platforms.cocoa import BrowserView

    destination = Path(directory).resolve() / f"{name}.png"
    destination.parent.mkdir(parents=True, exist_ok=True)
    completed = threading.Event()
    prepared = threading.Event()
    failures = []
    originally_visible = []

    def finished(image, error):
        try:
            if error or image is None:
                raise RuntimeError(f"Native snapshot failed: {error}")
            bitmap = NSBitmapImageRep.imageRepWithData_(image.TIFFRepresentation())
            data = bitmap.representationUsingType_properties_(NSPNGFileType, {})
            if not data.writeToFile_atomically_(str(destination), True):
                raise RuntimeError("Unable to write native snapshot")
        except Exception as failure:
            failures.append(failure)
        finally:
            completed.set()

    def take():
        try:
            view = BrowserView.instances[window.uid].webview
            configuration = WKSnapshotConfiguration.alloc().init()
            configuration.setRect_(view.bounds())
            configuration.setAfterScreenUpdates_(True)
            view.takeSnapshotWithConfiguration_completionHandler_(configuration, finished)
        except Exception as failure:
            failures.append(failure)
            completed.set()

    def prepare():
        try:
            originally_visible.append(bool(window.native.isVisible()))
            if not originally_visible[0]:
                # Ordering behind other windows enables native painting without
                # activating the test application or stealing the user's focus.
                window.native.orderBack_(None)
        except Exception as failure:
            failures.append(failure)
        finally:
            prepared.set()

    AppHelper.callAfter(prepare)
    try:
        if not prepared.wait(timeout):
            raise RuntimeError("Native snapshot window preparation timed out")
        if failures:
            raise failures[0]
        if ready:
            ready()
        deadline = time.monotonic() + timeout
        while True:
            completed.clear()
            AppHelper.callAfter(take)
            if not completed.wait(max(0, deadline - time.monotonic())):
                raise RuntimeError("Native snapshot timed out")
            if failures:
                raise failures[0]
            if validate is None or validate(destination):
                break
            if time.monotonic() >= deadline:
                raise RuntimeError(f"Native snapshot did not contain the expected pixels: {destination}")
            time.sleep(0.05)
    finally:
        if originally_visible and not originally_visible[0]:
            AppHelper.callAfter(window.native.orderOut_, None)
    print(f"Native WKWebView snapshot: {destination}", flush=True)
    return destination
