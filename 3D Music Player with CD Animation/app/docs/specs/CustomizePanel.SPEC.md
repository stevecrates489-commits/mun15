# CustomizePanel — Component Specification

> **Status:** v1.0 · **Applies to:** MUN15H — MD Walkman player (`app/`) · **Host:** Tauri 2 + React 19 + Vite 7
>
> This is a **contract**, not a description. An agent rebuilding the UI must
> satisfy every line here. Anything not written here is not part of the
> contract and may be changed freely; anything written here is load-bearing
> and is checked by the harnesses in `.verify/`.

---

## Purpose

The central hub for layout editing — it starts and stops the one edit session,
toggles the lyrics' custom position, and offers a per-region reset for every
movable panel.

---

## Props (Inputs)

```ts
interface Props {
  lyricsCustom: boolean
  onLyricsCustom: (on: boolean) => void
  queueSaved: boolean
  onResetQueue: () => void
  musicSaved: boolean
  onResetMusic: () => void
  carouselSaved: boolean
  onResetCarousel: () => void
  lyricsEnabled: boolean
  editChrome: boolean
  onEditChrome: (on: boolean) => void
  chromeEdited: boolean
  onResetChrome: () => void
  onClose: () => void
  closing?: boolean
  onClosed?: () => void
  pos?: { x: number; y: number } | null
  editing?: boolean
  offset?: ChromeOffset
  onOffset?: (o: ChromeOffset) => void
}
```

| Prop | Type | Description |
| --- | --- | --- |
| `lyricsCustom` | `boolean` | Whether the lyrics keep their own saved position. |
| `onLyricsCustom` | `(on: boolean) => void` | Toggle the lyrics' custom position. |
| `queueSaved` | `boolean` | A saved queue-panel rectangle exists. Gates the queue RESET button. |
| `onResetQueue` | `() => void` | Drop the saved queue panel position and dock it back. |
| `musicSaved` | `boolean` | A saved player-panel rectangle exists. Gates the player RESET button. |
| `onResetMusic` | `() => void` | Drop the saved player position and dock it back. |
| `carouselSaved` | `boolean` | A saved carousel rectangle exists. Gates the songs RESET button. |
| `onResetCarousel` | `() => void` | Drop the saved carousel position and dock it back above the player. |
| `lyricsEnabled` | `boolean` | Whether the lyrics panel is on at all. Gates the custom-position toggle. |
| `editChrome` | `boolean` | Whether an edit session is running. |
| `onEditChrome` | `(on: boolean) => void` | Start (or end) the edit session. In practice this is `enterLayoutEdit`, so `true` starts one. |
| `chromeEdited` | `boolean` | Whether any button or panel has been moved. Gates the SCREEN RESET button. |
| `onResetChrome` | `() => void` | Put every button and panel back where it started. |
| `onClose` | `() => void` | Request close. The parent sets `closing`. |
| `closing` | `boolean` | Optional, default `false`. `true` plays the exit animation. |
| `onClosed` | `() => void` | Optional. Called after the exit animation, so the parent can unmount. |
| `pos` | `{ x: number; y: number } \| null` | Optional, default `null`. Where the button that opened the panel sits on screen. |
| `editing` | `boolean` | Optional, default `false`. The layout editor is running — the panel becomes draggable. |
| `offset` | `ChromeOffset` | Optional. The panel's saved drag offset (`{ dx, dy }`). |
| `onOffset` | `(o: ChromeOffset) => void` | Optional. Persist a new drag offset. |

---

## State & Hooks

The panel holds **no local state**. Everything it shows is a prop, and
everything it does is a callback. This is deliberate: the hub is a view over
the layout system's state.

### Hooks

| Hook | Purpose |
| --- | --- |
| `useChromeDrag({ editing, offset, onOffset })` | Layout-editor drag support. See *House rules*. |
| `useEffect` (closing) | Fires `onClosed` 200 ms after `closing` becomes `true`. |

---

## Event Handlers (Outputs)

| Handler | Signature | Fires when |
| --- | --- | --- |
| `onLyricsCustom` | `(on: boolean) => void` | The CUSTOM POSITION button is clicked. |
| `onEditChrome` | `(on: boolean) => void` | The EDIT LAYOUT button is clicked. |
| `onResetQueue` | `() => void` | The QUEUE section's reset button is clicked. |
| `onResetMusic` | `() => void` | The PLAYER section's reset button is clicked. |
| `onResetCarousel` | `() => void` | The SONGS section's reset button is clicked. |
| `onResetChrome` | `() => void` | The SCREEN section's reset button is clicked. |
| `onClose` | `() => void` | The `✕` is clicked. |
| `onClosed` | `() => void` | The exit animation has finished. |
| `onOffset` | `(o: ChromeOffset) => void` | The panel is dragged in edit mode. |

---

## UI Interactions & Edge Cases

### 1. The panel is a hub, not an editor

**Edit mode is deliberately NOT persisted.** It is a state you enter,
rearrange in, and leave through the floating **SAVE LAYOUT** button — the
saved rectangles are what persist.

So the panel's own job is:

1. **START** the edit session (`EDIT LAYOUT`).
2. Say **what can be moved** and **how**.
3. Offer a **reset** for anything that has been moved.
4. Offer the lyrics' **custom position** toggle.

It does **not** draw the frames, the dots or the handles. Those belong to
`LayoutFrame` in the stage, not here.

### 2. The five regions

Each region is a heading, a state readout, and a control.

| Region | Heading | Readout | Control |
| --- | --- | --- | --- |
| Lyrics | `LYRICS` | `SAVED RECTANGLE` (only when lyrics are enabled) | `CUSTOM POSITION` toggle |
| Queue | `QUEUE` | `SAVED` / `DOCKED` | reset button |
| Player | `PLAYER` | `SAVED` / `DOCKED` | reset button |
| Songs | `SONGS` | `SAVED` / `DOCKED` | reset button |
| Screen | `SCREEN` | `MOVED` (only when something has been moved) | `EDIT LAYOUT` + reset button |

The readouts use two different words on purpose:

- **`SAVED` / `DOCKED`** — a panel that has a saved rectangle versus one that
  is back in its default docked slot.

### 3. The lyrics section — one rectangle, one place

The lyrics keep **one** rectangle of their own. Editing (not this toggle) is
what rearranges: it saves into that rectangle. So the heading carries the hint
`SAVED RECTANGLE` — **only when the lyrics are enabled**. With the lyrics off
there is no rectangle to save into, and the hint is hidden rather than showing
a lie.

The `CUSTOM POSITION` button:

- Is **disabled** when `!lyricsEnabled` — title *"Turn the lyrics on first"*.
- Is **disabled** when `editChrome` — title *"Editing now — finish with SAVE
  LAYOUT"*. Two edit modes at once would fight over the same rectangles.
- Is **disabled** when neither applies — title *"Let the lyrics keep their
  own saved position"*.
- Reads `CUSTOM POSITION` when off and `CUSTOM POSITION: ON` when on.
- Carries `aria-pressed`.
- When on, it is emerald (`bg-emerald-400/15 text-emerald-200`); when off it
  is plain.

> The on/beside-disc position buttons were **removed** from the lyrics
> settings panel: the lyrics are freely movable in the layout editor, so a
> fixed position choice had nothing to choose.

### 4. The three panel regions — drag + resize, reset

Each of QUEUE, PLAYER and SONGS is the same shape:

- A row with a hint on the left and a reset button on the right, inside a
  `bg-white/[0.03]` rounded container.

| Region | Hint text |
| --- | --- |
| QUEUE | `DRAG + RESIZE IN EDIT MODE` |
| PLAYER | `DRAG + RESIZE IN EDIT MODE` |
| SONGS | `CYLINDER ABOVE PLAYER` |


The **reset button**:

- Is a `RotateCcw` icon in a `w-9` square.
- Is **disabled** when the region has no saved rectangle.
- Has an `aria-label`: *"Reset queue panel layout"*, *"Reset player layout"*,
  *"Reset carousel layout"*.
- Has a title naming what it does, e.g.
  *"Drop the saved queue panel position and dock it back"*.

### 5. The SCREEN region — start the session and reset it

A `grid-cols-[1fr_auto]` grid: the wide `EDIT LAYOUT` button and a `w-9`
reset button beside it.

**EDIT LAYOUT:**

- Carries `aria-pressed`.
- Reads `EDIT LAYOUT` when idle and `EDITING LAYOUT…` while a session runs.
- When a session is running it is filled (`bg-white/90 text-black`); when
  idle it is plain.
- Has a `Hand` icon.
- Title: *"Move every button, header control and panel — the three stage
  panels get resize handles too"*.

**The screen reset:**

- Is **disabled** unless `chromeEdited`.
- `aria-label="Reset screen layout"`.
- Title: *"Put every button and panel back where it started"*.

### 6. The footer — the rules of the edit session

A single caption at the bottom states everything the editor does, so the
session is self-explanatory:

```
EDIT LAYOUT starts the one edit session · every button, header control and
panel moves on its own · dots resize the three stage panels · movement is free
(nothing is clamped) · the floating SAVE LAYOUT button finishes · RESET puts
the chrome back · the lyrics keep one rectangle of their own
```

Every clause in that sentence is a contract:

- **One** edit session at a time.
- Every button, header control and panel moves **on its own** — they are not
  dragged together.
- The **dots** (not the edges) resize the three stage panels.
- **Movement is free** — a surface may be placed anywhere, including past the
  window edge. Nothing clamps, snaps or nudges it back.
- The floating **SAVE LAYOUT** button finishes the session.
- **RESET** puts the chrome back.
- The lyrics keep **one rectangle of their own**.

### 7. Position

- `w-60` (240 px) wide.
- With `pos`: `left` is clamped to `[8, window.innerWidth - 240 - 8]`,
  `top` to `[8, window.innerHeight - 360]`.
- Without `pos`: the fallback position `left: 5%`, `top: 13%`.

### 8. Close protocol

Two-stage: the parent sets `closing = true`, the panel adds `is-closing`, and
**200 ms later** it calls `onClosed()`.

---

## House rules (shared by every panel in this app)

| Rule | Detail |
| --- | --- |
| **Chrome** | `settings-panel` (entrance/exit animation + hairline scrollbar), `panel-resizable` (native corner resizer, `min-width: 210px`, `min-height: 150px`), `fx-blur` (the glass blur), `thin-scroll` (3 px hairline). |
| **Typography** | Mono, uppercase, wide letter-spacing micro-labels. Section labels are `text-[8px] tracking-[0.2em] text-white/35`. |
| **Touch targets** | `.qp-pill-sm` is the house size: **24 px** tall, `10.5px` font, `r8`. |
| **Glass** | `data-liquid-ignore` marks a surface the liquid-glass lens must skip. |
| **Layout editor** | `useChromeDrag({ editing, offset, onOffset })` returns `{ editClass, style, onPointerDown, onClickCapture }`. Wire `editClass` onto the class list, `style` onto the `style` prop, and the two handlers onto the root as `onPointerDownCapture` / `onClickCapture`. Movement is **unbounded** — nothing is clamped. |
| **Accessibility** | Every icon-only button needs an `aria-label`. Toggles use `aria-pressed`. Disclosure rows use `aria-expanded`. |
| **Motion** | The house curve is `cubic-bezier(0.22, 1, 0.36, 1)`. Respect `prefers-reduced-motion`. |
