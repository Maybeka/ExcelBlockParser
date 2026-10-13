"""Real native bounds checks through the renderer's titlebar controls."""

import time

from .native_suite import NativeUI


def bounds(window):
    return tuple(round(value) for value in (window.x, window.y, window.width, window.height))


def wait_bounds(window, predicate, timeout=10):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        current = bounds(window)
        if predicate(current):
            return current
        time.sleep(0.05)
    raise RuntimeError(f'Native window bounds did not reach the expected state: {bounds(window)}')


def run(window, api, directory):
    ui = NativeUI(window)
    ui.wait("Boolean(window.pywebview?.runtimeInfo) && Boolean(document.querySelector('.window-controls'))")
    # Fit the CI desktop as well as local monitors; the app minimum is 1000x600.
    window.resize(1000, 600)
    wait_bounds(window, lambda value: value[2:] == (1000, 600))
    window.move(10, 10)
    normal = wait_bounds(window, lambda value: value == (10, 10, 1000, 600))
    print(f'Native normal window bounds: {normal}', flush=True)

    ui.read("document.querySelector('.window-controls button:nth-child(2)').click()")
    enlarged = wait_bounds(window, lambda value: value[2:] != normal[2:])
    ui.read("document.querySelector('.window-controls button:nth-child(2)').click()")
    wait_bounds(window, lambda value: value == normal)
    print(f'PASS pywebview window: actual titlebar maximize {enlarged} and exact normal-frame restore {normal}', flush=True)

    ui.read("document.querySelector('.app-header').dispatchEvent(new MouseEvent('dblclick', {bubbles: true}))")
    wait_bounds(window, lambda value: value[2:] != normal[2:])
    ui.read("document.querySelector('.app-header').dispatchEvent(new MouseEvent('dblclick', {bubbles: true}))")
    wait_bounds(window, lambda value: value == normal)
    print('PASS pywebview window: blank-header double-click toggles real native bounds', flush=True)

    ui.read("document.querySelector('.window-controls').dispatchEvent(new MouseEvent('dblclick', {bubbles: true}))")
    time.sleep(0.2)
    if bounds(window) != normal:
        raise RuntimeError('Double-clicking a titlebar control triggered header maximization')
    print('PASS pywebview window: control-area double-click does not maximize the window', flush=True)
    print('pywebview native window suite: 3 scenarios passed', flush=True)
