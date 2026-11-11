# GradientPicker — SPEC

> **Applies to:** the gradient half of `app/src/components/ColorPicker.tsx`
> (+ `app/src/lib/color.ts`)
>
> **Status:** v1.0 · **Read first:** [`_HouseRules.md`](_HouseRules.md)
>
> This document specifies the **gradient** half of the wallpaper picker card:
> the two-stop model, the A/B stop chips, the swap button, the angle slider,
> and the user's named **preset library**. The **flat colour** half — the
> SV square, the hue strip, the alpha strip, the hex field — is specified in
> [`ColorPicker.SPEC.md`](ColorPicker.SPEC.md).
>
> **There is no separate `GradientPicker` component.** Both halves live in the
> one `ColorPicker.tsx` card, which is in `SOLID` mode or `GRADIENT` mode. A
> rebuild may split them into two components, but the **behaviour below is the
> contract** and is checked by the shipped test suite.

---

## 1. Purpose

Let the user paint the wallpaper with a **two-stop linear gradient** instead of
a flat colour: pick stop A's colour and stop B's colour from the same HSV axes
the colour half uses, set the gradient's angle, and **save named presets** for
gradients worth keeping.

---

## 2. The model

### 2.1 `WallGradient` (`app/src/lib/color.ts:108-113`)

```ts
export interface WallGradient {
  from: Hsv
  to: Hsv
  /** CSS degrees — 0 points up, 90 points right */
  angle: number
}
```

**Exactly two stops.** Linear. CSS degrees. Each stop carries its own alpha,
so a gradient can fade to transparent.

### 2.2 `Paint` — the union that carries it

```ts
export type Paint =
  | { kind: 'solid'; color: Hsv }
  | { kind: 'gradient'; gradient: WallGradient }
```

The wallpaper layer paints **one** of these two things, under a single value,
so the picker, the header swatch and the layer can never disagree about what
is on screen.

### 2.3 The default gradient (`color.ts:121-125`)

```ts
export const DEFAULT_WALL_GRADIENT: WallGradient = {
  from: DEFAULT_WALL_COLOR,                              // { h: 266, s: 0.77, v: 0.96, a: 1 } ≈ #8A38F5
  to: { h: 206, s: 0.82, v: 0.45, a: 1 },                // ≈ #154A73
  angle: 135,
}
```

`DEFAULT_WALL_GRADIENT.to` is the "to" stop used when converting a solid
paint into a gradient. `DEFAULT_WALL_GRADIENT.angle` (135) is also the
fallback angle when a persisted gradient has a non-finite angle.

### 2.4 `gradientCss` — the CSS boundary (`color.ts:128-131`)

```ts
export function gradientCss(g: WallGradient): string {
  const angle = ((Math.round(g.angle) % 360) + 360) % 360
  return `linear-gradient(${angle}deg, ${hsvToCss(g.from)}, ${hsvToCss(g.to)})`
}
```

- The angle is **rounded to an integer** and **wrapped to 0..359**:
  `360 → 0deg`, `-45 → 315deg`, `725 → 5deg`, `134.6 → 135deg`.
- `paintCss(p)` (`color.ts:134-136`) picks between `hsvToCss(p.color)` and
  `gradientCss(p.gradient)` — it is what the wallpaper layer renders.

---

## 3. Props (Inputs)

The card is the same controlled component as the colour half — see
[`ColorPicker.SPEC.md`](ColorPicker.SPEC.md) §2. Verbatim:

```tsx
interface Props {
  paint: Paint
  onChange: (next: Paint) => void
  onClose: () => void
}
```

The gradient half reads `paint` only through `paint.kind === 'gradient'`:

```tsx
const isGradient = paint.kind === 'gradient'                       // :75
const grad = paint.kind === 'gradient' ? paint.gradient : null     // :76
```

`grad` is `null` in solid mode — and **every gradient-only branch is gated on
`isGradient && grad`**, so the gradient block never renders against a missing
gradient.

---

## 4. State & Hooks (gradient-only)

### 4.1 Local state

| Name | Type | Purpose |
| --- | --- | --- |
| `stop` | `useState<'from' \| 'to'>` | Which gradient stop the colour axes edit. Initial `'from'` (`:80`). |
| `presets` | `useState<GradientPreset[]>(readPresets)` | The saved-gradient library, **read once per mount** from `localStorage['md-wall-gradient-presets']`. |
| `naming` | `useState(false)` | Whether the "NAME THIS GRADIENT" input is showing instead of the SAVE PRESET button. |
| `nameDraft` | `useState('')` | Text of that input. |
| `renamingId` | `useState<string \| null>` | `id` of the preset currently being renamed, or `null`. |
| `renameDraft` | `useState('')` | Text of the rename input. |

The preset type (`ColorPicker.tsx:23-27`) is **local, not exported**:

```ts
interface GradientPreset {
  id: string
  name: string
  gradient: { from: Hsv; to: Hsv; angle: number }
}
```

### 4.2 Derived

```tsx
const value: Hsv = grad ? (stop === 'from' ? grad.from : grad.to) : (solid as Hsv)  // :85
```

`value` is the colour the shared HSV axes (SV square, hue strip, alpha strip)
edit right now. In gradient mode it is **stop A or stop B**, not a colour of
its own.

### 4.3 Hooks

| Hook | Line | Notes |
| --- | --- | --- |
| `useCallback` `setValue` | `:92-104` | Writes the edited colour back into the **selected stop**, preserving the other stop and the angle. |
| `useCallback` `setMode` | `:108-124` | Solid ⇄ gradient **conversion**. |
| `useCallback` `swapStops` | `:165-168` | deps `[grad, onChange]`. |
| `useCallback` `setAngle` | `:170-176` | deps `[grad, onChange]`. |
| `useEffect(() => { setHexText(hsvToHex8(value)) }, [value])` | `:87-89` | The hex field follows the **selected stop**. |

---

## 5. UI structure — exhaustive (gradient mode)

The gradient block lives between the live preview and the SV square, and is
rendered **only when `isGradient && grad`** (`:279-441`).

### 5.1 Stop chips + swap (`:282-315`)

```tsx
<div className="mb-2 flex items-center gap-1.5">
  {(['from', 'to'] as const).map((s) => {
    const c = s === 'from' ? grad.from : grad.to
    return (
      <button key={s} onClick={() => setStop(s)} aria-pressed={stop === s}
        title={s === 'from' ? 'Gradient start colour' : 'Gradient end colour'}
        className={`flex flex-1 items-center gap-1.5 rounded-lg border px-2 py-1 transition ${
          stop === s
            ? 'border-white/60 bg-white/10'
            : 'border-white/10 bg-white/[0.03] hover:border-white/25'}`}>
        <span className="h-3 w-3 shrink-0 rounded-full border border-white/30"
              style={{ background: hsvToCss(c) }} />
        <span className="font-mono text-[8px] tracking-[0.15em] text-white/60">
          {s === 'from' ? 'A' : 'B'}
        </span>
      </button>
    )
  })}
  <button onClick={swapStops} aria-label="Swap gradient stops" title="Swap the two stops"
    className="grid h-6 w-6 shrink-0 place-items-center rounded-lg border border-white/10 text-white/40 transition hover:border-white/30 hover:text-white">
    <ArrowLeftRight size={10} />
  </button>
</div>
```

- Chip labels **`A`** (start / `from`) and **`B`** (end / `to`).
- Each chip carries a 12 px dot of its own stop's colour.
- Selected chip: `border-white/60 bg-white/10`. Unselected:
  `border-white/10 bg-white/[0.03] hover:border-white/25`.
- Tooltips: `'Gradient start colour'` / `'Gradient end colour'`.
- Swap button: `ArrowLeftRight size={10}` — it **keeps the angle**, so the
  picture is mirrored along the same axis instead of turning into a different
  one.

### 5.2 Angle (`:318-331`)

```tsx
<div className="mb-1 flex items-center justify-between">
  <span className="font-mono text-[8px] tracking-[0.2em] text-white/35">ANGLE</span>
  <span className="font-mono text-[8px] text-white/40">{Math.round(grad.angle)}°</span>
</div>
<input type="range" min={0} max={360} step={1} value={grad.angle}
  onChange={(e) => setAngle(Number(e.target.value))}
  aria-label="Gradient angle" className="chrome-range mb-2.5 w-full" />
```

- Label `ANGLE`; readout `NNN°` (rounded to the nearest degree).
- Range: `min=0 max=360 step=1`, `aria-label="Gradient angle"`, class
  `chrome-range mb-2.5 w-full`.
- `.chrome-range` (`index.css:943-968`): 4 px tall, 2 px radius, track
  `linear-gradient(90deg,#e8ecf1,#8d959f)`, 14 px round thumb
  `radial-gradient(circle at 35% 30%, #fff, #aab 60%, #556)` + glow
  `0 0 8px rgba(255,255,255,0.6)`.
- Note: the slider says 360 but `gradientCss` normalises 360 → `0deg`. The
  slider's 360 and any negative/fractional stored value are cosmetic only.

### 5.3 SAVE PRESET (`:334-377`)

Not-naming state (`:366-375`):

```tsx
<button onClick={() => { setNaming(true); setNameDraft('') }}
  className="flex w-full items-center justify-center gap-1.5 rounded-lg bg-white/5 py-1 font-mono text-[8px] tracking-[0.18em] text-white/50 transition hover:bg-white/10 hover:text-white">
  <BookmarkPlus size={10} /> SAVE PRESET
</button>
```

Naming state (`:336-364`):

```tsx
<div className="flex items-center gap-1.5">
  <input autoFocus value={nameDraft}
    onChange={(e) => setNameDraft(e.target.value)}
    onKeyDown={(e) => {
      if (e.key === 'Enter') { e.preventDefault(); savePreset() }
      if (e.key === 'Escape') { e.stopPropagation(); setNaming(false); setNameDraft('') }
    }}
    placeholder="NAME THIS GRADIENT" spellCheck={false}
    aria-label="Gradient preset name"
    className="min-w-0 flex-1 rounded-lg border border-white/15 bg-white/5 px-2 py-1 font-mono text-[9px] tracking-[0.1em] text-white outline-none transition focus:border-white/40" />
  <button onClick={savePreset} aria-label="Save gradient preset"
    className="grid h-6 w-6 shrink-0 place-items-center rounded-lg border border-emerald-300/40 bg-emerald-400/10 text-emerald-200 transition hover:border-emerald-300/70">
    <Check size={11} />
  </button>
</div>
```

- Placeholder is literally **`NAME THIS GRADIENT`** (uppercase).
- Emerald confirm button: border `emerald-300/40`, bg `emerald-400/10`, text
  `emerald-200`, hover `border-emerald-300/70`.
- The whole SAVE PRESET row only exists in gradient mode.

### 5.4 Preset list (`:379-439`)

Rendered **only when `presets.length > 0`**.

```tsx
<div className="mb-2.5 max-h-28 overflow-y-auto rounded-lg border border-white/10 pr-0.5">
  {presets.map((p) => (
    <div key={p.id} className="flex items-center gap-2 px-1.5 py-1 transition hover:bg-white/5">
      <span aria-hidden className="h-3.5 w-3.5 shrink-0 rounded-full border border-white/25"
            style={{ background: gradientCss(p.gradient) }} />
      ...
    </div>
  ))}
</div>
```

- **A vertical list, not a swatch grid.** There is no grid/column layout
  anywhere in this card. One row per preset, `max-h-28` (112 px) with
  `overflow-y-auto`. No `thin-scroll` class → the default scrollbar.
- Row: a 14 px round gradient dot (`border-white/25`), then either the name
  button or the rename input + ✓.
- Name button (`:416-422`): `title={`Wear “${p.name}”`}` (curly quotes),
  class `min-w-0 flex-1 truncate text-left font-mono text-[9px] tracking-[0.12em] text-white/70 transition hover:text-white`.
- Rename trigger (`:423-433`): `aria-label={`Rename ${p.name}`}`,
  `title="Rename"`, `grid h-5 w-5 shrink-0 place-items-center rounded text-white/40 transition hover:bg-white/10 hover:text-white`,
  icon `Pencil size={9}`.
- Rename input (`:390-405`): `autoFocus`, `spellCheck={false}`,
  `aria-label="Rename gradient preset"`, class `min-w-0 flex-1 rounded border border-white/25 bg-white/5 px-1.5 py-0.5 font-mono text-[9px] tracking-[0.1em] text-white outline-none focus:border-white/50`,
  `onBlur={() => commitRename(p.id)}`.
- Rename confirm (`:406-412`): `aria-label="Confirm rename"`, `grid h-5 w-5 shrink-0 place-items-center rounded text-emerald-300 transition hover:bg-white/10`,
  icon `Check size={10}`.

**There is no delete affordance for a preset.** See §6.4.

---

## 6. Preset library — the persistence contract

### 6.1 The storage key

`localStorage['md-wall-gradient-presets']` (`ColorPicker.tsx:29`,
`PRESETS_KEY`). Value: a JSON array of `{ id, name, gradient: { from, to,
angle } }`.

### 6.2 Read (`:31-46`)

Lazy, once per mount:

```ts
function readPresets(): GradientPreset[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(PRESETS_KEY) ?? '[]')
    if (!Array.isArray(raw)) return []
    return raw.filter(
      (p): p is GradientPreset =>
        !!p && typeof p === 'object' &&
        typeof (p as GradientPreset).id === 'string' &&
        typeof (p as GradientPreset).name === 'string' &&
        !!(p as GradientPreset).gradient,
    )
  } catch { return [] }
}
```

Note the **shallow validation**: `gradient` is only checked for truthiness —
its `from`/`to`/`angle` are not validated. A hand-edited corrupt entry can
throw inside `gradientCss` when the row renders.

### 6.3 Write (`:48-54`)

```ts
localStorage.setItem(PRESETS_KEY, JSON.stringify(list))
```

in a `try/catch` that swallows private-mode errors (the list then lasts for
the session only).

### 6.4 Save (`:133-149`)

```ts
const name = nameDraft.trim() || `GRADIENT ${presets.length + 1}`
const preset: GradientPreset = {
  id:
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.floor(Math.random() * 1e9)}`,
  name,
  gradient: { ...grad },
}
const next = [preset, ...presets].slice(0, 40)
setPresets(next); writePresets(next); setNaming(false); setNameDraft('')
```

- Newest first (prepended). **Hard cap of 40** presets (`.slice(0, 40)`) — the
  oldest is silently dropped.
- Default name when the input is blank: `GRADIENT ${presets.length + 1}`
  (uppercase, space-separated).
- The snapshot is a **shallow copy** of the live gradient; its stop objects are
  shared with the live paint, which is safe only because every update
  *replaces* stop objects rather than mutating them. **A rebuild that mutates
  `Hsv` in place would corrupt saved presets.**
- Save is a **no-op in solid mode** (`if (!grad) return`), and the SAVE PRESET
  UI is gradient-only anyway.

### 6.5 Rename (`:150-158`)

```ts
const commitRename = (id: string) => {
  const name = renameDraft.trim()
  if (name) {
    const next = presets.map((p) => (p.id === id ? { ...p, name } : p))
    setPresets(next); writePresets(next)
  }
  setRenamingId(null)
}
```

- Trimmed; **an empty/whitespace name is discarded** (the old name stays) but
  the rename mode still exits.
- Fires on Enter, on the ✓ button, **and on blur** of the rename input.

### 6.6 Apply (`:159-161`)

```ts
const applyPreset = (p: GradientPreset) => {
  onChange({ kind: 'gradient', gradient: { ...p.gradient } })
}
```

Applies the snapshot **wholesale** — the current gradient is replaced, not
merged. Note this does **not** copy the stop objects (`{ ...p.gradient }` is a
shallow copy), so the applied gradient shares its stop objects with the
preset. Safe only because stops are replaced, never mutated.

### 6.7 Delete: there is none

No delete button, no context menu, no `removePreset`. The only ways to lose a
preset are to exceed 40 saves or to clear localStorage. **A rebuild that adds
a delete is *adding* behaviour, not restoring it.**

---

## 7. Mode conversion — the rules

`setMode` (`:108-124`) is a **conversion, never a reset**:

```ts
if (kind === 'solid') {
  onChange({ kind: 'solid', color: grad ? grad.from : (solid as Hsv) })
  return
}
onChange({
  kind: 'gradient',
  gradient: grad ?? {
    from: (solid as Hsv),
    to: DEFAULT_WALL_GRADIENT.to,
    angle: DEFAULT_WALL_GRADIENT.angle,
  },
})
```

| From | To | Result |
| --- | --- | --- |
| solid | gradient | Stop A = the current flat colour; stop B = `DEFAULT_WALL_GRADIENT.to`; angle = `DEFAULT_WALL_GRADIENT.angle` (135). |
| gradient | solid | The flat colour becomes **stop A** (`grad.from`) — the *start* of the gradient, not the end. |
| gradient | gradient | A no-op re-emit of the same gradient. |

**Round-tripping solid → gradient discards** the old stop B and the old angle
(they revert to the defaults). This is shipped behaviour.

---

## 8. Interactions & edge cases

### 8.1 Keyboard

| Key | Where | Result |
| --- | --- | --- |
| `Enter` | name input | `preventDefault()`, `savePreset()`. |
| `Enter` | rename input | `preventDefault()`, `commitRename(p.id)`. |
| `Tab` | anywhere | Blurring the rename input commits the rename. |
| `Escape` | window (capture) | **Closes the whole card** (see the colour spec §7.1). The name input's and rename input's own Escape branches are therefore unreachable. |

### 8.2 The stop-selection model

- `stop` is **local to the card** and **not persisted**. Reopening the card
  starts on stop A.
- The stop chips are the only way to change which stop the axes edit.
- The SV square, the hue strip, the alpha strip and the hex field all edit
  **the selected stop** — they are shared with the colour half.
- `swapStops` swaps the two stops and keeps the angle.
- Switching `stop` while the hex field holds an uncommitted draft: the draft
  is **not** re-parsed — `commitDraft` applies it to whichever stop is
  selected at commit time. Shipped behaviour; a rebuild may tighten it.

### 8.3 The preview

The live preview at the top of the card shows the **real** gradient
(`gradientCss(grad)`) in gradient mode — not an approximation, and not the
stop colours.

### 8.4 Empty / edge states

- No presets yet → the preset list block is **not rendered at all**
  (`presets.length > 0` gate). There is no "no presets" empty state.
- A gradient with `angle: 360` renders as `0deg` — the same picture as
  `angle: 0`.
- A gradient whose two stops are identical renders as a flat colour. That is
  legal and not special-cased.

### 8.5 What a rebuild could plausibly get wrong

1. Mutating `Hsv` in place instead of replacing it — corrupts saved presets
   and the applied gradient (they share stop objects).
2. Forgetting that `stop` selects which stop the shared axes edit — the axes
   would silently keep editing stop A.
3. Turning the preset list into a grid — it is a single-column scroll list,
   `max-h-28`.
4. Adding a delete button — that is new behaviour, not a fix.
5. Forgetting the 40-preset cap — an unbounded list would grow without limit.
6. Resetting the gradient instead of converting it on a mode switch.
7. Losing the angle on swap — the swap must keep it.

---

## 9. Hard requirements / traps

| # | Requirement | Why |
| --- | --- | --- |
| 1 | The gradient block renders **only** when `isGradient && grad`. | `grad` is `null` in solid mode; rendering it unguarded throws. |
| 2 | `gradientCss` normalises the angle to **0..359** after rounding. | `360` must render as `0deg`, and negative/fractional values must not produce invalid CSS. |
| 3 | The preset library lives at `localStorage['md-wall-gradient-presets']` as a JSON array of `{id,name,gradient}`. | It is the user's saved work; losing the key loses their gradients. |
| 4 | Saves are **prepended** (newest first) and **capped at 40**. | The list order is the UI's order. |
| 5 | Preset ids come from `crypto.randomUUID()` with a `${Date.now()}-${Math.floor(Math.random()*1e9)}` fallback. | Uniqueness across reloads. |
| 6 | A rename to an empty/whitespace name is **discarded**, and the mode still exits. | |
| 7 | Rename commits on **Enter, ✓ and blur**. | Blur is the only commit path a mouse-only user has. |
| 8 | There is **no delete** for a preset. | Adding one is a new feature. |
| 9 | The SAVE PRESET UI and the preset list exist **only in gradient mode**. | |
| 10 | The angle slider is `min=0 max=360 step=1` with `aria-label="Gradient angle"`. | |
| 11 | The stop chips are labelled **`A`** and **`B`** with `aria-pressed`, and the swap button has `aria-label="Swap gradient stops"`. | |
| 12 | `savePreset` copies the gradient with `{ ...grad }` (shallow) and the stop objects must be treated as **immutable**. | |
| 13 | Mode switching is a **conversion** (§7), never a reset. | |
| 14 | `DEFAULT_WALL_GRADIENT` = `{ from: #8A38F5-ish, to: {h:206,s:0.82,v:0.45,a:1}, angle: 135 }`. | The solid → gradient conversion depends on it. |

### 9.1 Test coverage

`tests/paint.test.mts` pins:

- `gradientCss` angle normalisation: `360 → '0deg'`, `-45 → '315deg'`,
  `725 → '5deg'`, `134.6 → '135deg'`.
- `paintLabel` formats: `SOLID #RRGGBB` and
  `GRADIENT #RRGGBB → #RRGGBB`.
- `parsePaint` tolerance: a missing or `NaN` angle falls back to `135`; a
  corrupt JSON string returns `null`.
- The HSV ↔ hex round-trips.

**A rebuild must keep `src/lib/color.ts` byte-identical for those
functions**, or `npm run test:unit` fails.
