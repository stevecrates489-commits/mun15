---
name: glisse
description: A faithful implementation of Apple's Liquid Glass for the web — ready-made React components (Button, Glass, Input, Menu, SearchField, SegmentedControl, Slider, Switch, TabBar) that carry Apple-style glass styling with them. Use when the user wants iOS 26-style controls and bars without building the material by hand. Source: https://github.com/0kzh/glisse, npm `glisse`
---

# Glisse

Glisse is a faithful implementation of Apple's **Liquid Glass** as React components. Styles ship with the components (injected at import), so dropping one in gives you a properly glassy, Apple-flavoured control.

Full source lives in `libs/glisse/` in this repo. Docs with live examples: https://glisse.kelvinzhang.ca

## Install

```sh
npm install glisse
```

## Usage

```tsx
import { Button, Switch } from "glisse";

function Settings() {
  return (
    <div>
      <Switch aria-label="Wi-Fi" defaultChecked />
      <Button variant="filled">Continue</Button>
    </div>
  );
}
```

Styles come with the components — no separate CSS import required.

## Components

| Export | Purpose |
| --- | --- |
| `Glass` | the glass material wrapper (backdrop for the rest) |
| `Button` | variants such as `filled` |
| `Switch` | iOS-style toggle |
| `Input` | glass text input |
| `SearchField` | iOS search field |
| `SegmentedControl` | iOS segmented picker |
| `Slider` | iOS-style slider |
| `Menu` | glass popover menu (`MenuEntry`, `MenuItem`) |
| `TabBar` | glass tab bar (`TabBarItem`) |

Each export has a matching `*Props` type.

## When to use it

- The user asks for "iOS 26 controls", "Apple-style buttons/bars/switches", or a settings panel that feels native.
- Prototyping an Apple-flavoured UI quickly without hand-rolling the material.
- Paired with `liquid-glass` / `liquid-glass-react` / `liquidgl` when you need a custom glass moment *around* the ready-made controls.

## Gotchas

- It is a component library, not a physics engine: it gives the Apple look, not WebGPU refraction. For physically refracted panes use the `liquidgl` skill.
- Style injection is global — importing any component brings the shared stylesheet once.
- Keep the surrounding chrome quiet so the glass components read as the one designed moment.
- Check each component's props in `libs/glisse/src/*.tsx` before assuming an API; the docs site is the source of truth for live behaviour.

## Sibling options in this project

- `liquid-glass` — plain-JS SVG-filter refraction.
- `liquid-glass-react` — React lens over live DOM.
- `liquidgl` — WebGPU/WebGL real refraction.
- `apple-design` — HIG-grounded review before you reach for any of them.
