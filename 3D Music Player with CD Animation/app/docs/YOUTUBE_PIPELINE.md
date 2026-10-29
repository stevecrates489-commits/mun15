# The YouTube Music pipeline, and the Spotify truth

How the app signs in to YouTube Music, gets its metadata, and fetches its
audio — and why Spotify is a different story.

---

# Part one: YouTube Music

## The whole flow

```text
  YOU                        THE APP                        YOUTUBE
  ───                        ──────                        ───────

  press "sign in"
                            ┌──────────────────┐
                            │ start a browser  │  (NO debugging flags)
                            │ with a profile   │
                            │ of its OWN       │
                            └────────┬─────────┘
                                     │
  sign in to YouTube Music ◀─────────┘  (the normal page, your password)
                                     │
  close the browser window ┌───────▼─────────┐
                            │ ask the browser  │      Storage.getCookies
                            │ for its cookies  │ ─────────────────────▶
                                     │                   (CDP, the browser's
                            ┌────────▼─────────┐            own interface)
                            │ build a session  │
                            │ sign the requests│
                            └────────┬─────────┘
                                     │
  search / library / play  ◀─────────┘  POST /youtubei/v1/...
```

## Step 1: the browser, with a profile of its own

`src-tauri/src/sources/auth/browser.rs`

The user signs in somewhere. The obvious place is the browser they already
use, and that is a bad idea for two reasons:

1. **Chrome's App-Bound Encryption** ties the cookies in your everyday
   profile to *Chrome itself*. Another program — including this one —
   cannot decrypt them. That is deliberate, and it is why reading a normal
   profile's cookies does not work any more.
2. Even where it works, taking the cookies out of the profile the user
   browses with is a bigger reach than it needs to be.

So the app gives the browser a **profile of its own**, in its own state
folder:

```text
%APPDATA%\MUN15H\yt-signin-profile\
```

and starts it with:

```text
--user-data-dir=<that folder>
--no-first-run --no-default-browser-check
--disable-session-crashed-bubble
```

### The one flag that must NOT be there

```text
--remote-debugging-port=0
```

**A browser started with a debugging port sets `navigator.webdriver` to
`true`, and Google checks that on the sign-in page.** It answers:

```text
accounts.google.com/v3/signin/rejected
```

with *"This browser or app may not be secure. Try using a different
browser."*

The reason is sensible: a debugging-enabled browser is one an automated
tool could drive, and letting it sign in would let that tool take the
session. Every Chromium browser does this, so Brave, Chrome and Edge all
fail identically — it is not about which browser, and it is not about
embedded webviews.

**So the sign-in happens in an ordinary browser, with no debugging flags
at all.** The cookies are read afterwards, by a second launch.

The browser that gets picked is the first of **Brave, Chrome, Edge or
Vivaldi** that is on the machine — Brave first, because it blocks the
trackers and the ads that a sign-in page otherwise collects. The user can
choose a different one in the sources' settings, and a browser that is
**not installed is not silently swapped for another**: the app says which
one it looked for and which one it found.

The page is given to the browser **on the command line**, so the right
thing is on screen immediately rather than a blank tab waiting for a
second request that might fail.

Two details that are easy to get wrong and were:

- **The `DevToolsActivePort` file is deleted before the browser starts.**
  The profile persists between runs, so the last run's file is still there
  with a port that nothing is listening on — reading it gives a dead port
  and a "could not reach the browser" error. The wait also checks that
  something is actually listening before it believes the port.
- **Only the browser the app started is closed afterwards**, by process
  id. Killing by image name would close the user's own browser, with
  their own tabs in it.

## Step 2: the cookies — a second, headless launch

`src-tauri/src/sources/auth/cdp.rs`

The sign-in browser has to be **closed** before the cookies can be read:
it holds the profile locked. The user closes the window and presses
*"I've closed it"*.

Then the app opens the **same profile** again, this time headless and
*with* the debugging interface on:

```text
--headless=new --remote-debugging-port=0 --remote-debugging-address=127.0.0.1
```

By now the sign-in has already happened, so the debugging flag no longer
matters to Google. The app asks the browser, over the **Chrome DevTools
Protocol**:

```text
Storage.getCookies        (at the browser level, so every site)
```

This is the browser's **own supported interface** for the question. No
database is opened, no key is decrypted, no encryption is undone, and
nothing is scraped out of a locked file. The browser is asked and it
answers.

The CDP client is a small WebSocket implementation
(`tokio-tungstenite`): it sends a command, and waits for the answer with
the matching id, stepping over the events that arrive in between.

The cookies that come back are filtered to `youtube.com` and `google.com`
— a **suffix** check, so `music.youtube.com` and `.youtube.com` match but
`notyoutube.com` does not.

## Step 3: the session

`src-tauri/src/sources/auth/session.rs`

A raw cookie is **not enough**. Google expects a second, signed header:

```text
Authorization: SAPISIDHASH <timestamp>_<sha1(timestamp + " " + SAPISID + " " + origin)>
```

Without it the request is anonymous: the library is empty, the playlists
are missing, and the player refuses to hand over the streams.

The scheme follows the cookie that is present:

| Cookie | Scheme |
|---|---|
| `SAPISID` | `SAPISIDHASH` |
| `__Secure-1PSID` | `SAPISID1PHASH` |
| `__Secure-3PSID` | `SAPISID3PHASH` |

**The origin matters.** A signature made for `music.youtube.com` is not
valid for `www.youtube.com`, so the origin being asked has to be the one
that was signed.

### Which login

A browser can hold **ten** Google logins at once, and the one to use is
chosen with `X-Goog-AuthUser` — the index of the login in the jar. That
index is **not** the index of the account in a list, which is why the
session asks YouTube which logins are live rather than guessing.

The other identity header is `X-Goog-PageId`, which selects a **brand
channel** — a login can be the user, or one of their brand channels.
Sending the wrong one is worse than sending none.

## Step 4: the metadata — InnerTube

`src-tauri/src/sources/auth/innertube.rs`

The metadata comes from YouTube Music's own JSON API, not from scraping a
page. Every call is a `POST` to:

```text
https://music.youtube.com/youtubei/v1/<action>?prettyPrint=false
```

with a body carrying the client context:

```json
{
  "context": {
    "client": {
      "clientName": "WEB_REMIX",
      "clientVersion": "1.20250101.01.00",
      "hl": "en",
      "gl": "US"
    },
    "user": {}
  }
}
```

Note `user: {}` — the **account is chosen by the header, never by the
body**. Putting it in the body is a common mistake.

The actions used:

| Action | What it is for |
|---|---|
| `search` | finding music |
| `browse` | the home page, an album, an artist, a playlist, the library |
| `next` | what comes after a video: its title, its channel, its like state |
| `player` | the streams themselves — the cipher and the token live here |
| `account/accounts_list` | which logins are live in the jar |
| `account/account_info` | what the account is, and whether it is Premium |

The library sections:

```text
FEmusic_history             HISTORY
FEmusic_liked_videos        LIKED SONGS
FEmusic_liked_albums        ALBUMS
FEmusic_liked_artists       ARTISTS
FEmusic_liked_playlists     PLAYLISTS
FEmusic_mixed_for_you       FOR YOU
```

### Walking the answers

The API moves its shapes around, so the response is walked **by shape
rather than by path**: the code looks for
`musicResponsiveListItemRenderer` wherever it is, and reads the video id
out of whichever of the four places it might be. A field that has moved
should cost a title, not a crash.

## Step 5: the streams

The `player` request is the hard one. It needs:

- the **cipher** — the URL in the answer is signed, and the signature has
  to be computed by running YouTube's own player script, and
- a **PO token** — a BotGuard token that the web clients need since
  August 2024, and without which the streams answer `403`.

That is a lot of machinery to maintain, and it is machinery `yt-dlp`
already maintains. So the **streams come from `yt-dlp`** and the
**metadata comes from Rust**:

| Half | How |
|---|---|
| Metadata — search, library, playlists | The InnerTube API, called directly from Rust, signed with the session. No external tool. |
| Streams — the actual audio | `yt-dlp`, which solves the cipher and the token. |
| Downloads | `yt-dlp`, handed the session's cookies as a file. |

`yt-dlp` is released into the public domain (the Unlicense) and is the
reference implementation of the extraction.

## Step 6: the downloads

`youtube_download` runs `yt-dlp` with:

```text
--extract-audio --audio-format m4a
--cookies <the session's cookies, as a cookies.txt>
```

and writes the file into the app's own `downloads` folder.

The cookies are handed over as a **file** rather than as a string,
because that is the format `yt-dlp` reads, and because it means the
user can also point `yt-dlp` at the sign-in profile directly:

```text
yt-dlp --cookies-from-browser chrome:"%APPDATA%\MUN15H\yt-signin-profile"
```

## What the app does NOT do

- **It does not circumvent DRM.** A protected video is simply not
  playable, and the adapter says so (`SourceError::Protected`).
- **It does not touch the user's everyday browser profile.** The sign-in
  happens in a profile the app makes, and the cookies are read back
  through the browser's own DevTools Protocol.
- **It does not type the user's password.** The browser does, on
  YouTube's own page.
- **It does not hand the player a URL.** The player gets a loopback URL;
  the provider's address stays inside a closure in Rust.

## The legal note

This adapter speaks YouTube's **undocumented** API, and their Developer
Policies say:

> III.D.7 — "You must not use undocumented APIs without express
> permission."

> III.E.1 — you must not "download, import, backup, cache, or store copies
> of YouTube audiovisual content without YouTube's prior written
> approval."

So it is **off by default**, and the user turns it on with the trade-off
in front of them. The switch is in the sources' settings, next to the
warning, and it is not enabled by anything else.

---

# Part two: Spotify

## Spotify cannot be done with YouTube's cookies

They are different services with different accounts. A Google cookie
means nothing to Spotify, and no amount of cleverness makes it mean
something.

So Spotify gets its own sign-in, and it is the one Spotify designed:
**OAuth 2.0, Authorization Code, with PKCE**.

## The flow

1. The app makes a **code verifier** (32 random bytes, base64url) and its
   **challenge** (the base64url of the SHA-256 of the verifier).
2. The system browser opens on Spotify's authorize page, with the
   challenge, a random `state`, and the redirect
   `http://127.0.0.1:<port>/callback`.
3. The user signs in and approves.
4. Spotify redirects to that address with a code. The app is already
   listening there.
5. The app exchanges the code for an access token and a refresh token,
   using the verifier.

**No client secret is involved**, and none is needed: PKCE exists so that
a public client — which is what a desktop app is — can do this safely.

The redirect URI in the token exchange must **exactly** match the one in
the authorize request. That is why the sign-in keeps it.

The PKCE implementation is checked against the RFC 7636 example vector:

```text
verifier:  dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk
challenge: E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM
```

## What Spotify's API gives, and what it does not

It gives **metadata**: search, playlists, the library, the player's
state. It does **not** give audio addresses — the `preview_url` field is
deprecated and usually empty, and no endpoint returns a playable file.

Their own words:

> "Spotify Web API enables the creation of applications that can interact
> with Spotify's streaming service, such as retrieving content metadata,
> creating and managing playlists, or controlling playback."

Metadata and playback *control*. Not bytes.

## Playing Spotify audio inside a third-party app

Only through the **Web Playback SDK**, which:

- requires the user to have **Premium**,
- is restricted to **non-commercial** use,
- and renders the audio itself, so it does **not** go through this app's
  audio engine — it cannot be analysed by the visualiser, and it does not
  appear in the local library.

So the Spotify adapter here does the honest half: it signs in, it
searches, and it lists. A result that cannot be played says so on the
result itself, before the user presses play.

If the Web Playback SDK path is wanted, it is a **separate piece of work**:
a hidden webview that loads `sdk.scdn.co/spotify-player.js`, the
`getOAuthToken` callback wired to the tokens above, and a bridge from the
SDK's player events back into the app. It is a different player, not the
app's player, and it should be presented as such.

## One thing the user must do

Spotify does not hand out client ids to anyone who asks. You make an app
at **developer.spotify.com** and put its id in the sources' settings.
Without one, the Spotify adapter reports itself as unconfigured and says
why.

---

# Part three: the source registry

The rest of the system is provider-agnostic, and is described in
[ONLINE_SOURCES.md](ONLINE_SOURCES.md). The short version:

- the player **never receives a remote URL** — it gets a loopback URL
  whose id means nothing outside this machine;
- **nothing is handed over before a byte has arrived** — a source that
  describes something it cannot deliver is not believed;
- **a refusal is not a wobble** — a provider that says no is stood down
  for longer each time it comes back and fails again, while a timeout is
  held against nobody;
- **what worked is remembered**, across restarts.

# Testing

```bash
cd src-tauri
cargo test --no-default-features --lib
```

48 tests. The ones worth knowing about:

| Test | What it proves |
|---|---|
| `the_signature_is_the_documented_shape` | the SAPISIDHASH is `sha1(timestamp + " " + seed + " " + origin)` |
| `the_signature_depends_on_the_origin` | two origins give two different signatures |
| `the_newer_cookie_picks_the_newer_scheme` | `__Secure-3PSID` gives `SAPISID3PHASH` |
| `the_challenge_is_the_hash_of_the_verifier` | the PKCE matches the RFC 7636 example exactly |
| `the_domain_check_is_a_suffix_check` | `notyoutube.com` is not `youtube.com` |
| `the_cookies_file_is_the_netscape_format` | the `cookies.txt` has the seven right fields |
| `a_search_result_is_walked_out` | a real InnerTube search answer is parsed |
| `a_playlist_item_is_walked_out` | a library answer is parsed |
| `the_premium_flag_is_found_wherever_it_is` | the Premium flag is found wherever YouTube puts it |
| `the_whole_path_works` | the whole thing over a real socket: bytes, a 206, a 416, a 404 |

# Things that will bite

Learned the hard way, so they do not have to be learned again:

- **axum 0.8 spells a path parameter `{id}`, not `:id`.** The old
  spelling panics when the router is built.
- **The total length and the sent length are different.** A ranged
  response carries the range's length, but `Content-Range` needs the
  whole length.
- **A source must report the length of what it actually yields.**
- **`watch::Sender::send` does not store the value when there are no
  receivers.** Cancelling before anything is listening has to use
  `send_replace`.
- **`std::sync::Mutex` is not reentrant.**
- **`tokio::sync::Mutex::blocking_lock` panics inside a runtime.**
- **`tokio::spawn` before a runtime exists panics.** Use
  `tauri::async_runtime::spawn` for anything started while the app is
  still being built.
- **The redirect URI in an OAuth token exchange must exactly match the
  one in the authorize request.**
