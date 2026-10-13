"""Keep automated Cocoa sessions non-activating without changing normal startup."""

from contextlib import contextmanager
from importlib import import_module
import os
import sys


class _NonActivatingApplication:
    def __init__(self, application):
        self._application = application

    def __getattr__(self, name):
        return getattr(self._application, name)

    def activateIgnoringOtherApps_(self, _):
        pass

    def activateWithOptions_(self, _):
        pass


@contextmanager
def native_test_background(testing):
    if not testing or sys.platform != 'darwin':
        yield
        return

    cocoa = import_module('webview.platforms.cocoa')
    appkit = cocoa.AppKit
    application = cocoa.BrowserView.app
    original_policy = application.activationPolicy()
    workspace = appkit.NSWorkspace.sharedWorkspace()
    center = workspace.notificationCenter()
    activations = []

    def activated(notification):
        active = notification.userInfo().get(appkit.NSWorkspaceApplicationKey)
        if active is not None and active.processIdentifier() == os.getpid():
            activations.append(True)

    observer = center.addObserverForName_object_queue_usingBlock_(
        appkit.NSWorkspaceDidActivateApplicationNotification, None, None, activated,
    )
    try:
        if not application.setActivationPolicy_(appkit.NSApplicationActivationPolicyProhibited):
            raise RuntimeError('Cannot enable non-activating Cocoa test mode')
        # Cocoa first_show activates even hidden windows. Delegate all other
        # methods so the real native event loop and window controls still run.
        cocoa.BrowserView.app = _NonActivatingApplication(application)
        yield
    finally:
        cocoa.BrowserView.app = application
        center.removeObserver_(observer)
        application.setActivationPolicy_(original_policy)
    active = workspace.frontmostApplication()
    if activations or (active is not None and active.processIdentifier() == os.getpid()):
        raise RuntimeError('Background native test unexpectedly became the foreground application')
    print('PASS pywebview background: no native application activation', flush=True)
