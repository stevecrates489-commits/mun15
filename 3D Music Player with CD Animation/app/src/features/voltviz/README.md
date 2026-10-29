# VoltViz visuals

VoltViz's visualizer collection — https://github.com/sanderdw/voltviz — vendored
into the player so its styles can be used as live backdrops. MIT licensed; the
licence text is `LICENSE` beside this file.

## What was copied

| Here | There |
|---|---|
| `impl/` | `src/visualizers/impl/` — the 54 styles |
| `lib/` | `src/visualizers/lib/` — canvas 2D, three, WebGPU helpers |
| `registry.ts` | `src/visualizers/registry.ts` — the list the picker reads |
| `modules.ts` | `src/visualizers/modules.ts` — lazy `import.meta.glob` loader |
| `runtime-types.ts` | `src/visualizers/runtime/types.ts` — the factory/frame contract |
| `audio-types.ts`, `settings.ts` | `src/audio/types.ts`, `src/types.ts` — types only |
| `dummycover.jpg`, `Netherlands_gemeentes.json` | the images/data two styles load |

## What was changed

- Imports of `three` now point at `three186` — a second three.js install
  (`npm i three186@npm:three@0.186.1`) so the visuals get the version they were
  written for while the player's own disc keeps three 0.128.
- Import paths follow this folder's layout; `@sendspin/sendspin-js` (a transport
  the player does not have) is answered by `sendspin-types.ts`, and VoltViz's
  engine internals by `core-stubs.ts`.
- Every vendored file carries `// @ts-nocheck`: it is third-party code, kept
  byte-for-byte where possible, and type-checking it here would only invite
  edits that the next VoltViz version would undo.

## How it is driven

`audio.ts` builds the `AudioFrame` the styles expect from the deck's own
`AnalyserNode` (spectrum, waveform, bands, level, and a light beat/onset
tracker). `VoltVizBackdrop.tsx` mounts the chosen style behind the player;
`useVoltViz.ts` remembers the choice. The picker lives in the visualiser panel,
beside MilkDrop's settings.
