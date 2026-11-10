---
name: lenis
description: Smooth-scroll library by darkroom.engineering — lightweight, dependency-free, runs on native scroll so sticky, anchors and accessibility keep working. Use when the user wants momentum/smooth scrolling, WebGL scroll syncing, parallax, or scroll-driven animation timelines. Source: https://github.com/darkroomengineering/lenis, npm `lenis`
---

# Lenis

Lenis ("smooth" in Latin) is a lightweight smooth-scroll library. It wraps the browser's **native scroll**, so `position: sticky`, anchor links and accessibility keep working. Zero dependencies, few KB.

Full source and docs live in `libs/lenis/` in this repo.

## Install

```sh
npm install lenis
```

Vanilla:

```js
import Lenis from "lenis";

const lenis = new Lenis({ autoRaf: true });

lenis.on("scroll", (e) => {
  // sync WebGL, parallax, scroll-driven UI
});

// stop / start
lenis.stop();
lenis.start();
```

Custom RAF loop (when you already have one):

```js
const lenis = new Lenis();

function raf(time) {
  lenis.raf(time);
  requestAnimationFrame(raf);
}
requestAnimationFrame(raf);
```

## React

```tsx
import { useEffect, useRef } from "react";
import Lenis from "lenis";

export function useLenis() {
  const ref = useRef<Lenis | null>(null);
  useEffect(() => {
    const lenis = new Lenis({ autoRaf: true, lerp: 0.1 });
    ref.current = lenis;
    return () => lenis.destroy();
  }, []);
  return ref;
}
```

React Router / Next.js: call `lenis.scrollTo(0, { immediate: true })` on route change, or `lenis.scrollTo(element)`.

## Key settings

| Option | Default | Notes |
| --- | --- | --- |
| `lerp` | 0.1 | interpolation 0-1 (wins over duration) |
| `duration` | 1.2 | seconds, ignored if lerp set |
| `easing` | custom | `t => ...` |
| `autoRaf` | false | run the RAF loop for you |
| `orientation` | `"vertical"` | or `"horizontal"` |
| `gestureOrientation` | `"vertical"` | axis gestures act on |
| `anchors` | false | smooth-scroll `<a href="#...">` |
| `allowNestedScroll` | false | nested scrollers stay native |
| `prevent` | - | `(node) => boolean`, skip smoothing for matching nodes |
| `respectReducedMotion` | true | disables smoothing for `prefers-reduced-motion` |
| `autoResize` | true | ResizeObserver-based |
| `infinite` | false | needs `syncTouch` on touch |

Recommended CSS wrapper:

```css
html.lenis, html.lenis body { height: auto; }
.lenis.lenis-smooth { scroll-behavior: auto !important; }
.lenis.lenis-stopped { overflow: hidden; }
```

## Gotchas

- Never combine with `scroll-behavior: smooth` on `html` — Lenis owns scrolling.
- For nested scroll panels (like sidebars/drawers), either set `allowNestedScroll` or return `true` from `prevent` for those nodes.
- Respect reduced motion: keep `respectReducedMotion: true` (default) unless the product demands otherwise.
- `lenis.destroy()` on unmount in SPA routes.

## Sibling options in this project

- `glisse` — Apple-style components (not scroll).
- Smooth scrolling is deliberately **not** used inside virtualized lists; keep Lenis off those containers.
