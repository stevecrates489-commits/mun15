/**
 * `three186` is three.js 0.186 installed as an alias package
 * (`npm i three186@npm:three@0.186.1` — see features/voltviz/README.md), which
 * ships no type declarations of its own. The visualizers use it through the
 * API surface that is stable across both majors, so the app's @types/three
 * covers it.
 */
declare module 'three186' {
  export * from 'three';
}
