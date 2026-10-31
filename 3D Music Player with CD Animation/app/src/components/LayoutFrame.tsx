import { useEffect, useRef, useState } from 'react'
import { clampBox, type LayoutBox } from '../features/layout/useLayoutBox'

/**
 * The layout-editor frame: wraps a panel (the lyrics, the tracklist) in a
 * fixed, viewport-anchored rectangle that the user can drag by its body and
 * resize by its eight handles — but ONLY while `editing` is on. When the
 * edit finishes (the floating SAVE LAYOUT button) the chrome disappears and
 * the panel keeps living at its saved rectangle, fully interactive.
 *
 * Pointer events, not a library: the gesture is thirty lines and pulling in
 * react-rnd for them would add a dependency the app doesn't otherwise share
 * vocabulary with. Three rules the implementation cares about:
 *
 *  1. The panel INSIDE stays a normal panel. A drag starts on every
 *     pointerdown but only "takes" past a 4px threshold, so a plain click
 *     reaches the panel's own controls, and wheel still scrolls. While
 *     `editing` the body also carries a global `user-select: none` (see
 *     Home), because a drag that begins over text is a selection otherwise.
 *  2. The box is clamped to the viewport on every gesture, on every render
 *     (a window resized smaller since the last session) and at save time, so
 *     a panel can never be parked off-screen where its handles would be
 *     unreachable.
 *  3. The frame is rendered at the top level of Home, NOT inside a
 *     transformed ancestor: a transform makes the ancestor the containing
 *     block for fixed descendants, and the saved viewport coordinates would
 *     land somewhere else entirely.
 */

/* movement (px) before a press becomes a drag — below it, a click */
const DRAG_THRESHOLD = 4

/* the first box, when nothing has ever been saved and no seed was measured:
   roughly where the standard disc-left lyrics layout reads */
function defaultBox(): LayoutBox {
  const vw = window.innerWidth
  const vh = window.innerHeight
  return clampBox({
    x: Math.round(vw * 0.07),
    y: Math.round(vh * 0.14),
    w: Math.round(vw * 0.46),
    h: Math.round(vh * 0.66),
  })
}

type Dir = 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'e' | 'w'
const HANDLES: { dir: Dir; label: string }[] = [
  { dir: 'nw', label: 'top-left' },
  { dir: 'n', label: 'top' },
  { dir: 'ne', label: 'top-right' },
  { dir: 'e', label: 'right' },
  { dir: 'se', label: 'bottom-right' },
  { dir: 's', label: 'bottom' },
  { dir: 'sw', label: 'bottom-left' },
  { dir: 'w', label: 'left' },
]
/* where each handle sits on the frame (percentages of the box) */
const HANDLE_POS: Record<Dir, { left: string; top: string; cursor: string }> = {
  nw: { left: '0%', top: '0%', cursor: 'nwse-resize' },
  n: { left: '50%', top: '0%', cursor: 'ns-resize' },
  ne: { left: '100%', top: '0%', cursor: 'nesw-resize' },
  e: { left: '100%', top: '50%', cursor: 'ew-resize' },
  se: { left: '100%', top: '100%', cursor: 'nwse-resize' },
  s: { left: '50%', top: '100%', cursor: 'ns-resize' },
  sw: { left: '0%', top: '100%', cursor: 'nesw-resize' },
  w: { left: '0%', top: '50%', cursor: 'ew-resize' },
}

interface Gesture {
  kind: 'move' | 'resize'
  dir?: Dir
  sx: number
  sy: number
  start: LayoutBox
  started: boolean
}

interface Props {
  /* the persisted rectangle — null until the first save */
  box: LayoutBox | null
  /* committed on pointerup, and once on mount when no box existed yet */
  onCommit: (b: LayoutBox) => void
  /* edit mode: dashed boundary, handles and the drag gesture. Off = the
     panel sits at its saved rectangle with no chrome at all */
  editing: boolean
  /* the panel's natural rectangle, measured by the parent the moment edit
     mode was requested (before the panel left its flow position) — used as
     the starting box when nothing was saved yet */
  seed?: LayoutBox | null
  children: React.ReactNode
}

export default function LayoutFrame({ box, onCommit, editing, seed = null, children }: Props) {
  /* `live` holds the in-flight rectangle during a gesture so the frame moves
     with the pointer at full frame rate; outside a gesture the persisted box
     is the truth. The committed box is always CLAMPED for display — if the
     window shrank since it was saved, the panel shows inside it. */
  const [live, setLive] = useState<LayoutBox | null>(null)
  /* mirrored so the pointerup handler can read the last rectangle without
     reaching into a setState updater (updaters must stay pure) */
  const liveRef = useRef<LayoutBox | null>(null)
  const gestureRef = useRef<Gesture | null>(null)
  const commitRef = useRef(onCommit)
  useEffect(() => {
    commitRef.current = onCommit
  }, [onCommit])

  const shown = live ?? clampBox(box ?? defaultBox())

  /* seed the store once, so the very first reload after a save restores the
     same rectangle the user saw (and "saved position" is true from day one).
     A freshly reset panel re-seeds the same way — the parent decides what
     the seed is by passing the measured rectangle (or nothing, for lyrics). */
  useEffect(() => {
    if (box) return
    commitRef.current(clampBox(seed ?? defaultBox()))
  }, [box, seed])

  /* one pair of window listeners for the whole life of the frame. Gestures
     are tracked through the ref — the listeners are attached before any
     pointerdown can happen and never need re-binding, and window-level moves
     mean no pointer capture, which would retarget (and kill) the click the
     gesture might have started over. */
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const g = gestureRef.current
      if (!g) return
      const dx = e.clientX - g.sx
      const dy = e.clientY - g.sy
      if (g.kind === 'move') {
        if (!g.started) {
          if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return
          g.started = true
        }
        const next = clampBox({ ...g.start, x: g.start.x + dx, y: g.start.y + dy })
        liveRef.current = next
        setLive(next)
        return
      }
      /* resize — n/w pull the top/left edge (which moves the origin), the
         rest push the far edge; the clamp keeps it on-screen and above the
         minimum, even when an edge is dragged past itself */
      const dir = g.dir ?? 'se'
      let { x, y, w, h } = g.start
      if (dir.includes('e')) w = g.start.w + dx
      if (dir.includes('s')) h = g.start.h + dy
      if (dir.includes('w')) {
        w = g.start.w - dx
        x = g.start.x + dx
      }
      if (dir.includes('n')) {
        h = g.start.h - dy
        y = g.start.y + dy
      }
      const next = clampBox({ x, y, w, h })
      liveRef.current = next
      setLive(next)
    }
    const onUp = () => {
      const g = gestureRef.current
      gestureRef.current = null
      if (!g) return
      /* commit whatever is on screen right now — a move under the threshold
         never produced a `live`, so the stored box is untouched */
      const current = liveRef.current
      liveRef.current = null
      setLive(null)
      if (current) commitRef.current(current)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [])

  const onFrameDown = (e: React.PointerEvent) => {
    if (!editing || e.button !== 0) return
    /* no text selection out of a drag — see rule 1 in the header note */
    e.preventDefault()
    gestureRef.current = { kind: 'move', sx: e.clientX, sy: e.clientY, start: shown, started: false }
  }

  const onHandleDown = (dir: Dir) => (e: React.PointerEvent) => {
    if (!editing || e.button !== 0) return
    e.preventDefault() /* resize wins over selection and over the move gesture */
    e.stopPropagation()
    gestureRef.current = { kind: 'resize', dir, sx: e.clientX, sy: e.clientY, start: shown, started: true }
  }

  return (
    <div
      className={`fixed z-[60] ${editing ? 'cursor-move' : ''}`}
      style={{ left: shown.x, top: shown.y, width: shown.w, height: shown.h }}
      onPointerDown={onFrameDown}
    >
      {/* the editing chrome: a quiet dashed boundary with the resize dots —
          visible ONLY in edit mode, gone the moment the layout is saved */}
      {editing && <div className="pointer-events-none absolute -inset-px rounded-lg border border-dashed border-white/25" />}
      {editing &&
        HANDLES.map(({ dir, label }) => (
          <div
            key={dir}
            role="separator"
            aria-label={`Resize ${label}`}
            onPointerDown={onHandleDown(dir)}
            className="absolute z-10 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/60 bg-black/50 transition hover:scale-125 hover:bg-white/80"
            style={{
              left: HANDLE_POS[dir].left,
              top: HANDLE_POS[dir].top,
              cursor: HANDLE_POS[dir].cursor,
              /* corner and edge dots, kept clear of the content they resize */
              touchAction: 'none',
            }}
          />
        ))}
      {/* the panel itself fills whatever rectangle was saved; the pointerdown
          that starts a move also reaches it, but under the threshold it stays
          a click — see rule 1 in the header note. `flex flex-col` lets a
          flex-1 panel (the tracklist) fill the frame like it filled the deck. */}
      <div className="flex h-full w-full flex-col">{children}</div>
    </div>
  )
}
