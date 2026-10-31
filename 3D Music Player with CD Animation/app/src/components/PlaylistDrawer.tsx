import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Check,
  ChevronDown,
  ChevronLeft,
  GripVertical,
  Heart,
  ImagePlus,
  ListMusic,
  ListPlus,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  Search,
  Settings2,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import type { Track } from '../hooks/useAudioEngine'
import { DOWNLOADS_FOLDER_ID, FAVOURITES_FOLDER_ID, type PlaylistFolder } from '../features/playlist/usePlaylists'
import TrackMetaEditor from './TrackMetaEditor'

interface Props {
  open: boolean
  folders: PlaylistFolder[]
  library: Track[]
  currentIndex: number
  playing: boolean
  /* the playlist the main tracklist is showing — kept lifted so clicking a
     folder here updates the page behind the drawer in the same commit */
  selectedFolderId: number | null
  onSelectFolder: (folderId: number | null) => void
  onClose: () => void
  /* creating is instant — no dialog. It returns the new id so the drawer can
     open that row straight into an inline rename with its text selected */
  onCreateFolder: () => number
  onRestoreFolder: (folder: PlaylistFolder, index?: number) => void
  onDuplicateFolder: (id: number) => void
  onRenameFolder: (id: number, name: string) => void
  onDeleteFolder: (id: number) => void
  onSetFolderImage: (id: number, dataUrl: string | undefined) => void
  onAddTrack: (folderId: number, trackId: number) => void
  onRemoveTrack: (folderId: number, trackId: number) => void
  onReorder: (folderId: number, from: number, to: number) => void
  onPlayTrack: (folderId: number, idx: number) => void
  onPlayAll: (folderId: number) => void
  onEditTrack: (id: number, title: string, artist: string, cover?: string) => void
  onUploadFile: (folderId: number, file: File) => void
  isFavourite: (id: number) => boolean
  onToggleFavourite: (id: number) => void
  /* play-next queue — shared with the main tracklist, so queuing from here
     and from there can never disagree */
  isNextUp: (id: number) => boolean
  onToggleNext: (id: number) => void
  /* player settings — crossfade + volume normalisation. The engine owns the
     state; the drawer is presentational. */
  playerSettings: { crossfade: boolean; crossfadeSec: number; normalize: boolean }
  onPlayerSetting: (key: 'crossfade' | 'crossfadeSec' | 'normalize', value: number | boolean) => void
  /* Accent from Art — the UI (seekbar, active row, progress line) wears the
     playing track's colours, extracted from its cover. The state lives in
     Home beside the other display choices; this is the switch. */
  accentArt: boolean
  onAccentArt: (v: boolean) => void
}

/* Glass quality (item: "be careful with backdrop-filter"). A blur is
   re-evaluated against its backdrop whenever the backdrop changes, and a live
   wallpaper changes it every frame — so this one switch trades the frosted
   panes for their flat dark fills across the whole app. The governor drops
   the same thing automatically when frames go bad; this is for the user who
   would rather keep them anyway. */
function GlassSwitch() {
  const [on, setOn] = useState(() => localStorage.getItem('md-glass') !== 'off')
  useEffect(() => {
    document.documentElement.dataset.glass = on ? 'on' : 'off'
    localStorage.setItem('md-glass', on ? 'on' : 'off')
  }, [on])
  return (
    <div className="mb-3">
      <div className="mb-1 flex items-center justify-between">
        <span className="font-mono text-[8px] tracking-[0.2em] text-white/35">GLASS PANELS</span>
        <span className="font-mono text-[8px] text-white/40">{on ? 'BLURRED' : 'SOLID'}</span>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        <button
          onClick={() => setOn(true)}
          className={`rounded-lg py-1.5 font-mono text-[9px] tracking-[0.15em] transition ${
            on ? 'bg-white/90 text-black' : 'border border-white/10 bg-white/[0.03] text-white/50 hover:border-white/25 hover:text-white'
          }`}
        >
          BLURRED
        </button>
        <button
          onClick={() => setOn(false)}
          className={`rounded-lg py-1.5 font-mono text-[9px] tracking-[0.15em] transition ${
            !on ? 'bg-white/90 text-black' : 'border border-white/10 bg-white/[0.03] text-white/50 hover:border-white/25 hover:text-white'
          }`}
        >
          SOLID · FAST
        </button>
      </div>
    </div>
  )
}

const durationCache = new Map<string, number>()
const MIN_W = 280
const MAX_W = 520
const FOLDER_AUDIO_RE = /\.(mp3|flac|wav|ogg|oga|m4a|m4b|aac|opus|webm|wma|aiff?|ape|mp4|mka|amr|mid|midi|wv|tta)$/i
const fmtDur = (s: number) => {
  if (!Number.isFinite(s) || s <= 0) return '--:--'
  const m = Math.floor(s / 60)
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`
}

/* ---- shared chrome language ------------------------------------------
   The rest of the device is brushed metal, hairline seams and wide mono
   tracking, so the drawer borrows exactly those three things instead of
   the flat grey card look it had. Every surface is a soft gradient with an
   inset top highlight; every control is a small machined pill. */
const METAL = 'linear-gradient(145deg,#f4f7fa 0%,#c7ccd4 40%,#9aa2ac 70%,#e8ecf1 100%)'
const METAL_SHADOW =
  'inset 0 1px 1px rgba(255,255,255,0.9), inset 0 -1px 2px rgba(0,0,0,0.25), 0 3px 12px rgba(0,0,0,0.5)'
const SLED = 'border-white/10 bg-gradient-to-br from-white/[0.055] to-white/[0.02]'
const SLED_HOVER =
  'hover:border-white/25 hover:from-white/[0.08] hover:to-white/[0.03] hover:shadow-[0_10px_26px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.09)]'
const SEAM = 'shadow-[inset_0_1px_0_rgba(255,255,255,0.07),0_1px_0_rgba(0,0,0,0.35)]'
/* the drawer's own glass: a low-opacity smoked pane so the player behind it
   actually shows through the blur, lit by two soft source glows */
const GLASS_BG =
  /* the pane is LIGHTER at the top and gets denser downwards, the way a real
     slab catches light — a flat wash is what made it read as painted black */
  'radial-gradient(120% 55% at 100% 0%, rgba(150,215,255,0.13), transparent 58%), radial-gradient(95% 50% at 0% 100%, rgba(255,157,216,0.085), transparent 62%), linear-gradient(180deg, rgba(34,38,50,0.50) 0%, rgba(17,18,25,0.62) 38%, rgba(9,9,13,0.78) 100%)'
/* the frost film laid over the blur: two specular bands + a lit top rim */
const GLASS_FILM =
  'linear-gradient(180deg, rgba(255,255,255,0.09) 0%, rgba(255,255,255,0.015) 18%, rgba(255,255,255,0) 46%, rgba(0,0,0,0.10) 100%)'

/* small glass button used for every row/card action */
function GlassButton({
  onClick,
  label,
  title,
  danger,
  armed,
  children,
  className = '',
}: {
  onClick: (e: React.MouseEvent) => void
  label?: string
  title: string
  danger?: boolean
  armed?: boolean
  children: React.ReactNode
  className?: string
}) {
  return (
    <span
      role="button"
      tabIndex={-1}
      aria-label={label ?? title}
      title={title}
      onClick={(e) => {
        e.stopPropagation()
        onClick(e)
      }}
      className={`grid h-7 w-7 shrink-0 cursor-pointer place-items-center rounded-[9px] border transition-all duration-200 ${
        armed
          ? 'border-emerald-300/45 bg-emerald-400/10 text-emerald-200 shadow-[0_0_14px_rgba(110,231,183,0.18)]'
          : danger
            ? 'border-white/10 bg-white/[0.03] text-white/40 hover:border-red-400/40 hover:bg-red-500/10 hover:text-red-300'
            : 'border-white/10 bg-white/[0.03] text-white/45 hover:border-white/30 hover:bg-white/[0.08] hover:text-white'
      } ${className}`}
    >
      {children}
    </span>
  )
}

export default function PlaylistDrawer({
  open,
  folders,
  library,
  currentIndex,
  playing,
  selectedFolderId,
  onSelectFolder,
  onClose,
  onCreateFolder,
  onRestoreFolder,
  onDuplicateFolder,
  onRenameFolder,
  onDeleteFolder,
  onSetFolderImage,
  onAddTrack,
  onRemoveTrack,
  onReorder,
  onPlayTrack,
  onPlayAll,
  onEditTrack,
  onUploadFile,
  isFavourite,
  onToggleFavourite,
  isNextUp,
  onToggleNext,
  playerSettings,
  onPlayerSetting,
  accentArt,
  onAccentArt,
}: Props) {
  const [closing, setClosing] = useState(false)
  /* the player-settings section: collapsed until the header's gear asks */
  const [psOpen, setPsOpen] = useState(false)
  const [activeFolderId, setActiveFolderId] = useState<number | null>(null)
  /* dedicated playlist-level editor (rename + poster) — opened from the
     playlists list row, NOT from inside an opened playlist */
  const [editFolderId, setEditFolderId] = useState<number | null>(null)
  const [editFolderName, setEditFolderName] = useState('')
  const [editFolderCover, setEditFolderCover] = useState<string | undefined>(undefined)
  const folderCoverInputRef = useRef<HTMLInputElement>(null)
  const folderFileInputRef = useRef<HTMLInputElement>(null)
  const [addingTo, setAddingTo] = useState<number | null>(null)
  const [durations, setDurations] = useState<Map<string, number>>(new Map())
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)
  /* rows stay mounted for ~200ms while their exit animation plays, then the
     real removal lands — deleting something should be legible, not a pop */
  const [removingFolderId, setRemovingFolderId] = useState<number | null>(null)
  const [removingTrackId, setRemovingTrackId] = useState<number | null>(null)
  const EXIT_MS = 200
  const [drawerW, setDrawerW] = useState(340)
  const [listSearch, setListSearch] = useState('')
  const [trackSearch, setTrackSearch] = useState('')
  /* per-track meta editor (rename + poster) opened from a track row */
  const [editTrack, setEditTrack] = useState<{ track: Track; anchor: DOMRect } | null>(null)
  /* inline rename of a playlist row: null until the caret is in one. `name`
     is null until the user types, so the input starts on the folder's own
     name and selects it on focus. */
  const [renaming, setRenaming] = useState<{ id: number; name: string | null } | null>(null)
  const [folderMenuId, setFolderMenuId] = useState<number | null>(null)
  /* delete shows an Undo toast instead of asking first */
  const [undoFolder, setUndoFolder] = useState<{ folder: PlaylistFolder; index: number } | null>(null)
  const undoTimer = useRef<number | null>(null)
  const resizeRef = useRef<{ startX: number; startW: number } | null>(null)

  useEffect(() => {
    return () => {
      if (undoTimer.current) window.clearTimeout(undoTimer.current)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    const down = (e: MouseEvent) => {
      const el = e.target as HTMLElement | null
      if (!el?.closest?.('[data-folder-menu]')) setFolderMenuId(null)
    }
    document.addEventListener('mousedown', down)
    return () => document.removeEventListener('mousedown', down)
  }, [open])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        if (renaming !== null) setRenaming(null)
        else if (folderMenuId !== null) setFolderMenuId(null)
        else if (addingTo !== null) setAddingTo(null)
        else if (editFolderId !== null) setEditFolderId(null)
        else if (editTrack !== null) setEditTrack(null)
        else if (activeFolderId !== null) setActiveFolderId(null)
        else onClose()
      }
    }
    if (open) window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, renaming, folderMenuId, addingTo, editFolderId, editTrack, activeFolderId, onClose])

  useEffect(() => {
    for (const t of library) {
      if (durationCache.has(t.src)) continue
      const a = new Audio()
      a.preload = 'metadata'
      a.src = t.src
      a.onloadedmetadata = () => {
        durationCache.set(t.src, a.duration)
        setDurations(new Map(durationCache))
      }
    }
  }, [library])

  if (!open) return null

  const close = () => {
    setClosing(true)
    window.setTimeout(() => {
      setClosing(false)
      onClose()
    }, 280)
  }

  const commitTrackEdit = (title: string, artist: string, cover?: string) => {
    const t = title.trim()
    if (!t) return
    if (editTrack) {
      onEditTrack(editTrack.track.id, t, artist.trim(), cover)
    }
  }

  const openTrackEdit = (track: Track, anchor: DOMRect) => {
    setEditTrack({ track, anchor })
  }
  const closeTrackEdit = () => setEditTrack(null)

  const startFolderEdit = (f: PlaylistFolder) => {
    setEditFolderId(f.id)
    setEditFolderName(f.name)
    setEditFolderCover(f.image)
  }

  const commitFolderEdit = () => {
    if (editFolderId !== null) {
      onRenameFolder(editFolderId, editFolderName.trim())
      onSetFolderImage(editFolderId, editFolderCover)
    }
    setEditFolderId(null)
  }

  const closeFolderEdit = () => setEditFolderId(null)

  const onFolderFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []).filter((f) => FOLDER_AUDIO_RE.test(f.name))
    e.target.value = ''
    if (!activeFolderId || !files.length) return
    for (const f of files) void onUploadFile(activeFolderId, f)
  }

  const onFolderCoverFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setEditFolderCover(reader.result as string)
    reader.readAsDataURL(file)
  }

  const startRename = (id: number) => {
    setFolderMenuId(null)
    const f = folders.find((x) => x.id === id)
    setRenaming({ id, name: f?.name ?? null })
  }

  const commitRename = () => {
    if (renaming) {
      const name = (renaming.name ?? '').trim()
      if (name) onRenameFolder(renaming.id, name)
    }
    setRenaming(null)
  }

  /* deleting asks nothing — it shows a toast with UNDO for a few seconds,
     carrying the folder itself so it can go back exactly where it was */
  const removeFolderAnimated = (id: number) => {
    const index = folders.findIndex((f) => f.id === id)
    const folder = index === -1 ? null : folders[index]
    setRemovingFolderId(id)
    window.setTimeout(() => {
      onDeleteFolder(id)
      setRemovingFolderId(null)
      if (folder) {
        setUndoFolder({ folder, index })
        if (undoTimer.current) window.clearTimeout(undoTimer.current)
        undoTimer.current = window.setTimeout(() => setUndoFolder(null), 7000)
      }
    }, EXIT_MS)
  }

  const undoDelete = () => {
    if (!undoFolder) return
    onRestoreFolder(undoFolder.folder, undoFolder.index)
    setUndoFolder(null)
    if (undoTimer.current) window.clearTimeout(undoTimer.current)
  }

  /* export one playlist as m3u8 — the same shape the library export writes */
  const exportFolder = (f: PlaylistFolder) => {
    const tracks = f.trackIds.map(trackById).filter((t): t is Track => !!t)
    if (!tracks.length) return
    const lines = ['#EXTM3U', `#PLAYLIST:${f.name}`]
    tracks.forEach((t) => {
      lines.push(`#EXTINF:-1,${t.artist} - ${t.title}`)
      lines.push(`${t.title.replace(/[\\/:*?"<>|]/g, '_')}.${t.genre.toLowerCase()}`)
    })
    const blob = new Blob([lines.join('\n')], { type: 'audio/x-mpegurl' })
    const a = document.createElement('a')
    const url = URL.createObjectURL(blob)
    a.href = url
    a.download = `${f.name.replace(/[\\/:*?"<>|]/g, '_')}.m3u8`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 5000)
  }

  /* the four covers that make a playlist's 2×2 collage when it has no poster
     of its own — a real picture instead of a generic list icon */
  const collage = (f: PlaylistFolder) =>
    f.trackIds
      .slice(0, 4)
      .map(trackById)
      .filter((t): t is Track => !!t)
      .map((t) => t.cover)
      .filter((c): c is string => !!c)

  const removeTrackAnimated = (id: number) => {
    setRemovingTrackId(id)
    window.setTimeout(() => {
      if (activeFolderId !== null) onRemoveTrack(activeFolderId, id)
      setRemovingTrackId(null)
    }, EXIT_MS)
  }

  const trackById = (id: number) => library.find((t) => t.id === id)
  const activeFolder = activeFolderId !== null ? folders.find((f) => f.id === activeFolderId) ?? null : null
  const folderTracks = activeFolder
    ? activeFolder.trackIds.map(trackById).filter((t): t is Track => !!t)
    : []
  const folderSeconds = folderTracks.reduce((sum, t) => sum + (durations.get(t.src) ?? 0), 0)
  const totalTracks = library.length

  const onResizeStart = (e: React.PointerEvent) => {
    e.preventDefault()
    resizeRef.current = { startX: e.clientX, startW: drawerW }
    const onMove = (ev: PointerEvent) => {
      const r = resizeRef.current
      if (!r) return
      const next = Math.max(MIN_W, Math.min(MAX_W, r.startW + (r.startX - ev.clientX)))
      setDrawerW(next)
    }
    const onUp = () => {
      resizeRef.current = null
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  const onDrop = (i: number) => (e: React.DragEvent) => {
    e.preventDefault()
    if (activeFolderId !== null && dragIndex !== null && dragIndex !== i) {
      onReorder(activeFolderId, dragIndex, i)
    }
    setDragIndex(null)
    setOverIndex(null)
  }

  return createPortal(
    <div className="fixed inset-0 z-[90]">
      <div
        className={`absolute inset-0 bg-black/45 backdrop-blur-[4px] transition-opacity duration-300 ease-out ${
          closing ? 'opacity-0' : 'opacity-100'
        }`}
        onClick={close}
      />
      <div
        className={`playlist-drawer absolute right-0 top-0 flex h-full flex-col overflow-hidden transition-transform duration-[320ms] ease-[cubic-bezier(.22,1,.36,1)] ${
          closing ? 'translate-x-full' : 'translate-x-0'
        }`}
        style={{
          width: drawerW,
          background: GLASS_BG,
          /* rim light on every edge that faces the room, a hairline dark seam
             inside it, and a wide soft cast shadow — the three reads that make
             a flat pane sit IN the scene instead of on top of it */
          boxShadow:
            'inset 2px 0 0 rgba(255,255,255,0.20), inset 1px 0 0 rgba(255,255,255,0.36), inset 0 1px 0 rgba(255,255,255,0.22), inset 0 -1px 0 rgba(255,255,255,0.06), inset -1px 0 0 rgba(0,0,0,0.45), -40px 0 120px rgba(0,0,0,0.66), -8px 0 34px rgba(0,0,0,0.45)',
          backdropFilter: 'blur(38px) saturate(1.75) brightness(1.07)',
          WebkitBackdropFilter: 'blur(38px) saturate(1.75) brightness(1.07)',
        }}
        onKeyDown={(e) => e.stopPropagation()}
      >
        {/* glass furniture, painted under every control: a specular band off
            the top-left corner, a lit left edge, and a soft bloom from the
            bottom-right — the three reads that make a pane look like glass */}
        <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
          {/* frost film over the blur */}
          <div className="absolute inset-0" style={{ background: GLASS_FILM }} />
          <div
            className="absolute -left-1/4 -top-1/3 h-2/3 w-[150%] rotate-[-14deg]"
            style={{
              background:
                'linear-gradient(90deg, transparent 8%, rgba(255,255,255,0.10) 34%, rgba(255,255,255,0.035) 52%, transparent 74%)',
            }}
          />
          {/* a second, thinner specular streak crossing the first — glass has
              more than one reflection and one band always looks like a stripe */}
          <div
            className="absolute -left-1/4 -top-1/4 h-1/3 w-[150%] rotate-[-14deg] opacity-70"
            style={{
              background:
                'linear-gradient(90deg, transparent 22%, rgba(255,255,255,0.06) 46%, transparent 66%)',
            }}
          />
          {/* the cut edge, then a bright inner refraction line just inside it */}
          <div
            className="absolute inset-y-0 left-0 w-[2px]"
            style={{
              background:
                'linear-gradient(180deg, rgba(255,255,255,0.46) 0%, rgba(255,255,255,0.14) 22%, rgba(255,255,255,0.03) 58%, rgba(255,255,255,0.18) 100%)',
            }}
          />
          <div
            className="absolute inset-y-[3%] left-[1.5px] w-[6px] rounded-full opacity-60 blur-[1px]"
            style={{
              background:
                'linear-gradient(180deg, rgba(180,225,255,0.20), rgba(255,255,255,0.04) 55%, rgba(255,170,225,0.14))',
            }}
          />
          <div
            className="absolute -bottom-24 -right-16 h-56 w-56 rounded-full"
            style={{ background: 'radial-gradient(circle, rgba(160,220,255,0.13), transparent 68%)' }}
          />
          {/* a faint cool cast from the top-right, so the pane has a light side */}
          <div
            className="absolute -right-20 -top-16 h-48 w-48 rounded-full"
            style={{ background: 'radial-gradient(circle, rgba(200,230,255,0.10), transparent 70%)' }}
          />
        </div>

        {/* resize grip — a machined seam rather than a hit strip */}
        <div
          onPointerDown={onResizeStart}
          className="group/grip absolute left-0 top-0 z-20 flex h-full w-[7px] cursor-ew-resize items-center justify-center"
          title="Drag to resize"
        >
          <span className="h-10 w-px rounded-full bg-white/15 transition-all duration-200 group-hover/grip:h-16 group-hover/grip:bg-white/40 group-active/grip:h-20 group-active/grip:bg-white/60" />
        </div>

        {/* header rail */}
        <div className="relative flex items-center justify-between gap-3 px-4 pb-3.5 pt-4">
          <div className="flex min-w-0 items-center gap-2.5">
            {activeFolder !== null ? (
              <button
                onClick={() => setActiveFolderId(null)}
                aria-label="Back to playlists"
                className="grid h-7 w-7 shrink-0 place-items-center rounded-[9px] border border-white/10 bg-white/[0.04] text-white/55 transition-all duration-200 hover:border-white/30 hover:bg-white/[0.09] hover:text-white active:scale-95"
              >
                <ChevronLeft size={13} />
              </button>
            ) : (
              <span
                className="grid h-7 w-7 shrink-0 place-items-center rounded-[9px] text-black"
                style={{ background: METAL, boxShadow: METAL_SHADOW }}
              >
                <ListMusic size={13} strokeWidth={2.2} />
              </span>
            )}
            <div className="min-w-0">
              <div className="truncate font-mono text-[10px] tracking-[0.32em] text-white/85">
                {activeFolder ? activeFolder.name : 'PLAYLISTS'}
              </div>
              <div className="mt-1 truncate font-mono text-[8px] tracking-[0.24em] text-white/32">
                {activeFolder
                  ? `${String(folderTracks.length).padStart(2, '0')} TRACKS · ${fmtDur(folderSeconds)}`
                  : `${String(folders.length).padStart(2, '0')} PLAYLISTS · ${String(totalTracks).padStart(2, '0')} TRACKS`}
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {/* player settings — crossfade + volume normalisation live here,
                in a section that unfolds under the header rail */}
            <button
              onClick={() => setPsOpen((o) => !o)}
              aria-label="Player settings"
              aria-expanded={psOpen}
              title="Player settings — crossfade, volume normalisation"
              className={`grid h-7 w-7 place-items-center rounded-[9px] border transition-all duration-200 active:scale-95 ${
                psOpen
                  ? 'border-emerald-300/45 bg-emerald-400/10 text-emerald-200'
                  : 'border-white/10 bg-white/[0.04] text-white/55 hover:border-white/30 hover:bg-white/[0.09] hover:text-white'
              }`}
            >
              <Settings2 size={13} />
            </button>
            <button
              onClick={() => {
                /* a small + in the header, not a dialog: the playlist is
                   created and its row opens with the name selected, so the
                   whole act is "type, Enter" */
                setActiveFolderId(null)
                const id = onCreateFolder()
                window.setTimeout(() => startRename(id), 0)
              }}
              aria-label="New playlist"
              title="New playlist"
              className="grid h-7 w-7 place-items-center rounded-[9px] border border-white/10 bg-white/[0.04] text-white/55 transition-all duration-200 hover:border-white/30 hover:bg-white/[0.09] hover:text-white active:scale-95"
            >
              <Plus size={13} strokeWidth={2.4} />
            </button>
            <button
              onClick={close}
              aria-label="Close playlists"
              className="grid h-7 w-7 place-items-center rounded-[9px] border border-white/10 bg-white/[0.04] text-white/50 transition-all duration-200 hover:border-white/30 hover:bg-white/[0.09] hover:text-white active:scale-95"
            >
              <X size={13} />
            </button>
          </div>
          <span className="pointer-events-none absolute inset-x-4 bottom-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent" />
          <span className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-b from-transparent to-black/25" />
        </div>

        {/* player settings — a section of the drawer, in its own glass language:
            crossfade blends a track's end into the next, normalisation evens
            out loud and quiet records */}
        {psOpen && (
          <div className="mx-3 mb-3 rounded-[14px] border border-white/10 bg-gradient-to-br from-white/[0.055] to-white/[0.02] p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.07),0_6px_20px_rgba(0,0,0,0.4)]">
            <div className="mb-2 font-mono text-[8px] tracking-[0.28em] text-white/45">PLAYER SETTINGS</div>

            <div className="flex items-center justify-between gap-2 py-1">
              <span className="font-mono text-[9px] tracking-[0.15em] text-white/75">CROSSFADE</span>
              <button
                aria-label="Toggle crossfade"
                aria-pressed={playerSettings.crossfade}
                onClick={() => onPlayerSetting('crossfade', !playerSettings.crossfade)}
                className={`relative h-4 w-8 shrink-0 rounded-full transition-colors ${
                  playerSettings.crossfade ? 'bg-emerald-400/80' : 'bg-white/15'
                }`}
              >
                <span
                  className="absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all"
                  style={{ left: playerSettings.crossfade ? 18 : 2 }}
                />
              </button>
            </div>
            <div className="mb-1 flex items-center gap-1.5">
              {[0, 3, 5, 8].map((s) => (
                <button
                  key={s}
                  onClick={() => onPlayerSetting('crossfadeSec', s)}
                  aria-pressed={playerSettings.crossfadeSec === s}
                  title={s === 0 ? 'No crossfade' : `${s}-second blend`}
                  className={`flex-1 rounded-md py-1 font-mono text-[8px] tracking-[0.08em] transition ${
                    playerSettings.crossfadeSec === s
                      ? 'text-black'
                      : 'border border-white/10 bg-white/[0.03] text-white/50 hover:border-white/25 hover:text-white'
                  }`}
                  style={playerSettings.crossfadeSec === s ? { background: METAL, boxShadow: METAL_SHADOW } : undefined}
                >
                  {s}s
                </button>
              ))}
            </div>
            <p className="mb-2 font-mono text-[7px] leading-relaxed tracking-[0.1em] text-white/25">
              A TRACK'S END BLENDS INTO THE NEXT ONE'S START.
            </p>

            <div className="flex items-center justify-between gap-2 py-1">
              <span className="min-w-0 font-mono text-[9px] leading-tight tracking-[0.15em] text-white/75">
                NORMALIZE VOLUME
              </span>
              <button
                aria-label="Toggle volume normalisation"
                aria-pressed={playerSettings.normalize}
                onClick={() => onPlayerSetting('normalize', !playerSettings.normalize)}
                className={`relative h-4 w-8 shrink-0 rounded-full transition-colors ${
                  playerSettings.normalize ? 'bg-emerald-400/80' : 'bg-white/15'
                }`}
              >
                <span
                  className="absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all"
                  style={{ left: playerSettings.normalize ? 18 : 2 }}
                />
              </button>
            </div>
            <p className="mb-2 font-mono text-[7px] leading-relaxed tracking-[0.1em] text-white/25">
              {playerSettings.normalize
                ? 'A QUIET TRACK IS LIFTED, A LOUD ONE LEFT — SAME PERCEIVED LOUDNESS.'
                : 'EVEN OUT LOUD AND QUIET TRACKS AUTOMATICALLY.'}
            </p>

            {/* display choices that belong to the PLAYER, not the wallpaper:
                how the panes are painted, and whose colours the interface
                wears. Both used to sit in the wallpaper panel. */}
            <GlassSwitch />

            <div className="flex items-center justify-between gap-2 py-1">
              <span className="min-w-0 font-mono text-[9px] leading-tight tracking-[0.15em] text-white/75">
                ACCENT FROM ART
              </span>
              <button
                aria-label="Tint the interface with the playing track's colours"
                aria-pressed={accentArt}
                onClick={() => onAccentArt(!accentArt)}
                className={`relative h-4 w-8 shrink-0 rounded-full transition-colors ${
                  accentArt ? 'bg-emerald-400/80' : 'bg-white/15'
                }`}
              >
                <span
                  className="absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all"
                  style={{ left: accentArt ? 18 : 2 }}
                />
              </button>
            </div>
            <p className="font-mono text-[7px] leading-relaxed tracking-[0.1em] text-white/25">
              {accentArt
                ? 'THE SEEKBAR AND THE PLAYING ROW WEAR THE COVER’S COLOURS.'
                : 'THE INTERFACE STAYS ON THE DECK’S OWN COLOURS.'}
            </p>
          </div>
        )}

        {/* keyed on the open playlist: entering/leaving a folder remounts this
            view, which replays the slide-in and lets every row stagger in */}
        <div key={activeFolder?.id ?? 'root'} className="playlist-view flex-1 overflow-y-auto px-3 pb-4 pt-3">
          {activeFolder === null ? (
            <>
              <div className="relative mb-3">
                <Search
                  size={11}
                  className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-white/30"
                />
                <input
                  value={listSearch}
                  onChange={(e) => setListSearch(e.target.value)}
                  placeholder="SEARCH PLAYLISTS OR TRACKS…"
                  className={`w-full rounded-full border border-white/10 bg-black/35 py-2.5 pl-8 pr-3 font-mono text-[9px] tracking-[0.18em] text-white placeholder:text-white/25 outline-none transition-all duration-200 focus:border-white/30 focus:bg-black/50 ${SEAM}`}
                />
              </div>

              <button
                onClick={() => {
                  onSelectFolder(null)
                  setActiveFolderId(null)
                }}
                className={`mb-2 flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-all duration-300 ${SLED} ${SLED_HOVER} ${
                  selectedFolderId === null ? 'ring-1 ring-emerald-300/35' : ''
                }`}
              >
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-[10px] border border-white/10 bg-white/[0.04] text-white/60">
                  <ListMusic size={13} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-[10px] tracking-[0.2em] text-white/85">
                    ALL TRACKS
                  </span>
                  <span className="mt-0.5 block font-mono text-[8px] tracking-[0.18em] text-white/30">
                    THE WHOLE LIBRARY
                  </span>
                </span>
                <span className="shrink-0 font-mono text-[9px] tabular-nums tracking-[0.1em] text-white/35">
                  {String(library.length).padStart(2, '0')}
                </span>
              </button>

              {folders.length === 0 && (
                <div className="mt-8 text-center font-mono text-[9px] leading-relaxed tracking-[0.2em] text-white/25">
                  NO PLAYLISTS YET
                  <br />
                  CREATE ONE TO GROUP TRACKS
                </div>
              )}

              {folders
                .filter((f) => {
                  const q = listSearch.trim().toLowerCase()
                  if (!q) return true
                  if (f.name.toLowerCase().includes(q)) return true
                  return f.trackIds.some((id) => {
                    const t = trackById(id)
                    return (
                      t && (t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q))
                    )
                  })
                })
                .map((f, fi) => {
                  const count = f.trackIds.length
                  const removing = removingFolderId === f.id
                  const selected = f.id === selectedFolderId
                  return (
                    <div
                      key={f.id}
                      style={{ animationDelay: removing ? '0ms' : `${Math.min(fi, 8) * 24}ms` }}
                      className={`${removing ? 'playlist-row-out' : 'playlist-row-in'} group relative mb-2 flex w-full items-center gap-2.5 rounded-xl border py-2.5 pl-3 pr-2 transition-all duration-300 ${
                        selected
                          ? 'border-white/25 bg-gradient-to-br from-white/[0.10] to-white/[0.03] shadow-[0_8px_24px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.10)]'
                          : `${SLED} ${SLED_HOVER}`
                      }`}
                    >
                      {/* selected rail — matches the active-row accent in the tracklist */}
                      {selected && (
                        <span className="pointer-events-none absolute left-0 top-2 bottom-2 w-[2px] rounded-full bg-gradient-to-b from-[#7dd8ff] via-[#c99cff] to-[#ff9dd8] opacity-80" />
                      )}
                      <button
                        onClick={() => {
                          onSelectFolder(f.id)
                          setActiveFolderId(f.id)
                        }}
                        className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-[10px] border border-white/15 bg-black/30 shadow-[inset_0_1px_0_rgba(255,255,255,0.10)]"
                        aria-label={`Open ${f.name}`}
                      >
                        {f.image ? (
                          <img src={f.image} alt="" className="h-full w-full rounded-[10px] object-cover" />
                        ) : collage(f).length >= 2 ? (
                          <span className="grid h-full w-full grid-cols-2 grid-rows-2 overflow-hidden rounded-[10px]">
                            {collage(f).map((c, ci) => (
                              <img key={ci} src={c} alt="" className="h-full w-full object-cover" />
                            ))}
                          </span>
                        ) : collage(f).length === 1 ? (
                          <img
                            src={collage(f)[0]}
                            alt=""
                            className="h-full w-full rounded-[10px] object-cover"
                          />
                        ) : f.id === FAVOURITES_FOLDER_ID ? (
                          <Heart size={13} className="fill-rose-300/80 text-rose-300/80" />
                        ) : (
                          <ListMusic size={13} className="text-white/35" />
                        )}
                      </button>
                      {renaming?.id === f.id ? (
                        <div className="min-w-0 flex-1">
                          <input
                            autoFocus
                            value={renaming.name ?? f.name}
                            onFocus={(e) => e.currentTarget.select()}
                            onChange={(e) => setRenaming({ id: f.id, name: e.target.value })}
                            onBlur={commitRename}
                            onKeyDown={(e) => {
                              e.stopPropagation()
                              if (e.key === 'Enter') commitRename()
                              else if (e.key === 'Escape') setRenaming(null)
                            }}
                            spellCheck={false}
                            aria-label="Playlist name"
                            className={`w-full rounded-lg border border-white/35 bg-black/60 px-1.5 py-1 font-mono text-[10px] tracking-[0.18em] text-white outline-none ${SEAM}`}
                          />
                        </div>
                      ) : (
                        <button
                          onClick={() => {
                            onSelectFolder(f.id)
                            setActiveFolderId(f.id)
                          }}
                          className="min-w-0 flex-1 text-left"
                        >
                          <span className="block truncate font-mono text-[10px] tracking-[0.18em] text-white/85 transition-colors duration-200 group-hover:text-white">
                            {f.name}
                          </span>
                          <span className="mt-0.5 block font-mono text-[8px] tracking-[0.18em] text-white/32">
                            {String(count).padStart(2, '0')} TRACK{count === 1 ? '' : 'S'}
                          </span>
                        </button>
                      )}
                      <div className="flex shrink-0 items-center gap-1 opacity-0 transition-all duration-200 group-hover:opacity-100 group-focus-within:opacity-100">
                        <GlassButton
                          title="Play all"
                          onClick={() => onPlayAll(f.id)}
                          className="hover:border-emerald-300/45 hover:text-emerald-200"
                        >
                          <Play size={11} />
                        </GlassButton>
                        <span data-folder-menu className="relative">
                          <GlassButton
                            title="Playlist actions"
                            label="Playlist actions"
                            onClick={() => setFolderMenuId(folderMenuId === f.id ? null : f.id)}
                          >
                            <MoreHorizontal size={12} />
                          </GlassButton>
                          {folderMenuId === f.id && (
                            <div className="absolute right-0 top-full z-50 mt-1 w-40 overflow-hidden rounded-md border border-white/10 bg-[#101014] py-1 shadow-[0_14px_40px_rgba(0,0,0,0.65)]">
                              {[
                                {
                                  label: 'RENAME',
                                  run: () => startRename(f.id),
                                },
                                {
                                  label: 'DUPLICATE',
                                  run: () => {
                                    onDuplicateFolder(f.id)
                                    setFolderMenuId(null)
                                  },
                                },
                                {
                                  label: 'POSTER / DETAILS',
                                  run: () => {
                                    setFolderMenuId(null)
                                    startFolderEdit(f)
                                  },
                                },
                                {
                                  label: 'EXPORT .M3U8',
                                  run: () => {
                                    exportFolder(f)
                                    setFolderMenuId(null)
                                  },
                                },
                              ].map((it) => (
                                <button
                                  key={it.label}
                                  className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left font-mono text-[9px] tracking-[0.15em] text-white/60 transition hover:bg-white/10 hover:text-white"
                                  onClick={it.run}
                                >
                                  {it.label}
                                </button>
                              ))}
                              {/* Downloads Online is a system playlist — the
                                  download sync files into it by id, so the
                                  delete option does not exist for it */}
                              {f.id !== DOWNLOADS_FOLDER_ID && (
                                <button
                                  className="flex w-full items-center gap-2 border-t border-white/10 px-2.5 py-1.5 text-left font-mono text-[9px] tracking-[0.15em] text-rose-300/70 transition hover:bg-white/10 hover:text-rose-300"
                                  onClick={() => {
                                    setFolderMenuId(null)
                                    removeFolderAnimated(f.id)
                                  }}
                                >
                                  DELETE
                                </button>
                              )}
                            </div>
                          )}
                        </span>
                      </div>
                    </div>
                  )
                })}
            </>
          ) : (
            <>
              {/* playlist identity — poster, name, runtime */}
              <div className={`mb-3 flex items-center gap-3 rounded-xl border p-2.5 ${SLED} ${SEAM}`}>
                <span className="grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-[10px] border border-white/15 bg-black/30">
                  {activeFolder.image ? (
                    <img src={activeFolder.image} alt="" className="h-full w-full object-cover" />
                  ) : collage(activeFolder).length >= 2 ? (
                    <span className="grid h-full w-full grid-cols-2 grid-rows-2 overflow-hidden rounded-[10px]">
                      {collage(activeFolder).map((c, ci) => (
                        <img key={ci} src={c} alt="" className="h-full w-full object-cover" />
                      ))}
                    </span>
                  ) : collage(activeFolder).length === 1 ? (
                    <img
                      src={collage(activeFolder)[0]}
                      alt=""
                      className="h-full w-full rounded-[10px] object-cover"
                    />
                  ) : activeFolder.id === FAVOURITES_FOLDER_ID ? (
                    <Heart size={16} className="fill-rose-300/80 text-rose-300/80" />
                  ) : (
                    <ListMusic size={16} className="text-white/30" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-mono text-[10px] tracking-[0.22em] text-white/85">
                    {activeFolder.name}
                  </div>
                  <div className="mt-1 font-mono text-[8px] tracking-[0.2em] text-white/32">
                    {String(folderTracks.length).padStart(2, '0')} TRACKS · {fmtDur(folderSeconds)}
                  </div>
                </div>
              </div>

              <div className="mb-3 flex items-center gap-2">
                <button
                  onClick={() => activeFolder && onPlayAll(activeFolder.id)}
                  disabled={!folderTracks.length}
                  className="flex flex-1 items-center justify-center gap-2 rounded-full py-2.5 font-mono text-[9px] tracking-[0.25em] text-black transition-transform duration-150 hover:scale-[1.01] active:scale-[0.985] disabled:scale-100 disabled:opacity-30"
                  style={{ background: METAL, boxShadow: METAL_SHADOW }}
                >
                  <Play size={11} strokeWidth={2.5} />
                  PLAY ALL
                </button>
                <button
                  onClick={() => activeFolder && folderFileInputRef.current?.click()}
                  title="Upload audio file to this playlist"
                  aria-label="Upload audio file to this playlist"
                  className="grid h-9 w-9 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-white/50 transition-all duration-200 hover:border-white/30 hover:bg-white/[0.09] hover:text-white active:scale-95"
                >
                  <Upload size={12} />
                </button>
                {/* same rule in the open-folder view: the system playlist
                    carries no delete button at all */}
                {activeFolder.id !== DOWNLOADS_FOLDER_ID && (
                  <button
                    onClick={() => activeFolder && removeFolderAnimated(activeFolder.id)}
                    title="Delete playlist"
                    aria-label="Delete playlist"
                    className="grid h-9 w-9 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-white/40 transition-all duration-200 hover:border-red-400/40 hover:bg-red-500/10 hover:text-red-300 active:scale-95"
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </div>

              <div className="relative mb-3">
                <Search
                  size={11}
                  className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-white/30"
                />
                <input
                  value={trackSearch}
                  onChange={(e) => setTrackSearch(e.target.value)}
                  placeholder="SEARCH TRACKS…"
                  className={`w-full rounded-full border border-white/10 bg-black/35 py-2.5 pl-8 pr-3 font-mono text-[9px] tracking-[0.18em] text-white placeholder:text-white/25 outline-none transition-all duration-200 focus:border-white/30 focus:bg-black/50 ${SEAM}`}
                />
              </div>

              {folderTracks.length === 0 && (
                <div className="py-6 text-center font-mono text-[8px] tracking-[0.2em] text-white/20">
                  EMPTY — ADD TRACKS BELOW
                </div>
              )}

              {folderTracks
                .map((t, i) => ({ t, i }))
                .filter(({ t }) => {
                  const q = trackSearch.trim().toLowerCase()
                  if (!q) return true
                  return (
                    t.title.toLowerCase().includes(q) || t.artist.toLowerCase().includes(q)
                  )
                })
                .map(({ t, i }) => {
                  const libIdx = library.findIndex((x) => x.id === t.id)
                  const isCurrent = libIdx === currentIndex
                  const removing = removingTrackId === t.id
                  return (
                    <div
                      key={t.id}
                      onDragOver={(e) => {
                        e.preventDefault()
                        setOverIndex(i)
                      }}
                      onDrop={onDrop(i)}
                      style={{ animationDelay: removing ? '0ms' : `${Math.min(i, 8) * 24}ms` }}
                      className={`${removing ? 'playlist-row-out' : 'playlist-row-in'} group relative mb-1 flex h-14 items-center gap-2 overflow-hidden rounded-lg pl-1.5 pr-1.5 transition-all duration-300 ${
                        isCurrent
                          ? 'bg-gradient-to-r from-white/[0.09] to-white/[0.02] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]'
                          : 'hover:bg-white/[0.045]'
                      } ${overIndex === i && dragIndex !== null && dragIndex !== i ? 'shadow-[inset_0_2px_0_rgba(110,231,183,0.55)]' : ''}`}
                    >
                      {isCurrent && (
                        <span className="playlist-select pointer-events-none absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-full bg-gradient-to-b from-[#7dd8ff] via-[#c99cff] to-[#ff9dd8]" />
                      )}
                      <span
                        draggable
                        onDragStart={(e) => {
                          setDragIndex(i)
                          e.dataTransfer.effectAllowed = 'move'
                        }}
                        onDragEnd={() => {
                          setDragIndex(null)
                          setOverIndex(null)
                        }}
                        className={`grid h-8 w-5 shrink-0 cursor-grab place-items-center rounded text-white/20 transition hover:text-white/60 active:cursor-grabbing ${
                          dragIndex === i ? 'opacity-40' : ''
                        }`}
                        title="Drag to reorder"
                      >
                        <GripVertical size={13} />
                      </span>
                      <button
                        onClick={() => activeFolderId !== null && onPlayTrack(activeFolderId, i)}
                        className="flex min-w-0 flex-1 items-center gap-2.5 text-left"
                      >
                        {t.cover ? (
                          <img
                            src={t.cover}
                            alt=""
                            className="h-9 w-9 shrink-0 rounded-md border border-white/15 object-cover shadow-[0_4px_12px_rgba(0,0,0,0.45)]"
                          />
                        ) : (
                          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-white/10 bg-white/[0.04]">
                            <ListMusic size={12} className="text-white/30" />
                          </div>
                        )}
                        <span className="min-w-0 flex-1">
                          <span
                            className={`block truncate text-[12px] font-semibold tracking-wide ${
                              isCurrent ? 'text-white' : 'text-white/75 group-hover:text-white'
                            }`}
                          >
                            {t.title}
                          </span>
                          <span className="mt-0.5 block truncate font-mono text-[8px] tracking-[0.14em] text-white/32">
                            {t.artist}
                          </span>
                        </span>
                        <span className="shrink-0 font-mono text-[9px] tabular-nums text-white/30">
                          {fmtDur(durations.get(t.src) ?? 0)}
                        </span>
                        {isCurrent && playing && (
                          <span className="flex h-3 shrink-0 items-end gap-[2px]">
                            {[0, 1, 2].map((b) => (
                              <span
                                key={b}
                                className="w-[2px] animate-pulse rounded-full bg-emerald-300"
                                style={{ height: 4 + b * 3, animationDelay: `${b * 150}ms` }}
                              />
                            ))}
                          </span>
                        )}
                      </button>
                      <div className="flex shrink-0 items-center gap-1 opacity-0 transition-all duration-200 group-hover:opacity-100 group-focus-within:opacity-100">
                        <GlassButton
                          title={isNextUp(t.id) ? 'Remove from play-next queue' : 'Play next'}
                          label={isNextUp(t.id) ? 'Remove from play-next queue' : 'Play next'}
                          armed={isNextUp(t.id)}
                          onClick={() => onToggleNext(t.id)}
                        >
                          <ListPlus size={11} />
                        </GlassButton>
                        <GlassButton
                          title={isFavourite(t.id) ? 'Remove from favourites' : 'Add to favourites'}
                          label={isFavourite(t.id) ? 'Remove from favourites' : 'Add to favourites'}
                          onClick={() => onToggleFavourite(t.id)}
                          className={isFavourite(t.id) ? 'border-rose-300/40 bg-rose-400/10 text-rose-200' : ''}
                        >
                          <Heart size={11} className={isFavourite(t.id) ? 'fill-rose-300' : ''} />
                        </GlassButton>
                        <GlassButton
                          title="Edit track (title / artist / poster)"
                          onClick={(e) => openTrackEdit(t, e.currentTarget.getBoundingClientRect())}
                        >
                          <Pencil size={11} />
                        </GlassButton>
                        <GlassButton title="Remove from playlist" danger onClick={() => removeTrackAnimated(t.id)}>
                          <X size={11} />
                        </GlassButton>
                      </div>
                    </div>
                  )
                })}

              <div className="relative mt-3 border-t border-white/[0.08] pt-2.5">
                <button
                  onClick={() => setAddingTo(addingTo === activeFolderId ? null : activeFolderId)}
                  className={`flex w-full items-center justify-center gap-2 rounded-full border border-white/10 bg-white/[0.03] py-2 font-mono text-[8px] tracking-[0.22em] text-white/45 transition-all duration-200 hover:border-white/25 hover:bg-white/[0.07] hover:text-white/80 ${SEAM}`}
                >
                  <Plus size={10} />
                  ADD TRACKS
                  <ChevronDown
                    size={10}
                    className={`transition-transform duration-300 ${addingTo === activeFolderId ? 'rotate-180' : ''}`}
                  />
                </button>
                {addingTo === activeFolderId && (
                  <div className="pop-in mt-2 max-h-44 overflow-y-auto rounded-xl border border-white/12 bg-[#0b0b10]/95 p-1 shadow-[0_18px_40px_rgba(0,0,0,0.6),inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-xl">
                    {library.filter((t) => !activeFolder?.trackIds.includes(t.id)).length === 0 && (
                      <div className="px-2 py-2 text-center font-mono text-[8px] tracking-[0.15em] text-white/25">
                        ALL TRACKS ADDED
                      </div>
                    )}
                    {library
                      .filter((t) => !activeFolder?.trackIds.includes(t.id))
                      .map((t) => (
                        <button
                          key={t.id}
                          onClick={() => activeFolderId !== null && onAddTrack(activeFolderId, t.id)}
                          className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors duration-150 hover:bg-white/[0.07]"
                        >
                          {t.cover ? (
                            <img
                              src={t.cover}
                              alt=""
                              className="h-5 w-5 shrink-0 rounded border border-white/10 object-cover"
                            />
                          ) : (
                            <span className="grid h-5 w-5 shrink-0 place-items-center rounded border border-white/10 bg-white/[0.04]">
                              <ListMusic size={9} className="text-white/30" />
                            </span>
                          )}
                          <span className="min-w-0 flex-1 truncate text-[10px] text-white/65">
                            {t.title}
                          </span>
                          <Plus size={9} className="shrink-0 text-white/30" />
                        </button>
                      ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
      {editTrack && (
        <TrackMetaEditor
          track={editTrack.track}
          anchor={editTrack.anchor}
          onClose={closeTrackEdit}
          onSave={commitTrackEdit}
        />
      )}
      {editFolderId !== null && (
        <div
          className="fixed inset-0 z-[95] flex items-center justify-center bg-black/65 backdrop-blur-sm"
          onClick={closeFolderEdit}
        >
          <div
            className="pop-in w-[300px] rounded-2xl border border-white/15 p-4 backdrop-blur-xl"
            style={{
              background:
                'linear-gradient(180deg, rgba(24,25,32,0.98) 0%, rgba(9,9,12,0.98) 100%)',
              boxShadow:
                'inset 0 1px 0 rgba(255,255,255,0.10), 0 30px 70px rgba(0,0,0,0.8)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <span className="font-mono text-[9px] tracking-[0.28em] text-white/55">EDIT PLAYLIST</span>
              <button
                onClick={closeFolderEdit}
                aria-label="Cancel"
                className="grid h-6 w-6 place-items-center rounded-md text-white/40 transition hover:bg-white/10 hover:text-white"
              >
                <X size={12} />
              </button>
            </div>

            <label className="mb-1 block font-mono text-[8px] tracking-[0.2em] text-white/35">NAME</label>
            <input
              value={editFolderName}
              onChange={(e) => setEditFolderName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitFolderEdit()
              }}
              spellCheck={false}
              className={`mb-4 w-full rounded-lg border border-white/15 bg-white/[0.05] px-2.5 py-1.5 text-sm text-white outline-none transition-colors duration-200 focus:border-white/40 ${SEAM}`}
            />

            <label className="mb-1 block font-mono text-[8px] tracking-[0.2em] text-white/35">POSTER</label>
            <div className="mb-4 flex items-center gap-2.5">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-white/15 bg-white/[0.04] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
                {editFolderCover ? (
                  <img src={editFolderCover} alt="" className="h-full w-full object-cover" />
                ) : (
                  <span className="font-mono text-[8px] tracking-[0.15em] text-white/20">NO POSTER</span>
                )}
              </div>
              <div className="flex flex-1 flex-col gap-1.5">
                <button
                  onClick={() => folderCoverInputRef.current?.click()}
                  className="flex items-center justify-center gap-1.5 rounded-lg border border-white/15 bg-white/[0.05] px-2 py-1.5 font-mono text-[8px] tracking-[0.15em] text-white/70 transition-all duration-200 hover:border-white/30 hover:bg-white/[0.09] hover:text-white"
                >
                  <ImagePlus size={11} />
                  {editFolderCover ? 'REPLACE' : 'ADD'}
                </button>
                {editFolderCover && (
                  <button
                    onClick={() => setEditFolderCover(undefined)}
                    className="flex items-center justify-center gap-1.5 rounded-lg border border-white/15 bg-white/[0.05] px-2 py-1.5 font-mono text-[8px] tracking-[0.15em] text-white/40 transition-all duration-200 hover:border-red-400/40 hover:text-red-300"
                  >
                    <Trash2 size={11} />
                    REMOVE
                  </button>
                )}
              </div>
            </div>
            <input
              ref={folderCoverInputRef}
              type="file"
              accept="image/*"
              onChange={onFolderCoverFile}
              className="hidden"
            />

            <div className="mt-4 flex gap-2">
              <button
                onClick={commitFolderEdit}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg py-2 font-mono text-[9px] tracking-[0.2em] text-black transition-transform duration-150 hover:scale-[1.02] active:scale-95"
                style={{ background: METAL, boxShadow: METAL_SHADOW }}
              >
                <Check size={12} strokeWidth={2.5} />
                SAVE
              </button>
              <button
                onClick={closeFolderEdit}
                className="flex flex-1 items-center justify-center rounded-lg border border-white/15 py-2 font-mono text-[9px] tracking-[0.2em] text-white/40 transition hover:border-white/30 hover:text-white"
              >
                CANCEL
              </button>
            </div>
          </div>
        </div>
      )}
      {/* delete → undo, rather than asking before it happens */}
      {undoFolder && (
        <div className="pop-in absolute bottom-5 left-1/2 z-[96] flex -translate-x-1/2 items-center gap-3 rounded-full border border-white/15 bg-[#101014]/95 py-2 pl-4 pr-2 shadow-[0_18px_44px_rgba(0,0,0,0.7)] backdrop-blur-xl">
          <span className="max-w-[180px] truncate font-mono text-[9px] tracking-[0.16em] text-white/55">
            “{undoFolder.folder.name}” DELETED
          </span>
          <button
            onClick={undoDelete}
            className="rounded-full px-3 py-1 font-mono text-[9px] tracking-[0.2em] text-black transition-transform duration-150 hover:scale-105 active:scale-95"
            style={{ background: METAL, boxShadow: METAL_SHADOW }}
          >
            UNDO
          </button>
          <button
            onClick={() => setUndoFolder(null)}
            aria-label="Dismiss"
            className="grid h-6 w-6 place-items-center rounded-full text-white/40 transition hover:bg-white/10 hover:text-white"
          >
            <X size={11} />
          </button>
        </div>
      )}
      <input
        ref={folderFileInputRef}
        type="file"
        accept=".mp3,.flac,.wav,.ogg,.oga,.m4a,.m4b,.aac,.opus,.wma,.aiff,.aif,.ape,.mp4,.mka,.amr,.mid,.midi,.wv,.tta,audio/*"
        multiple
        className="hidden"
        onChange={onFolderFileChange}
      />
    </div>,
    document.body,
  )
}
