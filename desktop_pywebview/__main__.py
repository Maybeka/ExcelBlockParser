import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import sys
import threading
import tempfile

from .host import DesktopAPI


def main():
    parser = argparse.ArgumentParser(description="Excel Block Parser pywebview desktop host")
    parser.add_argument("--debug", action="store_true")
    parser.add_argument("--smoke-test", action="store_true", help="Verify native bridge and frontend, then exit")
    parser.add_argument("--smoke-close-action", choices=("discard", "save"), default="discard",
                        help="Unsaved-close action exercised by the native smoke test")
    parser.add_argument("--native-suite", action="store_true", help="Run real WebView project/workbook parity scenarios, then exit")
    parser.add_argument("--native-project-suite", action="store_true", help="Verify complete v3 documents and workbook source settings")
    parser.add_argument("--native-browser-suite", action="store_true", help="Verify populated worksheet selection and extraction focus")
    parser.add_argument("--native-drawing-suite", action="store_true", help="Verify workbook images and formula drawings in the native WebView")
    parser.add_argument("--native-outline-suite", action="store_true", help="Verify nested native outline controls and visibility")
    parser.add_argument("--native-python-suite", action="store_true", help="Verify Python workspace input, execution, previews and export")
    parser.add_argument("--native-window-suite", action="store_true", help="Verify real native maximize and restore geometry")
    parser.add_argument("--native-recovery-stage", choices=("seed", "seed-discard-close", "recover", "discard"),
                        help="Run a native recovery restart stage, then exit")
    parser.add_argument("--native-state-dir", help="Shared temporary state directory for native recovery stages")
    parser.add_argument("--native-recovery-suite", action="store_true", help="Run recovery checks across fresh native processes")
    parser.add_argument("--native-preferences-stage", choices=("english", "chinese", "verify-english"),
                        help="Run a language-persistence restart stage, then exit")
    parser.add_argument("--native-preferences-suite", action="store_true", help="Verify settings persistence across fresh native processes")
    args = parser.parse_args()
    if bool(args.native_recovery_stage or args.native_preferences_stage) != bool(args.native_state_dir):
        parser.error("Native restart stages require --native-state-dir (test use only)")
    if args.native_preferences_suite:
        from .preferences_suite import main as preferences_main
        preferences_main()
        return
    if args.native_recovery_suite:
        from .recovery_suite import main as recovery_main
        recovery_main()
        return
    assets = Path(__file__).resolve().parents[1] / "dist" / "index.html"
    if not assets.is_file():
        parser.error("Build the frontend first: npm run build:vite")
    import webview
    testing = args.smoke_test or args.native_suite or args.native_project_suite or args.native_browser_suite or args.native_drawing_suite or args.native_outline_suite or args.native_python_suite or args.native_window_suite or bool(args.native_recovery_stage or args.native_preferences_stage)
    smoke_directory = tempfile.TemporaryDirectory(prefix="pywebview-smoke-") if testing and not args.native_state_dir else None
    test_directory = Path(args.native_state_dir).resolve() if args.native_state_dir else Path(smoke_directory.name) if smoke_directory else None
    if args.native_preferences_stage:
        from .preferences_suite import NativePreferencesAPI
        api = NativePreferencesAPI(test_directory / "recovery")
    elif args.native_python_suite:
        from .python_suite import NativePythonAPI
        api = NativePythonAPI(test_directory / "recovery")
    elif args.native_outline_suite:
        from .outline_suite import NativeOutlineAPI
        api = NativeOutlineAPI(test_directory / "recovery")
    elif args.native_drawing_suite:
        from .drawing_suite import NativeDrawingAPI
        api = NativeDrawingAPI(test_directory / "recovery")
    elif args.native_suite or args.native_project_suite or args.native_browser_suite or args.native_outline_suite or args.native_window_suite or args.native_recovery_stage:
        from .native_suite import NativeSuiteAPI
        api = NativeSuiteAPI(test_directory / "recovery")
    else:
        api = DesktopAPI(Path(smoke_directory.name) / "recovery" if smoke_directory else None)
    webview.settings["DRAG_REGION_SELECTOR"] = ".app-header, .app-actions, .python-header-tabs"
    webview.settings["DRAG_REGION_DIRECT_TARGET_ONLY"] = True
    server = ThreadingHTTPServer(("127.0.0.1", 0), partial(SimpleHTTPRequestHandler, directory=str(assets.parent)))
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    window = webview.create_window(
        "Excel Block Parser", f"http://127.0.0.1:{server.server_port}/?desktop=pywebview", js_api=api,
        width=1400, height=900, min_size=(1000, 600), frameless=True,
        easy_drag=False, text_select=True, hidden=testing,
    )
    api._attach(window)
    window.events.closing += api._before_close
    window.events.loaded += api._loaded
    window.events.maximized += api._on_maximized
    window.events.restored += api._on_restored
    failures = []
    smoke_completed = threading.Event()

    def smoke_test():
        try:
            if args.native_window_suite:
                from .window_suite import run
                run(window, api, smoke_directory.name)
            elif args.native_preferences_stage:
                from .preferences_suite import run_stage
                run_stage(window, api, test_directory, args.native_preferences_stage)
            elif args.native_drawing_suite:
                from .drawing_suite import run
                run(window, api, smoke_directory.name)
            elif args.native_outline_suite:
                from .outline_suite import run
                run(window, api, smoke_directory.name)
            elif args.native_python_suite:
                from .python_suite import run
                run(window, api, smoke_directory.name)
            elif args.native_recovery_stage:
                from .recovery_suite import run_stage
                run_stage(window, api, test_directory, args.native_recovery_stage)
            elif args.native_browser_suite:
                from .browser_suite import run
                run(window, api, smoke_directory.name)
            elif args.native_project_suite:
                from .project_suite import run
                run(window, api, smoke_directory.name)
            elif args.native_suite:
                from .native_suite import run
                run(window, api, smoke_directory.name)
            else:
                from .smoke import run
                run(window, api, smoke_directory.name, close_action=args.smoke_close_action)
        except Exception as error:
            failures.append(str(error))
        finally:
            smoke_completed.set()
            api.ConfirmQuit()
            if not window.events.closed.is_set():
                api._finish_quit()

    try:
        # A closed WebView cannot answer outstanding JavaScript evaluations.
        # Keep test work daemonized so a failed close test cannot strand the app.
        launch_smoke = lambda: threading.Thread(target=smoke_test, daemon=True).start()
        webview.start(launch_smoke if testing else None, debug=args.debug,
                      gui="edgechromium" if sys.platform == "win32" else None)
    finally:
        if testing:
            smoke_completed.wait(5)
        api._shutdown()
        server.shutdown()
        server.server_close()
        thread.join()
        if smoke_directory:
            smoke_directory.cleanup()
    if failures:
        raise SystemExit(failures[0])
    if testing and not smoke_completed.is_set():
        raise SystemExit("The application closed before native smoke verification completed")


if __name__ == "__main__":
    from .test_report import run_with_report
    run_with_report(main)
