---
name: liquid-glass-react
description: Apple-style liquid glass refraction for React — a lens component that refracts the LIVE DOM behind it (SVG displacement filter, works in Chrome, Safari and Firefox). Use when the user wants a real glass lens, a moving selection highlight, or Apple-style iOS 26 glass in a React app. Source: https://github.com/PallavAg/liquid-glass-web-react
---

# liquid-glass-react

Apple-style liquid glass for React. Unlike `backdrop-filter` glass (Chromium-only) this generates a displacement map and applies an SVG `feDisplacementMap` filter to the content itself, so it works in Chrome, Safari and Firefox, desktop and mobile. Zero dependencies, ~5 kB.

Full source and demo are in `libs/liquid-glass-web-react/` in this repo.

## Install

```sh
npm install liquid-glass-web-react
```

## Usage

```tsx
import { LiquidGlass } from "liquid-glass-web-react";

<LiquidGlass draggable>
  <img src="/cover.jpg" />
</LiquidGlass>
```

Fully customizable:

```tsx
<LiquidGlass
  x={0.3}                   // lens center, fraction of container (0-1)
  y={0.5}
  width={200}               // px
  height={140}
  radius={48}               // px, or "auto" for a pill
  strength={0.12}           // refraction strength
  chromaticAberration={0.3}
  curvature={0.8}           // 0 flat -> 1 spherical dome
  glow={0.15}
  edgeHighlight={0.3}
>
  <Dashboard />
</LiquidGlass>
```

### Moving selection highlight

Drive `x` imperatively to avoid re-renders:

```tsx
const lens = useRef<LiquidGlassHandle>(null);

<LiquidGlass ref={lens} x={(selected + 0.5) / options.length} width={104} height={46}>
  <ToggleGroup options={options} onSelect={setSelected} />
</LiquidGlass>;

// per frame, no React render:
lens.current?.setPosition(x, 0.5);
```

### Without React

```ts
import { LiquidGlassEngine } from "liquid-glass-web-react";

const engine = new LiquidGlassEngine({ container, filtered, defsHost });
engine.setPosition(0.5, 0.5);
engine.setOptions({ width: 200, strength: 0.12 });
```

## Key props

| Prop | Type | Default | Notes |
| --- | --- | --- | --- |
| `x`, `y` | number | 0.5 | lens center as fraction of container |
| `width`, `height` | number | 160, 120 | lens size px |
| `radius` | number \| "auto" | "auto" | "auto" = full pill |
| `strength` | number | 0.1 | refraction strength |
| `chromaticAberration` | number | 0.2 | colour fringe 0-1 |
| `blur` | number | 0 | blur of refracted content px |
| `depth` | number | 10 | width of refracting edge band px |
| `curvature` | number | 0.65 | 0 linear -> 1 spherical |
| `splay` | number | 1 | edge-normal refraction 0-1 |
| `glow` | number | 0.1 | inner specular glow |
| `edgeHighlight` | number | 0.25 | bright rim |
| `specular` | number | 1 | master specular intensity |
| `specularAngle` | number | 45 | light direction degrees |
| `draggable` | boolean | false | user can drag the lens |
| `shadow` | boolean \| string | true | drop shadow or custom box-shadow |
| `quality` | number | 512 | displacement map resolution |
| `onMove` | (x,y)=>void | - | fires as lens moves |
| `onMapGenerated` | (url)=>void | - | fires with map PNG data URL |

Also accepts any `<div>` prop. Renders a `position: relative` wrapper around children.

`ref` exposes `{ element, engine, setPosition(x, y) }` — `setPosition` is safe once per frame and never regenerates the map.

Low-level exports: `LiquidGlassEngine`, `computeDisplacementMap`, `renderDisplacementMap`, `DEFAULT_OPTIONS`.

## Gotchas

- The lens bends pixels already painted behind it — content stays selectable/clickable, video keeps playing.
- Only the *shape* regenerates the map; moving it is cheap. Never regenerate on position-only animation.
- Use sparingly and small: a lens is a moment, not a page treatment.

## Sibling options in this project

- `liquid-glass` skill — plain-JS `liquidGlass(el, opts)` drop-in, no React.
- `liquidgl` skill — WebGPU/WebGL physically-refracted panes with fluid interaction.
- `glisse` skill — ready-made Apple-style components (Button, Switch, TabBar, …).
