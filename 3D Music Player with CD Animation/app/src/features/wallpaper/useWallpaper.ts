import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  importWallpaper, WallpaperPlayer, store as wallStore,
  MAX_SECONDS as WALL_MAX_SECONDS, FPS_MIN, FPS_MAX, explain,
  requestPersistentStorage, type WallPreset, type WallpaperRecord,
} from '../../lib/wallpaperPipeline'
import { bootReset } from '../../lib/bootReset'
import { signalBootReady } from '../../lib/bootGate'
import {
  DEFAULT_WALL_COLOR,
  isHsv,
  parsePaint,
  paintCss,
  paintLabel,
  type Hsv,
  type Paint,
} from '../../lib/color'
import { readSavedTheme, type Theme } from '../../lib/theme'

export type { Theme }

/* The moving gradient theme — three drifting colour fields over a near-black
   base, so the backdrop reads as a nebula instead of one flat diagonal band.
   A single element can only carry one background stack, so the depth comes
   from two layers: this bloom underneath and the brighter band on top, each
   on its own drift cycle and its own direction. */
export const AURORA_BG =
  'radial-gradient(ellipse 110% 70% at 18% 28%, rgba(103,45,214,0.55), transparent 62%),' +
  'radial-gradient(ellipse 95% 65% at 82% 22%, rgba(14,165,233,0.45), transparent 60%),' +
  'radial-gradient(ellipse 120% 80% at 55% 105%, rgba(236,72,153,0.34), transparent 66%),' +
  'linear-gradient(175deg, #05060e 0%, #080a18 48%, #03040a 100%)'
/* the brighter sweep that rides on top of the bloom */
export const AURORA_BAND_BG =
  'linear-gradient(112deg, transparent 8%, rgba(56,189,248,0.20) 26%, rgba(168,85,247,0.26) 48%, rgba(236,72,153,0.18) 68%, transparent 90%)'
/* The theme registry.
   It used to carry a second entry — 'aurora', labelled "Theme: moving
   gradient" — whose swatch was the live gradient circle in the header's
   theme cluster. That swatch is GONE: the moving-gradient theme is no
   longer pickable from the header.

   What survives is the theme itself. 'aurora' is still a valid Theme, the
   full-page bloom backdrop still renders for it, and a profile that already
   saved it (or an old 'gradient' name, which lib/theme.ts migrates to
   'aurora') keeps its backdrop. Only the button that selected it was
   removed — the wallpaper behind the player must not change under someone
   who already chose it.

   'black' stays here as the boot fallback. It has no swatch button on
   purpose: the colour picker in the header paints the wall, so a flat
   black button would only ever be the lesser of the two. */
export const THEMES: { id: Theme; label: string; swatch: React.CSSProperties }[] = [
  { id: 'black', label: 'Theme: black', swatch: { background: '#000' } },
]

export function useWallpaper({ setImportHint }: { setImportHint: (v: string | null) => void }) {
  /* theme — persisted so your pick survives reloads */
  const [theme, setThemeState] = useState<Theme>(
    () => readSavedTheme(localStorage.getItem('md-theme')) ?? 'black',
  )
  const setTheme = useCallback((t: Theme) => {
    setThemeState(t)
    localStorage.setItem('md-theme', t)
  }, [])

  /* the wallpaper paint — a flat colour OR a two-stop gradient. One value
     covers both, so the picker, the header swatch and the layer can never
     disagree about what is on screen, and switching modes CONVERTS the
     current choice instead of resetting it. */
  const [wallPaint, setWallPaintState] = useState<Paint>(() => {
    const stored = parsePaint(localStorage.getItem('md-wall-paint'))
    if (stored) return stored
    /* the old solid-only entry — migrate it so an existing choice survives */
    try {
      const legacy = localStorage.getItem('md-wall-color')
      if (legacy) {
        const c = JSON.parse(legacy) as Hsv
        if (isHsv(c)) return { kind: 'solid', color: c }
      }
    } catch {
      /* corrupt entry — fall through to the default */
    }
    return { kind: 'solid', color: DEFAULT_WALL_COLOR }
  })
  /* true once a paint has ever been chosen — the header swatch uses it to
     re-apply the SAVED paint instead of making the user pick it again */
  const [hasWallPaint, setHasWallPaint] = useState(
    () =>
      localStorage.getItem('md-wall-paint') != null ||
      localStorage.getItem('md-wall-color') != null,
  )
  /* picking a paint IS selecting the colour theme — the two can never
     disagree, so the swatch and the layer stay in step. Every edit is written
     through immediately, which is why the picker reopens on the last paint
     (across reloads too) and nothing has to be re-chosen. */
  const setWallPaint = useCallback((p: Paint) => {
    setWallPaintState(p)
    try {
      localStorage.setItem('md-wall-paint', JSON.stringify(p))
    } catch {
      /* private mode / quota — the paint still applies for this session */
    }
    setHasWallPaint(true)
    setThemeState('color')
    localStorage.setItem('md-theme', 'color')
  }, [])
  /* the swatch's click: show the colour theme WITHOUT touching the saved
     value — opening the picker must never count as "choosing a colour" */
  const applyWallPaint = useCallback(() => {
    setThemeState('color')
    localStorage.setItem('md-theme', 'color')
  }, [])
  /* the layer's CSS and the swatch's readout — memoised so a drag in the
     picker rewrites two strings instead of re-deriving them every render */
  const wallPaintCss = useMemo(() => paintCss(wallPaint), [wallPaint])
  const wallPaintLabel = useMemo(() => paintLabel(wallPaint), [wallPaint])

  /* custom wallpaper behind everything — image, or video via the
     mediabunny/WebCodecs pipeline (probe → plan → convert → store → play) */
  const [wallpaper, setWallpaper] = useState<{
    type: 'image' | 'video'
    blob?: Blob
    poster?: Blob | null
  } | null>(null)
  const [wallImageUrl, setWallImageUrl] = useState<string | null>(null)
  const [wallBusy, setWallBusy] = useState<number | null>(null)
  const [wallStage, setWallStage] = useState<string | null>(null)
  const [wallNote, setWallNote] = useState<string | null>(null)
  const wallInputRef = useRef<HTMLInputElement>(null)
  const wallVideoRef = useCallback((v: HTMLVideoElement | null) => {
    wallVideoElRef.current = v
  }, [])
  const wallVideoElRef = useRef<HTMLVideoElement | null>(null)
  const playerRef = useRef<WallpaperPlayer | null>(null)
  const [wallOriginal, setWallOriginal] = useState<File | null>(null)
  const [pendingWallFile, setPendingWallFile] = useState<File | null>(null)
  const [wallSettingsOpen, setWallSettingsOpen] = useState(false)
  /* settings panel exit: the panel stays mounted ~160ms while the close
     animation plays, then unmounts via onWallSettingsClosed */
  const [wallSettingsClosing, setWallSettingsClosing] = useState(false)
  const closeWallSettings = useCallback(() => setWallSettingsClosing(true), [])
  const onWallSettingsClosed = useCallback(() => {
    setWallSettingsOpen(false)
    setWallSettingsClosing(false)
  }, [])
  const toggleWallSettings = useCallback(() => {
    if (wallSettingsOpen) {
      setWallSettingsClosing(true)
      return
    }
    setWallSettingsClosing(false)
    setWallSettingsOpen(true)
  }, [wallSettingsOpen])
  const [wallQuality, setWallQualityState] = useState<WallPreset>(() => {
    const s = localStorage.getItem('md-wall-quality')
    return s === 'high' || s === 'balanced' || s === 'performance' || s === 'original' ? s : 'balanced'
  })
  const [wallFpsTarget, setWallFpsTargetState] = useState<number | null>(() => {
    const n = Number(localStorage.getItem('md-wall-fps'))
    return Number.isFinite(n) && n >= FPS_MIN && n <= FPS_MAX ? n : null
  })
  const [wallStart, setWallStartState] = useState(() => {
    const n = Number(localStorage.getItem('md-wall-start'))
    return Number.isFinite(n) && n >= 0 && n <= WALL_MAX_SECONDS - 1 ? n : 0
  })
  const [wallSpeed, setWallSpeedState] = useState(() => (localStorage.getItem('md-wall-speed') === '0.75' ? 0.75 : 1))
  const [wallBlur, setWallBlur] = useState(() => localStorage.getItem('md-wall-blur') === '1')
  const [wallDim, setWallDim] = useState(() => {
    const n = Number(localStorage.getItem('md-wall-dim'))
    return Number.isFinite(n) && n >= 0 && n <= 80 ? n : 60
  })
  const [wallPauseHidden, setWallPauseHidden] = useState(() => localStorage.getItem('md-wall-pausehidden') !== '0')
  const [savedWallpapers, setSavedWallpapers] = useState<WallpaperRecord[]>([])
  const setWallFpsTarget = (n: number | null) => { setWallFpsTargetState(n); localStorage.setItem('md-wall-fps', n == null ? '' : String(n)) }
  const setWallStart = (n: number) => { setWallStartState(n); localStorage.setItem('md-wall-start', String(n)) }
  const setWallSpeed = (s: number) => { setWallSpeedState(s); localStorage.setItem('md-wall-speed', String(s)) }
  const setWallBlurOn = (v: boolean) => { setWallBlur(v); localStorage.setItem('md-wall-blur', v ? '1' : '0') }
  const setWallDimV = (v: number) => { setWallDim(v); localStorage.setItem('md-wall-dim', String(v)) }
  const setWallPauseHiddenV = (v: boolean) => { setWallPauseHidden(v); localStorage.setItem('md-wall-pausehidden', v ? '1' : '0') }
  const wallQualityRef = useRef(wallQuality)
  wallQualityRef.current = wallQuality
  const wallFpsTargetRef = useRef<number | null>(wallFpsTarget)
  wallFpsTargetRef.current = wallFpsTarget
  const wallStartRef = useRef(wallStart)
  wallStartRef.current = wallStart

  /* wallpaper player — owns the <video>, fps counting, governor.
     created lazily on first need: the element is always mounted, so this
     works no matter which theme was active at boot */
  const ensurePlayer = useCallback(() => {
    if (playerRef.current) return playerRef.current
    const v = wallVideoElRef.current
    if (!v) return null
    const p = new WallpaperPlayer(v)
    playerRef.current = p
    void requestPersistentStorage()
    return p
  }, [])

  /* construct on mount so the frame-time governor watches every theme —
     previously the player only existed for video wallpapers, so gradient /
     aurora / black themes had no jank protection at all */
  useEffect(() => {
    ensurePlayer()
  }, [ensurePlayer])

  /* push newly applied / restored wallpaper videos into the player */
  const lastSetBlobRef = useRef<Blob | null>(null)
  /* id of the record the live wallpaper came from — lets a vault-row delete
     detect "you are deleting the wallpaper that is playing right now" and
     stop it instead of just removing the IndexedDB entry */
  const activeIdRef = useRef<string | null>(null)
  useEffect(() => {
    if (!wallpaper) return
    if (wallpaper.type === 'image') {
      /* an image needs no player — just make sure the video isn't running */
      wallVideoElRef.current?.pause()
      return
    }
    const p = ensurePlayer()
    if (!p || !wallpaper.blob) return
    if (lastSetBlobRef.current !== wallpaper.blob) {
      lastSetBlobRef.current = wallpaper.blob
      void p.set(wallpaper.blob, wallpaper.poster ?? null)
    }
  }, [wallpaper, ensurePlayer])

  /* video duty: only the custom theme with a VIDEO wallpaper may present
     frames. Switching to black/gradient/aurora (or an image wallpaper)
     pauses decode instead of leaving it running invisibly behind the hidden
     layer — that hidden decode was the persistent ~30fps UI after "clearing"
     the wallpaper by switching themes */
  useEffect(() => {
    const p = playerRef.current ?? ensurePlayer()
    p?.setActive(theme === 'custom' && wallpaper?.type === 'video')
  }, [theme, wallpaper, ensurePlayer])

  /* playback speed */
  useEffect(() => {
    const v = wallVideoElRef.current
    if (v) v.playbackRate = wallSpeed
  }, [wallSpeed, wallpaper?.blob])

  /* conversion queue — one at a time, cancelable */
  type WallJob = { file: File; preset: WallPreset; fps: number | null; start: number }
  const wallQueueRef = useRef<WallJob[]>([])
  const convertingRef = useRef(false)
  const abortRef = useRef<AbortController | null>(null)
  const cancelConvert = useCallback(() => abortRef.current?.abort(), [])

  const applyVideoBlob = useCallback((blob: Blob, original: File | null, poster: Blob | null) => {
    setWallpaper(() => ({ type: 'video', blob, poster }))
    setThemeState('custom')
    localStorage.setItem('md-theme', 'custom')
    setWallOriginal(original)
  }, [])

  const processWallQueue = useCallback(async () => {
    if (convertingRef.current) return
    convertingRef.current = true
    while (wallQueueRef.current.length) {
      const job = wallQueueRef.current.shift()!
      const ac = new AbortController()
      abortRef.current = ac
      try {
        if (job.preset === 'original') {
          /* keep the source natively — no conversion at all */
          setWallBusy(1)
          const rec: WallpaperRecord = {
            id: crypto.randomUUID(),
            name: job.file.name.replace(/\.[^.]+$/, ''),
            width: 0, height: 0, fps: 0, sourceFps: 0, duration: 0,
            size: job.file.size, preset: 'original', hdr: false, converted: false,
            created: Date.now(), blob: job.file, poster: null, original: job.file,
          }
          await wallStore.save(rec)
          activeIdRef.current = rec.id
          setWallBusy(null)
          setPendingWallFile(null)
          setImportHint(null)
          applyVideoBlob(job.file, job.file, null)
          refreshLibrary()
        } else {
          /* show the pill immediately so the ✕ exists during probe/setup too */
          setWallStage('Analyzing')
          setWallBusy(0)
          await ensurePlayer()?.pauseForWork()
          const rec = await importWallpaper(job.file, {
            preset: job.preset as 'performance' | 'balanced' | 'high',
            start: job.start,
            fps: job.fps,
            onStage: (s) => setWallStage(s),
            onProgress: (p) => setWallBusy(p),
            signal: ac.signal,
          })
          activeIdRef.current = rec.id
          await ensurePlayer()?.resumeAfterWork()
          setWallBusy(null)
          setWallStage(null)
          setPendingWallFile(null)
          setImportHint(null)
          applyVideoBlob(rec.blob, job.file, rec.poster)
          refreshLibrary()
          if (rec.hdr) {
            setWallNote('HDR SOURCE — COLORS WILL LOOK WASHED OUT')
            window.setTimeout(() => setWallNote(null), 4500)
          }
        }
      } catch (e) {
        await ensurePlayer()?.resumeAfterWork()
        setWallBusy(null)
        setWallStage(null)
        if ((e as Error).name !== 'ConversionCanceledError') {
          setWallNote(explain(e).slice(0, 80))
          window.setTimeout(() => setWallNote(null), 4500)
        }
      } finally {
        abortRef.current = null
      }
    }
    convertingRef.current = false
  }, [applyVideoBlob, ensurePlayer, setImportHint])

  const enqueueWallpaperJob = useCallback(
    (file: File, preset?: WallPreset, fps?: number | null, start?: number) => {
      wallQueueRef.current.push({
        file,
        preset: preset ?? wallQualityRef.current,
        fps: fps !== undefined ? fps : wallFpsTargetRef.current,
        start: start ?? wallStartRef.current,
      })
      void processWallQueue()
    },
    [processWallQueue],
  )

  /* apply an image as the active wallpaper — used by the picker, by boot
     restore and by the SAVED WALLPAPERS list so all three stay identical.
     The blob is decoded offscreen FIRST under the same object URL the <img>
     will use (Chromium keys its bitmap cache by URL), so the boot reveal
     paints the finished wallpaper on its first frame instead of a blank
     layer; the returned promise resolves once that decode is done. */
  const applyImage = useCallback((src: Blob | string, original: File | null = null) => {
    const url = typeof src === 'string' ? src : URL.createObjectURL(src)
    const warm = new Promise<void>((res) => {
      const off = new Image()
      off.onload = () => {
        const p = off.decode?.()
        if (p) p.then(() => res(), () => res())
        else res()
      }
      off.onerror = () => res()
      off.src = url
    })
    setWallImageUrl((old) => {
      if (old) URL.revokeObjectURL(old)
      return url
    })
    setWallpaper({ type: 'image' })
    setThemeState('custom')
    localStorage.setItem('md-theme', 'custom')
    setWallOriginal(original)
    return warm
  }, [setThemeState])

  const onWallFile = useCallback((f: File | undefined) => {
    if (!f) return
    if (f.type.startsWith('image/') && f.type !== 'image/gif') {
      const rec: WallpaperRecord = {
        id: crypto.randomUUID(),
        name: f.name.replace(/\.[^.]+$/, ''),
        width: 0, height: 0, fps: 0, sourceFps: 0, duration: 0,
        size: f.size, preset: 'original', hdr: false, converted: false,
        created: Date.now(), blob: f, poster: null, original: f,
      }
      activeIdRef.current = rec.id
      applyImage(f)
      void wallStore.save(rec).then(refreshLibrary).catch(() => {})
      /* IndexedDB fallback: keep a data URL in localStorage so the image
         survives a reload even when IDB is blocked/unavailable */
      const reader = new FileReader()
      reader.onloadend = () => {
        try {
          localStorage.setItem('md-wallpaper-image', reader.result as string)
        } catch {
          /* quota exceeded — the IndexedDB copy is still the source of truth */
        }
      }
      reader.readAsDataURL(f)
      return
    }
    /* videos: quality chooser opens — pick a preset (or original) to convert */
    setPendingWallFile(f)
    setImportHint('PICK A QUALITY, THEN CONVERT')
    setWallSettingsOpen(true)
  }, [applyImage, setImportHint])

  /* stop the live wallpaper and return to the black theme — WITHOUT touching
     the saved wallpapers library */
  const deactivateWallpaper = useCallback(() => {
    activeIdRef.current = null
    /* side effects stay OUT of setState updaters (StrictMode may run them twice) */
    lastSetBlobRef.current = null
    setWallpaper(null)
    if (wallImageUrl) URL.revokeObjectURL(wallImageUrl)
    setWallImageUrl(null)
    setThemeState('black')
    localStorage.setItem('md-theme', 'black')
    setWallOriginal(null)
    localStorage.removeItem('md-wallpaper-image')
    /* the player owns blob URLs, rAF loops and listeners — tear it down too;
       resetTier first so a stale data-fx grade can't leave effects disabled */
    playerRef.current?.resetTier()
    playerRef.current?.destroy()
    playerRef.current = null
    const v = wallVideoElRef.current
    if (v) {
      v.pause()
      v.removeAttribute('src')
      v.load() /* release the decoder now — removeAttribute alone can leave it alive */
    }
    ensurePlayer() /* fresh player: the governor keeps watching the frame loop */
  }, [wallImageUrl, ensurePlayer])

  const removeWallpaper = useCallback(() => {
    deactivateWallpaper()
    void wallStore.list().then((recs: WallpaperRecord[]) => {
      Promise.all(recs.map((r) => wallStore.remove(r.id))).then(() => {
        setSavedWallpapers([])
      })
    })
  }, [deactivateWallpaper])

  /* restore wallpaper (converted blob lives in the wallpapers IndexedDB) */
  const refreshLibrary = useCallback(() => {
    void wallStore.list().then((recs: WallpaperRecord[]) => {
      setSavedWallpapers([...recs].sort((a, b) => b.created - a.created))
    })
  }, [])
  useEffect(() => {
    void requestPersistentStorage() /* used to ride along with player creation */
    let alive = true
    /* A saved wallpaper is restored into the wallpaper SLOT, it does not get to
       re-pick the theme. Restoring used to force 'custom' unconditionally, so
       a colour / gradient / aurora choice was silently replaced on every
       launch — the "colour was not saved" report. The theme the user picked
       last wins; only a first run (or an explicit 'custom') shows the
       wallpaper. */
    const savedTheme = readSavedTheme(localStorage.getItem('md-theme'))
    const keepTheme = () => {
      if (!savedTheme || savedTheme === 'custom') return
      setThemeState(savedTheme)
      localStorage.setItem('md-theme', savedTheme)
    }
    /* the boot gate waits on this — signal only once the restored wallpaper
       is actually showing pixels (image decoded / video first frame).

       A watchdog too: IndexedDB is happy to leave a request pending forever
       (a blocked upgrade, a half-finished transaction), and a promise that
       never settles is exactly what trapped the intro on SYNCING LIBRARY. */
    let watchdog = 0
    const signal = () => {
      window.clearTimeout(watchdog)
      signalBootReady('wallpaper')
    }
    watchdog = window.setTimeout(signal, 4000)
    const waitForVideoFrame = () =>
      new Promise<void>((res) => {
        const v = wallVideoElRef.current
        if (!v) return res()
        function ok() {
          window.clearTimeout(to)
          res()
        }
        /* never hold the boot hostage to a stubborn file */
        const to = window.setTimeout(() => {
          v.removeEventListener('loadeddata', ok)
          res()
        }, 3000)
        v.addEventListener('loadeddata', ok, { once: true })
      })
    void bootReset
      .then(() => wallStore.list())
      .then(async (recs: WallpaperRecord[]) => {
        /* StrictMode's first pass bows out here — the second pass owns the
           signals, so an early-return can never release the gate too soon */
        if (!alive) return
        const sorted = [...recs].sort((a, b) => b.created - a.created)
        setSavedWallpapers(sorted)
        const newest = sorted[0]
        if (newest) {
          /* an image record must come back as type 'image' + an object URL —
             handing its blob to the video player renders nothing */
          if (newest.blob.type.startsWith('image/')) {
            activeIdRef.current = newest.id
            await applyImage(newest.blob, newest.original ?? null)
            keepTheme()
            if (alive) signal()
            return
          }
          lastSetBlobRef.current = null
          activeIdRef.current = newest.id
          setWallpaper({ type: 'video', blob: newest.blob, poster: newest.poster })
          setThemeState('custom')
          localStorage.setItem('md-theme', 'custom')
          setWallOriginal(newest.original ?? null)
          keepTheme()
          await waitForVideoFrame()
          if (alive) signal()
          return
        }
        /* nothing in IndexedDB (blocked, private mode, fresh profile) — the
           data URL onWallFile cached in localStorage still restores the image */
        const cached = localStorage.getItem('md-wallpaper-image')
        if (cached) {
          await applyImage(cached)
          keepTheme()
        }
        if (alive) signal()
      })
      .catch(() => {
        if (alive) signal()
      })
    return () => {
      alive = false
      window.clearTimeout(watchdog)
    }
  }, [applyImage])

  /* switch to a stored wallpaper instantly — no upload, no conversion */
  const switchWallpaper = useCallback((rec: WallpaperRecord) => {
    lastSetBlobRef.current = null /* force the player to swap */
    activeIdRef.current = rec.id
    if (rec.blob.type.startsWith('image/')) {
      applyImage(rec.blob, rec.original ?? null)
      return
    }
    setWallpaper({ type: 'video', blob: rec.blob, poster: rec.poster })
    setThemeState('custom')
    localStorage.setItem('md-theme', 'custom')
    setWallOriginal(rec.original ?? null)
  }, [applyImage])

  /* remove one saved wallpaper from the library by id */
  const removeSavedWallpaper = useCallback((id: string) => {
    /* deleting the row of the LIVE wallpaper must also stop it — removing just
       the IndexedDB entry left the video decoding behind the webview (the UI
       sat at ~34fps with no visible wallpaper change) */
    if (activeIdRef.current === id) deactivateWallpaper()
    void wallStore.remove(id)
    setSavedWallpapers((prev) => prev.filter((r) => r.id !== id))
  }, [deactivateWallpaper])

  /* quality buttons in the settings panel: ONLY persist the choice —
     conversion waits for the explicit CONVERT button below, so picking a
     preset (or an fps) never kicks off work on its own */
  const pickQuality = useCallback((q: WallPreset) => {
    setWallQualityState(q)
    localStorage.setItem('md-wall-quality', q)
  }, [])

  /* true when there is a source to (re)convert: a freshly queued video or
     the original file behind the current wallpaper */
  const canConvert = !!(pendingWallFile ?? wallOriginal)

  /* CONVERT button: runs that source through the selected quality/fps/start;
     ORIGINAL stores it raw. The queue guard makes double-clicks no-ops */
  const convertWallpaper = useCallback(() => {
    if (convertingRef.current || wallQueueRef.current.length) return
    const src = pendingWallFile ?? wallOriginal
    if (!src) return
    enqueueWallpaperJob(src, wallQuality, wallQuality === 'original' ? null : wallFpsTarget, wallStart)
  }, [pendingWallFile, wallOriginal, wallQuality, wallFpsTarget, wallStart, enqueueWallpaperJob])

  return {
    theme,
    setTheme,
    wallPaint,
    setWallPaint,
    applyWallPaint,
    hasWallPaint,
    wallPaintCss,
    wallPaintLabel,
    wallpaper,
    wallImageUrl,
    wallVideoRef,
    wallVideoElRef,
    wallInputRef,
    wallBlur,
    wallDim,
    wallSpeed,
    wallSettingsOpen,
    setWallSettingsOpen,
    toggleWallSettings,
    closeWallSettings,
    onWallSettingsClosed,
    wallSettingsClosing,
    wallBusy,
    wallStage,
    wallNote,
    pendingWallFile,
    wallQuality,
    wallFpsTarget,
    wallStart,
    wallPauseHidden,
    pickQuality,
    canConvert,
    convertWallpaper,
    setWallFpsTarget,
    setWallStart,
    setWallSpeed,
    setWallBlurOn,
    setWallDimV,
    setWallPauseHiddenV,
    cancelConvert,
    removeWallpaper,
    onWallFile,
    savedWallpapers,
    switchWallpaper,
    removeSavedWallpaper,
    refreshLibrary,
  }
}
