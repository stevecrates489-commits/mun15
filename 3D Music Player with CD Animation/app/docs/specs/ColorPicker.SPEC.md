# ColorPicker — SPEC

> **Applies to:** `app/src/components/ColorPicker.tsx` (+ `app/src/lib/color.ts`)
>
> **Status:** v1.0 · **Read first:** [`_HouseRules.md`](_HouseRules.md)
>
> This is the **wallpaper colour** half of the picker card. The **gradient**
> half — the two stops, the angle, the saved-preset library — is specified
> separately in [`GradientPicker.SPEC.md`](GradientPicker.SPEC.md). Both halves
> are **one component**: `ColorPicker.tsx` renders a single card that is in
> `SOLID` mode or `GRADIENT` mode. Read both documents before rebuilding.

---

## 1. Purpose

A 264 px popup card that edits the wallpaper's **paint**: one flat colour,
chosen from a saturation × value square, a hue strip and an alpha strip, plus
an 8-digit hex field. It is a **controlled** component — the paint itself
lives in `useWallpaper` (`wallPaint` / `setWallPaint`); the card only edits and
reports.

The card opens from a **swatch button in the header's left cluster** (the
`hdr-color` surface) and is anchored directly beneath it.

---

## 2. Props (Inputs)

The prop interface is **local, not exported** (`ColorPicker.tsx:13-17`):

```tsx
interface Props {
  paint: Paint
  onChange: (next: Paint) => void
  onClose: () => void
}
```

Component signature (`ColorPicker.tsx:67`):

```tsx
export default function ColorPicker({ paint, onChange, onClose }: Props) {
```

| Prop | Type | Meaning |
| --- | --- | --- |
| `paint` | `Paint` | The current paint. **Controlled** — the card never stores the paint itself. |
| `onChange` | `(next: Paint) => void` | Fired on **every** colour edit. In the app this is `wall.setWallPaint`, which writes `localStorage['md-wall-paint']` on **every call** — once per pointermove during a drag. |
| `onClose` | `() => void` | Fired by the card's ✕ button and by Escape. In the app: `() => setColorPickerOpen(false)` — **immediate unmount, no exit animation**. |

### 2.1 The supporting types (`app/src/lib/color.ts`)

```ts
export interface Hsv {
  /** 0..360 */ h: number
  /** 0..1 */   s: number
  /** 0..1 */   v: number
  /** 0..1 */   a: number
}

export type Paint =
  | { kind: 'solid'; color: Hsv }
  | { kind: 'gradient'; gradient: WallGradient }
```

`WallGradient` is covered in [`GradientPicker.SPEC.md`](GradientPicker.SPEC.md) §2.

### 2.2 How Home mounts it (`Home.tsx:2025-2049`)

```tsx
{colorPickerOpen && (
  <>
    {/* click-away layer: any click outside the card dismisses it */}
    <button
      aria-label="Close colour picker"
      onClick={() => setColorPickerOpen(false)}
      className="fixed inset-0 z-[94] cursor-default"
    />
    <DraggableSurface id="panel-color-picker" editing={isEditingLayout}
      offset={chromeLayout.offsets['panel-color-picker']} onOffset={chromeLayout.setOffset}>
      <div className="absolute left-0 top-7 z-[95]">
        <ColorPicker paint={wall.wallPaint} onChange={wall.setWallPaint}
          onClose={() => setColorPickerOpen(false)} />
      </div>
    </DraggableSurface>
  </>
)}
```

The card is anchored `absolute left-0 top-7 z-[95]`, above a z-94 click-away
button, and is itself draggable during a layout edit session.

---

## 3. State & Hooks

### 3.1 Local state

| Name | Type | Purpose |
| --- | --- | --- |
| `hexText` | `useState<string>` | The **visible** text of the hex field. Initialised lazily: `hsvToHex8(paint.kind === 'solid' ? paint.color : paint.gradient.from)` (`:73`). Always an 8-digit `#RRGGBBAA` uppercase string. |
| `stop` | `useState<'from' \| 'to'>` | Which gradient stop the axes edit. Initial `'from'` (`:80`). Irrelevant in solid mode, but retained. |
| `presets` | `useState<GradientPreset[]>(readPresets)` | The saved-gradient library, **read once per mount** from `localStorage['md-wall-gradient-presets']`. |
| `naming` | `useState(false)` | Whether the "NAME THIS GRADIENT" input is showing instead of the SAVE PRESET button. |
| `nameDraft` | `useState('')` | Text of that input. |
| `renamingId` | `useState<string \| null>` | `id` of the preset currently being renamed, or `null`. |
| `renameDraft` | `useState('')` | Text of the rename input. |
| `hexDraft` | `useState<string \| null>` | The **raw typed** hex, pending commit. `null` = nothing pending. Set on every keystroke; cleared by `commitHex` (`:231`). |

### 3.2 Refs

| Ref | Type | Purpose |
| --- | --- | --- |
| `svRef` | `useRef<HTMLDivElement>(null)` | The saturation × value square. |
| `hueRef` | `useRef<HTMLDivElement>(null)` | The hue strip. |
| `alphaRef` | `useRef<HTMLDivElement>(null)` | The alpha strip. |

### 3.3 Derived values (not state)

```tsx
const isGradient = paint.kind === 'gradient'                       // :75
const grad  = paint.kind === 'gradient' ? paint.gradient : null     // :76
const solid = paint.kind === 'solid'    ? paint.color    : null     // :77
const value: Hsv = grad ? (stop === 'from' ? grad.from : grad.to) : (solid as Hsv)  // :85
```

`value` is the colour the axes currently edit. Its **object identity** is the
dependency of the hex-sync effect — a rebuild must preserve identity stability
or the hex field will fight the user.

### 3.4 Hooks

| Hook | Line | Notes |
| --- | --- | --- |
| `useEffect(() => { setHexText(hsvToHex8(value)) }, [value])` | `:87-89` | Re-syncs the hex field whenever the edited colour object changes identity. **This is why typing in the hex field is safe**: typing does not change `value`. |
| `useEffect` (Escape) | `:192-201` | `window.addEventListener('keydown', onKey, true)` — **capture phase**; `e.stopPropagation()` then `close()`. |
| `useCallback` `setValue` | `:92-104` | deps `[grad, solid, stop, onChange]`. Writes the edited colour back into whichever shape of paint is active. |
| `useCallback` `setMode` | `:108-124` | deps `[grad, solid, onChange]`. Solid ⇄ gradient **conversion**, never a reset. |
| `useCallback` `swapStops` | `:165-168` | Gradient only — see the Gradient spec. |
| `useCallback` `setAngle` | `:170-176` | Gradient only. |
| `useCallback` `commitDraft` | `:182-186` | deps `[hexDraft, setValue]`. |
| `useCallback` `close` | `:187-190` | deps `[commitDraft, onClose]`. **Every exit path goes through it.** |
| `useCallback` `dragOn` | `:203-223` | deps `[]`. The shared pointer-drag engine — see §7.3. |

### 3.5 State that lives in the PARENT (controlled)

| Parent state | Where | Notes |
| --- | --- | --- |
| `wallPaint: Paint` | `useWallpaper.ts:69-83` | Initialised from `localStorage['md-wall-paint']` via `parsePaint`; falls back to the legacy `localStorage['md-wall-color']` (an old bare `Hsv` JSON) and then to `{ kind:'solid', color: DEFAULT_WALL_COLOR }`. |
| `hasWallPaint: boolean` | `useWallpaper.ts:86-92` | `true` if either `md-wall-paint` or `md-wall-color` exists in storage. Set `true` by `setWallPaint`. |
| `theme: Theme` | `useWallpaper.ts:57-63` | `setWallPaint` forces `theme = 'color'` (and writes `md-theme`). The wallpaper layer only renders when `theme === 'color'` (`Home.tsx:1783-1785`). |
| `colorPickerOpen: boolean` | `Home.tsx:158` | Mount/unmount of the whole card. |

---

## 4. Event Handlers (Outputs)

### 4.1 To the parent

| Callback | Signature | Fires when |
| --- | --- | --- |
| `onChange(next)` | `(next: Paint) => void` | Any paint mutation: SV-square drag, hue drag, alpha drag, hex commit, angle slider change, mode toggle, stop swap, preset apply. **Once per pointermove while dragging.** |
| `onClose()` | `() => void` | The card's ✕ button (`:245`) and the Escape key (`:194-198`). **Not** called by the click-away backdrop (see §7.1). |

Exact shapes emitted by `onChange` in solid mode:

```tsx
onChange({ kind: 'solid', color: next })
```

In gradient mode:

```tsx
onChange({ kind: 'gradient', gradient: stop === 'from' ? { ...grad, from: next } : { ...grad, to: next } })
```

Mode → gradient from solid (`ColorPicker.tsx:114-121`):

```tsx
onChange({ kind: 'gradient', gradient: grad ?? {
  from: (solid as Hsv),
  to: DEFAULT_WALL_GRADIENT.to,
  angle: DEFAULT_WALL_GRADIENT.angle,
} })
```

Mode → solid (`:111`):

```tsx
onChange({ kind: 'solid', color: grad ? grad.from : (solid as Hsv) })
```

### 4.2 Internal handlers

| Name | Line | Trigger |
| --- | --- | --- |
| `setMode(kind)` | `:108` | SOLID / GRADIENT buttons. |
| `setStop(s)` | `:288` | Clicking the A or B stop chip. |
| `swapStops()` | `:308` | Clicking the ⇄ button. |
| `setAngle(n)` | `:328` | `onChange` of the angle range. |
| `savePreset()` | `:133-149` | Enter in the name input, or the emerald ✓ button. |
| `commitRename(id)` | `:150-158` | Enter, blur, or the ✓ button in a renaming row. |
| `applyPreset(p)` | `:159-161` | Clicking a preset's name. |
| `commitHex(raw)` | `:227-232` | Blur of the hex field, or Enter in it. |
| `commitDraft()` | `:182-186` | Called by `close()`. Parses `hexDraft`; applies only if valid. |
| `close()` | `:187-190` | ✕ button, Escape. Commits the pending hex, then `onClose()`. |
| `dragOn(el, e, apply)` | `:203-223` | `onPointerDown` of the three widgets. |

---

## 5. UI structure — exhaustive

### 5.0 Card shell (`:234-239`)

```tsx
<div
  className="pop-in max-h-[calc(100vh-24px)] w-[264px] overflow-y-auto overscroll-contain rounded-2xl border border-white/12 bg-[#0c0c11]/95 p-3 shadow-[0_24px_60px_rgba(0,0,0,0.75)] backdrop-blur-md"
  role="dialog"
  aria-label="Wallpaper colour"
>
```

- `role="dialog"`, `aria-label="Wallpaper colour"`. **No `aria-modal`.**
- Hard-coded colours: background `#0c0c11` at 95 % (`bg-[#0c0c11]/95`), border `white/12`, shadow `rgba(0,0,0,0.75)`.
- `pop-in` = `div.pop-in { animation: pop-in 180ms ease-out both !important; }`
  (`index.css:401-403`), keyframes `opacity 0 / translateY(6px)` → `opacity 1 / none`
  (`index.css:308-311`).
- **No `settings-panel`, no `fx-blur`, no `thin-scroll`, no
  `data-liquid-ignore`** — this card does **not** follow the house panel
  recipe in `_HouseRules.md`. It is a header popover, not a corner panel.

### 5.1 Title row (`:240-251`)

- Label span: `className="font-mono text-[9px] tracking-[0.25em] text-white/50"`,
  text = **`WALLPAPER GRADIENT`** when gradient, **`WALLPAPER COLOUR`** when
  solid (British `COLOUR`).
- ✕ button: `aria-label="Close colour picker"`, `className="grid h-5 w-5
  place-items-center rounded-full text-white/40 transition hover:bg-white/10
  hover:text-white"`, icon `X` from `lucide-react`, `size={11}`.

> **Trap:** the click-away backdrop in `Home.tsx` carries the **same**
> `aria-label="Close colour picker"`. Both exist simultaneously.

### 5.2 Mode toggle (`:254-269`)

```tsx
<div className="mb-2.5 grid grid-cols-2 gap-1">
  {(['solid', 'gradient'] as const).map((m) => (
    <button key={m} onClick={() => setMode(m)}
      aria-pressed={(m === 'gradient') === isGradient}
      className={`rounded-lg py-1 font-mono text-[8px] tracking-[0.18em] transition ${
        (m === 'gradient') === isGradient
          ? 'bg-white/90 text-black'
          : 'bg-white/5 text-white/50 hover:bg-white/10 hover:text-white'}`}>
      {m === 'solid' ? 'SOLID' : 'GRADIENT'}
    </button>
  ))}
</div>
```

- Two options, labels **`SOLID`** and **`GRADIENT`**.
- Selected: `bg-white/90 text-black`. Unselected: `bg-white/5 text-white/50
  hover:bg-white/10 hover:text-white`.
- `aria-pressed` is `(m === 'gradient') === isGradient` — true for SOLID when
  not gradient, true for GRADIENT when gradient.

### 5.3 Live preview (`:273-277`)

```tsx
<div aria-hidden
  className="mb-2.5 h-8 w-full rounded-lg border border-white/12"
  style={{ background: isGradient && grad ? gradientCss(grad) : hsvToCss(value) }} />
```

32 px tall, full width, `aria-hidden`, `border-white/12`. Background = the
real gradient (`gradientCss`) in gradient mode, the flat colour (`hsvToCss`) in
solid mode.

### 5.4 Gradient block

**Only rendered when `isGradient && grad`** (`:279-441`). Fully specified in
[`GradientPicker.SPEC.md`](GradientPicker.SPEC.md) §5.

### 5.5 Saturation × value square (`:444-460`) — always present

```tsx
<div ref={svRef}
  onPointerDown={(e) => dragOn(svRef.current, e, (x, y, w, h) =>
    setValue({ ...value, s: clamp01(x / w), v: clamp01(1 - y / h) }))}
  className="relative h-32 w-full cursor-crosshair overflow-hidden rounded-xl"
  style={{ background: `hsl(${value.h} 100% 50%)` }}>
  <div className="pointer-events-none absolute inset-0" style={{ background: 'linear-gradient(to top,#000,transparent)' }} />
  <div className="pointer-events-none absolute inset-0" style={{ background: 'linear-gradient(to right,#fff,transparent)' }} />
  <span className="pointer-events-none absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.55),0_1px_4px_rgba(0,0,0,0.6)]"
    style={{ left: `${value.s * 100}%`, top: `${(1 - value.v) * 100}%`, background: hsvToCss({ ...value, a: 1 }) }} />
</div>
```

- 128 px tall (`h-32`), full width, `cursor-crosshair`, `rounded-xl`.
- Base = `hsl(H 100% 50%)` of the current hue.
- Two overlays **in this DOM order**: black `linear-gradient(to top,#000,transparent)`
  (value axis) then white `linear-gradient(to right,#fff,transparent)`
  (saturation axis). Because the second is painted on top, the left edge of
  the square reads white — the saturation gradient visually wins over the
  value gradient. This is the shipped behaviour; reproduce the DOM/CSS
  verbatim or consciously invert it.
- Handle: 14 px circle, `border-2 border-white`, `shadow-[0_0_0_1px_rgba(0,0,0,0.55),0_1px_4px_rgba(0,0,0,0.6)]`,
  positioned `left = s*100%`, `top = (1-v)*100%`, filled with
  `hsvToCss({ ...value, a: 1 })` (**alpha forced to 1**).

### 5.6 Hue strip (`:463-476`) — always present

```tsx
<div ref={hueRef}
  onPointerDown={(e) => dragOn(hueRef.current, e, (x, _y, w) => setValue({ ...value, h: clamp01(x / w) * 359.99 }))}
  className="relative mt-2.5 h-3 w-full cursor-pointer rounded-full"
  style={{ background: 'linear-gradient(to right,#f00 0%,#ff0 17%,#0f0 33%,#0ff 50%,#00f 67%,#f0f 83%,#f00 100%)' }}>
  <span className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.55)]"
    style={{ left: `${(value.h / 360) * 100}%`, background: `hsl(${value.h} 100% 50%)` }} />
</div>
```

- 12 px tall (`h-3`), `rounded-full`, `cursor-pointer`, `mt-2.5`.
- Hard-coded rainbow: `#f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%`.
- Handle: 16 px circle, `border-2 border-white`, `shadow-[0_0_0_1px_rgba(0,0,0,0.55)]`,
  `left = (h/360)*100%`, fill `hsl(H 100% 50%)`.

### 5.7 Alpha strip + hex field (`:478-513`) — always present

```tsx
<div className="mt-2.5 flex items-center gap-2">
  <div ref={alphaRef}
    onPointerDown={(e) => dragOn(alphaRef.current, e, (x, _y, w) => setValue({ ...value, a: clamp01(x / w) }))}
    className="relative h-3 flex-1 cursor-pointer overflow-hidden rounded-full"
    style={{
      backgroundColor: '#1b1b22',
      backgroundImage: `linear-gradient(to right, transparent, ${hsvToCss({ ...value, a: 1 })}), repeating-conic-gradient(#3a3a44 0% 25%, #202027 0% 50%)`,
      backgroundSize: 'auto, 8px 8px',
    }}>
    <span className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,0.55)]"
      style={{ left: `${value.a * 100}%`, background: hsvToCss(value) }} />
  </div>
  <input value={hexText}
    onChange={(e) => { setHexText(e.target.value); setHexDraft(e.target.value) }}
    onBlur={() => commitHex(hexText)}
    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitHex(hexText); (e.target as HTMLInputElement).blur() } }}
    spellCheck={false} aria-label="Hex colour"
    className="w-[92px] shrink-0 rounded-lg border border-white/15 bg-white/5 px-2 py-1 text-right font-mono text-[10px] uppercase tracking-wider text-white outline-none transition focus:border-white/40" />
</div>
```

- Alpha strip: `flex-1` (shrinks to fit the hex field), 12 px tall,
  `rounded-full`, `overflow-hidden`.
- Hard-coded colours: base `#1b1b22`; checkerboard
  `repeating-conic-gradient(#3a3a44 0% 25%, #202027 0% 50%)` with
  `backgroundSize: 'auto, 8px 8px'`; the opacity ramp
  `linear-gradient(to right, transparent, <opaque colour>)` painted **on top of**
  the checkerboard.
- Alpha handle: 16 px circle, fill `hsvToCss(value)` (keeps its own alpha),
  `left = a*100%`.
- Hex field: `type` defaults to `text` (no explicit `type`), 92 px wide,
  right-aligned, `font-mono text-[10px] uppercase tracking-wider`,
  `border-white/15 bg-white/5`, focus `border-white/40`,
  `aria-label="Hex colour"`, `spellCheck={false}`.

---

## 6. The colour model

### 6.1 Representation

**HSV + alpha, everywhere.** `Hsv = { h: 0..360, s: 0..1, v: 0..1, a: 0..1 }`.
There is no RGB in the model; conversion to RGB happens only at the CSS
boundary (`color.ts:26-51`).

`hsvToRgb` uses the classic `c / x / m` formulation; `rgbToHsv` is the
standard max/min form. `hsvToCss` → `rgba(r,g,b,a)` with alpha clamped to
0..1 and rounded to 3 dp:

```ts
return `rgba(${r},${g},${b},${Math.round(clamp01(c.a) * 1000) / 1000})`
```

`hsvToHex8` → `#RRGGBBAA` uppercase (what the hex field shows). `hsvToHex` →
`#RRGGBB` uppercase (used only in `paintLabel` / `wallPaintLabel`:
`SOLID #8A38F5` / `GRADIENT #8A38F5 → #154A73`).

### 6.2 Shipped constants

```ts
// color.ts:22
export const DEFAULT_WALL_COLOR: Hsv = { h: 266, s: 0.77, v: 0.96, a: 1 }        // ≈ #8A38F5
```

There is **no built-in colour swatch grid** in this app. The only shipped
constant is `DEFAULT_WALL_COLOR`.

Sibling header swatches (in `useWallpaper.ts`, **not** part of this card):
`black` (`#000`). The old flat `gradient` theme was removed and is migrated to
`aurora` (`lib/theme.ts:19-21`); the `aurora` ("Theme: moving gradient")
swatch was removed from the header entirely and the theme can no longer be
picked — only inherited from an existing profile.

### 6.3 Validation / clamping / normalisation

| Where | Rule |
| --- | --- |
| `hexToHsv` (`color.ts:79-100`) | Accepts `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `#` optional, whitespace trimmed. Returns `null` for anything else (non-hex chars, length 1/2/5/7). Alpha rounded to 3 dp. |
| `hexToHsv` short form | `#0AF` → `{h:200,s:1,v:1,a:1}`; `#rgba` alpha = `parseInt(dup,16)/255`. |
| `hsvToCss` | Alpha clamped to 0..1, rounded to 3 dp. |
| `hsvToHex8` / `hsvToHex` | Alpha clamped to 0..1 before quantising to 8 bits. |
| `hsvToRgb` | Hue wraps (`((h%360)+360)%360`). |
| `clamp01` (ColorPicker `:225`) | Local helper clamping to 0..1. Used for `s`, `v`, `h/359.99`, `a`. **Hue is capped at 359.99, never 360.** |
| `parsePaint` (`color.ts:165-189`) | Validates a persisted paint: `kind` must be `solid`/`gradient`; solid needs a full `Hsv`; gradient needs both stops; a non-finite angle falls back to `DEFAULT_WALL_GRADIENT.angle` (135). Any failure → `null` → the caller falls back to the default. |
| `isHsv` (`color.ts:153-162`) | All four of `h,s,v,a` must be `typeof 'number'`. |
| Hex field | On an invalid commit, the text is **reverted** to `hsvToHex8(value)` (`commitHex`, `:227-232`) — the field never keeps garbage. |

---

## 7. Interactions & edge cases

### 7.1 Open / close

- The card is mounted/unmounted by `colorPickerOpen` in `Home.tsx`. There is
  **no exit animation** — `onClose` unmounts immediately. The only motion is
  the `pop-in` entrance.
- **Click-away**: a `fixed inset-0 z-[94]` `<button aria-label="Close colour
  picker">` behind the card (`Home.tsx:2029-2033`). Its handler is
  `() => setColorPickerOpen(false)` — it **bypasses the card's `close()`**, so
  it does *not* run `commitDraft()`. In practice the pending hex still lands,
  because mousedown on the backdrop blurs the hex field and `onBlur →
  commitHex` runs first.
- **Escape**: the card listens on `window` in the **capture phase** (`:199`):

```ts
const onKey = (e: KeyboardEvent) => {
  if (e.key === 'Escape') { e.stopPropagation(); close() }
}
window.addEventListener('keydown', onKey, true)
```

  Because it is capture-phase on `window` and calls `stopPropagation()`,
  **no React `onKeyDown` inside the card ever sees Escape**. Consequences:
  - The name input's `Escape → setNaming(false)` branch (`:346-350`) is
    unreachable — Escape closes the whole card instead.
  - The rename input's `Escape → setRenamingId(null)` branch (`:399`) is
    likewise unreachable — Escape closes the card and the rename is lost.
  - Escape also stops the app-level Home keydown handler from seeing the key
    (Home's own Escape branch only matters in fullscreen).
  - `close()` runs `commitDraft()` first, so a typed-but-uncommitted hex **is**
    applied on Escape.

### 7.2 Keyboard

| Key | Where | Result |
| --- | --- | --- |
| `Escape` | window (capture) | Commit pending hex → `onClose()`. Blocks every other Escape handler in the card. |
| `Enter` | hex field | `preventDefault()`, `commitHex(hexText)`, then `.blur()` → also triggers `onBlur` → `commitHex` again (idempotent). |
| `Enter` | name input | `preventDefault()`, `savePreset()`. |
| `Enter` | rename input | `preventDefault()`, `commitRename(p.id)`. |
| `Tab` | anywhere | Standard. Blurring the hex field commits it; blurring the rename input commits the rename. |

### 7.3 Drag / pointer behaviour — the shared engine (`:203-223`)

```ts
const dragOn = useCallback((el: HTMLElement | null, e: React.PointerEvent,
  apply: (x: number, y: number, w: number, h: number) => void) => {
  if (!el) return
  e.preventDefault()
  const r = el.getBoundingClientRect()
  const move = (ev: PointerEvent) =>
    apply(ev.clientX - r.left, ev.clientY - r.top, r.width, r.height)
  move(e.nativeEvent)
  const up = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}, [])
```

Load-bearing details:

- **No pointer capture.** Tracking is via `window` `pointermove`/`pointerup`
  listeners, so a fast drag that leaves the widget keeps tracking — the
  intended behaviour, per the comment at `:59-66`.
- **No threshold.** `move(e.nativeEvent)` is called *immediately* on
  pointerdown: a plain click jumps the value to that point (standard for
  colour pickers).
- **No `pointercancel` handling** and **no unmount cleanup** — a cancelled
  pointer (touch) or an unmount mid-drag leaves the listeners attached.
- The rect `r` is measured **once at pointerdown**; scrolling mid-drag
  desynchronises the mapping.
- `e.preventDefault()` on pointerdown **suppresses the compatibility
  mousedown**, so clicking a widget does **not** blur the focused hex input.
- The `apply` closure captures `value` (and therefore `grad`/`solid`/`stop`)
  **from the render at pointerdown** — it is stale for the whole drag. Only
  one axis changes per widget, so it is harmless in practice, but a change to
  `grad.angle` made *during* a drag would be reverted by the stale `grad`
  spread.
- `clamp01` is applied per axis: SV → `s = x/w`, `v = 1 - y/h`; hue →
  `h = x/w * 359.99`; alpha → `a = x/w`.
- The drag calls `setValue` → `onChange` → `wall.setWallPaint` →
  **`localStorage.setItem` on every pointermove**.

### 7.4 Layout of the scroll region

There is **no swatch grid**. The only scrollable sub-region is the **preset
list** (`:380`): `mb-2.5 max-h-28 overflow-y-auto rounded-lg border
border-white/10 pr-0.5` — a single-column list, 112 px tall, default
scrollbar (no `thin-scroll`).

The card itself scrolls: `max-h-[calc(100vh-24px)] w-[264px] overflow-y-auto
overscroll-contain`.

### 7.5 Invalid / partial input

- Partial hex (`#F`, `#FF00`) in the field: allowed to sit there; nothing is
  applied until blur/Enter. The field is **not** reformatted while typing
  (the `useEffect([value])` does not fire because `value` did not change).
- Invalid hex on commit → the field is rewritten to the canonical
  `hsvToHex8(value)`; nothing is emitted.
- Invalid hex on close → `commitDraft()` parses, gets `null`, and emits
  nothing; the card just closes.
- **Stale-draft trap:** `hexDraft` survives drags. Typing `#ff0000`, then
  dragging the SV square (whose pointerdown `preventDefault()` blocks the blur
  that would have cleared the draft), then closing → `commitDraft()` applies
  the *typed* value and **undoes the drag**. A rebuild should decide whether
  to keep or fix this; it is the shipped behaviour.
- A corrupt preset entry (`gradient` missing stops) survives `readPresets` and
  throws when the row renders `gradientCss(p.gradient)`.

### 7.6 Focus / hover

- `autoFocus` on the name input (`:338`) and on the rename input (`:391`) —
  the rename input steals focus when a row enters rename mode.
- Hover states: ✕ (`hover:bg-white/10 hover:text-white`), mode buttons, stop
  chips (`hover:border-white/25`), swap (`hover:border-white/30 hover:text-white`),
  preset rows (`hover:bg-white/5`), preset names (`hover:text-white`), rename
  icon (`hover:bg-white/10 hover:text-white`), save-preset button
  (`hover:bg-white/10 hover:text-white`), emerald ✓
  (`hover:border-emerald-300/70`), rename ✓ (`hover:bg-white/10`).
- **No flyouts, no tooltips beyond `title`, no tooltips on the colour
  widgets.**
- No focus trap and no focus restore on close.

---

## 8. Hard requirements / traps

### 8.1 Storage keys

| Key | Written by | Shape |
| --- | --- | --- |
| `md-wall-paint` | `useWallpaper.setWallPaint` (`useWallpaper.ts:98`) | `JSON.stringify(Paint)` — `{"kind":"solid","color":{h,s,v,a}}` or `{"kind":"gradient","gradient":{"from":{...},"to":{...},"angle":n}}` |
| `md-wall-color` | legacy, **read only** now (`useWallpaper.ts:74`) | Old bare `Hsv` JSON, migrated to a solid paint on first load |
| `md-wall-gradient-presets` | `ColorPicker.writePresets` | JSON array of `{id,name,gradient:{from,to,angle}}`, max 40 |
| `md-theme` | `useWallpaper` | `'black' \| 'aurora' \| 'color' \| 'custom'`; forced to `'color'` by `setWallPaint` and `applyWallPaint` |
| `md-chrome-offsets` | `useChromeLayout` | Holds the picker's drag offset under the key `panel-color-picker` |

### 8.2 Load-bearing behaviour a rebuild must not change

1. **The paint is controlled.** The card must not keep its own copy of the
   paint; every edit goes out through `onChange` so `useWallpaper` persists
   it.
2. **Mode switching is a conversion, not a reset** (`setMode`, `:106-124`):
   solid → gradient uses the *current flat colour* as stop A,
   `DEFAULT_WALL_GRADIENT.to` as stop B and angle `135`; gradient → solid
   keeps **stop A** (`grad.from`) as the flat colour. Round-tripping solid →
   gradient **discards** the old stop B and the old angle (they revert to the
   defaults).
3. **Every exit path commits the hex first.** `close()` → `commitDraft()`.
   Unmounting an input never fires blur, so a typed value would otherwise
   vanish ("my colour was not saved"). Keep `hexDraft` separate from
   `hexText`.
4. **`onChange` fires on every pointermove.** `setWallPaint` writes
   `localStorage` each time — that is the shipped behaviour, including the
   localStorage write per drag frame.
5. **The card must be `role="dialog"` with `aria-label="Wallpaper colour"`**,
   and it must live under the header swatch at `absolute left-0 top-7 z-[95]`
   with a `fixed inset-0 z-[94]` click-away behind it.
6. **aria attributes** (exact strings): `dialog` / `Wallpaper colour`;
   buttons `Close colour picker`, `Swap gradient stops`, `Save gradient preset`,
   `Confirm rename`, `Rename gradient preset`, `Rename <name>`; inputs
   `Hex colour`, `Gradient preset name`; range `Gradient angle`;
   `aria-pressed` on both mode buttons and both stop chips; `aria-hidden` on
   the preview and the preset dots.
7. **Escape is handled on `window` in the capture phase with
   `stopPropagation()`** — keep the capture flag, or Escape will start
   reaching React handlers and double-fire.
8. **The hex field shows 8-digit `#RRGGBBAA` uppercase** (`hsvToHex8`), not
   6-digit. `hsvToHex` (6-digit) exists in `lib/color.ts` but is used only by
   `paintLabel` / `wallPaintLabel`.
9. **The hue drag caps at 359.99**, not 360.
10. **The SV square's two overlay gradients are in the shipped order** (black /
    value first, white / saturation second, the latter painting on top).
11. **This card does not use the house panel recipe** (`settings-panel` /
    `fx-blur` / `thin-scroll` / `data-liquid-ignore` / `panel-resizable`). It
    has its own `pop-in` entrance and no exit animation. If the rebuild
    adopts `_HouseRules.md`'s glass recipe wholesale it will change the look
    (the card is `bg-[#0c0c11]/95`, not `bg-black/85`).
12. **The header swatch is the trigger and must stay clickable** —
    `Home.tsx:1901-1930` — and its first click applies the saved paint
    (`applyWallPaint`) *before* toggling the picker open, so opening the
    picker never counts as "choosing a colour". The wall layer only renders
    while `theme === 'color'` (`Home.tsx:1783-1785`), and `setWallPaint`
    forces that theme.

### 8.3 Test coverage

`tests/paint.test.mts` (`node tests/paint.test.mts`, part of `npm run
test:unit`) pins the HSV↔hex conversions, the angle normalisation
(`360→0`, `-45→315`, `725→5`, `134.6→135`), the `paintLabel` formats, and
`parsePaint` tolerance (missing/NaN angle → 135, corrupt JSON → `null`).
A rebuild must keep `src/lib/color.ts` behaviour byte-identical for those
functions.

`tests/theme.test.mts` pins the theme-name migration (`gradient` → `aurora`)
— see [`GradientPicker.SPEC.md`](GradientPicker.SPEC.md) §8.
