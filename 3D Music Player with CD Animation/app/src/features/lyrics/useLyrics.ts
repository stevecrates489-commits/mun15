import { useCallback, useState } from 'react'
import { useLayoutBox } from '../layout/useLayoutBox'

/* where the lyrics sit. Two positions are meaningful with the CD on the stage
   and one with it hidden — the stage box is the only thing left to fill then */
export type LyricsAlign = 'disc-left' | 'disc-right'
export type LyricsMode = LyricsAlign | 'stage'

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

  const [align, setAlignState] = useState<LyricsAlign>(() =>
    localStorage.getItem('md-lyrics-align') === 'disc-right' ? 'disc-right' : 'disc-left',
  )
  const setAlign = useCallback((a: LyricsAlign) => {
    setAlignState(a)
    localStorage.setItem('md-lyrics-align', a)
  }, [])

  const [size, setSizeState] = useState(() => {
    const n = Number(localStorage.getItem('md-lyrics-size'))
    return (LYRIC_SIZES as readonly number[]).includes(n) ? n : 28
  })
  const setSize = useCallback((v: number) => {
    setSizeState(v)
    localStorage.setItem('md-lyrics-size', String(v))
  }, [])

  /* opacity of the lyrics block — the CD has a brightness slider, and words
     over a bright disc need the same treatment */
  const [brightness, setBrightnessState] = useState(() => {
    const n = Number(localStorage.getItem('md-lyrics-brightness'))
    return Number.isFinite(n) && n >= 20 && n <= 160 ? n : 100
  })
  const setBrightness = useCallback((v: number) => {
    setBrightnessState(v)
    localStorage.setItem('md-lyrics-brightness', String(Math.round(v)))
  }, [])

  /* ---- custom position (unlock layout) ----
     While ON the panel leaves the three fixed positions and lives in its own
     viewport rectangle, moved and resized through the layout editor. TWO
     rectangles are kept, one per CD state (metallic on / white off) — the
     lyrics read best in different places depending on whether the disc is
     there to share the stage. The CD toggle switches between them live; each
     survives reloads and on/off toggles. The legacy single-box key
     (`md-lyrics-box`) is read as the CD-on fallback so nothing is lost. */
  const [custom, setCustomState] = useState(() => localStorage.getItem('md-lyrics-custom') === '1')
  const setCustom = useCallback((on: boolean) => {
    setCustomState(on)
    localStorage.setItem('md-lyrics-custom', on ? '1' : '0')
  }, [])

  const onLayout = useLayoutBox('md-lyrics-box-on', 'md-lyrics-box')
  const offLayout = useLayoutBox('md-lyrics-box-off')

  return {
    enabled,
    toggle,
    align,
    setAlign,
    size,
    setSize,
    brightness,
    setBrightness,
    custom,
    setCustom,
    boxOn: onLayout.box,
    setBoxOn: onLayout.setBox,
    boxOff: offLayout.box,
    setBoxOff: offLayout.setBox,
  }
}

