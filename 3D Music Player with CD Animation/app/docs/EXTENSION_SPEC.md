# MUN15H Extension Specification

**Status:** v1.0 · **Applies to:** MUN15H — MD Walkman player (`app/`) · **Host:** Tauri 2 + React 19 + Vite

This is the contract for anything that adds behaviour to the player without being the player: visualisers, audio processors, background painters, UI panels, and external services such as **ONLINE** (Dannify). Read it before writing an extension. If an extension breaks a rule here, it is a bug even if it looks good.

---

## 1. Overview

### 1.1 What an extension is

An extension is a self-contained feature that plugs into one of the player's **seams** and can be removed without touching the player's core. The core owns: the audio deck, the CD stage, the playlist library, the layout system, the wallpaper layer stack, and the panel chrome.

An extension owns: its own feature, its own settings, its own cleanup. It does **not** own the player's audio graph, its React tree, its storage keys, or its z-index bands.

There are two extension grades:

| Grade | Where it lives | How it runs | Example |
| --- | --- | --- | --- |
| **In-tree** | Compiled into `app/` | A module the host imports (lazy-loaded for visualisers) | VoltViz styles (`src/features/voltviz/impl/*`) |
| **External** | Its own process / window | Talked to over a narrow bridge (Tauri command → loopback HTTP) | **ONLINE / Dannify** (`dannify/`, `src-tauri/src/dannify.rs`) |

> **State of the loader today.** There is no dynamic on-disk extension loader. In-tree extensions are registered in source; external extensions are launched by a Rust command. This document defines the shape both follow now, and the shape a future loader must accept, so extensions written today do not have to be rewritten.

### 1.2 Supported extension types

| Type | Seam | Contract |
| --- | --- | --- |
| **Visualiser** | Background layer (`VoltVizBackdrop`) | §4.1 |
| **Audio processor** | Master insert before the analyser | §4.2 |
| **Wallpaper / background** | Theme + paint layers | §4.3 |
| **UI panel** | Settings popover / drawer / hub row | §4.4 |
| **Metadata / tagger** | Library records, track meta editor | §4.6 |
| **External service** | Loopback bridge, own window | §4.6 |

### 1.3 Platforms

- **Desktop app:** Tauri 2 (WebView2 / WKWebView / WebKitGTK). Windows is the reference target.
- **Browser dev:** `npm run dev`. Extensions that call `invoke()` must degrade gracefully — see `lib/bootGate.ts` and `lib/fatalError.ts`.
- Web Audio, Canvas2D, WebGL2 and WebGPU availability is a runtime fact, not a promise. Feature-detect and fall back.

---

## 2. Getting started

### 2.1 Prerequisites

- Node 20+, the app's own toolchain: `cd app && npm install`
- Rust + Tauri CLI only if the extension needs the shell (`npm run tauri`)
- Understanding of the file layout in §2.3 and the rules in §7

### 2.2 Scaffolding

**In-tree visualiser** (the common case):

```bash
cd app
# 1. add the module
touch src/features/voltviz/impl/MyVisual.ts
# 2. register it (newest first)
#    src/features/voltviz/registry.ts
# 3. run it
npm run dev
```

**External extension** (own window / own process):

```
extensions/<id>/
  extension.json      # manifest (§3)
  index.html          # its own UI
  server/             # optional backend
```

The shell side needs one Rust command pair (open + handshake). Model it on `src-tauri/src/dannify.rs`; never add a generic "run this command" bridge.

### 2.3 Directory layout

```
app/
  src/
    features/<feature>/          # one folder per feature/extension domain
      <feature>.ts / .tsx        # logic
      use<Feature>.ts            # state + persistence
      impl/                      # lazy-loaded renderer modules (visualisers)
      registry.ts                # plain data: id, name, module (Node-importable)
      modules.ts                 # lazy loaders (import.meta.glob)
      runtime-types.ts           # the contract types
    components/                  # host UI + extension panels
    lib/                         # host utilities (accent, quality, glass, storage)
    hooks/useAudioEngine.ts      # the only audio graph owner
  tests/                         # Node-run unit tests (*.test.mts)
  docs/                          # this spec, integration contracts
  src-tauri/src/                 # shell commands (external extensions only)
```

**Rules**

- One top-level folder per domain under `src/features/`.
- Never add extension files under `src/components/ui/` (that is the shadcn/ui primitives layer).
- Registry files are **plain data** — they are imported by Node-side tests; no DOM, no React, no Web Audio at import time.
- Renderer modules are **lazy**: one chunk per visual, loaded through `modules.ts`.

### 2.4 ID and naming

- `id`: lowercase, kebab-case, stable forever (`my-visual`, `online`). It is the storage namespace and the settings key.
- Display name: title case (`My Visual`), shown in the picker.
- CSS classes: prefix with the extension id (`mv-panel`), never reuse host classes (`settings-panel`, `bg-layer`, `menu-surface`).
- Storage: `md-*` belongs to the host. Extensions use `ext.<id>.*` (§4.5).

---

## 3. Manifest

Every external extension and every packaged in-tree bundle carries `extension.json`. In-tree extensions also record the same fields as a comment at the top of their entry module until a loader exists.

### 3.1 Required fields

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | string | stable kebab-case id |
| `name` | string | display name |
| `version` | semver | extension's own version |
| `apiVersion` | integer | manifest/API generation this extension targets (currently `1`) |
| `host` | string | `"min-host-version"` semver the extension needs |
| `entry` | string | module path or `index.html` for external |
| `kind` | enum | `visualizer \| audio \| wallpaper \| panel \| external \| metadata` |

### 3.2 Optional fields

| Field | Type | Meaning |
| --- | --- | --- |
| `capabilities` | string[] | what it may touch: `audio:read`, `audio:insert`, `ui:panel`, `wallpaper:paint`, `net:loopback`, `fs:library` |
| `slot` | string | where its UI entry sits: `extensions-hub`, `visualizer-picker`, `wallpaper-picker` |
| `settings` | JSON Schema | its settings shape, for the host to render or validate |
| `permissions` | object | see §7.1 |
| `dependencies` | object | `{ "<id>": "^1.2.0" }` |
| `budget` | object | `{ "frameMs": 4, "gpuMb": 128 }` (§7.3) |

### 3.3 Example manifest

```json
{
  "id": "my-visual",
  "name": "My Visual",
  "version": "1.0.0",
  "apiVersion": 1,
  "host": ">=1.0.0",
  "kind": "visualizer",
  "entry": "src/features/voltviz/impl/MyVisual.ts",
  "capabilities": ["audio:read", "ui:visualizer-settings"],
  "slot": "visualizer-picker",
  "settings": {
    "type": "object",
    "properties": {
      "sensitivity": { "type": "number", "minimum": 0.1, "maximum": 3, "default": 1 },
      "speed": { "type": "number", "minimum": 0.1, "maximum": 3, "default": 1 },
      "hueShift": { "type": "number", "minimum": 0, "maximum": 360, "default": 0 },
      "scale": { "type": "number", "minimum": 0.5, "maximum": 3, "default": 1 }
    }
  },
  "budget": { "frameMs": 4, "gpuMb": 128 }
}
```

Any field the host does not understand must be ignored, not rejected.

---

## 4. API reference

### 4.1 Visualiser API

This is the richest seam and the reference for every renderer contract.

#### Registration

1. Create `src/features/voltviz/impl/<Module>.ts` (or `.tsx`).
2. Add one line to `src/features/voltviz/registry.ts` — **newest first**:

```ts
export const visualizers = [
  { id: 'myvisual', name: 'My Visual', module: 'MyVisual' },
  // …
] as const satisfies readonly VisualizerEntry[]
```

That single entry feeds the id union (`VisualizerType`), the picker labels, the lazy loader (`modules.ts`) and the consistency tests. Do not register in more than one place.

#### The module contract (`runtime-types.ts`)

```ts
export type VisualizerFactory = (ctx: MountContext) => VisualizerInstance | Promise<VisualizerInstance>

export interface VisualizerModule {
  default: VisualizerFactory
  Overlay?: ComponentType<{ api: Record<string, (...args: never[]) => unknown> | null }>
}
```

`VisualizerInstance`:

```ts
{
  frame(f: FrameContext): void          // once per animation frame
  resize?(w, h, dpr): void              // CSS size changed; also called once after mount
  metadata?(m): void                    // optional metadata channel
  dispose(): void                       // REQUIRED: release everything
  api?: Record<string, Function>        // exposed to Overlay
}
```

`MountContext` gives you: an empty absolutely-filled `container`, `width`, `height`, `dpr` (already capped ≤ 2), the current `settings`, metadata, and — only for the rare visual that needs a real node — `analyser` / `getAnalyser()`.

`FrameContext` gives you: the shared `AudioFrame`, `settings`, `metadata`, `time` (seconds since mount), `dt` (seconds, ≤ 0.1), `width`, `height`, `dpr`.

#### Audio: read, never touch

Visualisers never create an `AudioContext`, never attach to media elements, never connect nodes. They read the `AudioFrame` produced once per frame by `createAudioFrameSource(getAnalyser)`:

```ts
const { spectrum, bands, beat, onsets, level, … } = f.audio
```

- `spectrum({ fftSize, smoothing })` — pooled shared analyser, default 2048 / 0.8.
- `bands` — named band means 0..1.
- `beat` — pulse model (BPM, phase, bar position, strength, confidence, accents). Use it instead of re-deriving beats.
- `onsets` — per-kind envelopes for kicks/snares/hats.

If you need a sample-level probe, request `getAnalyser()` and read it in `frame`, budgeted (§7.3).

#### Rendering rules

- Append canvases/DOM to `ctx.container`; never to `document.body`.
- Use `three186` (`npm:three@^0.186.1`) for new Three.js visuals; the older `three@0.128` exists only for legacy modules.
- Size from `resize()`, draw at `dpr` given, scale by `settings.scale`.
- Respect `settings`: `sensitivity`, `speed`, `hueShift`, `scale` (ranges 0.1–3, 0.1–3, 0–360, 0.5–3).
- No layout-triggering DOM writes per frame. Canvas only, or transforms.
- `dispose()` must free GPU resources: geometries, materials, textures, renderer, event listeners, observers.

#### Full example — a minimal visualiser

`src/features/voltviz/impl/MyVisual.ts`

```ts
import type { VisualizerFactory, VisualizerInstance } from '../runtime-types'

const MyVisual: VisualizerFactory = (ctx): VisualizerInstance => {
  const canvas = document.createElement('canvas')
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%'
  ctx.container.appendChild(canvas)
  const g = canvas.getContext('2d')!
  let w = ctx.width, h = ctx.height, dpr = ctx.dpr

  const resize = (nw: number, nh: number, ndpr: number) => {
    w = nw; h = nh; dpr = ndpr
    canvas.width = Math.max(1, Math.round(w * dpr))
    canvas.height = Math.max(1, Math.round(h * dpr))
  }
  resize(w, h, dpr)

  return {
    resize,
    frame({ audio, settings, dt }) {
      const level = audio.level ?? 0
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.clearRect(0, 0, w, h)
      g.fillStyle = `hsl(${(settings.hueShift + level * 120) % 360} 80% 60%)`
      const r = 40 + level * 160 * settings.sensitivity
      g.beginPath()
      g.arc(w / 2, h / 2, r, 0, Math.PI * 2)
      g.fill()
      void dt
    },
    dispose() {
      canvas.remove()
    },
  }
}

export default MyVisual
```

Then one registry line. Nothing else.

#### Switching and crossfade

The host crossfades styles (400 ms) and keeps the outgoing layer until the incoming one has painted a real frame. Do not implement your own fade-in; do not paint `document.body`; do not assume you are the only layer.

### 4.2 Audio processing API

The audio graph has exactly one owner: `src/hooks/useAudioEngine.ts`. It owns the `<audio>` element, the `AudioContext`, the master gain, the analyser, crossfade and normalisation.

An audio-processing extension declares an **insert point** instead of wiring itself:

| Insert | Position | Allowed |
| --- | --- | --- |
| `pre-analyser` | between master gain and analyser | yes — visualisers see the processed signal |
| `post-analyser` | after the analyser, before destination | yes — visualisers see the raw signal |
| `replace-master` | replaces the deck gain | **no** — reserved for the host |

Contract:

```ts
export interface AudioProcessorModule {
  /** create the processor; host supplies its context and the node to wrap */
  create(ctx: AudioContext, input: AudioNode, output: AudioNode, opts): AudioProcessorInstance
}

export interface AudioProcessorInstance {
  /** persist-free settings, applied live */
  setParam(name: string, value: number | boolean | string): void
  /** meters for the host UI, 0..1 */
  meters?(): { cpu: number; reduction: number }
  bypass(on: boolean): void
  dispose(): void
}
```

Rules:

- **Never** call `ctx.suspend()` / `ctx.resume()` / `ctx.close()` — that is the host's decision (autoplay policy, device changes).
- **Never** create a second `AudioContext`.
- **Never** connect to `destination`, and never disconnect the host's `analyser` or `gain`.
- Keep latency declared and constant; a processor that changes lookahead mid-playback is rejected.
- Parameter changes must be ramped (`setTargetAtTime`), never stepped on the live graph.
- Offline analysis is allowed only on explicit user action, and must not block the UI thread.

The player's own crossfade, normalisation and gapless promotion happen outside your insert; do not try to "fix" them.

### 4.3 Wallpaper / background API

The backdrop is a stack of full-bleed layers inside the root, all `pointer-events-none`, all `position:absolute; inset:0`. Priority, bottom to top:

| Order | Layer | Owner | Notes |
| --- | --- | --- | --- |
| 1 | `black` theme | host | default |
| 2 | `aurora` theme (two drifting gradients) | host | compositor-only transform animation |
| 3 | `color` paint (solid or 2-stop gradient) | host | from the header swatch |
| 4 | custom wallpaper (image / muted looping video) | host | `<video>` stays mounted |
| 5 | **live visual** (`VoltVizBackdrop`) | host + visualiser module | replaces the background, above every paint |
| 6 | scanlines / vignette effects | host | `bg-layer`, never interactive |

A wallpaper extension paints **at its own slot** by adding a layer with the `bg-layer` class and `z-0`, and must:

- never intercept pointer events;
- never animate with layout properties (transform/opacity only);
- honour the host's **BLUR**, **DIM** and quality settings, which apply to the whole backdrop;
- pause when `theme !== 'custom'` or when the host reports the window hidden (`md-wall-pausehidden`);
- expose its settings through the wallpaper panel (`slot: "wallpaper-picker"`) rather than its own separate panel.

Theme ids today: `black`, `aurora`, `color`, `custom`. New themes register in `THEMES` with an id, label and swatch, and must render under the same layer rules. `aurora` (the moving gradient) is still a valid, still-rendered theme but its header swatch was removed — it can no longer be picked, only inherited from an existing profile.

### 4.4 UI API

#### Panel conventions

Every settings-style panel follows the existing `CustomizePanel` / `ExtensionPanel` shape:

- container: `settings-panel fx-blur fixed z-[88] w-60|64 rounded-2xl border border-white/15 bg-black/85 p-4 backdrop-blur-md`
- entrance/exit: the `settings-panel` / `is-closing` classes (200 ms in, 160 ms out), `onClosed` called after the exit finishes
- position: computed from the invoking button's `getBoundingClientRect()`, clamped into the viewport
- header: uppercase micro-label (`font-mono text-[9px] tracking-[0.25em] text-white/50`) + `X` close
- section labels: `font-mono text-[8px] tracking-[0.2em] text-white/35`
- rows/toggles: `rounded-lg bg-white/5` with `hover:bg-white/10`; active state `bg-emerald-400/15 text-emerald-200`
- explanatory footnotes: `font-mono text-[7px] ... text-white/25`

**Slot budget.** The stage chrome has one button per *hub*, not per feature. Extensions add a **row** to the Extensions panel (`.agents`-style, see `ExtensionPanel`), not a corner button. A brand-new hub needs a review — the corner row is full at three buttons.

#### Theming tokens

There is no design-token file; the tokens are the conventions:

| Token | Value |
| --- | --- |
| accent | `emerald-300/400` family (selection, success) |
| danger | `red-400` family (destructive only) |
| surface | `black/85`, `black/80`, `#101014` |
| raised | `white/5`, `white/10` |
| border | `white/10`, `white/15` |
| text primary | `white`, `white/85` |
| text secondary | `white/50` |
| text muted | `white/25`–`white/35` |
| type | system UI + `font-mono` for labels/meta |
| radius | `rounded-lg` controls, `rounded-2xl` panels |
| motion | 150–200 ms panels, 320–450 ms stage, one easing family |

Extensions reuse these. A new accent colour is a product decision, not an extension decision.

#### Layer bands (z-index)

| Band | Value | Contents |
| --- | --- | --- |
| Backdrop | `z-0` | all `bg-layer` paints, wallpaper, visualiser |
| Stage | `z-30` | CD stage, lyrics |
| Footer | `z-40` | marquee |
| Hubs | `z-[85]` | corner buttons (playlist, extensions, customize) |
| Settings popovers | `z-[86]`–`z-[88]` | extension/customize/wallpaper/cd/lyrics panels |
| Overlays | `z-[89]`–`z-[90]` | playlist drawer, creator ring |
| Modals | `z-[94]`–`z-[96]` | editors, floating SAVE, safe-mode banner |
| Menus / toasts | `z-[300]` | context menus, transient menus |

Extension panels go at `z-[88]`. Do not exceed the band your component belongs to; a panel that covers a modal is a defect.

#### Glass and blur

- `backdrop-filter` is expensive and has exactly **one writer per element**. If a surface already has frost, compose (`attach:false` + `filterUrl`) instead of writing a second value.
- At most **two** real-refraction surfaces on screen (see `lib/liquidGlass.ts`). Buttons inside a glass panel are translucent CSS, not their own glass.
- `data-fx` (quality governor) and `data-glass="off"` disable `backdrop-filter` globally — extensions must look correct without it. The `fx-blur` class on panels is the supported opt-out.
- Refraction must never carry meaning; Safari/Firefox receive the frosted fallback.

### 4.5 Events, state and storage

The host exposes React state, not a global event bus. In-tree extensions subscribe the way the host does:

| Event / state | Seam |
| --- | --- |
| Playback time | `engine.subscribeTime(cb)` |
| Track ended | `engine.subscribeTrackEnd(cb)` |
| Track changed | `useAudioEngine().trackIndex` / `tracks` |
| Playing / busy / failed | `engine.playing`, `busy`, `failed` |
| Radio state | `useRadio()` |
| Visualiser style/tuning | `useVoltViz()` (`md-voltviz`, `md-voltviz-settings`) |
| Wallpaper theme/settings | `useWallpaper()` |
| Playlists/library | `usePlaylists()`, `usePlaylist()` |
| Downloads finished (ONLINE) | `onDannifyDownloadsDone(cb)` |
| Lyrics | `useLyrics()` |

Rules:

- Never read host internals via DOM queries or React internals. If a value is missing, add a typed seam to the owning hook.
- External extensions never receive React state. They get an explicit bridge (§4.6).

**Storage.** Host keys are `md-*` (e.g. `md-theme`, `md-volume`, `md-glass`, `md-lyrics-custom`, `md-visualizer-mode`). An extension writes only under `ext.<id>.*`, wraps every access in `try/catch` (private mode), and versions its payload (`{ v: 1, … }`).

### 4.6 Filesystem, network, metadata

- The webview has **no** filesystem or process access by default. Anything the extension needs from disk goes through a **named Tauri command** added in `src-tauri/src/`, not a generic bridge.
- External extensions bind **loopback only** (`http://127.0.0.1:<port>/`), with a fixed or negotiated port recorded in the manifest. No remote origins, no telemetry, no auto-update over the network.
- Metadata extensions must not rewrite audio files in place. Tags are written through the library layer (`lib/library.ts`, `lib/tags.ts`), and an edit must be reversible through the track meta editor.
- **ONLINE (Dannify) is the reference external extension.** Study `docs/INTEGRATION_CONTRACT.md`: its six seams are exactly the pattern to copy — filesystem/layout, Python names, HTTP, in-page bridge, UI chrome, and a version contract (`dannify_version` → `contract`, `ok`, `missing[]`) so a host update that moves a name is reported, not silently broken.

---

## 5. Lifecycle

```
load ─▶ init ─▶ ready ─▶ (runtime) ─▶ unload
```

| Phase | Visualiser | External |
| --- | --- | --- |
| **load** | chunk fetched by `modules.ts` | command spawns/finds the process |
| **init** | factory called with `MountContext` | handshake (`dannify_open` / `/api/player/version`) |
| **ready** | first `frame()` renders a real picture | the report says `ok: true` |
| **runtime** | `frame` / `resize` / `metadata` | bridge calls only |
| **unload** | `dispose()` | window closed; process may stay warm by design |

**Error isolation**

- A visualiser that throws must not take the player down: the host keeps the previous layer and the panel still works. Throw once at mount to fail fast; throw every frame and you will be unloaded.
- External extensions report health; a missing route is a version mismatch, not a crash. Surface it in the ONLINE panel with a retry, not an alert.
- Any failure that happens before first paint is reported through `lib/fatalError.ts`; never `alert()`.

**Hot reload**

- In-tree: Vite HMR. The module must survive remount: dispose timers/renderers in `dispose()`, do not keep module-level GPU state.
- Settings changes are live, without remounting the visual (the `settings` object is mutated in place — hold the reference, read fields each frame).
- External: no hot reload; restart via the command, keep the port contract.

---

## 6. Packaging & distribution

### 6.1 In-tree

- Bundle with Vite. Visualisers are code-split automatically by `import.meta.glob` in `modules.ts`.
- No new runtime dependency without justification: the app already carries Three.js (two majors), Butterchurn, and the visualizer native bridge. Prefer what exists.
- Ship no assets over ~2 MB uncompressed; textures are loaded lazily and disposed.

### 6.2 External

- Ship the extension as a folder with `extension.json`, its entry, and a start command declared in the manifest.
- The host launches it through a **named** Rust command (model: `dannify_open`), which:
  - spawns once and waits for the port,
  - never exposes a generic `exec`,
  - reports a typed error the UI can render.
- Version contract: `contract` (integer revision of the host's routes), `ok`, `missing[]`. Bump `contract` when a route/name changes; an older extension answering `404` is reported as `contract: 0`, not as a failure.
- **Trust.** There is no signing infrastructure today. An external extension is trusted by being bundled by the developer and launched by a fixed command. Do not add remote code loading, and do not auto-download extensions at runtime without explicit user action.
- **Install/uninstall** is folder-level: add/remove the folder and its command registration. Uninstalling must remove nothing from the user's library; downloaded media stays.

### 6.3 Updates

- In-tree: normal app update.
- External: `tools/update-dannify.py` is the reference updater — it pins the source, copies the build, and verifies the routes the host reaches for. Any external extension update must run the same "probe every name" check before it is considered installed.

---

## 7. Constraints & rules

### 7.1 Security boundaries

- No `eval`, no `new Function`, no remote script tags, no arbitrary `fetch` to third-party origins.
- No filesystem, shell or process access from the webview except through named commands.
- Never write host storage keys (`md-*`), never delete library records, never touch the user's saved playlists/layouts.
- External extensions: loopback only, no telemetry, no credential capture beyond the documented sign-in flow.
- A UI extension must be dismissible: every panel closes with `X`, `Esc` where the host supports it, and never traps focus.

### 7.2 Layering & visibility

- Backdrop layers never receive pointer events.
- Extension UI lives in its assigned z-band (§4.4). Never `z-[9999]`.
- Respect `body.hide-ui` (fullscreen/hide chrome): non-backdrop UI hides.
- Respect reduced motion where the host does.

### 7.3 Performance budgets

The player targets **60 fps** with a video wallpaper and a live visual at once.

| Resource | Budget |
| --- | --- |
| Visualiser per-frame CPU | ≤ 4 ms on the reference machine (1080p, DPR ≤ 2) |
| Allocations in `frame()` | zero — preallocate buffers; reuse objects |
| GPU memory per visual | ≤ 128 MB; dispose on switch |
| Texture sizes | power of two, ≤ 2048² unless the visual needs otherwise |
| Audio processors | ≤ 1.5 ms per 128-sample block, constant latency |
| Glass surfaces | ≤ 2 real-refraction surfaces; more requires a review |
| DOM writes per frame | none except canvas/transform |

Host governors your extension must obey, not fight:

- `lib/adaptiveQuality.ts` — drops the DPR cap (2 → 1.25 → 1) when the frame rate stays low; canvases must re-measure on `resize`.
- Wallpaper pipeline `data-fx` tiers — reduce/suspend expensive paint while a video wallpaper decodes.
- `data-glass="off"` — removes every `backdrop-filter`; the UI must still read.

If your extension cannot meet its budget, degrade quality, not behaviour.

### 7.4 Accessibility

- Contrast ≥ 4.5:1 for body text, ≥ 3:1 for large text — compute it, do not eyeball (see the `apple-design` review rules).
- Every icon-only control has an `aria-label`; every toggle has `aria-pressed`.
- Keyboard: panels open/close, toggles work, focus is visible and returns to the invoking control.
- Nothing is conveyed by colour alone; motion is never the only signal.
- Respect `prefers-reduced-motion`.

### 7.5 Versioning & compatibility

- `apiVersion` is the manifest generation (currently `1`). Adding optional fields is compatible; renaming/removing a field bumps it.
- Host semver: an extension declares `host: ">=1.4.0"`. A host below it must not load the extension.
- External extensions use the `contract` integer for route compatibility.
- Breaking changes to `VisualizerInstance`, `MountContext`, `FrameContext`, `AudioFrame` require a changelog entry here and a migration note in the PR.

---

## 8. Testing

### 8.1 Commands

```bash
cd app
npm run test:unit     # node tests: paint, theme, songclock, visualizer pump/encoder
npx tsc -b            # types
npx eslint src        # lint
npm run build         # tsc + vite build
npm run dev           # manual verification
```

`.verify/*.mjs` holds the Playwright/manual capture scripts (`shot.mjs`, `uiter.mjs`, `uibatch.mjs`) used for visual regression passes.

### 8.2 What every extension must test

- **Visualiser:** mount → paints a non-empty frame → resize → still paints → switch away → `dispose()` leaves no canvases, listeners or GPU objects. A Node-run test of pure math is preferred.
- **Audio processor:** bypass equals the input; parameters ramp; latency constant; no disconnections after dispose.
- **UI panel:** opens from its hub, positions inside the viewport, closes by X and by the host's close path, no console errors.
- **External:** health probe returns `ok`, missing routes are reported, window close leaves no orphan process.

### 8.3 Mock environment

- Browser dev (`npm run dev`) has no Tauri APIs. `invoke()` rejects — handle it and hide shell-only actions.
- `lib/bootGate.ts` signals first paint; `lib/safeMode.ts` parks the live wallpaper after repeated failed starts. Test with safe mode active at least once.
- Simulate slow/failed audio by pointing a track at a missing file; the deck must recover, not hang.

### 8.4 Manual checklist

- [ ] First paint with no extension = unchanged player
- [ ] Extension enabled → 60 fps with video wallpaper + glass panel open
- [ ] Safari/Firefox-style no-refraction fallback still legible
- [ ] `data-glass="off"` and `data-fx` downgrade leave the UI usable
- [ ] Fullscreen/hide-UI hides chrome, keeps backdrop
- [ ] Reload restores the extension's state from its own keys only
- [ ] Uninstall leaves library and playlists untouched

---

## 9. Examples

### 9.1 Minimal "hello world" visualiser

See §4.1 — the full module plus one registry line. Acceptance: shows in the picker, paints a pulsing circle that follows level/hue, disposes cleanly.

### 9.2 A UI extension (visualiser settings)

A settings row in an existing panel is a **slot**, not a panel:

```tsx
// inside the visualiser panel, after the style picker
<div className="mb-1 flex items-center justify-between">
  <span className="font-mono text-[8px] tracking-[0.2em] text-white/35">MY VISUAL</span>
</div>
<div className="mb-3 grid grid-cols-2 gap-1.5">
  <button
    onClick={() => setSetting('sensitivity', Math.min(3, settings.sensitivity + 0.1))}
    className="rounded-lg bg-white/5 py-1.5 font-mono text-[8px] text-white/50 transition hover:bg-white/10 hover:text-white"
  >
    SENSITIVITY {settings.sensitivity.toFixed(1)}
  </button>
  {/* … */}
</div>
```

Own the values through `useVoltViz().setSetting` so they persist per style. Do not open a second floating panel for three sliders.

### 9.3 An audio processing extension

```ts
export const createBassBoost = (ctx: AudioContext, input: AudioNode, output: AudioNode) => {
  const shelf = ctx.createBiquadFilter()
  shelf.type = 'lowshelf'
  shelf.frequency.value = 120
  shelf.gain.value = 0
  input.connect(shelf)
  shelf.connect(output)
  return {
    setParam(name, value) {
      if (name === 'gain') shelf.gain.setTargetAtTime(Number(value), ctx.currentTime, 0.02)
    },
    bypass(on) {
      shelf.gain.setTargetAtTime(on ? 0 : 6, ctx.currentTime, 0.02)
    },
    dispose() {
      input.disconnect(shelf)
      shelf.disconnect(output)
    },
  }
}
```

Inserted `pre-analyser`, so visualisers react to the boosted signal. Latency stays zero-ish and constant; nothing disconnects the host's analyser.

### 9.4 A wallpaper extension

Add a layer in the backdrop stack with `bg-layer` + `z-0`, painting to a canvas sized from the container and the DPR cap, driven by requestAnimationFrame **only while the window is visible and the theme is `custom`**. Register a theme entry in `THEMES` with `{ id, label, swatch }` and route the wallpaper panel's BLUR/DIM/quality switches into it. Never add pointer handlers.

### 9.5 An external extension skeleton

```
extensions/online/
  extension.json
  index.html
  server/app.py            # loopback only
```

```json
{
  "id": "online",
  "name": "Online",
  "version": "1.0.0",
  "apiVersion": 1,
  "host": ">=1.0.0",
  "kind": "external",
  "entry": "index.html",
  "capabilities": ["net:loopback", "ui:extensions-hub"],
  "slot": "extensions-hub",
  "permissions": { "network": ["127.0.0.1"], "fs": "own-folder-only" }
}
```

Host side: one `open` command, one `version`/health probe, one typed report. Add the extension's row to `ExtensionPanel` (§4.4) — ONLINE is the template.

---

## 10. Changelog

| API | Date | Change |
| --- | --- | --- |
| 1.0 | 2026-11 | First written contract. Visualiser contract documented from `runtime-types.ts`; audio insert points, wallpaper layer order, z-bands, glass budget, storage namespacing, performance governors, external bridge pattern (ONLINE/Dannify) specified. No code changes implied. |
