# RadioPanel — Component Specification

> **Status:** v1.0 · **Applies to:** MUN15H — MD Walkman player (`app/`) · **Host:** Tauri 2 + React 19 + Vite 7
>
> This is a **contract**, not a description. An agent rebuilding the UI must
> satisfy every line here. Anything not written here is not part of the
> contract and may be changed freely; anything written here is load-bearing
> and is checked by the harnesses in `.verify/`.
>
> **Naming note.** The shipped panel has **two tabs: `KNOWN STATIONS` and
> `SEARCH`.** Favourites are **not** a third tab — they are a per-row star
> toggle, and the favourites *set* arrives as a prop. The brief mentioned a
> "Search / Favourites" pair; the shipped contract is reproduced faithfully
> below, because a rebuild that invents a favourites tab would break the
> `favourites` prop contract and the row-level star interaction. If a
> favourites *tab* is wanted, that is a **new feature**, not a rebuild.

---

## Purpose

Browses and plays internet radio — the stations already known to the listener
and a live search of the radio-browser.info federation — with a now-playing
strip, an ICY song clock, and the metadata options that make title detection
work.

---

## Props (Inputs)

```ts
interface Props {
  known: KnownStation[]
  addAll: boolean
  onAddAll: (v: boolean) => void
  favourites: string[]
  onToggleFavourite: (
    url: string,
    meta?: { uuid?: string; name: string; codec?: string; bitrate?: number; country?: string },
  ) => void
  song: RadioSong | null
  icy: IcyStatus | null
  reconnecting: boolean
  onPlayStation: (s: Station) => void
  onPlayUrl: (
    url: string,
    meta?: { uuid: string; name: string; codec: string; bitrate: number; country: string },
  ) => void
  onForget: (url: string) => void
  current: KnownStation | null
  playing: boolean
  connecting: boolean
  error: string | null
  getSongTime: () => number
  songEnded: boolean
  lead: number
  onLead: (sec: number) => void
  levelOn: boolean
  onLevelOn: (v: boolean) => void
  vizOn: boolean
  onVizToggle: (on: boolean) => void
  lyricsOn: boolean
  onToggleLyrics: () => void
  stop: () => void
  onClose: () => void
  editing?: boolean
  offset?: ChromeOffset
  onOffset?: (o: ChromeOffset) => void
}
```

| Prop | Type | Description |
| --- | --- | --- |
| `known` | `KnownStation[]` | The stations already known to the listener. |
| `addAll` | `boolean` | Whether every stream played is added to the known list. |
| `onAddAll` | `(v: boolean) => void` | Toggle "add all played streams". |
| `favourites` | `string[]` | The station **URLs** that are starred. |
| `onToggleFavourite` | `(url, meta?) => void` | Star / unstar a station. `meta` carries the real name and quality so the known list and the header keep the **real name, not the URL**. |
| `song` | `RadioSong \| null` | The song currently detected on the stream, when the stream carries titles. |
| `icy` | `IcyStatus \| null` | The ICY metadata status: `probing`, `live` or `none`, plus the station name / mime / message. |
| `reconnecting` | `boolean` | The stream is being re-established. |
| `onPlayStation` | `(s: Station) => void` | Tune a station found in the search results. |
| `onPlayUrl` | `(url, meta?) => void` | Tune a station by URL — a known row (with its metadata) or a pasted address. |
| `onForget` | `(url: string) => void` | Remove a station from the known list. |
| `current` | `KnownStation \| null` | The station currently tuned. |
| `playing` | `boolean` | The stream is playing. |
| `connecting` | `boolean` | The stream is being fetched but nothing is on air yet. |
| `error` | `string \| null` | The last stream error. |
| `getSongTime` | `() => number` | The **song clock**: where the radio is inside the current song, in seconds. Must be a stable reference — it drives a per-frame DOM write. |
| `songEnded` | `boolean` | The current song has ended; the clock reads as BETWEEN SONGS. |
| `lead` | `number` | The listener's correction to the radio playhead, in seconds. May be negative. |
| `onLead` | `(sec: number) => void` | Adjust the lead by ±0.5 s. |
| `levelOn` | `boolean` | Whether the end-of-song detector is watching a second, silent copy of the stream. |
| `onLevelOn` | `(v: boolean) => void` | Toggle the end-of-song detector. |
| `vizOn` | `boolean` | Whether the live visual is listening to **this station** rather than the deck. |
| `onVizToggle` | `(on: boolean) => void` | Switch the visual's source. **Not** a power switch — the visual itself is turned on and off in the visualiser panel. |
| `lyricsOn` | `boolean` | Whether the lyrics panel is showing. |
| `onToggleLyrics` | `() => void` | Toggle the lyrics panel — the same switch the header chip flips, parked here so a radio listener never has to reach the main deck. |
| `stop` | `() => void` | Stop the stream. |
| `onClose` | `() => void` | Close the panel. |
| `editing` | `boolean` | Optional, default `false`. The layout editor is running — the panel becomes draggable. |
| `offset` | `ChromeOffset` | Optional. The panel's saved drag offset (`{ dx, dy }`). |
| `onOffset` | `(o: ChromeOffset) => void` | Optional. Persist a new drag offset. |

### Supporting types

```ts
interface KnownStation {
  uuid: string
  name: string
  url: string
  codec: string
  bitrate: number
  country: string
  playedAt: number
}

interface Station {
  uuid: string
  name: string
  codec: string
  bitrate: number
  url: string
  country: string
  language: string
  tags: string
  votes: number
  clicks: number
  secure: boolean      // https streams only — plain http is kept for dev/local origins
}

type SearchField = 'language' | 'country' | 'tag' | 'name'

interface IcyStatus {
  kind: IcyKind        // 'probing' | 'live' | 'none'
  station?: string
  metaint?: number
  mime?: string
  message?: string
}
```

---

## State & Hooks

| State | Type | Purpose |
| --- | --- | --- |
| `tab` | `'known' \| 'search'` | Which tab is open. |
| `field` | `SearchField` | Which search field is selected. |
| `query` | `string` | The current search term (or the picked language/country). |
| `rows` | `Station[]` | The fetched search results. |
| `loading` | `boolean` | A search is in flight. |
| `searchError` | `string \| null` | The last search failure. |
| `customUrl` | `string` | The pasted stream address. |
| `proxy` | `string` | The optional ICY metadata proxy base URL. |
| `sort` | `{ key: 'name' \| 'codec' \| 'bitrate' \| 'votes'; dir: 1 \| -1 }` | The table sort. Default `{ key: 'votes', dir: -1 }`. |
| `showAdvanced` | `boolean` | The ADVANCED section is expanded. |
| `closing` | `boolean` | The exit animation is playing. |
| `languages` | `string \| null` | The federation's language list. `null` = not loaded yet. |
| `countries` | `string \| null` | The federation's country list. `null` = not loaded yet. |
| `reqRef` | `useRef<number>` | A request generation counter — stale responses are discarded. |

### Hooks

| Hook | Purpose |
| --- | --- |
| `useChromeDrag({ editing, offset, onOffset })` | Layout-editor drag support. |
| `useEffect` (list loading) | Loads the language list when `field === 'language'` and the country list when `field === 'country'` — **once each**, cached in state. |
| `useEffect` (search seed) | When the search tab is opened and the list is empty, seeds it with `popularStations()` so the tab is never empty. |
| `useMemo` (`sorted`) | Sorts a **copy** of `rows` by the current sort key/direction. The fetched set is never re-requested to re-sort. |

---

## Event Handlers (Outputs)

| Handler | Signature | Fires when |
| --- | --- | --- |
| `onAddAll` | `(v: boolean) => void` | The "ADD ALL PLAYED RADIO STREAMS TO THE LIST" checkbox is toggled. |
| `onToggleFavourite` | `(url, meta?) => void` | A row's star is clicked. |
| `onPlayStation` | `(s: Station) => void` | A search result is played (button or double-click). |
| `onPlayUrl` | `(url, meta?) => void` | A known row is played (button or double-click), or the pasted address is submitted. |
| `onForget` | `(url: string) => void` | A known row's delete button is clicked. |
| `onLead` | `(sec: number) => void` | The lead `−` / `+` buttons are clicked (±0.5 s). |
| `onLevelOn` | `(v: boolean) => void` | The "DETECT WHEN A SONG ENDS" checkbox is toggled. |
| `onVizToggle` | `(on: boolean) => void` | The `VISUAL ON/OFF` chip is clicked. |
| `onToggleLyrics` | `() => void` | The `LYRICS ON/OFF` chip is clicked. |
| `stop` | `() => void` | The `STOP` chip is clicked. |
| `onClose` | `() => void` | The `✕` is clicked (after the 280 ms exit). |
| `onOffset` | `(o: ChromeOffset) => void` | The panel is dragged in edit mode. |

---

## UI Interactions & Edge Cases

### 1. The two tabs

```
KNOWN STATIONS · {count}   |   SEARCH
```

- `known` is the default tab.
- The known tab's label carries the live count.
- The active tab is `bg-white/10 text-white`; the inactive one is
  `text-white/40`.

### 2. The KNOWN STATIONS tab

A table with the columns `NAME`, `CODEC`, `KBPS`, `URL` and an action column.

- The list is sorted **playable-first by the API module**, so the top rows are
  the https mp3/aac streams that actually work in a webview.
- **Double-clicking a row plays it**; the row's play button does the same.
- The row for the currently-tuned station is highlighted (`bg-white/[0.08]`).
- **KBPS is colour-coded by quality**, so it is readable without reading the
  number:
  | Bitrate | Colour |
  | --- | --- |
  | `>= 192` | `text-emerald-300` |
  | `>= 128` | `text-amber-200` |
  | below | `text-rose-300` |
  A bitrate of `0` renders as `—`, not `0`.
- Each row has three actions: **play**, **star**, **delete**. Each one
  `stopPropagation()` so it does not also trigger the row's double-click.
- The star is amber and filled when the row's URL is in `favourites`.
- The delete button is `onForget` — it removes the station from the known list.

**Empty state:**

```
NOTHING TUNED YET
SEARCH A STATION, OR PASTE A STREAM URL BELOW
```

### 3. The SEARCH tab — the field picker

Four search fields: `Language`, `Country`, `Tag`, `Name`.

**Language and Country are pickers, not typing.** The federation's own lists
are loaded once each, most-stationed first, so there is no spelling guess and
no guessing which spelling the server uses. They render as a second `<select>`
beside the field selector. The empty option reads `— pick a language —` /
`— pick a country —`, or `LOADING…` while the list is in flight.

**Tag and Name stay free text** — they are exactly the fields a person has in
their head. The placeholder is `jazz` for a tag and `queen` for a name.

**Changing the field clears the query** and the previous results.

**Selecting a language or country searches immediately** (on change). A tag or
name searches on **Enter** or on the **GO** button. The GO button is disabled
while the query is empty or a search is loading, and shows `…` while loading.

### 4. The search result table

Columns: `NAME` (with `country · language` under it), `CODEC`, `KBPS`,
`POPULARITY` (votes), and an action column with **play** and **star**.

- Each header is a button that sorts by that column. Clicking the active
  column reverses the direction. The active header shows `▾` (descending) or
  `▴` (ascending).
- Sorting is **local**: the fetched set is never re-requested.
- A new search resets the sort back to `{ key: 'votes', dir: -1 }`.

### 5. Search lifecycle and the generation counter

- Every search increments a generation counter (`reqRef`).
- When the answer arrives, it is applied **only if it is still the newest
  request**. A slow earlier search must not overwrite a fast later one.
- The same guard covers `setLoading(false)` and the error path.
- On failure: `rows` is cleared and `searchError` becomes
  `RADIO BROWSER UNREACHABLE`.
- The error block reads:

```
RADIO BROWSER UNREACHABLE
THE FEDERATION IS OFTEN BRIEFLY DOWN — TRY AGAIN
```

- While loading, **six skeleton rows** are drawn (`.skeleton-row`).
- Zero results reads `NO MATCHES`.

### 6. The now-playing strip

A strip below the header showing the **station** always, with the detected
song **under** it — so a title appearing is a change rather than a replacement.

- It uses a **transition**, not a keyframe: the fx governor sets
  `animation: none !important` from tier 2 up, which would kill an entrance
  animation on any machine under load — a transition survives it.
- Remounting on each new song restarts the transition, so every track change
  reads as a change. The parent keys it on `song?.raw ?? current?.url ?? 'idle'`.
- The flip happens in an effect on the next frame, **never** as a synchronous
  `setState`.
- A **spinner** appears while `connecting && !playing` — the stream is being
  fetched but nothing is on air yet. It is gone the moment audio starts or the
  attempt reports an error.
- The right-hand badge reads `DETECTED` (emerald) when a song is present and
  `NO TITLES` otherwise.

### 7. The song clock — written straight into the DOM

When a song is detected, a clock strip appears with `POSITION` / `BETWEEN
SONGS`, the time, and the `LEAD` correction.

- **The position is written directly into the DOM on every frame.** React
  state would re-render the whole panel sixty times a second to move four
  characters — and the lyrics panel is already sampling this clock for the
  highlight, so it would be two consumers of one number.
- The readout is `mm:ss / mm:ss` when the duration is known, `mm:ss` when it
  is not.
- The label turns amber and reads `BETWEEN SONGS` when `songEnded`.
- `LEAD` is the one number only a listener can judge: the clock learns the
  station's own lag, but whether the highlight feels early or late is the
  ear's call. `−` and `+` adjust by 0.5 s, and the value shows a leading `+`
  for positive values with one decimal.

### 8. The ICY status line

Shown when `icy` exists and `icy.kind !== 'probing'`:

- `kind === 'live'` → `ICY · {MIME} · {STATION}` (the mime uppercased).
- otherwise → the message, or `NO METADATA`.

This exists so the panel says plainly when a stream will not give up titles,
rather than leaving the reader to wonder why nothing appears.

### 9. RECONNECTING and the error line

- `RECONNECTING…` in amber, on its own strip, when `reconnecting` is true.
- The `error` string in rose, on its own strip.

### 10. The header chips

| Chip | Behaviour |
| --- | --- |
| `VISUAL ON/OFF` | `aria-pressed`. Emerald when the visual is listening to this station, plain otherwise. Title: *"The visual is listening to this station"* / *"…to the deck"*. |
| `LYRICS ON/OFF` | `aria-pressed`. Same styling. Title: *"Hide the lyrics panel"* / *"Show the lyrics panel"*. |
| `STOP` | Only rendered when `(playing \|\| connecting) && current`. |
| `✕` | Closes the panel. |

### 11. ADVANCED — the section for the two people who know why they want them

Collapsed by default (`showAdvanced` = `false`), with a chevron that rotates
180° when open. It holds:

**METADATA PROXY · OPTIONAL** — a text field for a one-file relay in front of a
stream (e.g. `https://icy-proxy.you.workers.dev`).

- It is saved on **blur** and on **Enter**, into `localStorage['md-radio-proxy']`
  and into the proxy base.
- Only the **metadata reads** use it — playback stays direct.
- The hint says `ACTIVE — RESTART A STATION TO APPLY.` when it is set, and
  `EMPTY MEANS DIRECT.` when it is not.

**DETECT WHEN A SONG ENDS** — a checkbox.

- It watches the level of a **second, silent copy** of the stream to catch the
  end of a song.
- It needs a station that allows CORS; without one it simply stays quiet.
- **Off means no second connection.**

### 12. PLAY BY STREAM ADDRESS

A text field plus a PLAY button at the bottom of the known tab.

- Placeholder `https://stream.example.com/live.mp3`, `spellCheck={false}`.
- Enter in the field **or** clicking PLAY tunes it.
- The field is **cleared** after a successful submit.
- PLAY is disabled while the field is empty.

### 13. The panel frame

- `top-[24%]`, `left-[5%]`, `w-[min(92vw,560px)]`,
  `max-h-[min(62vh,520px)]`, flex column.
- The scrolling body is `.radio-scroll` with `min-h-0 flex-1 overflow-y-auto` —
  the `min-h-0` is what lets the flex child actually shrink instead of
  pushing the footer off the panel.
- The exit is played **here** rather than left to the unmount: the panel slides
  out over **280 ms** instead of vanishing between frames. `closing` adds
  `is-closing panel-out-soft` to the class list, and `onClose` fires after
  280 ms.
- The search tab's footer credits the source:
  `Powered by radio-browser` (an external link).

---

## House rules (shared by every panel in this app)

| Rule | Detail |
| --- | --- |
| **Chrome** | `settings-panel` (entrance/exit animation + hairline scrollbar), `panel-resizable` (native corner resizer, `min-width: 210px`, `min-height: 150px`), `fx-blur` (the glass blur), `thin-scroll` (3 px hairline). |
| **Typography** | Mono, uppercase, wide letter-spacing micro-labels. Section labels are `text-[7px] tracking-[0.2em] text-white/35`. |
| **Touch targets** | `.qp-pill-sm` is the house size: **24 px** tall, `10.5px` font, `r8`. |
| **Glass** | `data-liquid-ignore` marks a surface the liquid-glass lens must skip. |
| **Layout editor** | `useChromeDrag({ editing, offset, onOffset })` returns `{ editClass, style, onPointerDown, onClickCapture }`. Wire `editClass` onto the class list, `style` onto the `style` prop, and the two handlers onto the root as `onPointerDownCapture` / `onClickCapture`. Movement is **unbounded** — nothing is clamped. |
| **Accessibility** | Every icon-only button needs an `aria-label`. Toggles use `aria-pressed`. Disclosure rows use `aria-expanded`. |
| **Motion** | The house curve is `cubic-bezier(0.22, 1, 0.36, 1)`. Respect `prefers-reduced-motion`. |
