# Panel House Rules — shared conventions

> **Applies to:** every panel spec in `app/docs/specs/`.
>
> Read this first. It is the vocabulary the six specs are written in, and the
> conventions a rebuilt panel must keep to look and behave like the rest of
> the app.

---

## 1. What a "panel" is here

Every floating surface in the app is a **panel**: a small card that opens
anchored under a corner knob, blurs the wallpaper behind it, and closes with
an animation. They are the app's chrome vocabulary.

The exception is `PlayerSettingsPanel`, which is a **card**: it dismisses on
click-away rather than animating out.

---

## 2. The class recipe

```tsx
<div
  data-liquid-ignore
  className={`settings-panel panel-resizable fx-blur fixed z-[88] w-64
    overflow-y-auto overscroll-contain rounded-2xl border border-white/15
    bg-black/85 p-4 backdrop-blur-md${closing ? ' is-closing' : ''}
    ${drag.editClass}`}
  style={{ ...style, ...drag.style }}
  onPointerDownCapture={drag.onPointerDown}
  onClickCapture={drag.onClickCapture}
>
```

| Class | What it does |
| --- | --- |
| `settings-panel` | The entrance animation (`panel-in`, 200 ms) and the exit (`is-closing` → `panel-out`, 160 ms). Also the **hairline scrollbar** — every panel ships the 3 px thumb, so no panel may show the browser's default bar. |
| `panel-resizable` | The native corner resizer, restyled as a thin glass diagonal line. Makes the panel a scroll container (`overflow: auto`) — which its contents needed anyway. `min-width: 210px`, `min-height: 150px`. |
| `fx-blur` | The glass blur. The wallpaper's own BLUR switch turns it off globally. |
| `thin-scroll` | For an **inner** scroll region (the lyrics provider list), so the hairline is applied there too. |
| `rounded-2xl border border-white/15 bg-black/85 backdrop-blur-md` | The house glass. |
| `z-[88]` | The house panel band. `z-[87]` for the wallpaper panel, `z-[89]` for the radio and visualiser panels, `z-[95]` for a portal flyout. |
| `data-liquid-ignore` | Marks the surface so the liquid-glass lens skips it. |
| `overscroll-contain` | A scrolling panel must not chain-scroll the page behind it. |

---

## 3. The close protocol — two stages

A panel is **never** unmounted the instant it is asked to close. The exit
animation has to be allowed to run.

```tsx
// in the parent
const [open, setOpen] = useState(false)
const [closing, setClosing] = useState(false)

// in the panel
useEffect(() => {
  if (!closing || !onClosed) return
  const t = window.setTimeout(onClosed, 200)
  return () => window.clearTimeout(t)
}, [closing, onClosed])
```

1. The parent sets `closing = true`.
2. The panel adds `is-closing` to its class list.
3. **200 ms later** the panel calls `onClosed()`, and the parent unmounts.

The panel **must keep mounting** during that window.

`RadioPanel` is the one exception: it plays its own exit and calls `onClose`
after **280 ms**, using the `panel-out-soft` class.

---

## 4. The layout editor

`useChromeDrag({ editing, offset, onOffset })` gives a surface drag support
during an edit session. It returns four things, and all four must be wired:

| Returned | Wire to |
| --- | --- |
| `editClass` | the class list (a class string) |
| `style` | the `style` prop (merged with the panel's own position style) |
| `onPointerDown` | the root's `onPointerDownCapture` |
| `onClickCapture` | the root's `onClickCapture` |

The rules the hook enforces, which a rebuild must not fight:

- The saved value is an **offset** (`{ dx, dy }`), not a rectangle. Buttons
  live in flex groups and panels are anchored by their own CSS, so the honest
  unit is "how far has the user moved this from where it belongs".
- The offset is applied with the CSS **`translate` property**, which composes
  with — and never overwrites — an element's own `transform` (centering
  utilities, panel entrance animations, hover scales).
- Movement is **unbounded**. A surface may be placed anywhere, including past
  the window edge. Nothing clamps, snaps or nudges it back. RESET SCREEN in
  the Customize hub is the way back.
- Gestures follow three rules: a **4 px threshold** so a click stays a click;
  **window-level** listeners so no pointer capture retargets anything; and a
  **capture-phase click swallow** after a real drag, so dropping a button does
  not also press it.

---

## 5. Anchoring

A panel that opens from a corner knob is positioned from the knob's
rectangle, and the position is **clamped so it can never fall off the
window**:

```ts
const PANEL_W = 256   // the panel's own width
left = Math.min(Math.max(pos.x, 8), Math.max(8, window.innerWidth - PANEL_W - 8))
top  = Math.min(pos.y, Math.max(8, window.innerHeight - 320))
```

With no `pos`, the panel keeps a fixed fallback position
(`left: 5%`, `top: 13%` — or `top: 20%` for the player-settings card).

**Height is bounded, not measured.** Measuring the panel's height would mean a
resize observer feeding a re-render on every frame of the opening animation —
and a panel that is re-rendered while it animates **never finishes animating**.

---

## 6. Typography

| Level | Class |
| --- | --- |
| Panel title | `font-mono text-[9px] tracking-[0.25em] text-white/50` |
| Section label | `font-mono text-[8px] tracking-[0.2em] text-white/35` |
| Readout | `font-mono text-[8px] text-white/40` |
| Control label | `font-mono text-[9px] tracking-[0.15em] text-white/50` |
| Body text | `text-[11px] text-white/75` |

Everything is **mono and uppercase**. Micro-labels are the app's voice.

---

## 7. Controls

### Pill toggle

The house toggle is a 32 × 16 px pill:

- The **track** is the `<button>`, carrying `aria-label` **and**
  `aria-pressed`.
- Track: `bg-emerald-400/80` when pressed, `bg-white/15` when not.
- Knob: a 12 px white circle at `left: 18` when pressed, `left: 2` when not.

### Segmented buttons

A row of equal-width buttons; the selected one is `bg-white/90 text-black`,
the others `bg-white/5 text-white/50 hover:bg-white/10`.

The **chrome silver** variant is used where a step has a numeric value
(the crossfade lengths):

```tsx
style={{
  background: 'linear-gradient(145deg,#f4f7fa 0%,#c7ccd4 40%,#9aa2ac 70%,#e8ecf1 100%)',
  boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.9), 0 3px 10px rgba(0,0,0,0.5)',
}}
```

### Sliders

`className="chrome-range w-full"`.

### Icon buttons

A `h-6 w-6` grid square with `rounded-md`, `bg-white/5` → `hover:bg-white/10`.

### Touch targets

`.qp-pill-sm` is the house compact size: **24 px** tall, `10.5px` font, `r8`.

---

## 8. Accessibility

- Every icon-only button **must** carry an `aria-label`.
- Toggles use `aria-pressed`; disclosure rows use `aria-expanded`.
- Flyouts use `role="dialog"` + `aria-label`.
- The lyrics provider list's rows carry `data-provider-id`, `data-tier` and
  `data-available` — the harnesses read them.
- An error line carries `data-provider-error`.

---

## 9. Motion

- The house curve is `cubic-bezier(0.22, 1, 0.36, 1)`.
- The entrance is `panel-in` (200 ms), the exit `panel-out` (160 ms) or
  `panel-out-soft` (280 ms).
- **Use a transition, not a keyframe, for anything that must survive the fx
  governor.** The governor sets `animation: none !important` from tier 2 up,
  which would kill an entrance animation on any machine under load — a
  transition survives it.
- Respect `@media (prefers-reduced-motion: reduce)`.

---

## 10. Scrollbars

Every scroll region gets the hairline:

- `scrollbar-width: thin`
- `scrollbar-color: rgba(255,255,255,0.18) transparent`
- WebKit: a **3 px** thumb, `rgba(255,255,255,0.18)`, transparent track,
  hover `rgba(255,255,255,0.32)`.

The default fat white bar draws more attention than the content it scrolls —
it reads as a control, not a scroll.

---

## 11. Rules that are easy to break

Each of these cost a real bug in this codebase. Do not reintroduce them.

| Rule | Why |
| --- | --- |
| A scrolling flex child needs `min-h-0`. | Without it the child refuses to shrink and pushes the panel's footer off. |
| Do not unmount a panel on hide. | The lyrics element is kept alive so re-showing never re-fetches. |
| Do not use HTML5 drag-and-drop. | The DnD ghost lives in another process and lags the cursor in WebView2. Use pointer events. |
| Do not `setState` synchronously in an effect body. | The react-hooks compiler rejects it. Defer with a frame or a microtask, or use the `previous-key` render-phase pattern. |
| Do not write a ref during render. | Same rule. Mirror it in an effect. |
| Do not call `createObjectURL` inside JSX. | Every re-render mints a fresh URL and leaks the blob. Cache it in a **module-level** map. |
| Do not measure a panel's height to size it. | A resize observer feeding a re-render during the opening animation means the animation never finishes. |
| Do not put a keyframe entrance on a thing that must appear under load. | The fx governor kills keyframes from tier 2 up. Use a transition. |
| Do not hide a footer with `display: none` if its box carries layout. | The lyrics' scroll range is derived from the last element; `visibility: hidden` keeps the box, `display: none` zeroes it and the lyrics never scroll. |
| Do not let a "hide" or a dismissal swallow its own trigger. | The player-settings card would close and immediately re-open. Exclude the anchor with a data attribute. |
