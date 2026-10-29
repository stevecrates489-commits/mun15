# The online section

What the online section is, what it does, and how it is put together.

## What the player opens now: the extension

The globe button beside the playlist button opens **Dannify itself** — the
real app, running from the `dannify/` folder beside the player, in an
iframe pointed at `http://127.0.0.1:8765/`. The player only starts it
(`src-tauri/src/dannify.rs`) and gives it a window
(`app/src/features/dannify/DannifyWindow.tsx`).

That is deliberate:

- **It is complete.** Search with all four facets, artists, albums,
  playlists, lyrics, stats, downloads — its own code, not a re-implementation
  that can fall behind.
- **Nothing mixes.** Dannify has its own player, queue and library, and its
  data lives in `%APPDATA%\MUN15H\dannify-data`. No track of its goes into
  this player's playlist, and none of this player's files go into it.
- **It updates by itself.** Replacing the `dannify/` folder replaces the
  extension: no rebuild, no code change here. See `dannify/README.md`.

Closing the window unmounts the frame, which stops its player. One thing
plays at a time.

## Signing in

Dannify's own sign-in is a desktop-shell feature: its interface asks the
pywebview bridge for it, and in a browser there is no bridge, so the button
answers *"Signing in needs the desktop app."* That is not something the
player can talk it out of, and it is not something to patch into Dannify
either — the next version would drop the patch.

So the extension runs Dannify's own sign-in window instead, and only the
session is handed to Dannify's own `account.sign_in`:

```text
  chrome bar  ──SIGN IN──▶  dannify_sign_in (Rust)
                                   │  POST /api/player/from-browser
                                   ▼
                     player_bridge.py ──▶ window_signin.py
                                   │   Dannify's own _LoginWindow:
                                   │   WebView2, its own profile, Google
                                   ▼
                        account.sign_in()   Dannify's own
```

| Piece | Where | What it does |
|---|---|---|
| the button | `app/src/features/dannify/DannifyWindow.tsx` | sits at the left of the chrome bar, beside the name |
| the command | `app/src-tauri/src/dannify.rs` | asks the extension to sign in, and waits; opens its own WebView2 window only if the extension cannot open one |
| the window | `dannify/window_signin.py` | Dannify's own `_LoginWindow` — the very window the standalone Dannify app opens — run from the extension's process |
| the route | `dannify/player_bridge.py` | starts Dannify's app and adds `POST`/`GET /api/player/session` and `POST /api/player/from-browser` in front of it |
| the fallback | `dannify/browser_signin.py` | a real browser over its DevTools connection, when no window can start here |

Why that window and not the cookies a browser already has: the browser's
session is inside the window regardless, and copying it out is the part that
does not work — those cookies are sealed with app-bound encryption, so
nothing outside the browser that wrote them can read them. Dannify's own
window signs in once and hands over the jar from its own cookie manager,
which is what the rest of Dannify already works against.

Nothing of Dannify's is modified: the bridge only calls `account.sign_in`,
which Dannify already exposes, and `explorer.clear_cache`. Replace the
`dannify/` folder with a newer Dannify and the sign-in keeps working.

## Knowing what you are running

The player reaches into Dannify's own code in a handful of places —
`Backend/main.py` → `build_app`, `dannify.account`, `dannify.vault.read_index`
and friends. Those names are somebody else's and can move in any release,
so `player_bridge.py` probes every one of them once at boot and publishes
the answer at `GET /api/player/version`:

```json
{"ok": true, "contract": 1, "dannify": "4.14.1", "checked": 13, "missing": []}
```

Rust reads it (`dannify_version`) and the chrome bar shows the extension's
version beside it — or names what an update moved, instead of leaving a
dead button to be discovered later. The same probe runs by hand with
`player_bridge.py --smoke`, which is what an update runs before it swaps
anything.

## Updating it

`python tools/update-dannify.py --from <folder-or-zip>` (or `--release
v4.18.0`, or `--dry-run`): stage, verify signatures, rebuild the venv,
`--smoke`, swap, keep the old copy as `dannify-prev` to roll back to. The
library in `%APPDATA%\MUN15H\dannify-data` survives every update. What an
update must satisfy — and what GitHub releases currently do **not** ship —
is written down in [INTEGRATION_CONTRACT.md](INTEGRATION_CONTRACT.md).

Once signed in, the frame reloads and Dannify is properly signed in — its
liked songs, its own playlists, YouTube Music's home feed, and downloads
that use the session instead of hoping YouTube does not ask for a bot check.
Downloading needs nothing else: its downloader already reads that session
(`account.ydl_cookiefile`).

## The React port (kept, no longer opened)

The rest of this file describes the earlier React re-creation of Dannify's
shell (`app/src/features/sources/`). It is still in the tree and still
builds, but the button no longer opens it: it was never complete, and the
playback path added online tracks to this player's own playlist, which is
exactly the mixing the extension avoids. Treat it as reference.

The interface is a port of **Dannify's** (v4.12.0) to React: the same
shell, the same design tokens, the same components. Dannify itself is Vue;
this app is React, so the shell was rebuilt rather than copied. The licence
notice is in THIRD-PARTY-NOTICES.md.

**The design tokens are Dannify's own**, and they were measured for
contrast rather than picked by eye:

| Token | Value | What it is |
|---|---|---|
| `--c-app` | `rgb(8 8 10)` | the window chrome: title bar, player bar |
| `--c-panel` | `rgb(18 18 21)` | the sidebar, the main panel, the side panel |
| `--c-raised` | `rgb(27 27 32)` | cards and inputs inside a panel |
| `--c-elev` | `rgb(37 37 43)` | menus, dialogs, toasts |
| `--c-fg` | `rgb(240 240 243)` | the text |
| `--c-accent` | `rgb(26 208 92)` | the green |

The shell is a grid: a 44px title bar, a 248px sidebar, the music, a 300px
side panel, and an 84px player bar.

---

## What it is

A complete music app, inside the app: a home feed of shelves, search across
four facets, the account's library, artists, albums, playlists, moods, a
download queue, radio, and a player bar with a queue panel.

Everything is fetched from **YouTube Music's own API**, with the user's own
session on it. The address of the audio never reaches the app — only a
local handle does.

---

## The screens

| Screen | What it shows | Where it comes from |
|---|---|---|
| **HOME** | Shelves: the home feed, mixes, recently added | `browse_home` |
| **SEARCH** | Songs, artists, albums and playlists, plus a type-ahead | `browse_search`, `browse_suggest` |
| **LIBRARY** | Liked songs and the account's playlists | `browse_liked`, `browse_library_playlists` |
| **ARTISTS** | The artists the account follows | `browse_subscriptions` |
| **ALBUMS** | The moods and genres | `browse_moods` |
| **DOWNLOADS** | The download queue, with live progress | `downloads_list` |
| **An artist** | Songs, albums, singles, subscriber count | `browse_artist` |
| **An album** | The tracks, in order, with their numbers | `browse_album` |
| **A playlist** | The tracks, with the next page available | `browse_playlist` |

The side panel has the **queue** (the app's own playlist), a pointer to the
app's **lyrics** panel, and a note about where the bytes come from.

---

## The three things a signed-in account can change

| Action | The call |
|---|---|
| Like / unlike a song | `browse_rate` → `like/like`, `like/removelike` |
| Follow / unfollow an artist | `browse_follow` → `browse/artist_menu` |
| Add songs to a playlist | `browse_add_to_playlist` → `browse/edit_playlist` |

---

## The browse layer

`src-tauri/src/sources/browse.rs` — every call YouTube Music can be asked
about. They are `browse` and `next` calls with the session's signature on
them.

The browse id is what tells YouTube what to open:

| Browse id | What it opens |
|---|---|
| `FEmusic_home` | The home feed |
| `FEmusic_liked_videos` | Liked songs |
| `FEmusic_liked_playlists` | The account's playlists |
| `FEmusic_library_corpus_artists` | The artists the account follows |
| `FEmusic_history` | The account's history |
| `FEmusic_moods` | The moods and genres |
| `UC…` | An artist |
| `MPREb…` | An album |
| `VL…` / `PL…` | A playlist |

The search facets each carry their own encoded filter:

| Facet | The parameter |
|---|---|
| songs | `EgWKAQIIAWoMEA4QChADEAQQCRAF` |
| videos | `EgWKAQIQAWoMEA4QChADEAQQCRAF` |
| albums | `EgWKAQIYAWoMEA4QChADEAQQCRAF` |
| artists | `EgWKAQIgAWoMEA4QChADEAQQCRAF` |
| community playlists | `EgeKAQQoAEABagwQDhAKEAMQBBAJEAU%3D` |

### Cards are not tracks

This is the distinction that matters most, and it is the one that made the
first version of this look broken.

- A **track** has a video id. It plays.
- A **card** — an album, an artist, a playlist — has a *browse* id. It is
  **opened**, which then lists what is inside it.

The browse id says which: `UC` is an artist, `MPREb` an album, `VL`/`PL` a
playlist. Treating a card as a track is what puts a row in the list that
then fails to play, and the parser keeps them apart.

---

## The streams

Two ways to get one, and the user picks.

| Mode | What it does | Speed |
|---|---|---|
| **fast** (the default) | The direct resolver first, then the extractor | Hundreds of ms, usually |
| **fastOnly** | Only the direct resolver | Fastest; refuses some tracks |
| **extractor** | Only `yt-dlp` | Seconds; gets the awkward ones |

### The direct resolver

`src-tauri/src/sources/yt_clients.rs`

`yt-dlp` is a general-purpose extractor. For a YouTube **web** client it
has to download the ~2 MB player script and run YouTube's obfuscated
signature and `n` challenges through a JavaScript engine — seconds on every
cold track, and it fails often enough to be noticed.

But YouTube only ciphers the *web* clients. A few **app** clients get
plain `url` fields in their `/player` answer: no signature, no `n`
transform, no token. One JSON POST and the address is ready.

The client identities live in a table, and they are the load-bearing part:

| Key | clientName | clientId | What it is |
|---|---|---|---|
| `VISIONOS` | VISIONOS | 101 | Apple Vision Pro. Wins almost every time. |
| `ANDROID_VR_1_43_32` | ANDROID_VR | 28 | The Oculus build. |
| `ANDROID_VR_1_65_10` | ANDROID_VR | 28 | The same, a newer build. |

The two Android builds differ by version **on purpose**: one of them is
usually healthy when the other has been throttled.

The header that matters is `x-youtube-client-name`, and it carries the
**numeric** id, not the name. That is the single easiest thing to get
wrong, and when it is wrong the answer is a 400 and nothing else.

The request is validated with a `HEAD` before the address is handed over:
not every client that answers `OK` hands out an address `googlevideo` will
honour, and one `HEAD` turns that into a silent fallback instead of a track
that fails in the user's face.

---

## The downloads

A download is a job: queued, running, done or failed, and the user can
watch it happen. The queue is polled by the panel, so the progress is
real — the bytes come from the upstream.

Files go to `%APPDATA%\MUN15H\downloads`, in a folder per artist when
that setting is on. The name is made from the title and the artist, with
the characters that are not allowed in a file name taken out.

`yt-dlp` does the fetching, with the session's cookies handed to it as a
file, so it fetches exactly what the account can fetch.

---

## The no-URL rule

Still the same, and still the point:

- The player gets `http://127.0.0.1:<port>/stream/<opaque-id>`.
- The id is a hash of a per-run secret. It means nothing outside this
  machine and it changes every run.
- The provider's address is inside a closure in the Rust process and never
  comes out.
- **Nothing remote is written to disk.** The remembered state is which
  source worked and when a quarantine expires.

---

## The sign-in

Two launches, because a browser with a debugging port cannot sign in:

1. **The sign-in** — an ordinary browser, the app's own profile, no
   debugging flags. Google sees a normal browser and lets you in.
2. **The cookie read** — the same profile again, headless, *with* the
   debugging interface. By then the sign-in has happened, so the flag no
   longer matters.

See [YOUTUBE_PIPELINE.md](YOUTUBE_PIPELINE.md) for the whole flow, the
`SAPISIDHASH` signing, and the account identity headers.

---

## Testing

```bash
cd src-tauri
cargo test --no-default-features --lib
```

72 tests. The ones worth knowing about:

| Test | What it proves |
|---|---|
| `a_card_is_told_apart_by_its_browse_id` | `UC` is an artist, `MPREb` an album, `PL`/`VL` a playlist |
| `a_song_comes_out_of_a_list_row` | the title is in the first flex column, the duration and the explicit badge are read |
| `a_song_without_a_video_id_is_not_a_song` | a card never becomes a track |
| `the_signature_is_the_documented_shape` | the `SAPISIDHASH` is `sha1(timestamp + " " + seed + " " + origin)` |
| `the_header_carries_the_numeric_client_id` | `x-youtube-client-name` is `101`, not `VISIONOS` |
| `aac_in_mp4_wins_over_opus` | the format picker ranks the formats the way it should |
| `a_dubbed_version_is_avoided` | nobody gets the auto-dubbed track by accident |
| `a_file_name_has_nothing_forbidden_in_it` | a download's name is a legal file name |
| `the_whole_path_works` | the whole thing over a real socket |

---

## Things that will bite

- **A browser started with `--remote-debugging-port` cannot sign in.**
  Google sees `navigator.webdriver` and refuses. The sign-in launch must
  have no debugging flags at all.
- **`x-youtube-client-name` is the numeric id.** The name goes in the body.
- **A card is not a track.** See above.
- **The title is in the first flex column**, not in a `title` field. The
  `title` field only exists on the two-row cards.
- **`std::sync::Mutex` is not reentrant.**
- **`tokio::sync::Mutex::blocking_lock` panics inside a runtime.**
- **`tokio::spawn` before a runtime exists panics.** Use
  `tauri::async_runtime::spawn` for anything started while the app is
  still being built.
