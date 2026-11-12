# VisualizerPanel — SPEC

> **Applies to:** `app/src/components/VisualizerPanel.tsx`
> (+ `app/src/features/voltviz/{registry,modules,useVoltViz,settings,runtime-types}.ts`)
>
> **Status:** v1.0 · **Read first:** [`_HouseRules.md`](_HouseRules.md)
>
> This is the panel that picks and tunes the **live visual** — the animated
> backdrop painted across the window behind the player. It is the only way to
> turn a live visual on or off.

---

## 1. Purpose

One card that does three things:

1. **Picks** the live visual (or turns it off) from the VoltViz registry.
2. **Tunes** the picked visual with VoltViz's own four URL parameters —
   remembered **per style**.
3. **Hosts** the visual's own settings card (VoltViz's `Overlay`), when its
   module brings one.

---

## 2. Props (Inputs)

The prop interface is **local, not exported** (`VisualizerPanel.tsx:10-28`).
Verbatim:

```tsx
interface Props {
  /** the live backdrop's style id, or null for none */
  volt: string | null
  onVolt: (id: string | null) => void
  /** the selected visual's own tuning — VoltViz's four settings, stored per style */
  settings: VisualizerSettings
  onSetting: (key: keyof VisualizerSettings, value: number) => void
  /** the mounted visual's own settings card api, when its module has one */
  api: Record<string, (...args: never[]) => unknown> | null
  /** the state of the player's own audio graph */
  audioState?: string | null
  /** HIDE UI — chrome out, visual on screen (also bound to H) */
  onHideUi: () => void
  onClose: () => void
  /** layout editor — drag this panel while an edit session runs */
  editing?: boolean
  offset?: ChromeOffset
  onOffset?: (o: ChromeOffset) => void
}
```

Component signature (`:61-73`):

```tsx
export default function VisualizerPanel({
  volt, onVolt, settings, onSetting, api, audioState,
  onHideUi, onClose, editing = false, offset, onOffset,
}: Props) {
```

| Prop | Type | Meaning |
| --- | --- | --- |
| `volt` | `string \| null` | The registry id of the live backdrop, or `null` for none. **Controlled** — the panel keeps no copy of the selection. |
| `onVolt` | `(id: string \| null) => void` | Fired when a visual is picked, or `null` when OFF is pressed. |
| `settings` | `VisualizerSettings` | The **selected visual's** tuning (already resolved for the current style). |
| `onSetting` | `(key: keyof VisualizerSettings, value: number) => void` | Fired on every slider change. |
| `api` | `Record<string, (...args: never[]) => unknown> \| null` | The mounted visual's own settings API, when its module has one. `null` until the backdrop has mounted. |
| `audioState` | `string \| null` (optional) | The state of the player's audio graph. Anything other than `'running'` produces the amber warning line. |
| `onHideUi` | `() => void` | Fired by the **HIDE UI · H** button. Only rendered while a visual is on. |
| `onClose` | `() => void` | Fired by the ✕ button **after** a 200 ms exit delay. |
| `editing` | `boolean` (default `false`) | A layout edit session is running — enables the drag. |
| `offset` | `ChromeOffset` | The panel's saved drag offset. |
| `onOffset` | `(o: ChromeOffset) => void` | Called when the panel is dragged during an edit session. |

### 2.1 `VisualizerSettings` (`features/voltviz/settings.ts`)

```ts
export interface VisualizerSettings {
  sensitivity: number;
  speed: number;
  hueShift: number;
  scale: number;
}
```

### 2.2 How Home mounts it (`Home.tsx:2467-2481`)

```tsx
{visualizerOpen && (
  <VisualizerPanel
    audioState={visualizer.audioState}
    editing={isEditingLayout}
    offset={chromeLayout.offsets['panel-visualizer']}
    onOffset={(o) => chromeLayout.setOffset('panel-visualizer', o)}
    volt={volt.style}
    onVolt={volt.setStyle}
    settings={volt.settings}
    onSetting={volt.setSetting}
    api={vizApi}
    onHideUi={() => setUiHidden(true)}
    onClose={() => setVisualizerOpen(false)}
  />
)}
```

- `volt` / `onVolt` / `settings` / `onSetting` come from the `useVoltViz()`
  hook (see §5).
- `api` is `vizApi` — the state Home receives from `VoltVizBackdrop`'s
  `onApi` callback. `VoltVizBackdrop` calls `onApi(mounted.api ?? null)` once
  the module has mounted and `onApi(null)` when it is disposed
  (`VoltVizBackdrop.tsx:206, 225`).
- The panel's drag offset lives under the chrome-offset key
  **`panel-visualizer`** in `localStorage['md-chrome-offsets']`.

### 2.3 The only trigger

The panel is opened by the **visualiser circle in the header's left cluster**
(`Home.tsx:1935-1969`, the `hdr-visualizer` surface):

```tsx
<button
  aria-label="Visualiser options"
  title={volt.style ? `Live visual: ${voltName} — click to change it` : 'Visualiser options'}
  onClick={() => setVisualizerOpen(true)}
  className={`ml-2 h-4 w-4 rounded-full transition-all duration-150 ${
    volt.style
      ? 'animate-liveviz ring-2 ring-emerald-400/70 ring-offset-2 ring-offset-black hover:ring-emerald-300'
      : visualizerOpen
        ? 'ring-2 ring-white/60 ring-offset-2 ring-offset-black'
        : 'ring-1 ring-white/20 hover:ring-white/45'
  }`}
  style={
    volt.style
      ? { background: 'conic-gradient(from 180deg,#7dff9d,#5fd0ff,#a95fff,#ff5fd0,#7dff9d)' }
      : { background: 'conic-gradient(from 210deg,rgba(255,95,109,.5),rgba(255,195,113,.5),rgba(125,255,157,.5),rgba(95,208,255,.5),rgba(169,95,255,.5),rgba(255,95,208,.5),rgba(255,95,109,.5))' }
  }
/>
```

There is **no keyboard shortcut** for opening it and **no other trigger** in
the app.

---

## 3. State & Hooks

### 3.1 Local state

| Name | Type | Purpose |
| --- | --- | --- |
| `closing` | `useState(false)` | The exit animation is playing. Adds `is-closing` to the class list. |
| `OwnCard` | `useState<VisualizerModule['Overlay'] \| null>(null)` | The selected module's own `Overlay` React component, once it has been lazily loaded. |

### 3.2 Hooks

| Hook | Line | Notes |
| --- | --- | --- |
| `useChromeDrag({ editing, offset, onOffset })` | `:74` | The layout-editor drag. Returns `{ editClass, style, onPointerDown, onClickCapture }` — **all four must be wired** (see §6). |
| `useEffect` (Overlay load) | `:81-103` | Finds the registry entry for `volt`, resets `OwnCard` to `null` on a **microtask** (never synchronously in the effect body — the react-hooks compiler rejects that), then `loadVisualizer(entry)` and sets `OwnCard` to `mod.Overlay ?? null`. A `live` flag guards against setting state after unmount. |

### 3.3 Derived values

```tsx
const name = volt ? (VOLT_STYLES.find((v) => v.id === volt)?.name ?? volt) : ''   // :105
```

`name` is the **display name** of the picked style — the registry's `name`
field, e.g. `Sonic Topography X`, `Halftone Pulse`, `Dutch Grid (WebGL)`.
When `volt` is `null`, `name` is `''` and the panel shows `OFF`.

### 3.4 The tuning table (`:34-49`)

```tsx
const TUNING = [
  ['sensitivity', 'SENSITIVITY', 'x'],
  ['speed', 'SPEED', 'x'],
  ['scale', 'SCALE', 'x'],
] as const satisfies readonly (readonly [keyof VisualizerSettings, string, string])[]

const shown = (_key: keyof VisualizerSettings, value: number) => `${value.toFixed(1)}x`

const tuningFor = (style: string | null) =>
  style === 'butterchurn' ? TUNING.filter(([key]) => key === 'sensitivity') : TUNING
```

- **HUE is deliberately not offered.** The palettes carry the colour identity,
  and a hue slider over them read as clutter. `hueShift` stays in the settings
  **type** (for the visuals that compute with it) — it is simply not surfaced.
- `butterchurn` is the exception: it mixes its own audio from the deck's node,
  so only **SENSITIVITY** (the gain on that tap) moves it. Showing it three
  dead sliders would be worse than showing it one that works.

---

## 4. Event Handlers (Outputs)

| Callback | Signature | Fires when |
| --- | --- | --- |
| `onVolt(id)` | `(id: string \| null) => void` | A visual button is clicked (`v.id`), or the **OFF** button is clicked (`null`). |
| `onSetting(key, value)` | `(key: keyof VisualizerSettings, value: number) => void` | A tuning slider changes; and **once per slider** when **RESET** is pressed. |
| `onHideUi()` | `() => void` | The **HIDE UI · H** button is clicked. |
| `onClose()` | `() => void` | The ✕ button is clicked — **200 ms later**, after the exit animation. |

### 4.1 The close protocol (`:130-139`)

```tsx
<button
  onClick={() => {
    setClosing(true)
    window.setTimeout(onClose, 200)
  }}
  aria-label="Close visualiser"
  className="text-white/40 transition hover:text-white"
>
  <X size={12} />
</button>
```

The panel **stays mounted** for the 200 ms so the `is-closing` animation can
run, then the parent unmounts it. This is the house close protocol from
`_HouseRules.md` §3 — the parent owns `visualizerOpen`, the panel owns the
`closing` flag, and the unmount happens on the panel's timer.

### 4.2 The RESET button (`:203-210`)

```tsx
<button
  onClick={() => {
    for (const [key] of tuningFor(volt)) onSetting(key, VOLT_SETTINGS_DEFAULT[key])
  }}
  className="font-mono text-[7px] tracking-[0.15em] text-white/40 transition hover:text-white"
>
  RESET
</button>
```

It resets **only the sliders this panel is showing** — `tuningFor(volt)`, not
all four settings. For `butterchurn` that is SENSITIVITY alone.

---

## 5. The live-visual state (parent-owned)

The panel does **not** own the selection or the tuning. Both live in
`useVoltViz()` (`features/voltviz/useVoltViz.ts`).

### 5.1 Storage keys

| Key | Shape | Written by |
| --- | --- | --- |
| `md-voltviz` | the registry id, or the literal `'off'` | `setStyle` (`:92`) |
| `md-voltviz-settings` | `{ [styleId]: { sensitivity?, speed?, hueShift?, scale? } }` | `setSetting` (`:105`) |

Both writes are wrapped in `try/catch` — in private mode the choice lasts for
the session only.

### 5.2 Reading

```ts
function stored(): string | null {
  try {
    const found = localStorage.getItem(KEY)
    return found && found !== 'off' ? found : null
  } catch {
    return null
  }
}
```

`'off'` is the stored form of "no visual" — it reads back as `null`.

### 5.3 The per-style tuning

```ts
const settings = useMemo<VisualizerSettings>(
  () => ({ ...VOLT_SETTINGS_DEFAULT, ...(style ? tuning[style] : undefined) }),
  [tuning, style],
)
```

A style that has never been tuned shows **VoltViz's defaults**. The tuning
map is keyed by style id, so **Flame can run slow and dark while Laser Show
runs fast and hot**, and each keeps the tuning it was given.

### 5.4 The clamp

```ts
function clamp(key: keyof VisualizerSettings, value: number): number {
  const { min, max, step } = VOLT_SETTING_RANGE[key]
  const clamped = Math.min(max, Math.max(min, value))
  return Math.round(clamped / step) * step
}
```

Every value — read from storage and written from the panel — is clamped to the
range and **snapped to the slider's own step**, so a stored value is always
one the UI can show.

### 5.5 The ranges and defaults (VoltViz's README)

```ts
export const VOLT_SETTINGS_DEFAULT: VisualizerSettings = {
  sensitivity: 1,
  speed: 1,
  hueShift: 0,
  scale: 1,
}

export const VOLT_SETTING_RANGE = {
  sensitivity: { min: 0.1, max: 3,   step: 0.1 },
  speed:       { min: 0.1, max: 3,   step: 0.1 },
  hueShift:    { min: 0,   max: 360, step: 1 },
  scale:       { min: 0.5, max: 3,   step: 0.1 },
} as const
```

`setSetting` is a **no-op when no style is selected** (`if (!style) return`).

---

## 6. UI structure — exhaustive

### 6.0 The panel shell (`:108-115`)

```tsx
<div
  className={`settings-panel panel-resizable fx-blur fixed left-[5%] top-[4.5rem] z-[89] flex max-h-[min(70vh,560px)] w-[min(88vw,460px)] flex-col rounded-2xl border border-white/20 bg-black/75 shadow-[0_24px_70px_rgba(0,0,0,0.65),inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-2xl${
    closing ? ' is-closing' : ''
  } ${drag.editClass}`}
  style={drag.style}
  onPointerDownCapture={drag.onPointerDown}
  onClickCapture={drag.onClickCapture}
>
```

| Aspect | Value |
| --- | --- |
| Position | `fixed left-[5%] top-[4.5rem]` — 5 % from the left, 4.5 rem from the top |
| Size | `w-[min(88vw,460px)]`, `max-h-[min(70vh,560px)]` |
| Layout | `flex flex-col` — the content column scrolls |
| z-index | `z-[89]` — the radio panel's band |
| Glass | `bg-black/75 backdrop-blur-2xl border-white/20`, shadow `0 24px 70px rgba(0,0,0,0.65)` + `inset 0 1px 0 rgba(255,255,255,0.08)` |
| Classes | `settings-panel` (the `panel-in` entrance / `panel-out` exit **and** the hairline scrollbar), `panel-resizable` (the native corner resizer), `fx-blur` (the wallpaper BLUR switch) |
| Layout-editor drag | `drag.editClass` → `cursor-move outline-dashed outline-1 outline-white/30 [touch-action:none]`, and `drag.style` → `translate: Npx Npx` |

**All four `useChromeDrag` returns must be wired**: `editClass` into the class
list, `style` into the `style` prop, `onPointerDown` into
`onPointerDownCapture`, and `onClickCapture` into `onClickCapture`. The
capture phase is what stops a hold-to-open control from opening during a
drag.

### 6.1 Header (`:116-141`)

```tsx
<div className="flex items-center justify-between border-b border-white/10 px-4 py-2.5">
  <span className="font-mono text-[9px] tracking-[0.25em] text-white/50">VISUALISER</span>
  <div className="flex items-center gap-2">
    {volt && (
      <button onClick={onHideUi}
        title="Hide every panel, button and header — press H to bring them back"
        className="rounded-full border border-white/15 px-2 py-0.5 font-mono text-[8px] tracking-[0.15em] text-white/50 transition hover:border-white/40 hover:text-white">
        HIDE UI · H
      </button>
    )}
    <button onClick={...} aria-label="Close visualiser"
      className="text-white/40 transition hover:text-white">
      <X size={12} />
    </button>
  </div>
</div>
```

- Title: **`VISUALISER`** — `font-mono text-[9px] tracking-[0.25em] text-white/50`
  (the house panel-title class).
- **HIDE UI · H** — a small pill, `border-white/15`, `text-[8px]`. It **only
  exists while a visual is on**, because it mirrors the `H` key, which only
  works while a visual is on.
- ✕ — `aria-label="Close visualiser"`, `X` at `size={12}`.

### 6.2 The suspended-audio warning (`:146-150`)

```tsx
{audioState && audioState !== 'running' && (
  <div className="px-4 py-3 font-mono text-[7px] leading-relaxed tracking-[0.1em] text-amber-300/70">
    THE PLAYER&apos;S AUDIO GRAPH IS {audioState.toUpperCase()} — A SUSPENDED CONTEXT IS SILENCE.
  </div>
)}
```

A suspended audio graph is silence, and silence makes a still backdrop — worth
saying out loud rather than leaving the listener to wonder why nothing moves.

- Rendered only when `audioState` is set **and** is not `'running'`.
- The state is upper-cased in the text.
- `text-amber-300/70`, `text-[7px]`, `tracking-[0.1em]`.

### 6.3 The LIVE VISUALS picker (`:155-193`)

```tsx
<div className="border-b border-white/10 px-4 py-3">
  <div className="mb-1.5 flex items-center justify-between">
    <span className="font-mono text-[7px] tracking-[0.2em] text-white/35">LIVE VISUALS</span>
    <span className="font-mono text-[7px] tracking-[0.15em] text-white/25">
      {volt ? name.toUpperCase() : 'OFF'}
    </span>
  </div>
  <div className="grid max-h-44 grid-cols-3 gap-1 overflow-y-auto pr-1">
    <button onClick={() => onVolt(null)} className={...}>OFF</button>
    {VOLT_STYLES.map((v) => (
      <button key={v.id} onClick={() => onVolt(v.id)} title={v.name} className={...}>
        {v.name.replace(/ \(WebGPU\)$/, '').toUpperCase()}
      </button>
    ))}
  </div>
  <p className="mt-1.5 font-mono text-[7px] leading-relaxed tracking-[0.1em] text-white/25">
    VoltViz's styles plus the two Sonic Topography ports (© CmzYa / © Netesfiu, GPL-3.0),
    painted across the window behind the player from the deck's own analyser. One at a
    time; OFF returns the plain backdrop.
  </p>
</div>
```

- Section label: **`LIVE VISUALS`** — `font-mono text-[7px] tracking-[0.2em] text-white/35`.
- Status readout on the right: the selected style's name in **UPPERCASE**, or
  **`OFF`** when nothing is selected. `text-white/25`.
- The grid: **`grid-cols-3`**, `gap-1`, `max-h-44` (176 px) with
  `overflow-y-auto pr-1`. **18 buttons** — `OFF` plus the 17 registry entries.
- Button classes:

```tsx
`rounded-lg border px-1 py-1.5 font-mono text-[8px] tracking-[0.08em] transition ${
  selected
    ? 'border-emerald-400/50 bg-emerald-400/10 text-emerald-200'
    : 'border-white/12 text-white/45 hover:border-white/30 hover:text-white/80'
}`
```

- The **label** is `v.name.replace(/ \(WebGPU\)$/, '').toUpperCase()` — the
  `(WebGPU)` suffix is stripped from the **visible text** only; `title={v.name}`
  keeps the full name. So `Dutch Grid (WebGL)` shows as `DUTCH GRID`.
- The `OFF` button is **always first**, and its selected state is computed
  with `volt === null`.
- The footnote is a **fixed string** (not derived) and carries the GPL-3.0
  attribution for the two Sonic Topography ports.

### 6.4 The SETTINGS block (`:197-242`)

Rendered **only when `volt` is set** (`{volt && (...)}`).

```tsx
<div className="mt-3 border-b border-white/10 px-4 pb-3">
  <div className="mb-2 flex items-center justify-between">
    <span className="font-mono text-[7px] tracking-[0.2em] text-white/35">
      SETTINGS · {name.toUpperCase()}
    </span>
    <button onClick={...} className="font-mono text-[7px] tracking-[0.15em] text-white/40 transition hover:text-white">
      RESET
    </button>
  </div>
  {tuningFor(volt).map(([key, label]) => {
    const range = VOLT_SETTING_RANGE[key]
    return (
      <div key={key} className="mb-2 last:mb-0">
        <div className="mb-1 flex items-center justify-between">
          <span className="font-mono text-[9px] tracking-[0.15em] text-white/50">{label}</span>
          <span className="font-mono text-[9px] text-white/40">{shown(key, settings[key])}</span>
        </div>
        <input
          type="range"
          min={range.min} max={range.max} step={range.step}
          value={settings[key]}
          onChange={(e) => onSetting(key, Number(e.target.value))}
          aria-label={`${label.toLowerCase()} for ${name}`}
          className="chrome-range w-full"
        />
      </div>
    )
  })}
  <p className="mt-1.5 font-mono text-[7px] leading-relaxed tracking-[0.1em] text-white/25">
    VoltViz's own settings, kept for each visual separately — this tuning belongs to{' '}
    {name} alone.
  </p>
</div>
```

- Section label: **`SETTINGS · <NAME IN UPPERCASE>`**.
- One row per slider: the label on the left, the **readout** on the right.
- The readout is `${value.toFixed(1)}x` — always one decimal, always an `x`
  suffix. `1` renders as `1.0x`; `3` as `3.0x`.
- Slider `aria-label` is `` `${label.toLowerCase()} for ${name}` `` — e.g.
  `sensitivity for Butterchurn`, `scale for Flame`.
- The slider class is `chrome-range w-full` (the house slider).
- The **labels are uppercase** (`SENSITIVITY`, `SPEED`, `SCALE`), and the
  `aria-label` lower-cases them — so the two differ in case. Keep it.
- The footnote ends with the style's **name in its original case** (`{name}`),
  not upper-cased.

### 6.5 The visual's own card (`:247`)

```tsx
{volt && api && OwnCard && <OwnCard api={api} />}
```

Three conditions, all required:

1. `volt` — a visual is selected.
2. `api` — the backdrop has mounted and reported its API.
3. `OwnCard` — the module's `Overlay` export has been lazily loaded.

The `Overlay` is the **same component VoltViz itself renders** — e.g.
Halftone Pulse's Mode, Shape, Colours and Image. It is rendered **inside**
this panel, below the tuning block.

### 6.6 Which modules ship an `Overlay`

`features/voltviz/impl/` — nine of the implementations export one:

| Module | Overlay |
| --- | --- |
| `BarGraph.tsx:306` | yes |
| `BlurImage.tsx:163` | yes |
| `Butterchurn.tsx:376` | yes |
| `HalftonePulse.tsx:930` | yes |
| `Icons.tsx:410` | yes |
| `ParticlesStream.tsx:483` | yes |
| `SonicTopography.tsx:940` | yes |
| `SonicTopographyExtended.tsx:962` | yes |
| `YourLogo.tsx:388` | yes |

The rest (`CRTTerminal.ts`, `DutchGridWebGL.ts`, `GlitchBackgroundSendspin.ts`,
`GlitchDatabend.ts`, `VinylSendspin.ts`) do **not** — for those the panel
simply has no third block.

The `Overlay` component's props (`runtime-types.ts:56-59`):

```ts
export interface OverlayProps {
  /** The instance's `api`, once mounted. */
  api: ...
}
```

---

## 7. The registry — the single source of truth

`features/voltviz/registry.ts`:

```ts
export const visualizers = [
  { id: 'sonictopographyextended', name: 'Sonic Topography X', module: 'SonicTopographyExtended' },
  { id: 'sonictopography',          name: 'Sonic Topography',   module: 'SonicTopography' },
  { id: 'butterchurn',              name: 'Butterchurn',        module: 'Butterchurn' },
  { id: 'bargraph',                 name: 'Bar Graph',          module: 'BarGraph' },
  { id: 'kaleidoscope',             name: 'Kaleidoscope',       module: 'Kaleidoscope' },
  { id: 'lasershow',                name: 'Laser Show',         module: 'LaserShow' },
  { id: 'halftonepulse',            name: 'Halftone Pulse',     module: 'HalftonePulse' },
  { id: 'holoblinds',               name: 'Holo Blinds',        module: 'HoloBlinds' },
  { id: 'shambhala',                name: 'Shambhala',          module: 'Shambhala' },
  { id: 'anunakisphere',            name: 'Anunaki Sphere',     module: 'AnunakiSphere' },
  { id: 'mossball',                 name: 'Moss Ball',          module: 'MossBall' },
  { id: 'milkdropwarp',             name: 'MilkDrop Warp',      module: 'MilkDropWarp' },
  { id: 'aurorawaves',              name: 'Aurora Waves',       module: 'AuroraWaves' },
  { id: 'flame',                    name: 'Flame',              module: 'Flame' },
  { id: 'defqonmainstage',          name: 'Defqon Mainstage',   module: 'DefqonMainstage' },
  { id: 'crtterminal',              name: 'CRT Terminal',       module: 'CRTTerminal' },
  { id: 'dutchgridwebgl',           name: 'Dutch Grid (WebGL)', module: 'DutchGridWebGL' },
] as const satisfies readonly VisualizerEntry[];
```

**17 styles**, newest first, plus the `OFF` button = **18 buttons** in the
grid.

- The registry derives the id union, the module map, and the picker's
  labels/order. **New visuals register here** — the panel's grid, the
  backdrop and the module loader all read from this one list.
- The two Sonic Topography entries are **GPL-3.0 ports** (CmzYa / Netesfiu,
  `features/voltviz/sonic/LICENSE`); the rest are VoltViz's MIT styles.
  The GPL attribution is visible in the panel's footnote.

### 7.1 The lazy module loader (`features/voltviz/modules.ts`)

```ts
const modules = import.meta.glob<VisualizerModule>('./impl/*.{ts,tsx}')

export function loadVisualizer(entry: { module: string }): Promise<VisualizerModule> {
  const load = modules[`./impl/${entry.module}.ts`] ?? modules[`./impl/${entry.module}.tsx`]
  if (!load) return Promise.reject(new Error(`missing visualizer module ./impl/${entry.module}`))
  return load()
}
```

One chunk per visualizer. The panel loads the module **through the same
loader the backdrop uses**, so by the time the `Overlay` renders the module is
already in memory.

---

## 8. Interactions & edge cases

### 8.1 Open / close

- The panel is mounted/unmounted by `visualizerOpen` in `Home.tsx`.
- The **✕** sets `closing = true` and unmounts **200 ms later**.
- There is **no click-away** dismissal and **no Escape** handler in this
  panel.
- The entrance is `settings-panel`'s `panel-in` (200 ms,
  `cubic-bezier(0.22, 1, 0.36, 1)`); the exit is `panel-out` (160 ms).

### 8.2 The `H` key / HIDE UI

- The **HIDE UI · H** button fires `onHideUi()`, which Home wires to
  `setUiHidden(true)` — the chrome (header, panels, buttons) fades out and
  only the live visual remains.
- The same key (`H`) toggles it back. Home's handler refuses to hide the UI
  when no visual is on (`if (!volt.style && uiHidden) setUiHidden(false)`,
  `Home.tsx:103-104`).
- The button exists **only while a visual is on**, mirroring that rule.

### 8.3 Switching visuals

- Picking a style calls `onVolt(v.id)`. The backdrop then mounts the new
  module and fades the old one out (`VoltVizBackdrop` keeps the outgoing
  container in the DOM until its fade completes).
- `OwnCard` is reset to `null` **on a microtask** before the new module
  loads, so the previous visual's card does not linger against the new
  visual's name.
- `api` is `null` until the new module has mounted, so the third block
  disappears and reappears.

### 8.4 Tuning

- A slider change calls `onSetting(key, Number(e.target.value))` — the hook
  clamps and snaps it to the step.
- The tuning is **per style**: switching to another visual shows that
  visual's own stored tuning (or VoltViz's defaults).
- The RESET button resets only the sliders on screen.

### 8.5 The suspended-audio warning

- It appears whenever `audioState` is set and is not `'running'` — e.g.
  `'suspended'`, `'interrupted'`, `'closed'`.
- It is **informational only**; it does not block picking a visual.

### 8.6 Layout-editor drag

- While `editing` is true, the panel is draggable via `useChromeDrag`.
- The 4 px threshold keeps a click a click; the capture-phase click swallow
  stops the drop from also pressing a button.
- The offset is **unbounded** — it may be dragged past the window edge.
  `RESET SCREEN` in the Customize hub is the way back.
- The native corner resizer (from `.panel-resizable`) stays live during an
  edit session — `useChromeDrag` explicitly lets the bottom-right 22 × 22 px
  corner through.

### 8.7 What a rebuild could plausibly get wrong

1. Rendering the SETTINGS block when no visual is selected.
2. Offering a HUE slider — it is deliberately absent.
3. Showing all four sliders for `butterchurn`.
4. Showing the raw registry name with `(WebGL)` in the button — it is
   stripped.
5. Making the panel own the selection instead of reading `volt` — it must
   stay controlled.
6. Unmounting on the ✕ click instead of waiting 200 ms — the exit animation
   would be cut.
7. Forgetting the GPL attribution line.
8. Calling `setOwnCard(null)` synchronously in the effect body — the
   react-hooks compiler rejects it. Use a microtask.

---

## 9. Hard requirements / traps

| # | Requirement | Why |
| --- | --- | --- |
| 1 | The panel is `role`-free but the header button must keep `aria-label="Visualiser options"`. | It is the only trigger; a harness or an extension may look for it. |
| 2 | `z-[89]` and `fixed left-[5%] top-[4.5rem]`. | The radio panel shares the `z-[89]` band; the queue panel is at `z-80`. |
| 3 | The class list must include `settings-panel`, `panel-resizable` and `fx-blur`. | `settings-panel` gives the entrance/exit **and** the hairline scrollbar; `panel-resizable` gives the corner resizer; `fx-blur` follows the wallpaper's BLUR switch. |
| 4 | All four `useChromeDrag` returns must be wired, with the pointer handler in the **capture** phase. | Otherwise the drag fights the controls. |
| 5 | The grid must be `grid-cols-3` with `OFF` **first**. | |
| 6 | The label is `v.name.replace(/ \(WebGPU\)$/, '').toUpperCase()`; the `title` keeps the full name. | |
| 7 | The readout is `${value.toFixed(1)}x`. | |
| 8 | The slider's `aria-label` is `` `${label.toLowerCase()} for ${name}` `` — **lower-cased label, original-case name**. | |
| 9 | `tuningFor('butterchurn')` returns **only** SENSITIVITY. | |
| 10 | The SETTINGS block and the HIDE UI button render **only when `volt` is set**. | |
| 11 | The `OwnCard` block needs **all three** of `volt`, `api` and `OwnCard`. | |
| 12 | The `OwnCard` reset must be on a **microtask**, not synchronous in the effect. | The react-hooks compiler rejects a synchronous `setState` in an effect body. |
| 13 | `md-voltviz` stores the id, or the literal `'off'` for none. | `'off'` is the stored form of `null`. |
| 14 | `md-voltviz-settings` is keyed by style id. | The tuning is per style. |
| 15 | Every stored value is clamped to `VOLT_SETTING_RANGE` **and snapped to the step**. | |
| 16 | `hueShift` stays in the `VisualizerSettings` type but is **not** surfaced. | The visuals that compute with it need the field. |
| 17 | The footnote carries the GPL-3.0 attribution for the Sonic Topography ports. | Licensing. |
| 18 | The close is delayed by **200 ms**. | The exit animation must run. |
| 19 | The panel is `flex flex-col` with `max-h-[min(70vh,560px)]` and the content column scrolls. | |

### 9.1 Registry invariants

- **17 styles**, **18 grid buttons** (17 + OFF).
- Every registry `module` name must resolve to a file in
  `features/voltviz/impl/` — `loadVisualizer` rejects otherwise, and the
  backdrop shows its "would not start" message.
- The registry is imported by Node-side tests too, so it must stay **plain
  data** (no React, no browser API).

### 9.2 Test coverage

`tests/visualizer.test.mts` covers the **sample pump** (`features/visualizer/`
— the PCM tape and the bridge), not this panel. Nothing in the unit suite
touches `VisualizerPanel.tsx`; the panel is covered by the manual harnesses
and by the type-checker.
