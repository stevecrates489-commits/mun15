# LyricsPanel — Component Specification

> **Status:** v1.0 · **Applies to:** MUN15H — MD Walkman player (`app/`) · **Host:** Tauri 2 + React 19 + Vite 7
>
> This is a **contract**, not a description. An agent rebuilding the UI must
> satisfy every line here. Anything not written here is not part of the
> contract and may be changed freely; anything written here is load-bearing
> and is checked by the harnesses in `.verify/`.
>
> The lyrics surface is **two components**, and both are specified here:
>
> | Part | Component | Role |
> | --- | --- | --- |
> | **A** | `LyricsPanel` | The lyrics themselves — the `<am-lyrics>` host. |
> | **B** | `LyricsSettingsPanel` | The control card: the provider chain, PIN/EDIT, size, brightness, offset, download. |

---

# PART A — `LyricsPanel`

## Purpose

Hosts the `<am-lyrics>` web component (a Lit + Shadow DOM element) and paints
the currently-playing song's lyrics over the wallpaper or the disc, with a
word-synced highlight, a click-to-seek gesture, and a "no lyrics" empty state.

---

## Props (Inputs)

```ts
interface Props {
  title: string
  artist: string
  duration: number
  live?: boolean
  playing: boolean
  getTime: () => number
  onSeek: (seconds: number) => void
  size: number
  brightness: number
  offset: number
  ttml?: string | null
  metal?: boolean
  apiRef: React.RefObject<LyricsApi | null>
}
```

| Prop | Type | Description |
| --- | --- | --- |
| `title` | `string` | Song title. Empty string ⇒ the panel renders nothing and does **not** build the element. |
| `artist` | `string` | Full artist credit. May be a multi-artist bill (`"A, B, C"`). The **first** name is used for a single fallback retry (see *Edge Cases*). |
| `duration` | `number` | **Seconds.** `0` (or less) means "length unknown". Must be `0` for radio — the radio has no length of its own. |
| `live` | `boolean` | Optional, default `false`. `true` ⇒ live radio. The playhead comes from the song clock, and the element must **not** be told it has no clock. |
| `playing` | `boolean` | Drives the playhead loop. `false` ⇒ one sync, no rAF loop. |
| `getTime` | `() => number` | Returns the **current playhead in seconds**. Sampled per frame. For a library track this is the engine's clock; for radio it is the song clock. Must be a stable reference. |
| `onSeek` | `(seconds: number) => void` | Called when the user clicks a lyric line, with that line's timestamp in **seconds**. |
| `size` | `number` | Base font size in px (`20` / `28` / `36` are the shipped sizes). Also derives the line spacing (`size * 0.55`). |
| `brightness` | `number` | `20`–`160`, percent. Applied as a CSS `brightness()` filter over the whole component so lyrics stay readable over bright artwork. `100` ⇒ no filter at all. |
| `offset` | `number` | **Seconds** added to the playhead to correct a mis-timed source. May be negative. **Not clamped** — a provider can be a minute out. |
| `ttml` | `string \| null` | Optional. A TTML string fed to the element's `ttml` property, which makes it render that string and skip **all** network requests. Used for a locally pinned lyric and for the radio's own lyrics. `null`/absent ⇒ the element fetches from its providers. |
| `metal` | `boolean` | Optional, default `false`. `true` ⇒ the metallic face (cool silver / nickel sweep). A **pinned** lyric wears it; an unpinned one is always plain white. Home owns that rule, this prop only picks the sheet. |
| `apiRef` | `React.RefObject<LyricsApi \| null>` | **Mandatory.** Filled with the imperative controls the settings panel and the editor drive. See the `LyricsApi` contract below. |

### The `LyricsApi` imperative surface

```ts
export interface LyricsApi {
  switchSource: () => boolean
  download: () => boolean
  source: () => string | null
  extractLrc: () => string
  extractTtml: () => string
  hasLyrics: () => boolean
  resumeScroll: () => void
  providerId: () => string | null
  forceProvider: (id: string) => Promise<{ ok: boolean; error?: string }>
}
```

Every method **must** be total: it may be called before the element exists, and
it must return a safe default rather than throw.

| Method | Contract |
| --- | --- |
| `switchSource()` | Clicks the component's own source-switch button. Returns `false` if the button is absent. |
| `download()` | Clicks the component's own download button. Returns `false` if absent. |
| `source()` | The label of the provider currently serving, e.g. `"lrc.red"`. `null` when unknown. |
| `extractLrc()` | The loaded lyrics as LRC. `''` on any failure — **never throws**. |
| `extractTtml()` | The loaded lyrics as TTML. `''` on any failure — **never throws**. |
| `hasLyrics()` | `true` only when a real singable line exists. See the trap below. |
| `resumeScroll()` | Pulls the active line back into view and re-arms autoscroll. |
| `providerId()` | The id of the provider currently serving. `null` when unknown. |
| `forceProvider(id)` | Asks **one** provider for this track and puts its answer on screen. Resolves `{ ok: false, error }` when that provider has nothing. **Must never blank the lyrics** on failure. |

> **`hasLyrics()` trap.** The component renders `.skeleton-line` while it is
> searching and a `.no-lyrics` panel when it gives up. An instrumental gap is a
> `.lyrics-line` with no text. The footer (`"Source Unavailable · am-lyrics
> v1.8.2 …"`) also masquerades as a `.lyrics-line` once a fetch resolves.
> **Counting any of those as "found" makes every failed search read as
> "found"**, and the panel's own no-lyrics artwork can then never appear.
> The correct test is: a `.lyrics-line` that is not `.lyrics-gap` and not
> `.lyrics-footer`, whose text is non-empty.

---

## State & Hooks

| State | Type | Purpose |
| --- | --- | --- |
| `scrolled` | `boolean` | `true` while the user has taken the wheel away from autoscroll. Drives the 3-second return bar. |
| `scrolledFor` | `string` | The `songKey` the `scrolled` flag belongs to. A new song resets `scrolled` to `false`. |
| `artistFallback` | `string \| null` | The primary artist to retry with, or `null` when no retry has happened. |
| `fallbackFor` | `string` | The artist string the fallback state belongs to. |
| `phase` | `'searching' \| 'found' \| 'none'` | The empty-state phase machine. |
| `phaseFor` | `string` | The `emptyKey` the phase belongs to. |

### Refs (not state)

| Ref | Holds |
| --- | --- |
| `hostRef` | The host `<div>` the element is appended to. |
| `elRef` | The live `<am-lyrics>` element. |
| `resumeRef` | The current `resumeScroll` implementation. |
| `providerIdRef` | The provider id (the settings panel polls this). |
| `returnTimerRef` | The 3-second return timer handle. |
| `returnTokenRef` | A monotonically increasing token that invalidates a stale timer. |
| `barRef` | The return-bar element (its animation is restarted, not re-rendered). |
| `seekRef` / `getTimeRef` / `offsetRef` | Mirrored props, so the playhead effect's dependency list stays `[playing]`. |
| `ownedSheetsRef` | The CSS stylesheets this panel adopted into the shadow root, so a later adopt can drop them. |

### Derived identities (these are contract, not implementation detail)

| Key | Formula | Why it exists |
| --- | --- | --- |
| `songKey` | `` `${ttml ? 'tt' : ''}${title}\0${effArtist}` `` | The song's identity, and what a stored lyric changes. "Scrolled away" must not survive a pin/unpin. |
| `emptyKey` | `` `${title}\0${artist}` `` | The **song's** identity — deliberately *not* the pinned/unpinned state. Pinning mid-search used to flip `songKey`, which cleared the verdict and blinked the placeholder away. |
| `buildKey` | `` `${songKey}\0${ms ?? ''}\0${live ? 'live' : ''}` `` | Everything that makes the element be **rebuilt**. A rebuild is a fresh fetch. |
| `ms` | `duration > 0 ? Math.round(duration * 1000) : undefined` | `undefined` until metadata lands — a `0` duration would still count as a *change* once the real one arrives, rebuilding the element and re-fetching. |

### Derived values

- `primaryArtist` = `artist.split(/[&,;]/)[0]?.trim() ?? artist`
- `effArtist` = `artistFallback ?? artist`
- `artistIsSplit` = `primaryArtist` exists **and** differs from `artist.trim()`

---

## Event Handlers (Outputs)

| Handler | Signature | When it fires |
| --- | --- | --- |
| `onSeek` | `(seconds: number) => void` | The user clicks a lyric line. The element's `line-click` event carries `detail.timestamp` in **milliseconds**; the panel divides by 1000 before calling. |

Everything else the panel exposes is **imperative** through `apiRef` (see
`LyricsApi` above) — there is no callback prop for source switching,
downloading, or provider forcing.

---

## UI Interactions & Edge Cases

### 1. Element construction — three rules from the component's own source

These are easy to get wrong and each one causes a wasted network round-trip:

1. **`connectedCallback` starts a fetch, and `updated()` starts ANOTHER** whenever
   `songTitle` / `songArtist` / `songDurationMs` change. **Every property must be
   written BEFORE the element is appended.** Appending first fires a wasted
   metadata-less fetch and then a second real one.
2. **Setting `ttml` makes the component render that string and skip ALL
   providers.** The local-pin path. It is checked first.
3. **The element is rebuilt only when the song's identity changes.** Writing a
   property afterwards re-triggers the fetch — so the playhead and any later
   duration correction must never be pushed as a property change.

### 2. The element is kept alive while the panel is hidden

The container's opacity animates rather than unmounting, so re-showing the
lyrics never re-fetches. **Do not unmount the host on hide.**

### 3. The footer must be hidden with `visibility`, not `display`

The component ships chrome above and below the lyrics. The **footer** must be
`visibility: hidden` — **NOT** `display: none`:

> The scroll range is derived from the last element in the container, and the
> footer's `50vh` bottom padding is what lets the final line travel up the
> panel. Hiding it from layout zeroes its `offsetTop`/`offsetHeight`, collapses
> the scroll range to `clientHeight - clientHeight` and pins `scrollTop` to 0 —
> lyrics highlight in place and **never scroll**. Hiding it from VIEW keeps the
> box, so the range is intact, and a programmatic `.click()` on the hidden
> Switch button still works.

The **header** is the opposite: it is not part of that maths, so it may be
`display: none`.

### 4. The empty state is a strict phase machine, not a flag

```
searching → the providers are still being asked (their skeletons show through
             the shadow DOM; the panel adds its own status line)
found     → real lyrics are on the page — never a placeholder
none      → the search window has passed with nothing: ONLY here does the
             placeholder appear
```

A single boolean flag could show the placeholder during a slow fetch and sit
stale while a late lyric arrived. The polling interval keeps running, so a
`'none'` verdict still **recovers to `'found'`** the moment lyrics land.

- Poll interval: **900 ms**, up to **12 tries** before the window closes.
- The phase is keyed to `emptyKey` (the song), so a pin/unpin never clears it.

### 5. Multi-artist fallback

Multi-artist tracks keep their **full** artist in the library, but providers
match on one name far more reliably than on a bill. So:

1. The first ask carries the whole string.
2. When the search window has passed with nothing found **and** the artist is
   split **and** no fallback has happened yet **and** there is no `ttml` **and**
   it is not live ⇒ retry once against `primaryArtist`.
3. The retry is a **rebuild** (a new `songKey`), which is what triggers it.
4. The verdict below is keyed to the song, so the placeholder only lands when
   the fallback also came up empty.

### 6. The playhead — never React state

- While paused: **one** sync.
- While playing: a `requestAnimationFrame` loop.
- Never React state — a tick per frame would re-render the whole Home tree.
- **Re-read `elRef.current` every tick; never close over the element.** The
  element is rebuilt when the song's identity changes. A captured reference
  would keep writing to the detached element and the live one would freeze at
  its first frame.
- The value written is `Math.max(0, (getTime() + offset) * 1000)`.

### 7. Scroll-away and the 3-second return bar

- A `wheel` or `touchmove` on the host means the user is reading, not
  following.
- The old "Resume" button is **gone**. Scrolling starts a **visible 3-second
  countdown** instead; when the bar fills, the view is handed back to the line
  being sung.
- On expiry the panel also retires the component's own silent **5-second**
  quiet-spell timeout (it clears `userScrollTimeoutId` and calls
  `setUserScrolling(false)`), so **3 s is the only clock that decides**.
- The bar's fill animation is **restarted** (`animation.currentTime = 0`); a
  state update per wheel tick would re-render for nothing.
- A timer aimed at a song that has already ended must never fire into — and
  cancel — the next song's countdown. A **token** is bumped on every rebuild
  and on every user scroll; the timer only fires if its token still matches.
- `resumeScroll()` must scroll to the **same target the component computes**
  (`offsetTop - 45% of the container`). Driving the element's own
  `scrollToActiveLine` instead centres on `containerHeight / 2`, so the line
  sits visibly lower after a resume than it did during playback. After
  scrolling, **re-arm autoscroll** by nudging `currentTime` by `+0.001`.

### 8. The style sheet is adopted, not injected

The panel owns one `CSSStyleSheet` and **adopts** it into the element's
`shadowRoot.adoptedStyleSheets`.

- Adoption lands on a **frame** (`requestAnimationFrame`): Lit installs its
  own styles in a microtask after connect, so adopting earlier would be
  overwritten.
- The sheet is **rebuilt** whenever the song, the position or the panel's own
  chrome changes, and the previous owned sheet is **dropped** — a leftover
  sheet would keep its `!important` palette in the cascade.
- CSS, not DOM pokes: the footer only exists once a fetch lands, and a style
  rule applies whenever it appears.

### 9. The two faces

| Sheet | When | Notes |
| --- | --- | --- |
| `WHITE_CHROME` | Default (and always for an unpinned lyric) | Plain white glyphs, flat, no sheen. `background-clip: text` is deliberately **not** used — forcing `color` / `-webkit-text-fill-color` over the spans painted the glyphs with an opaque fill and the dim→bright wipe could never show. |
| `METAL_CHROME` | `metal` = `true` | Cool silver / bright nickel palette plus an embossed pair of shadows (light edge above, dark bevel below). **Deliberately no `background-clip: text` gradient**: in WebView2 the clipped-gradient glyph layer desyncs from the line's transformed children — the text painted **twice**, a dim ghost copy at the pre-transform position, **only while pinned**. |

Additional chrome, applied always:

- `CENTER_CHROME` is applied always (the stage position reads as a showcase,
  so its lines are centred).
- `TEXT_CHROME` puts the shadow **on the glyphs**, following the text, instead
  of painting a rectangle over the artwork.
- `BG_HIDE_CHROME` hides `.background-vocal-container` (the echo lines). The
  component always renders these containers, so the hide lives in the sheet,
  not in the data.
- `MOTION_CHROME` eases the line 280 ms and scales the active line to 1.045.
  It must respect `@media (prefers-reduced-motion: reduce)`.

### 10. Layout & masking

- `paddingTop: 2rem` on the host — Hindi/Punjabi conjunct marks hang above
  the line box and used to clip at the panel's top edge.
- A vertical mask fades the top and bottom 9%:
  `linear-gradient(180deg, transparent, black 9%, black 91%, transparent)`.
- `--lyrics-scroll-padding-top: 45%` parks the active line mid-panel. `0%`
  would pin it to the top edge, straight under the fade mask, with all the
  context below.
- The host is `invisible` while `phase === 'none'` — the placeholder draws
  over it.

---

# PART B — `LyricsSettingsPanel`

## Purpose

Holds every control that configures the lyrics — the provider chain and its
order, the local copy (pin/edit), the text size, the brightness, the sync
offset and the download — anchored under the gear that opened it.

---

## Props (Inputs)

```ts
interface Props {
  api: LyricsApi | null
  size: number
  onSize: (v: number) => void
  brightness: number
  onBrightness: (v: number) => void
  offset: number
  onOffset: (v: number) => void
  pinned: boolean
  onPin: () => void
  onUnpin: () => void
  onEdit: () => void
  onClose: () => void
  closing?: boolean
  onClosed?: () => void
  pos?: { x: number; y: number } | null
  chromeEditing?: boolean
  layoutOffset?: ChromeOffset
  onLayoutOffset?: (o: ChromeOffset) => void
}
```

| Prop | Type | Description |
| --- | --- | --- |
| `api` | `LyricsApi \| null` | The imperative handle Part A fills in. `null` before the lyrics panel has mounted, or when lyrics are disabled. Every `api`-backed control must degrade gracefully when it is `null`. See the `LyricsApi` surface in Part A. |
| `size` | `number` | Current base font size in px. One of `LYRIC_SIZES` = `[20, 28, 36]`. |
| `onSize` | `(v: number) => void` | Set the base font size. Called with one of `20 \| 28 \| 36`. |
| `brightness` | `number` | Current brightness percent, `20`–`160`. |
| `onBrightness` | `(v: number) => void` | Set the brightness percent. |
| `offset` | `number` | Current sync offset in **seconds**. May be negative. |
| `onOffset` | `(v: number) => void` | Set the sync offset in seconds. **Not clamped** — a provider can be wildly off and there is nothing wrong with correcting by a minute. |
| `pinned` | `boolean` | `true` when this track already has lyrics stored on disk. |
| `onPin` | `() => void` | Store the loaded lyrics locally. |
| `onUnpin` | `() => void` | Delete the stored copy so the track fetches again. |
| `onEdit` | `() => void` | Open the lyrics **editor** (a separate modal component). |
| `onClose` | `() => void` | Request close. The parent sets `closing`; see *Close protocol*. |
| `closing` | `boolean` | Optional, default `false`. `true` plays the exit animation. |
| `onClosed` | `() => void` | Optional. Called **after** the exit animation, so the parent can unmount. |
| `pos` | `{ x: number; y: number } \| null` | Optional, default `null`. Where the gear button that opened the panel sits on screen. `null` ⇒ the panel keeps its fallback position. |
| `chromeEditing` | `boolean` | Optional, default `false`. The layout editor is running — the panel becomes draggable. |
| `layoutOffset` | `ChromeOffset` | Optional. The panel's saved drag offset (`{ dx, dy }`). |
| `onLayoutOffset` | `(o: ChromeOffset) => void` | Optional. Persist a new drag offset. |

> **`chromeEditing` is named apart from the lyric `offset` controls above,**
> which are numbers. Do not rename it to `offset` — the collision is real and
> was the reason for the split.

---

## State & Hooks

| State | Type | Purpose |
| --- | --- | --- |
| `source` | `string \| null` | The label of the provider currently serving, e.g. `"lrc.red"`. |
| `hasLyrics` | `boolean` | Whether real lyrics are loaded. Gates the PIN button. |
| `busy` | `boolean` | A short-lived "action in flight" flag, so a button cannot be double-fired. |
| `editing` | `boolean` | The offset value is showing as a typed text field instead of a button. |
| `activeId` | `string \| null` | The provider currently serving the lyrics. |
| `forcingId` | `string \| null` | The provider currently being asked. |
| `providerError` | `string \| null` | The last provider failure, shown under the list. |

### Hooks

| Hook | Purpose |
| --- | --- |
| `useProviderOrder()` | Returns `{ order, setOrder, reset, isCustom }`. `order` is the provider ids **in the order they are asked**; `setOrder` persists a new order; `reset` restores the shipped waterfall; `isCustom` says whether the order has been hand-edited. |
| `useChromeDrag({ editing, offset, onOffset })` | Layout-editor drag support. See *House rules*. |
| `useEffect` (closing) | Fires `onClosed` 200 ms after `closing` becomes `true`. |
| `useEffect` (poll) | Reads `api.source()`, `api.hasLyrics()` and `api.providerId()` every **1500 ms** while the panel is open, and once immediately. |

> **Why the panel polls.** The provider label and the loaded state live inside
> the component's **shadow DOM**, so they cannot be pushed down as props —
> they can only be read back. The poll is the only way.

---

## Event Handlers (Outputs)

| Handler | Signature | Fires when |
| --- | --- | --- |
| `onSize` | `(v: number) => void` | A size preset is clicked (`20`, `28` or `36`). |
| `onBrightness` | `(v: number) => void` | The brightness slider moves. |
| `onOffset` | `(v: number) => void` | The `−` button (offset − 0.5), the `+` button (offset + 0.5), or the typed field is committed. |
| `onPin` | `() => void` | PIN is clicked while unpinned. |
| `onUnpin` | `() => void` | UNPIN is clicked while pinned. |
| `onEdit` | `() => void` | EDIT is clicked. |
| `onClose` | `() => void` | The `✕` is clicked. |
| `onClosed` | `() => void` | The exit animation has finished. |
| `setOrder` | `(order: string[]) => void` | A provider row is dragged to a new position. |
| `onForce` → `api.forceProvider` | `(id: string) => void` | A provider's name is clicked. Asks **that one** provider for the track. |
| `onLayoutOffset` | `(o: ChromeOffset) => void` | The panel is dragged in edit mode. |

---

## UI Interactions & Edge Cases

### 1. The provider list — draggable and reorderable

The provider list is a **separate component** (`features/lyrics/ProviderList.tsx`)
with this contract:

```ts
interface ProviderListProps {
  order: string[]                  // the ids, in the order they are asked
  activeId: string | null          // the provider currently serving
  onReorder: (order: string[]) => void
  onForce: (id: string) => void
  busyId: string | null            // the provider being asked right now
  error: string | null             // the last thing that went wrong
}
```

**The drag is pointer-based, NOT HTML5 drag-and-drop.** This is not a
preference: HTML5 DnD is stuttering in this app's WebView2 *by construction* —
the ghost it draws lives in another process and lags the cursor. The
playlist's own drag was rewritten the same way for the same reason.

The mechanics:

- A grip button (`GripVertical`) on each row starts the drag:
  `e.preventDefault()` + `setPointerCapture(e.pointerId)` + set the dragged id.
- On `pointermove`, the row whose bounding box contains `e.clientY` decides
  where the dragged one goes — the list is reordered live, mid-drag.
- On `pointerup` / `pointercancel`, the drag ends and the pointer capture is
  released.
- The dragged row renders at reduced opacity while it is being dragged.
- Reordering must survive a **new provider being added**: a new id takes the
  position the default order gives it, not the end of the list.

**Rows are ordered by tier.** The shipped order is:

| Tier | Providers (short name) |
| --- | --- |
| 1 | `UNISON`, `BLYRICS`, `BQQ`, `NETEASE`, `PAXSENIX`, `KUGOU`, `LYRICSPLUS` |
| 2 | `LRCLIB`, `PAXSENIX`, `LRC-RED` |
| 3 | `LYRICS-OVH` |

**Every row in the shipped registry is reachable.** There are no "unavailable"
rows — the dead services were removed from the registry rather than being
shown as disabled. A rebuild must not reintroduce disabled rows.

### 2. Scrollbar behaviour of the provider list

- The list scrolls **inside a fixed-height box**: `max-h-[210px]`,
  `overflow-y-auto`, `overflow-x-hidden`.
- It uses the `.thin-scroll` class — a **3 px** hairline thumb at
  `rgba(255,255,255,0.18)`, transparent track, hover `rgba(255,255,255,0.32)`.
  The default fat white scrollbar draws more attention than the content it
  scrolls.
- The list must **not** grow the panel: eleven rows do not fit a 240 px panel
  beside everything else that lives in it, so the list scrolls and the panel
  itself scrolls too if the window is short.
- The heading row carries the hint **"DRAG TO REORDER"** — the longer wording
  overlapped "PROVIDERS".

### 3. Clicking a provider asks that one provider

- The row's name is a button. Clicking it calls `onForce(id)`.
- A provider that has **nothing** leaves the words on screen alone — the
  failure is reported in the panel (`providerError`, e.g.
  `"NETEASE — NOTHING FOUND"`) and the lyrics are **not** touched.
- While a provider is being asked, **every** provider button is disabled
  (`busyId !== null`) and the busy row shows `FETCHING…`.
- On success, `activeId` becomes that provider, and `source` / `hasLyrics` are
  re-read immediately.
- The active row is marked with an emerald dot; an inactive but reachable row
  gets a faint white dot.
- A failed fetch sets `providerError` to the provider's short name plus the
  reason, or `"THE PROVIDER COULD NOT BE REACHED"` if the call itself threw.

### 4. The local copy (PIN / UNPIN)

- The heading shows `THIS TRACK` and, on the right, `ON DISK` when pinned and
  `FETCHED` when not.
- One button toggles: **PIN** when unpinned, **UNPIN** when pinned.
- PIN is **disabled** when there is nothing loaded (`!pinned && !hasLyrics`),
  with the title *"Nothing loaded to store yet"*.
- The pinned state is styled emerald; unpinned is plain.
- **The button must never persist a record that would render as "no lyrics
  found"** — such a record shadows the live fetch for good. (Enforced in the
  store, but the panel must not offer to pin an empty result.)

### 5. The sync offset — a click-to-type field

- The layout is: `−` button · value · `+` button.
- `−` calls `onOffset(offset - 0.5)`, `+` calls `onOffset(offset + 0.5)`.
- Clicking the **value** turns it into a text field (`autoFocus`,
  `defaultValue={offset.toFixed(1)}`).
- The field commits on **blur** and on **Enter**; **Escape** cancels.
- The commit parser must accept anything a person would type: `"3.2"`,
  `"+1.5"`, `"-4"`, `"2s"`, `""` (reset). Strip everything that is not
  `0-9 . + -`, parse as float, and fall back to `0` when the result is not
  finite.
- The display shows a leading `+` for positive values, and one decimal.
- The hint reads: `− moves the words earlier · + moves them later · click the
  value to type`.
- **No clamp.**

### 6. Text size

- Three preset buttons in a 3-column grid, labelled `SMALL` / `MEDIUM` /
  `LARGE` for `20` / `28` / `36` px.
- The selected one is filled (`bg-white/90 text-black`); the others are
  translucent.
- The current value is shown in the heading as `{size}px`.

### 7. Brightness

- A range slider, `min={20} max={160}`, `.chrome-range`.
- The heading shows `{brightness}%`.

### 8. The download button

- Full width, at the bottom, label `DOWNLOAD LYRICS` with a download icon.
- **Disabled** when there is no `api` or while `busy`.
- It calls the component's own exporter through `api.download()`. The
  component's own export is animated, so the `busy` flag is released on a
  **600 ms** delay (not immediately) — otherwise the button can be
  double-fired into a stacked download. The `source` readout is refreshed
  **300 ms after** that.

### 9. Position and size

- The panel is `w-60` (240 px) wide.
- When `pos` is supplied, the panel **anchors under the gear** that opened it:
  - `left` is clamped to `[8, window.innerWidth - PANEL_W - 8]`, so a
    right-side button never pushes the panel off the edge.
  - `top` is clamped to `[8, window.innerHeight - 420]`.
  - `maxHeight` is `calc(100vh - {top}px - 8px)`.
- When `pos` is absent, the panel keeps the fallback position
  (`left: 5%`, `top: 13%`).
- **The height is bounded, not measured.** The provider list made this panel
  much taller than it was. Measuring it would mean a resize observer feeding a
  re-render on every frame of the opening animation — and a panel that is
  re-rendered while it animates **never finishes animating**.
- The panel itself scrolls (`overflow-y-auto overflow-x-hidden`) if the
  window is short.

### 10. Close protocol

Two-stage, so the exit animation is never cut off:

1. The parent sets `closing = true` (the `✕` calls `onClose`).
2. The panel adds `is-closing` to its class list.
3. **200 ms later** the panel calls `onClosed()`, and the parent unmounts.

`is-closing` is what the stylesheet keys the exit animation off. The panel
must keep mounting during that window.

---

## Related contracts

- The lyric **editor** (a modal) is a separate component; the settings panel
  only triggers it.
- The **CUSTOM POSITION** toggle for the lyrics lives in the **Customize**
  hub, not here — see `CustomizePanel.SPEC.md`.
