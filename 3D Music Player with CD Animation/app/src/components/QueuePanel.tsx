import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import type { Track } from '../hooks/useAudioEngine'
import {
  DOWNLOADS_FOLDER_ID,
  FAVOURITES_FOLDER_ID,
  type PlaylistFolder,
} from '../features/playlist/usePlaylists'
import liquidGL, { type LiquidGLHandle } from 'liquid-gl'
import { deleteLocalLyrics, loadLocalLyrics, saveLocalLyrics } from '../lib/library'
import { getLyricsTitle, setLyricsTitle } from '../lib/lyricsTitle'
import { getLastProviderId } from '../features/lyrics/installProviderChain'
import { providerById } from '../features/lyrics/registry'
import LyricsEditor from './LyricsEditor'
import './QueuePanel.css'

/* ------------------------------------------------------------------ icons */

const D = {
  x: 'M6 6l12 12M18 6L6 18',
  plus: 'M12 5v14M5 12h14',
  next: 'M4 6h11M4 12h7M4 18h11M17 9l4 3-4 3z',
  play: 'M8 5v14l11-7z',
  pin: 'M12 16v6M8 3h8l-1 6 3 4H6l3-4z',
  back: 'M15 6l-6 6 6 6',
  pen: 'M4 20h4L19 9l-4-4L4 16z',
  image: 'M4 5h16v14H4zM8 11l3 3 3-3 4 4M9 9h.01',
  tune: 'M4 7h9M19 7h1M4 17h1M11 17h9M16 7a2.2 2.2 0 1 1-4.4 0 2.2 2.2 0 0 1 4.4 0M8 17a2.2 2.2 0 1 0 4.4 0A2.2 2.2 0 0 0 8 17',
  trash: 'M5 7h14M10 7V4h4v3M6 7l1 13h10l1-13M10 11v5M14 11v5',
  check: 'M5 12l5 5L20 6',
  lyrics: 'M5 6h14M5 11h10M5 16h7M17 13v6M17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  refresh: 'M20 12a8 8 0 1 1-2.3-5.7M20 4v4h-4',
  list: 'M4 6h16M4 12h16M4 18h10',
  heart: 'M12 19.7C7.8 16.7 4.2 13.6 4.2 10a4.1 4.1 0 0 1 7.8-1.8A4.1 4.1 0 0 1 19.8 10c0 3.6-3.6 6.7-7.8 9.7z',
}

function Icon({
  d,
  className = 'qp-i',
  filled = false,
}: {
  d: string
  className?: string
  filled?: boolean
}) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" data-fill={filled ? 'true' : undefined}>
      <path d={d} />
    </svg>
  )
}

function SearchIcon() {
  return (
    <svg className="qp-i" viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4.5 4.5" />
    </svg>
  )
}

function GripIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="9" cy="6" r="1.8" />
      <circle cx="15" cy="6" r="1.8" />
      <circle cx="9" cy="12" r="1.8" />
      <circle cx="15" cy="12" r="1.8" />
      <circle cx="9" cy="18" r="1.8" />
      <circle cx="15" cy="18" r="1.8" />
    </svg>
  )
}

/* ------------------------------------------------------------------- art */

const hueFor = (seed: string | number) => {
  const n = typeof seed === 'number' ? seed : Array.from(seed).reduce((a, c) => a + c.charCodeAt(0), 0)
  return (n * 47 + 12) % 360
}

function Art({
  title,
  cover,
  seed,
  onPlay,
  label,
}: {
  title: string
  cover?: string
  seed: string | number
  onPlay?: () => void
  label?: string
}) {
  const style = { '--qp-h': String(hueFor(seed)) } as CSSProperties
  const body = (
    <>
      {cover ? <img src={cover} alt="" draggable={false} /> : <span>{title.trim().charAt(0).toUpperCase() || '?'}</span>}
      {onPlay && <Icon d={D.play} className="qp-art-play" filled />}
    </>
  )
  return onPlay ? (
    <button type="button" className="qp-art" style={style} onClick={onPlay} aria-label={label ?? `Play ${title}`}>
      {body}
    </button>
  ) : (
    <span className="qp-art" style={style}>
      {body}
    </span>
  )
}

/* ---------------------------------------------------------- rename field */

function RenameField({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string
  onCommit: (value: string) => void
  onCancel: () => void
}) {
  const ref = useRef<HTMLInputElement>(null)
  const cancelled = useRef(false)
  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])
  return (
    <input
      ref={ref}
      className="qp-rn"
      defaultValue={initial}
      maxLength={80}
      aria-label="Rename"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault()
          e.currentTarget.blur()
        } else if (e.key === 'Escape') {
          e.preventDefault()
          cancelled.current = true
          e.currentTarget.blur()
        }
        e.stopPropagation()
      }}
      onBlur={(e) => {
        if (!cancelled.current) {
          const v = e.currentTarget.value.trim()
          if (v && v !== initial) onCommit(v)
        }
        onCancel()
      }}
    />
  )
}

/* ------------------------------------------------------------------ panel */

export type QueueTab = 'q' | 'p'

export interface QueuePanelProps {
  /** whether the panel is on screen */
  open: boolean
  tab: QueueTab
  onTab: (tab: QueueTab) => void
  onRequestOpen: () => void

  tracks: Track[]
  folders: PlaylistFolder[]
  playingFolderId: number | null
  currentTrackId: number | null
  playing: boolean
  nextUp: number[]

  onPlayTrack: (trackId: number, folderId?: number) => void
  onAddToQueue: (trackId: number) => void
  onPlayNext: (trackId: number) => void
  onRemoveFromQueue: (trackId: number) => void
  onReorderQueue: (from: number, to: number) => void
  onClearQueue: () => void
  onRenameTrack: (trackId: number, title: string) => void
  onEditTrack: (trackId: number, title: string, artist: string, cover?: string) => void
  /** let Home refresh the live lyrics if the edited track is the playing one */
  onLyricsSaved: (trackId: number) => void

  onCreateFolder: () => number
  onRenameFolder: (id: number, name: string) => void
  onDeleteFolder: (id: number) => void
  onAddTrackToFolder: (folderId: number, trackId: number) => void
  onRemoveTrackFromFolder: (folderId: number, trackId: number) => void
  onReorderFolderTracks: (folderId: number, from: number, to: number) => void
  onUploadFile: (folderId: number, file: File) => void
  onRefreshDownloads: () => void
  refreshingDownloads: boolean
  refreshNote: string | null

  /** true while the panel is hosted by the layout editor's frame (the global
     edit mode): it fills the frame instead of docking at a screen edge */
  framed?: boolean
  /** hands the aside element to Home — the layout editor seeds its starting
     rectangle from the panel's docked position */
  outerRef?: (el: HTMLElement | null) => void
}

type QueueEntry = {
  key: string
  track: Track
  /** index in Home's play-next queue, -1 when the row is just context */
  nextUpIndex: number
  /** index in the playing folder, -1 when it is the current track */
  folderIndex: number
}

type Popover = 'glass' | null

/* ---- the glass settings (transparency · blur · refraction · radius) ----
   One persisted record; the sliders write it live and it survives a reload. */
type GlassPrefs = { scrim: number; blur: number; scale: number; radius: number }
const GLASS_DEFAULT: GlassPrefs = { scrim: 0.3, blur: 3, scale: -96, radius: 28 }
const GLASS_KEY = 'md-qp-glass'

function readGlassPrefs(): GlassPrefs {
  try {
    const raw = localStorage.getItem(GLASS_KEY)
    if (!raw) return { ...GLASS_DEFAULT }
    const p = JSON.parse(raw) as Partial<GlassPrefs>
    const out = { ...GLASS_DEFAULT }
    if (typeof p.scrim === 'number') out.scrim = Math.min(0.7, Math.max(0, p.scrim))
    if (typeof p.blur === 'number') out.blur = Math.min(24, Math.max(0, p.blur))
    if (typeof p.scale === 'number') out.scale = Math.min(-40, Math.max(-180, p.scale))
    if (typeof p.radius === 'number') out.radius = Math.min(36, Math.max(8, p.radius))
    return out
  } catch {
    return { ...GLASS_DEFAULT }
  }
}

/* liquidGL option mappers — module scope so the effects below keep stable
   dependency arrays. The tint is the panel's old dark scrim (rgba(10,10,14))
   handed to the lens instead of painted behind it; the refraction slider's
   -40..-180 displacement range maps onto liquidGL's 0..0.09 offset. */
const lgTint = (scrim: number) => `rgba(10, 10, 14, ${scrim})`
const lgRefraction = (scale: number) => Math.min(0.09, (Math.abs(scale) / 180) * 0.09)
const glassMode = (): 'on' | 'off' => {
  const mode =
    document.documentElement.dataset.glass ??
    (localStorage.getItem('md-glass') === 'off' ? 'off' : 'on')
  return mode === 'off' ? 'off' : 'on'
}

export default memo(function QueuePanel({
  open,
  tab,
  onTab,
  onRequestOpen,
  tracks,
  folders,
  playingFolderId,
  currentTrackId,
  playing,
  nextUp,

  onPlayTrack,
  onAddToQueue,
  onPlayNext,
  onRemoveFromQueue,
  onReorderQueue,
  onClearQueue,
  onRenameTrack,
  onEditTrack,
  onLyricsSaved,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  onAddTrackToFolder,
  onRemoveTrackFromFolder,
  onReorderFolderTracks,
  onUploadFile,
  onRefreshDownloads,
  refreshingDownloads,
  refreshNote,
  framed = false,
  outerRef,
}: QueuePanelProps) {
  const panelRef = useRef<HTMLElement | null>(null)
  const listRef = useRef<HTMLUListElement | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)
  const uploadRef = useRef<HTMLInputElement | null>(null)

  /* hand the aside to Home the moment it exists (the layout editor seeds its
     starting rectangle from where the panel was docked) */
  const setAside = useCallback(
    (el: HTMLElement | null) => {
      panelRef.current = el
      outerRef?.(el)
    },
    [outerRef],
  )

  /* ---- glass settings ----
     The panel's glass is TRUE refraction now: liquidGL (WebGPU → WebGL →
     CSS) snapshots the page once and bends it through a canvas that lives
     inside the panel, re-reading the panel's rect every frame — so the
     slide keeps tracking. On activate the library strips the target's own
     background and backdrop-filter; while the GPU lens is up the dark scrim
     behind the content is zeroed (the lens tint takes over the same
     darkening) and it stays for the CSS fallback. Transparency drives
     setTint live; blur (frost) and refraction have no runtime setter, so
     those two rebuild the lens behind a 350ms debounce — a slider fires
     dozens of changes and every rebuild re-rasterises the page. */
  const [glass, setGlass] = useState<GlassPrefs>(readGlassPrefs)

  const setGlassPref = useCallback((key: keyof GlassPrefs, value: number) => {
    setGlass((cur) => {
      const next = { ...cur, [key]: value }
      try {
        localStorage.setItem(GLASS_KEY, JSON.stringify(next))
      } catch {
        /* private mode — the session keeps the value */
      }
      return next
    })
  }, [])

  const lgRef = useRef<LiquidGLHandle | null>(null)
  const lgTimer = useRef(0)
  const lgLastRefresh = useRef(0)

  /* the only public "re-capture the page behind the panel" lever:
     registerDynamic() early-returns for an element it already tracks but
     ALWAYS re-rasterises the snapshot — listener-free when repeated */
  const refreshGlass = useCallback(() => {
    if (!lgRef.current) return
    const now = Date.now()
    if (now - lgLastRefresh.current < 400) return
    lgLastRefresh.current = now
    try {
      liquidGL.registerDynamic('.playlist-scroll')
    } catch {
      /* no renderer yet — the next init captures anyway */
    }
  }, [])

  const destroyLens = useCallback(() => {
    window.clearTimeout(lgTimer.current)
    lgRef.current?.destroy?.()
    lgRef.current = null
    const el = panelRef.current
    if (el) delete el.dataset.lg
  }, [])

  const createLens = useCallback(() => {
    const el = panelRef.current
    if (!el || glassMode() === 'off') return
    destroyLens()
    const p = readGlassPrefs()
    try {
      const lens = liquidGL('.qp-panel', {
        engine: 'auto',
        snapshot: 'body',
        refraction: lgRefraction(p.scale),
        bevelDepth: 0.13,
        bevelWidth: 0.1,
        frost: p.blur,
        tint: lgTint(p.scrim),
        shadow: false,
        specular: true,
        reveal: 'none',
        on: {
          /* fires only once the backend is confirmed — the dataset marks a
             LIVE lens (an inert one must keep its scrim) */
          init: () => {
            el.dataset.lg = 'gpu'
            refreshGlass()
          },
        },
      })
      const first = Array.isArray(lens) ? lens[0] : lens
      lgRef.current = first ?? null
      /* the CSS-fallback path has no canvas and no init callback */
      if (!el.querySelector('canvas')) el.dataset.lg = 'css'
      el.dataset.lgFrost = String(p.blur)
      el.dataset.lgRefraction = String(lgRefraction(p.scale))
    } catch (e) {
      console.warn('[qp] liquidGL could not start:', e)
    }
  }, [destroyLens, refreshGlass])

  const scheduleLens = useCallback(
    (ms: number) => {
      window.clearTimeout(lgTimer.current)
      lgTimer.current = window.setTimeout(createLens, ms)
    },
    [createLens],
  )

  /* build once on mount (the delay lets StrictMode's first mount cancel
     itself), tear down with the component, and follow the global
     Blurred / Solid switch — it lives on <html data-glass> and can flip
     from surfaces that never re-render this panel */
  useEffect(() => {
    scheduleLens(350)
    const mo = new MutationObserver(() => {
      if (glassMode() === 'off') destroyLens()
      else scheduleLens(120)
    })
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-glass'] })
    return () => {
      mo.disconnect()
      destroyLens()
    }
  }, [scheduleLens, destroyLens])

  /* blur + refraction rebuild the lens (debounced — no runtime setter) */
  useEffect(() => {
    scheduleLens(350)
    return () => window.clearTimeout(lgTimer.current)
  }, [glass.blur, glass.scale, scheduleLens])

  /* transparency is a runtime setter — the tint follows the slider live */
  useEffect(() => {
    lgRef.current?.setTint?.(lgTint(glass.scrim))
  }, [glass.scrim])

  /* radius needs nothing from the lens: --qp-rad moves border-radius and
     liquidGL re-reads it every frame, so the bevel follows in real time */

  /* content behind the panel changed (tracks added, renamed, reordered;
     folder switched) → re-rasterise so the glass never shows a stale page */
  useEffect(() => {
    if (!lgRef.current) return
    const t = window.setTimeout(refreshGlass, 400)
    return () => window.clearTimeout(t)
  }, [tracks, folders, refreshGlass])

  /* a panel that reopens after a long gap re-captures once — wallpaper,
     theme and header changes happen outside this component's props */
  useEffect(() => {
    if (!open || !lgRef.current) return
    if (Date.now() - lgLastRefresh.current < 6000) return
    const t = window.setTimeout(refreshGlass, 600)
    return () => window.clearTimeout(t)
  }, [open, refreshGlass])

  /* the lens anchors to the panel's fixed ancestor: in global edit mode the
     panel is relative inside the layout frame, and a lens built there would
     die with the frame on exit — so rebuild on either side of the switch,
     while each fixed ancestor is mounted */
  useEffect(() => {
    if (glassMode() === 'off') return
    scheduleLens(200)
    return () => window.clearTimeout(lgTimer.current)
  }, [framed, scheduleLens])

  /* ---- docked width / side (standard layout) ----
     Read once from a past session's saved prefs. There are no in-panel
     controls for these any more: sizing and docking belong to the GLOBAL
     edit mode now, whose rectangle the layout editor persists. */
  const [dock] = useState(() => {
    const n = Number(localStorage.getItem('md-qp-width'))
    return {
      w: Number.isFinite(n) && n >= 300 && n <= 560 ? n : 392,
      s: localStorage.getItem('md-qp-side') === 'right' ? ('right' as const) : ('left' as const),
    }
  })
  const width = dock.w
  const side = dock.s

  /* ---- tabs / views ---- */
  const [openFolderId, setOpenFolderId] = useState<number | null>(null)
  const [query, setQuery] = useState('')
  const [dir, setDir] = useState(1)
  const [renamingId, setRenamingId] = useState<number | null>(null)
  const [renamingFolderId, setRenamingFolderId] = useState<number | null>(null)
  const [pop, setPop] = useState<Popover>(null)

  const viewKey = `${tab}:${openFolderId ?? 'root'}`

  const switchTab = useCallback(
    (next: QueueTab) => {
      if (next === tab && openFolderId == null) return
      setDir(next === tab ? -1 : next === 'p' ? 1 : -1)
      onTab(next)
      setOpenFolderId(null)
      setQuery('')
      setRenamingId(null)
      setRenamingFolderId(null)
      setPop(null)
    },
    [tab, openFolderId, onTab],
  )

  const openFolderView = useCallback((id: number) => {
    setDir(1)
    setOpenFolderId(id)
    setQuery('')
    setRenamingId(null)
    setRenamingFolderId(null)
  }, [])

  const closeFolder = useCallback(() => {
    setDir(-1)
    setOpenFolderId(null)
    setQuery('')
    setRenamingId(null)
    setRenamingFolderId(null)
  }, [])

  /* Tracks removed from the queue view but not from their playlist. The
     playing folder supplies the context rows, so a context row cannot be
     removed through the playlist API without touching the library — this
     keeps the removal local to the queue instead. The set resets itself
     when the playing folder changes (the key is the folder id). */
  const [skipped, setSkipped] = useState<{ folder: number | null; ids: number[] }>({
    folder: null,
    ids: [],
  })
  const skippedIds = useMemo(
    () => new Set(skipped.folder === playingFolderId ? skipped.ids : []),
    [skipped, playingFolderId],
  )

  /* ---- pin / auto-hide ----
     "Inside" is decided by the DOM's own hit-testing, never by a cached
     rectangle: the panel slides with a CSS transform, and a rect measured
     mid-slide (or any moment before the next re-measure) once read as
     off-screen while the cursor sat on the visible panel — the panel then
     closed under the pointer. pointerover/pointerout follow the RENDERED
     position exactly, so the pin button only decides what happens AFTER the
     cursor leaves the panel. */
  const [pinned, setPinned] = useState(true)
  const [away, setAway] = useState(false)
  const pinnedRef = useRef(true)
  const awayRef = useRef(false)
  const hideTimerRef = useRef(0)
  const draggingRef = useRef(false)
  const rectRef = useRef<DOMRect | null>(null)
  /* the previous sampled x — a reopen fires only on the move that CROSSES
     into the 12px dock strip, so a cursor parked on the strip while the
     panel hides can never re-open it (the classic flicker loop) */
  const lastMxRef = useRef<number | null>(null)

  useEffect(() => {
    awayRef.current = away
  }, [away])
  useEffect(() => {
    pinnedRef.current = pinned
  }, [pinned])

  const show = useCallback(() => {
    window.clearTimeout(hideTimerRef.current)
    hideTimerRef.current = 0
    setAway(false)
    if (!open) onRequestOpen()
  }, [open, onRequestOpen])

  const hideSoon = useCallback(() => {
    window.clearTimeout(hideTimerRef.current)
    hideTimerRef.current = window.setTimeout(() => {
      hideTimerRef.current = 0
      /* re-check INSIDE at fire time — a cursor that slipped back in during
         the grace window cancels the hide. matches(':hover') is a hit-test,
         no layout read. */
      if (!pinnedRef.current && !draggingRef.current && !panelRef.current?.matches(':hover')) {
        setAway(true)
      }
    }, 350)
  }, [])

  const togglePin = useCallback(() => {
    const next = !pinnedRef.current
    pinnedRef.current = next
    setPinned(next)
    if (next) show()
  }, [show])

  /* the whole panel family — the portalled track menu hangs OUTSIDE the
     aside, and moving onto it must count as staying in */
  const over = useCallback((e: PointerEvent) => {
    if ((e.target as Element | null)?.closest?.('.qp-panel, .qp-menu')) {
      window.clearTimeout(hideTimerRef.current)
      hideTimerRef.current = 0
    }
  }, [])

  const out = useCallback(
    (e: PointerEvent) => {
      const from = (e.target as Element | null)?.closest?.('.qp-panel, .qp-menu')
      const to = (e.relatedTarget as Element | null)?.closest?.('.qp-panel, .qp-menu') ?? null
      if (from && !to && !pinnedRef.current && !draggingRef.current && !hideTimerRef.current) {
        hideSoon()
      }
    },
    [hideSoon],
  )

  useEffect(() => {
    document.addEventListener('pointerover', over)
    document.addEventListener('pointerout', out)
    return () => {
      document.removeEventListener('pointerover', over)
      document.removeEventListener('pointerout', out)
      window.clearTimeout(hideTimerRef.current)
    }
  }, [over, out])

  /* The rectangle is cached for exactly ONE consumer: re-opening a hidden
     panel from the dock edge. It is re-measured on resize, on content-driven
     size changes and after each slide TRANSITION ends — measuring mid-slide
     is what produced the lying rect in the first place. */
  useEffect(() => {
    const el = panelRef.current
    if (!el) return
    let raf = 0
    const measure = () => {
      raf = 0
      rectRef.current = el.getBoundingClientRect()
    }
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(measure)
    }
    const onTransition = (e: TransitionEvent) => {
      if (e.target === el && e.propertyName === 'transform') measure()
    }
    measure()
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule)
    ro?.observe(el)
    window.addEventListener('resize', schedule)
    el.addEventListener('transitionend', onTransition)
    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', schedule)
      el.removeEventListener('transitionend', onTransition)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [side, width, open])

  /* while hidden, the move that CROSSES into the 12px dock strip brings the
     panel back — entering the strip is the gesture, parking on it is not */
  useEffect(() => {
    let raf = 0
    let mx = 0
    const run = () => {
      raf = 0
      const prev = lastMxRef.current
      lastMxRef.current = mx
      if (!awayRef.current) return
      const strip = 12
      const atEdge = side === 'left' ? mx <= strip : mx >= window.innerWidth - strip
      const wasOutside =
        prev == null ? true : side === 'left' ? prev > strip : prev < window.innerWidth - strip
      if (atEdge && wasOutside) show()
    }
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse' || draggingRef.current) return
      mx = e.clientX
      if (!raf) raf = requestAnimationFrame(run)
    }
    window.addEventListener('pointermove', onMove)
    return () => {
      window.removeEventListener('pointermove', onMove)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [side, show])

  /* ---- toast ---- */
  const [toastMsg, setToastMsg] = useState<string | null>(null)
  const toastTimerRef = useRef(0)
  const toast = useCallback((message: string) => {
    setToastMsg(message)
    window.clearTimeout(toastTimerRef.current)
    toastTimerRef.current = window.setTimeout(() => setToastMsg(null), 1500)
  }, [])
  useEffect(() => () => window.clearTimeout(toastTimerRef.current), [])

  /* ---- data maps ---- */
  const trackById = useMemo(() => new Map(tracks.map((t) => [t.id, t])), [tracks])

  /* the FAVOURITES membership, for the row hearts (playlist rows only —
     never in the Current queue tab) */
  const favIds = useMemo(() => {
    const fav = folders.find((f) => f.id === FAVOURITES_FOLDER_ID)
    return new Set(fav?.trackIds ?? [])
  }, [folders])

  const toggleFav = useCallback(
    (track: Track) => {
      if (favIds.has(track.id)) {
        onRemoveTrackFromFolder(FAVOURITES_FOLDER_ID, track.id)
        toast('Removed from favourites')
      } else {
        onAddTrackToFolder(FAVOURITES_FOLDER_ID, track.id)
        toast('Added to favourites')
      }
    },
    [favIds, onAddTrackToFolder, onRemoveTrackFromFolder, toast],
  )

  const playingFolder = useMemo(
    () => folders.find((f) => f.id === playingFolderId) ?? null,
    [folders, playingFolderId],
  )

  const folderTracks = useCallback(
    (folder: PlaylistFolder): Track[] =>
      folder.trackIds.map((id) => trackById.get(id)).filter((t): t is Track => !!t),
    [trackById],
  )

  const current = currentTrackId != null ? trackById.get(currentTrackId) ?? null : null

  const playingTracks = useMemo(
    () => (playingFolder ? folderTracks(playingFolder) : tracks),
    [playingFolder, folderTracks, tracks],
  )

  const nextUpTracks = useMemo(
    () => nextUp.map((id) => trackById.get(id)).filter((t): t is Track => !!t),
    [nextUp, trackById],
  )

  /* The queue is the play-next list followed by the context that is still
     ahead of the playhead. The current track is pinned first — but it keeps
     its REAL home (play-next position / folder position), so the row under
     the playhead can be dragged like any other instead of being the one
     row that refuses to move. Every entry carries where it lives, so a drag
     can update the right list. */
  const queueEntries = useMemo<QueueEntry[]>(() => {
    const out: QueueEntry[] = []
    const seen = new Set<number>()
    if (current) {
      out.push({
        key: `cur:${current.id}`,
        track: current,
        nextUpIndex: nextUpTracks.findIndex((t) => t.id === current.id),
        /* library view has no folder to reorder (drag finish needs one) */
        folderIndex:
          playingFolderId != null ? playingTracks.findIndex((t) => t.id === current.id) : -1,
      })
      seen.add(current.id)
    }
    nextUpTracks.forEach((t, i) => {
      if (seen.has(t.id)) return
      seen.add(t.id)
      out.push({ key: `next:${t.id}`, track: t, nextUpIndex: i, folderIndex: -1 })
    })
    /* the context rotates at the playhead: everything AHEAD of the current
       track first (that is what Next plays), the already-played tail after
       it — so the row directly under the current row IS the next song, in
       every view, instead of the raw folder order showing played tracks
       above the upcoming ones. The current track keeps its real home above
       (drag needs the true folder index, so folderIndex stays the position
       inside the folder's own list, not the rotated display slot). */
    const at = current ? playingTracks.findIndex((t) => t.id === current.id) : -1
    const ahead =
      at === -1 ? playingTracks : [...playingTracks.slice(at + 1), ...playingTracks.slice(0, at)]
    const folderPos = (id: number) =>
      playingFolderId != null
        ? playingTracks.findIndex((t) => t.id === id)
        : -1
    ahead.forEach((t, i) => {
      if (seen.has(t.id)) return
      seen.add(t.id)
      out.push({
        key: `ctx:${t.id}`,
        track: t,
        nextUpIndex: -1,
        folderIndex: playingFolderId != null ? folderPos(t.id) : i,
      })
    })
    return out.filter((e) => !skippedIds.has(e.track.id))
  }, [current, nextUpTracks, playingTracks, playingFolderId, skippedIds])

  const queuedIds = useMemo(() => new Set(nextUpTracks.map((t) => t.id)), [nextUpTracks])

  /* ---- search ---- */
  const q = query.trim().toLowerCase()
  const filteredQueue = useMemo(() => {
    if (!q) return queueEntries
    return queueEntries.filter(
      (e) => e.track.title.toLowerCase().includes(q) || e.track.artist.toLowerCase().includes(q),
    )
  }, [queueEntries, q])

  const folderNamesByTrack = useMemo(() => {
    const map = new Map<number, string[]>()
    for (const f of folders) {
      for (const id of f.trackIds) {
        const names = map.get(id)
        if (names) names.push(f.name)
        else map.set(id, [f.name])
      }
    }
    return map
  }, [folders])

  const folderHits = useMemo(() => {
    if (!q) return folders
    return folders.filter((f) => f.name.toLowerCase().includes(q))
  }, [folders, q])

  const trackHits = useMemo(() => {
    if (!q) return []
    return tracks.filter(
      (t) => t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q),
    )
  }, [tracks, q])

  const openFolder = openFolderId != null ? folders.find((f) => f.id === openFolderId) ?? null : null
  const openTracks = useMemo(() => (openFolder ? folderTracks(openFolder) : []), [openFolder, folderTracks])
  const visibleFolderTracks = useMemo(() => {
    if (!q) return openTracks
    return openTracks.filter(
      (t) => t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q),
    )
  }, [openTracks, q])

  const isDownloads = openFolder?.id === DOWNLOADS_FOLDER_ID

  /* ---- titles ---- */
  const title = tab === 'q' ? 'Queue' : openFolder ? openFolder.name : 'My playlists'
  const sub =
    tab === 'q'
      ? `${queueEntries.length} track${queueEntries.length === 1 ? '' : 's'}${
          nextUpTracks.length ? ` · ${nextUpTracks.length} queued` : ''
        }`
      : openFolder
        ? `${visibleFolderTracks.length} track${visibleFolderTracks.length === 1 ? '' : 's'}`
        : q
          ? `${folderHits.length} playlists · ${trackHits.length} tracks`
          : `${folders.length} playlist${folders.length === 1 ? '' : 's'}`

  /* ---- actions ---- */
  const play = useCallback(
    (track: Track, folderId?: number) => {
      if (queuedIds.has(track.id)) onRemoveFromQueue(track.id)
      onPlayTrack(track.id, folderId)
      toast(`Playing ${track.title}`)
    },
    [queuedIds, onRemoveFromQueue, onPlayTrack, toast],
  )

  const removeOne = useCallback(
    (track: Track) => {
      /* A play-next row is really in Home's queue. A folder-context row is
         only in the queue VIEW (its home is the playlist), so it is hidden
         from this view rather than deleted from anything. */
      if (queuedIds.has(track.id)) onRemoveFromQueue(track.id)
      else
        setSkipped((prev) => {
          const ids = prev.folder === playingFolderId ? prev.ids : []
          return {
            folder: playingFolderId,
            ids: ids.includes(track.id) ? ids : [...ids, track.id],
          }
        })
      toast('Removed from queue')
    },
    [queuedIds, onRemoveFromQueue, playingFolderId, toast],
  )

  const addAll = useCallback(() => {
    if (!openFolder) return
    const ids = folderTracks(openFolder).map((t) => t.id)
    if (!ids.length) return
    onPlayNext(ids[0])
    ids.slice(1).forEach((id) => onAddToQueue(id))
    toast(`${ids.length} track${ids.length === 1 ? '' : 's'} queued`)
  }, [openFolder, folderTracks, onPlayNext, onAddToQueue, toast])

  const commitRename = useCallback(
    (track: Track, value: string) => {
      onRenameTrack(track.id, value)
      toast('Track renamed')
    },
    [onRenameTrack, toast],
  )

  /* ---- drag to reorder -------------------------------------------------
     One implementation for every row. Queued rows move the play-next list;
     context rows move the playing folder. The row heights and the list rect
     are cached at pointerdown, and auto-scroll keeps its own scroll position
     instead of reading scrollTop after writing it. */
  const startDrag = useCallback(
    (e: ReactPointerEvent<HTMLSpanElement>, from: number) => {
      if (e.button !== 0 || q) return
      const list = listRef.current
      if (!list) return
      const grip = e.currentTarget
      const rows = Array.from(list.querySelectorAll<HTMLElement>('.qp-row[data-qidx]'))
      const row = rows[from]
      const fromEntry = filteredQueue[from]
      if (!row || !fromEntry) return

      e.preventDefault()
      draggingRef.current = true
      grip.setPointerCapture(e.pointerId)
      row.classList.add('qp-lift')
      row.style.willChange = 'transform'

      const H = rows[1] ? rows[1].offsetTop - rows[0].offsetTop : 60
      const startY = e.clientY
      const startScroll = list.scrollTop
      /* the list itself does not move during the drag — its rect is read
         ONCE here, never inside the frame loop */
      const listRect = list.getBoundingClientRect()
      let scrollPos = startScroll
      let y = startY
      let to = from
      let raf = 0

      rows.forEach((r) => {
        if (r !== row) r.style.transition = 'transform .2s cubic-bezier(.2,.8,.2,1)'
      })

      const tick = () => {
        if (y < listRect.top + 36) {
          scrollPos = Math.max(0, scrollPos - 10)
          list.scrollTop = scrollPos
        } else if (y > listRect.bottom - 36) {
          scrollPos += 10
          list.scrollTop = scrollPos
        }
        const dy = y - startY + (scrollPos - startScroll)
        row.style.transform = `translateY(${dy}px)`
        to = Math.max(0, Math.min(rows.length - 1, Math.round(from + dy / H)))
        rows.forEach((rr, i) => {
          if (rr === row) return
          const shift = from < to && i > from && i <= to ? -H : from > to && i < from && i >= to ? H : 0
          rr.style.transform = `translateY(${shift}px)`
        })
        raf = requestAnimationFrame(tick)
      }
      raf = requestAnimationFrame(tick)

      const onMove = (ev: PointerEvent) => {
        y = ev.clientY
      }
      const finish = () => {
        cancelAnimationFrame(raf)
        grip.removeEventListener('pointermove', onMove)
        grip.removeEventListener('pointerup', finish)
        grip.removeEventListener('pointercancel', finish)
        rows.forEach((r) => {
          r.style.transform = ''
          r.style.transition = ''
          r.style.willChange = ''
        })
        row.classList.remove('qp-lift')
        draggingRef.current = false
        if (to === from) return
        const toEntry = filteredQueue[to]
        if (!toEntry) return
        if (fromEntry.nextUpIndex >= 0 && toEntry.nextUpIndex >= 0) {
          onReorderQueue(fromEntry.nextUpIndex, toEntry.nextUpIndex)
          return
        }
        if (fromEntry.folderIndex >= 0 && toEntry.folderIndex >= 0 && playingFolderId != null) {
          onReorderFolderTracks(playingFolderId, fromEntry.folderIndex, toEntry.folderIndex)
        }
      }
      grip.addEventListener('pointermove', onMove)
      grip.addEventListener('pointerup', finish)
      grip.addEventListener('pointercancel', finish)
    },
    [q, filteredQueue, onReorderQueue, onReorderFolderTracks, playingFolderId],
  )

  /* ---- gliding hover pill ----
     The pill follows the row under the pointer. Rows are measured only when
     the pointer enters a new one (pointerover), never inside pointermove.
     Scrolling hides it and lets the next pointerover bring it back — no
     elementFromPoint pass. */
  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const glider = list.querySelector<HTMLElement>('.qp-glider')
    if (!glider) return
    let cur: HTMLElement | null = null
    const place = (row: HTMLElement | null) => {
      if (!row) {
        glider.style.opacity = '0'
        cur = null
        return
      }
      if (row === cur) return
      glider.style.transform = `translateY(${row.offsetTop}px)`
      glider.style.opacity = '1'
      cur = row
    }
    const onOver = (e: PointerEvent) => {
      if (draggingRef.current) return
      const target = e.target as HTMLElement
      const row = target.closest<HTMLElement>('.qp-row')
      if (row && list.contains(row)) place(row)
    }
    const onLeave = () => place(null)
    const onScroll = () => {
      glider.style.opacity = '0'
      cur = null
    }
    list.addEventListener('pointerover', onOver)
    list.addEventListener('pointerleave', onLeave)
    list.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      list.removeEventListener('pointerover', onOver)
      list.removeEventListener('pointerleave', onLeave)
      list.removeEventListener('scroll', onScroll)
    }
  })

  /* ---- popovers close on an outside pointerdown or Escape ---- */
  useEffect(() => {
    if (!pop) return
    const down = (e: PointerEvent) => {
      if (!(e.target instanceof Node)) return
      if ((e.target as HTMLElement).closest?.('[data-qp-pop]')) return
      setPop(null)
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPop(null)
    }
    document.addEventListener('pointerdown', down)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('pointerdown', down)
      document.removeEventListener('keydown', key)
    }
  }, [pop])

  /* ---- track menu (the plus: queue or a playlist) ---- */
  const [menu, setMenu] = useState<{ track: Track; x: number; y: number } | null>(null)
  useEffect(() => {
    if (!menu) return
    const down = (e: PointerEvent) => {
      if (!(e.target instanceof Node)) return
      if ((e.target as HTMLElement).closest?.('[data-qp-menu]')) return
      setMenu(null)
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenu(null)
    }
    document.addEventListener('pointerdown', down)
    document.addEventListener('keydown', key)
    return () => {
      document.removeEventListener('pointerdown', down)
      document.removeEventListener('keydown', key)
    }
  }, [menu])

  const openTrackMenu = (track: Track, anchor: HTMLElement) => {
    const r = anchor.getBoundingClientRect()
    setMenu({
      track,
      x: Math.max(8, Math.min(r.right - 216, window.innerWidth - 224)),
      y: Math.min(r.bottom + 4, window.innerHeight - 240),
    })
  }

  /* ---- track editor ---- */
  type EditorState = {
    track: Track
    title: string
    artist: string
    lyricsTitle: string
    cover?: string
    provider: string
    source: string
    localTtml: string | null
  }
  const [editor, setEditor] = useState<EditorState | null>(null)
  const [lyricsOpen, setLyricsOpen] = useState(false)

  const openEditor = (track: Track) => {
    const pid = getLastProviderId()
    const provider = pid ? providerById(pid) : undefined
    const source = provider ? `${provider.short} · ${provider.label}` : 'Auto provider chain'
    setEditor({
      track,
      title: track.title,
      artist: track.artist,
      lyricsTitle: getLyricsTitle(track.id) ?? '',
      cover: track.cover,
      provider: source,
      source: 'fetch',
      localTtml: null,
    })
    const id = track.id
    void loadLocalLyrics(String(id)).then((rec) => {
      setEditor((cur) =>
        cur && cur.track.id === id
          ? { ...cur, localTtml: rec?.ttml ?? null, source: rec?.custom ? 'custom' : rec?.source ?? cur.source }
          : cur,
      )
    })
  }

  const saveEditor = () => {
    if (!editor) return
    const t = editor.title.trim()
    if (!t) return
    onEditTrack(editor.track.id, t, editor.artist.trim(), editor.cover)
    setLyricsTitle(editor.track.id, editor.lyricsTitle || null)
    setEditor(null)
    toast('Track details saved')
  }

  const onCoverFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const reader = new FileReader()
    reader.onload = () =>
      setEditor((cur) => (cur ? { ...cur, cover: reader.result as string } : cur))
    reader.readAsDataURL(file)
  }

  /* ---- folders ---- */
  const newPlaylist = () => {
    const id = onCreateFolder()
    setRenamingFolderId(id)
    setQuery('')
    toast('Playlist created')
  }

  const [uploadFolderId, setUploadFolderId] = useState<number | null>(null)
  const pickFiles = (folderId: number) => {
    setUploadFolderId(folderId)
    uploadRef.current?.click()
  }
  const onFilesPicked = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? [])
    e.target.value = ''
    if (uploadFolderId == null) return
    for (const file of files) onUploadFile(uploadFolderId, file)
    if (files.length) toast(`${files.length} track${files.length === 1 ? '' : 's'} added`)
  }

  /* ------------------------------------------------------------------ rows */

  const queueRow = (entry: QueueEntry, index: number) => {
    const { track } = entry
    const canDrag = !q && (entry.nextUpIndex >= 0 || entry.folderIndex >= 0)
    const queued = entry.nextUpIndex >= 0
    return (
      <li
        key={entry.key}
        className={`qp-row${track.id === currentTrackId ? ' qp-cur' : ''}`}
        data-qidx={index}
        data-queued={queued ? 'true' : 'false'}
        tabIndex={0}
      >
        {canDrag ? (
          <span
            className="qp-grip"
            title="Drag to reorder"
            aria-hidden="true"
            onPointerDown={(e) => startDrag(e, index)}
          >
            <GripIcon />
          </span>
        ) : (
          <span className="qp-grip qp-grip-empty" aria-hidden="true" />
        )}
        <Art
          title={track.title}
          cover={track.cover}
          seed={track.id}
          onPlay={() => play(track, playingFolderId ?? undefined)}
        />
        <div className="qp-meta">
          <b>{track.title}</b>
          <i>{track.artist}</i>
        </div>
        <span className="qp-acts">
          <button
            type="button"
            className="qp-ib"
            aria-label={`Edit ${track.title}`}
            title="Edit track"
            onClick={() => openEditor(track)}
          >
            <Icon d={D.pen} />
          </button>
          {track.id !== currentTrackId && (
            <button
              type="button"
              className="qp-ib"
              aria-label={`Remove ${track.title} from the queue`}
              title="Remove from queue"
              onClick={() => removeOne(track)}
            >
              <Icon d={D.x} />
            </button>
          )}
        </span>
      </li>
    )
  }

  const trackRow = (track: Track, folderId: number, allowRemove: boolean) => (
    <li key={track.id} className="qp-row qp-t" data-i={track.id} tabIndex={0}>
      <Art
        title={track.title}
        cover={track.cover}
        seed={track.id}
        onPlay={() => play(track, folderId)}
      />
      <div className="qp-meta">
        {renamingId === track.id ? (
          <RenameField
            initial={track.title}
            onCommit={(value) => commitRename(track, value)}
            onCancel={() => setRenamingId(null)}
          />
        ) : (
          <>
            <b>{track.title}</b>
            <i>{track.artist}</i>
          </>
        )}
      </div>
      <span className="qp-acts">
        <button
          type="button"
          className={`qp-ib${favIds.has(track.id) ? ' qp-fav' : ''}`}
          aria-label={favIds.has(track.id) ? `Remove ${track.title} from favourites` : `Add ${track.title} to favourites`}
          aria-pressed={favIds.has(track.id)}
          title={favIds.has(track.id) ? 'Remove from favourites' : 'Add to favourites'}
          onClick={() => toggleFav(track)}
        >
          <Icon d={D.heart} filled={favIds.has(track.id)} />
        </button>
        <button
          type="button"
          className="qp-ib"
          aria-label={`Edit ${track.title}`}
          title="Edit track"
          onClick={() => openEditor(track)}
        >
          <Icon d={D.pen} />
        </button>
        <button
          type="button"
          className="qp-ib"
          aria-label={`Add ${track.title} to queue or playlist`}
          title="Add to queue or playlist"
          onClick={(e) => openTrackMenu(track, e.currentTarget)}
        >
          <Icon d={D.plus} />
        </button>
        {allowRemove && (
          <button
            type="button"
            className="qp-ib"
            aria-label={`Remove ${track.title} from playlist`}
            title="Remove from playlist"
            onClick={() => {
              onRemoveTrackFromFolder(folderId, track.id)
              toast('Removed from playlist')
            }}
          >
            <Icon d={D.x} />
          </button>
        )}
      </span>
    </li>
  )

  const folderRow = (folder: PlaylistFolder) => {
    const first = folder.trackIds.length ? trackById.get(folder.trackIds[0]) : undefined
    const isDownloadsFolder = folder.id === DOWNLOADS_FOLDER_ID
    const deletable = folder.id !== DOWNLOADS_FOLDER_ID && folder.id !== FAVOURITES_FOLDER_ID
    return (
      <li
        key={folder.id}
        className="qp-row qp-pl"
        data-open={folder.id}
        tabIndex={0}
        onClick={() => openFolderView(folder.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            openFolderView(folder.id)
          }
        }}
      >
        <Art
          title={folder.name}
          cover={folder.image ?? first?.cover}
          seed={first?.id ?? folder.name}
          label={`Open ${folder.name}`}
        />
        <div className="qp-meta">
          {renamingFolderId === folder.id ? (
            <RenameField
              initial={folder.name}
              onCommit={(value) => onRenameFolder(folder.id, value)}
              onCancel={() => setRenamingFolderId(null)}
            />
          ) : (
            <>
              <b onDoubleClick={() => setRenamingFolderId(folder.id)}>{folder.name}</b>
              <i>
                {folder.trackIds.length} track{folder.trackIds.length === 1 ? '' : 's'}
                {folder.id === playingFolderId ? ' · playing' : ''}
              </i>
            </>
          )}
        </div>
        <span className="qp-folder-acts">
          {isDownloadsFolder && (
            <button
              type="button"
              className="qp-ib"
              aria-label="Refresh Downloads Online"
              title="Refresh downloads"
              onClick={(e) => {
                e.stopPropagation()
                onRefreshDownloads()
              }}
            >
              <Icon d={D.refresh} className={`qp-i${refreshingDownloads ? ' qp-spin' : ''}`} />
            </button>
          )}
          <button
            type="button"
            className="qp-ib"
            aria-label={`Add files to ${folder.name}`}
            title="Add files to this playlist"
            onClick={(e) => {
              e.stopPropagation()
              pickFiles(folder.id)
            }}
          >
            <Icon d={D.plus} />
          </button>
          {deletable && (
            <button
              type="button"
              className="qp-ib qp-danger"
              aria-label={`Delete ${folder.name}`}
              title="Delete playlist"
              onClick={(e) => {
                e.stopPropagation()
                onDeleteFolder(folder.id)
                toast('Playlist deleted')
              }}
            >
              <Icon d={D.trash} />
            </button>
          )}
        </span>
        <Icon d={D.back} className="qp-chev" />
      </li>
    )
  }

  /* ----------------------------------------------------------------- views */

  const body = (() => {
    if (tab === 'q') {
      return (
        <div className="qp-view">
          <div className="qp-bar">
            <span className="qp-sp" />
            {nextUpTracks.length > 0 && (
              <button
                type="button"
                className="qp-pill qp-pill-sm"
                onClick={() => {
                  onClearQueue()
                  toast('Queue cleared')
                }}
              >
                Clear
              </button>
            )}
          </div>
          {filteredQueue.length ? (
            <ul className="qp-list" ref={listRef}>
              <li className="qp-glider" aria-hidden="true" />
              {filteredQueue.map((entry, i) => queueRow(entry, i))}
            </ul>
          ) : (
            <div className="qp-empty">
              {q ? `No matches for “${query}”` : 'Nothing queued'}
              {!q && (
                <button type="button" className="qp-pill qp-pill-sm" onClick={() => switchTab('p')}>
                  Browse playlists
                </button>
              )}
            </div>
          )}
        </div>
      )
    }

    if (!openFolder) {
      return (
        <div className="qp-view">
          {q ? null : (
            <div className="qp-bar">
              <span className="qp-sp" />
              <span>{folders.length} playlists</span>
            </div>
          )}
          {folderHits.length || trackHits.length ? (
            <ul className="qp-list" ref={listRef}>
              <li className="qp-glider" aria-hidden="true" />
              {folderHits.length > 0 && (
                <>
                  <li className="qp-lbl">My playlists</li>
                  {folderHits.map(folderRow)}
                </>
              )}
              {trackHits.length > 0 && (
                <>
                  <li className="qp-lbl">Tracks</li>
                  {trackHits.map((t) => (
                    <li key={t.id} className="qp-row qp-t" data-i={t.id} tabIndex={0}>
                      <Art
                        title={t.title}
                        cover={t.cover}
                        seed={t.id}
                        onPlay={() => play(t, playingFolderId ?? undefined)}
                      />
                      <div className="qp-meta">
                        <b>{t.title}</b>
                        <i>
                          {t.artist}
                          {folderNamesByTrack.get(t.id)?.length
                            ? ` · ${folderNamesByTrack.get(t.id)!.join(', ')}`
                            : ''}
                        </i>
                      </div>
                      <span className="qp-acts">
                        <button
                          type="button"
                          className="qp-ib"
                          aria-label={`Edit ${t.title}`}
                          title="Edit track"
                          onClick={() => openEditor(t)}
                        >
                          <Icon d={D.pen} />
                        </button>
                        <button
                          type="button"
                          className="qp-ib"
                          aria-label={`Add ${t.title} to queue or playlist`}
                          title="Add to queue or playlist"
                          onClick={(e) => openTrackMenu(t, e.currentTarget)}
                        >
                          <Icon d={D.plus} />
                        </button>
                      </span>
                    </li>
                  ))}
                </>
              )}
            </ul>
          ) : (
            <div className="qp-empty">No matches for “{query}”</div>
          )}
        </div>
      )
    }

    return (
      <div className="qp-view">
        <div className="qp-bar">
          <button type="button" className="qp-pill qp-pill-sm" onClick={closeFolder}>
            <Icon d={D.back} />
            Playlists
          </button>
          <span className="qp-sp" />
          {isDownloads && (
            <button type="button" className="qp-pill qp-pill-sm qp-icon-pill" onClick={onRefreshDownloads}>
              <Icon d={D.refresh} className={`qp-i${refreshingDownloads ? ' qp-spin' : ''}`} />
              {refreshingDownloads ? 'Refreshing' : 'Refresh'}
            </button>
          )}
          {openTracks.length > 0 && (
            <button type="button" className="qp-pill qp-pill-sm" onClick={addAll}>
              Add all
            </button>
          )}
          <button
            type="button"
            className="qp-pill qp-pill-sm qp-icon-pill"
            onClick={() => openFolder && pickFiles(openFolder.id)}
            title="Add files"
          >
            <Icon d={D.plus} />
            Files
          </button>
        </div>
        {refreshNote && isDownloads && <div className="qp-note">{refreshNote}</div>}
        {visibleFolderTracks.length ? (
          <ul className="qp-list" ref={listRef}>
            <li className="qp-glider" aria-hidden="true" />
            {visibleFolderTracks.map((t) => trackRow(t, openFolder.id, openFolder.id !== DOWNLOADS_FOLDER_ID))}
          </ul>
        ) : (
          <div className="qp-empty">
            {q ? `No matches for “${query}”` : 'No tracks yet'}
            {!q && <span className="qp-hint">Use FILES to add music to this playlist</span>}
          </div>
        )}
      </div>
    )
  })()

  /* ----------------------------------------------------------------- panel */

  return (
    <>
      {!open && (
        <div
          className={`qp-edge${side === 'right' ? ' qp-edge-right' : ''}`}
          onPointerEnter={show}
          aria-hidden="true"
        />
      )}
      <aside
        ref={setAside}
        className={`qp-glass qp-panel qp-side-${side}${away ? ' qp-away' : ''}${open ? '' : ' qp-closed'}${
          framed ? ' qp-framed' : ''
        }`}
        aria-label="Queue and playlists"
        aria-hidden={!open && away}
        style={
          {
            '--qp-w': `${width}px`,
            '--qp-scrim': glass.scrim,
            '--qp-rad': `${glass.radius}px`,
          } as CSSProperties
        }
      >
        <div className="qp-in">
          <header className="qp-head">
            <div>
              <h1>{title}</h1>
              <p>
                {sub}
                {playing && tab === 'q' && queueEntries.length > 0 ? ' · playing' : ''}
              </p>
            </div>
            <div className="qp-head-actions" data-qp-pop>
              {tab === 'p' && !openFolder && (
                <button
                  type="button"
                  className="qp-ib"
                  onClick={newPlaylist}
                  aria-label="New playlist"
                  title="New playlist"
                >
                  <Icon d={D.plus} />
                </button>
              )}
              <button
                type="button"
                className={`qp-ib${pop === 'glass' ? ' qp-on' : ''}`}
                aria-expanded={pop === 'glass'}
                onClick={() => setPop((p) => (p === 'glass' ? null : 'glass'))}
                aria-label="Glass settings"
                title="Glass settings — transparency, blur, refraction, radius"
              >
                <Icon d={D.tune} />
              </button>
              <button
                type="button"
                className="qp-ib qp-pin"
                aria-pressed={pinned}
                onClick={togglePin}
                aria-label="Keep panel open"
                title={pinned ? 'Keep open' : 'Auto-hide when the pointer leaves'}
              >
                <Icon d={D.pin} />
              </button>
            </div>
          </header>

          {pop === 'glass' && (
            <div className="qp-pop" role="group" aria-label="Glass settings" data-qp-pop>
              <h3>Glass settings</h3>
              <div className="qp-range">
                <span>Transparency</span>
                <input
                  type="range"
                  min={0}
                  max={0.7}
                  step={0.01}
                  value={1 - glass.scrim}
                  onChange={(e) => setGlassPref('scrim', 1 - Number(e.target.value))}
                  aria-label="Panel transparency"
                />
                <b>{Math.round((1 - glass.scrim) * 100)}%</b>
              </div>
              <div className="qp-range">
                <span>Blur</span>
                <input
                  type="range"
                  min={0}
                  max={24}
                  step={1}
                  value={glass.blur}
                  onChange={(e) => setGlassPref('blur', Number(e.target.value))}
                  aria-label="Backdrop blur"
                />
                <b>{glass.blur}px</b>
              </div>
              <div className="qp-range">
                <span>Refraction</span>
                <input
                  type="range"
                  min={-180}
                  max={-40}
                  step={4}
                  value={glass.scale}
                  onChange={(e) => setGlassPref('scale', Number(e.target.value))}
                  aria-label="Refraction strength"
                />
                <b>{Math.abs(glass.scale)}</b>
              </div>
              <div className="qp-range">
                <span>Radius</span>
                <input
                  type="range"
                  min={8}
                  max={36}
                  step={1}
                  value={glass.radius}
                  onChange={(e) => setGlassPref('radius', Number(e.target.value))}
                  aria-label="Corner radius"
                />
                <b>{glass.radius}px</b>
              </div>
            </div>
          )}

          <nav
            className="qp-nav"
            data-tab={tab}
            role="tablist"
            aria-label="Queue and playlists"
            onKeyDown={(e) => {
              if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
                e.preventDefault()
                switchTab(tab === 'q' ? 'p' : 'q')
              }
            }}
          >
            <i className="qp-thumb" aria-hidden="true" />
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'q'}
              tabIndex={tab === 'q' ? 0 : -1}
              onClick={() => switchTab('q')}
            >
              Current queue
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'p'}
              tabIndex={tab === 'p' ? 0 : -1}
              onClick={() => switchTab('p')}
            >
              My playlists
            </button>
          </nav>

          {/* search lives ONLY in My playlists — the queue reads top-down,
              a filter box over it was noise */}
          {tab === 'p' && (
            <div className="qp-sbox">
              <SearchIcon />
              <input
                ref={searchRef}
                type="search"
                value={query}
                placeholder="Search playlists, titles, artists"
                aria-label="Search"
                autoComplete="off"
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape' && e.currentTarget.value) {
                    e.currentTarget.value = ''
                    setQuery('')
                  }
                }}
              />
              {query && (
                <button
                  type="button"
                  className="qp-ib"
                  aria-label="Clear search"
                  onClick={() => {
                    setQuery('')
                    searchRef.current?.focus()
                  }}
                >
                  <Icon d={D.x} />
                </button>
              )}
            </div>
          )}

          <div className="qp-body">
            <div key={viewKey} className={`qp-slide-${dir > 0 ? 'right' : 'left'}`}>
              {body}
            </div>
          </div>

          <div className={`qp-toast${toastMsg ? ' qp-show' : ''}`} role="status" aria-live="polite">
            {toastMsg}
          </div>
        </div>

        {editor && (
          <div className="qp-editor" role="dialog" aria-modal="true" aria-label="Edit track">
            <div className="qp-editor-card">
              <div className="qp-editor-head">
                <b>Edit track</b>
                <button type="button" className="qp-ib" onClick={() => setEditor(null)} aria-label="Close editor">
                  <Icon d={D.x} />
                </button>
              </div>

              <label className="qp-field">
                <span>Title</span>
                <input
                  value={editor.title}
                  onChange={(e) => setEditor({ ...editor, title: e.target.value })}
                  spellCheck={false}
                />
              </label>
              <label className="qp-field">
                <span>Artist</span>
                <input
                  value={editor.artist}
                  onChange={(e) => setEditor({ ...editor, artist: e.target.value })}
                  spellCheck={false}
                />
              </label>
              <label className="qp-field">
                <span>Title used for lyrics</span>
                <input
                  value={editor.lyricsTitle}
                  placeholder={editor.title}
                  onChange={(e) => setEditor({ ...editor, lyricsTitle: e.target.value })}
                  spellCheck={false}
                />
              </label>

              <div className="qp-source">
                <span>Lyrics source</span>
                <b>{editor.localTtml ? (editor.source === 'custom' ? 'Custom · saved locally' : editor.source) : editor.provider}</b>
              </div>

              <div className="qp-poster">
                <div className="qp-poster-img">
                  {editor.cover ? (
                    <img src={editor.cover} alt="" />
                  ) : (
                    <span>{editor.title.trim().charAt(0).toUpperCase() || '?'}</span>
                  )}
                </div>
                <div className="qp-poster-btns">
                  <label className="qp-filebtn">
                    <Icon d={D.image} />
                    {editor.cover ? 'Replace poster' : 'Add poster'}
                    <input type="file" accept="image/*" onChange={onCoverFile} />
                  </label>
                  {editor.cover && (
                    <button
                      type="button"
                      className="qp-filebtn qp-filebtn-danger"
                      onClick={() => setEditor({ ...editor, cover: undefined })}
                    >
                      <Icon d={D.trash} />
                      Remove
                    </button>
                  )}
                </div>
              </div>

              <div className="qp-editor-actions">
                <button type="button" className="qp-pill qp-pill-sm" onClick={() => setLyricsOpen(true)}>
                  <Icon d={D.lyrics} />
                  {editor.localTtml ? 'Edit lyrics' : 'Add lyrics'}
                </button>
                <span className="qp-sp" />
                <button type="button" className="qp-pill qp-pill-sm" onClick={() => setEditor(null)}>
                  Cancel
                </button>
                <button type="button" className="qp-pill qp-pill-sm qp-pill-primary" onClick={saveEditor}>
                  <Icon d={D.check} />
                  Save
                </button>
              </div>
            </div>
          </div>
        )}
      </aside>

      <input
        ref={uploadRef}
        type="file"
        accept="audio/*,.mp3,.m4a,.aac,.wav,.flac,.ogg,.opus,.weba"
        multiple
        hidden
        onChange={onFilesPicked}
      />

      {menu && (
        <div
          className="qp-menu"
          data-qp-menu
          role="menu"
          style={{ left: menu.x, top: menu.y }}
          aria-label={`Actions for ${menu.track.title}`}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              onAddToQueue(menu.track.id)
              toast('Added to queue')
              setMenu(null)
            }}
          >
            <Icon d={D.list} />
            Add to queue
          </button>
          <div className="qp-menu-lbl">Add to playlist</div>
          <div className="qp-menu-scroll">
            {folders.filter((f) => f.id !== DOWNLOADS_FOLDER_ID).length === 0 && (
              <span className="qp-menu-empty">No playlists yet</span>
            )}
            {folders
              .filter((f) => f.id !== DOWNLOADS_FOLDER_ID)
              .map((f) => (
                <button
                  key={f.id}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onAddTrackToFolder(f.id, menu.track.id)
                    toast(`Added to ${f.name}`)
                    setMenu(null)
                  }}
                >
                  <Icon d={D.plus} />
                  {f.name}
                </button>
              ))}
          </div>
        </div>
      )}

      {lyricsOpen && editor && (
        <LyricsEditor
          title={editor.title}
          artist={editor.artist}
          localTtml={editor.localTtml}
          onExtract={() => ''}
          onSave={(ttml) => {
            void (async () => {
              await saveLocalLyrics({
                key: String(editor.track.id),
                title: editor.title,
                artist: editor.artist,
                ttml,
                source: 'custom',
                custom: true,
                savedAt: Date.now(),
              })
              setEditor((cur) =>
                cur ? { ...cur, localTtml: ttml, source: 'custom', provider: 'Custom · saved locally' } : cur,
              )
              onLyricsSaved(editor.track.id)
            })()
          }}
          onReset={() => {
            void (async () => {
              await deleteLocalLyrics(String(editor.track.id))
              setEditor((cur) => (cur ? { ...cur, localTtml: null, source: 'fetch' } : cur))
              onLyricsSaved(editor.track.id)
            })()
          }}
          onClose={() => setLyricsOpen(false)}
        />
      )}
    </>
  )
})
