/**
 * Adaptive quality: watch the real frame rate, and when it stays low, lower
 * the pixel-ratio cap that every canvas in the app draws at.
 *
 * The wallpaper already has its own governor (the `data-fx` tiers in
 * `wallpaperPipeline`), which deals with the cost of decoding video. This is
 * the other half: the cost of PAINTING all those pixels. A 4K display at
 * devicePixelRatio 2 paints four times the pixels of 1080p for a picture the
 * same size, and on a machine that cannot keep up the honest thing to do is
 * to stop paying for pixels nobody can see.
 *
 * Rules:
 *  - below ~50fps for two continuous seconds → cap drops to 1.25
 *  - below ~50fps for six seconds → cap drops to 1
 *  - back above ~58fps for ten seconds → the cap is handed back
 *  - the cap only ever changes the RESOLUTION of a canvas; nothing is
 *    disabled, hidden or removed, and it never touches the wallpaper tiers
 *
 * When the cap moves, a `resize` is dispatched so every canvas re-measures —
 * canvases size themselves once, on resize, and would otherwise keep drawing
 * at the old ratio until the window happened to change.
 */

let cap = 2
let lowSince: number | null = null
let goodSince: number | null = null
let running = false

/** The pixel ratio canvases may draw at right now. */
export function dprCap(): number {
  return cap
}

/** The DPR a canvas should actually use: the display's, and this cap. */
export function dpr(): number {
  return Math.min(window.devicePixelRatio || 1, cap)
}

function setCap(next: number) {
  if (next === cap) return
  cap = next
  window.dispatchEvent(new Event('resize'))
}

export function startAdaptiveQuality(): void {
  if (running) return
  running = true

  let last = performance.now()
  let frames = 0

  const tick = (now: number) => {
    frames++
    const span = now - last
    if (span >= 1000) {
      const fps = (frames * 1000) / span
      frames = 0
      last = now

      if (fps < 50) {
        goodSince = null
        if (lowSince == null) lowSince = now
        if (now - lowSince > 6000) setCap(1)
        else if (now - lowSince > 2000 && cap > 1.25) setCap(1.25)
      } else if (fps > 58) {
        lowSince = null
        if (goodSince == null) goodSince = now
        if (now - goodSince > 10000 && cap < 2) setCap(2)
      } else {
        /* between 50 and 58: the machine is coping — hold the current cap
           rather than oscillating */
        lowSince = null
        goodSince = null
      }
    }
    window.requestAnimationFrame(tick)
  }
  window.requestAnimationFrame(tick)
}
