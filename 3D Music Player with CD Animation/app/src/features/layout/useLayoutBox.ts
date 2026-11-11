import { useCallback, useState } from 'react'

/* a saved layout rectangle in viewport pixels — the unit the layout editor
   (LayoutFrame) drags and resizes. Lyrics and tracklist each keep their own. */
export interface LayoutBox {
  x: number
  y: number
  w: number
  h: number
}

/* under this a panel stops being a panel — enough for ~3 lyric lines or a
   couple of tracklist rows */
export const MIN_W = 160
export const MIN_H = 120

/* keep a box inside the current viewport, with a floor on its size. Every
   consumer renders through this, so a box saved on a bigger window can never
   park a panel (or its handles) off-screen after the window shrinks. */
export function clampBox(b: LayoutBox): LayoutBox {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const w = Math.min(Math.max(b.w, MIN_W), vw)
  const h = Math.min(Math.max(b.h, MIN_H), vh)
  return {
    w,
    h,
    x: Math.min(Math.max(b.x, 0), vw - w),
    y: Math.min(Math.max(b.y, 0), vh - h),
  }
}

/* the loose clamp for UNBOUNDED panels (the carousel): no arbitrary min/max
   on the SIZE — the user may scale it as small or as large as they like. A
   small floor keeps the frame's own handles grabbable; the position stays
   viewport-clamped so the pane can still be found. */
export function clampLoose(b: LayoutBox): LayoutBox {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const w = Math.max(b.w, 40)
  const h = Math.max(b.h, 40)
  return {
    w,
    h,
    x: Math.min(Math.max(b.x, 0), Math.max(0, vw - w)),
    y: Math.min(Math.max(b.y, 0), Math.max(0, vh - h)),
  }
}

function readBox(key: string): LayoutBox | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const p = JSON.parse(raw) as Partial<LayoutBox>
    /* a truncated or hand-edited record reads as "no box" */
    if (
      typeof p.x === 'number' && Number.isFinite(p.x) &&
      typeof p.y === 'number' && Number.isFinite(p.y) &&
      typeof p.w === 'number' && Number.isFinite(p.w) && p.w > 0 &&
      typeof p.h === 'number' && Number.isFinite(p.h) && p.h > 0
    ) {
      return { x: p.x, y: p.y, w: p.w, h: p.h }
    }
  } catch {
    /* malformed JSON — same fallback */
  }
  return null
}

/* one persisted layout rectangle. `legacyKeys` migrate older records (the
   lyrics' pre-CD-split position, and the two rectangles the CD split it into)
   without a formal schema bump: read once, rewritten under the new key on the
   next save. The first legacy key that holds a record wins. */
export function useLayoutBox(key: string, ...legacyKeys: string[]) {
  const [box, setBoxState] = useState<LayoutBox | null>(() => {
    const direct = readBox(key)
    if (direct) return direct
    for (const legacyKey of legacyKeys) {
      const legacy = readBox(legacyKey)
      if (legacy) return legacy
    }
    return null
  })

  const setBox = useCallback((b: LayoutBox | null) => {
    setBoxState(b)
    try {
      if (b === null) localStorage.removeItem(key)
      else localStorage.setItem(key, JSON.stringify(b))
    } catch {
      /* private mode or a full quota — the box still applies for this session */
    }
  }, [key])

  return { box, setBox }
}
