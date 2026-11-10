import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Drag support for the layout editor, shared by every floating surface that
 * is not a resizable stage panel (buttons, button groups, settings popovers).
 *
 * The saved value is an OFFSET, not a rectangle: buttons live in flex groups
 * and panels are anchored by their own CSS, so the honest unit is "how far
 * has the user moved this from where it belongs". The offset is applied with
 * the CSS `translate` property, which composes with — and never overwrites —
 * an element's own `transform` (centering utilities, panel entrance
 * animations, hover scales).
 *
 * Movement is deliberately UNBOUNDED: a surface may be placed anywhere,
 * including past the window edge. Nothing here clamps, snaps or nudges it
 * back. RESET SCREEN in the Customize hub is the way back.
 *
 * Gestures follow LayoutFrame's three rules: a 4px threshold so a click stays
 * a click, window-level listeners so no pointer capture retargets anything,
 * and a capture-phase click swallow after a real drag so dropping a button
 * does not also press it.
 */

export interface ChromeOffset {
  dx: number
  dy: number
}

export const ZERO_OFFSET: ChromeOffset = { dx: 0, dy: 0 }

const DRAG_THRESHOLD = 4

interface ChromeDragProps {
  /** edit session on — gestures only exist while this is true */
  editing?: boolean
  /** the committed offset for this surface */
  offset?: ChromeOffset
  onOffset?: (o: ChromeOffset) => void
}

export function useChromeDrag({ editing = false, offset, onOffset }: ChromeDragProps) {
  /* in-flight offset, so the surface follows the pointer at full rate */
  const [live, setLive] = useState<ChromeOffset | null>(null)
  const liveRef = useRef<ChromeOffset | null>(null)
  const gestureRef = useRef<{
    sx: number
    sy: number
    start: ChromeOffset
    started: boolean
  } | null>(null)
  /* true between "the pointer moved past the threshold" and the click that
     follows pointerup — that click is swallowed, not forwarded */
  const movedRef = useRef(false)
  const clickResetRef = useRef<number | undefined>(undefined)

  const offsetRef = useRef(offset)
  const commitRef = useRef(onOffset)
  /* synced in effects, never written during render */
  useEffect(() => {
    offsetRef.current = offset
  }, [offset])
  useEffect(() => {
    commitRef.current = onOffset
  }, [onOffset])

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const g = gestureRef.current
      if (!g) return
      const dx = e.clientX - g.sx
      const dy = e.clientY - g.sy
      if (!g.started) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return
        g.started = true
        movedRef.current = true
        window.clearTimeout(clickResetRef.current)
      }
      const next = { dx: g.start.dx + dx, dy: g.start.dy + dy }
      liveRef.current = next
      setLive(next)
    }
    const onUp = () => {
      const g = gestureRef.current
      gestureRef.current = null
      if (!g) return
      const current = liveRef.current
      liveRef.current = null
      setLive(null)
      if (g.started && current) commitRef.current?.(current)
      /* The click that follows pointerup is dispatched before the next task,
         but it may not land on this surface at all (drag a panel and release
         over the page). Without this timer the flag would stay true and eat
         the NEXT honest click on the surface. */
      window.clearTimeout(clickResetRef.current)
      clickResetRef.current = window.setTimeout(() => {
        movedRef.current = false
      }, 0)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
      window.clearTimeout(clickResetRef.current)
    }
  }, [])

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (!editing || e.button !== 0) return
      /* the native resize grip (bottom-right corner, from .panel-resizable)
         must stay LIVE while an edit session runs: swallowing this press —
         stopPropagation + preventDefault — is what killed the browser's own
         resize gesture on every settings panel in edit mode. Let it pass. */
      const r = e.currentTarget.getBoundingClientRect()
      if (r.width > 0 && r.height > 0 && e.clientX > r.right - 22 && e.clientY > r.bottom - 22) return
      /* Attached in the CAPTURE phase by every consumer: while arranging, a
         press belongs to the surface, not to whatever control it landed on.
         This is what stops a hold-to-open radio button from opening during a
         drag. Clicks are a separate event, so buttons still press normally. */
      e.stopPropagation()
      /* no text selection and no focus churn out of an arranging gesture */
      e.preventDefault()
      movedRef.current = false
      window.clearTimeout(clickResetRef.current)
      gestureRef.current = {
        sx: e.clientX,
        sy: e.clientY,
        start: offsetRef.current ?? ZERO_OFFSET,
        started: false,
      }
    },
    [editing],
  )

  const onClickCapture = useCallback((e: React.MouseEvent) => {
    if (!movedRef.current) return
    movedRef.current = false
    e.preventDefault()
    e.stopPropagation()
  }, [])

  const shown = live ?? offset ?? ZERO_OFFSET

  return {
    onPointerDown,
    onClickCapture,
    /** merged into the surface's own style — `translate` never clobbers `transform` */
    style:
      shown.dx === 0 && shown.dy === 0
        ? ({} as React.CSSProperties)
        : ({ translate: `${shown.dx}px ${shown.dy}px` } as React.CSSProperties),
    /** the arranging affordance, only while an edit session runs */
    editClass: editing ? 'cursor-move outline-dashed outline-1 outline-white/30 [touch-action:none]' : '',
    dragging: !!live,
  }
}
