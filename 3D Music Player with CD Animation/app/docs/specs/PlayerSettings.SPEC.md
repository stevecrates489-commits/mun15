# PlayerSettings — Component Specification

> **Status:** v1.0 · **Applies to:** MUN15H — MD Walkman player (`app/`) · **Host:** Tauri 2 + React 19 + Vite 7
>
> This is a **contract**, not a description. An agent rebuilding the UI must
> satisfy every line here. Anything not written here is not part of the
> contract and may be changed freely; anything written here is load-bearing
> and is checked by the harnesses in `.verify/`.
>
> The shipped component is `PlayerSettingsPanel.tsx` — the file name is
> historical. The panel is the **player settings** card.

---

## Purpose

A small anchored card holding the switches playback honours — crossfade and
its length, volume normalisation, the glass/solid interface switch and accent
-from-art.

---

## Props (Inputs)

```ts
interface Props {
  settings: PlayerSettings
  onSetting: (key: 'crossfade' | 'crossfadeSec' | 'normalize', value: number | boolean) => void
  accentArt: boolean
  onAccentArt: (on: boolean) => void
  onClose: () => void
  pos: { x: number; y: number } | null
}

interface PlayerSettings {
  crossfade: boolean
  crossfadeSec: number
  normalize: boolean
}
```

| Prop | Type | Description |
| --- | --- | --- |
| `settings` | `PlayerSettings` | The current playback settings. |
| `settings.crossfade` | `boolean` | Whether a track's end blends into the next one's start. |
| `settings.crossfadeSec` | `number` | The blend length in seconds. The shipped values are `0`, `3`, `5` and `8`. |
| `settings.normalize` | `boolean` | Whether quiet tracks are lifted and loud ones left, for an even perceived loudness. |
| `onSetting` | `(key: 'crossfade' \| 'crossfadeSec' \| 'normalize', value: number \| boolean) => void` | Change one setting. **One handler for all three** — the panel never owns the state. |
| `accentArt` | `boolean` | Whether the seekbar and the playing row wear the cover's colours. |
| `onAccentArt` | `(on: boolean) => void` | Toggle accent-from-art. |
| `onClose` | `() => void` | Dismiss the card. |
| `pos` | `{ x: number; y: number } \| null` | Where the knob that opened the card sits on screen. `null` ⇒ the fallback position. |

---

## State & Hooks

| State | Type | Purpose |
| --- | --- | --- |
| `on` | `boolean` | **Local only** — the glass/solid switch. Initialised from `localStorage.getItem('md-glass') !== 'off'`. |
| `on` (shortcuts) | `boolean` | **Local only** — the keyboard-shortcuts switch. Initialised from `localStorage.getItem('md-shortcuts') !== '0'`. |

> **Two switches own their own state, unlike the other three settings.**
> The crossfade, its length and the normalisation come down as props and go
> back up through `onSetting`. The glass switch writes straight to
> `localStorage['md-glass']` and to `document.documentElement.dataset.glass`
> — it is a **document-level** style switch, not a player setting. The
> keyboard-shortcuts switch writes straight to `localStorage['md-shortcuts']`:
> the key handler reads that key on every keypress, so nothing needs to
> re-render when it changes. Neither is threaded through the parent.

### Hooks

| Hook | Purpose |
| --- | --- |
| `useState(() => localStorage.getItem('md-glass') !== 'off')` | The glass switch's initial value. |
| `useEffect(() => { … }, [on])` | Writes the glass switch to the document and to `localStorage`. |
| `useState(() => localStorage.getItem('md-shortcuts') !== '0')` | The shortcuts switch's initial value. |
| `useEffect(() => { … }, [on])` | Writes the shortcuts switch to `localStorage`. |
| `useEffect` (dismissal) | The document-level click-away / Escape listeners. See *Dismissal*. |

---

## Event Handlers (Outputs)

| Handler | Signature | Fires when |
| --- | --- | --- |
| `onSetting` | `(key, value) => void` | The crossfade toggle, a crossfade-length step, or the normalize toggle is used. |
| `onAccentArt` | `(on: boolean) => void` | The accent-from-art toggle is clicked. |
| `onClose` | `() => void` | The `✕` is clicked, a click lands outside the card, or **Escape** is pressed. |

---

## UI Interactions & Edge Cases

### 1. Dismissal — click-away and Escape

The card listens on the **document**, not on itself:

- **`pointerdown`** anywhere outside `[data-player-settings]` closes the card.
- **`Escape`** closes the card.
- Both listeners are removed on unmount.

Two exclusions, both load-bearing:

| Selector | Why it is excluded |
| --- | --- |
| `[data-player-settings]` | The card's own root. A click inside must not close it. |
| `[data-player-settings-anchor]` | The knob that opened the card. **The anchor is outside the card**, so without this exclusion the knob's own click would close the card and then immediately re-open it — a card that flickers and never stays open. The anchor's own click handler closes it properly. |

### 2. Position

The card is `w-[218px]` wide and is positioned from `pos`:

```
left = min(max(pos.x, 8), max(8, window.innerWidth - W - 8))   // W = 236
top  = min(pos.y, max(8, window.innerHeight - 340))
```

The `W` used for the clamp is **236**, deliberately larger than the card's
218 px width, so the card never sits flush against the window edge.

With `pos === null` the card keeps the fallback position
(`left: 5%`, `top: 20%`).

### 3. The glass/solid switch — a two-button segment, not a toggle

This is the one control that is **not** a pill toggle. It is a 2-column grid
of two buttons:

| Button | Label |
| --- | --- |
| Left | `BLURRED` |
| Right | `SOLID · FAST` |

- The **selected** one is filled (`bg-white/90 text-black`).
- The unselected one is `border border-white/10 bg-white/[0.03]`.
- The heading reads `GLASS PANELS`, and the right-hand readout shows
  `BLURRED` or `SOLID` — the same word as the button, so the current state is
  never ambiguous.
- The state is written to `document.documentElement.dataset.glass` as
  `'on'` / `'off'`, and to `localStorage['md-glass']`.

> `md-glass` is read **at boot** by `App.tsx` as well. The card owns it at
> runtime. A rebuild must keep the same key and the same
> `data-glass` attribute — other parts of the app read both.

### 3b. The keyboard-shortcuts switch — a pill toggle

- A pill toggle labelled `SHORTCUTS`, `aria-label="Toggle keyboard
  shortcuts"`.
- The heading reads `KEYBOARD SHORTCUTS`, and the right-hand readout shows
  `ON` or `OFF`.
- The state is written to `localStorage['md-shortcuts']` as `'1'` / `'0'`.
- It owns its own state — the key handler reads the key directly on every
  keypress, so there is no prop for it.

> This switch **used to live in the CD Settings card**, which went with the
> disc. It is a player preference, so it moved here. A rebuild must keep the
> `md-shortcuts` key: `Home.tsx` reads it on every keypress and returns
> early when it is `'0'`.

### 4. The crossfade — a toggle plus four length steps

- A pill toggle labelled `CROSSFADE`, `aria-label="Toggle crossfade"`.
- Under it, **four** equal-width step buttons: `0s`, `3s`, `5s`, `8s`.
  - `0` means no crossfade; the others are the blend lengths.
  - The selected one is filled with the **chrome silver** gradient and carries
    an inset highlight:
    `linear-gradient(145deg,#f4f7fa 0%,#c7ccd4 40%,#9aa2ac 70%,#e8ecf1 100%)`
    plus `inset 0 1px 1px rgba(255,255,255,0.9), 0 3px 10px rgba(0,0,0,0.5)`.
  - The unselected ones are `border border-white/10 bg-white/[0.03]`.
  - Each carries `aria-pressed` and a title (`"No crossfade"` for 0,
    `"3-second blend"` and so on).
- The caption reads: `A TRACK'S END BLENDS INTO THE NEXT ONE'S START.`

### 5. The normalize toggle — a pill with an explanatory caption

- A pill toggle labelled `NORMALIZE VOLUME`,
  `aria-label="Toggle volume normalisation"`.
- The caption **changes with the state**:
  - on → `A QUIET TRACK IS LIFTED, A LOUD ONE LEFT — SAME PERCEIVED LOUDNESS.`
  - off → `EVEN OUT LOUD AND QUIET TRACKS AUTOMATICALLY.`

The caption is not decoration: it says what the switch will do *next*.

### 6. The accent-from-art toggle — a pill with a stateful caption

- A pill toggle labelled `ACCENT FROM ART`,
  `aria-label="Tint the interface with the playing track's colours"`.
- The caption changes with the state:
  - on → `THE SEEKBAR AND THE PLAYING ROW WEAR THE COVER'S COLOURS.`
  - off → `THE INTERFACE STAYS ON THE DECK'S OWN COLOURS.`

### 7. The pill toggle primitive

Every toggle in this panel is the same 32 × 16 px pill:

- The **track** is the `<button>`, carrying `aria-label` and `aria-pressed`.
- The track is `bg-emerald-400/80` when pressed, `bg-white/15` when not.
- The **knob** is a 12 px white circle, `left: 18` when pressed and
  `left: 2` when not, with a `transition-all`.

`aria-pressed` is part of the contract — the harnesses read it.

### 8. What is NOT in this panel

- **Shuffle and repeat stay on the transport itself**, not here.
- The header carries the title `PLAYER SETTINGS` and a `✕` with
  `aria-label="Close player settings"`.
- The **CD Settings card is gone** — the disc left the app. The one thing
  that card held that was not about the disc (the keyboard-shortcuts switch)
  moved here; everything else about it is archived under
  `app/src/archived/cd/`.

### 9. The panel frame

- `settings-panel panel-resizable fx-blur fixed z-[88] w-[218px]`.
- It carries `data-player-settings` (the dismissal exclusion) **and**
  `data-liquid-ignore` (the liquid-glass lens must skip it).
- It is **not** `panel-out` animated on close: this card unmounts immediately
  on `onClose`. There is no `closing` / `onClosed` pair here.

---

## House rules (shared by every panel in this app)

| Rule | Detail |
| --- | --- |
| **Chrome** | `settings-panel` (entrance/exit animation + hairline scrollbar), `panel-resizable` (native corner resizer, `min-width: 210px`, `min-height: 150px`), `fx-blur` (the glass blur), `thin-scroll` (3 px hairline). |
| **Typography** | Mono, uppercase, wide letter-spacing micro-labels. Section labels are `text-[8px] tracking-[0.2em] text-white/35`. |
| **Touch targets** | `.qp-pill-sm` is the house size: **24 px** tall, `10.5px` font, `r8`. |
| **Glass** | `data-liquid-ignore` marks a surface the liquid-glass lens must skip. |
| **Accessibility** | Every icon-only button needs an `aria-label`. Toggles use `aria-pressed`. Disclosure rows use `aria-expanded`. |
| **Motion** | The house curve is `cubic-bezier(0.22, 1, 0.36, 1)`. Respect `prefers-reduced-motion`. |
