import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Play, X, Maximize, Minimize, ImagePlus, SlidersHorizontal, Pencil, Mic2, Settings2, Radio, Pin, PinOff, ListMusic, Heart, Globe } from 'lucide-react'
import { useLyrics, type LyricsMode } from '../features/lyrics/useLyrics'
import { useRadio, getRadioElement } from '../features/radio/useRadio'
import { loadLocalLyrics, saveLocalLyrics, deleteLocalLyrics, loadTrackOffset, saveTrackOffset, deleteTrackOffset, type LocalLyrics } from '../lib/library'
import { getCurrentWindow, currentMonitor, PhysicalSize, PhysicalPosition } from '@tauri-apps/api/window'
import { useAudioEngine, type Track } from '../hooks/useAudioEngine'
import { usePlaylist, openFilePicker, filesFromDrop } from '../features/playlist/usePlaylist'
import { useWallpaper, THEMES, AURORA_BG, AURORA_BAND_BG } from '../features/wallpaper/useWallpaper'
import { useDiscArt } from '../features/disc/useDiscArt'
import { analyze } from 'web-audio-beat-detector'
import { ensureEyeEngine } from '../lib/eyeEngine'
import { signalBootReady } from '../lib/bootGate'
import { cleanTitle } from '../lib/utils'
import { safeMode } from '../lib/safeMode'
import FrameBars from '../components/FrameBars'
import discUrl from '../assets/disc.png'
import chromeUrl from '../assets/chrome.png'
import DiscCase from '../components/DiscCase'
import ChromeVisualizer from '../components/ChromeVisualizer'
import CreatorMenu from '../components/CreatorMenu'
import Transport from '../components/Transport'
import PlaylistPanel, { type TrackSort, type RowDensity } from '../components/PlaylistPanel'
import PerfMeters from '../components/PerfMeters'
import CdSettingsPanel from '../components/CdSettingsPanel'
import TrackMetaEditor from '../components/TrackMetaEditor'
import RadioPanel from '../components/RadioPanel'
import VisualizerPanel from '../components/VisualizerPanel'
import { useVisualizer } from '../features/visualizer/useVisualizer'
import VoltVizBackdrop from '../features/voltviz/VoltVizBackdrop'
import { useVoltViz } from '../features/voltviz/useVoltViz'
import { visualizers as VOLT_STYLES } from '../features/voltviz/registry'
import { FramePainter } from '../features/visualizer/frames'
import LyricsPanel from '../components/LyricsPanel'
import LyricsSettingsPanel from '../components/LyricsSettingsPanel'
import LyricsEditor from '../components/LyricsEditor'
import WallpaperSettingsPanel from '../components/WallpaperSettingsPanel'
import PlaylistDrawer from '../components/PlaylistDrawer'
import DannifyWindow, { type DannifyHandle } from '../features/dannify/DannifyWindow'
import { useDannifySync } from '../features/dannify/useDannifySync'
import { onDannifyDownloadsDone } from '../features/dannify/downloads'
import ColorPicker from '../components/ColorPicker'
import { usePlaylists } from '../features/playlist/usePlaylists'

/* heavy subtrees re-render only when their own props change — the
   timeupdate-driven re-renders stop at the memo boundary */
const DiscCaseMemo = memo(DiscCase)
const ChromeVisualizerMemo = memo(ChromeVisualizer)

type AudioEngine = ReturnType<typeof useAudioEngine>

export default function Home() {
  /* engine is created below from the playlist's tracks, but the playlist
     drives it through this ref — no hook-ordering cycle */
  const engRef = useRef<AudioEngine | null>(null)
  const playlist = usePlaylist(engRef)
  const eng = useAudioEngine(playlist.tracks)
  const wall = useWallpaper({ setImportHint: playlist.setImportHint })
  const discArt = useDiscArt()
  const lyrics = useLyrics()
  const playlists = usePlaylists()
  /* the live backdrop picked from the visualiser panel — a VoltViz style,
     reading the deck's own analyser, behind everything else */
  const volt = useVoltViz()
  /* the live visual's own name — for the header's circle while one is on */
  const voltName = VOLT_STYLES.find((v) => v.id === volt.style)?.name ?? 'off'
  /* the mounted visual's own settings api, when its module has one */
  const [vizApi, setVizApi] = useState<Record<string, (...args: never[]) => unknown> | null>(null)
  /* the radio's own switch for the same backdrop: ON restores the last
     visual that was picked (or the first one), OFF sends it away — the
     station's element is already on the deck's analyser, so a live station
     drives the visual the moment it is on air */
  const lastVoltRef = useRef<string | null>(null)
  const toggleVolt = useCallback(
    (on: boolean) => {
      if (on) {
        const pick = lastVoltRef.current ?? VOLT_STYLES[0]?.id ?? null
        volt.setStyle(pick)
      } else {
        if (volt.style) lastVoltRef.current = volt.style
        volt.setStyle(null)
      }
    },
    [volt],
  )

  /* HIDE UI — the visual takes the whole window: every panel, button and
     header fades out of the way while a live visual is on the screen. The
     option only exists while a visual is picked (the key is dead otherwise),
     and turning the visual off restores the chrome by itself rather than
     leaving a blank window nobody can reach. */
  const [uiHidden, setUiHidden] = useState(false)
  const uiHiddenRef = useRef(uiHidden)
  useEffect(() => {
    uiHiddenRef.current = uiHidden
    document.body.classList.toggle('hide-ui', uiHidden)
  }, [uiHidden])
  useEffect(() => {
    if (!volt.style && uiHidden) setUiHidden(false)
  }, [volt.style, uiHidden])
  /* Songs saved in the online extension are saved here too: its own
     "Downloads Online" playlist, played from this player's deck. */
  const dannifySync = useDannifySync({
    addSavedTrack: playlist.addSavedTrack,
    addToDownloads: playlists.addToDownloads,
  })
  /* A download finishing in the extension is news the moment its file
     exists: the extension says so on its own socket, and the pass runs right
     then — not at the next minute's tick, and not only when the window is
     finally closed. The pass takes only what is new, so the extra calls a
     batch produces cost one list read each. */
  const syncDannify = dannifySync.sync
  useEffect(() => onDannifyDownloadsDone(() => void syncDannify()), [syncDannify])
  /* stable function aliases — keeps the callbacks below from depending on
     the hook's fresh result object (which would re-create them every render) */
  const {
    deleteFolder: deletePlaylistFolder,
    addTrackToFolder,
    removeTrackFromFolder,
    forgetTrack,
    reorderTracks: reorderFolderTracks,
    isFavourite,
    toggleFavourite,
  } = playlists
  const { addFiles: addLibraryFiles, removeTrackAt, reorderTracks: reorderLibraryTracks } = playlist
  const [playlistOpen, setPlaylistOpen] = useState(false)
  /* the online extension — its own app, its own player, its own library */
  const [dannifyOpen, setDannifyOpen] = useState(false)
  const [colorPickerOpen, setColorPickerOpen] = useState(false)

  /* ── play-next queue ──────────────────────────────────────────────────
     Library track ids that jump the line, played before the natural order
     (library auto-advance or the selected playlist's order). Held in a ref
     because the track-end handler is subscribed once and must read the live
     queue without re-subscribing, mirrored into state so rows can show the
     badge and the header can show the count. */
  const [nextUp, setNextUp] = useState<number[]>([])
  const nextUpRef = useRef<number[]>([])
  const syncNextUp = useCallback((next: number[]) => {
    nextUpRef.current = next
    setNextUp(next)
  }, [])
  const toggleNextUp = useCallback(
    (trackId: number) => {
      const has = nextUpRef.current.includes(trackId)
      syncNextUp(has ? nextUpRef.current.filter((id) => id !== trackId) : [...nextUpRef.current, trackId])
    },
    [syncNextUp],
  )
  /* pop the head; null when the queue is empty */
  const takeNextUp = useCallback((): number | null => {
    const head = nextUpRef.current[0]
    if (head == null) return null
    syncNextUp(nextUpRef.current.slice(1))
    return head
  }, [syncNextUp])

  /* the playlist currently being viewed. The main tracklist is a VIEW of
     this folder, not a snapshot taken when playback started — that is what
     keeps both panels in sync while tracks are added, removed or reordered.
     PERSISTED: the disc keeps showing the playlist you were in, and its poster
     keeps driving the disc face, across reloads. */
  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(() => {
    const raw = localStorage.getItem('md-selected-playlist')
    if (raw == null) return null
    const n = Number(raw)
    return Number.isFinite(n) ? n : null
  })
  const selectedFolderIdRef = useRef<number | null>(null)
  useEffect(() => {
    if (selectedFolderId == null) localStorage.removeItem('md-selected-playlist')
    else localStorage.setItem('md-selected-playlist', String(selectedFolderId))
  }, [selectedFolderId])
  useEffect(() => {
    selectedFolderIdRef.current = selectedFolderId
  }, [selectedFolderId])

  const selectedFolder = useMemo(
    () =>
      selectedFolderId == null
        ? null
        : playlists.folders.find((f) => f.id === selectedFolderId) ?? null,
    [playlists.folders, selectedFolderId],
  )

  /* The tracklist's search, sort and row size. They live here rather than in
     the panel because `visibleTracks` IS the list every handler acts on:
     filtering or sorting inside the panel would hand select/remove/reorder
     indices that no longer match this array. */
  const [listQuery, setListQuery] = useState('')
  const [listSort, setListSort] = useState<TrackSort>('manual')
  /* grouping is a view too: grouping by artist orders the list by artist,
     so the panel's header always sits on the run it names */
  const [groupBy, setGroupBy] = useState<'none' | 'artist'>('none')
  const [listDensity, setListDensity] = useState<RowDensity>(() =>
    localStorage.getItem('md-row-density') === 'compact' ? 'compact' : 'comfortable',
  )
  useEffect(() => {
    localStorage.setItem('md-row-density', listDensity)
  }, [listDensity])

  const visibleTracks = useMemo(() => {
    const base = !selectedFolder
      ? playlist.tracks
      : selectedFolder.trackIds
          .map((id) => playlist.tracks.find((t) => t.id === id))
          .filter((t): t is Track => !!t)
    const q = listQuery.trim().toLowerCase()
    const filtered = q
      ? base.filter(
          (t) => cleanTitle(t.title).toLowerCase().includes(q) || t.artist.toLowerCase().includes(q),
        )
      : base
    const byTitle = (a: Track, b: Track) =>
      cleanTitle(a.title).localeCompare(cleanTitle(b.title)) || a.artist.localeCompare(b.artist)
    const byArtist = (a: Track, b: Track) =>
      a.artist.localeCompare(b.artist) || byTitle(a, b)
    if (groupBy === 'artist') return [...filtered].sort(byArtist)
    if (listSort === 'manual') return filtered
    const sorted = [...filtered]
    if (listSort === 'title') sorted.sort(byTitle)
    else if (listSort === 'artist') sorted.sort(byArtist)
    else sorted.reverse() /* newest first — imports append */
    return sorted
  }, [selectedFolder, playlist.tracks, listQuery, listSort, groupBy])

  const libIndex = useCallback(
    (trackId: number) => playlist.tracks.findIndex((t) => t.id === trackId),
    [playlist.tracks],
  )

  /* the chips above the tracklist: the whole library first, then every
     playlist — switching is one click and never opens the drawer */
  const chipList = useMemo(
    () => [
      { id: null as number | null, name: 'ALL' },
      ...playlists.folders.map((f) => ({ id: f.id as number | null, name: f.name })),
    ],
    [playlists.folders],
  )

  /* deleting the selected playlist drops the selection (falling back to the
     full library) instead of leaving its tracks stranded on the main page */
  useEffect(() => {
    if (selectedFolderId == null) return
    if (playlists.folders.some((f) => f.id === selectedFolderId)) return
    setSelectedFolderId(null)
  }, [playlists.folders, selectedFolderId])

  /* auto-advance follows the view: with a playlist selected the engine stays
     out of it and the track-end handler below walks the folder's order. A
     pending play-next queue also takes the engine out of it — the handler
     owns the transition until the queue drains. */
  useEffect(() => {
    engRef.current?.setAutoAdvance(selectedFolderId == null && nextUp.length === 0)
  }, [selectedFolderId, nextUp.length])

  /* what the engine is playing right now — read by the queue handler when a
     track ends, without adding the playhead to every dependency array */
  const currentTrackIdRef = useRef<number | null>(null)
  const repeatModeRef = useRef<'off' | 'all' | 'one'>(eng.repeat)
  useEffect(() => {
    currentTrackIdRef.current = playlist.tracks[eng.trackIndex]?.id ?? null
  }, [playlist.tracks, eng.trackIndex])
  useEffect(() => {
    repeatModeRef.current = eng.repeat
  }, [eng.repeat])

  const selectFolder = useCallback((folderId: number | null) => setSelectedFolderId(folderId), [])

  const playFolderTrack = useCallback(
    (folderId: number, idx: number) => {
      const folder = playlists.folders.find((f) => f.id === folderId)
      if (!folder) return
      setSelectedFolderId(folderId)
      const trackId = folder.trackIds[idx]
      const li = libIndex(trackId)
      if (li === -1) return
      engRef.current?.setAutoAdvance(false)
      engRef.current?.select(li)
    },
    [playlists.folders, libIndex],
  )

  const playAll = useCallback(
    (folderId: number) => {
      const folder = playlists.folders.find((f) => f.id === folderId)
      if (!folder) return
      setSelectedFolderId(folderId)
      if (!folder.trackIds.length) return
      playFolderTrack(folderId, 0)
    },
    [playlists.folders, playFolderTrack],
  )

  const deleteFolder = useCallback(
    (folderId: number) => {
      deletePlaylistFolder(folderId)
      setSelectedFolderId((cur) => (cur === folderId ? null : cur))
    },
    [deletePlaylistFolder],
  )

  /* next/prev walk the selected playlist rather than the whole library.
     FORWARD first honours the play-next queue, in every view. */
  const stepVisible = useCallback(
    (dir: 1 | -1) => {
      const engine = engRef.current
      if (!engine) return
      if (dir === 1) {
        const queued = takeNextUp()
        if (queued != null) {
          const qi = libIndex(queued)
          if (qi !== -1) {
            engine.select(qi)
            return
          }
        }
      }
      if (selectedFolderId == null) {
        if (dir === 1) engine.next()
        else engine.prev()
        return
      }
      const folder = playlists.folders.find((f) => f.id === selectedFolderId)
      if (!folder || !folder.trackIds.length) return
      const curId = currentTrackIdRef.current
      const at = curId == null ? -1 : folder.trackIds.indexOf(curId)
      let next = at + dir
      if (next >= folder.trackIds.length) next = 0
      if (next < 0) next = folder.trackIds.length - 1
      const li = libIndex(folder.trackIds[next])
      if (li !== -1) engine.select(li)
    },
    [selectedFolderId, playlists.folders, libIndex, takeNextUp],
  )

  /* a playlist track ending advances inside the playlist, honouring repeat.
     `eng` is used directly here (not engRef): the subscription must exist on
     the FIRST commit, long before the ref-assignment effect below runs. */
  const engineSelect = eng.select
  const engineSubscribeTrackEnd = eng.subscribeTrackEnd
  useEffect(() => {
    return engineSubscribeTrackEnd(() => {
      /* a queued track wins over both the library order and the folder */
      const queued = takeNextUp()
      if (queued != null) {
        const qi = libIndex(queued)
        if (qi !== -1) {
          engineSelect(qi)
          return
        }
      }
      if (selectedFolderId == null) return /* library: engine auto-advances */
      const folder = playlists.folders.find((f) => f.id === selectedFolderId)
      if (!folder || !folder.trackIds.length) return
      const curId = currentTrackIdRef.current
      const at = curId == null ? -1 : folder.trackIds.indexOf(curId)
      let next = at + 1
      if (next >= folder.trackIds.length) {
        if (repeatModeRef.current === 'off') return
        next = 0
      }
      const li = libIndex(folder.trackIds[next])
      if (li !== -1) engineSelect(li)
    })
  }, [engineSubscribeTrackEnd, engineSelect, selectedFolderId, playlists.folders, libIndex, takeNextUp])

  /* upload a brand-new audio file straight into a playlist folder */
  const uploadToFolder = useCallback(
    async (folderId: number, file: File) => {
      const track = await playlist.importFile(file)
      if (track) playlists.addTrackToFolder(folderId, track.id)
    },
    [playlist, playlists],
  )

  /* imported/dropped files join the playlist being viewed, so they appear in
     the main tracklist (and the drawer) immediately */
  const addFilesToView = useCallback(
    (files: FileList | File[] | null) => {
      const folderId = selectedFolderIdRef.current
      void addLibraryFiles(
        files,
        folderId == null ? undefined : (track) => addTrackToFolder(folderId, track.id),
      )
    },
    [addLibraryFiles, addTrackToFolder],
  )

  useEffect(() => {
    engRef.current = eng
  }, [eng])

  /* the boot gate holds its exit on these — art decoded, fonts swapped and
     the audio graph built BEFORE the shutters reveal the player, so the
     first visible frame is already smooth instead of warming up */
  useEffect(() => {
    const decode = (src: string) =>
      new Promise<void>((res) => {
        const img = new Image()
        img.onload = () => {
          const p = img.decode?.()
          if (p) p.then(() => res(), () => res())
          else res()
        }
        img.onerror = () => res()
        img.src = src
      })
    const fontsReady = async () => {
      try {
        /* explicit loads first — bare fonts.ready can resolve before the
           families have even started loading, letting the boot reveal swap
           fonts mid-frame */
        await document.fonts.load('400 16px "Space Grotesk"')
        await document.fonts.load('700 16px "JetBrains Mono"')
        await document.fonts.ready
      } catch {
        /* offline / blocked — reveal with fallbacks rather than hang */
      }
    }
    /* neither a decode nor `document.fonts.load` rejects when it stalls — the
       font stylesheet can sit pending for as long as the network takes, and
       the boot gate would wait on it. The watchdog opens the gate anyway. */
    const assetWatchdog = window.setTimeout(() => signalBootReady('assets'), 3500)
    void Promise.all([decode(discUrl), decode(chromeUrl), fontsReady()])
      .catch(() => {})
      .finally(() => {
        window.clearTimeout(assetWatchdog)
        signalBootReady('assets')
      })
    engRef.current?.prewarm()
    signalBootReady('audio')
  }, [])

  /* ref objects are pulled off the hook results by DESTRUCTURING and aliased
     before JSX: handing a `hook().refProp` member read straight to a ref
     attribute (or into a local via member read) makes the react-hooks
     compiler treat the owning object as ref-tainted, so every later
     property read of it (~80 of them) gets flagged as
     "Cannot access refs during render" — destructuring keeps it clean */
  const { fileInputRef: fileInputEl, m3uInputRef: m3uInputEl } = playlist
  const { wallInputRef: wallInputEl, wallVideoRef: wallVideoEl, wallVideoElRef } = wall

  const allTracks = playlist.tracks
  /* standby placeholder keeps the UI intact while the playlist is empty */
  const track = allTracks[eng.trackIndex] ?? {
    id: -1,
    title: 'NO DISC',
    artist: 'INSERT MEDIA',
    genre: 'STANDBY',
    src: '',
  }
  const dragDepth = useRef(0)
  const [dropping, setDropping] = useState(false)
  /* which track the metadata editor is editing (null = closed) + the trigger
     rect the card anchors to. One editor instance serves both the now-playing
     header and the tracklist rows, so they can never open two at once */
  const [metaEdit, setMetaEdit] = useState<{ index: number; anchor: DOMRect } | null>(null)
  const openMetaEdit = useCallback((index: number, anchor: DOMRect) => {
    setMetaEdit({ index, anchor })
  }, [])
  const closeMetaEdit = useCallback(() => setMetaEdit(null), [])
  /* ONLY real file drags (from Explorer/Finder) may open the drop overlay.
     Playlist rows are HTML5-draggable for reordering, and long-pressing the
     CD art or selecting text also starts native drags — all of those used to
     hijack the window with the "DROP AUDIO FILES" overlay and swallow the
     drop. `Files` in dataTransfer.types is true only for OS file drags. */
  const isFileDrag = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes('Files')

  /* the CD's rainbow sheens always run reactive — the DEFAULT/MUSIC-REACTIVE
     switch was removed from settings because both modes drew the same layers
     and the only difference was whether their hue-rotate chased the bass. */
  const cdReactive = true
  const [cdVisible, setCdVisibleState] = useState(() => localStorage.getItem('md-cd-visible') !== '0')
  const setCdVisible = useCallback((on: boolean) => {
    setCdVisibleState(on)
    localStorage.setItem('md-cd-visible', on ? '1' : '0')
  }, [])
  /* CD assembly brightness — lives on the stage wrapper (case + halo) as a
     filter applied ONLY when ≠100, so the default path pays nothing; kept
     off the case's 3D tree so the chrome arms keep their z-depth */
  const [cdBrightness, setCdBrightnessState] = useState(() => {
    const n = Number(localStorage.getItem('md-cd-brightness'))
    return Number.isFinite(n) && n >= 40 && n <= 150 ? n : 100
  })
  const setCdBrightness = useCallback((v: number) => {
    setCdBrightnessState(v)
    localStorage.setItem('md-cd-brightness', String(v))
  }, [])
  /* disc rotation multiplier — 0 parks the disc, 1 is the natural BPM cruise,
     2 doubles it. Compressed to one row of presets (no slider: the disc's
     speed is already sampled from BPM, so a fine slider is wasted steps) */
  const DISC_SPEEDS = [0, 0.25, 0.5, 0.75, 1, 1.5, 2]
  const [cdSpeed, setCdSpeedState] = useState(() => {
    const n = Number(localStorage.getItem('md-cd-speed'))
    return DISC_SPEEDS.includes(n) ? n : 1
  })
  const setCdSpeed = useCallback((v: number) => {
    setCdSpeedState(v)
    localStorage.setItem('md-cd-speed', String(v))
  }, [])
  const [discBpmEntry, setDiscBpmEntry] = useState<{ src: string; bpm: number } | null>(null)
  const [cdSettingsOpen, setCdSettingsOpen] = useState(false)
  /* settings panel exit: keep mounted ~160ms while the close animation plays */
  const [cdSettingsClosing, setCdSettingsClosing] = useState(false)

  /* ---- lyrics ----
     `lyricMode` resolves the live position: two of the three sit on or beside
     the disc and only apply while it is shown, and with the CD hidden the stage
     box is the only thing left to fill, so that one takes over by itself. */
  const lyricMode: LyricsMode = cdVisible ? lyrics.align : 'stage'
  const [lyricsSettingsOpen, setLyricsSettingsOpen] = useState(false)
  const [lyricsSettingsClosing, setLyricsSettingsClosing] = useState(false)
  /* where the gear was when pressed — the panel opens at it, not at a fixed
     corner of the page */
  const [lyricsSettingsPos, setLyricsSettingsPos] = useState<{ x: number; y: number } | null>(null)
  const [lyricsEditorOpen, setLyricsEditorOpen] = useState(false)

  /* hide/show the whole CD assembly (disc + chrome arms + case + sheens) —
     a viewing preference, persisted like the other cd settings */
  /* every keyboard shortcut, offable in one switch */
  const [shortcuts, setShortcutsState] = useState(() => localStorage.getItem('md-shortcuts') !== '0')
  const setShortcuts = useCallback((on: boolean) => {
    setShortcutsState(on)
    localStorage.setItem('md-shortcuts', on ? '1' : '0')
  }, [])
  /* where the disc's face art comes from right now — one derivation feeds both
     the disc and the CD settings readout, so they can never disagree */
  const discArtSource: 'playlist' | 'track' | 'custom' | 'stock' =
    discArt.playlistArt && selectedFolder?.image
      ? 'playlist'
      : discArt.trackArt && track.cover
        ? 'track'
        : discArt.url
          ? 'custom'
          : 'stock'
  const activeDiscArt =
    discArtSource === 'playlist'
      ? selectedFolder?.image ?? null
      : discArtSource === 'track'
        ? track.cover ?? null
        : discArtSource === 'custom'
          ? discArt.url
          : null
  const [radioOpen, setRadioOpen] = useState(false)
  /* long-press bookkeeping for the radio trigger */
  const holdTimerRef = useRef(0)
  const heldRef = useRef(false)
  /* a stream takes over the output, so the library is stopped the moment one
     starts — two engines on one endpoint is just noise */
  const radio = useRadio(
    useCallback(() => {
      engRef.current?.stop()
    }, []),
  )

  /* a local track taking over the output must silence the radio stream
     and clear its now-playing so the lyrics panel switches back to the track.

     This must key on the ENGINE actually playing, not on any radio change:
     depending on the whole `radio` object (a fresh object every render) ran
     this effect the moment a station went live, so it immediately stopped
     the station it had just started. Starting radio also calls onStart(),
     which stops the local engine first, so `eng.playing` is false at that
     point and this effect stays out of the way. */
  const radioPauseStream = radio.pauseStream
  const radioClearSong = radio.clearSong

  /* ── the visualiser ────────────────────────────────────────────────────
     The engine is native and does the drawing; this side owns the AUDIO and
     the choices. The frames come back as a canvas behind the player when it
     is in backdrop mode — the painter is a plain object, not state, because a
     frame arrives sixty times a second and React must never see it. */
  const [visualizerOpen, setVisualizerOpen] = useState(false)
  const painterRef = useRef<FramePainter | null>(null)
  const visCanvasRef = useRef<HTMLCanvasElement | null>(null)
  /* the painter is made on first use, never during a render */
  const getPainter = useCallback(() => {
    if (!painterRef.current) painterRef.current = new FramePainter()
    return painterRef.current
  }, [])
  const radioUrl = radio.current?.url ?? null
  const visualizer = useVisualizer({
    getAnalyser: eng.getAnalyser,
    radioUrl,
    radioPlaying: radio.playing,
    onFrame: (f) => getPainter().offer(f),
  })
  useEffect(() => {
    getPainter().attach(visCanvasRef.current)
    return () => painterRef.current?.attach(null)
  }, [visualizer.mode, visualizer.frameSeen, getPainter])
  useEffect(() => {
    if (!radio.playing) return
    if (!eng.playing) return
    if (playlist.tracks.length === 0) return
    /* pause the stream, not stop(): the station stays tuned, so pressing play
       in the radio panel brings the same one back instead of an empty panel */
    radioPauseStream()
    radioClearSong()
  }, [radio.playing, eng.playing, playlist.tracks.length, radioPauseStream, radioClearSong])

  /* The extension's own player is a third source of sound, living in a frame
     this player cannot reach into. The frame reports its play and pause
     across (features/dannify/DannifyWindow), so the two obey the same rule
     as the deck and the station: it plays, this side goes quiet; this side
     plays, the frame is told to fall silent. */
  const dannifyRef = useRef<DannifyHandle | null>(null)
  const onDannifyAudio = useCallback(
    (playing: boolean) => {
      if (!playing) return
      engRef.current?.stop()
      if (radio.playing) {
        radioPauseStream()
        radioClearSong()
      }
    },
    [radio.playing, radioPauseStream, radioClearSong],
  )
  useEffect(() => {
    if (eng.playing || radio.playing) dannifyRef.current?.pause()
  }, [eng.playing, radio.playing])

  /* The radio plays on an element of its own, so the deck's analyser would
     read silence for the length of a station — the backdrop, the halo and the
     mini equaliser would all sit still while it played. The moment a station
     is picked, the analyser is told to watch that element too. */
  useEffect(() => {
    if (!radio.current) return
    eng.attachSource(getRadioElement())
  }, [radio.current, eng.attachSource])

  /* where the now-playing track sits in the visible list (-1 when the
     selected playlist does not contain it) */
  const activeVisibleIndex =
    track.id >= 0 ? visibleTracks.findIndex((t) => t.id === track.id) : -1

  /* the tracklist always speaks in visible indices; the engine speaks in
     library indices, so every user action crosses this boundary once */
  const selectVisibleTrack = useCallback(    (visibleIndex: number) => {
      const t = visibleTracks[visibleIndex]
      if (!t) return
      const li = playlist.tracks.findIndex((x) => x.id === t.id)
      if (li === -1) return
      radioClearSong()
      engRef.current?.select(li)
    },
    [visibleTracks, playlist.tracks, radioClearSong],
  )

  /* play-next works on ids (stable across reorders); the main list hands us
     a visible index, the drawer hands us the id directly */
  const isNextUp = useCallback((trackId: number) => nextUp.includes(trackId), [nextUp])
  const toggleNextVisible = useCallback(
    (visibleIndex: number) => {
      const t = visibleTracks[visibleIndex]
      if (t) toggleNextUp(t.id)
    },
    [visibleTracks, toggleNextUp],
  )

  /* removing a track from the drawer's playlist view. Deletion must not be
     a silence switch (1.10):
       - the track is PLAYING  → it keeps playing after its row is gone (the
         file still lives in the library — only the folder listing changed);
       - the track is PAUSED   → the playhead parks on the folder's NEXT
         track, so RESUME starts there rather than on the deleted file.
     The radio is never touched: deleting a library row has nothing to do
     with the station that is on air. */
  const removeFolderTrack = useCallback(
    (folderId: number, trackId: number) => {
      const engine = engRef.current
      const isCurrent = trackId === currentTrackIdRef.current && folderId === selectedFolderIdRef.current
      const wasPlaying = !!engine?.playing
      const folder = playlists.folders.find((f) => f.id === folderId)
      const ids = folder?.trackIds ?? []
      const at = ids.indexOf(trackId)
      const rest = ids.filter((id) => id !== trackId)
      removeTrackFromFolder(folderId, trackId)
      /* a deleted track must not linger in the play-next queue */
      if (isNextUp(trackId)) toggleNextUp(trackId)
      if (!isCurrent || !engine) return
      if (wasPlaying) return /* it keeps playing — only the row is gone */
      if (rest.length === 0) {
        engine.stop()
        return
      }
      /* paused: park on the slot the victim leaves (wrap to the first) */
      const nextId = rest[Math.min(Math.max(at, 0), rest.length - 1)]
      const li = libIndex(nextId)
      if (li !== -1) engine.select(li, false)
    },
    [removeTrackFromFolder, playlists.folders, libIndex, isNextUp, toggleNextUp],
  )

  /* removing from the main list is contextual: a playlist view removes the
     track from that playlist, the library view deletes it everywhere.

     Either way the playback rules are1.10's: a track that is PLAYING keeps
     playing after removal, and a track that is PAUSED parks the playhead on
     the next one so RESUME starts there. Deletion is not a silence switch —
     the old "stop the output" behaviour is exactly what this replaces. */
  const removeVisibleAt = useCallback(
    (visibleIndex: number) => {
      const t = visibleTracks[visibleIndex]
      if (!t) return
      if (selectedFolderId != null) {
        removeFolderTrack(selectedFolderId, t.id)
        return
      }
      const li = playlist.tracks.findIndex((x) => x.id === t.id)
      if (li === -1) return
      /* the victim must not stay queued — only that one entry is dropped,
         the rest of the play-next queue survives the deletion */
      if (isNextUp(t.id)) toggleNextUp(t.id)
      removeTrackAt(li)
      forgetTrack(t.id)
    },
    [
      visibleTracks,
      selectedFolderId,
      removeFolderTrack,
      forgetTrack,
      playlist.tracks,
      removeTrackAt,
      isNextUp,
      toggleNextUp,
    ],
  )

  const reorderVisible = useCallback(
    (from: number | null, to: number) => {
      if (from == null || from === to) return
      if (selectedFolderId != null) reorderFolderTracks(selectedFolderId, from, to)
      else reorderLibraryTracks(from, to)
    },
    [selectedFolderId, reorderFolderTracks, reorderLibraryTracks],
  )

  const openVisibleMetaEdit = useCallback(
    (visibleIndex: number, anchor: DOMRect) => {
      const t = visibleTracks[visibleIndex]
      if (!t) return
      const li = playlist.tracks.findIndex((x) => x.id === t.id)
      if (li !== -1) openMetaEdit(li, anchor)
    },
    [visibleTracks, playlist.tracks, openMetaEdit],
  )

  const lyricsApiRef = useRef<import('../components/LyricsPanel').LyricsApi | null>(null)
  /* a stored TTML string for the current track. When present it is fed to the
     component's `ttml` property, which renders it with NO network request —
     that is what makes a pin permanent and makes hand-edited lyrics stick */
  const [localLyrics, setLocalLyrics] = useState<LocalLyrics | null>(null)
  const trackId = track.id >= 0 ? String(track.id) : ''

  /* sync offset is per track and always starts at 0 — a track that has never
     been corrected must never inherit the previous one's value. Loaded per
     trackId, so switching is a reload, not a carry-over. */
  const [lyricOffset, setLyricOffset] = useState(0)

  useEffect(() => {
    if (!trackId) {
      setLocalLyrics(null)
      return
    }
    let alive = true
    void loadLocalLyrics(trackId).then((rec) => {
      if (alive) setLocalLyrics(rec)
    })
    void loadTrackOffset(trackId).then((ms) => {
      if (alive) setLyricOffset(ms / 1000)
    })
    return () => {
      alive = false
    }
  }, [trackId])

  const applyLyricOffset = useCallback(
    (v: number) => {
      setLyricOffset(v)
      if (trackId) void saveTrackOffset(trackId, Math.round(v * 1000))
    },
    [trackId],
  )

  /* pin / unpin the CURRENT track's lyrics, shared by the quick button and the
     lyrics settings panel so the two can never disagree */
  const pinLyrics = useCallback(async () => {
    if (!trackId) return
    /* The element is rebuilt on every track change and then has to fetch, so
       there is a window where nothing has loaded and PIN used to return
       silently without storing anything. Wait it out instead. */
    for (let i = 0; i < 4; i++) {
      const ttml = lyricsApiRef.current?.extractTtml() ?? ''
      if (ttml) break
      await new Promise((r) => window.setTimeout(r, 300))
    }
    const ttml = lyricsApiRef.current?.extractTtml() ?? ''
    if (!ttml) return
    const ok = await saveLocalLyrics({
      key: trackId,
      title: track.title,
      artist: track.artist,
      ttml,
      source: lyricsApiRef.current?.source() ?? 'server',
      custom: false,
      savedAt: Date.now(),
    })
    if (ok) setLocalLyrics(await loadLocalLyrics(trackId))
  }, [trackId, track.title, track.artist])

  const unpinLyrics = useCallback(async () => {
    if (!trackId) return
    await deleteLocalLyrics(trackId)
    /* unpinning is a reset: the track goes back to fetching lyrics, so its
       sync correction goes back to 0 too */
    await deleteTrackOffset(trackId)
    setLyricOffset(0)
    setLocalLyrics(null)
  }, [trackId])

  const toggleCdSettings = useCallback(() => {
    if (cdSettingsOpen) {
      setCdSettingsClosing(true)
      return
    }
    setCdSettingsClosing(false)
    setCdSettingsOpen(true)
  }, [cdSettingsOpen])
  const onCdSettingsClosed = useCallback(() => {
    setCdSettingsOpen(false)
    setCdSettingsClosing(false)
  }, [])
  const bpmCacheRef = useRef<Map<string, number>>(new Map())
  const bpmGenRef = useRef(0)
  /* derived, never set synchronously inside an effect: a track switch shows
     "no bpm" instantly (mismatched src → null) while the cached/analyzed
     value for the CURRENT track lands whenever it is ready */
  const discBpm = discBpmEntry && track.src === discBpmEntry.src ? discBpmEntry.bpm : null

  /* bpm → disc speed: analyze each track once, cache by source.
     gated on playback — paused browsing must never fetch+decode a file */
  useEffect(() => {
    const src = track.src
    if (!src) return
    const cached = bpmCacheRef.current.get(src)
    if (cached) {
      /* deferred by a tick on purpose: a synchronous setState here is exactly
         what react-hooks/set-state-in-effect flags */
      const t = window.setTimeout(() => setDiscBpmEntry({ src, bpm: cached }), 0)
      return () => window.clearTimeout(t)
    }
    if (!eng.playing) return
    const gen = ++bpmGenRef.current
    /* deferred: the track transition stays butter-smooth, analysis lands later;
       then idle-gated again — decode + analyze are hundreds of ms of pure CPU
       and must never collide with the intro reveal or a disc interaction */
    const timer = window.setTimeout(() => {
      const run = async () => {
        try {
          const buf = await fetch(src).then((r) => r.arrayBuffer())
          if (gen !== bpmGenRef.current) return
          /* decode at 22050Hz — half the data, same BPM accuracy */
          const offline = new OfflineAudioContext(1, 1, 22050)
          const audioBuf = await offline.decodeAudioData(buf)
          if (gen !== bpmGenRef.current) return
          const bpm = await analyze(audioBuf)
          if (gen !== bpmGenRef.current) return
          const rounded = Math.max(60, Math.round(bpm))
          bpmCacheRef.current.set(src, rounded)
          setDiscBpmEntry({ src, bpm: rounded })
        } catch {
          /* bpm unknown — the disc keeps its default cruise speed */
        }
      }
      window.requestIdleCallback(() => void run(), { timeout: 3000 })
    }, 3500)
    return () => {
      bpmGenRef.current++
      window.clearTimeout(timer)
    }
  }, [track.src, eng.playing])

  /* hard-refresh flag: Ctrl+Shift+R arms the wipe for the NEXT boot —
     lib/bootReset.ts runs it at module load, before any state initializes */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && e.code === 'KeyR') localStorage.setItem('md-hard-reset', '1')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  /* fullscreen — window-level (Tauri), not the DOM API: the window API needs
     NO user gesture, so a refresh/hard-reset restores fullscreen instantly
     instead of waiting for the first click. `resize` covers every change
     (button, F key, Esc) because going fullscreen resizes the webview.
     `getCurrentWindow()` builds a NEW object per call — pin ONE instance in
     a ref, or these effects re-run every render (the restore effect would
     then re-fire mid-exit and slam fullscreen right back on). */
  const [isFullscreen, setIsFullscreen] = useState(false)
  const appWindowRef = useRef<ReturnType<typeof getCurrentWindow> | null>(null)
  appWindowRef.current ??= getCurrentWindow()
  const appWindow = appWindowRef.current
  useEffect(() => {
    /* label/state sync ONLY — the ui-fullscreen intent flag is written by
       toggleFullscreen alone: a mid-transition resize can still read the old
       state, and re-arming the flag here would resurrect it on next boot */
    const sync = async () => {
      try {
        setIsFullscreen(await appWindow.isFullscreen())
      } catch {
        /* keep last known state */
      }
    }
    void sync()
    window.addEventListener('resize', sync)
    return () => window.removeEventListener('resize', sync)
  }, [appWindow])

  /* restore the remembered intent once the boot exit finishes — verify and
     retry: a single setFullscreen at cold start can land before the window
     is ready and fail silently, which is why "closed while fullscreen" used
     to reopen windowed. Each pass checks first, sets, then re-checks */
  useEffect(() => {
    if (localStorage.getItem('ui-fullscreen') !== '1') return
    let timer = 0
    let cancelled = false
    const wait = (ms: number) =>
      new Promise<void>((r) => {
        timer = window.setTimeout(r, ms)
      })
    const go = async () => {
      for (let i = 0; i < 4 && !cancelled; i++) {
        try {
          if (await appWindow.isFullscreen()) return
          await appWindow.setFullscreen(true)
        } catch {
          /* try again below */
        }
        await wait(400)
        if (cancelled) return
        try {
          if (await appWindow.isFullscreen()) return
        } catch {
          /* next pass */
        }
      }
    }
    const start = () => void go()
    if (document.getElementById('boot')?.classList.contains('gone')) start()
    else window.addEventListener('bootdone', start, { once: true })
    return () => {
      cancelled = true
      window.clearTimeout(timer)
      window.removeEventListener('bootdone', start)
    }
  }, [appWindow])

  /* entering fullscreen eases the window rect into the monitor over ~360ms
     (size + position each frame) and only THEN flips the OS flag. A native
     switch slams every full-screen layer (wallpaper glow/vignette/blend, vh
     layout) into a new resolution in one frame — that one-frame raster storm
     IS the 1-3s "pixels settling" crawl. After the ease the window already
     covers the monitor, so the final flag flip is size-neutral. A generation
     token cancels an in-flight ease if the user toggles mid-animation.
     Exit stays native: the OS restores the previous rect instantly. */
  const fsAnimRef = useRef(0)
  const animateFullscreen = useCallback(async () => {
    const gen = ++fsAnimRef.current
    const DUR = 360
    try {
      const mon = await currentMonitor()
      if (!mon) throw new Error('no monitor')
      const [from, fromPos] = await Promise.all([appWindow.outerSize(), appWindow.outerPosition()])
      const to = mon.size
      const toPos = mon.position
      if (Math.abs(from.width - to.width) < 4 && Math.abs(from.height - to.height) < 4) {
        await appWindow.setFullscreen(true)
        return
      }
      await new Promise<void>((resolve) => {
        const t0 = performance.now()
        const step = (now: number) => {
          if (fsAnimRef.current !== gen) {
            resolve()
            return
          }
          const k = Math.min(1, (now - t0) / DUR)
          const e = 1 - Math.pow(1 - k, 3) /* easeOutCubic: fast start, soft landing */
          const lerp = (a: number, b: number) => Math.round(a + (b - a) * e)
          void appWindow
            .setSize(new PhysicalSize(lerp(from.width, to.width), lerp(from.height, to.height)))
            .catch(() => {})
          void appWindow
            .setPosition(new PhysicalPosition(lerp(fromPos.x, toPos.x), lerp(fromPos.y, toPos.y)))
            .catch(() => {})
          if (k < 1) requestAnimationFrame(step)
          else resolve()
        }
        requestAnimationFrame(step)
      })
      if (fsAnimRef.current === gen) await appWindow.setFullscreen(true)
    } catch {
      /* any step failing → fall back to the native jump */
      if (fsAnimRef.current === gen) await appWindow.setFullscreen(true).catch(() => {})
    }
  }, [appWindow])

  const toggleFullscreen = useCallback(async () => {
    const next = !isFullscreen
    setIsFullscreen(next)
    if (next) localStorage.setItem('ui-fullscreen', '1')
    else localStorage.removeItem('ui-fullscreen')
    try {
      if (next) await animateFullscreen()
      else {
        fsAnimRef.current++ /* cancel any in-flight ease */
        await appWindow.setFullscreen(false)
      }
    } catch (e) {
      /* keep the failure loud — a swallowed rejection here was what made the
         button look completely dead (missing capability) */
      console.warn('fullscreen toggle failed:', e)
      void appWindow.isFullscreen().then(setIsFullscreen).catch(() => {})
    }
  }, [appWindow, isFullscreen, animateFullscreen])

  /* F works during the boot intro too — the inline boot script owns
     keydown while #boot is up, so it re-dispatches here (and does NOT skip
     the intro) instead of the two handlers fighting */
  useEffect(() => {
    const onFs = () => void toggleFullscreen()
    window.addEventListener('md-fs-key', onFs)
    return () => window.removeEventListener('md-fs-key', onFs)
  }, [toggleFullscreen])

  /* creator contact ring — toggled ONLY by its button, with a close animation */
  const [creatorOpen, setCreatorOpen] = useState(false)
  const [creatorClosing, setCreatorClosing] = useState(false)
  const toggleCreator = useCallback(() => {
    setCreatorOpen((o) => {
      if (o) {
        setCreatorClosing(true)
        return o /* stay mounted while the closing animation plays */
      }
      return true
    })
  }, [])
  const onCreatorClosed = useCallback(() => {
    setCreatorOpen(false)
    setCreatorClosing(false)
  }, [])

  /* auto-hide cursor after 3s of inactivity (media player behavior) */
  const [cursorHidden, setCursorHidden] = useState(false)
  const cursorTimerRef = useRef<number | undefined>(undefined)
  useEffect(() => {
    const wake = () => {
      setCursorHidden(false)
      window.clearTimeout(cursorTimerRef.current)
      cursorTimerRef.current = window.setTimeout(() => setCursorHidden(true), 3000)
    }
    wake()
    window.addEventListener('pointermove', wake)
    window.addEventListener('pointerdown', wake)
    return () => {
      window.removeEventListener('pointermove', wake)
      window.removeEventListener('pointerdown', wake)
      window.clearTimeout(cursorTimerRef.current)
    }
  }, [])

  /* pre-warm the eye engine — only after the boot has exited AND the main
     thread is idle: its WebGL build (PMREM pass + texture baking) would
     otherwise land on the exact frames the shutter wipe needs, and stall
     pointer response on the freshly-revealed player */
  useEffect(() => {
    let cancelled = false
    const warm = () => {
      const go = () => {
        if (cancelled) return
        ensureEyeEngine().then((e) => {
          if (cancelled) return
          e.setActive(true)
          window.setTimeout(() => e.setActive(false), 900)
        })
      }
      window.requestIdleCallback(() => go(), { timeout: 4000 })
    }
    if (document.getElementById('boot')?.classList.contains('gone')) {
      warm()
      return
    }
    window.addEventListener('bootdone', warm, { once: true })
    return () => {
      cancelled = true
      window.removeEventListener('bootdone', warm)
    }
  }, [])

  /* P/Q fps meters moved to <PerfMeters> in the header — their half-second
     ticks used to re-render this entire page (60-100ms of script each) */

  /* title ticker.
     A CSS keyframe was used here and it was the wrong tool: the fx governor
     sets `animation: none !important` from tier 2 up to protect the frame
     budget, which silently froze every long title mid-scroll on any machine
     that was struggling. The offset is therefore driven from JS, exactly like
     the disc's spin — a transform write is a compositor operation, so it costs
     nothing to shed later and the governor has no reason to touch it. */
  const titleWrapRef = useRef<HTMLDivElement>(null)
  const [titleOverflows, setTitleOverflows] = useState(false)
  useEffect(() => {
    const wrap = titleWrapRef.current
    const h1 = wrap?.firstElementChild as HTMLElement | null
    const half = h1?.firstElementChild as HTMLElement | null
    if (!wrap || !h1 || !half) return

    let raf = 0
    let offset = 0
    let last = performance.now()
    let copyWidth = 0

    const measure = () => {
      /* ONE copy against the container. The duplicate strip is only rendered
         while overflowing, so measuring it would grow the text every pass. */
      copyWidth = half.getBoundingClientRect().width
      const overflow = copyWidth > wrap.clientWidth + 4
      setTitleOverflows(overflow)
      if (!overflow) {
        h1.style.transform = ''
        offset = 0
        if (raf) cancelAnimationFrame(raf)
        raf = 0
        return
      }
      if (raf) return
      last = performance.now()
      const step = (now: number) => {
        /* fixed px/s, so a long title travels at the same readable speed */
        const dt = Math.min((now - last) / 1000, 0.05)
        last = now
        offset = (offset + 66 * dt) % copyWidth
        h1.style.transform = `translateX(${-offset}px)`
        raf = requestAnimationFrame(step)
      }
      raf = requestAnimationFrame(step)
    }

    measure()
    const t = window.setTimeout(measure, 400) /* re-measure once fonts settle */
    window.addEventListener('resize', measure)
    return () => {
      window.clearTimeout(t)
      window.removeEventListener('resize', measure)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [track.title])

  /* play/pause — deliberately silent: a click under the music reads as noise */
  const togglePlayback = useCallback(() => {
    engRef.current?.toggle()
  }, [])

  /* ---- keyboard shortcuts ----
     One listener, attached once; the engine and the settings live in refs so
     nothing re-renders the page to keep it alive.

     `e.repeat` is dropped for EVERY action: a held key must fire once per
     physical press, otherwise volume/seek/next can trigger dozens of times from
     one hold and the whole UI stutters behind the burst.

     The whole set can be switched off in CD settings. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      /* a key landing in a text field belongs to that field, never to the
         player — the lyrics editor is full of typing */
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (localStorage.getItem('md-shortcuts') === '0') return
      /* while the boot intro is on screen its own handler owns keys — Space
         skips the boot, it must not also toggle playback */
      if (!document.getElementById('boot')?.classList.contains('gone')) return
      if (e.repeat) return

      const engine = engRef.current
      const mod = e.ctrlKey || e.metaKey
      const plus = e.code === 'Equal' || e.code === 'NumpadAdd'

      /* Ctrl+"+" — add music. Ctrl+Shift+"+" — upload wallpaper. Ctrl+W —
         upload CD art. Checked before the plain-key actions because they share
         a physical key. */
      if (mod && plus) {
        e.preventDefault()
        if (e.shiftKey) openFilePicker(wall.wallInputRef.current)
        else playlist.openAudioPicker()
        return
      }
      if (mod && e.code === 'KeyW') {
        e.preventDefault()
        discArt.inputRef.current?.click()
        return
      }

      /* Alt+C — toggle the CD. Alt+L — toggle lyrics. */
      if (e.altKey && e.code === 'KeyC') {
        e.preventDefault()
        setCdVisible(!cdVisible)
        return
      }
      if (e.altKey && e.code === 'KeyL') {
        e.preventDefault()
        lyrics.toggle()
        return
      }

      if (e.ctrlKey || e.metaKey || e.altKey) return

      /* H — Hide UI, only while a live visual is on: the chrome goes, the
         visual keeps the window. Press again to bring everything back. */
      if (e.code === 'KeyH') {
        if (volt.style || uiHiddenRef.current) {
          e.preventDefault()
          setUiHidden((h) => !h)
        }
        return
      }

      if (!engine) return

      if (e.code === 'Space') {
        e.preventDefault()
        engine.toggle()
      } else if (e.code === 'ArrowRight') {
        /* same walk the mouse Next uses: inside the selected playlist,
           wrapping to its first track — never off into another playlist */
        stepVisible(1)
      } else if (e.code === 'ArrowLeft') stepVisible(-1)
      else if (e.code === 'ArrowUp') {
        e.preventDefault()
        engine.setVolume(Math.min(1, engine.volume + 0.05))
      } else if (e.code === 'ArrowDown') {
        e.preventDefault()
        engine.setVolume(Math.max(0, engine.volume - 0.05))
      } else if (e.code === 'KeyS') engine.setShuffle(!engine.shuffle)
      else if (e.code === 'KeyR') engine.cycleRepeat()
      else if (e.code === 'KeyF') toggleFullscreen()
      /* Esc exits fullscreen (standard behavior; the toggle comment already
         promised it) — no panel listens for Escape, so nothing conflicts */
      else if (e.code === 'Escape' && isFullscreen) toggleFullscreen()
      /* easter egg: hidden scrub keys */
      else if (e.code === 'Minus') engine.seekBy(-10)
      else if (e.code === 'Equal') engine.seekBy(10)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    toggleFullscreen,
    isFullscreen,
    setCdVisible,
    cdVisible,
    lyrics,
    wall,
    playlist,
    discArt,
    volt.style,
    stepVisible,
  ])

  return (
    <div
      className={`md-root relative flex flex-col overflow-hidden bg-black text-white ${cursorHidden ? 'cursor-none' : ''}`}
      onDragEnter={(e) => {
        if (!isFileDrag(e)) return
        e.preventDefault()
        dragDepth.current++
        setDropping(true)
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={(e) => {
        if (!isFileDrag(e)) return
        dragDepth.current--
        if (dragDepth.current <= 0) {
          dragDepth.current = 0
          setDropping(false)
        }
      }}
      onDrop={(e) => {
        if (!isFileDrag(e)) return
        e.preventDefault()
        dragDepth.current = 0
        setDropping(false)
        /* resolves folder trees too — a bare dataTransfer.files drop would
           discard a dropped album folder as one non-audio file */
        void filesFromDrop(e.dataTransfer).then((files) => addFilesToView(files))
      }}
    >
      {/* drop overlay */}
      {dropping && (
        <div className="drop-overlay fx-blur pointer-events-none absolute inset-0 z-[80] flex items-center justify-center bg-black/70 backdrop-blur-sm">
          <div
            className="rounded-2xl border-2 border-dashed border-white/40 px-12 py-10 text-center"
            style={{ boxShadow: '0 0 60px rgba(140,170,255,0.15), inset 0 0 40px rgba(140,170,255,0.06)' }}
          >
            <div className="font-mono text-xs tracking-[0.35em] text-white/85">DROP AUDIO FILES</div>
            <div className="mt-2 font-mono text-[9px] tracking-[0.25em] text-white/40">
              MP3 · FLAC · WAV · OGG · M4A · AAC · FOLDERS
            </div>
          </div>
        </div>
      )}
      <input
        ref={fileInputEl}
        type="file"
        accept=".mp3,.flac,.wav,.ogg,.oga,.m4a,.m4b,.aac,.opus,.wma,.aiff,.aif,.ape,.mp4,audio/*"
        multiple
        className="hidden"
        onChange={(e) => {
          addFilesToView(e.target.files)
          e.target.value = ''
        }}
      />
      <input
        ref={wallInputEl}
        type="file"
        accept="image/*,video/mp4,video/webm,video/x-matroska,.mkv,.gif"
        className="hidden"
        onChange={(e) => {
          wall.onWallFile(e.target.files?.[0])
          e.target.value = ''
        }}
      />
      <input
        ref={m3uInputEl}
        type="file"
        accept=".m3u8,.m3u,audio/x-mpegurl"
        className="hidden"
        onChange={(e) => {
          void playlist.importM3u(e.target.files?.[0])
          e.target.value = ''
        }}
      />
      <input
        ref={discArt.inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          void discArt.pick(e.target.files?.[0])
          e.target.value = ''
        }}
      />
      {/* theme backdrop — invisible on the default black theme.
          drifts via transform (compositor-only), never repaints */}
      {wall.theme === 'aurora' && (
        <>
          {/* the moving gradient theme: a slow bloom underneath and a faster,
              brighter band on top. Two drift cycles running in opposite
              directions, so the composite never visibly repeats */}
          <div
            className="bg-layer aurora-layer pointer-events-none absolute -inset-[40%] z-0"
            style={{ background: AURORA_BG }}
          />
          <div
            className="bg-layer aurora-band pointer-events-none absolute -inset-[40%] z-0"
            style={{ background: AURORA_BAND_BG }}
          />
        </>
      )}
      {/* the wallpaper paint picked from the header swatch — a flat colour
          or a two-stop gradient, depending on what the picker left behind */}
      {wall.theme === 'color' && (
        <div className="bg-layer pointer-events-none absolute inset-0 z-0" style={{ background: wall.wallPaintCss }} />
      )}

      {/* the live backdrop: the VoltViz style picked in the visualiser panel.
          It sits ABOVE every theme paint and above a custom wallpaper — a live
          visual replaces the background rather than hiding behind it — and it
          takes the wallpaper panel's BLUR and DIM switches along with it. */}
      <VoltVizBackdrop
        style={volt.style}
        settings={volt.settings}
        onApi={setVizApi}
        getAnalyser={eng.getAnalyser}
        blur={wall.wallBlur}
        dim={wall.wallDim}
      />

      {/* custom wallpaper layer (image or muted looping video) — the <video>
          stays mounted: the WallpaperPlayer owns its src and frame counting */}
      <div
        className="bg-layer wallpaper-layer pointer-events-none absolute inset-0 z-0 overflow-hidden"
        style={{ visibility: wall.theme === 'custom' && wall.wallpaper ? 'visible' : 'hidden' }}
      >
        <video
          ref={wallVideoEl}
          muted
          loop
          playsInline
          className="absolute inset-0 h-full w-full object-cover"
          style={{
            filter: wall.wallBlur ? 'blur(6px)' : undefined,
            transform: wall.wallBlur ? 'scale(1.06)' : undefined,
            opacity: wall.wallpaper?.type === 'video' ? 1 : 0,
          }}
        />
        {wall.wallpaper?.type === 'image' && wall.wallImageUrl && (
          <img
            src={wall.wallImageUrl}
            alt=""
            className="absolute inset-0 h-full w-full object-cover"
            style={{
              filter: wall.wallBlur ? 'blur(6px)' : undefined,
              transform: wall.wallBlur ? 'scale(1.06)' : undefined,
            }}
          />
        )}
        <div className="absolute inset-0 bg-black" style={{ opacity: wall.wallpaper ? wall.wallDim / 100 : 0 }} />
      </div>

      {/* the visualiser as the app's own background. The canvas is the size
          the engine drew at and the browser scales it up — a soft upscale is
          what the original renderer did too, and it keeps the frame traffic
          small enough to leave the rest of the app alone.

          It only goes on screen once the engine has actually sent a picture:
          a canvas with nothing in it is a black rectangle over the whole
          app, and "the engine is broken" must not look like "the app is
          broken". */}
      {visualizer.mode === 'wallpaper' && visualizer.frameSeen && (
        <div
          className="bg-layer pointer-events-none absolute inset-0 z-0 overflow-hidden"
          style={
            wall.wallBlur || wall.wallDim > 0
              ? {
                  ...(wall.wallBlur
                    ? { filter: 'blur(6px)', transform: 'scale(1.06)' }
                    : {}),
                  ...(wall.wallDim > 0
                    ? { opacity: 1 - wall.wallDim / 100 }
                    : {}),
                }
              : undefined
          }
        >
          <canvas
            ref={visCanvasRef}
            className="absolute inset-0 h-full w-full object-cover"
            style={{ width: '100%', height: '100%' }}
          />
          <div className="absolute inset-0 bg-black" style={{ opacity: 0.35 }} />
        </div>
      )}

      {/* full-screen blend layers — auto-faded by the governor (tier 3+)
          while a video wallpaper can't keep the frame budget; they cost
          one raster over static backdrops but re-blend every video frame */}
      <div className="bg-layer fx-blend pointer-events-none absolute inset-0 z-[70] opacity-[0.05] mix-blend-overlay scanlines" />
      <div className="bg-layer fx-blend pointer-events-none absolute inset-0 z-[71] opacity-[0.05] grain" />
      <div className="bg-layer fx-video pointer-events-none absolute inset-0 z-[72]" style={{ boxShadow: 'inset 0 0 180px rgba(0,0,0,0.9)' }} />

      {/* header */}
      <header className="relative z-40 flex items-center justify-between px-5 py-4 font-mono text-[10px] tracking-[0.25em] text-white/75 sm:px-8">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3">
            <span className={`inline-block h-2 w-2 rounded-full ${eng.playing ? 'animate-blink bg-red-500' : 'bg-white/25'}`} />
            <span>{eng.playing ? 'REC ● PLAY' : 'STANDBY'}</span>
          </div>
          <div className="relative flex items-center gap-1.5">
            <span className="mr-1 hidden text-[9px] tracking-[0.25em] text-white/45 md:inline">THEME</span>
            {/* colour picker replaces the old flat-black swatch — the default
                black stays the boot fallback, it just is not a swatch anymore */}
            <button
              aria-label="Wallpaper colour"
              title={
                wall.hasWallPaint
                  ? `Wallpaper ${wall.wallPaint.kind === 'gradient' ? 'gradient' : 'colour'} · ${wall.wallPaintLabel} — click to reopen the picker`
                  : 'Wallpaper colour…'
              }
              onClick={() => {
                /* a saved paint is applied on the FIRST click instead of
                   forcing a second interaction: the swatch re-selects what the
                   user already chose, and the picker only edits it */
                if (wall.hasWallPaint) wall.applyWallPaint()
                setColorPickerOpen((o) => !o)
              }}
              aria-expanded={colorPickerOpen}
              className={`h-4 w-4 rounded-full transition-all duration-150 ${
                wall.theme === 'color'
                  ? 'ring-2 ring-white/60 ring-offset-2 ring-offset-black'
                  : 'ring-1 ring-white/20 hover:ring-white/45'
              }`}
              style={
                wall.hasWallPaint
                  ? { background: wall.wallPaintCss }
                  : {
                      background:
                        'conic-gradient(from 210deg,#ff5f6d,#ffc371,#7dff9d,#5fd0ff,#a95fff,#ff5fd0,#ff5f6d)',
                    }
              }
            />
            {/* the live visual's own circle — it sits beside the colour and
                gradient swatches and opens the visualiser panel that picked
                it: one circle, on or off, so the panel is always reachable
                from here */}
            <button
              aria-label="Visualiser options"
              title={
                volt.style
                  ? `Live visual: ${voltName} — click to change it`
                  : 'Visualiser options'
              }
              onClick={() => setVisualizerOpen(true)}
              className={`ml-2 h-4 w-4 rounded-full transition-all duration-150 ${
                volt.style
                  ? 'animate-liveviz ring-2 ring-emerald-400/70 ring-offset-2 ring-offset-black hover:ring-emerald-300'
                  : visualizerOpen
                    ? 'ring-2 ring-white/60 ring-offset-2 ring-offset-black'
                    : 'ring-1 ring-white/20 hover:ring-white/45'
              }`}
              style={
                volt.style
                  ? {
                      background:
                        'conic-gradient(from 180deg,#7dff9d,#5fd0ff,#a95fff,#ff5fd0,#7dff9d)',
                    }
                  : {
                      background:
                        'conic-gradient(from 210deg,rgba(255,95,109,.5),rgba(255,195,113,.5),rgba(125,255,157,.5),rgba(95,208,255,.5),rgba(169,95,255,.5),rgba(255,95,208,.5),rgba(255,95,109,.5))',
                    }
              }
            />
            {THEMES.filter((t) => t.id !== 'black').map((t) => (
              <button
                key={t.id}
                aria-label={t.label}
                title={t.label}
                onClick={() => wall.setTheme(t.id)}
                className={`h-4 w-4 rounded-full transition-all duration-150 ${
                  wall.theme === t.id ? 'ring-2 ring-white/60 ring-offset-2 ring-offset-black' : 'ring-1 ring-white/20 hover:ring-white/45'
                } ${t.aurora ? 'animate-aurora' : ''}`}
                style={t.swatch}
              />
            ))}
            <button
              aria-label="Theme: custom wallpaper"
              title={wall.wallpaper ? 'Theme: your wallpaper' : 'Add custom wallpaper (image or video)'}
              onClick={() => (wall.wallpaper ? wall.setTheme('custom') : openFilePicker(wall.wallInputRef.current))}
              className={`relative h-4 w-4 overflow-hidden rounded-full transition-all duration-150 ${
                wall.theme === 'custom' && wall.wallpaper
                  ? 'ring-2 ring-white/60 ring-offset-2 ring-offset-black'
                  : 'ring-1 ring-white/20 hover:ring-white/45'
              }`}
              style={
                wall.wallpaper?.type === 'image' && wall.wallImageUrl
                  ? { backgroundImage: `url(${wall.wallImageUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' }
                  : undefined
              }
            >
              {!wall.wallpaper && (
                <ImagePlus size={9} className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-white/60" />
              )}
              {wall.wallpaper?.type === 'video' && (
                <Play size={7} className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 fill-white/80 text-white/80" />
              )}
            </button>
            {colorPickerOpen && (
              <>
                {/* click-away layer: any click outside the card dismisses it
                    without reaching the transport underneath */}
                <button
                  aria-label="Close colour picker"
                  onClick={() => setColorPickerOpen(false)}
                  className="fixed inset-0 z-[94] cursor-default"
                />
                <div className="absolute left-0 top-7 z-[95]">
                  <ColorPicker
                    paint={wall.wallPaint}
                    onChange={wall.setWallPaint}
                    onClose={() => setColorPickerOpen(false)}
                  />
                </div>
              </>
            )}
            {wall.theme === 'custom' && wall.wallpaper && (
              <button
                aria-label="Remove wallpaper"
                title="Remove wallpaper"
                onClick={wall.removeWallpaper}
                className="grid h-4 w-4 place-items-center rounded-full text-white/40 ring-1 ring-white/20 transition hover:text-white hover:ring-white/45"
              >
                <X size={9} />
              </button>
            )}
          </div>
        </div>
        <div className="hidden sm:block">MD WALKMAN · MZ-MUN15H</div>
        <div className="flex items-center gap-4">
          <PerfMeters wallpaperVideo={wall.wallpaper?.type === 'video'} wallVideoElRef={wallVideoElRef} />
          <button
            onClick={lyrics.toggle}
            aria-label="Toggle lyrics"
            aria-pressed={lyrics.enabled}
            title={lyrics.enabled ? 'Hide lyrics' : 'Show lyrics'}
            className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[8px] tracking-[0.2em] transition ${
              lyrics.enabled
                ? 'border-emerald-300/60 bg-emerald-400/15 text-emerald-200'
                : 'border-white/15 text-white/40 hover:border-white/40 hover:text-white'
            }`}
          >
            <Mic2 size={10} />
            LYRICS
          </button>
          {lyrics.enabled && (
            <>
              {/* pin sits beside the gear it belongs to — pinning is a
                  mid-listen action and should not need the panel opening */}
              <button
                aria-label={localLyrics ? 'Unpin these lyrics' : 'Pin these lyrics'}
                title={localLyrics ? 'Unpin lyrics' : 'Pin lyrics locally'}
                onClick={() => void (localLyrics ? unpinLyrics() : pinLyrics())}
                className={`grid h-5 w-5 place-items-center rounded-full border transition ${
                  localLyrics
                    ? 'border-emerald-300/60 bg-emerald-400/15 text-emerald-200'
                    : 'border-white/15 text-white/40 hover:border-white/40 hover:text-white'
                }`}
              >
                {localLyrics ? <PinOff size={10} /> : <Pin size={10} />}
              </button>
              <button
                onClick={(e) => {
                  if (lyricsSettingsOpen) {
                    setLyricsSettingsClosing(true)
                    return
                  }
                  const r = e.currentTarget.getBoundingClientRect()
                  setLyricsSettingsPos({ x: r.left, y: r.bottom + 8 })
                  setLyricsSettingsOpen(true)
                }}
                aria-label="Lyrics settings"
                title="Lyrics settings"
                className={`grid h-5 w-5 place-items-center rounded-full border transition ${
                  lyricsSettingsOpen
                    ? 'border-white/60 text-white'
                    : 'border-white/15 text-white/40 hover:border-white/40 hover:text-white'
                }`}
              >
                <Settings2 size={10} />
              </button>
            </>
          )}
          <span className="hidden sm:inline">MDLP · SP MODE · 74MIN</span>
        </div>
      </header>

      {/* playlist drawer toggle — parked in the empty top-right corner of the
          stage (not the header) so it sits beside the tracklist it opens */}
      <button
        onClick={() => setPlaylistOpen((o) => !o)}
        aria-label="Toggle playlists"
        title={playlistOpen ? 'Hide playlists' : 'Open playlists'}
        className={`absolute right-5 top-14 z-[85] grid h-10 w-10 place-items-center rounded-full text-black transition-transform duration-150 hover:scale-105 active:scale-95 ${
          playlistOpen ? 'ring-2 ring-emerald-300/70 ring-offset-2 ring-offset-black' : ''
        }`}
        style={{
          background: 'linear-gradient(145deg,#f4f7fa 0%,#c7ccd4 40%,#9aa2ac 70%,#e8ecf1 100%)',
          boxShadow:
            'inset 0 1px 1px rgba(255,255,255,0.9), inset 0 -1px 2px rgba(0,0,0,0.25), 0 4px 14px rgba(0,0,0,0.55)',
        }}
      >
        <ListMusic size={15} strokeWidth={2} />
      </button>

      {/* the Dannify extension — the button sits beside the playlist one, in
          the same corner, so the two ways of finding music are together */}
      <button
        onClick={() => setDannifyOpen(true)}
        aria-label="Open Dannify"
        title="Open Dannify"
        className="absolute right-20 top-14 z-[85] grid h-10 w-10 place-items-center rounded-full text-black transition-transform duration-150 hover:scale-105 active:scale-95"
        style={{
          background: 'linear-gradient(145deg,#f4f7fa 0%,#c7ccd4 40%,#9aa2ac 70%,#e8ecf1 100%)',
          boxShadow:
            'inset 0 1px 1px rgba(255,255,255,0.9), inset 0 -1px 2px rgba(0,0,0,0.25), 0 4px 14px rgba(0,0,0,0.55)',
        }}
      >
        <Globe size={15} strokeWidth={2} />
      </button>

      {/* the frame bars: black bars over the wallpaper, under everything
          else, breathing with the bass (opt-in — see wallpaper settings) */}
      <FrameBars getAnalyser={eng.getAnalyser} playing={eng.playing} />

      {/* safe mode: three launches that never came up have parked the live
          wallpaper (see lib/safeMode) — say so, rather than leaving the
          reader to wonder why the background is flat */}
      {safeMode() && (
        <div className="fixed left-1/2 top-3 z-[96] flex -translate-x-1/2 items-center gap-3 rounded-full border border-amber-300/35 bg-black/85 px-4 py-1.5 shadow-[0_12px_40px_rgba(0,0,0,0.6)] backdrop-blur-md">
          <span className="font-mono text-[9px] tracking-[0.18em] text-amber-300/90">
            SAFE MODE · LIVE WALLPAPER PARKED AFTER REPEATED FAILED STARTS
          </span>
          <button
            onClick={() => window.location.reload()}
            className="rounded-full border border-amber-300/40 px-2.5 py-0.5 font-mono text-[9px] tracking-[0.16em] text-amber-200 transition hover:bg-amber-300/10"
          >
            RESTART
          </button>
        </div>
      )}

      {/* main stage */}
      <main className="relative z-30 mx-auto flex min-h-0 w-full max-w-6xl flex-1 flex-col items-center justify-center gap-8 px-5 py-4 lg:flex-row lg:gap-14">
        {/* player stage — nudged left on wide screens, playlist stays put.
            With lyrics on it slides a little further left so the overlay sits
            clear of the deck. `aspect-square` is layout-neutral while the CD is
            shown (its own box is already 1:1) but keeps the stage a real box
            when the CD is hidden, which is what the stage-mode lyrics fill */}
        <div
          data-stage
          className={`relative aspect-square w-[min(78vw,500px)] shrink-0 transition-transform duration-700 ease-[cubic-bezier(.22,1,.36,1)] lg:-translate-x-12 ${
            lyrics.enabled ? 'lg:-translate-x-24' : ''
          }`}
        >
          {/* the halo is part of the CD assembly — hiding the disc must take
              it with it, or a floating glow is left orbiting nothing */}
          {cdVisible && <ChromeVisualizerMemo getAnalyser={eng.getAnalyser} playing={eng.playing} />}
          {cdVisible && (
            /* brightness filters ONLY the CD — on the stage it also swallowed
               the visualiser canvas, forcing the whole filtered layer to
               re-raster every canvas frame (the CD's stutter source) */
            <div
              style={cdBrightness !== 100 ? { filter: `brightness(${cdBrightness / 100})` } : undefined}
            >
              <DiscCaseMemo
                playing={eng.playing}
                onToggle={togglePlayback}
                onScratch={eng.seekBy}
                cover={track.cover ?? null}
                bpm={discBpm}
                analyser={eng.getAnalyser}
                reactive={cdReactive}
                /* the disc face resolves in this order:
                   1. the open playlist's poster — only while PLAYLIST COVER is on
                   2. the playing track's cover — only while TRACK COVER is on
                   3. the user's uploaded label (the default face)
                   4. the pressed stock disc
                   The upload is the DEFAULT, not a mode: it is what the disc
                   wears whenever no cover/poster is available, and the two
                   switches are what let a cover outrank it. */
                discArt={activeDiscArt}
                /* a track cover is unprinted photo stock — it needs the hub
                   hole to read as a disc. The playlist poster and the
                   uploaded label are printed faces and keep their own
                   centres, as does the stock disc. */
                hubHole={discArtSource === 'track'}
                /* a real disc change, not just new pixels: beats on the track
                   id so a shared cover still gets the exchange — but only
                   when that cover is what's actually on the platter. A poster
                   belongs to the playlist and the default/stock face is a
                   fixture, so neither animates a "disc change". */
                faceKey={track.id}
                swapEnabled={discArtSource === 'track'}
                speedScale={cdSpeed}
                frosted={wall.theme === 'custom' && !!wall.wallpaper}
              />
            </div>
          )}

          {/* lyrics — one of three positions.

              ON DISC      words lie over the disc's left half, as a spooling
                           label. Left-aligned, small.
              BESIDE DISC   the column to the disc's right, mostly clear of it,
                           so the artwork stays fully visible.
              STAGE         the CD is hidden: the whole stage box is the
                           showcase, and the text is bigger and centred.

              With the CD on the user picks between the first two; with it off
              the third takes over by itself (there is nothing else to fill the
              box). Sits above EVERYTHING in the case — the sheens and the
              chrome tribal frame included — because the words must stay
              readable over the artwork.

              The wrapper is click-through and only the text takes pointer
              events, so the disc can still be played / scratched around it.
              Unmounted while off on purpose: a mounted element fetches lyrics
              for the current track even when nobody is looking.

              The library is no longer the only thing that can have lyrics: a
              radio station announces its own songs, and those are the ones
              with a clock worth following. So the panel also opens for a
              detected radio song — otherwise a listener with an empty
              library would never see the highlight at all. */}
          {lyrics.enabled && (allTracks.length > 0 || radio.song) && (
            <div
              className={`lyrics-overlay pointer-events-none absolute inset-0 z-[60] flex items-center ${
                lyricMode === 'disc-right' ? 'justify-end' : 'justify-start'
              }`}
            >
              <div
                className={`pointer-events-auto ${
                  lyricMode === 'stage'
                    ? 'h-[78%] w-[92%] px-4'
                    : lyricMode === 'disc-right'
                      ? 'h-[62%] w-[52%] pl-7 pr-[2%]'
                      : 'h-[72%] w-[78%] pl-[9%] pr-2'
                }`}
              >
                <LyricsPanel
                  /* the radio has a position too: the song clock dead-reckons
                     it from the announcement, so the highlight follows the
                     station just as it follows the engine for a library track */
                  title={radio.song ? radio.song.title : track.title}
                  artist={radio.song ? radio.song.artist : track.artist}
                  duration={radio.song ? 0 : eng.duration}
                  live={!!radio.song}
                  playing={radio.song ? radio.playing : eng.playing}
                  getTime={radio.song ? radio.getSongTime : eng.getCurrentTime}
                  onSeek={eng.seekTo}
                  size={lyricMode === 'stage' ? Math.min(56, lyrics.size + 12) : lyrics.size}
                  mode={lyricMode}
                  brightness={lyrics.brightness}
                  offset={radio.song ? radio.lead : lyricOffset}
                  ttml={radio.song ? radio.song.ttml || null : (localLyrics?.ttml ?? null)}
                  apiRef={lyricsApiRef}
                />
              </div>
            </div>
          )}
        </div>

        {/* control deck — a column with a DEFINITE height in both layouts: the
            tall one stretches it to the stage's height, the stacked one gives
            it what the stage leaves. That definiteness is what the tracklist
            needs (flex-1 + min-h-0); a content-sized deck made the list's own
            height depend on how many rows were mounted, which fed straight
            back into the windowing and looped. */}
        <div className="flex min-h-0 w-full max-w-md flex-1 flex-col lg:w-[368px] lg:flex-none lg:self-stretch">
          {/* now playing */}
          <div className="mb-1 flex items-center gap-2 font-mono text-[10px] tracking-[0.3em] text-emerald-300/70">
            <span>
              TRACK {activeVisibleIndex >= 0 ? String(activeVisibleIndex + 1).padStart(2, '0') : '--'}/
              {String(visibleTracks.length).padStart(2, '0')} — {track.genre}
            </span>
            {/* genuine buffering only — local tracks start immediately */}
            {eng.busy && (
              <span className="animate-pulse text-[8px] tracking-[0.2em] text-amber-300">BUFFERING…</span>
            )}
            {eng.failed && !eng.busy && <span className="text-[8px] tracking-[0.2em] text-rose-300">{eng.failed}</span>}
          </div>
          {/* now playing — single-line ticker: long titles never shift the layout */}
          <div
            ref={titleWrapRef}
            className="mb-4 overflow-hidden [mask-image:linear-gradient(90deg,transparent,black_6%,black_94%,transparent)]"
          >
            <h1
              key={track.id}
              className={`fade-in inline-block whitespace-nowrap text-4xl font-bold leading-none tracking-tight will-change-transform`}
              style={{
                fontFamily: 'Space Grotesk, sans-serif',
                background: 'linear-gradient(120deg,#fff 20%,#9db8ff 45%,#ffb3e2 65%,#fff 90%)',
                WebkitBackgroundClip: 'text',
                backgroundClip: 'text',
                color: 'transparent',
              }}
            >
              <span>
                {track.title}
                <span className="mx-2 select-none opacity-40">✦</span>
              </span>
              {titleOverflows && (
                <span aria-hidden="true">
                  {track.title}
                  <span className="mx-2 select-none opacity-40">✦</span>
                </span>
              )}
            </h1>
          </div>

          {/* correct the track info — lyrics matching is metadata-bound, and
              imported files routinely arrive with no (or wrong) ID3 tags.
              The same row carries the favourite toggle for the playing song. */}
          {allTracks.length > 0 && track.id >= 0 && (
            <div className="mb-4 flex items-center gap-2">
              <button
                onClick={(e) => openMetaEdit(eng.trackIndex, e.currentTarget.getBoundingClientRect())}
                title="Edit title / artist"
                aria-label="Edit title and artist"
                className="flex items-center gap-1.5 rounded-full border border-white/15 px-2.5 py-1.5 font-mono text-[8px] tracking-[0.2em] text-white/40 transition hover:border-white/40 hover:text-white"
              >
                <Pencil size={10} />
                EDIT INFO
              </button>
              <button
                onClick={() => toggleFavourite(track.id)}
                title={isFavourite(track.id) ? 'Remove from favourites' : 'Add to favourites'}
                aria-label={isFavourite(track.id) ? 'Remove from favourites' : 'Add to favourites'}
                aria-pressed={isFavourite(track.id)}
                className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 font-mono text-[8px] tracking-[0.2em] transition ${
                  isFavourite(track.id)
                    ? 'border-rose-300/50 bg-rose-400/10 text-rose-200'
                    : 'border-white/15 text-white/40 hover:border-white/40 hover:text-white'
                }`}
              >
                <Heart size={10} className={isFavourite(track.id) ? 'fill-rose-300' : ''} />
                {isFavourite(track.id) ? 'FAVOURITED' : 'FAVOURITE'}
              </button>
            </div>
          )}

          <Transport
            playing={eng.playing}
            subscribeTime={eng.subscribeTime}
            duration={eng.duration}
            shuffle={eng.shuffle}
            repeat={eng.repeat}
            volume={eng.volume}
            onPrev={() => stepVisible(-1)}
            onNext={() => stepVisible(1)}
            onToggle={togglePlayback}
            onToggleShuffle={() => eng.setShuffle((s) => !s)}
            onCycleRepeat={eng.cycleRepeat}
            onSetVolume={eng.setVolume}
            onSeekTo={eng.seekTo}
          />

          {/* playlist — takes whatever height the deck has left, so the
              document stays exactly one screen tall no matter how many
              tracks are in it */}
          <PlaylistPanel
            tracks={visibleTracks}
            viewName={selectedFolder?.name ?? 'ALL TRACKS'}
            trackIndex={activeVisibleIndex}
            playing={eng.playing}
            duration={eng.duration}
            subscribeTime={eng.subscribeTime}
            boot={playlist.boot}
            importing={playlist.importing}
            importHint={playlist.importHint}
            query={listQuery}
            onQueryChange={setListQuery}
            sort={listSort}
            onSortChange={setListSort}
            density={listDensity}
            onDensityChange={setListDensity}
            groupBy={groupBy}
            onGroupByChange={setGroupBy}
            onSelect={selectVisibleTrack}
            onRemove={removeVisibleAt}
            onEditMeta={openVisibleMetaEdit}
            onReorder={reorderVisible}
            onExport={playlist.exportM3u}
            onImport={playlist.openM3uPicker}
            onAdd={playlist.openAudioPicker}
            isFavourite={isFavourite}
            onToggleFavourite={toggleFavourite}
            isNextUp={isNextUp}
            onToggleNext={toggleNextVisible}
            chips={chipList}
            activeChipId={selectedFolderId}
            onChipSelect={selectFolder}
            onNewChip={() => playlists.createFolder()}
            playlists={playlists.folders}
            onAddToPlaylist={(folderId, trackId) => playlists.addTrackToFolder(folderId, trackId)}
            onNewPlaylistWith={(trackId) => {
              const id = playlists.createFolder(undefined, [trackId])
              setSelectedFolderId(id)
            }}
          />

          <p className="mt-4 font-mono text-[9px] leading-relaxed tracking-[0.15em] text-white/30">
            CLICK DISC TO PLAY · DRAG DISC TO SCRATCH
            <br />
            HOLD THE RADIO BUTTON FOR LIVE STATIONS
          </p>
        </div>
      </main>

      {/* title/artist editor — one shared instance, opened from either the
          now-playing header or a tracklist row */}
      {metaEdit && allTracks[metaEdit.index] && (
        <TrackMetaEditor
          track={allTracks[metaEdit.index]}
          anchor={metaEdit.anchor}
          onClose={closeMetaEdit}
          onSave={(title, artist, cover) => {
            const target = allTracks[metaEdit.index]
            if (target) void playlist.renameTrack(target.id, title, artist, cover)
          }}
        />
      )}

      {/* cd settings + radio (bottom left) */}
      <div className="fixed bottom-[13%] left-[5%] z-[86] flex items-center gap-2">
        {/* radio is opened by a HOLD, not a click: the panel is a destination
            (browse, search, tune in) rather than a quick toggle, and a stray
            click must never yank the output away from the library */}
        <button
          aria-label="Radio (hold)"
          title="Radio — hold to open"
          onPointerDown={() => {
            holdTimerRef.current = window.setTimeout(() => {
              holdTimerRef.current = 0
              heldRef.current = true
              setRadioOpen(true)
            }, 450)
          }}
          onPointerUp={() => {
            if (holdTimerRef.current) window.clearTimeout(holdTimerRef.current)
            holdTimerRef.current = 0
          }}
          onPointerLeave={() => {
            if (holdTimerRef.current) window.clearTimeout(holdTimerRef.current)
            holdTimerRef.current = 0
          }}
          className={`relative grid h-8 w-8 place-items-center rounded-full transition-all duration-150 hover:scale-105 ${
            radioOpen || radio.current
              ? 'bg-white/90 text-black'
              : 'border border-white/15 bg-black/60 text-white/50 hover:border-white/40 hover:text-white'
          }`}
        >
          <Radio size={13} />
          {(radio.playing || radio.connecting) && (
            <span className="absolute -right-0.5 -top-0.5 h-2 w-2 animate-blink rounded-full bg-red-500" />
          )}
        </button>
        {/* the visualiser panel is opened from its circle in the header —
            no second button down here */}
        <button
          aria-label="CD settings"
          title="CD settings"
          onClick={toggleCdSettings}
          className={`grid h-8 w-8 place-items-center rounded-full transition-all duration-150 hover:scale-105 ${
            cdSettingsOpen ? 'text-black' : 'text-white/50 hover:text-white'
          }`}
          style={
            cdSettingsOpen
              ? {
                  background: 'linear-gradient(145deg,#f4f7fa 0%,#c7ccd4 40%,#9aa2ac 70%,#e8ecf1 100%)',
                  boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.9), 0 3px 10px rgba(0,0,0,0.5)',
                }
              : { boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.12)' }
          }
        >
          <SlidersHorizontal size={12} />
        </button>
      </div>

      {cdSettingsOpen && (
        <CdSettingsPanel
          cdVisible={cdVisible}
          onCdVisible={setCdVisible}
          cdBrightness={cdBrightness}
          onCdBrightness={setCdBrightness}
          discArtCustom={!!discArt.url}
          discArtBusy={discArt.busy}
          discArtSource={discArtSource}
          trackArt={discArt.trackArt}
          onTrackArt={discArt.setTrackArt}
          playlistArt={discArt.playlistArt}
          onPlaylistArt={discArt.setPlaylistArt}
          discArtNote={discArt.pressNote}
          onDiscArtPick={() => openFilePicker(discArt.inputRef.current)}
          onDiscArtReset={() => void discArt.reset()}
          cdSpeed={cdSpeed}
          speeds={DISC_SPEEDS}
          onCdSpeed={setCdSpeed}
          shortcuts={shortcuts}
          onShortcuts={setShortcuts}
          onClose={() => setCdSettingsClosing(true)}
          closing={cdSettingsClosing}
          onClosed={onCdSettingsClosed}
        />
      )}

      {/* fullscreen (bottom center) + creator (bottom right) */}
      <div className="pointer-events-none absolute bottom-12 left-1/2 z-40 -translate-x-1/2">
        <button
          onClick={toggleFullscreen}
          className="pointer-events-auto flex items-center gap-2 rounded-full px-4 py-2 font-mono text-[9px] tracking-[0.25em] text-black transition-transform duration-150 hover:scale-105 active:scale-95"
          style={{
            background: 'linear-gradient(145deg,#f4f7fa 0%,#c7ccd4 40%,#9aa2ac 70%,#e8ecf1 100%)',
            boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.9), inset 0 -1px 2px rgba(0,0,0,0.25), 0 4px 14px rgba(0,0,0,0.55)',
          }}
        >
          {isFullscreen ? <Minimize size={12} strokeWidth={2.5} /> : <Maximize size={12} strokeWidth={2.5} />}
          {isFullscreen ? 'EXIT FULLSCREEN' : 'FULLSCREEN'}
        </button>
      </div>
      <div className="fixed bottom-[13%] right-[5%] z-[86]">
        {wall.wallBusy != null && (
          <div className="pop-in fx-blur absolute bottom-[calc(100%+10px)] right-0 flex items-center gap-2 rounded-full border border-white/15 bg-black/75 px-3 py-1.5 backdrop-blur-sm">
            <span className="h-1 w-24 overflow-hidden rounded-full bg-white/15">
              <span
                className="block h-full rounded-full bg-emerald-300 transition-all duration-200"
                style={{ width: `${Math.round(wall.wallBusy * 100)}%` }}
              />
            </span>
            <span className="font-mono text-[9px] tracking-[0.15em] text-white/60">
              {wall.wallStage ?? 'WALLPAPER'} {Math.round(wall.wallBusy * 100)}%
            </span>
            <button onClick={wall.cancelConvert} className="font-mono text-[8px] tracking-[0.15em] text-amber-300 hover:text-white">
              ✕
            </button>
          </div>
        )}
        {wall.wallNote && !wall.wallBusy && (
          <div className="pop-in fx-blur absolute bottom-[calc(100%+10px)] right-0 rounded-full border border-white/15 bg-black/75 px-3 py-1.5 backdrop-blur-sm">
            <span className="font-mono text-[9px] tracking-[0.15em] text-amber-300">{wall.wallNote}</span>
          </div>
        )}
        <div className="flex items-center justify-end gap-2">
          <button
            aria-label="Wallpaper settings"
            title="Wallpaper settings"
            onClick={wall.toggleWallSettings}
            className={`grid h-8 w-8 place-items-center rounded-full transition-all duration-150 hover:scale-105 ${
              wall.wallSettingsOpen ? 'text-black' : 'text-white/50 hover:text-white'
            }`}
            style={
              wall.wallSettingsOpen
                ? {
                    background: 'linear-gradient(145deg,#f4f7fa 0%,#c7ccd4 40%,#9aa2ac 70%,#e8ecf1 100%)',
                    boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.9), 0 3px 10px rgba(0,0,0,0.5)',
                  }
                : { boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.12)' }
            }
          >
            <SlidersHorizontal size={12} />
          </button>
          <button
            onClick={toggleCreator}
            className={`flex items-center gap-2 rounded-full px-4 py-2 font-mono text-[9px] tracking-[0.25em] text-black transition-transform duration-150 hover:scale-105 active:scale-95 ${
              creatorOpen ? 'ring-2 ring-emerald-300/70' : ''
            }`}
            style={{
              background: 'linear-gradient(145deg,#f4f7fa 0%,#c7ccd4 40%,#9aa2ac 70%,#e8ecf1 100%)',
              boxShadow: 'inset 0 1px 1px rgba(255,255,255,0.9), inset 0 -1px 2px rgba(0,0,0,0.25), 0 4px 14px rgba(0,0,0,0.55)',
            }}
          >
            CREATOR
          </button>
        </div>
      </div>

      {radioOpen && (
        <RadioPanel
          known={radio.known}
          addAll={radio.addAll}
          onAddAll={radio.setAddAll}
          favourites={radio.favourites}
          onToggleFavourite={radio.toggleFavourite}
          /* a title only belongs to the station it was detected on — dropping a
             stale one here is what stopped the lyrics panel fetching the
             library track after radio had been used */
          song={radio.song && radio.current && radio.song.url === radio.current.url ? radio.song : null}
          icy={radio.icyStatus}
          reconnecting={radio.reconnecting}
          onPlayStation={radio.playStation}
          onPlayUrl={radio.playUrl}
          onForget={radio.forget}
          current={radio.current}
          playing={radio.playing}
          connecting={radio.connecting}
          error={radio.error}
          getSongTime={radio.getSongTime}
          songEnded={radio.songEnded}
          lead={radio.lead}
          onLead={radio.setLead}
          levelOn={radio.levelOn}
          onLevelOn={radio.setLevelOn}
          vizOn={volt.style !== null}
          onVizToggle={toggleVolt}
          stop={radio.stop}
          onClose={() => setRadioOpen(false)}
        />
      )}

      {visualizerOpen && (
        <VisualizerPanel
          audioState={visualizer.audioState}
          volt={volt.style}
          onVolt={volt.setStyle}
          settings={volt.settings}
          onSetting={volt.setSetting}
          api={vizApi}
          onHideUi={() => setUiHidden(true)}
          onClose={() => setVisualizerOpen(false)}
        />
      )}

      {/* lyrics settings — closes itself with the panel it configures */}
      {lyrics.enabled && lyricsSettingsOpen && (
        <LyricsSettingsPanel
          api={lyricsApiRef.current}
          mode={lyricMode}
          onMode={lyrics.setAlign}
          size={lyrics.size}
          onSize={lyrics.setSize}
          brightness={lyrics.brightness}
          onBrightness={lyrics.setBrightness}
          offset={lyricOffset}
          onOffset={applyLyricOffset}
          pinned={!!localLyrics}
          onPin={() => void pinLyrics()}
          onUnpin={() => void unpinLyrics()}
          onEdit={() => {
            setLyricsSettingsClosing(true)
            setLyricsEditorOpen(true)
          }}
          onClose={() => setLyricsSettingsClosing(true)}
          closing={lyricsSettingsClosing}
          pos={lyricsSettingsPos}
          onClosed={() => {
            setLyricsSettingsOpen(false)
            setLyricsSettingsClosing(false)
          }}
        />
      )}

      {/* lyrics editor — modal, so it can be worked on without the panel
          fighting over the same controls */}
      {lyricsEditorOpen && allTracks.length > 0 && (
        <LyricsEditor
          title={track.title}
          artist={track.artist}
          localTtml={localLyrics?.ttml ?? null}
          onExtract={() => lyricsApiRef.current?.extractLrc() ?? ''}
          onSave={(ttml) => {
            const rec = localLyrics
            void (async () => {
              await saveLocalLyrics({
                key: trackId,
                title: track.title,
                artist: track.artist,
                ttml,
                source: rec?.source ?? 'custom',
                custom: true,
                savedAt: Date.now(),
              })
              setLocalLyrics(await loadLocalLyrics(trackId))
            })()
          }}
          onReset={() => {
            void (async () => {
              await deleteLocalLyrics(trackId)
              await deleteTrackOffset(trackId)
              setLyricOffset(0)
              setLocalLyrics(null)
            })()
          }}
          onClose={() => setLyricsEditorOpen(false)}
        />
      )}

      {/* wallpaper settings */}
      {wall.wallSettingsOpen && wall.wallBusy == null && (
        <WallpaperSettingsPanel
          pendingWallFile={wall.pendingWallFile}
          wallQuality={wall.wallQuality}
          onPickQuality={wall.pickQuality}
          wallFpsTarget={wall.wallFpsTarget}
          onFpsTarget={wall.setWallFpsTarget}
          wallStart={wall.wallStart}
          onStart={wall.setWallStart}
          wallSpeed={wall.wallSpeed}
          onSpeed={wall.setWallSpeed}
          wallBlur={wall.wallBlur}
          onBlurToggle={wall.setWallBlurOn}
          wallDim={wall.wallDim}
          onDim={wall.setWallDimV}
          wallPauseHidden={wall.wallPauseHidden}
          onPauseHiddenToggle={wall.setWallPauseHiddenV}
          videoPresent={wall.wallpaper?.type === 'video'}
          canConvert={wall.canConvert}
          converting={wall.wallBusy != null}
          onConvert={wall.convertWallpaper}
          onClearCache={wall.removeWallpaper}
          onAddNew={() => openFilePicker(wall.wallInputRef.current)}
          savedWallpapers={wall.savedWallpapers}
          onSwitchWallpaper={wall.switchWallpaper}
          onRemoveSaved={wall.removeSavedWallpaper}
          onClose={wall.closeWallSettings}
          closing={wall.wallSettingsClosing}
          onClosed={wall.onWallSettingsClosed}
        />
      )}

      {creatorOpen && <CreatorMenu closing={creatorClosing} onClosed={onCreatorClosed} />}

      {/* the online extension — the real Dannify, in its own window. It has
          its own player and its own library, and nothing in it touches this
          player's playlist. */}
      {dannifyOpen && (
        <DannifyWindow
          ref={dannifyRef}
          onAudioChange={onDannifyAudio}
          onClose={() => {
            setDannifyOpen(false)
            /* a download finished in there is the one thing this window is
               closed right after; bring it in without waiting for the timer */
            void dannifySync.sync()
          }}
        />
      )}

<PlaylistDrawer
        open={playlistOpen}
        folders={playlists.folders}
        library={playlist.tracks}
        currentIndex={eng.trackIndex}
        playing={eng.playing}
        onClose={() => setPlaylistOpen(false)}
        selectedFolderId={selectedFolderId}
        onSelectFolder={selectFolder}
        onCreateFolder={playlists.createFolder}
        onRestoreFolder={playlists.restoreFolder}
        onDuplicateFolder={playlists.duplicateFolder}
        onRenameFolder={playlists.renameFolder}
        onDeleteFolder={deleteFolder}
        onSetFolderImage={playlists.setFolderImage}
        onAddTrack={playlists.addTrackToFolder}
        onRemoveTrack={removeFolderTrack}
        onReorder={playlists.reorderTracks}
        onPlayTrack={playFolderTrack}
        onPlayAll={playAll}
        onEditTrack={(id, title, artist, cover) => {
          void playlist.renameTrack(id, title, artist, cover)
        }}
        onUploadFile={uploadToFolder}
        isFavourite={isFavourite}
        onToggleFavourite={toggleFavourite}
        isNextUp={isNextUp}
        onToggleNext={toggleNextUp}
      />

      {/* footer marquee */}
      <footer className="marquee-fade relative z-40 overflow-hidden border-t border-white/10 py-2">
        <div className="animate-marquee flex w-max gap-8 font-mono text-[10px] tracking-[0.3em] text-white/40">
          {Array.from({ length: 6 }).map((_, i) => (
            <span key={i} className="whitespace-nowrap">
              MUN15H ✦ MINIDISC FOREVER ✦ HOLOGRAPHIC SOUND SYSTEM ✦ SA COATING ADVANCE ✦ 74:00 REC ● ✦ INSERT THIS END ▲ ✦
            </span>
          ))}
        </div>
      </footer>
    </div>
  )
}
