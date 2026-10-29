import { memo, useEffect, useState, type RefObject } from 'react'

/* P/Q performance meters — deliberately kept OUT of Home: setFps ticks twice
   a second and a full-page re-render per tick costs 60-100ms of main-thread
   time (measured), which alone capped the UI at ~45fps. Isolated here, each
   tick re-renders only these two spans. */
function PerfMeters({
  wallpaperVideo,
  wallVideoElRef,
}: {
  wallpaperVideo: boolean
  wallVideoElRef: RefObject<HTMLVideoElement | null>
}) {
  const [showFps, setShowFps] = useState(false)
  const [fps, setFps] = useState(0)
  const [showWallFps, setShowWallFps] = useState(false)
  const [wallFps, setWallFps] = useState(0)
  const [diag, setDiag] = useState('')

  /* toggle keys live here so the meters own ALL of their state */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'KeyP') setShowFps((s) => !s)
      if (e.code === 'KeyQ') setShowWallFps((s) => !s)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  /* fps meter (press P) — measured over half-second windows */
  useEffect(() => {
    if (!showFps) return
    let raf = 0
    let last = performance.now()
    let frames = 0
    let acc = 0
    const loop = (now: number) => {
      acc += now - last
      last = now
      frames++
      if (acc >= 500) {
        setFps(Math.round((frames * 1000) / acc))
        /* layout ground truth for the fullscreen sizing bug: the CSS
           viewport (drives vw units), the device pixel ratio (DPI-scale
           mismatches) and the stage's *measured* width (proves whether the
           min(78vw,500px) cap is actually applied right now) */
        const stage = document.querySelector('[data-stage]') as HTMLElement | null
        const sw = stage ? Math.round(stage.getBoundingClientRect().width) : -1
        /* boot state: hold = intro still running, wipe = shutter exit in
           progress (a stuck one would leave the vertical-stripe overlay) */
        const b = document.getElementById('boot')
        const bs = !b ? 'none' : b.classList.contains('gone') ? 'gone' : b.classList.contains('ready') ? 'wipe' : 'hold'
        /* fx tier: 0 = every effect on (incl. case-glass backdrop-filter),
           ≥1 = backdrop-filters suppressed, ≥3 = scanlines/grain/vignette off */
        const fx = document.documentElement.dataset.fx || '0'
        setDiag(`vp ${window.innerWidth}×${window.innerHeight} dpr ${window.devicePixelRatio} stage ${sw} boot:${bs} fx:${fx}`)
        frames = 0
        acc = 0
      }
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [showFps])

  /* wallpaper fps (press Q) — counts the video's actual presented frames
     via requestVideoFrameCallback, fully independent of the UI meter */
  useEffect(() => {
    if (!showWallFps || !wallpaperVideo) {
      setWallFps(0)
      return
    }
    let cancelled = false
    let handle = -1
    let frames = 0
    let winStart = performance.now()
    /* the node we actually attached to — the cleanup must not touch the ref */
    let attached: VFCVideo | null = null
    type VFCVideo = HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: (now: number) => void) => number
      cancelVideoFrameCallback?: (handle: number) => void
    }
    const step = () => {
      if (cancelled) return
      const now = performance.now()
      frames++
      if (now - winStart >= 500) {
        setWallFps(Math.round((frames * 1000) / (now - winStart)))
        frames = 0
        winStart = now
      }
      const v = wallVideoElRef.current as VFCVideo | null
      if (v?.requestVideoFrameCallback) {
        attached = v
        handle = v.requestVideoFrameCallback(step)
      }
    }
    const tryAttach = () => {
      if (cancelled) return
      const v = wallVideoElRef.current as VFCVideo | null
      if (v?.requestVideoFrameCallback) {
        attached = v
        handle = v.requestVideoFrameCallback(step)
      } else window.setTimeout(tryAttach, 250)
    }
    tryAttach()
    return () => {
      cancelled = true
      if (handle >= 0) attached?.cancelVideoFrameCallback?.(handle)
    }
  }, [showWallFps, wallpaperVideo, wallVideoElRef])

  return (
    <>
      {showFps && (
        <span className={fps >= 50 ? 'text-emerald-300' : 'text-amber-300'}>
          UI {fps} FPS{diag && <span className="text-white/60"> · {diag}</span>}
        </span>
      )}
      {showWallFps && wallpaperVideo && (
        <span className={wallFps >= 24 ? 'text-emerald-300' : 'text-amber-300'}>WALL {wallFps} FPS</span>
      )}
    </>
  )
}

export default memo(PerfMeters)
