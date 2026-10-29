"""Runs Dannify, plus the one route the player needs to sign it in.

Dannify's sign-in belongs to its desktop shell: the interface asks for a
pywebview bridge, and in a plain browser that bridge is not there, so it
says "Signing in needs the desktop app." The player *is* a desktop app —
this extension runs on a real WebView2, the same one Dannify's own window
uses — so all that is missing is a way to open that window here and hand
the session it collects to Dannify's own ``account.sign_in``.

That is this file, and it is the only thing here that is not Dannify's:
it adds a handful of routes to the app Dannify builds for itself, and
otherwise runs the very same app. Replace Dannify's folder with a newer
version and this still starts it, because it only imports what Dannify
already exposes.

Two things are deliberately *not* inside Dannify's own files, because a
newer release would drop them:

  * the in-page bridge (``mun15h_bridge.js``) is served from here and
    injected into every page on its way out (``_BridgeInject``), instead of
    being edited into ``frontend/dist/index.html``;
  * every name this file reaches for in Dannify's code is probed once at
    boot (``_check_contract``) and the answer is published at
    ``GET /api/player/version``, so a release that moved something says so
    instead of quietly doing nothing.

One thing of Dannify's is switched off: its own updater. This copy is part
of the player and updates when the player's folder is replaced, and it runs
from source, so it is never an "installed" copy its updater could swap in
place. The check still asked GitHub on every launch, always found this copy
older than the newest release, silently downloaded the whole upstream
installer again, and put the "restart to update" badge back next to the
account logo — a loop that could only ever end with the standalone app
installed over the player's extension. See ``_disable_self_update``.

    POST /api/player/session   {"cookies": {name: value}}  -> account status
    GET  /api/player/session                              -> account status
    POST /api/player/from-browser                         -> account status
    GET  /api/player/downloads -> the songs the extension has downloaded
    GET  /api/player/likes     -> the songs the account has liked
    GET  /api/player/art?url=  -> a liked song's artwork, from its source
    GET  /api/player/version   -> the contract report (what this copy needs
                                  from this copy of Dannify, and whether it
                                  is all there)
    GET  /__mun15h/bridge.js   -> the player's own in-page bridge script

The sign-in route opens Dannify's own window — the same "Sign in with
Google" window the standalone app uses, run from this process (see
``window_signin.py``) — because that is the one whose session the rest of
Dannify is known to work with. Where no such window can be opened, a real
browser is asked instead, over the connection it offers (see
``browser_signin.py``).
"""

from __future__ import annotations

import argparse
import asyncio
import importlib.util
import json
import os
import sys
import tempfile
import threading
from pathlib import Path
from typing import Any

from loguru import logger

HERE = Path(__file__).resolve().parent
BACKEND = HERE / 'Backend'

# Where the player's window runs from: the dev server while the app is being
# built, and the app's own origin once it is packaged. Only these are told
# what a cross-origin read may see — with a wildcard here, any page open in
# any browser could read the whole library through the loopback port.
PLAYER_ORIGINS = (
    'http://127.0.0.1:3000',
    'http://localhost:3000',
    'http://tauri.localhost',
    'https://tauri.localhost',
    'tauri://localhost',
)

# The audio files Dannify keeps, sealed or not (see ``vault``).
_AUDIO_SUFFIXES = ('.mp3', '.m4a', '.flac', '.ogg', '.wav', '.aac', '.opus', '.dnf')

# How long a sign-in may take. A password and a second factor are the
# user's own pace; five minutes is generous without letting a forgotten
# window hold the route open all evening.
BROWSER_SIGNIN_TIMEOUT = 300.0

# The player's own half of the bridge into this extension's page, and the
# file it lives in (beside this one, not inside Dannify's interface). It is
# injected into every page served from here, so replacing Dannify's folder
# with a newer one carries no patch to re-apply.
BRIDGE_PATH = '/__mun15h/bridge.js'
BRIDGE_SCRIPT = HERE / 'mun15h_bridge.js'
BRIDGE_MARK = 'mun15h-dannify-bridge'

# The shape of the tag the injection puts in the page. Recorded rather than
# rebuilt so the check "is this page already carrying the bridge?" compares
# against exactly what it wrote.
BRIDGE_TAG = f'<script defer src="{BRIDGE_PATH}"></script>'.encode()

# The revision of this integration's own surface: the routes above, and the
# answers /api/player/version gives. The player reads it, so a player that
# is newer than its extension (or the other way round) can be seen rather
# than guessed at.
CONTRACT_VERSION = 1

_contract: dict[str, Any] = {
    'ok': False,
    'contract': CONTRACT_VERSION,
    'dannify': '',
    'checked': 0,
    'missing': [],
}

sys.path.insert(0, str(BACKEND))


def _load_dannify() -> Any:
    """Dannify's own ``Backend/main.py``, as a module.

    Imported by path rather than by name: ``main`` is not a package module,
    and a name collision with anything else on the path would be a very
    confusing way to fail.
    """

    spec = importlib.util.spec_from_file_location('dannify_main', BACKEND / 'main.py')
    if spec is None or spec.loader is None:
        raise SystemExit(f'Dannify is not where it should be: {BACKEND}')
    module = importlib.util.module_from_spec(spec)
    sys.modules['dannify_main'] = module
    spec.loader.exec_module(module)
    return module


def _session() -> dict[str, Any]:
    from dannify import account  # noqa: PLC0415

    return account.status()


def _sign_in(cookies: dict[str, str]) -> dict[str, Any]:
    """The same call Dannify's desktop shell makes, with the same checks.

    One check on top of its own: a session YouTube will not name an account
    for is not a session. Such a jar used to be stored as "signed in", and
    the interface then said so while likes, recommendations and downloads
    all came back refused — which is worse than saying nothing. It is
    signed back out instead, with the reason.
    """

    from dannify import account, explorer  # noqa: PLC0415

    try:
        result = account.sign_in(cookies or {})
    except Exception as exc:  # NotSignedIn, or the validation call failing
        return {'signed_in': False, 'profile': {}, 'error': str(exc)}
    if not (result.get('profile') or {}).get('name'):
        account.sign_out()
        return {
            'signed_in': False,
            'profile': {},
            'error': 'YouTube would not say who this session belongs to. '
                     'Sign in again and wait until the page has loaded.',
        }
    explorer.clear_cache()
    return result


def _from_browser(timeout: float) -> dict[str, Any]:
    """Sign in through Dannify's own window, and hand it the session.

    The window is the way the standalone app signs in (see
    ``window_signin.py``): it is the same ``_LoginWindow``, so the session
    it leaves is the one the rest of Dannify already knows how to use. Only
    when no window can be opened here — a machine without WebView2, or a
    non-Windows build — does the browser take over; that still works, it
    just asks the person to sign in somewhere else.
    """

    from dannify import account  # noqa: PLC0415

    import window_signin  # noqa: PLC0415  (beside this file)

    got = window_signin.sign_in(timeout=timeout)
    if 'cookies' not in got and got.get('unavailable'):
        import browser_signin  # noqa: PLC0415  (beside this file)

        got = browser_signin.sign_in(
            timeout=timeout, keep=tuple(account._COOKIE_NAMES)
        )
    if 'cookies' not in got:
        return got  # cancelled, timed out, or no window/browser to open
    return _sign_in(got['cookies'])


def _downloads() -> dict[str, Any]:
    """What the extension has downloaded, in the player's terms.

    Files are listed the way ``/downloads`` serves them, not the way they sit
    on disk: a sealed one is opened on the way out, so the address handed to
    the player is playable audio whatever Dannify stored.
    """

    from urllib.parse import quote  # noqa: PLC0415

    from dannify import api, vault  # noqa: PLC0415

    base = Path(getattr(api.state, 'download_dir', '') or '')
    if not base.is_dir():
        return {'tracks': []}

    # Dannify keeps what each sealed file was beside its library, and that is
    # better than anything in the filename: the artist, the album, the id on
    # YouTube Music all come from it.
    index: dict[str, Any] = {}
    try:
        found = vault.read_index(base / '.dannify' / 'index.json')
        if isinstance(found, dict):
            index = found
    except Exception:
        logger.opt(exception=True).debug('Could not read the downloads index')

    tracks: list[dict[str, Any]] = []
    for path in sorted(base.rglob('*')):
        if not path.is_file() or path.suffix.lower() not in _AUDIO_SUFFIXES:
            continue
        rel = path.relative_to(base).as_posix()
        meta = index.get(rel) or index.get(rel.replace('/', '\\')) or {}
        title = str(meta.get('title') or '')
        artist = str(meta.get('artist') or '')
        if not title:
            stem = path.stem
            artist, title = (stem.split(' - ', 1) if ' - ' in stem else (artist, stem))
        tracks.append(
            {
                'file': rel,
                'title': title.strip(),
                'artist': artist.strip(),
                'album': str(meta.get('album') or '').strip(),
                'video_id': str(meta.get('video_id') or '').strip(),
                'url': f'/downloads/{quote(rel)}',
                'cover': f'/cover?file={quote(rel)}',
            }
        )
    return {'tracks': tracks}


def _likes() -> dict[str, Any]:
    """The songs the account liked, in the player's terms.

    These are not files Dannify keeps — there is nothing on disk to list.
    What comes back is the metadata plus the two addresses the player needs:
    where the audio comes from (the extension's own stream route) and where
    the artwork comes from (proxied, because the player's window cannot read
    YouTube's picture hosts cross-origin).
    """

    from urllib.parse import quote  # noqa: PLC0415

    from dannify import account  # noqa: PLC0415

    if not account.is_signed_in():
        return {'tracks': []}
    try:
        songs = account.liked_songs(limit=500) or []
    except Exception:
        logger.opt(exception=True).debug('Could not read the liked songs')
        return {'tracks': []}

    tracks: list[dict[str, Any]] = []
    for song in songs:
        vid = str(song.get('video_id') or '')
        if not vid:
            continue
        cover = str(song.get('cover_url') or '')
        artists = [str(a) for a in (song.get('artists') or []) if a]
        tracks.append(
            {
                'file': f'likes/{vid}',
                'title': str(song.get('name') or ''),
                'artist': ', '.join(artists),
                'album': str(song.get('album_name') or ''),
                'video_id': vid,
                'url': f'/api/stream?video_id={vid}',
                'cover': f'/api/player/art?url={quote(cover, safe="")}' if cover else '',
            }
        )
    return {'tracks': tracks}


# Where a liked song's artwork lives. Only these hosts are fetched for the
# player, so the artwork route cannot be asked to read just anything.
_PICTURE_HOSTS = ('ytimg.com', 'googleusercontent.com', 'ggpht.com', 'youtube.com')


def _art(url: str) -> Any:
    """The picture at a remote address, on its way to the player.

    A liked song keeps its artwork where YouTube put it; this asks for it
    once and hands the bytes over, so the extension is the only thing that
    talks to that host.
    """

    from urllib.parse import urlparse  # noqa: PLC0415
    import urllib.request  # noqa: PLC0415

    from starlette.responses import Response  # noqa: PLC0415

    parsed = urlparse(url)
    host = (parsed.hostname or '').lower()
    if parsed.scheme not in ('http', 'https') or not any(
        host == h or host.endswith('.' + h) for h in _PICTURE_HOSTS
    ):
        return Response(status_code=404)
    try:
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = resp.read(2_000_000)  # a picture, never a download
            ctype = resp.headers.get_content_type()
    except Exception:
        logger.opt(exception=True).debug('Could not fetch artwork')
        return Response(status_code=404)
    if not ctype.startswith('image/'):
        ctype = 'image/jpeg'
    return Response(content=data, media_type=ctype, headers={'cache-control': 'max-age=86400'})


class PlayerCors:
    """Tell the player's window that it may read these few addresses.

    The extension is a web app on loopback and the player talks to it from a
    different origin, so ``fetch`` refuses the answers without a word from
    the server. A plain ASGI wrapper, not a middleware: the library's audio
    is served by a mounted app that writes its own response, and a wrapper
    that adds the header to every start message is the only place that sees
    those too.

    It is also the one place that sees every scope before the app's own
    routing does — which is where the player's WebSocket below has to be
    answered, for the same reason the static catch-all would swallow it.
    """

    PATHS = ('/api/player/', '/downloads/', '/cover', '/api/stream')
    WS_PATH = '/api/player/downloads-ws'

    def __init__(self, app: Any) -> None:
        self.app = app

    async def __call__(self, scope, receive, send):  # noqa: ANN001
        if scope.get('type') == 'websocket' and scope.get('path') == self.WS_PATH:
            return await _downloads_ws(scope, receive, send)
        if scope.get('type') != 'http':
            return await self.app(scope, receive, send)
        path = scope.get('path', '')
        origin = ''
        for key, value in scope.get('headers', ()):
            if key == b'origin':
                origin = value.decode('latin-1')
                break
        if origin not in PLAYER_ORIGINS or not path.startswith(self.PATHS):
            return await self.app(scope, receive, send)

        async def with_cors(message):  # noqa: ANN001
            if message['type'] == 'http.response.start':
                headers = list(message.get('headers') or [])
                headers.append((b'access-control-allow-origin', origin.encode('latin-1')))
                headers.append((b'vary', b'origin'))
                message['headers'] = headers
            await send(message)

        return await self.app(scope, receive, with_cors)


async def _downloads_ws(scope, receive, send) -> None:  # noqa: ANN001
    """A finished download, told to the player as it happens.

    The extension's own interface hears about downloads over its WebSocket;
    this is the same news on a socket of the player's own, so a download
    reaches the player's library the moment its file exists instead of at
    the next poll of the list.

    The fan-out is one ``broadcast`` call to every listener, so this reader
    is hooked in from the outside: a queue sits between the method and its
    original, and nothing in Dannify's code knows about it. Only the "done"
    messages cross — the player has no use for the progress of a bar it is
    not drawing — and the hook comes off the moment the player's side of the
    socket goes away.
    """

    from starlette.websockets import WebSocket  # noqa: PLC0415

    from dannify.routes.common import state as routes_state  # noqa: PLC0415

    websocket = WebSocket(scope, receive, send)
    await websocket.accept()
    queue: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
    original = routes_state.connections.broadcast

    async def hooked(message: dict[str, Any]) -> None:
        await original(message)
        queue.put_nowait(message)

    routes_state.connections.broadcast = hooked
    sending: asyncio.Task[None] | None = None
    try:

        async def pump() -> None:
            while True:
                message = await queue.get()
                if message.get('status') == 'done':
                    await websocket.send_text(json.dumps(message))

        sending = asyncio.create_task(pump())
        # Waiting on the player's own side of the socket: the moment it goes
        # away this returns, the hook below comes off, and nothing keeps
        # being collected for a reader that is not there.
        while True:
            message = await websocket.receive()
            if message.get('type') == 'websocket.disconnect':
                break
    except Exception:
        pass  # the player closed the socket, or the socket closed first
    finally:
        if sending is not None:
            sending.cancel()
        if routes_state.connections.broadcast is hooked:
            routes_state.connections.broadcast = original


def _disable_self_update() -> None:
    """Make Dannify's updater always answer "up to date".

    ``dannify.updates.check`` is the one function the interface asks before
    it shows the update button and before the background loop downloads
    anything (see the frontend's update store). It compares this copy's
    version with the newest GitHub release of Dannify — but this copy lives
    inside the player, is started from source by ``run.cmd``, and is never a
    managed install its updater could replace file by file. The answer was
    therefore always "newer available": every launch re-downloaded the full
    upstream installer into the data folder and re-showed the "restart to
    update" badge, and refreshing only cleared it until the next check.
    The player ships this extension and updates it by shipping a newer one,
    so upstream's self-updater has nothing to do here and is switched off.
    """

    from dannify import updates  # noqa: PLC0415

    def _up_to_date(current_version: str, force: bool = False) -> dict[str, Any]:
        return {
            'available': False,
            'current': current_version,
            'version': '',
            'notes': '',
            'url': '',
            'download_url': '',
            'size': 0,
            'published_at': '',
            'error': '',
            'site_url': updates.SITE_URL,
            'package_manifest_url': '',
            'package_url': '',
            'managed': False,
            'installer_kind': '',
            'self_update': False,
        }

    # The routes read ``updates.check`` off the module on every call, so
    # replacing it here is enough; nothing in Dannify's code holds a copy.
    updates.check = _up_to_date


# ---------------------------------------------------------------------------
# The contract: what this integration needs from this copy of Dannify
# ---------------------------------------------------------------------------
#
# Everything above reaches into Dannify's own code by name — account, vault,
# updates, the routes' broadcast — because that is the only way to add the
# player's routes to an app that was not built to have them. Every one of
# those names is somebody else's, and a new release may move or rename any of
# them.
#
# A moved name is the worst kind of break: the extension still opens, the
# library still looks right, and one button quietly does nothing. So every
# name is probed once, here, after the app is built, and the answer is
# published at GET /api/player/version for the player's window to show.
# A failing check says which name went missing and what it was for — which
# is the whole difference between "the update broke sign-in" and "something
# is broken somewhere".


def _require(obj: Any, *names: str) -> None:
    """Every name the player reaches for in ``obj``, asked for by name."""
    for name in names:
        if not hasattr(obj, name):
            raise AttributeError(f'{obj} has no {name}')
        if not callable(getattr(obj, name)):
            raise AttributeError(f'{obj}.{name} is not callable')


def _checks(module: Any, wrapped: bool) -> list[tuple[str, str, Any]]:
    """(what it is for, what it does for the player, the probe)."""

    def entrypoint() -> None:
        _require(module, 'build_app', '_setup_logging', '_fix_mime_types')

    def account() -> None:
        from dannify import account as mod  # noqa: PLC0415
        _require(mod, 'status', 'sign_in', 'sign_out', 'is_signed_in', 'liked_songs')
        if not getattr(mod, '_COOKIE_NAMES', None):
            raise AttributeError('dannify.account has no _COOKIE_NAMES')

    def explorer() -> None:
        from dannify import explorer  # noqa: PLC0415
        _require(explorer, 'clear_cache')

    def updates() -> None:
        from dannify import updates  # noqa: PLC0415
        # The routes read ``updates.check`` off the module on every call; if
        # a newer copy binds it instead, the stub below never reaches them
        # and this copy's self-updater is live again (it would download the
        # whole upstream installer on every launch, forever).
        if getattr(updates.check, '__name__', '') != '_up_to_date':
            raise AttributeError(
                "updates.check is not the player's stub — a newer copy "
                'reads it somewhere else, so the self-updater is live again',
            )
        if not getattr(updates, 'SITE_URL', ''):
            raise AttributeError('dannify.updates has no SITE_URL')

    def broadcast() -> None:
        from dannify.routes.common import state as routes_state  # noqa: PLC0415
        send = getattr(routes_state.connections, 'broadcast', None)
        if not callable(send):
            raise AttributeError('routes.common.state.connections.broadcast is gone')
        # The download-finished socket is a hook around this one call, so it
        # has to be replaceable as well as present.
        routes_state.connections.broadcast = send
        if routes_state.connections.broadcast is not send:
            raise AttributeError('connections.broadcast cannot be replaced')

    def vault() -> None:
        from dannify import vault  # noqa: PLC0415
        _require(vault, 'read_index')

    def downloads_dir() -> None:
        from dannify import api  # noqa: PLC0415
        if not getattr(api.state, 'download_dir', None):
            raise AttributeError('api.state.download_dir was never set')

    def sign_in_window() -> None:
        import window_signin  # noqa: PLC0415  (beside this file)
        _require(window_signin, 'sign_in', 'prewarm')

    def sign_in_browser() -> None:
        import browser_signin  # noqa: PLC0415  (beside this file)
        _require(browser_signin, 'sign_in')

    def login_class() -> None:
        from dannify.shell.windows import login  # noqa: PLC0415
        if not isinstance(getattr(login, '_LoginWindow', None), type):
            raise AttributeError('dannify.shell.windows.login._LoginWindow is gone')

    def bridge_file() -> None:
        if not BRIDGE_SCRIPT.is_file():
            raise FileNotFoundError(f'{BRIDGE_SCRIPT.name} is missing')
        if BRIDGE_MARK.encode() not in BRIDGE_SCRIPT.read_bytes():
            raise AttributeError(f'{BRIDGE_SCRIPT.name} does not carry {BRIDGE_MARK!r}')

    def interface() -> None:
        location = getattr(module, 'WEB_GUI_LOCATION', None)
        page = Path(location) / 'index.html' if location else None
        if page is None or not page.is_file():
            raise FileNotFoundError('the interface folder is not where this copy serves it from')

    def injected() -> None:
        if not wrapped:
            raise AttributeError("the served interface is not wrapped, so the player's script is never injected")

    return [
        ('entrypoint', "Dannify's own app builds", entrypoint),
        ('account', 'signing in, and the liked songs', account),
        ('explorer', 'clearing the caches after a sign-in', explorer),
        ('updates', "keeping this copy's self-updater off", updates),
        ('broadcast', 'the download-finished socket', broadcast),
        ('vault', 'reading the downloads list', vault),
        ('downloads', 'finding the songs it has downloaded', downloads_dir),
        ('window-signin', "Dannify's own sign-in window", sign_in_window),
        ('browser-signin', 'the sign-in without a window', sign_in_browser),
        ('login-window', 'the window both of those drive', login_class),
        ('bridge-script', 'play/pause and Ctrl+R in the frame', bridge_file),
        ('interface', 'the interface folder being served', interface),
        ('injection', "the player's script reaching that interface", injected),
    ]


def _check_contract(module: Any, wrapped: bool) -> dict[str, Any]:
    global _contract
    missing: list[dict[str, str]] = []
    checks = _checks(module, wrapped)
    for name, why, probe in checks:
        try:
            probe()
        except Exception as exc:  # a missing name is a broken feature, not a crash
            missing.append({'check': name, 'for': why, 'missing': str(exc)})
    try:
        from dannify import __version__ as version  # noqa: PLC0415
    except Exception:
        version = ''
    _contract = {
        'ok': not missing,
        'contract': CONTRACT_VERSION,
        'dannify': version,
        'checked': len(checks),
        'missing': missing,
    }
    for item in missing:
        logger.error('contract: {} is missing — {} ({})', item['check'], item['for'], item['missing'])
    if missing:
        logger.error('contract: {} of {} checks failed on dannify {}', len(missing), len(checks), version)
    else:
        logger.info('contract: all {} checks passed on dannify {}', len(checks), version)
    return _contract


# ---------------------------------------------------------------------------
# The in-page bridge, injected on the way out
# ---------------------------------------------------------------------------


def _is_html(message: dict[str, Any]) -> bool:
    for key, value in message.get('headers') or ():
        if key.lower() == b'content-type':
            return b'text/html' in value.lower()
    return False


def _with_bridge(body: bytes) -> bytes:
    """The page, with the player's script in its head (once)."""
    if BRIDGE_PATH.encode() in body or BRIDGE_MARK.encode() in body:
        return body  # already carrying it — never twice
    at = body.find(b'</head>')
    if at == -1:
        at = body.find(b'</HEAD>')
    if at != -1:
        return body[:at] + BRIDGE_TAG + b'\n    ' + body[at:]
    # No head to hang it in. The bridge only listens for events, so the end
    # of the body is nearly as early and never worse than not being there.
    return body + BRIDGE_TAG


class _BridgeInject:
    """Put the player's script into the interface as it goes out.

    This wraps the static mount from the inside — under the gzip and the
    session gate — so what it hands up is ordinary HTML that the rest of the
    stack treats as it always did. Wrapping from outside would have meant
    decompressing to inject and compressing again after, and the gzip is
    there for the search payloads, not for us.

    Only a 200 text/html is held; everything else — the assets, the audio,
    the 304s that answer a revalidated page — is passed straight through.
    A response too big to be the interface (4 MB) is passed through too,
    rather than held in memory for a page that is not ours.
    """

    MAX = 4 << 20

    def __init__(self, app: Any) -> None:
        self.app = app

    async def __call__(self, scope, receive, send):  # noqa: ANN001
        if scope.get('type') != 'http' or scope.get('method') != 'GET':
            return await self.app(scope, receive, send)

        held: dict[str, Any] = {}
        kept: list[bytes] = []
        total = 0

        async def out(message: dict[str, Any]) -> None:
            nonlocal total
            if message.get('type') == 'http.response.start':
                if message.get('status') == 200 and _is_html(message):
                    held['start'] = message
                    return
                return await send(message)
            if 'start' not in held:
                return await send(message)

            chunk = message.get('body') or b''
            total += len(chunk)
            if total > self.MAX:
                # Not the interface after all: hand over what was held and
                # stop holding anything.
                start = held.pop('start')
                await send(start)
                for done in kept:
                    await send({'type': 'http.response.body', 'body': done, 'more_body': True})
                kept.clear()
                return await send(message)
            kept.append(chunk)
            if message.get('more_body'):
                return

            body = _with_bridge(b''.join(kept))
            start = held.pop('start')
            headers = [
                (key, value)
                for key, value in (start.get('headers') or ())
                if key.lower() != b'content-length'
            ]
            headers.append((b'content-length', str(len(body)).encode('latin-1')))
            start = {**start, 'headers': headers}
            await send(start)
            await send({'type': 'http.response.body', 'body': body, 'more_body': False})

        await self.app(scope, receive, out)


def _wrap_interface(app: Any) -> bool:
    """Put the injector in front of the only thing here that serves HTML."""
    for route in getattr(app.router, 'routes', []):
        if getattr(route, 'name', None) == 'static' and hasattr(route, 'app'):
            if not isinstance(route.app, _BridgeInject):
                route.app = _BridgeInject(route.app)
            return True
    return False


def build(module: Any) -> Any:
    """Dannify's app, with the player's routes in front of everything."""

    from starlette.responses import FileResponse, JSONResponse  # noqa: PLC0415

    _disable_self_update()
    app = module.build_app()

    @app.middleware('http')
    async def player_session_routes(request, call_next):  # noqa: ANN001, ANN202
        # What this integration needs from the copy of Dannify it is running
        # on top of, published for the player's window to show.
        if request.url.path == '/api/player/version':
            return JSONResponse(_contract)

        # The player's own in-page bridge. Served here and injected into the
        # interface by _BridgeInject, so no file of Dannify's is ever edited.
        if request.url.path == BRIDGE_PATH:
            if request.method != 'GET':
                return JSONResponse({'error': 'GET only'}, status_code=405)
            return FileResponse(
                BRIDGE_SCRIPT,
                media_type='application/javascript',
                headers={'cache-control': 'no-store'},
            )

        if request.url.path == '/api/player/session':
            if request.method == 'GET':
                return JSONResponse(_session())
            if request.method == 'POST':
                try:
                    body = await request.json()
                except Exception:
                    return JSONResponse({'signed_in': False, 'error': 'no cookies sent'})
                cookies = body.get('cookies') if isinstance(body, dict) else None
                if not isinstance(cookies, dict):
                    return JSONResponse({'signed_in': False, 'error': 'no cookies sent'})
                return JSONResponse(await asyncio.to_thread(_sign_in, cookies))

        if request.url.path == '/api/player/from-browser':
            if request.method != 'POST':
                return JSONResponse({'unavailable': True, 'reason': 'POST only'})
            # The browser is the one place a Chromium session can be read
            # from, and the user may take a while to sign in: the request
            # waits with them rather than reporting a failure at once.
            return JSONResponse(
                await asyncio.to_thread(_from_browser, BROWSER_SIGNIN_TIMEOUT)
            )

        if request.url.path == '/api/player/downloads':
            return JSONResponse(await asyncio.to_thread(_downloads))

        if request.url.path == '/api/player/likes':
            return JSONResponse(await asyncio.to_thread(_likes))

        if request.url.path == '/api/player/art':
            return await asyncio.to_thread(_art, request.query_params.get('url') or '')

        return await call_next(request)

    _check_contract(module, _wrap_interface(app))

    return PlayerCors(app)


def _prewarm_signin() -> None:
    """Warm the sign-in window's .NET side in the background (issue 2.7).

    Pressing Sign in builds a WinForms window over WebView2, and the first
    time in a process that costs a minute of .NET loading — measured at 59 s
    from click to window — between the press and the window. None of that
    needs the press, so it is paid here instead, while the server gets on
    with starting.
    """

    try:
        import window_signin  # noqa: PLC0415  (beside this file)

        window_signin.prewarm()
    except Exception:
        logger.debug('Sign-in prewarm could not start')


def _ask(app: Any, path: str) -> Any:
    """One GET, straight through the real stack, with no socket in the way.

    Gateway, gzip, the player's routes and the static mount are all in the
    path, so what comes back is what the player's window would get — which
    is the only thing worth checking.
    """

    async def one() -> tuple[int, dict, bytes]:
        scope: dict[str, Any] = {
            'type': 'http',
            'asgi': {'version': '3.0', 'spec_version': '2.3'},
            'http_version': '1.1',
            'method': 'GET',
            'scheme': 'http',
            'path': path,
            'raw_path': path.encode('ascii'),
            'query_string': b'',
            'root_path': '',
            'headers': [
                (b'host', b'127.0.0.1:8765'),
                (b'accept', b'text/html,*/*'),
                # nothing here negotiates compression, so what comes back is
                # the bytes as they left the injector
                (b'accept-encoding', b'identity'),
                (b'connection', b'close'),
            ],
            'client': ('127.0.0.1', 41000),
            'server': ('127.0.0.1', 8765),
        }
        status = 0
        headers: dict = {}
        body = bytearray()

        async def send(message: dict[str, Any]) -> None:
            nonlocal status, headers
            if message['type'] == 'http.response.start':
                status = message['status']
                headers = {key: value for key, value in (message.get('headers') or ())}
            elif message['type'] == 'http.response.body':
                body.extend(message.get('body') or b'')

        async def receive() -> dict[str, Any]:
            return {'type': 'http.request', 'body': b'', 'more_body': False}

        await app(scope, receive, send)
        return status, headers, bytes(body)

    return one()


async def _probe(app: Any) -> dict[str, Any]:
    """The three things the player's window takes on trust."""
    fetched: dict[str, int] = {}
    problems: list[str] = []

    status, _headers, page = await _ask(app, '/')
    fetched['/'] = status
    if status != 200:
        problems.append(f'the interface answered {status}')
    elif BRIDGE_PATH.encode() not in page:
        problems.append("the interface went out without the player's script")

    status, _headers, script = await _ask(app, BRIDGE_PATH)
    fetched[BRIDGE_PATH] = status
    if status != 200:
        problems.append(f'the bridge script answered {status}')
    elif BRIDGE_MARK.encode() not in script:
        problems.append(f'the bridge script does not carry {BRIDGE_MARK!r}')

    status, _headers, version = await _ask(app, '/api/player/version')
    fetched['/api/player/version'] = status
    if status != 200:
        problems.append(f'the version route answered {status}')
    else:
        try:
            reported = json.loads(version.decode())
        except Exception:
            reported = {}
        if reported.get('contract') != CONTRACT_VERSION:
            problems.append('the version route does not know this contract')

    return {'ok': not problems, 'fetched': fetched, 'problems': problems}


def _smoke(log_level: str) -> int:
    """Build the whole thing, ask it every question, and say what happened.

    No socket and no background threads: this is what the update tool runs
    before it swaps one copy of Dannify for another. It loads the copy it is
    about to install, checks every name the player reaches for in it, and
    fetches the interface, the player's script and the version route through
    the real stack. One JSON object on stdout; exit 0 only if all of it held.
    """
    # A copy under test must not be told where the real library is: it gets
    # a scratch folder instead, and the person's music is never touched.
    os.environ.setdefault('DANNIFY_DATA_DIR', tempfile.mkdtemp(prefix='dannify-smoke-'))

    module = _load_dannify()
    module._setup_logging(log_level)
    module._fix_mime_types()
    app = build(module)

    probed = asyncio.run(_probe(app))
    report = {**_contract, **probed}
    report['ok'] = bool(_contract['ok']) and bool(probed['ok'])
    print(json.dumps(report, indent=2))
    return 0 if report['ok'] else 1


def serve(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(prog='dannify-player')
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--log-level', default='warning')
    parser.add_argument(
        '--smoke',
        action='store_true',
        help='build everything, check the contract, fetch a few pages, print JSON, exit',
    )
    parsed = parser.parse_args(argv)

    if parsed.smoke:
        raise SystemExit(_smoke(parsed.log_level))

    module = _load_dannify()
    module._setup_logging(parsed.log_level)
    module._fix_mime_types()
    app = build(module)

    from uvicorn import Config, Server  # noqa: PLC0415

    loop = asyncio.new_event_loop()
    server = Server(
        Config(
            app=app,
            host=parsed.host,
            port=parsed.port,
            loop=loop,
            log_level=parsed.log_level.lower(),
            log_config=None,
            workers=1,
        )
    )
    try:
        threading.Thread(target=_prewarm_signin, name='signin-prewarm', daemon=True).start()
        loop.run_until_complete(server.serve())
    except (KeyboardInterrupt, asyncio.CancelledError):
        pass


if __name__ == '__main__':
    serve()
