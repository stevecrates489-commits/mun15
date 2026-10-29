# The Dannify integration contract

What the player requires from the copy of Dannify that sits in `dannify/`,
where each requirement lives, and what an update has to satisfy. Written for
the discussion about making updates routine instead of risky.

The short version: **the extension is a folder, not a build**. Replace the
folder and you have replaced the app — provided the folder still holds the
layout, the routes and the names listed below. Everything in this document
is that list, the machinery that checks it, and the one problem upstream
currently makes unavoidable (see [§6](#6-the-problem-with-releases-today)).

---

## 1. What the integration is

```
  THE PLAYER                                   THE EXTENSION (dannify/)
  ───────────                                  ──────────────────────────
  dannify.rs ──spawns──▶ run.cmd ──▶ .venv/Scripts/python.exe player_bridge.py
       │                                                  │
       │            waits for TCP 127.0.0.1:8765         ▼
       │                                        Backend/main.py (Dannify)
       │                                        + the player's routes
       ▼
  DannifyWindow.tsx ──iframe──▶ http://127.0.0.1:8765/
       │                              ▲
       │  fetch /api/player/*         │  injected <script> (mun15h_bridge.js)
       └──────────────────────────────┘
```

Dannify is not linked into the player. It is a folder containing its own
app (`Backend/` + `frontend/dist/`) and five player-owned files that wrap
it. The player finds the folder by looking for `dannify/run.cmd` above its
own executable, starts it hidden, waits for the port, and puts the page in
an iframe. Everything else is HTTP and `postMessage`.

## 2. The six seams

Every place a new version of Dannify can break this. Ordered by how
fragile they are.

### 2.1 Filesystem and launch — stable by design

| The player expects | Where it is checked |
| --- | --- |
| `dannify/run.cmd` exists near the exe | `app/src-tauri/src/dannify.rs`, `extension_dir()` |
| it listens on `127.0.0.1:8765` (fixed) | `dannify.rs`, `PORT` / `is_up()` |
| `Backend/requirements.txt` next to `Backend/main.py` | `dannify/run.cmd` |
| a venv whose `.venv/requirements.txt.stamp` matches `Backend/requirements.txt` | `dannify/run.cmd` (installs and stamps when they differ) |
| data kept apart: `DANNIFY_DATA_DIR=%APPDATA%\MUN15H\dannify-data` | `run.cmd`, read by `Backend/dannify/layout.py` |

Data is separate on purpose: an update replaces files, never the library.

### 2.2 The source layout — the non-negotiable one

`player_bridge.py` loads `Backend/main.py` **by path** and `main.py` serves
`frontend/dist` from disk. So the copy has to be runnable from source:

```
dannify/
  Backend/main.py            entry point, must define build_app()
  Backend/dannify/…          the app itself
  Backend/requirements.txt
  frontend/dist/index.html   the interface that gets served
  player_bridge.py           the player's: routes, injection, contract
  mun15h_bridge.js           the player's: in-page bridge, injected
  window_signin.py           the player's: Dannify's own sign-in window
  browser_signin.py          the player's: sign-in through a browser
  run.cmd                    the player's: launcher
  bin/ffmpeg                 the player's: for downloads
```

A frozen install (`Dannify.exe` + `runtime/`) **cannot** be bridged: the
player's routes are Python and have to be imported into a running Python
app. See §6.

### 2.3 Python names — the fragile seam, now checked

`player_bridge.py` reaches into Dannify's own code. Every name below is
somebody else's and may move in any release. They are probed once at boot
(`_check_contract`) and the answer is published at `GET /api/player/version`.

| Name in Dannify | What the player uses it for |
| --- | --- |
| `Backend/main.py` → `build_app`, `_setup_logging`, `_fix_mime_types` | building the app |
| `dannify.account` → `status`, `sign_in`, `sign_out`, `is_signed_in`, `liked_songs`, `_COOKIE_NAMES` | sign-in, account state, liked songs |
| `dannify.explorer.clear_cache` | clearing caches after a sign-in |
| `dannify.updates.check` (monkeypatched), `updates.SITE_URL` | keeping the self-updater off |
| `dannify.routes.common.state.connections.broadcast` (monkeypatched) | the download-finished socket |
| `dannify.vault.read_index` | reading the downloads list |
| `dannify.api.state.download_dir` | where the downloads live |
| `dannify.shell.windows.login._LoginWindow` | the sign-in window |
| `dannify.webui` / static mount, named `static` | where the injection is attached |

The report looks like this (from the copy in use):

```json
{
  "ok": true, "contract": 1, "dannify": "4.14.1",
  "checked": 13, "missing": []
}
```

and when an update moves something, the player's bar says so and names it
instead of leaving a dead button to be discovered later.

### 2.4 HTTP — the designed seam, unversioned

All of these are added by `player_bridge.py` in front of Dannify's own app,
and allowed cross-origin only for the player's own origins.

| Route | Used by | For |
| --- | --- | --- |
| `GET/POST /api/player/session` | `dannify.rs` | who it is signed in as; handing over a cookie jar |
| `POST /api/player/from-browser` | `dannify.rs` | the sign-in, waited out (up to 5 min) |
| `GET /api/player/downloads` | `downloads.ts` | the songs it has downloaded |
| `GET /api/player/likes` | `downloads.ts` | the songs the account liked |
| `GET /api/player/art?url=` | `downloads.ts` | artwork, proxied |
| `WS /api/player/downloads-ws` | `downloads.ts` | a finished download, the moment it happens |
| `GET /api/player/version` | `dannify.rs` → `DannifyWindow.tsx` | the contract report |
| `GET /__mun15h/bridge.js` | the page itself | the injected bridge script |
| `/downloads/…`, `/cover`, `/api/stream?video_id=` | `downloads.ts` | **Dannify's own** routes, used as they are |

Response shapes the UI reads: `{signed_in, profile{name}, error, cancelled,
timeout, unavailable}` and `{tracks:[{file,title,artist,album,video_id,url,cover}]}`.

### 2.5 The in-page bridge — no longer a patch

The bridge (play/pause up to the player, pause on request, Ctrl+R reloads
the frame only) lives in `dannify/mun15h_bridge.js` and is **injected into
every page on its way out** by `_BridgeInject`, which wraps the static
mount inside the app (under the gzip and the session gate). `GET
/__mun15h/bridge.js` serves the file. Nothing of Dannify's is edited, so a
new release needs no patch re-applied; the player matches on the mark
`mun15h-dannify-bridge`, which the script carries.

### 2.6 The UI chrome — stable

The bar above the iframe (label, sign-in button, close, status text) is
100% player-owned; upstream UI changes cannot touch it. It calls
`dannify_open`, `dannify_account`, `dannify_sign_in`, `dannify_version`.

## 3. Updating — the procedure, now automated

`app/tools/update-dannify.py` does the whole thing, and refuses to do any
of it out of order:

```
python tools/update-dannify.py --from <folder-or-zip>    # a copy you have
python tools/update-dannify.py --release v4.18.0          # fetch from GitHub
python tools/update-dannify.py --from <zip> --dry-run     # stage and check only
```

1. refuse a payload that is not the source layout (§2.2), and refuse to run
   while the extension is answering on :8765;
2. stage it in `dannify-next`, never inside the copy in use;
3. carry the player's own files across;
4. install the new `Backend/requirements.txt` into the venv and stamp it;
5. run `player_bridge.py --smoke` against the staged copy — contract check
   plus real fetches of `/`, `/__mun15h/bridge.js`, `/api/player/version`;
6. swap by rename (old copy → `dannify-prev`), then smoke again at the real
   address; anything wrong puts the old copy back;
7. leave `dannify-prev` as the rollback (`--discard-prev` removes it once
   everything passed).

`npm run dannify:update -- --from <path>` is the same thing from `app/`.

The library in `%APPDATA%\MUN15H\dannify-data` is never touched.

## 4. Checking a copy by hand

```
dannify\.venv\Scripts\python.exe player_bridge.py --smoke
```

Builds the whole thing against a scratch data folder, checks every name in
§2.3, fetches the three routes, prints one JSON object, exits 0 only if all
of it held. This is what the update tool runs before it swaps anything.

## 5. Rolling back

`dannify-prev` is the copy that was in use before the last update. Swap the
two folders and restart the player. Nothing else changes — the data folder
is shared by both and survives either way.

## 6. The problem with releases today

**Dannify's GitHub releases do not ship anything this extension can run.**

Checked against `v4.18.0` (2 days old at the time of writing):

| Asset | What it is | Usable? |
| --- | --- | --- |
| `Dannify-Setup-4.18.0.exe` | Windows installer for a frozen build | no — no source |
| `package-4.18.0.zip` + `.json` | the frozen payload: `Dannify.exe`, `Dannify.pkg`, `runtime/*` (775 files) — its application code is packed inside | no — no source |
| `Source code (zip)` | the repository's tag: 54 files, `docs/`, `config/`, `.github/` — no `Backend/` | no — no app source |
| `.deb`, `.apk`, `latest.json` | other platforms / updater metadata | no |

So the current 4.14.1 source-layout copy cannot be replaced by 4.18.0 from
the release alone, and the tool says exactly that (exit 2) instead of
installing something that would not run:

```
release v4.18.0 carries no copy of Dannify this extension can run.
  package-4.18.0.zip: a frozen install (executable + runtime), whose
    application code is packed inside it…
  source-of-v4.18.0.zip: no Backend/ anywhere in it — this repository's
    tags carry the docs, not the app's source
```

That is a decision upstream holds, not something to work around: the
frozen payload would have to be unpacked and decompiled, which is fragile,
legally the wrong shape, and would break again on every release.

### The options to weigh

| Option | What it means | Effort | Risk |
| --- | --- | --- | --- |
| **A. Ask upstream for a source-layout artifact** (a `source-<version>.zip` with `Backend/` + `frontend/dist/`, or a published source tag) | nothing changes here; the tool takes it as `--from` today | a conversation | none — the tool is ready for it |
| **B. Vendor a source tree per release** | you already have 4.14.1; keep obtaining each version's source-layout tree the same way you obtained that one, then `--from` it | whatever that acquisition costs | what this tool now covers (verification, staging, smoke, rollback) |
| **C. Drop the in-process bridge for a frozen install** | run `Dannify.exe` and proxy it | high | loses sign-in handover, downloads/likes routes, the update stub and the live download socket — the sign-in especially has no equivalent, and every upstream release could break the proxy |

**A is the cheap one and should be tried first**: the integration needs
nothing else from upstream — the bridge, the routes, the contract check and
the updater are all already in place and version-independent.

## 7. Checklist for adopting a new version

The tool does 1–5 automatically; 6–8 are what to look at in its output.

1. it is the source layout (`Backend/main.py`, `Backend/requirements.txt`,
   `frontend/dist/index.html`);
2. every file matches a signed package list when one is offered;
3. the venv matches the new requirements (installed and stamped);
4. `--smoke` passes: 13 contract names, 3 routes;
5. a rollback copy is parked as `dannify-prev`;
6. the contract report for the new version — `missing: []` — before
   trusting sign-in, downloads and likes;
7. the diff of `Backend/requirements.txt` (Python version, new deps);
8. one sign-in, one download, one like-import, by hand, once.
