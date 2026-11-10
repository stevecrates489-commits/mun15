---
name: liquidgl
description: True physical liquid-glass refraction rendered in WebGPU with WebGL fallback — turns any fixed or sticky element into a refracted glass pane with bevel, chromatic aberration, tint, frost, specular and fluid pointer interaction. Use when the user wants real refractive glass panes (nav bars, modals, audio-player chrome) rather than a blur. Source: https://github.com/naughtyduk/liquidGL, npm package `liquid-gl`
---

# liquidGL

`liquidGL` turns any fixed or sticky-positioned element into a refracted, glossy glass pane rendered in WebGPU with a fully automatic fallback chain: **WebGPU → WebGL2 → WebGL1 → CSS `backdrop-filter`**. No configuration needed.

Full source, demos and the npm package live in `libs/liquidGL/` in this repo.

## Install

```sh
npm install liquid-gl
```

or via CDN/browser script (`scripts/liquidGL.js`, no dependencies).

## Quick start

```html
<div class="liquidGL">
  <div class="content">
    <p>This content sits on top of the glass.</p>
  </div>
</div>

<script>
  document.addEventListener("DOMContentLoaded", () => {
    liquidGL({
      engine: "auto",     // "auto" | "webgpu" | "webgl2" | "webgl"
      snapshot: "body",   // area used for refraction (body recommended)
      target: ".liquidGL",// CSS selector(s) to glassify
      resolution: 2.0,    // snapshot quality
      refraction: 0.01,   // base refraction strength 0-1
      aberration: 0,      // chromatic aberration 0-1 (0 = off)
      bevelDepth: 0.08,   // edge bevel intensity 0-1
      bevelWidth: 0.15,   // bevel width as proportion of element 0-1
      frost: 0,           // blur radius px, 0 = crystal clear
      shadow: true,
      specular: true,
      reveal: "fade",
      tilt: false,
      draggable: false,
      interaction: "none",// "none" | "fluid"
      interactionStrength: 0.5,
      interactionRadius: 0.35,
      interactionViscosity: 0.65,
      magnify: 1,
      tint: "rgba(8, 10, 20, 0.25)", // optional CSS colour dye, alpha = strength
    });
  });
</script>
```

The element must be `position: fixed` or `position: sticky` — that's what the renderer snapshots against.

## v3 features

- **Tinted glass** — `tint` dyes the pane with any CSS colour; specular stays white. `lens.setTint("…")` at runtime.
- **Fluid interaction** — `interaction: "fluid"` makes a viscous, touch-aware surface that follows cursor/finger.
- **Chromatic aberration** — disperses red/blue either side of the refraction vector; concentrates at the bevel.
- **Stacked lenses** — lenses refract each other's output; order with `zIndex`.
- **Multiple lenses** — any number share one canvas.
- **Draggable lenses** — `draggable: true`, with `on.dragstart` / `on.drag` / `on.dragend`.
- **Per-lens destroy** — `lens.destroy()` tears down one lens only.
- **Engine override** — `engine` option or `?liquidGL-engine=webgl2` URL param.

## Options (core)

| Option | Default | Meaning |
| --- | --- | --- |
| `engine` | `"auto"` | renderer chain start |
| `snapshot` | `"body"` | area to refract |
| `target` | - | selectors to glassify |
| `content` | target itself | sub-element rendered as lens content |
| `resolution` | 2.0 | snapshot quality |
| `refraction` | 0.01 | refract strength 0-1 |
| `aberration` | 0 | colour fringe 0-1 |
| `bevelDepth` | 0.08 | edge bevel intensity |
| `bevelWidth` | 0.15 | bevel width proportion |
| `frost` | 0 | blur px |
| `shadow` | true | drop shadow |
| `specular` | true | animated highlights |
| `reveal` | `"fade"` | entrance animation |
| `tilt` | false | hover tilt |
| `zIndex` | element's own | stacking order |
| `tint` | none | CSS colour dye |

## Gotchas

- Only fixed/sticky elements work — the pane refracts the page behind it.
- GPU cost grows with pane area and count; keep panes small and few.
- Without WebGPU support it silently degrades to WebGL then CSS blur. Never make refraction carry meaning.
- Full option and preset tables are in `libs/liquidGL/README.md` (`## Parameters`, `## Presets`).
- Demos: `libs/liquidGL/demos/` — audio-player, menu-bar, tinted-glass, fluid-interaction and more.

## Sibling options in this project

- `liquid-glass` — minimal plain-JS refraction with an SVG filter (very light).
- `liquid-glass-react` — React lens component over live DOM.
- `glisse` — prebuilt Apple-style components.
