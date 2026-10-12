"""Real WebView bridge smoke checks; all state stays in a temporary directory."""

import json
from pathlib import Path
import threading
import time
import sys


def evaluate_async(window, expression):
    completed = threading.Event()
    result = []

    def callback(value):
        result.append(value)
        completed.set()

    window.evaluate_js(f"(async () => {{ try {{ return {{ value: await ({expression}) }} }} catch (error) {{ return {{ error: String(error) }} }} }})()", callback)
    if not completed.wait(30):
        raise RuntimeError("Native JavaScript bridge timed out")
    if result[0].get("error"):
        raise RuntimeError(result[0]["error"])
    return result[0].get("value")


def wait_for(window, expression, timeout=30):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if window.evaluate_js(expression):
            return
        time.sleep(0.2)
    raise RuntimeError(f"Native frontend did not reach expected state: {expression}")


def run(window, api, directory, close_action="discard"):
    wait_for(window, "document.querySelector('.app-header') !== null && Boolean(window.pywebview?.runtimeInfo)")
    root = Path(__file__).resolve().parents[1]
    fixture = json.loads((root / "examples/project.json").read_text())
    workbook = root / "examples/test_data.xlsx"
    fixture["project"]["workbooks"][0]["sourcePath"] = str(workbook)
    project_path = Path(directory) / "smoke-project.json"
    project_path.write_text(json.dumps(fixture), encoding="utf-8")
    opened = evaluate_async(window, f"window.pywebview.api.OpenDroppedJson({json.dumps(str(project_path))})")
    if Path(opened["filePath"]).resolve() != project_path.resolve():
        raise RuntimeError("Native project open returned a different path")
    # Exercise the same native drop event that opens a project in the renderer.
    api._drop({"dataTransfer": {"files": [{"pywebviewFullPath": str(project_path)}]}})
    wait_for(window, "Array.from(document.querySelectorAll('.workbook-tab')).some(node => node.textContent.includes('test_data.xlsx'))")
    wait_for(window, "document.querySelectorAll('canvas').length > 0")
    package = {"entryPath": "main.py", "files": [
        {"path": "main.py", "source": "from support import value\ndef process(context):\n print('native bridge')\n return {'value': value(context['data']['value'])}"},
        {"path": "support.py", "source": "def value(number): return number * 2"},
    ]}
    result = evaluate_async(window, f"window.pywebview.api.RunProjectPython({json.dumps(package)}, {json.dumps('{"data":{"value":7}}')})")
    if not result["ok"] or json.loads(result["resultJson"])["value"] != 14:
        raise RuntimeError(f"Native Python execution failed: {result}")
    if "native bridge" not in result["stdout"]:
        raise RuntimeError("Python stdout did not cross the native bridge")
    saved = evaluate_async(window, f"window.pywebview.api.SaveJsonToPath({json.dumps(str(project_path))}, {json.dumps(json.dumps(fixture))})")
    if not saved["success"]:
        raise RuntimeError("Native project save failed")
    api.SaveRecovery(json.dumps(fixture))
    if json.loads(evaluate_async(window, "window.pywebview.api.LoadRecovery()")) != fixture:
        raise RuntimeError("Native recovery round trip changed the project")
    api.ClearRecovery()
    wait_for(window, "document.querySelector('.card-title-input') !== null")
    window.evaluate_js("""(() => {
      const input = document.querySelector('.card-title-input');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'smoke_changed');
      input.dispatchEvent(new Event('input', {bubbles: true}));
    })()""")
    wait_for(window, "Array.from(document.querySelectorAll('.ant-select-selection-item')).some(node => node.textContent.includes('smoke_changed'))")
    # Exercise the native OS close callback, not just the titlebar API method.
    if sys.platform == "darwin":
        from PyObjCTools import AppHelper
        from webview.platforms.cocoa import BrowserView
        AppHelper.callAfter(BrowserView.instances[window.uid].window.performClose_, None)
    else:
        window.destroy()
    wait_for(window, "Array.from(document.querySelectorAll('.ant-modal-title')).some(node => /Close application|关闭应用/.test(node.textContent))")
    buttons = window.evaluate_js("Array.from(document.querySelectorAll('.ant-modal-footer button')).map(node => node.textContent)")
    if len(buttons) != 3:
        raise RuntimeError(f"Unsaved close did not offer three choices: {buttons}")
    window.evaluate_js("""(() => {
      const title = Array.from(document.querySelectorAll('.ant-modal-title')).find(node => /Close application|关闭应用/.test(node.textContent));
      title.closest('.ant-modal').querySelector('.ant-modal-footer button').click();
    })()""")
    # Hidden WebViews pause animation frames. The leave state proves Cancel
    # cleared the pending action without requiring that animation to finish.
    wait_for(window, "Array.from(document.querySelectorAll('.ant-modal-title')).every(node => !/Close application|关闭应用/.test(node.textContent) || node.closest('.ant-modal').classList.contains('ant-zoom-leave') || getComputedStyle(node.closest('.ant-modal-wrap')).display === 'none')")
    if not window.evaluate_js("document.querySelector('.card-title-input').value === 'smoke_changed'"):
        raise RuntimeError("Cancel discarded the unsaved project")
    # Re-enter through the real custom titlebar and its JavaScript bridge RPC.
    wait_for(window, "Boolean(document.querySelector('.window-control-close'))")
    window.evaluate_js("document.querySelector('.window-control-close').click()")
    wait_for(window, "document.querySelector('.ant-modal') && !document.querySelector('.ant-modal.ant-zoom-leave')")
    # Clicking can destroy the view before its inspection RPC returns. The
    # verifier must observe the closed event independently of that reply.
    button_index = 3 if close_action == "save" else 2
    def click_exit():
        try:
            window.run_js(f"document.querySelector('.ant-modal-footer button:nth-child({button_index})').click()")
        except Exception:
            # A destroyed view may reject an outstanding evaluation; failure
            # to close is checked below through the actual native event.
            pass
    threading.Thread(target=click_exit, daemon=True).start()
    if not window.events.closed.wait(30):
        raise RuntimeError(f"{close_action} did not close the native application")
    persisted = json.loads(project_path.read_text(encoding="utf-8"))
    label = persisted["project"]["blocks"][0]["label"]
    expected = "smoke_changed" if close_action == "save" else fixture["project"]["blocks"][0]["label"]
    if label != expected:
        raise RuntimeError(f"{close_action} persisted an unexpected block label: {label!r}")
    print(f"pywebview native frontend, JSON drop, workbook load, multi-file Python, save/recovery, native-close Cancel and custom-titlebar exit ({close_action}) passed")
