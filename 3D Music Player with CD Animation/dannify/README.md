# The Dannify extension

This folder **is** the online side of the player. It is Dannify itself —
its interface, its search, its player, its library — running as its own
app and shown in the player's extension window.

Nothing in the player mixes with it:

| | The player | Dannify (this folder) |
| --- | --- | --- |
| Songs | your imported files, in `md-walkman` | its own library |
| Player | the CD deck and its transport | its own bar and queue |
| Data | `%APPDATA%\MUN15H` | `%APPDATA%\MUN15H\dannify-data` |
| Interface | React, in `app/src` | its own build, in `frontend/dist` |

The player touches this folder in exactly two ways: it runs `run.cmd`, and
it points a window at `http://127.0.0.1:8765/`. It does not import
anything from it and does not know its version.

## What is the player's here

| File | Whose | What it is |
| --- | --- | --- |
| `Backend/` | Dannify's | its Python app, untouched |
| `frontend/dist/` | Dannify's | its built interface, untouched |
| `run.cmd` | the player's | starts the extension |
| `player_bridge.py` | the player's | Dannify's app, plus `/api/player/session` so the player can hand it a signed-in account, the contract check (`GET /api/player/version`) and `--smoke` |
| `mun15h_bridge.js` | the player's | reports this extension's own play/pause to the player around the frame, and falls silent when the player asks, so only one of the two ever plays. Injected into every page on its way out — `frontend/dist/` is never edited |
| `window_signin.py` | the player's | opens Dannify's own "Sign in with Google" window (the standalone app's `_LoginWindow`, unchanged) for a machine with no shell |
| `browser_signin.py` | the player's | the same sign-in through a real browser, for when that window cannot start |

The sign-in is the only thing the player adds to the Python side. Dannify's
own sign-in needs
its desktop shell and refuses in a browser; the extension runs the very
window the standalone app uses, keeps the session it leaves, and calls
Dannify's own `account.sign_in` with it. Nothing of Dannify's is patched —
the bridge is injected at serve time and its Python names are only read, so
a new version of Dannify is still just a folder swap: these five files and
`run.cmd` are the only ones to keep.

## Checking one

```bat
.venv\Scripts\python.exe player_bridge.py --smoke
```

Builds the whole thing against a scratch data folder, probes every name
this player reaches into (`Backend/main.py` → `build_app`, `dannify.account`,
`dannify.vault.read_index`, …), fetches `/`, `/__mun15h/bridge.js` and
`/api/player/version`, and prints one JSON object. Exit 0 only if all of it
held — `"ok": true, "missing": []`. The same report is live while the
extension runs: the player's chrome bar shows this version and whether the
contract is whole.

## Running it

```bat
run.cmd
```

That is what the player runs too. The first launch makes a Python
environment in `.venv/` (a minute, once); every launch after it is a
second or two.

`run.cmd` keeps Dannify's state in `%APPDATA%\MUN15H\dannify-data`, so its
library and settings survive restarts and stay out of the player's.

## Updating it

One command, from `app/`:

```bash
python tools/update-dannify.py --from <folder-or-zip>   # a copy you have
python tools/update-dannify.py --release v4.18.0         # fetch from GitHub
python tools/update-dannify.py --from <zip> --dry-run    # stage and check only
```

It stages the new copy in `dannify-next` (never inside the copy in use),
refuses anything that is not this source layout, carries the player's own
files across, installs the new `requirements.txt` into `.venv/` and stamps
it, runs `--smoke` against the staged copy, and only then swaps it in —
leaving the old copy as `dannify-prev` to roll back to. The data folder is
never touched. The full contract, the seams and the release-asset problem
are in [`app/docs/INTEGRATION_CONTRACT.md`](../app/docs/INTEGRATION_CONTRACT.md).

By hand, the same thing: keep `run.cmd`, `player_bridge.py`,
`mun15h_bridge.js`, `window_signin.py`, `browser_signin.py`, this file and
`.venv/`, take the new version's `Backend/`, `frontend/dist/`, `VERSION`,
`LICENSE` and `THIRD-PARTY-NOTICES.md`, then run `--smoke`. If a new
version's `requirements.txt` changes, `run.cmd` reinstalls and re-stamps
the environment on the next launch.

## What it needs

Python 3.11 or newer (`run.cmd` prefers 3.14 when the machine has a working
one). A packaged build of the player will have to ship one, or the folder
next to it; the current build runs it from the machine's Python.
