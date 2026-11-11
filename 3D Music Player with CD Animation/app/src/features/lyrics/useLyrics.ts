import { useCallback, useState } from 'react'
import { useLayoutBox } from '../layout/useLayoutBox'

/* Where the lyrics sit.
   The disc is gone, so the two disc-relative positions ('disc-left' and
   'disc-right') died with it: there is nothing beside the disc to sit beside.
   What is left is the STAGE — the lyrics own the box the disc used to share,
   and they are centred in it.

   The saved RECTANGLE is the other half: the lyrics are movable, and they keep
   one viewport rectangle of their own, edited in the layout editor.

   The rectangle's storage key is 'md-lyrics-rect'. The older keys are read as
   fallbacks, in the order they were most likely written:
     'md-lyrics-box-on'  — the rectangle the CD-ON state used
     'md-lyrics-box-off' — the rectangle the CD-OFF state used
     'md-lyrics-box'     — the single rectangle from before the CD split
   Whichever is found first is adopted, and the next save writes the new key. */

export const LYRIC_SIZES = [20, 28, 36] as const
export const SIZE_LABELS = ['SMALL', 'MEDIUM', 'LARGE']

/* lyrics panel visibility — a viewing preference, persisted like the other
   player toggles. Off by default: an enabled panel fetches from lrc.red and
   friends on every track, which costs a network round-trip per song. */
export function useLyrics() {
  const [enabled, setEnabled] = useState(() => localStorage.getItem('md-lyrics') === '1')

  const toggle = useCallback(() => {
    setEnabled((on) => {
      localStorage.setItem('md-lyrics', on ? '0' : '1')
      return !on
    })
  }, [])

  const [size, setSizeState] = useState(() => {
    const n = Number(localStorage.getItem('md-lyrics-size'))
    return (LYRIC_SIZES as readonly number[]).includes(n) ? n : 28
  })
  const setSize = useCallback((v: number) => {
    setSizeState(v)
    localStorage.setItem('md-lyrics-size', String(v))
  }, [])

  /* opacity of the lyrics block — the CD had a brightness slider, and words
     over a bright picture need the same treatment */
  const [brightness, setBrightnessState] = useState(() => {
    const n = Number(localStorage.getItem('md-lyrics-brightness'))
    return Number.isFinite(n) && n >= 20 && n <= 160 ? n : 100
  })
  const setBrightness = useCallback((v: number) => {
    setBrightnessState(v)
    localStorage.setItem('md-lyrics-brightness', String(Math.round(v)))
  }, [])

  /* ---- custom position (unlock layout) ----
     While ON the panel leaves the stage box and lives in its own viewport
     rectangle, moved and resized through the layout editor. The rectangle
     survives reloads. */
  const [custom, setCustomState] = useState(() => localStorage.getItem('md-lyrics-custom') === '1')
  const setCustom = useCallback((on: boolean) => {
    setCustomState(on)
    localStorage.setItem('md-lyrics-custom', on ? '1' : '0')
  }, [])

  const layout = useLayoutBox('md-lyrics-rect', 'md-lyrics-box-on', 'md-lyrics-box-off', 'md-lyrics-box')

  return {
    enabled,
    toggle,
    size,
    setSize,
    brightness,
    setBrightness,
    custom,
    setCustom,
    box: layout.box,
    setBox: layout.setBox,
  }
}
