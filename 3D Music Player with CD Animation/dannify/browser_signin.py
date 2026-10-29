"""Sign Dannify in through a real browser, and carry the session back.

Brave, Chrome and Edge encrypt their cookie database against everything
outside the browser — the key never leaves the browser process — so no
helper library can read the session out of them (yt-dlp's own
``--cookies-from-browser`` fails on such a browser for exactly this
reason). The one honest way to have that session is to watch the browser
the user is actually signing in with, over the DevTools protocol, and take
the cookies once the login belongs to a real account.

So: open the browser on YouTube Music's sign-in page, wait while the user
signs in (an account the browser already knows needs no typing at all),
read the cookies through the connection the browser itself offers, and
hand them back. They are returned to the caller and forgotten here —
nothing in this file writes a cookie down.

This is the player's own file, beside ``player_bridge.py``; replace
Dannify's folder with a newer version and both are kept, as the README
says.
"""

from __future__ import annotations

import asyncio
import json
import os
import socket
import subprocess
import time
from pathlib import Path
from typing import Any, Iterable, Optional

import requests

# Google's sign-in, returning to the YouTube Music the session is for.
SIGNIN_URL = (
    'https://accounts.google.com/ServiceLogin?service=youtube'
    '&continue=https%3A%2F%2Fmusic.youtube.com%2F&hl=en'
)

# The login is done when these are in the jar: SAPISID is what every
# authenticated request is signed with, and the TS (timestamp) cookies only
# exist once Google has issued a real session, not while the form is open.
_SESSION_READY = ('__Secure-3PAPISID', '__Secure-3PSIDTS')

# Every launch argument a Chromium browser will not want to argue about.
_COMMON_ARGS = (
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-session-crashed-bubble',
    '--disable-infobars',
)


def _candidates() -> list[tuple[str, Path]]:
    """The browsers this machine might have, in the order to try them.

    Brave first: it is the one the player's owner asked for. The user data
    directory is per browser, not per install location, so a Brave from
    Program Files still keeps its profile in Local AppData.
    """

    local = Path(os.environ.get('LOCALAPPDATA', ''))
    pf86 = Path(os.environ.get('ProgramFiles(x86)', r'C:\Program Files (x86)'))
    pf = Path(os.environ.get('ProgramFiles', r'C:\Program Files'))
    found: list[tuple[str, Path]] = [
        ('Brave', local / 'BraveSoftware' / 'Brave-Browser' / 'Application' / 'brave.exe'),
        ('Brave', pf86 / 'BraveSoftware' / 'Brave-Browser' / 'application' / 'brave.exe'),
        ('Brave', pf / 'BraveSoftware' / 'Brave-Browser' / 'application' / 'brave.exe'),
        ('Chrome', local / 'Google' / 'Chrome' / 'Application' / 'chrome.exe'),
        ('Chrome', pf / 'Google' / 'Chrome' / 'Application' / 'chrome.exe'),
        ('Chrome', pf86 / 'Google' / 'Chrome' / 'Application' / 'chrome.exe'),
        ('Edge', pf86 / 'Microsoft' / 'Edge' / 'Application' / 'msedge.exe'),
        ('Edge', pf / 'Microsoft' / 'Edge' / 'Application' / 'msedge.exe'),
        ('Edge', local / 'Microsoft' / 'Edge' / 'Application' / 'msedge.exe'),
    ]
    return [(name, exe) for name, exe in found if exe.is_file()]


def _profiles() -> dict[str, Path]:
    local = Path(os.environ.get('LOCALAPPDATA', ''))
    return {
        'Brave': local / 'BraveSoftware' / 'Brave-Browser' / 'User Data',
        'Chrome': local / 'Google' / 'Chrome' / 'User Data',
        'Edge': local / 'Microsoft' / 'Edge' / 'User Data',
    }


def _own_profile_dir() -> Path:
    """A profile of ours, so a second browser can always be opened.

    When the user's own browser is already running, its profile is spoken
    for — a second process on it would just hand the switches back to the
    first one and exit — so the sign-in then happens in a window of its
    own, kept in the MUN15H folder beside the rest of the app's state. It
    remembers the account too: the next sign-in there needs no typing.
    """

    data = os.environ.get('DANNIFY_DATA_DIR', '').strip()
    if data:
        return Path(data).with_name('dannify-browser')
    appdata = Path(os.environ.get('APPDATA', '')) / 'MUN15H'
    return appdata / 'dannify-browser'


def _free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(('127.0.0.1', 0))
        return int(s.getsockname()[1])


def _kill_ours(user_data: Path) -> None:
    """Close a sign-in window left behind by an earlier attempt.

    Only ever called for the profile this folder owns, never the browser's
    own: a browser still holding that profile has no debugging connection
    to be found (this build does not write the port down anywhere), and
    without one the only way back to it is to start again.
    """

    if os.name != 'nt':
        return
    needle = str(user_data).replace("'", "''")
    # The browser's own processes only: the script's own command line
    # contains the profile path as well, and a match on it would have the
    # script stop itself before it stopped anything.
    match = (
        "Get-CimInstance Win32_Process | "
        f"Where-Object {{$_.Name -match 'brave|chrome|msedge' -and "
        f"$_.CommandLine -like '*{needle}*'}}"
    )
    try:
        found = subprocess.run(
            ['powershell.exe', '-NoProfile', '-Command',
             f'({match} | Measure-Object).Count'],
            capture_output=True, text=True, timeout=20,
        )
        if int((found.stdout or '0').strip() or 0) <= 0:
            return  # nothing of ours holding the profile
        subprocess.run(
            ['powershell.exe', '-NoProfile', '-Command',
             f'{match} | ForEach-Object {{ Stop-Process -Id $_.ProcessId '
             '-Force -ErrorAction SilentlyContinue }}'],
            capture_output=True, text=True, timeout=20,
        )
    except Exception:
        return
    # The profile is only free once those processes have actually let go of
    # it; starting a browser into one still being released lands in a
    # hand-off to a dying instance, which answers nothing.
    time.sleep(2.0)


def _answers(port: int) -> Optional[dict[str, Any]]:
    """``/json/version`` when a browser is listening there, else None.

    A DevToolsActivePort left behind by an earlier run answers nothing, so
    this — not the file — is what says whether a connection is real.
    """

    try:
        answer = requests.get(f'http://127.0.0.1:{port}/json/version', timeout=1.5)
        if answer.status_code == 200:
            return answer.json()
    except Exception:
        return None
    return None


def _launch(exe: Path, user_data: Path) -> tuple[Optional[subprocess.Popen], Optional[int], bool]:
    """Open the browser on the sign-in page.

    Returns (process, port, spawned); a None port means no connection came
    up — the profile was already spoken for by a browser that is not
    offering one, which is the caller's cue to try the other profile.
    """

    port = _free_port()
    cmd = [str(exe), f'--remote-debugging-port={port}', f'--user-data-dir={user_data}']
    cmd += list(_COMMON_ARGS) + [SIGNIN_URL]
    try:
        proc = subprocess.Popen(
            cmd,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except OSError:
        return None, None, False

    # A browser may answer in one of two shapes: it keeps the process we
    # started and opens the connection in it, or it hands everything to a
    # second process it starts itself and exits — both are fine, and both
    # answer within a second or two once the window is up. What does not
    # answer at all is a profile already spoken for by a browser that was
    # started without the connection (a browser's own window), and a fresh
    # profile creating itself for the first time; the first gets a short
    # grace, the second the whole window.
    started = time.monotonic()
    handed_over = None
    while time.monotonic() - started < 25.0:
        if _answers(port) is not None:
            return proc, port, True
        if proc.poll() is not None:
            if handed_over is None:
                handed_over = time.monotonic()
            elif time.monotonic() - handed_over > 6.0:
                break  # handed over and still nothing: not ours to talk to
        time.sleep(0.1)

    _stop(proc)
    return None, None, False


def _stop(proc: Optional[subprocess.Popen]) -> None:
    if proc is None or proc.poll() is not None:
        return
    proc.terminate()
    try:
        proc.wait(timeout=5)
    except Exception:
        proc.kill()


async def _watch(port: int, owns: bool, timeout: float, keep: Iterable[str]) -> dict[str, Any]:
    """Wait for the login, then read the cookies out over the connection.

    The browser decrypts them for us — it is the only thing that can — and
    nothing but the names the account module asked for is kept.
    """

    import websockets  # noqa: PLC0415

    version = await asyncio.to_thread(_answers, port)
    if not version or not version.get('webSocketDebuggerUrl'):
        return {'unavailable': True, 'reason': 'the browser did not offer a connection'}

    keep = set(keep)
    deadline = time.monotonic() + timeout
    note = 0
    try:
        async with websockets.connect(
            version['webSocketDebuggerUrl'], open_timeout=10, max_size=2**24
        ) as ws:
            while time.monotonic() < deadline:
                if owns and await asyncio.to_thread(_stale, port):
                    return {'cancelled': True}

                note += 1
                await ws.send(json.dumps({'id': note, 'method': 'Storage.getCookies'}))
                cookies: list[dict[str, Any]] = []
                while True:
                    try:
                        raw = await asyncio.wait_for(ws.recv(), timeout=15)
                    except asyncio.TimeoutError:
                        break  # the browser is busy; ask again
                    reply = json.loads(raw)
                    if reply.get('id') == note:
                        cookies = (reply.get('result') or {}).get('cookies') or []
                        break

                have = {c.get('name') for c in cookies}
                if _SESSION_READY[0] in have and _SESSION_READY[1] in have:
                    jar = {
                        c['name']: c['value']
                        for c in cookies
                        if c.get('name') in keep and c.get('value')
                        and ('youtube' in str(c.get('domain', '')) or 'google' in str(c.get('domain', '')))
                    }
                    if jar.get('__Secure-3PAPISID') or jar.get('SAPISID'):
                        return {'cookies': jar}
                    # SAPISID without its 3P twin is a half-written login.
                await asyncio.sleep(1.5)
    except Exception:
        # The window was closed on us, or the browser went away.
        return {'cancelled': True}

    return {'timeout': True}


def _stale(port: int) -> bool:
    """Has the browser we opened gone away?"""

    return _answers(port) is None


def sign_in(timeout: float = 300.0, keep: Iterable[str] = ()) -> dict[str, Any]:
    """Run the browser sign-in.

    Returns one of::

        {'cookies': {name: value, ...}}   the session, ready to be given
        {'cancelled': True}               the window was closed first
        {'timeout': True}                 nobody signed in in time
        {'unavailable': True, 'reason': …} no browser here to open
    """

    browser = _candidates()
    if not browser:
        return {'unavailable': True, 'reason': 'no browser is installed'}

    profiles = _profiles()
    keep = tuple(keep)
    if not keep:
        return {'unavailable': True, 'reason': 'no cookie list to keep'}

    # The user's own browser first — it usually knows the account already,
    # so signing in is one click or none at all — one browser after another,
    # because the one that is already open cannot be spoken to and the next
    # one may well be free. Only if no browser of theirs can be opened does
    # the sign-in get a window of its own (the profile this folder keeps),
    # which asks for the account once and remembers it after that.
    attempts: list[tuple[Path, Path, bool]] = []
    for name, exe in browser:
        profile = profiles.get(name)
        if profile is not None and not any(p == profile for _, p, _ in attempts):
            attempts.append((exe, profile, True))
    own = _own_profile_dir()
    if not any(p == own for _, p, _ in attempts):
        attempts.append((browser[0][1], own, False))

    reason = 'no browser could be opened'
    for exe, profile, prefer_real in attempts:
        name = exe.stem
        if not prefer_real:
            # A window of ours may still be about from an earlier attempt,
            # holding the profile with no way to reach it: start over.
            _kill_ours(profile)
        proc, port, spawned = _launch(exe, profile)
        if port is None:
            reason = f'{name} would not open a sign-in window'
            continue
        # Whatever was opened here was opened by us, and is closed again
        # when the session has been taken.
        try:
            outcome = asyncio.run(_watch(port, spawned, timeout, keep))
        finally:
            _close(port, proc)
        if 'cookies' in outcome or outcome.get('cancelled') or outcome.get('timeout'):
            # A timeout is a timeout: opening a second window after five
            # minutes of nobody signing in is not patience, it is nagging.
            return outcome
        reason = outcome.get('reason') or reason

    return {'unavailable': True, 'reason': reason}


def _close(port: int, proc: Optional[subprocess.Popen]) -> None:
    """Shut the sign-in window down, through the browser or under it."""

    async def _browser_close() -> None:
        import websockets  # noqa: PLC0415

        version = await asyncio.to_thread(_answers, port)
        if not version or not version.get('webSocketDebuggerUrl'):
            return
        try:
            async with websockets.connect(version['webSocketDebuggerUrl'], open_timeout=3) as ws:
                await ws.send(json.dumps({'id': 1, 'method': 'Browser.close'}))
                await asyncio.wait_for(ws.recv(), timeout=3)
        except Exception:
            pass

    try:
        asyncio.run(_browser_close())
    except Exception:
        pass
    _stop(proc)
