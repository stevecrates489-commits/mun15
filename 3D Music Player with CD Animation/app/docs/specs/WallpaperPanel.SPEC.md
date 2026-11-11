# WallpaperPanel — Component Specification

> **Status:** v1.0 · **Applies to:** MUN15H — MD Walkman player (`app/`) · **Host:** Tauri 2 + React 19 + Vite 7
>
> This is a **contract**, not a description. An agent rebuilding the UI must
> satisfy every line here. Anything not written here is not part of the
> contract and may be changed freely; anything written here is load-bearing
> and is checked by the harnesses in `.verify/`.
>
> The shipped component is `WallpaperSettingsPanel.tsx` — the file name is
> historical; the panel is the **wallpaper** panel.

---

## Purpose

Configures the video/image wallpaper behind the player — the conversion
quality and frame rate, the playback speed, the blur and dim, the
pause-when-hidden switch, and the vault of saved wallpapers (a hover flyout).

---

## Props (Inputs)

```ts
interface Props {
  pendingWallFile: File | null
  wallQuality: WallPreset
  onPickQuality: (q: WallPreset) => void
  wallFpsTarget: number | null
  onFpsTarget: (n: number | null) => void
  wallStart: number
  onStart: (n: number) => void
  wallSpeed: number
  onSpeed: (s: number) => void
  wallBlur: boolean
  onBlurToggle: (v: boolean) => void
  wallDim: number
  onDim: (v: number) => void
  wallPauseHidden: boolean
  onPauseHiddenToggle: (v: boolean) => void
  videoPresent: boolean
  canConvert: boolean
  converting: boolean
  onConvert: () => void
  onClearCache: () => void
  savedWallpapers: WallpaperRecord[]
  onSwitchWallpaper: (rec: WallpaperRecord) => void
  onRemoveSaved: (id: string) => void
  onAddNew: () => void
  onClose: () => void
  closing?: boolean
  onClosed?: () => void
  editing?: boolean
  offset?: ChromeOffset
  onOffset?: (o: ChromeOffset) => void
}
```

| Prop | Type | Description |
| --- | --- | --- |
| `pendingWallFile` | `File \| null` | A video the user has imported but not yet converted. Non-null shows the "NEW VIDEO QUEUED" banner. |
| `wallQuality` | `WallPreset` | The conversion quality: `'performance' \| 'balanced' \| 'high' \| 'original'`. |
| `onPickQuality` | `(q: WallPreset) => void` | Choose the conversion quality. |
| `wallFpsTarget` | `number \| null` | Target frame rate, or `null` for **AUTO**. Range `FPS_MIN`=24 … `FPS_MAX`=90. |
| `onFpsTarget` | `(n: number \| null) => void` | Set the target frame rate; `null` means AUTO. |
| `wallStart` | `number` | Seconds into the video to start playback from. Clamped to `[0, MAX_SECONDS - 1]` where `MAX_SECONDS` = 35. |
| `onStart` | `(n: number) => void` | Set the start time in seconds. |
| `wallSpeed` | `number` | Playback speed: `1` (normal) or `0.75` (slow). |
| `onSpeed` | `(s: number) => void` | Set the playback speed. |
| `wallBlur` | `boolean` | Whether the wallpaper is blurred behind the player. |
| `onBlurToggle` | `(v: boolean) => void` | Toggle the blur. |
| `wallDim` | `number` | The dim percentage, `0`–`80`. |
| `onDim` | `(v: number) => void` | Set the dim percentage. |
| `wallPauseHidden` | `boolean` | Whether playback pauses while the window is hidden. |
| `onPauseHiddenToggle` | `(v: boolean) => void` | Toggle pause-when-hidden. |
| `videoPresent` | `boolean` | A video wallpaper is currently playing. Gates the **CLEAR VIDEO CACHE** button. |
| `canConvert` | `boolean` | Whether a conversion can be started right now (there is a pending file). |
| `converting` | `boolean` | A conversion is running. |
| `onConvert` | `() => void` | Start the conversion. |
| `onClearCache` | `() => void` | Remove the currently-playing wallpaper (frees its cached bytes). |
| `savedWallpapers` | `WallpaperRecord[]` | The vault of saved wallpapers. |
| `onSwitchWallpaper` | `(rec: WallpaperRecord) => void` | Wear a saved wallpaper (click its row). |
| `onRemoveSaved` | `(id: string) => void` | Delete one saved wallpaper by id. |
| `onAddNew` | `() => void` | Open the file picker to import a new wallpaper. |
| `onClose` | `() => void` | Request close. The parent sets `closing`. |
| `closing` | `boolean` | Optional, default `false`. `true` plays the exit animation. |
| `onClosed` | `() => void` | Optional. Called after the exit animation, so the parent can unmount. |
| `editing` | `boolean` | Optional, default `false`. The layout editor is running — the panel becomes draggable. |
| `offset` | `ChromeOffset` | Optional. The panel's saved drag offset (`{ dx, dy }`). |
| `onOffset` | `(o: ChromeOffset) => void` | Optional. Persist a new drag offset. |

### The `WallpaperRecord` shape (the vault's entries)

```ts
interface WallpaperRecord {
  id: string
  name: string
  width: number
  height: number
  fps: number
  sourceFps: number
  duration: number
  size: number            // bytes
  preset: WallPreset
  hdr: boolean
  converted: boolean
  created: number
  blob: Blob
  poster: Blob | null     // a still frame, when one could be made
  original?: File | null
  persisted?: boolean
}
```

---

## State & Hooks

| State | Type | Purpose |
| --- | --- | --- |
| `flyout` | `boolean` | Whether the "YOUR WALLPAPERS" flyout is open. |
| `anchor` | `{ top: number; left: number } \| null` | Where the flyout is placed on screen. |
| `armed` | `boolean` | The **CLEAR ALL** button is armed (first press) — the second press wipes the vault. |
| `closeTimer` | `useRef<number>` | The delayed-close timer for the flyout. |

### Hooks

| Hook | Purpose |
| --- | --- |
| `useChromeDrag({ editing, offset, onOffset })` | Layout-editor drag support. See *House rules*. |
| `useEffect` (closing) | Fires `onClosed` 200 ms after `closing` becomes `true`. |
| `useEffect` (armed timeout) | Un-arms `armed` after **3000 ms**. |
| `useEffect` (cleanup) | Clears the pending flyout close timer on unmount. |

### Module-level cache (important)

The thumbnail object URL for each saved wallpaper is cached in a
**module-level `Map`**, not in a ref or an effect.

- Minting the URL inside the JSX would mint a **fresh** URL on every
  re-render — dragging a slider over a vault of videos leaked hundreds of blob
  URLs into the session.
- `useMemo` + a cleanup effect is also wrong: React StrictMode's
  mount → unmount → remount cycle revokes every URL and hands the remount the
  same strings back (blank thumbnails, while clicking a record still worked
  because that path builds its own URL from the blob).
- Putting the mint in an effect is rejected by the react-hooks compiler.
- **A module is never re-evaluated**, so its entries survive the StrictMode
  cycle and are reused rather than resurrected.
- When the same record id comes back with a **different blob** (the record was
  re-imported), the old URL is revoked and a new one minted.
- Records the vault has dropped are pruned: their URLs are revoked.

---

## Event Handlers (Outputs)

| Handler | Signature | Fires when |
| --- | --- | --- |
| `onPickQuality` | `(q: WallPreset) => void` | A quality preset is clicked. |
| `onFpsTarget` | `(n: number \| null) => void` | The FPS slider moves; **RESET TO AUTO** passes `null`. |
| `onStart` | `(n: number) => void` | The start-seconds field changes. |
| `onSpeed` | `(s: number) => void` | `NORMAL 1.0×` or `SLOW 0.75×` is clicked. |
| `onBlurToggle` | `(v: boolean) => void` | The blur switch is clicked. |
| `onDim` | `(v: number) => void` | The dim slider moves. |
| `onPauseHiddenToggle` | `(v: boolean) => void` | The pause-when-hidden switch is clicked. |
| `onConvert` | `() => void` | The CONVERT button is clicked. |
| `onClearCache` | `() => void` | The CLEAR VIDEO CACHE button is clicked. |
| `onSwitchWallpaper` | `(rec: WallpaperRecord) => void` | A saved wallpaper's row is clicked. |
| `onRemoveSaved` | `(id: string) => void` | A saved wallpaper's `✕` is clicked, **or** CLEAR ALL is pressed a second time (once per record). |
| `onAddNew` | `() => void` | The ADD WALLPAPER button is clicked. |
| `onClose` | `() => void` | The `✕` is clicked. |
| `onClosed` | `() => void` | The exit animation has finished. |
| `onOffset` | `(o: ChromeOffset) => void` | The panel is dragged in edit mode. |

---

## UI Interactions & Edge Cases

### 1. The "YOUR WALLPAPERS" flyout — hover, portal-rendered, opens to the LEFT

The vault is **not** an in-panel list. A vault of videos used to stretch the
panel until its close button ran off the window. The panel keeps only the row
and the ADD button.

**The trigger.** The row is a hover target:

- `onMouseEnter` → `openFlyout()`
- `onMouseLeave` → `scheduleClose()`
- The row carries `aria-haspopup="true"` and `aria-expanded={flyout}`, and
  brightens while the flyout is open.

**It renders through a portal** (`createPortal(…, document.body)`), so the
panel's own `overflow` can never clip it. The flyout is
`role="dialog"`, `aria-label="Saved wallpapers"`.

**It opens to the LEFT.** The panel sits against the right edge of the window,
so there is no room on its right. The anchor is:

```
left = max(8, rowRect.left - 10 - FLYOUT_W)     // FLYOUT_W = 288
top  = max(8, min(rowRect.top - 8, window.innerHeight - 420))
```

**The close timer.** Leaving either the row **or** the flyout starts a
**260 ms** close timer. Crossing the gap keeps it up — the flyout's own
`onMouseEnter` clears the timer, and `onMouseLeave` restarts it. The timer is
a single ref, so a new hover cancels the pending close.

### 2. The vault rows

Each saved wallpaper is a row:

- A **56 × 32 px** thumbnail (`h-8 w-14`), `object-cover`, `rounded`.
  The thumbnail comes from `rec.poster` when there is one, otherwise from
  `rec.blob` when it is an image. A video with no poster renders an empty
  `bg-white/5` placeholder rectangle — **not** a broken image.
- The **name** (`rec.name || 'Untitled'`), truncated.
- A metadata line:
  - an image → `image · 12.3MB`
  - a video → `1920×1080 · 30fps · 12.3MB`, plus ` · original` when the record
    was never converted, plus ` · HDR` when it is.
- An `✕` delete button that **stops propagation** — clicking it must not also
  switch to the wallpaper being deleted.
- Clicking the row calls `onSwitchWallpaper(rec)`.

The footer hint reads: `CLICK A WALLPAPER TO WEAR IT · X DELETES IT`.

### 3. CLEAR ALL is armed, not instant

- The first press **arms** it: the label becomes `SURE?` and the button turns
  rose. Nothing is deleted yet.
- The second press wipes the vault: `onRemoveSaved(rec.id)` is called once per
  record.
- The arm **expires after 3000 ms**, and `onBlur` also un-arms it.
- The button is **disabled** when the vault is empty.

A slip of the finger must not be able to take the whole vault with it.

### 4. The empty vault

With no saved wallpapers the flyout shows a centred message:

```
NOTHING SAVED YET
CONVERT OR IMPORT A WALLPAPER — IT LANDS HERE
```

### 5. Quality, FPS and START AT are conditional on the preset

- The four quality buttons are always visible: `HIGH` (1080p), `BALANCED`
  (720p), `PERF` (480p), `ORIGINAL` (RAW).
- **The FPS slider, the RESET TO AUTO button and the START AT field only
  appear when `wallQuality !== 'original'`.** In ORIGINAL mode the file is
  stored and played as-is, so there is no frame rate to target and no
  conversion start point to choose.
- In ORIGINAL mode an amber notice replaces them:
  `ORIGINAL MODE — the file is stored and played as-is. Smooth only if your
  source already is.`
- When `wallQuality === 'original'` the FPS readout is irrelevant — it is not
  rendered.

### 6. The FPS slider

- Range `FPS_MIN` (24) to `FPS_MAX` (90).
- The readout shows the explicit target, or `AUTO (30)` / `AUTO (24)` when the
  target is `null` — 30 for `high` and `balanced`, 24 for `performance`.
- The slider's *value* is `wallFpsTarget ?? FPS_MIN` so the thumb sits at the
  bottom while AUTO is in force.
- **RESET TO AUTO** passes `null`.

### 7. The START AT field

- A number input, `min={0}`, `max={MAX_SECONDS - 1}` (i.e. 34).
- The value is clamped on change: `min(MAX_SECONDS - 1, max(0, value || 0))`.
- A non-numeric entry becomes `0`.

### 8. CONVERT occupies a fixed space

- The button row is `min-h-[34px]` and `items-stretch`, so **the panel never
  jumps** between the "convert" and "nothing to convert" states.
- When `canConvert` is false, a dashed-border placeholder reading
  `IMPORT A VIDEO TO CONVERT` occupies the same space.
- The button label is `⟳ CONVERT`, or `CONVERTING…` while `converting`.
- The button is disabled while converting.

### 9. The pending-file banner

When `pendingWallFile` is non-null, a cyan notice appears at the top:

```
NEW VIDEO QUEUED — PICK A QUALITY + FPS, THEN PRESS CONVERT
```

The panel is mounted by the parent only when `wall.wallBusy == null`, so the
panel itself is never in a converting state **and** showing this banner.

### 10. The two toggles

Both are the same 32 × 16 px pill with a 12 px white knob:

- knob `left: 18` when on, `left: 2` when off.
- track `bg-emerald-400/80` when on, `bg-white/15` when off.
- The track itself is the `<button>` and carries `aria-label`:
  - `"Toggle wallpaper blur"`
  - `"Toggle pause when hidden"`

### 11. Speed

Two buttons in a 2-column grid: `NORMAL 1.0×` and `SLOW 0.75×`. The selected
one is filled (`bg-white/90 text-black`).

### 12. ADD WALLPAPER

A full-width **dashed-outline** button at the bottom of the panel, with a
`Plus` icon and the label `ADD WALLPAPER`. It opens the file picker — the
panel does **not** own a file input; it calls `onAddNew()`.

### 13. CLEAR VIDEO CACHE

Only rendered when `videoPresent` is true. An amber hover marks it as
destructive.

### 14. Position

- The panel sits at `top-[24%]`, `left-[calc(95%-288px)]`, `w-72` (288 px).
- `max-h-[calc(100vh-180px)]`, `overflow-y-auto`, `overscroll-contain`.
- The panel scrolls internally; the flyout is a portal and is **not** clipped
  by it.

### 15. Close protocol

Two-stage, exactly like the other panels: the parent sets `closing = true`,
the panel adds `is-closing`, and **200 ms later** it calls `onClosed()`.

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
