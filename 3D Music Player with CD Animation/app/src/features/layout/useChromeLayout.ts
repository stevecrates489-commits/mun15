import { useCallback, useEffect, useState } from 'react'
import type { ChromeOffset } from './useChromeDrag'

/**
 * The saved offsets of every floating surface that is NOT a resizable stage
 * panel: the corner and corner-group buttons, and every settings popover.
 *
 * One key, not one key per surface: these are arranged together and reset
 * together, and a single record can never leave half a screen moved. Stage
 * panels keep their own rectangle keys (md-tracklist-box, md-music-box, the
 * lyrics' per-CD-state boxes) — those are rectangles, these are offsets.
 */

const KEY = 'md-chrome-offsets'

function read(): Record<string, ChromeOffset> {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const out: Record<string, ChromeOffset> = {}
    for (const [id, value] of Object.entries(parsed)) {
      if (!value || typeof value !== 'object') continue
      const dx = (value as { dx?: unknown }).dx
      const dy = (value as { dy?: unknown }).dy
      if (typeof dx === 'number' && Number.isFinite(dx) && typeof dy === 'number' && Number.isFinite(dy)) {
        out[id] = { dx, dy }
      }
    }
    return out
  } catch {
    /* private mode or a hand-edited record — every surface starts where it belongs */
    return {}
  }
}

export function useChromeLayout() {
  const [offsets, setOffsets] = useState<Record<string, ChromeOffset>>(read)

  /* persistence is an effect, not a side effect inside a state updater:
     updaters must stay pure (StrictMode and concurrent renders can replay
     them), and one write per committed record is all this needs */
  useEffect(() => {
    try {
      if (Object.keys(offsets).length === 0) localStorage.removeItem(KEY)
      else localStorage.setItem(KEY, JSON.stringify(offsets))
    } catch {
      /* private mode — the arrangement lasts for this session */
    }
  }, [offsets])

  const setOffset = useCallback((id: string, o: ChromeOffset) => {
    setOffsets((prev) => {
      const next = { ...prev }
      const dx = Math.round(o.dx)
      const dy = Math.round(o.dy)
      if (dx === 0 && dy === 0) delete next[id]
      else next[id] = { dx, dy }
      return next
    })
  }, [])

  const reset = useCallback(() => setOffsets({}), [])

  /* Viewport changes (resize, fullscreen) resize the anchors these offsets
     are relative to. Scaling them by the same factor keeps a surface the same
     distance from its corner, so a phone-sized window can never inherit a 4K
     drag. Mirrors the stage panels' rectangle remap in Home. */
  const scale = useCallback((sx: number, sy: number) => {
    if (!Number.isFinite(sx) || !Number.isFinite(sy) || sx <= 0 || sy <= 0) return
    if (sx === 1 && sy === 1) return
    setOffsets((prev) => {
      const next: Record<string, ChromeOffset> = {}
      for (const [id, o] of Object.entries(prev)) {
        const dx = Math.round(o.dx * sx)
        const dy = Math.round(o.dy * sy)
        if (dx !== 0 || dy !== 0) next[id] = { dx, dy }
      }
      return next
    })
  }, [])

  return { offsets, setOffset, reset, scale }
}
