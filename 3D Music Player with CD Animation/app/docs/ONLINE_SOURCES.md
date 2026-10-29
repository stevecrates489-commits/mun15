# Online sources

How the player finds music that is not on the disk, and why it is built the
way it is.

---

## The problem

One source is one point of failure. Jamendo goes down, the radio directory
is slow, the network wobbles at the wrong moment — and with a single
adapter, the music stops.

So the player has several, and a **registry** that knows which of them to
ask, remembers which one worked, and stands the others down when they say
no.

---

## The rules

These are the rules the whole thing is built around. They are not
decoration; each one exists because breaking it breaks something.

### 1. The player never receives a remote URL

A URL is a liability. It expires, it leaks, it invites the player to cache
it, and it puts the provider's address in a place the user did not ask for
it to be.

So the flow is:

```text
  the registry                  the source                  the player
  ──────────                    ────────                  ────────
  open_stream("jamendo:123")
      │
      ├─ asks jamendo ────────▶  "here are the bytes"
      │                         (the address is inside a
      │                          closure, and stays there)
      ◀────────────────────────
      │
      ├─ parks the handle under an opaque id
      │
      └─ "http://127.0.0.1:54321/stream/9f2c…"  ─────────▶  <audio src=…>
```

The player gets a **loopback URL**. The id is a hash of a per-run secret,
so it means nothing outside this machine and changes every run. The
provider's real address is inside a closure in the Rust process and never
comes out.

**Nothing remote is written to disk either.** The state file
(`%APPDATA%\MUN15H\sources.json`) holds which source worked last, when each
quarantine expires, and the strike counts. That is all.

### 2. Nothing is handed over before a byte has arrived

A source that *describes* something it cannot deliver is not a source. So
the registry reads the first byte before it believes the source:

```rust
// the handshake
let response = client.get(&audio).send().await?;
let mut bytes = response.bytes_stream();
let first = bytes.next().await;   // ← nothing is handed over before this
```

If the fetch fails, the player never hears about it. There is no state
where the player is holding a URL that does not work.

### 3. A refusal is not a wobble

A provider that answers **401, 403, 429**, or says "sign in", or refuses
explicitly, is telling the truth about itself. Retrying immediately will
not help. So:

| What happened | What the registry does |
|---|---|
| 401 / 403 / 429 / explicit refusal | counts a **strike**; at the threshold, quarantines the source |
| DRM / protected content | same as a refusal |
| timeout / connection error / 5xx | **nothing** — the network was having a bad minute, and the source did not do anything wrong |
| 404 / not found | nothing — the content is not there, the source is fine |

A source that keeps refusing is stood down for longer each time it comes
back and fails again: 1× → 2× → 4× … up to an hour.

### 4. What worked, is remembered

The last source that delivered a track for a provider is tried **first**
next time. The rest follow in registration order.

This is persisted, so a restart does not start from scratch.

---

## The shape of the code

```text
src-tauri/src/sources/
  types.rs        the Source trait, Metadata, SourceError, StreamHandle
  registry.rs     the registry: selection, quarantine, backoff, persistence, metrics
  server.rs       the local axum server that serves the bytes
  commands.rs     the Tauri commands
  mod.rs          the shared state, the settings, the wiring
  adapters/
    jamendo.rs    open-licensed, whole tracks, a direct address
    archive.rs    the Internet Archive: open-licensed and public domain
    radio.rs      internet radio: live streams, no end, no length
    spotify.rs    a catalogue with no audio behind it
    youtube.rs    opt-in, behind a flag, because of the policies
  integration_tests.rs   the whole path, over a real socket
```

### The `Source` trait

```rust
#[async_trait::async_trait]
pub trait Source: Send + Sync {
    fn id(&self) -> &str;
    fn is_configured(&self) -> bool { true }
    fn not_configured_reason(&self) -> Option<String> { None }
    fn supports(&self, content: &ContentId) -> bool;

    async fn search(&self, query: &str, limit: u32)
        -> Result<Vec<(Metadata, ContentId)>, SourceError>;

    async fn health_check(&self) -> HealthResult;

    async fn open_stream(&self, content: &ContentId, cancellation: &CancellationToken)
        -> Result<StreamHandle, SourceError>;
}
```

A `StreamHandle` is **not** a reader — it is a way to open the stream
again. The player seeks by making a *new* request with a `Range` header, so
a stream that cannot be re-opened cannot be seeked in.

```rust
pub type StreamOpener = Arc<
    dyn Fn(Option<(u64, Option<u64>)>)      // the byte range, if any
         -> Pin<Box<dyn Future<Output = Result<OpenedStream, SourceError>> + Send>>
         + Send + Sync,
>;
```

---

## The sources

| Source | Plays? | Licence | Notes |
|---|---|---|---|
| **Jamendo** | ✅ whole tracks | Creative Commons, **per track** | The best one. A free client id from devportal.jamendo.com. The licence is per track and not always the permissive kind — the panel shows it. |
| **Internet Archive** | ✅ whole tracks | Public domain / CC, **per item** | Thousands of freely-licensed recordings. A different catalogue from Jamendo, so it covers for it. |
| **Internet radio** | ✅ live | live streams | No length, no end, so no seek bar. The Radio Browser API, no key needed. |
| **Spotify** | ❌ | proprietary | **The API does not hand out audio.** It is a catalogue: search, artwork, and links. See below. |
| **YouTube** | ✅ | see below | **Off by default.** Opt-in, with a warning. |

### Spotify, honestly

Spotify's Web API does not give out playable audio. Not for full tracks, and
not for previews — the `preview_url` field is deprecated and usually null.
Their own words:

> "Spotify Web API enables the creation of applications that can interact
> with Spotify's streaming service, such as retrieving content metadata,
> creating and managing playlists, or controlling playback."

Metadata and playback *control*. Not bytes.

Playing Spotify audio in a third-party desktop app is possible only through
the **Web Playback SDK**, which needs the user's own Premium subscription,
is restricted to non-commercial use, and still does not yield a raw
address — it renders the audio itself. That is a separate opt-in and a
separate piece of work.

So the Spotify adapter here **searches** properly and says plainly that it
cannot play. A result that cannot be played says so on the result itself,
before the user presses play.

### YouTube, honestly

The YouTube adapter is **opt-in and off by default**, because it works
through YouTube's undocumented API. Their Developer Policies say:

> III.D.7 — "You must not use undocumented APIs without express permission."

> III.E.1 — you must not "download, import, backup, cache, or store copies
> of YouTube audiovisual content without YouTube's prior written approval."

`yt-dlp` does exactly what III.D.7 describes. Using it is therefore the
**user's** decision, made with the trade-off in front of them, and the
switch is off until they say otherwise.

What it does and does not do:

- It talks to YouTube's servers, over the user's own connection.
- It **does not** touch the user's browser cookies unless the user
  explicitly points it at a browser profile — and even then, `yt-dlp` reads
  them, not this app.
- It **does not** circumvent DRM. A protected video is simply not playable,
  and the adapter says so.
- It needs `yt-dlp` on the `PATH` (or wherever the settings say). The
  binary is **not** bundled and **not** downloaded automatically.

`yt-dlp` itself is released into the public domain (the Unlicense).

---

## The settings

In the app: the globe button → the gear.

| Setting | Default | What it does |
|---|---|---|
| `jamendoClientId` | none | A free client id from devportal.jamendo.com. Without it, Jamendo is not searched. |
| `allowYoutube` | **false** | Turns the YouTube adapter on. Off until you say so. |
| `ytDlpPath` | none → the `PATH` | Where `yt-dlp` lives. |
| `ytDlpArgs` | none | Extra arguments, e.g. `--cookies-from-browser chrome`. **The app never adds any by itself.** |

Changing the settings rebuilds the source list. The **memory** is kept —
which source worked, who is quarantined — because that is the expensive
part to learn.

---

## The commands

| Command | What it does |
|---|---|
| `sources_status` | every source's state, the settings, the loopback base URL |
| `sources_set_settings` | change the settings and rebuild |
| `sources_search` | search one provider |
| `sources_search_all` | search every provider that can search |
| `sources_play` | open a stream, return the **local** URL |
| `sources_cancel` | stop whatever is opening |
| `sources_health_check` | check every source's health |

---

## How the player uses it

An online track is stored as a **reference**, not a blob and not an address:

```ts
interface Track {
  …
  remote?: { contentId: string; provider: string }
}
```

When it is played, the engine asks the registry to open it and gets a local
URL. The address is not stored, so the track survives a restart — the
reference is enough to open it again.

The playlist stores the reference in IndexedDB next to the local files.

---

## Testing

```bash
cd src-tauri
cargo test --no-default-features --lib
```

22 tests. They cover the acceptance criteria:

| Test | What it proves |
|---|---|
| `falls_back_to_the_next_source` | a refusal moves on to the next source |
| `remembers_the_source_that_worked` | the one that worked is tried first next time |
| `quarantines_a_source_that_keeps_refusing` | three refusals and the source is stood down |
| `the_backoff_grows_each_time` | the stand-down is longer each time |
| `a_transient_failure_does_not_quarantine` | a timeout is not held against the source |
| `a_cancelled_open_stops_at_once` | cancelling stops the open |
| `an_unconfigured_source_is_never_asked` | a source with no key is not asked to work |
| `last_known_good_survives_a_restart` | the memory is on disk |
| `no_url_is_ever_written_to_disk` | the state file has no URL in it |
| `the_player_never_receives_a_url` | the handle carries no address |
| `the_metrics_count_what_happened` | attempts, successes and failures are counted |
| `the_whole_path_works` | **the whole thing, over a real socket** — the bytes come back, a seek answers 206 with the right `Content-Range`, a range past the end is refused honestly |

---

## Things that will bite

Things that were learned the hard way, so they do not have to be learned
again:

- **axum 0.8 spells a path parameter `{id}`, not `:id`.** The old spelling
  panics when the router is built — the server starts and then dies on the
  first request.
- **The total length and the sent length are different.** A ranged response
  carries the range's length, but the `Content-Range` header needs the
  whole length. Using the range's length as the total makes the
  `Content-Length` wrong, and the browser throws the connection away.
- **A source must report the length of what it actually yields**, not the
  length of the whole thing.
- **A `watch::Sender::send` does not store the value when there are no
  receivers.** Cancelling before anything is listening has to use
  `send_replace`.
- **`std::sync::Mutex` is not reentrant.** Asking for a value that needs the
  same lock you are already holding deadlocks.
- **`tokio::sync::Mutex::blocking_lock` panics inside a runtime.** Use a
  plain mutex when the critical section is a map insert.
