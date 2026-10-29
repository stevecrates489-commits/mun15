#!/usr/bin/env python3
"""Update the Dannify extension the player runs, as one safe step.

    python tools/update-dannify.py --from <folder-or-zip>   # you already have it
    python tools/update-dannify.py --release v4.18.0         # fetch from GitHub
    python tools/update-dannify.py --from <zip> --dry-run    # stage, check, stop

What it does, in order, and never out of order:

  1. looks at what it is being offered and refuses anything that is not the
     layout the bridge needs (`Backend/main.py` + `frontend/dist/index.html`).
     A release that only ships a frozen installer says so and stops — see
     "Why a release may have nothing to give you" below.
  2. stages it in `dannify-next`, beside the copy in use, never inside it.
  3. carries the player's own files across (`run.cmd`, `player_bridge.py`,
     `window_signin.py`, `browser_signin.py`, `mun15h_bridge.js`, `README.md`,
     `bin/`) — they are ours, and a new Dannify does not have them.
  4. makes the Python environment match the new requirements, and stamps the
     requirements it installed from (run.cmd checks that stamp every launch).
  5. runs `<venv>/python player_bridge.py --smoke` against the staged copy:
     it loads the copy, checks every name the player reaches for in it, and
     fetches the interface, the bridge script and the version route. Nothing
     swaps until that says "ok".
  6. swaps the folders by rename — old copy to `dannify-prev`, staged copy
     into place — and smokes again at its real address. Anything wrong after
     the swap puts the old copy back.
  7. leaves `dannify-prev` behind as the rollback (`--discard-prev` removes
     it once everything passed). The library in
     `%APPDATA%\\MUN15H\\dannify-data` is not touched at any point.

Why a release may have nothing to give you
------------------------------------------
The bridge runs Dannify *from source*, so it needs a source-layout tree.
Dannify's GitHub releases ship a Windows installer and a payload of frozen
binaries (`Dannify.exe`, `Dannify.pkg`, `runtime/...`) whose application
code is packed inside, and the repository's tags carry only docs. There is
no source-layout artifact in such a release, and a frozen payload cannot be
bridged: the routes this player adds are Python, and they have to be loaded
into a Python app. When that is what a release looks like, this tool says
so (exit 2) and changes nothing; getting a newer extension then means
getting a source-layout copy of Dannify from wherever it is published.

Exit codes: 0 done (or dry run that passed) · 1 refused or failed · 2 the
release carries no source-layout payload.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import urllib.request
import zipfile
from pathlib import Path
from typing import Any, Optional

# A Windows console writes cp1252 unless it is told otherwise, and every em
# dash and arrow in this tool's output is a multi-byte character: left
# alone, "from GitHub —" arrives as "from GitHubâ".
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding='utf-8', errors='replace')
    except (AttributeError, ValueError):
        pass

# The release key this tool trusts. It is the key the extension itself
# verifies against (Backend/dannify/updates.py, PUBLIC_KEY), pinned here so
# that a tampered copy of either cannot quietly swap it. A key rotation is a
# deliberate, reviewable event: --accept-new-key is how it is accepted.
PINNED_PUBLIC_KEY = 'e6946c1597fd9f26d2c0f87da91a5cf06e318ef92af3bca9899b72c8f905f5b8'

REPO = 'Riskraptor/Dannify'
PORT = 8765

# What must be there for the bridge to be able to run at all.
REQUIRED = ('Backend/main.py', 'Backend/requirements.txt', 'frontend/dist/index.html')

# What the player owns: carried from the copy in use to the copy being staged.
PLAYER_FILES = (
    'run.cmd',
    'player_bridge.py',
    'window_signin.py',
    'browser_signin.py',
    'mun15h_bridge.js',
    'README.md',
)
PLAYER_DIRS = ('bin',)

# What never comes along with a payload.
IGNORE = ('.venv', '__pycache__', '.git', '.DS_Store', 'dannify-next', 'dannify-prev')


def say(message: str) -> None:
    print(f'[update-dannify] {message}', flush=True)


def fail(message: str, code: int = 1) -> None:
    print(f'[update-dannify] REFUSED: {message}', file=sys.stderr, flush=True)
    raise SystemExit(code)


# ---------------------------------------------------------------------------
# Where things are
# ---------------------------------------------------------------------------


def default_extension() -> Path:
    """The extension folder: the `dannify` beside this app, found the way the
    player itself finds it — walking up until a `dannify/run.cmd` turns up —
    so a build and a source checkout both land on the same folder."""
    here = Path(__file__).resolve()
    for level in (here, *here.parents):
        candidate = level / 'dannify'
        if (candidate / 'run.cmd').is_file():
            return candidate
    # Nothing found: the layout this tool ships in, said plainly.
    return here.parent.parent.parent / 'dannify'


def is_listening(port: int = PORT) -> bool:
    try:
        with socket.create_connection(('127.0.0.1', port), timeout=0.3):
            return True
    except OSError:
        return False


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, 'rb') as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b''):
            digest.update(chunk)
    return digest.hexdigest()


def http(url: str, timeout: float = 60.0) -> bytes:
    request = urllib.request.Request(
        url, headers={'User-Agent': 'MUN15H-update-dannify', 'Accept': '*/*'}
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read()


def http_json(url: str) -> Any:
    return json.loads(http(url, timeout=30.0).decode('utf-8'))


# ---------------------------------------------------------------------------
# 1 — is this the layout the bridge needs?
# ---------------------------------------------------------------------------


def source_layout(where: Path) -> list[str]:
    """The required files that are missing — empty means it is usable."""
    return [rel for rel in REQUIRED if not (where / rel).is_file()]


def looks_frozen(names: list[str]) -> str:
    """What a payload that is not source-layout actually is, in words."""
    top = sorted({name.split('/')[0] for name in names})
    if any(name.endswith('.exe') for name in names) or 'runtime' in top:
        return (
            'a frozen install (executable + runtime), whose application code is '
            'packed inside it. The bridge adds Python routes to a running Python '
            'app, which needs the source tree, not the frozen result of it.'
        )
    if not any('/Backend/' in f'/{name}' for name in names):
        return (
            'no Backend/ anywhere in it — this repository\'s tags carry the docs, '
            "not the app's source"
        )
    if top:
        return f"not the layout the bridge needs (top level: {', '.join(top[:6])})"
    return 'empty'


def strip_root(staged: Path) -> Path:
    """Unwrap a single top-level folder, the way a GitHub zip arrives."""
    entries = [item for item in staged.iterdir() if item.name not in ('.', '..')]
    if len(entries) == 1 and entries[0].is_dir():
        inner = entries[0]
        for item in inner.iterdir():
            shutil.move(str(item), str(staged / item.name))
        inner.rmdir()
    return staged


def extract_zip(archive: Path, into: Path) -> Path:
    into.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(archive) as zip_file:
        for info in zip_file.infolist():
            name = info.filename
            if name.startswith('/') or '..' in Path(name).parts:
                fail(f'the archive contains an entry outside itself: {name}')
        zip_file.extractall(into)
    return strip_root(into)


# ---------------------------------------------------------------------------
# Integrity — the release's own signature, checked against a pinned key
# ---------------------------------------------------------------------------


def _load_signing(extension: Path):
    """Dannify's own Ed25519 verifier, loaded by path from the copy in use."""
    path = extension / 'Backend' / 'dannify' / 'signing.py'
    if not path.is_file():
        return None
    spec = importlib.util.spec_from_file_location('dannify_signing', path)
    if spec is None or spec.loader is None:
        return None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def installed_public_key(extension: Path) -> str:
    """The key the copy in use trusts, read from its source text (not imported:
    updates.py pulls in the whole package)."""
    path = extension / 'Backend' / 'dannify' / 'updates.py'
    if not path.is_file():
        return ''
    text = path.read_text(encoding='utf-8', errors='replace')
    found = re.search(r"^PUBLIC_KEY\s*=\s*'([0-9a-f]{64})'", text, re.M)
    return found.group(1) if found else ''


def verify_manifest(
    extension: Path,
    manifest: bytes,
    signature: str,
    version: str,
    accept_new_key: bool,
) -> None:
    """Refuse a manifest the release machine did not sign."""
    key = installed_public_key(extension)
    if not key:
        say('the copy in use publishes no release key — signature not checked')
        return
    if key != PINNED_PUBLIC_KEY:
        if not accept_new_key:
            fail(
                'the copy in use trusts a different release key than this tool does.\n'
                f'  installed: {key}\n  pinned:    {PINNED_PUBLIC_KEY}\n'
                '  Review where each came from, then re-run with --accept-new-key.'
            )
        say(f'accepting a new release key on request: {key[:16]}…')
    signing = _load_signing(extension)
    if signing is None:
        say('dannify.signing is missing — signature not checked')
        return
    digest = hashlib.sha256(manifest).hexdigest()
    if not signing.verify_release(key, 'package', version, digest, signature):
        fail(f'the package list for {version} is not signed by the expected key')


def verify_files(staged: Path, manifest: dict) -> list[str]:
    """Every staged file checked against the hashes the signed list names."""
    files = manifest.get('files') or {}
    if not files:
        return ['the package list is empty']
    problems = []
    for rel, meta in files.items():
        path = staged / rel
        if not path.is_file():
            problems.append(f'{rel} is in the list but not in the payload')
            continue
        if int(meta.get('size') or 0) != path.stat().st_size:
            problems.append(f'{rel} is not the size the list says')
        elif (meta.get('sha256') or '').lower() != sha256(path):
            problems.append(f'{rel} does not hash to what the list says')
    return problems


# ---------------------------------------------------------------------------
# 2/3 — stage the next copy, carrying ours across
# ---------------------------------------------------------------------------


def copy_payload(source: Path, staged: Path) -> None:
    def ignore(_dir: str, names: list[str]) -> set[str]:
        return {name for name in names if name in IGNORE}

    shutil.copytree(source, staged, ignore=ignore)


def carry_player_files(extension: Path, staged: Path) -> list[str]:
    carried = []
    for name in PLAYER_FILES:
        src = extension / name
        if src.is_file():
            shutil.copy2(src, staged / name)
            carried.append(name)
    for name in PLAYER_DIRS:
        src = extension / name
        if src.is_dir():
            target = staged / name
            if target.exists():
                shutil.rmtree(target)
            shutil.copytree(src, target)
            carried.append(f'{name}/')
    return carried


def venv_python(extension: Path) -> Optional[Path]:
    found = extension / '.venv' / 'Scripts' / 'python.exe'
    if found.is_file():
        return found
    found = extension / '.venv' / 'bin' / 'python'
    return found if found.is_file() else None


def ensure_requirements(python: Path, staged: Path, extension: Path, dry_run: bool) -> bool:
    """Install what the new copy needs and stamp it, the way run.cmd would."""
    requirements = staged / 'Backend' / 'requirements.txt'
    stamp = extension / '.venv' / 'requirements.txt.stamp'
    wanted = requirements.read_bytes()
    if stamp.is_file() and stamp.read_bytes() == wanted:
        return False  # already installed from exactly these
    if dry_run:
        say('would run: python -m pip install -r Backend/requirements.txt (and stamp it)')
        return False
    say('installing the new copy\'s requirements into the extension\'s venv…')
    done = subprocess.run(
        [str(python), '-m', 'pip', 'install', '--disable-pip-version-check', '-q',
         '-r', str(requirements)],
        cwd=str(staged),
        capture_output=True,
        text=True,
    )
    if done.returncode != 0:
        fail('the new requirements could not be installed:\n' + (done.stderr or done.stdout or ''))
    stamp.parent.mkdir(parents=True, exist_ok=True)
    stamp.write_bytes(wanted)
    return True


def smoke(python: Path, staged: Path) -> dict:
    """Run the staged copy's own checks: contract, interface, bridge, version."""
    env = dict(os.environ)
    # A copy under test is never pointed at the real library.
    env.pop('DANNIFY_DATA_DIR', None)
    env['DANNIFY_DATA_DIR'] = os.path.join(
        tempfile.gettempdir(), 'dannify-update-smoke'
    )
    result = subprocess.run(
        [str(python), 'player_bridge.py', '--smoke', '--log-level', 'error'],
        cwd=str(staged),
        env=env,
        capture_output=True,
        text=True,
        timeout=600,
    )
    try:
        report = json.loads(result.stdout)
    except Exception:
        report = {
            'ok': False,
            'problems': ['the smoke check produced no report'],
            'raw': (result.stdout or result.stderr or '')[-2000:],
        }
    report['exit'] = result.returncode
    return report


def show_report(report: dict) -> None:
    version = report.get('dannify') or '?'
    if report.get('ok'):
        say(f'smoke: ok — dannify {version}, {report.get("checked")} names checked, '
            f'{len(report.get("fetched") or {})} routes fetched')
        return
    say(f'smoke: FAILED — dannify {version}')
    for item in report.get('missing') or []:
        print(f"    missing  {item.get('check')}: {item.get('missing')}\n"
              f"             (for: {item.get('for')})", flush=True)
    for problem in report.get('problems') or []:
        print(f'    problem  {problem}', flush=True)
    if report.get('raw'):
        print(f'    output   {report["raw"]}', flush=True)


# ---------------------------------------------------------------------------
# 6/7 — the swap, and the way back out of it
# ---------------------------------------------------------------------------


def swap(extension: Path, staged: Path, previous: Path) -> None:
    if previous.exists():
        shutil.rmtree(previous)
    os.rename(extension, previous)
    try:
        os.rename(staged, extension)
    except Exception:
        os.rename(previous, extension)  # put it back, exactly as it was
        raise


def unswap(extension: Path, staged: Path, previous: Path) -> None:
    """Undo a swap: the old copy comes back to where it was."""
    if extension.exists():
        shutil.rmtree(extension)
    os.rename(previous, extension)
    if staged.exists():
        shutil.rmtree(staged)


def pull() -> dict:
    """The newest release, as GitHub describes it."""
    return http_json(f'https://api.github.com/repos/{REPO}/releases/latest')


def release_for(tag: str) -> dict:
    if tag in ('latest', ''):
        return pull(tag)
    return http_json(f'https://api.github.com/repos/{REPO}/releases/tags/{tag}')


def from_release(
    release: dict,
    extension: Path,
    work: Path,
    accept_new_key: bool,
) -> tuple[Path, Optional[dict], list[str]]:
    """The release's payload, if it is one the bridge can run.

    Returns (payload folder, verified manifest or None, notes). Exits with
    code 2 when the release simply does not carry a source-layout copy.
    """
    tag = release.get('tag_name') or release.get('name') or '?'
    assets = release.get('assets') or []
    notes: list[str] = []
    # Which layout the signed list describes. It is the manifest of the
    # frozen payload today; a release that publishes a source-layout copy
    # names that copy's files, and only then does it verify one.
    wants_source_layout = False
    manifest_asset = next(
        (a for a in assets if re.match(r'^package-[0-9][0-9A-Za-z.+-]*\.json$', a['name'])), None
    )
    manifest: Optional[dict] = None

    if manifest_asset:
        raw = http(manifest_asset['browser_download_url'])
        manifest = json.loads(raw)
        sig_asset = next(
            (a for a in assets if a['name'] == manifest_asset['name'] + '.dsig'), None
        )
        wants_source_layout = 'Backend/main.py' in (manifest.get('files') or {})
        if sig_asset:
            verify_manifest(
                extension,
                raw,
                http(sig_asset['browser_download_url']).decode('utf-8', 'replace'),
                str(manifest.get('version') or tag.lstrip('v')),
                accept_new_key,
            )
            notes.append(f'signed package list verified for {manifest.get("version")}')
        else:
            notes.append('the package list carries no signature — hashes not checked')

    candidates: list[tuple[str, str]] = []
    package_zip = next(
        (a for a in assets if a['name'].endswith('.zip') and a['name'].startswith('package-')),
        None,
    )
    if package_zip:
        candidates.append((package_zip['browser_download_url'], package_zip['name']))
    if release.get('zipball_url'):
        candidates.append((release['zipball_url'], f'source-of-{tag}.zip'))

    refused: list[str] = []
    for index, (url, name) in enumerate(candidates):
        say(f'looking at {name}…')
        archive = work / f'candidate-{index}.zip'
        archive.write_bytes(http(url, timeout=600.0))
        candidate = work / f'candidate-{index}'
        extract_zip(archive, candidate)
        missing = source_layout(candidate)
        if not missing:
            say(f'{name} is the layout the bridge needs')
            if manifest is not None and not wants_source_layout:
                notes.append(
                    'the package list describes a different layout (the frozen one), '
                    'so its hashes do not check this payload — TLS and the signature '
                    'on the list are what vouch for this download'
                )
                manifest = None
            return candidate, manifest, notes
        names = []
        with zipfile.ZipFile(archive) as zip_file:
            names = zip_file.namelist()
        refused.append(f'  {name}: {looks_frozen(names)}')
        shutil.rmtree(candidate, ignore_errors=True)

    lines = [
        f'release {tag} carries no copy of Dannify this extension can run.',
        '',
        'The extension runs Dannify from source (Backend/ + frontend/dist/) so it',
        'can add its own routes to it. This release ships:',
        *refused,
        '',
        'What it would take: a source-layout copy of Dannify ' + tag + ' — the same',
        'folder layout as the copy in use — from wherever Dannify publishes one.',
        'See app/docs/INTEGRATION_CONTRACT.md for the whole contract and the',
        'options for getting updates without one.',
    ]
    print('\n'.join(lines), file=sys.stderr, flush=True)
    raise SystemExit(2)


# ---------------------------------------------------------------------------


def main() -> int:
    parser = argparse.ArgumentParser(
        prog='update-dannify',
        description='Update the Dannify extension folder the player runs.',
    )
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument('--from', dest='payload', metavar='FOLDER_OR_ZIP',
                        help='a source-layout copy of Dannify you already have')
    source.add_argument('--release', metavar='TAG|latest',
                        help='fetch a release from GitHub (v4.18.0, latest, …)')
    parser.add_argument('--dir', metavar='FOLDER',
                        help='the extension folder (default: the one beside this app)')
    parser.add_argument('--manifest', metavar='FILE',
                        help='a package-<version>.json to verify the payload against')
    parser.add_argument('--dry-run', action='store_true',
                        help='stage and check everything, swap nothing')
    parser.add_argument('--force', action='store_true',
                        help='proceed even though the extension is answering on :8765')
    parser.add_argument('--accept-new-key', action='store_true',
                        help='trust a release key that differs from the pinned one')
    parser.add_argument('--discard-prev', action='store_true',
                        help='delete the rollback copy once everything passed')
    args = parser.parse_args()

    extension = Path(args.dir).resolve() if args.dir else default_extension()
    if not (extension / 'run.cmd').is_file() or not (extension / 'player_bridge.py').is_file():
        fail(f'{extension} is not the extension folder (no run.cmd / player_bridge.py)')

    if is_listening() and not args.force:
        fail(
            'the extension is running (127.0.0.1:8765). Close the ONLINE panel / the '
            'player first, or pass --force.'
        )

    python = venv_python(extension)
    if python is None:
        fail('the extension has no Python environment yet — open the player once first')

    previous = extension.parent / 'dannify-prev'
    staged = extension.parent / 'dannify-next'
    work = Path(tempfile.mkdtemp(prefix='dannify-update-'))
    notes: list[str] = []
    manifest: Optional[dict] = None

    try:
        # 1 — what we are being offered
        if args.payload:
            payload = Path(args.payload).resolve()
            if payload.is_dir():
                missing = source_layout(payload)
                if missing:
                    fail(
                        'that is not a source-layout copy of Dannify; missing: '
                        + ', '.join(missing)
                    )
                if payload == extension:
                    fail('that is the extension folder itself, not a newer copy of it')
                say(f'using {payload}')
            elif payload.is_file() and zipfile.is_zipfile(payload):
                say(f'unpacking {payload.name}…')
                payload = extract_zip(payload, work / 'payload')
                missing = source_layout(payload)
                if missing:
                    fail('that archive is not a source-layout copy of Dannify; missing: '
                         + ', '.join(missing))
            else:
                fail(f'{payload} is neither a folder nor a zip')
        else:
            say(f'fetching release {args.release} from GitHub…')
            release = pull() if args.release in ('latest', '') else release_for(args.release)
            payload, manifest, notes = from_release(release, extension, work,
                                                    args.accept_new_key)
            for note in notes:
                say(note)

        if args.manifest:
            manifest = json.loads(Path(args.manifest).read_text(encoding='utf-8'))

        if manifest is not None:
            if 'Backend/main.py' not in (manifest.get('files') or {}):
                say('the package list describes another layout — not checking hashes against it')
                manifest = None
            else:
                problems = verify_files(payload, manifest)
                if problems:
                    fail('the payload does not match the package list:\n  ' + '\n  '.join(problems))
                say(f'every file matches the package list for {manifest.get("version")}')

        # 2/3 — stage it and carry ours across
        if staged.exists():
            shutil.rmtree(staged)
        say('staging in ' + str(staged.name) + '…')
        copy_payload(payload, staged)
        missing = source_layout(staged)
        if missing:
            fail('the staged copy is incomplete; missing: ' + ', '.join(missing))
        carried = carry_player_files(extension, staged)
        say('carried across: ' + ', '.join(carried))
        if 'mun15h_bridge.js' not in carried:
            fail('the player\'s bridge script is missing from the copy in use')

        old_req = (extension / 'Backend' / 'requirements.txt').read_bytes()
        new_req = (staged / 'Backend' / 'requirements.txt').read_bytes()
        say('requirements: ' + ('unchanged' if old_req == new_req else 'CHANGED'))

        # 4/5 — the environment, and the staged copy's own checks
        changed = ensure_requirements(python, staged, extension, args.dry_run)
        say('running the staged copy\'s own checks…')
        report = smoke(python, staged)
        show_report(report)
        if not report.get('ok'):
            if args.dry_run:
                say('dry run: nothing was swapped')
                return 1
            fail('the staged copy failed its checks — nothing was swapped')

        if args.dry_run:
            say('dry run: everything staged and checked, nothing swapped')
            return 0

        # 6 — swap
        say('swapping…')
        swap(extension, staged, previous)

        python_after = venv_python(extension)
        if python_after is None and previous.joinpath('.venv').is_dir():
            # the environment came along with the old copy; bring it over
            shutil.move(str(previous / '.venv'), str(extension / '.venv'))
            python_after = venv_python(extension)

        if python_after is not None:
            say('checking the copy at its real address…')
            final = smoke(python_after, extension)
            show_report(final)
            if not final.get('ok'):
                say('the copy misbehaves once installed — putting the old one back')
                unswap(extension, staged, previous)
                fail('rolled back to the previous copy')
        else:
            say('no Python environment to re-check with; run.cmd will build one')

        if changed:
            say('requirements installed and stamped')

        # 7 — how to get the old one back
        say(f'done — {extension.name} is updated (rollback copy: {previous.name})')
        if previous.exists() and args.discard_prev:
            shutil.rmtree(previous)
            say('rollback copy discarded')
        elif previous.exists():
            say(f'to roll back: rename {previous.name} to {extension.name} '
                f'(and delete {extension.name})')
        say('the library in %APPDATA%\\MUN15H\\dannify-data was not touched')
        return 0

    finally:
        shutil.rmtree(work, ignore_errors=True)
        # Staging is never left standing: either it became the extension, or
        # it was not good enough to be. (After a successful swap it has been
        # renamed away, so this is a no-op.)
        shutil.rmtree(staged, ignore_errors=True)


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except SystemExit:
        raise
    except KeyboardInterrupt:
        raise SystemExit(130)
    except Exception as exc:  # a tool that reports its own failures
        print(f'[update-dannify] FAILED: {exc}', file=sys.stderr, flush=True)
        raise SystemExit(1)
