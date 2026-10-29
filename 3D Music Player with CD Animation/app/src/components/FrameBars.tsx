import { useEffect, useState, useRef } from 'react'
import { readFrameBars, FRAME_BARS_EVENT } from '../lib/frameBars'

/**
 * The black bars at the top and bottom of the window — as CSS elements, on
 * top of whatever the wallpaper is doing.
 *
 * They used to be baked into the wallpaper videos, which meant they were
 * letterboxing: their height was whatever the file was rendered at, they
 * looked different on every screen shape, and no other wallpaper could have
 * them. As elements they can be animated, hidden, and used with any
 * wallpaper at `object-fit: cover`.
 *
 * The pulse: a smoothed bass value drives `scaleY` (never `height` — that is
 * a layout write per frame), with a fast attack and a slow release so the
 * bars breathe with the kick instead of twitching with every sample. The
 * range is deliberately narrow (55%–85% of the bar): a big pulse gets tiring
 * fast, and this is furniture, not a visualiser.
 *
 * `prefers-reduced-motion` parks them at their resting height — the frame
 * stays, the beat does not.
 */

export default function FrameBars({
  getAnalyser,
  playing,
}: {
  getAnalyser: () => AnalyserNode | null
  playing: boolean
}) {
  const [on, setOn] = useState(readFrameBars)
  const bassRef = useRef(0)

  useEffect(() => {
    const sync = () => {
      const next = readFrameBars()
      setOn(next)
      if (!next) document.documentElement.style.removeProperty('--bar')
    }
    window.addEventListener(FRAME_BARS_EVENT, sync)
    return () => window.removeEventListener(FRAME_BARS_EVENT, sync)
  }, [])

  useEffect(() => {
    if (!on) return
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    const freq = new Uint8Array(256)
    let raf = 0

    const tick = () => {
      let target = 0.62 /* resting height when nothing is playing */
      if (!reduced && playing) {
        const an = getAnalyser()
        if (an) {
          an.getByteFrequencyData(freq)
          let bass = 0
          for (let k = 2; k < 14; k++) bass += freq[k]
          target = 0.55 + (bass / (12 * 255)) * 0.3
        }
      }
      /* fast attack, slow release — the release is what makes it read as a
         pulse rather than a jitter */
      const b = bassRef.current
      bassRef.current = b + (target - b) * (target > b ? 0.35 : 0.06)
      document.documentElement.style.setProperty('--bar', bassRef.current.toFixed(3))
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      document.documentElement.style.removeProperty('--bar')
    }
  }, [getAnalyser, playing, on])

  if (!on) return null

  return (
    <>
      <div className="frame-bar frame-bar-top" aria-hidden />
      <div className="frame-bar frame-bar-bottom" aria-hidden />
    </>
  )
}
