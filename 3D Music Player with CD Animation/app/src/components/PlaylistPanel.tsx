import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  AlignLeft,
  Check,
  ChevronLeft,
  ChevronRight,
  Disc2,
  FolderPlus,
  Heart,
  ListPlus,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  Download,
  X,
} from 'lucide-react'
import { cleanTitle } from '../lib/utils'
import { durationStats, fmt, useDuration } from '../features/playlist/usePlaylist'
import { DOWNLOADS_FOLDER_ID } from '../features/playlist/usePlaylists'
import { type SubscribeTime, type Track } from '../hooks/useAudioEngine'
import { liquidGlass, type LiquidGlassHandle } from '../lib/liquidGlass'

/** How the list is ordered. `manual` is the order the user arranged, so it
 *  is the only one that may be drag-reordered — moving rows inside a sorted
 *  view would silently rewrite the underlying order into something the sort
 *  then disagrees with. */
export type TrackSort = 'manual' | 'title' | 'artist' | 'added'
export type RowDensity = 'compact' | 'comfortable'

interface Props {
  tracks: Track[]
  trackIndex: number
  playing: boolean
  duration: number
  subscribeTime: SubscribeTime
  boot: 'loading' | 'ready' | null
  importing: { total: number; done: number } | null
  importHint: string | null
  /* search/sort/density live in the parent: the list it hands down is the
     list the rest of the app acts on, so filtering here and in Home at once
     would put the two out of step */
  query: string
  onQueryChange: (q: string) => void
  sort: TrackSort
  /** the row size is a fixed choice now (comfortable) — no control */
  density?: RowDensity
  onSelect: (i: number) => void
  onRemove: (i: number) => void
  onEditMeta: (i: number, anchor: DOMRect) => void
  onReorder: (from: number | null, to: number) => void
  onExport: () => void
  onImport: () => void
  onAdd: () => void
  isFavourite: (id: number) => boolean
  onToggleFavourite: (id: number) => void
  /* play-next queue — the per-row icon lights up while a track is queued */
  isNextUp: (id: number) => boolean
  onToggleNext: (i: number) => void
  /* quick-switch chips above the list — switch the viewed playlist without
     opening the drawer at all (the drawer is then only for managing). Each
     chip carries its view's track count for its badge. */
  chips: { id: number | null; name: string; count?: number }[]
  activeChipId: number | null
  onChipSelect: (id: number | null) => void
  onNewChip: () => void
  /* grouping — grouping by artist also fixes the order (a group that shows
     up twice is not a group), so it turns off drag-reordering like a sort
     does. The headers are an overlay pinned to the top of the list, so the
     scrolling stream stays pure rows and the window maths stays exact. */
  groupBy: 'none' | 'artist'
  onGroupByChange: (g: 'none' | 'artist') => void
  /* "add to playlist" lives in the row's own menu, so creating one from a
     track needs no trip through the drawer either */
  playlists: { id: number; name: string; trackIds: number[] }[]
  onAddToPlaylist: (folderId: number, trackId: number) => void
  onNewPlaylistWith: (trackId: number) => void
  /* shown only while the Downloads Online view is active: one click asks the
     extension for everything finished since the last sync pass */
  onRefreshDownloads?: () => void
  /* true while that ask is in flight — the button spins instead of stacking */
  refreshingDownloads?: boolean
  /* what the last pass brought ("+2 ADDED" / "UP TO DATE"), shown briefly
     beside the button so a click is never read as a dead one */
  refreshNote?: string | null
}

/* ---- the menus -------------------------------------------------------
   Every menu the tracklist opens shares ONE surface: the panel's own colour
   as a SOLID fill (no alpha, no backdrop blur), so it stays at full contrast
   over rows, over the sticky group header and over the brightest wallpaper
   frame — a translucent one picks up whatever is behind it and goes
   dark-on-dark. The item text is white/75 against it (≈10:1) with an opaque
   hover/focus fill, and the width is fixed so a label can never truncate into
   a fragment like "LES". */
const MENU_ITEM =
  'flex w-full items-center gap-2 px-2.5 py-1.5 text-left font-mono text-[9px] tracking-[0.15em] text-white/75 transition-colors hover:bg-white/[0.12] hover:text-white focus-visible:bg-white/[0.12] focus-visible:text-white focus-visible:outline-none'
const MENU_DIVIDER = 'my-1 h-px bg-white/[0.12]'

/* A menu that must never be clipped.

   It is portalled to <body> and laid out in FIXED coordinates, because both
   things that host a menu — the panel (`overflow-hidden`) and the row's own
   scroll area (`overflow-y-auto`) — cut an absolutely positioned child the
   moment it reaches past their edge. The box is measured on every render,
   dropped below its anchor unless there is no room (then flipped above), and
   clamped to the viewport, so it opens fully visible at any scroll position
   and at both ends of the list.

   The position is written straight into the node rather than through state:
   the layout effect runs before paint, so the first frame is already right,
   and a setState here would be a frame late (and trip set-state-in-effect). */
function FloatingMenu({
  anchor,
  width = 216,
  align = 'right',
  ignore,
  onClose,
  children,
}: {
  /** where the menu hangs from — the trigger's rect, or a point at the pointer */
  anchor: DOMRect
  /** fixed width; wide enough that no label is cut into a fragment */
  width?: number
  /** 'right' lines the menu's right edge up with the trigger, 'left' hangs it off the pointer's x */
  align?: 'right' | 'left'
  /** the trigger itself — clicking it must toggle, not be read as "outside" */
  ignore?: React.RefObject<HTMLElement | null>
  onClose: () => void
  children: React.ReactNode
}) {
  const boxRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const el = boxRef.current
    if (!el) return
    el.style.visibility = 'hidden'
    const w = Math.min(width, window.innerWidth - 16)
    el.style.width = `${w}px`
    const h = el.offsetHeight
    /* below unless there is not enough room, above unless THAT is worse */
    const roomBelow = window.innerHeight - anchor.bottom - 8
    const roomAbove = anchor.top - 8
    const top =
      roomBelow >= h || roomBelow >= roomAbove ? anchor.bottom + 4 : anchor.top - 4 - h
    const left = align === 'right' ? anchor.right - w : anchor.left
    el.style.left = `${Math.max(8, Math.min(left, window.innerWidth - w - 8))}px`
    el.style.top = `${Math.max(8, Math.min(top, window.innerHeight - h - 8))}px`
    el.style.visibility = 'visible'
  })

  useEffect(() => {
    /* `target` is not always a Node: a resize is dispatched ON window, and
       Node.contains(window) throws a TypeError that takes the whole app down.
       Guard every hit test — one stray throw here is a white window. */
    const hit = (t: EventTarget | null) => t instanceof Node && !!boxRef.current?.contains(t)
    const down = (e: MouseEvent) => {
      if (hit(e.target)) return
      if (e.target instanceof Node && ignore?.current?.contains(e.target)) return
      onClose()
    }
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    /* a scroll or a resize leaves the box where the anchor no longer is —
       close it rather than let it float detached over other rows. Scrolling
       INSIDE the menu is not that: it is read, not a dismissal. */
    const away = (e: Event) => {
      if (hit(e.target)) return
      onClose()
    }
    document.addEventListener('mousedown', down)
    document.addEventListener('keydown', key)
    window.addEventListener('resize', away)
    window.addEventListener('scroll', away, true)
    return () => {
      document.removeEventListener('mousedown', down)
      document.removeEventListener('keydown', key)
      window.removeEventListener('resize', away)
      window.removeEventListener('scroll', away, true)
    }
  })

  return createPortal(
    <div
      ref={boxRef}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
      style={{ position: 'fixed', left: anchor.right, top: anchor.bottom, width }}
      className="menu-surface z-[300] max-h-[min(60vh,320px)] overflow-y-auto rounded-md py-1 shadow-[0_18px_46px_rgba(0,0,0,0.72)]"
    >
      {children}
    </div>,
    document.body,
  )
}

/* Tracklist: a glass panel holding the toolbar and a fixed-height scroll
   area. Owns the view-side drag state (which row is hovered, auto-scroll-at-
   edges, smooth wheel) — the actual array reorder is delegated to the
   feature hook. */
export default function PlaylistPanel({
  tracks,
  trackIndex,
  playing,
  duration,
  subscribeTime,
  boot,
  importing,
  importHint,
  query,
  onQueryChange,
  sort,
  density = 'comfortable',
  onSelect,
  onRemove,
  onEditMeta,
  onReorder,
  onExport,
  onImport,
  onAdd,
  isFavourite,
  onToggleFavourite,
  isNextUp,
  onToggleNext,
  chips,
  activeChipId,
  onChipSelect,
  onNewChip,
  groupBy,
  onGroupByChange,
  playlists,
  onAddToPlaylist,
  onNewPlaylistWith,
  onRefreshDownloads,
  refreshingDownloads = false,
  refreshNote = null,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const smoothRef = useRef<{ target: number; raf: number } | null>(null)

  /* ---- the chips row's edge arrows ----
     The row pans; the playlists do not change. The left arrow exists only
     once the row has been scrolled right (chips hidden behind it), the right
     one only while chips are still hidden ahead — and when everything fits,
     neither is in the DOM. Reads are coalesced to one rAF, like the list's
     own scroll pass. */
  const chipsRef = useRef<HTMLDivElement>(null)
  const [chipArrows, setChipArrows] = useState({ left: false, right: false })
  useEffect(() => {
    const box = chipsRef.current
    if (!box) return
    let raf = 0
    const read = () => {
      raf = 0
      setChipArrows({
        left: box.scrollLeft > 4,
        right: box.scrollLeft + box.clientWidth < box.scrollWidth - 4,
      })
    }
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(read)
    }
    schedule()
    box.addEventListener('scroll', schedule, { passive: true })
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule)
    ro?.observe(box)
    return () => {
      box.removeEventListener('scroll', schedule)
      ro?.disconnect()
      if (raf) cancelAnimationFrame(raf)
    }
  }, [chips])
  const panChips = useCallback((dir: number) => {
    chipsRef.current?.scrollBy({ left: dir * 260, behavior: 'smooth' })
  }, [])

  /* ---- scroll-to-blur, HEADER ONLY ----
     The wheel over the chips/search region tunes the header's own blur
     (0–20px); preventDefault keeps that wheel from scrolling anything else.
     The listener lives on the header container alone — the wheel over the
     rows never reaches it, so the list scrolls exactly as before. */
  const headerRef = useRef<HTMLDivElement>(null)
  const [headerBlur, setHeaderBlur] = useState(0)
  useEffect(() => {
    const el = headerRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const step = e.deltaY > 0 ? -3 : 3
      setHeaderBlur((b) => Math.round(Math.min(20, Math.max(0, b + step)) * 10) / 10)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  /* the view's total length, from durations the rows have already probed */
  const durStats = useMemo(
    () => durationStats(tracks.map((t) => t.src)),
    [tracks],
  )
  const dragIndex = useRef<number | null>(null)
  /* the panel's own liquid glass, in PASSIVE mode: the filter + map live in
     the lib, but the backdrop-filter STRING is composed here — one writer.
     The scroll frost tunes the same property (the wheel over the header),
     so it composes the refraction url with its own blur instead of
     overwriting the lib's value. */
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [glass, setGlass] = useState<{ filterUrl: string; blur: number; saturate: number } | null>(null)
  const glassHandleRef = useRef<LiquidGlassHandle | null>(null)
  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const g = liquidGlass(el, { attach: false, scale: -64, chroma: 3, blur: 2, saturate: 1.3, fallbackBlur: 16 })
    glassHandleRef.current = g
    setGlass({ filterUrl: g.filterUrl, blur: g.blur, saturate: g.saturate })
    return () => {
      glassHandleRef.current = null
      g.destroy()
    }
  }, [])
  const [dragOver, setDragOver] = useState<number | null>(null)
  /* which chip is under the dragged row */
  const [chipOver, setChipOver] = useState<number | null>(null)
  /* mirror of dragIndex for render — refs must not be read during render */
  const [dragging, setDragging] = useState(false)
  /* the row that has been lifted (its slot parks as the placeholder) and
     the ghost that flies with the cursor — see the pointer drag effect */
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null)
  const [ghost, setGhost] = useState<{ index: number; width: number; height: number } | null>(null)
  const ghostRef = useRef<HTMLDivElement | null>(null)
  /* the drag effect runs listener-free of renders: it reads the latest
     list and callbacks through refs instead of re-binding mid-drag */
  const tracksRef = useRef(tracks)
  useEffect(() => {
    tracksRef.current = tracks
  }, [tracks])
  const onReorderRef = useRef(onReorder)
  useEffect(() => {
    onReorderRef.current = onReorder
  }, [onReorder])
  const onAddToPlaylistRef = useRef(onAddToPlaylist)
  useEffect(() => {
    onAddToPlaylistRef.current = onAddToPlaylist
  }, [onAddToPlaylist])
  /* multi-select: track ids, so reordering and filtering never move a row
     out from under the selection. The anchor is the row shift-click started
     from, which is what makes a range mean "from there to here". */
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<number>>(() => new Set())
  const anchorRef = useRef<number | null>(null)
  /* right-click menu — portalled to the body so the panel's overflow cannot
     clip it, positioned at the pointer */
  const [ctx, setCtx] = useState<{ x: number; y: number; index: number } | null>(null)

  /* ---- the window: only the rows near the viewport are in the DOM ----
     A 5,000-track library used to render 5,000 rows; now it renders about a
     screen and a half, and the spacers above and below keep the scrollbar
     (and every scroll calculation) honest. The row height is MEASURED from a
     real row rather than assumed, because the spacers only line up if it is
     exact. */
  const [rowH, setRowH] = useState(density === 'compact' ? 44 : 60)
  const [win, setWin] = useState({ start: 0, end: 80 })
  const rangeRef = useRef({ start: 0, end: 80 })
  /* rows animate in on the first paint only: a virtualized list mounts rows
     constantly, and replaying the entrance on every scroll reads as flicker */
  const [firstPaint, setFirstPaint] = useState(true)
  const scrolledRef = useRef(false)

  /* the runs this view is grouped into — consecutive rows with the same
     artist become one group with one sticky header */
  const runs = useMemo(() => {
    if (groupBy === 'none') return [] as { key: string; from: number; to: number }[]
    const out: { key: string; from: number; to: number }[] = []
    tracks.forEach((t, i) => {
      const key = (t.artist || '—').trim()
      const last = out[out.length - 1]
      if (last && last.key === key) last.to = i + 1
      else out.push({ key, from: i, to: i + 1 })
    })
    return out
  }, [tracks, groupBy])

  /* which group the first visible row belongs to */
  const groupAt = useCallback(
    (i: number): string => {
      if (!runs.length) return ''
      let lo = 0
      let hi = runs.length - 1
      let found = runs[0]
      while (lo <= hi) {
        const mid = (lo + hi) >> 1
        if (runs[mid].from <= i) {
          found = runs[mid]
          lo = mid + 1
        } else hi = mid - 1
      }
      return found.key
    },
    [runs],
  )

  const applyWindow = useCallback(
    (start: number, end: number) => {
      const s = Math.max(0, Math.min(start, Math.max(0, tracks.length - 1)))
      const e = Math.max(s, Math.min(end, tracks.length))
      const r = rangeRef.current
      if (r.start === s && r.end === e) return false
      rangeRef.current = { start: s, end: e }
      setWin({ start: s, end: e })
      return true
    },
    [tracks.length],
  )

  /* measure a real row — the spacer heights must match the rows exactly.
     Done as a ref callback rather than an effect: it runs on commit, so the
     measurement lands in the same paint instead of one frame later. */
  const measureRow = useCallback(
    (el: HTMLElement | null) => {
      const h = el?.offsetHeight
      if (h && Math.abs(h - rowH) > 0.5) setRowH(h)
    },
    [rowH],
  )

  /* keep the window under the thumb as the list scrolls. Coalesced to ONE
     rAF like the resize pass below: scroll events can arrive more than once
     per frame, and each one that moved the window used to re-render the
     whole mounted range — the lag on a fast fling through a big library. */
  useEffect(() => {
    const box = scrollRef.current
    if (!box) return
    let raf = 0
    /* hover-reveal suppression: while the list is scrolling the cursor rides
       OVER rows, and every one it crosses would pop its actions open. A
       timestamp on the container says "recently scrolled" and the CSS keeps
       the reveals off until the scroll has truly settled. */
    let scrollSettle = 0
    const markScrolling = () => {
      box.dataset.scrolling = '1'
      window.clearTimeout(scrollSettle)
      scrollSettle = window.setTimeout(() => {
        delete box.dataset.scrolling
      }, 320)
    }
    const update = () => {
      raf = 0
      markScrolling()
      const h = rowH || 1
      /* overscan — 8 rows left thin blanks at the fast end of a fling; 12
         keeps a margin without making the mounted range heavy */
      const pad = 12
      let start = Math.max(0, Math.floor(box.scrollTop / h) - pad)
      let end = Math.min(tracks.length, Math.ceil((box.scrollTop + box.clientHeight) / h) + pad)
      /* the dragged row's slot must stay mounted wherever the drag goes —
         the pointer drag parks it as the placeholder and hits rows with
         elementFromPoint, so the element cannot be allowed to unmount
         mid-flight when auto-scroll carries the view away from it */
      const dragged = dragIndex.current
      if (dragged != null) {
        start = Math.min(start, dragged)
        end = Math.max(end, dragged + 1)
      }
      applyWindow(start, end)
      if (!scrolledRef.current && box.scrollTop > 2) {
        scrolledRef.current = true
        setFirstPaint(false)
      }
    }
    const onScroll = () => {
      if (raf) return
      raf = requestAnimationFrame(update)
    }
    update()
    box.addEventListener('scroll', onScroll, { passive: true })
    /* the list is flex-1 now, so it also grows and shrinks with the WINDOW —
       and that never fires a scroll event. Without this the rows below the
       old window never mounted and a resized list showed blank space.

       Coalesced to ONE rAF: a resize observer can fire more than once per
       frame, and each pass sets state. It is also only ever read against a
       container whose height does NOT depend on how many rows are mounted —
       a content-sized one fed its own output straight back in. */
    const onResize = () => {
      if (raf) return
      raf = requestAnimationFrame(update)
    }
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(onResize)
    ro?.observe(box)
    return () => {
      box.removeEventListener('scroll', onScroll)
      ro?.disconnect()
      if (raf) cancelAnimationFrame(raf)
      window.clearTimeout(scrollSettle)
      delete box.dataset.scrolling
    }
  }, [rowH, tracks.length, applyWindow])
  /* active-row progress is written straight into the row's bar — the 4Hz
     timeupdate must never re-render this panel (a tick measured ~44ms of
     script). On track change every bar resets first, then the immediately
     sync'd tick repaints the new active row. */
  useEffect(() => {
    scrollRef.current?.querySelectorAll<HTMLElement>('[data-progress]').forEach((b) => {
      b.style.transform = 'scaleX(0)'
    })
    return subscribeTime((t) => {
      const bar = scrollRef.current?.querySelector<HTMLElement>('[data-active="true"] [data-progress]')
      /* scaleX, not width: the width of an absolutely-positioned bar is a
         layout write on every tick of the clock, a transform is only paint */
      if (bar) bar.style.transform = `scaleX(${duration ? Math.min(1, t / duration) : 0})`
    })
  }, [subscribeTime, duration, trackIndex])

  /* keep the active row visible when the track changes (next/prev/select).
     Keyed on the active track's ID, not its index: a deletion above the
     active row shifts indices without changing tracks, and re-running on
     that alone dragged the list back to a centred row ("delete jumped me to
     the top"). Same track → the view is left exactly where it was.

     rect math + the wheel-easing loop instead of scrollIntoView: smooth
     scrollIntoView could be silently raced by an in-flight wheel ease (its
     stale target drags scrollTop straight back), and 'nearest' only ever
     parked rows at the edge — centering makes long lists actually track */
  const activeTrackId = trackIndex >= 0 ? (tracks[trackIndex]?.id ?? null) : null

  /* scroll so row `i` sits in the middle of the list — arithmetic, not
     element rects, because with a window over the rows the element usually
     does not exist yet when this is asked for */
  const lastCenteredIdRef = useRef<number | null>(null)
  const centerOn = useCallback(
    (i: number) => {
      const box = scrollRef.current
      if (!box || i < 0) return
      const h = rowH || 1
      const maxScroll = Math.max(0, tracks.length * h - box.clientHeight)
      const target = Math.max(0, Math.min(maxScroll, i * h - (box.clientHeight - h) / 2))
      if (Math.abs(box.scrollTop - target) < 4) return
      const st = smoothRef.current ?? (smoothRef.current = { target: box.scrollTop, raf: 0 })
      if (st.raf) cancelAnimationFrame(st.raf)
      st.target = target
      const step = () => {
        const s = smoothRef.current!
        const d = s.target - box.scrollTop
        if (Math.abs(d) < 1) {
          box.scrollTop = s.target
          s.raf = 0
          return
        }
        box.scrollTop += d * 0.16
        s.raf = requestAnimationFrame(step)
      }
      st.raf = requestAnimationFrame(step)
    },
    [rowH, tracks.length],
  )

  useEffect(() => {
    if (trackIndex < 0) return
    /* GUARD: re-center only when the SONG actually changes. The effect's
     * dependencies include `centerOn` (rebuilt when rowH is re-measured or
     * the list length changes) — both can happen mid-scroll, and re-running
     * then yanked the view to the active row: the "jerk backward" while
     * flinging through a long library. An unchanged id means the user owns
     * the scroll position; leave it exactly where it is. */
    if (lastCenteredIdRef.current === activeTrackId) return
    lastCenteredIdRef.current = activeTrackId
    /* the row may not be in the DOM at all — a window over 5,000 rows usually
       does not contain it. The window itself is widened during render (see
       `view` below); this only scrolls once those spacers exist. */
    const r = rangeRef.current
    if (trackIndex < r.start || trackIndex >= r.end) {
      requestAnimationFrame(() => centerOn(trackIndex))
      return
    }
    centerOn(trackIndex)
  }, [activeTrackId, trackIndex, centerOn])

  /* smooth wheel scrolling for the playlist */
  useEffect(() => {
    const box = scrollRef.current
    if (!box) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const st = smoothRef.current ?? (smoothRef.current = { target: box.scrollTop, raf: 0 })
      st.target = Math.max(0, Math.min(box.scrollHeight - box.clientHeight, st.target + e.deltaY))
      if (!st.raf) {
        const step = () => {
          const s = smoothRef.current!
          const d = s.target - box.scrollTop
          if (Math.abs(d) < 1) {
            box.scrollTop = s.target
            s.raf = 0
            return
          }
          box.scrollTop += d * 0.16
          s.raf = requestAnimationFrame(step)
        }
        st.raf = requestAnimationFrame(step)
      }
    }
    box.addEventListener('wheel', onWheel, { passive: false })
    return () => {
      box.removeEventListener('wheel', onWheel)
      if (smoothRef.current?.raf) cancelAnimationFrame(smoothRef.current.raf)
    }
  }, [])

  /* a sorted or grouped view is a view, not an order — see TrackSort */
  const reorderable = sort === 'manual' && groupBy === 'none'

  /* ── the row drag: pointer events, not HTML5 drag-and-drop ──────────────
     Native DnD stutters here by construction: the drag ghost is composited
     out of process and lags the cursor, and dragenter/dragover arrive at
     the browser's own whim (irregular, throttled), so the reorder read as
     the row fighting the UI. Instead the drag is owned entirely by this
     panel: pointer capture on the row, a rAF loop that writes one
     translate3d per frame to a floating ghost (compositor work only —
     never layout), the landing marker and the playlist chips hit-tested
     with elementFromPoint (the ghost is pointer-events: none, so the test
     always reads the rows underneath). A 5px threshold keeps clicks
     clicks; auto-scroll eases at the edges on the same rAF. */
  useEffect(() => {
    if (!reorderable) return
    const box = scrollRef.current
    if (!box) return

    type Drag = {
      id: number
      index: number
      startX: number
      startY: number
      offX: number
      offY: number
      x: number
      y: number
      raf: number
      live: boolean
      hover: number
      chip: number | null
    }
    let ptr: Drag | null = null
    let suppressClickAt = 0

    const frame = () => {
      if (!ptr || !ptr.live) return
      ptr.raf = 0
      const r = box.getBoundingClientRect()
      /* edge auto-scroll first: the scroll moves the content under the
         cursor and the marker arithmetic below follows on the next frame.
         Speed scales with how deep the cursor is past the edge. */
      let over = 0
      if (ptr.y < r.top + 44) over = ptr.y - (r.top + 44)
      else if (ptr.y > r.bottom - 44) over = ptr.y - (r.bottom - 44)
      if (over) box.scrollTop += Math.max(-11, Math.min(11, over * 0.25))

      /* the ghost rides the cursor (the CSS keeps it at opacity 0 until
         this loop has put it under the pointer — no flash at 0,0) */
      if (ghostRef.current) {
        ghostRef.current.style.transform = `translate3d(${ptr.x - ptr.offX}px, ${ptr.y - ptr.offY}px, 0)`
        ghostRef.current.style.opacity = '1'
      }

      /* what is under the cursor: the ghost and the parked row are both
         transparent to the test, so this reads the rows underneath */
      const hit = document.elementFromPoint(ptr.x, ptr.y)
      const chipEl = hit?.closest<HTMLElement>('[data-chip-id]')
      const chip = chipEl ? Number(chipEl.dataset.chipId) : null
      const chipNow = chip != null && Number.isFinite(chip) ? chip : null
      if (chipNow !== ptr.chip) {
        ptr.chip = chipNow
        setChipOver(chipNow)
      }
      if (chipNow == null) {
        const rowEl = hit?.closest<HTMLElement>('[data-row-index]')
        const hover = rowEl ? Number(rowEl.dataset.rowIndex) : -1
        if (hover !== ptr.hover) {
          ptr.hover = hover
          setDragOver(hover >= 0 ? hover : null)
        }
      }
      ptr.raf = requestAnimationFrame(frame)
    }

    const lift = (d: Drag, el: HTMLElement) => {
      const r = el.getBoundingClientRect()
      d.offX = d.startX - r.left
      d.offY = d.startY - r.top
      d.live = true
      dragIndex.current = d.index
      try {
        el.setPointerCapture(d.id)
      } catch {
        /* detached between down and lift — the window listeners carry it */
      }
      document.body.classList.add('row-dragging')
      setDragging(true)
      setDraggedIdx(d.index)
      setDragOver(d.index)
      setGhost({ index: d.index, width: r.width, height: r.height })
      d.raf = requestAnimationFrame(frame)
    }

    const land = (commit: boolean) => {
      if (!ptr) return
      if (ptr.raf) cancelAnimationFrame(ptr.raf)
      document.body.classList.remove('row-dragging')
      if (commit && ptr.live) {
        const from = dragIndex.current
        const t = from != null ? tracksRef.current[from] : null
        if (ptr.chip != null && t) onAddToPlaylistRef.current(ptr.chip, t.id)
        else if (t && ptr.hover >= 0 && ptr.hover !== from) onReorderRef.current(from, ptr.hover)
        suppressClickAt = Date.now()
      }
      dragIndex.current = null
      setDragging(false)
      setDraggedIdx(null)
      setDragOver(null)
      setChipOver(null)
      setGhost(null)
      ptr = null
    }

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || e.pointerType !== 'mouse') return
      const target = e.target instanceof Element ? e.target : null
      const rowEl = target?.closest<HTMLElement>('[data-row-index]')
      if (!rowEl) return
      /* the row's own controls keep their clicks — a drag starts on the
         row itself, never on a button living in it */
      if (target?.closest('button, input, a, textarea')) return
      const idx = Number(rowEl.dataset.rowIndex)
      if (!Number.isFinite(idx)) return
      ptr = {
        id: e.pointerId,
        index: idx,
        startX: e.clientX,
        startY: e.clientY,
        offX: 0,
        offY: 0,
        x: e.clientX,
        y: e.clientY,
        raf: 0,
        live: false,
        hover: idx,
        chip: null,
      }
    }
    const onMove = (e: PointerEvent) => {
      if (!ptr || e.pointerId !== ptr.id) return
      ptr.x = e.clientX
      ptr.y = e.clientY
      if (!ptr.live) {
        if (Math.abs(e.clientX - ptr.startX) < 5 && Math.abs(e.clientY - ptr.startY) < 5) return
        const el = document.querySelector<HTMLElement>(`[data-row-index="${ptr.index}"]`)
        if (el) lift(ptr, el)
        else ptr = null
        return
      }
      if (!ptr.raf) ptr.raf = requestAnimationFrame(frame)
    }
    const onUp = (e: PointerEvent) => {
      if (ptr && e.pointerId === ptr.id) land(true)
    }
    const onCancel = (e: PointerEvent) => {
      if (ptr && e.pointerId === ptr.id) land(false)
    }
    /* the click a drag ends on must not play the row it landed on */
    const onClickCapture = (e: MouseEvent) => {
      if (Date.now() - suppressClickAt < 250) {
        e.stopPropagation()
        e.preventDefault()
      }
    }

    box.addEventListener('pointerdown', onDown)
    window.addEventListener('pointermove', onMove, { passive: true })
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    box.addEventListener('click', onClickCapture, true)
    return () => {
      box.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      box.removeEventListener('click', onClickCapture, true)
      if (ptr?.raf) cancelAnimationFrame(ptr.raf)
      if (ptr?.live) {
        document.body.classList.remove('row-dragging')
        dragIndex.current = null
      }
      ptr = null
    }
  }, [reorderable])
  const onContextAt = useCallback((index: number, x: number, y: number) => {
    setCtx({ x, y, index })
  }, [])

  /* a plain click plays and clears the selection; the modifiers build one */
  const onRowClick = useCallback(
    (index: number, e: React.MouseEvent) => {
      const t = tracks[index]
      if (!t) return
      if (e.shiftKey && anchorRef.current != null) {
        const [from, to] =
          anchorRef.current < index ? [anchorRef.current, index] : [index, anchorRef.current]
        setSelectedIds(new Set(tracks.slice(from, to + 1).map((x) => x.id)))
        return
      }
      if (e.ctrlKey || e.metaKey) {
        setSelectedIds((prev) => {
          const next = new Set(prev)
          if (next.has(t.id)) next.delete(t.id)
          else next.add(t.id)
          return next
        })
        anchorRef.current = index
        return
      }
      anchorRef.current = index
      setSelectedIds(new Set())
      onSelect(index)
    },
    [tracks, onSelect],
  )

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set())
    anchorRef.current = null
  }, [])

  /* the selection bar and the context menu act on the whole selection when
     the right-clicked row is part of one, and on that row alone otherwise */
  const targetsFor = useCallback(
    (index: number): { index: number; id: number }[] => {
      const t = tracks[index]
      if (!t) return []
      if (selectedIds.size > 1 && selectedIds.has(t.id)) {
        return tracks
          .map((x, i) => ({ index: i, id: x.id }))
          .filter((x) => selectedIds.has(x.id))
      }
      return [{ index, id: t.id }]
    },
    [tracks, selectedIds],
  )

  const removeMany = useCallback(
    (items: { index: number }[]) => {
      /* highest index first: removing a row shifts every index after it */
      [...items].sort((a, b) => b.index - a.index).forEach((x) => onRemove(x.index))
      clearSelection()
    },
    [onRemove, clearSelection],
  )

  const queueMany = useCallback(
    (items: { index: number }[]) => {
      items.forEach((x) => onToggleNext(x.index))
      clearSelection()
    },
    [onToggleNext, clearSelection],
  )

  const addManyTo = useCallback(
    (folderId: number, items: { id: number }[]) => {
      items.forEach((x) => onAddToPlaylist(folderId, x.id))
      clearSelection()
    },
    [onAddToPlaylist, clearSelection],
  )

  const selectedCount = selectedIds.size
  /* the selection bar's own menu: every playlist, one click each */
  const [barAddAnchor, setBarAddAnchor] = useState<DOMRect | null>(null)
  const barAddRef = useRef<HTMLButtonElement>(null)

  /* the search reveal — open lives here, the query lives in Home */
  const [searchOpen, setSearchOpen] = useState(false)

  /* the window actually rendered: whatever the scroll has asked for, WIDENED
     during render to also hold the playing row. Widening here rather than in
     an effect keeps the current row reachable without a second commit — the
     old code scrolled a row that was not in the DOM, found nothing, and left
     the list showing rows nobody asked for.

     The widened range must be the UNION of the scroll window and the playing
     row's neighbourhood, never a replacement for it: the rows a replacement
     drops are not drawn, but their height still goes into the spacer below
     the list, so scrolling past them landed in a screenful of nothing. And
     when the playing row is thousands of rows away, mounting everything in
     between is worse than not having it — there the scroll window simply
     wins, and the row is mounted again when it scrolls into reach (or when a
     track change centres on it). */
  const view = useMemo(() => {
    if (trackIndex < 0 || (trackIndex >= win.start && trackIndex < win.end)) return win
    const start = Math.min(win.start, Math.max(0, trackIndex - 12))
    const end = Math.max(win.end, Math.min(tracks.length, trackIndex + 24))
    if (end - start > 240) return win
    return { start, end }
  }, [win, trackIndex, tracks.length])
  const head = runs.length > 0 ? groupAt(view.start) : ''
  const headRun = head ? runs.find((r) => r.key === head) : null

  return (
    <div
      ref={rootRef}
      className="glass-panel fx-blur tracklist-glass mt-6 flex min-h-[200px] flex-1 flex-col overflow-hidden rounded-2xl border border-white/10 bg-black/45 shadow-[0_18px_56px_rgba(0,0,0,0.55),inset_0_1px_0_rgba(255,255,255,0.07)] backdrop-blur-[20px]"
      style={
        glass
          ? {
              /* ONE writer: the refraction url is always in the chain; the
                 scroll frost swaps its blur part while the wheel is over the
                 header and restores the resting blur at level 0. */
              backdropFilter:
                headerBlur > 0
                  ? `${glass.filterUrl} blur(${headerBlur}px) saturate(${glass.saturate})`
                  : `${glass.filterUrl} blur(${glass.blur}px) saturate(${glass.saturate})`,
              backgroundColor: headerBlur > 0 ? 'rgba(255, 255, 255, 0.05)' : undefined,
            }
          : headerBlur > 0
            ? {
                /* the WHOLE panel frosts, not just the header: the wheel over
                   the header tunes one level (0–20) and the ROOT's background
                   and blur follow it — header and list reveal the wallpaper
                   together. Level 0 paints nothing: the default glass below. */
                backdropFilter: `blur(${headerBlur}px)`,
                WebkitBackdropFilter: `blur(${headerBlur}px)`,
                backgroundColor: 'rgba(255, 255, 255, 0.05)',
              }
            : undefined
      }
    >
      {/* the header: chips, then the search/sort row, then the view's numbers —
          one region whose transparency is tuned by SCROLLING ON IT. The wheel
          over the header adjusts its blur (0–20px); the wheel over the list
          below is the list's own scrolling and is never touched. */}
      <div
        ref={headerRef}
        className="relative z-[1]"
      >
      {/* quick-switch as SCROLLABLE TABS: every playlist one tab away, its
          tracks under it. Tabs, not pill chips — the underline carries the
          selection, the strip scrolls when a library outgrows the panel, and
          the edge arrows pan it. While a row is being dragged the tabs are
          still drop targets (drag a track onto a tab). */}
      <div className="relative flex items-center border-b border-white/[0.08]">
        {chipArrows.left && (
          <button
            onClick={() => panChips(-1)}
            aria-label="Scroll playlists left"
            title="More playlists behind"
            className="absolute left-1 z-10 grid h-6 w-6 place-items-center rounded-full border border-white/15 bg-black/75 text-white/60 backdrop-blur-sm transition hover:border-white/40 hover:text-white"
          >
            <ChevronLeft size={11} />
          </button>
        )}
        <div
          ref={chipsRef}
          className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto px-2 [scrollbar-width:none]"
        >
        {chips
          .filter((c) => c.id != null)
          .map((c) => {
          const on = c.id === activeChipId
          const dropOn = dragging && chipOver === c.id && c.id != null
          return (
            <button
              key={c.id ?? 'all'}
            onClick={() => {
              /* a different view is a different selection */
              clearSelection()
              setCtx(null)
              onChipSelect(c.id)
            }}
              data-chip-id={c.id ?? undefined}
              className={`group/tab relative shrink-0 px-3 pb-2 pt-2.5 font-mono text-[10px] tracking-[0.14em] transition-colors duration-200 ${
                on ? 'text-white' : 'text-white/45 hover:text-white/85'
              } ${dropOn ? 'text-emerald-200' : ''}`}
              title={`Show ${c.name} — drop a track to add it`}
            >
              {c.name}
              {c.count != null && (
                <span className={`ml-1.5 tabular-nums ${on ? 'text-white/55' : 'text-white/30'}`}>{c.count}</span>
              )}
              {/* the selection: one underline, lit with the art's accents —
                  it slides in on selection and reads as the tab's edge */}
              <span
                aria-hidden
                className={`absolute inset-x-2 bottom-0 h-[2px] rounded-full transition-opacity duration-200 ${
                  on || dropOn ? 'opacity-100' : 'opacity-0 group-hover/tab:opacity-60'
                }`}
                style={
                  dropOn
                    ? { background: 'rgba(110, 231, 183, 0.9)' }
                    : {
                        background:
                          'linear-gradient(90deg,var(--accent-a,#7dd8ff),var(--accent-b,#c99cff),var(--accent-a,#ff9dd8))',
                      }
                }
              />
            </button>
          )
          })}
        <button
          onClick={onNewChip}
          aria-label="New playlist"
          title="New playlist"
          className="grid h-7 w-7 shrink-0 place-items-center rounded-full border border-white/[0.14] bg-white/[0.04] text-white/50 transition hover:border-white/30 hover:text-white"
        >
          <Plus size={11} />
        </button>
        </div>
        {chipArrows.right && (
          <button
            onClick={() => panChips(1)}
            aria-label="Scroll playlists right"
            title="More playlists ahead"
            className="absolute right-1 z-10 grid h-6 w-6 place-items-center rounded-full border border-white/15 bg-black/75 text-white/60 backdrop-blur-sm transition hover:border-white/40 hover:text-white"
          >
            <ChevronRight size={11} />
          </button>
        )}
      </div>

      {/* ONE row of controls — [search] [sort ▾] [density] [⋯] — all h-8,
          equal gaps, right-aligned, never wrapping. Nothing floats on a row
          of its own: add / import / export / group live inside the ⋯ menu. */}
      <div
        className="relative flex flex-nowrap items-center justify-end gap-2 border-b border-white/10 px-3 py-2"
      >
        {boot === 'loading' && (
          <span className="mr-auto flex shrink-0 items-center gap-1.5 font-mono text-[8px] tracking-[0.15em] text-white/40">
            <Disc2 size={9} className="animate-spin" style={{ animationDuration: '1.6s' }} />
            LOADING
          </span>
        )}
        {importing && (
          <span className="mr-auto flex shrink-0 items-center gap-1.5 font-mono text-[8px] tracking-[0.15em] text-amber-300">
            <Disc2 size={9} className="animate-pulse" />
            READING {importing.done}/{importing.total}
          </span>
        )}
        {importHint && (
          <span className="mr-auto max-w-[180px] truncate shrink-0 font-mono text-[8px] tracking-[0.12em] text-cyan-300/80">
            {importHint}
          </span>
        )}
        {/* downloads sync — only in the Downloads Online view. The socket
            usually brings a finished download in by itself; this is the
            manual path: one click, one pass, spin while it runs. Icon-only:
            the full-text button used to clip out of narrow layout frames. */}
        {activeChipId === DOWNLOADS_FOLDER_ID && onRefreshDownloads && (
          <div className="mr-auto flex items-center gap-1.5">
            <button
              onClick={onRefreshDownloads}
              disabled={refreshingDownloads}
              title="Check the extension for finished downloads"
              aria-label="Refresh downloads"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-white/15 bg-white/[0.06] text-white/60 transition hover:border-white/40 hover:text-white disabled:opacity-50"
            >
              <RefreshCw size={12} className={refreshingDownloads ? 'animate-spin' : undefined} />
            </button>
            {refreshNote && (
              <span className="font-mono text-[8px] tracking-[0.15em] text-emerald-300/80">
                {refreshNote}
              </span>
            )}
          </div>
        )}
        {/* search as a REVEAL, not a fixture: the icon sits in the toolbar,
            the field slides over the top of the panel while it lives. The
            query itself stays up in Home — only the opening/closing is ours. */}
        <button
          onClick={() => setSearchOpen(true)}
          aria-label="Search the tracklist"
          aria-expanded={searchOpen}
          title="Search"
          className={`grid h-8 w-8 shrink-0 place-items-center rounded-full border transition ${
            searchOpen || query
              ? 'border-white/35 bg-white/[0.08] text-white'
              : 'border-white/15 bg-white/[0.06] text-white/50 hover:border-white/40 hover:text-white'
          }`}
        >
          <Search size={12} />
        </button>

        {/* player settings live in the playlists drawer now — this row stays
            [search] [⋯] */}

        <ListMenu
          groupBy={groupBy}
          onGroupByChange={onGroupByChange}
          onAdd={onAdd}
          onImport={onImport}
          onExport={onExport}
        />

        {/* the revealed search field, laid OVER the toolbar: opens on the
            icon, closes on X or Escape, and closing clears the query so no
            stale filter outlives its field */}
        {searchOpen && (
          <div className="absolute inset-0 z-[5] flex items-center gap-2 bg-black/50 px-3 backdrop-blur-sm">
            <Search size={12} className="shrink-0 text-white/50" />
            <input
              autoFocus
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setSearchOpen(false)
                  onQueryChange('')
                }
              }}
              placeholder="SEARCH"
              aria-label="Search the tracklist"
              className="min-w-0 flex-1 bg-transparent font-mono text-[10px] tracking-[0.16em] text-white/85 outline-none placeholder:text-white/30"
            />
            {query && (
              <button
                onClick={() => onQueryChange('')}
                aria-label="Clear search"
                className="shrink-0 text-white/40 transition hover:text-white"
              >
                <X size={11} />
              </button>
            )}
            <button
              onClick={() => {
                setSearchOpen(false)
                onQueryChange('')
              }}
              aria-label="Close search"
              title="Close search"
              className="shrink-0 text-white/40 transition hover:text-white"
            >
              <X size={12} />
            </button>
          </div>
        )}
      </div>

      {/* the view's numbers — one whisper-thin line under the toolbar: count
          and length on the left, boot/import state on the right. It pays its
          own height back: the rows above and below lost padding for it. */}
      <div className="flex min-w-0 items-center gap-2 overflow-hidden border-b border-white/[0.08] px-3 py-1">
        <span className="min-w-0 shrink-0 font-mono text-[8px] tracking-[0.2em] text-white/35">
          {tracks.length} {tracks.length === 1 ? 'TRACK' : 'TRACKS'}
          {durStats.known === tracks.length && tracks.length > 0 && (
            <span className="ml-1.5">· {Math.max(1, Math.round(durStats.total / 60))} MIN</span>
          )}
        </span>
        <span className="min-w-0 flex-1" />
        {boot === 'ready' && (
          <span className="ready-fade flex shrink-0 items-center gap-1 font-mono text-[8px] tracking-[0.15em] text-emerald-300">
            <Check size={9} strokeWidth={3} />
            READY
          </span>
        )}
        {importHint && (
          <span className="max-w-[180px] truncate font-mono text-[8px] tracking-[0.12em] text-cyan-300/80">
            {importHint}
          </span>
        )}
      </div>
      </div>

      {/* one bar for a multi-selection — the three things anyone does with a
          handful of rows, instead of doing them one at a time */}
      {selectedCount > 0 && (
        <div className="flex items-center gap-2 border-b border-white/10 bg-white/[0.05] px-2 py-1.5">
          <span className="shrink-0 font-mono text-[9px] tracking-[0.18em] text-emerald-200/90">
            {String(selectedCount).padStart(2, '0')} SELECTED
          </span>
          <span className="min-w-0 flex-1" />
          <button
            ref={barAddRef}
            onClick={() => setBarAddAnchor((a) => (a ? null : (barAddRef.current?.getBoundingClientRect() ?? null)))}
            aria-haspopup="menu"
            aria-expanded={!!barAddAnchor}
            className="shrink-0 rounded-full border border-white/15 px-2.5 py-1 font-mono text-[9px] tracking-[0.15em] text-white/60 transition hover:border-white/40 hover:text-white"
          >
            ADD TO PLAYLIST
          </button>
          {barAddAnchor && (
            <FloatingMenu anchor={barAddAnchor} ignore={barAddRef} onClose={() => setBarAddAnchor(null)}>
              <button
                className={MENU_ITEM}
                onClick={() => {
                  setBarAddAnchor(null)
                  onNewPlaylistWith([...selectedIds][0])
                  clearSelection()
                }}
              >
                <Plus size={12} /> NEW PLAYLIST…
              </button>
              {playlists.map((p) => (
                <button
                  key={p.id}
                  className={MENU_ITEM}
                  onClick={() => {
                    setBarAddAnchor(null)
                    addManyTo(
                      p.id,
                      [...selectedIds].map((id) => ({ id })),
                    )
                  }}
                >
                  <span className="min-w-0 flex-1 truncate" title={p.name}>
                    {p.name}
                  </span>
                </button>
              ))}
            </FloatingMenu>
          )}
          <button
            onClick={() =>
              queueMany(tracks.map((_, i) => ({ index: i })).filter((x) => selectedIds.has(tracks[x.index].id)))
            }
            className="shrink-0 rounded-full border border-white/15 px-2.5 py-1 font-mono text-[9px] tracking-[0.15em] text-white/60 transition hover:border-white/40 hover:text-white"
          >
            PLAY NEXT
          </button>
          <button
            onClick={() =>
              removeMany(tracks.map((_, i) => ({ index: i })).filter((x) => selectedIds.has(tracks[x.index].id)))
            }
            className="shrink-0 rounded-full border border-rose-300/25 px-2.5 py-1 font-mono text-[9px] tracking-[0.15em] text-rose-300/80 transition hover:border-rose-300/60 hover:text-rose-200"
          >
            REMOVE
          </button>
          <button
            onClick={clearSelection}
            aria-label="Clear selection"
            className="grid h-6 w-6 shrink-0 place-items-center rounded-full text-white/40 transition hover:bg-white/10 hover:text-white"
          >
            <X size={11} />
          </button>
        </div>
      )}

      {/* flex column: the toolbar rows keep their height, the list takes the
          rest and scrolls inside it. Without this the scroll area's flex-1
          had no flex parent and the list simply grew — which is why the
          whole page started scrolling instead */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <div
          ref={scrollRef}
          className="playlist-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain"
        >
          {tracks.length === 0 && (
            <div className="px-2 py-10 text-center">
              <div className="font-mono text-[10px] tracking-[0.3em] text-white/45">
                {query ? 'NO MATCHES' : 'NO TRACKS ON THIS DISC'}
              </div>
              <div className="mt-2 font-mono text-[9px] tracking-[0.25em] text-white/25">
                {query ? `NOTHING FITS “${query}”` : 'ADD FILES · OR DROP AUDIO ANYWHERE'}
              </div>
            </div>
          )}
          {/* spacers: everything outside the window keeps its place, so the
              scrollbar and the drag maths both stay true */}
          {view.start > 0 && <div style={{ height: view.start * rowH }} aria-hidden />}
          {tracks.slice(view.start, view.end).map((t, k) => {
            const i = view.start + k
            return (
              <PlaylistRow
                key={t.id}
                track={t}
                index={i}
                active={i === trackIndex}
                playing={playing}
                selected={selectedIds.has(t.id)}
                dragOver={dragOver === i && dragging}
                lifted={draggedIdx === i}
                reorderable={reorderable}
                density={density}
                animateIn={firstPaint && i < 16 && i !== draggedIdx}
                measure={k === 0 ? measureRow : undefined}
                onClick={onRowClick}
                onContextMenu={onContextAt}
                onSelect={onSelect}
                onRemove={onRemove}
                onEditMeta={onEditMeta}
                favourite={isFavourite(t.id)}
                onToggleFavourite={onToggleFavourite}
                queued={isNextUp(t.id)}
                onToggleNext={onToggleNext}
                playlists={playlists}
                onAddToPlaylist={onAddToPlaylist}
                onNewPlaylistWith={onNewPlaylistWith}
                enterDelay={Math.min(i, 8) * 22}
              />
            )
          })}
          {view.end < tracks.length && (
            <div style={{ height: (tracks.length - view.end) * rowH }} aria-hidden />
          )}
        </div>

        {/* the ghost that flies with the cursor — portalled to the body so
            the list's scroll clipping can never cut it, positioned entirely
            by the drag loop's translate3d (it starts off-screen; the first
            frame puts it under the pointer). pointer-events: none, so the
            elementFromPoint hit-test reads the rows underneath. */}
        {ghost &&
          createPortal(
            <div
              ref={ghostRef}
              className="playlist-row-ghost grid items-center gap-3 px-3"
              style={{ width: ghost.width, height: ghost.height, gridTemplateColumns: 'auto minmax(0, 1fr)' }}
            >
              <span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-[5px] border border-white/15 bg-white/5">
                {tracks[ghost.index]?.cover ? (
                  <img src={tracks[ghost.index].cover} alt="" className="h-full w-full object-cover" draggable={false} />
                ) : (
                  <span className="text-white/25">
                    <Disc2 size={14} />
                  </span>
                )}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[13px] text-white/90">{cleanTitle(tracks[ghost.index]?.title ?? '')}</span>
                <span className="block truncate font-mono text-[9px] tracking-[0.18em] text-white/40">
                  {(tracks[ghost.index]?.artist ?? '').toUpperCase()}
                </span>
              </span>
            </div>,
            document.body,
          )}

        {/* the group header: pinned over the top of the list, so it reads as
            sticky without putting anything into the scrolling stream that
            would break the window maths */}
        {head && headRun && (
          <div className="pointer-events-none absolute inset-x-0 top-0 z-10 border-b border-white/10 bg-black/70 px-3 py-1.5 backdrop-blur-sm">
            <span className="font-mono text-[9px] tracking-[0.28em] text-white/70">
              {head.toUpperCase()}
            </span>
            <span className="ml-2 font-mono text-[8px] tracking-[0.16em] text-white/30">
              {headRun.to - headRun.from} SONGS
            </span>
          </div>
        )}

      </div>

      {/* right-click menu, positioned at the pointer and portalled out of the
          panel's overflow so it can never be clipped by the list */}
      {ctx &&
        createPortal(
          <RowContextMenu
            x={ctx.x}
            y={ctx.y}
            count={targetsFor(ctx.index).length}
            playlists={playlists}
            onClose={() => setCtx(null)}
            onPlay={() => {
              const i = ctx.index
              setCtx(null)
              clearSelection()
              onSelect(i)
            }}
            onQueue={() => {
              queueMany(targetsFor(ctx.index))
              setCtx(null)
            }}
            onAddTo={(folderId) => {
              addManyTo(folderId, targetsFor(ctx.index))
              setCtx(null)
            }}
            onNewPlaylist={() => {
              const t = tracks[ctx.index]
              setCtx(null)
              if (t) {
                onNewPlaylistWith(t.id)
                clearSelection()
              }
            }}
            onEdit={() => {
              const i = ctx.index
              setCtx(null)
              onEditMeta(i, new DOMRect(ctx.x, ctx.y, 0, 0))
            }}
            onRemove={() => {
              removeMany(targetsFor(ctx.index))
              setCtx(null)
            }}
            onSelectAll={() => {
              setSelectedIds(new Set(tracks.map((t) => t.id)))
              setCtx(null)
            }}
          />,
          document.body,
        )}
    </div>
  )
}

/* the right-click menu: act on one row, or on every row that is selected
   when the click lands inside the selection */
function RowContextMenu({
  x,
  y,
  count,
  playlists,
  onClose,
  onPlay,
  onQueue,
  onAddTo,
  onNewPlaylist,
  onEdit,
  onRemove,
  onSelectAll,
}: {
  x: number
  y: number
  count: number
  playlists: { id: number; name: string; trackIds: number[] }[]
  onClose: () => void
  onPlay: () => void
  onQueue: () => void
  onAddTo: (folderId: number) => void
  onNewPlaylist: () => void
  onEdit: () => void
  onRemove: () => void
  onSelectAll: () => void
}) {
  const [tab, setTab] = useState<'root' | 'playlists'>('root')
  /* hung off the pointer's own position and MEASURED rather than guessed:
     the old code estimated the box height by hand — and under-shot it on the
     playlists tab — so the bottom rows ran past the screen, with no document
     scroll to bring them back */
  const anchor = useMemo(() => new DOMRect(x, y, 0, 0), [x, y])
  const row = MENU_ITEM
  const many = count > 1

  return (
    <FloatingMenu anchor={anchor} width={204} align="left" onClose={onClose}>
      {tab === 'root' ? (
        <>
          {many && (
            <div className="border-b border-white/10 px-2.5 py-1.5 font-mono text-[8px] tracking-[0.18em] text-emerald-200/80">
              {String(count).padStart(2, '0')} ROWS SELECTED
            </div>
          )}
          <button className={row} onClick={onPlay}>
            <Play size={12} /> PLAY
          </button>
          <button className={row} onClick={onQueue}>
            <ListPlus size={12} /> PLAY NEXT
          </button>
          <button className={row} onClick={() => setTab('playlists')}>
            <FolderPlus size={12} /> ADD TO PLAYLIST
            <ChevronRight size={11} className="ml-auto text-white/30" />
          </button>
          {!many && (
            <button className={row} onClick={onEdit}>
              <Pencil size={12} /> EDIT INFO
            </button>
          )}
          <button className={row} onClick={onSelectAll}>
            <Check size={12} /> SELECT ALL
          </button>
          <button
            className="flex w-full items-center gap-2 border-t border-white/10 px-2.5 py-1.5 text-left font-mono text-[9px] tracking-[0.15em] text-rose-300/70 transition hover:bg-white/10 hover:text-rose-300"
            onClick={onRemove}
          >
            <Trash2 size={12} /> REMOVE {many ? `${count}` : ''}
          </button>
        </>
      ) : (
        <>
          <div className="flex items-center gap-1.5 border-b border-white/10 px-2 py-1.5">
            <button onClick={() => setTab('root')} aria-label="Back" className="text-white/40 transition hover:text-white">
              <ChevronLeft size={12} />
            </button>
            <span className="truncate font-mono text-[8px] tracking-[0.2em] text-white/40">ADD TO…</span>
          </div>
          <button className={row} onClick={onNewPlaylist}>
            <Plus size={12} /> NEW PLAYLIST…
          </button>
          <div>
            {playlists.map((p) => (
              <button key={p.id} className={row} onClick={() => onAddTo(p.id)}>
                <span className="min-w-0 flex-1 truncate">{p.name}</span>
              </button>
            ))}
            {playlists.length === 0 && (
              <div className="px-2.5 py-2 font-mono text-[8px] tracking-[0.15em] text-white/30">
                NO PLAYLISTS YET
              </div>
            )}
          </div>
        </>
      )}
    </FloatingMenu>
  )
}

/* Add files / Import / Export — plus the grouping filter, and on a narrow
   row the sort and the density too — folded into the ONE ⋯ menu. There is no
   standalone "ADD" button and no orphan icon: everything the row has no room
   for is one click away here, and the menu carries the same opaque surface
   and the same clamp-to-viewport placement as every other menu. */
function ListMenu({
  groupBy,
  onGroupByChange,
  onAdd,
  onImport,
  onExport,
}: {
  groupBy: 'none' | 'artist'
  onGroupByChange: (g: 'none' | 'artist') => void
  onAdd: () => void
  onImport: () => void
  onExport: () => void
}) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const toggle = () =>
    setAnchor((a) => (a ? null : (btnRef.current?.getBoundingClientRect() ?? null)))

  const item =
    'flex w-full items-center gap-2 px-2.5 py-1.5 text-left font-mono text-[9px] tracking-[0.15em] text-white/75 transition-colors hover:bg-white/[0.12] hover:text-white focus-visible:bg-white/[0.12] focus-visible:text-white focus-visible:outline-none'

  return (
    <>
      <button
        ref={btnRef}
        onClick={toggle}
        aria-label="More list actions"
        aria-haspopup="menu"
        aria-expanded={!!anchor}
        title="Add · import · export · group"
        className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-white/15 bg-white/[0.06] text-white/50 transition hover:border-white/40 hover:text-white"
      >
        <MoreHorizontal size={13} />
      </button>
      {anchor && (
        <FloatingMenu anchor={anchor} ignore={btnRef} onClose={() => setAnchor(null)}>
          <button
            className={item}
            onClick={() => {
              setAnchor(null)
              onAdd()
            }}
          >
            <Plus size={12} /> ADD FILES
          </button>
          <button
            className={item}
            onClick={() => {
              setAnchor(null)
              onImport()
            }}
          >
            <Upload size={12} /> IMPORT .M3U8
          </button>
          <button
            className={item}
            onClick={() => {
              setAnchor(null)
              onExport()
            }}
          >
            <Download size={12} /> EXPORT .M3U8
          </button>

          <div className={MENU_DIVIDER} />
          <button
            className={item}
            onClick={() => {
              setAnchor(null)
              onGroupByChange(groupBy === 'none' ? 'artist' : 'none')
            }}
          >
            <AlignLeft size={12} />
            <span className="min-w-0 flex-1">
              {groupBy === 'none' ? 'GROUP BY ARTIST' : 'UNGROUP'}
            </span>
            {groupBy !== 'none' && (
              <Check size={11} strokeWidth={3} className="shrink-0 text-emerald-300" />
            )}
          </button>
        </FloatingMenu>
      )}
    </>
  )
}

const PlaylistRow = memo(function PlaylistRow({
  track,
  index,
  active,
  playing,
  selected,
  dragOver,
  lifted,
  reorderable,
  density,
  animateIn,
  measure,
  onClick: rowClick,
  onContextMenu: rowContext,
  onSelect,
  onRemove,
  onEditMeta,
  favourite,
  onToggleFavourite,
  queued,
  onToggleNext,
  playlists,
  onAddToPlaylist,
  onNewPlaylistWith,
  enterDelay,
}: {
  track: Track
  index: number
  active: boolean
  playing: boolean
  selected: boolean
  dragOver: boolean
  lifted: boolean
  reorderable: boolean
  density: RowDensity
  animateIn: boolean
  measure?: (el: HTMLElement | null) => void
  onClick: (i: number, e: React.MouseEvent) => void
  onContextMenu: (i: number, x: number, y: number) => void
  onSelect: (i: number) => void
  onRemove: (i: number) => void
  onEditMeta: (i: number, anchor: DOMRect) => void
  favourite: boolean
  onToggleFavourite: (id: number) => void
  queued: boolean
  onToggleNext: (i: number) => void
  playlists: { id: number; name: string; trackIds: number[] }[]
  onAddToPlaylist: (folderId: number, trackId: number) => void
  onNewPlaylistWith: (trackId: number) => void
  enterDelay: number
}) {
  /* the row's own element, so its duration can be probed only once the row
     is near the viewport — see useDuration: importing a large folder used
     to start one metadata read per row at once, and the chain of them kept
     the media pipeline busy right when the user pressed play */
  const rowRef = useRef<HTMLDivElement | null>(null)
  /* no IntersectionObserver (or no row element) — probe right away */
  const [near, setNear] = useState(() => typeof IntersectionObserver === 'undefined')
  useEffect(() => {
    const el = rowRef.current
    if (!el || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setNear(true)
      },
      /* a row about to scroll into view counts, so its duration is ready
         by the time anyone can see the row */
      { rootMargin: '320px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])
  const duration = useDuration(track.src, near)
  /* the menu is two deep: the actions, then the list of playlists to drop
     this track into — both in the same popup, so adding never opens a panel.
     It hangs off the button's rect and is portalled out of the row AND out
     of the list's scroll container, so it can never be cut by either. */
  const [menuAnchor, setMenuAnchor] = useState<DOMRect | null>(null)
  const [menuTab, setMenuTab] = useState<'root' | 'playlists'>('root')
  const btnRef = useRef<HTMLSpanElement | null>(null)
  const closeMenu = () => {
    setMenuAnchor(null)
    setMenuTab('root')
  }

  const compact = density === 'compact'
  const menuRow = MENU_ITEM
  const title = cleanTitle(track.title)

  return (
    <div
      ref={(el) => {
        rowRef.current = el
        measure?.(el)
      }}
      role="button"
      tabIndex={0}
      data-active={active ? 'true' : undefined}
      data-row-index={index}
      title={`${track.artist} — ${track.title}${track.genre ? `  ·  ${track.genre}` : ''}`}
      onClick={(e) => rowClick(index, e)}
      onContextMenu={(e) => {
        e.preventDefault()
        rowContext(index, e.clientX, e.clientY)
      }}
      onKeyDown={(e) => {
        if (e.code === 'Enter' || e.code === 'Space') {
          e.preventDefault()
          onSelect(index)
        }
      }}
      style={enterDelay && animateIn ? { animationDelay: `${enterDelay}ms` } : undefined}
      className={`playlist-row ${animateIn ? 'playlist-row-in ' : ''}${lifted ? 'playlist-row-drag-origin ' : ''}group relative w-full border-b border-white/[0.055] px-3 text-left transition-[background-color,border-color,box-shadow] duration-300 ${
        reorderable ? 'cursor-grab' : 'cursor-pointer'
      } ${active ? 'playlist-row-active' : 'hover:bg-white/[0.04]'} ${
        selected && !active ? 'playlist-row-selected' : ''
      } ${dragOver ? 'bg-white/[0.04]' : ''} ${compact ? 'grid py-2' : 'grid py-2.5'}`}
    >
      {/* drop indicator while reordering */}
      {dragOver && (
        <span className="absolute left-0 right-0 top-0 z-10 h-[2px] bg-emerald-300 shadow-[0_0_8px_rgba(110,231,183,0.9)]" />
      )}
      {/* active accent — the left bar the selection lands on, in the art's
          colours when Accent from Art is on (defaults to the deck pair) */}
      {active && (
        <span className="playlist-select absolute left-0 top-0 h-full w-[2px] opacity-80" style={{ background: 'linear-gradient(to bottom,var(--accent-a,#7dd8ff),var(--accent-b,#c99cff),var(--accent-a,#ff9dd8))' }} />
      )}
      {/* playback progress along the whole bottom edge, not only the left */}
      {active && (
        <span
          data-progress
          className="absolute bottom-0 left-0 z-10 h-[2px] origin-left transform-gpu opacity-80 transition-transform duration-200"
          style={{
            transform: 'scaleX(0)',
            background: 'linear-gradient(to right,var(--accent-a,#7dd8ff),var(--accent-b,#c99cff),var(--accent-a,#ff9dd8))',
          }}
        />
      )}

      {/* the art IS the first column — no row number, and no little pink
          equaliser jumping next to it: hovering the art is what says "play" */}
      <span
        className={`relative shrink-0 overflow-hidden rounded-[5px] border border-white/[0.12] bg-white/[0.045] ${
          compact ? 'h-7 w-7' : 'h-9 w-9'
        }`}
      >
        {track.cover ? (
          /* lazy + async: a long library mounts rows constantly, and every
             one of them used to demand its cover decode immediately */
          <img src={track.cover} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" draggable={false} />
        ) : (
          <span className="grid h-full w-full place-items-center text-white/25">
            <Disc2 size={compact ? 12 : 14} />
          </span>
        )}
        {!playing && (
          <span className="row-hover-reveal absolute inset-0 grid place-items-center rounded-[5px] bg-black/45 opacity-0 transition-opacity duration-150 group-hover:opacity-100">
            <Play size={12} className="fill-white text-white" />
          </span>
        )}
      </span>

      {/* [1] title + artist take the flexible middle column, so neither is
              clipped by a fixed duration slot */}
      <span className="min-w-0 flex-1">
        <span
          className={`block truncate text-sm font-semibold tracking-wide ${
            active ? 'text-white' : 'text-white/80 group-hover:text-white'
          }`}
        >
          {title}
        </span>
        <span className="mt-0.5 block truncate font-mono text-[10px] tracking-[0.1em] text-white/40">
          {track.artist}
        </span>
      </span>

      {/* [1] duration parked at the right, in its own fixed column */}
      <span className="w-10 shrink-0 text-right font-mono text-[11px] tabular-nums text-white/45">
        {fmt(duration)}
      </span>

      {/* [3] the LIKE button is the one action that is always on the row —
              state you want one tap away. Play-next and the menu reveal on
              HOVER ONLY, and never while the list is scrolling (the cursor
              rides over rows during a scroll; popping buttons there read as
              jitter — .row-hover-reveal + [data-scrolling] in index.css). */}
      <span className="flex shrink-0 items-center gap-0.5">
        <span
          role="button"
          aria-label={favourite ? `Remove ${track.title} from favourites` : `Add ${track.title} to favourites`}
          title={favourite ? 'Remove from favourites' : 'Add to favourites'}
          onClick={(e) => {
            e.stopPropagation()
            onToggleFavourite(track.id)
          }}
          className={`grid h-6 w-6 place-items-center rounded-full transition-all duration-150 ${
            favourite ? 'text-rose-300' : 'text-white/25 hover:bg-white/10 hover:text-white'
          }`}
        >
          <Heart size={12} className={favourite ? 'fill-rose-300' : ''} />
        </span>
        <span className="row-hover-reveal flex items-center gap-0.5">
          <span
            role="button"
            aria-label={queued ? `Remove ${track.title} from the play-next queue` : `Play ${track.title} next`}
            title={queued ? 'Remove from play-next queue' : 'Play next'}
            onClick={(e) => {
              e.stopPropagation()
              onToggleNext(index)
            }}
            className={`grid h-6 w-6 place-items-center rounded-full transition-all duration-150 hover:bg-white/10 ${
              queued
                ? 'bg-emerald-400/15 text-emerald-200 opacity-100'
                : 'text-white/40 opacity-0 hover:text-white group-hover:opacity-100'
            }`}
          >
            <ListPlus size={12} />
          </span>
          <span className="relative">
            <span
              ref={btnRef}
              role="button"
              aria-label={`More actions for ${track.title}`}
              aria-haspopup="menu"
              title="More"
              onClick={(e) => {
                e.stopPropagation()
                setMenuTab('root')
                setMenuAnchor((a) => (a ? null : (btnRef.current?.getBoundingClientRect() ?? null)))
              }}
              className="grid h-6 w-6 place-items-center rounded-full text-white/40 opacity-0 transition-all duration-150 hover:bg-white/10 hover:text-white group-hover:opacity-100"
            >
              <MoreHorizontal size={13} />
            </span>
            {menuAnchor && (
              <FloatingMenu anchor={menuAnchor} width={216} ignore={btnRef} onClose={closeMenu}>
              {menuTab === 'root' ? (
                <>
                  <button
                    className={menuRow}
                    onClick={() => {
                      closeMenu()
                      onToggleNext(index)
                    }}
                  >
                    <ListPlus size={12} /> {queued ? 'UNQUEUE' : 'PLAY NEXT'}
                  </button>
                  <button
                    className={menuRow}
                    onClick={() => {
                      closeMenu()
                      onToggleFavourite(track.id)
                    }}
                  >
                    <Heart size={12} /> {favourite ? 'UNFAVOURITE' : 'FAVOURITE'}
                  </button>
                  <button
                    className={menuRow}
                    onClick={() => {
                      closeMenu()
                      onEditMeta(index, btnRef.current?.getBoundingClientRect() ?? new DOMRect())
                    }}
                  >
                    <Pencil size={12} /> EDIT INFO
                  </button>
                  <button
                    className={menuRow}
                    onClick={() => {
                      closeMenu()
                      onToggleNext(index)
                    }}
                  >
                    <ListPlus size={12} /> {queued ? 'UNQUEUE' : 'PLAY NEXT'}
                  </button>
                  <button className={menuRow} onClick={() => setMenuTab('playlists')}>
                    <FolderPlus size={12} /> ADD TO PLAYLIST
                    <ChevronRight size={11} className="ml-auto text-white/30" />
                  </button>
                  <button
                    className="flex w-full items-center gap-2 border-t border-white/10 px-2.5 py-1.5 text-left font-mono text-[9px] tracking-[0.15em] text-rose-300/70 transition hover:bg-white/10 hover:text-rose-300"
                    onClick={() => {
                      closeMenu()
                      onRemove(index)
                    }}
                  >
                    <Trash2 size={12} /> REMOVE
                  </button>
                </>
              ) : (
                <>
                  <div className="flex items-center gap-1.5 border-b border-white/10 px-2 py-1.5">
                    <button
                      onClick={() => setMenuTab('root')}
                      aria-label="Back"
                      className="text-white/40 transition hover:text-white"
                    >
                      <ChevronLeft size={12} />
                    </button>
                    <span className="truncate font-mono text-[8px] tracking-[0.2em] text-white/40">
                      ADD TO…
                    </span>
                  </div>
                  <button
                    className={menuRow}
                    onClick={() => {
                      closeMenu()
                      onNewPlaylistWith(track.id)
                    }}
                  >
                    <Plus size={12} /> NEW PLAYLIST…
                  </button>
                  <div>
                    {playlists.map((p) => {
                      const has = p.trackIds.includes(track.id)
                      return (
                        <button
                          key={p.id}
                          className={menuRow}
                          onClick={() => {
                            closeMenu()
                            onAddToPlaylist(p.id, track.id)
                          }}
                        >
                          <span className="min-w-0 flex-1 truncate">{p.name}</span>
                          {has && <Check size={11} className="shrink-0 text-emerald-300" />}
                        </button>
                      )
                    })}
                    {playlists.length === 0 && (
                      <div className="px-2.5 py-2 font-mono text-[8px] tracking-[0.15em] text-white/30">
                        NO PLAYLISTS YET
                      </div>
                    )}
                  </div>
                </>
              )}
            </FloatingMenu>
          )}
          </span>
        </span>
      </span>
    </div>
  )
})
