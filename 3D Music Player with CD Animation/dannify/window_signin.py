"""Sign in the way Dannify itself does: its own "Sign in with Google" window.

The standalone Dannify app does not send anyone to a browser. It opens a
WebView2 window of its own, on a profile of its own, and watches it: once
the page has come back to YouTube Music and the session cookies are there,
it takes the jar out of that window's cookie manager. That jar is the one
the rest of Dannify expects — likes, the home feed and downloads all work
against it.

So this runs *that* window: ``dannify.shell.windows.login._LoginWindow``,
the same code the desktop app uses, unchanged, in this process. A browser
reached over the DevTools protocol is the other way to get a session (see
``browser_signin.py``), but it asks the person to sign in somewhere they
were not looking, and a machine whose browser is already open cannot always
be attached to. The window below always can.

The only thing missing in this process is the .NET side ``_LoginWindow``
was written to run inside: pywebview sets that up when it is imported for
the app's own window, and there is no such window here. ``_clr`` repeats the
same few steps.
"""

from __future__ import annotations

import os
import threading
from typing import Any

from loguru import logger

# One window at a time: WebView2 will not open the same profile twice, and a
# second click while the first window is up is a person who missed it, not a
# request for another one.
_lock = threading.Lock()


def _clr() -> None:
    """Bring up the .NET runtime and WebView2's assemblies.

    pythonnet resolves ``System`` only after the CLR is loaded, and the
    WebView2 types only after their two assemblies are referenced; pywebview
    does both at import time (see its ``edgechromium`` platform), so this is
    the same dance for a process that never imports it.
    """

    try:
        import clr  # noqa: F401, PLC0415
    except Exception:
        os.environ['PYTHONNET_RUNTIME'] = 'coreclr'
        import clr  # noqa: F401, PLC0415

    from webview.util import interop_dll_path  # noqa: PLC0415

    clr.AddReference('System.Windows.Forms')
    clr.AddReference('System.Collections')
    clr.AddReference('System.Threading')
    clr.AddReference(interop_dll_path('Microsoft.Web.WebView2.Core.dll'))
    clr.AddReference(interop_dll_path('Microsoft.Web.WebView2.WinForms.dll'))
    # The loader is native code: it has to be findable by name, not by
    # assembly reference.
    for platform in ('win-arm64', 'win-x64', 'win-x86'):
        os.environ['PATH'] = (
            os.environ.get('PATH', '') + os.pathsep + interop_dll_path(platform)
        )


def prewarm() -> None:
    """Load the whole .NET side before anybody presses Sign in.

    The first sign-in in a fresh process pays for pythonnet, the CLR, the
    WinForms and WebView2 assemblies and ``dannify.shell.windows.login`` —
    a minute of it on this machine — and all of it lands between the click
    and the window (issue 2.7). None of it needs a window, so it is done
    here instead, on a background thread at start-up; ``sign_in`` then only
    has the window itself left to build.

    Every import below is one ``_LoginWindow._pump`` makes on its own
    thread, in the same order, so that first run is not where these
    assemblies load for the first time. Nothing is created: no window, no
    WebView2 — only the types are loaded.
    """

    if os.name != 'nt':
        return
    try:
        _clr()
        from dannify.shell.windows.login import _LoginWindow  # noqa: F401, PLC0415
        from System.Drawing import ColorTranslator  # noqa: F401, PLC0415
        from System.Threading.Tasks import TaskScheduler  # noqa: F401, PLC0415

        import System.Windows.Forms  # noqa: F401, PLC0415
        from Microsoft.Web.WebView2.WinForms import (  # noqa: F401, PLC0415
            CoreWebView2CreationProperties,
            WebView2,
        )
    except Exception as exc:
        # A failed warm-up only means the click pays the old price again;
        # the sign-in itself decides whether a window can be opened.
        logger.debug('Sign-in prewarm failed: {}', exc)


def sign_in(timeout: float = 300.0) -> dict[str, Any]:
    """Show the sign-in window and return the session it collected.

    Returns one of::

        {'cookies': {name: value, ...}}   the whole jar, ready to be given
        {'cancelled': True, 'reason': …}  the window was closed first
        {'signed_in': False, 'error': …}  a window is already open
        {'unavailable': True, 'reason': …} no window can be opened here

    The jar is the window's entire cookie store, not a chosen few names:
    ``account.sign_in`` keeps the ones a Google session needs and nothing
    else, so the filtering belongs there and not in the window.
    """

    if os.name != 'nt':
        return {'unavailable': True, 'reason': 'the sign-in window is Windows only'}
    if not _lock.acquire(blocking=False):
        return {'signed_in': False, 'error': 'A sign-in window is already open.'}

    try:
        try:
            _clr()
            from dannify.shell.windows.login import _LoginWindow  # noqa: PLC0415
        except Exception as exc:
            logger.opt(exception=True).info('Sign-in window unavailable')
            return {
                'unavailable': True,
                'reason': f'the sign-in window could not start: {exc}',
            }

        window = _LoginWindow('dark')
        window.TIMEOUT = timeout
        try:
            cookies = window.run()
        except Exception as exc:
            logger.opt(exception=True).info('Sign-in window failed')
            return {'unavailable': True, 'reason': str(exc)}
        if not cookies:
            # Closed before a session appeared, or WebView2 never came up.
            return {'cancelled': True, 'reason': window.error}
        logger.info('Sign-in window collected {} cookies', len(cookies))
        return {'cookies': cookies}
    finally:
        _lock.release()
