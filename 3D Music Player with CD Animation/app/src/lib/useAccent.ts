/**
 * The accent the UI wears, driven by the playing track's art.
 *
 * The values live in CSS custom properties on the document root, so every
 * consumer (the seekbar, the active row, the progress line) reads one source
 * and transitions happen without any of them knowing about the art. When the
 * track changes, the new pair is CROSSFADED: the variables are animated from
 * their current values to the target over ~800ms, so no surface snaps.
 *
 * Disabled, or a cover that cannot be read (no art, tainted canvas), eases
 * back to the deck's own defaults — the pair in `ACCENT_DEFAULTS`.
 */
import { useEffect, useRef } from 'react'
import { ACCENT_DEFAULTS, extractAccents, type AccentPair } from './accent'

const FADE_MS = 800

function writeVars(a: [number, number, number], b: [number, number, number]) {
  const root = document.documentElement.style
  root.setProperty('--accent-a', `rgb(${a[0]},${a[1]},${a[2]})`)
  root.setProperty('--accent-b', `rgb(${b[0]},${b[1]},${b[2]})`)
  root.setProperty('--accent-glow', `rgba(${a[0]},${a[1]},${a[2]},0.8)`)
  root.setProperty('--accent-row', `rgba(${a[0]},${a[1]},${a[2]},0.14)`)
}

export function useAccentFromArt(cover: string | null, enabled: boolean) {
  const curRef = useRef<AccentPair>({ a: [...ACCENT_DEFAULTS.a], b: [...ACCENT_DEFAULTS.b] })
  const rafRef = useRef(0)
  /* which extraction the UI is currently wearing. Decoding is async and two
     covers can be in flight at once (a fast skip through a queue); without
     this token a slow decode of the PREVIOUS cover could land after the new
     one and repaint the interface in the old track's colours. */
  const reqRef = useRef(0)

  const animateTo = (target: AccentPair) => {
    cancelAnimationFrame(rafRef.current)
    const from = {
      a: [...curRef.current.a] as [number, number, number],
      b: [...curRef.current.b] as [number, number, number],
    }
    const t0 = performance.now()
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / FADE_MS)
      const e = k * k * (3 - 2 * k)
      const a = from.a.map((v, i) => Math.round(v + (target.a[i] - v) * e)) as [number, number, number]
      const b = from.b.map((v, i) => Math.round(v + (target.b[i] - v) * e)) as [number, number, number]
      curRef.current = { a, b }
      writeVars(a, b)
      if (k < 1) rafRef.current = requestAnimationFrame(step)
    }
    rafRef.current = requestAnimationFrame(step)
  }

  /* Re-runs on EVERY track change: `cover` is the playing track's art, so a
     new track means a new source, a fresh extraction and a crossfade into
     the new pair — no reload, no remount. */
  useEffect(() => {
    let alive = true
    const req = ++reqRef.current
    if (!enabled || !cover) {
      animateTo(ACCENT_DEFAULTS)
      return
    }
    void extractAccents(cover).then((res) => {
      if (alive && req === reqRef.current) animateTo(res ?? ACCENT_DEFAULTS)
    })
    return () => {
      alive = false
    }
  }, [cover, enabled])

  useEffect(() => () => cancelAnimationFrame(rafRef.current), [])
}
