/**
 * The online app — Dannify's interface, in this app.
 *
 * This is a port of Dannify's shell (v4.12.0, MIT) to React: the same
 * layout, the same design tokens, the same components. Dannify itself is
 * Vue; this app is React, so the shell was rebuilt rather than copied, and
 * the licence notice is in THIRD-PARTY-NOTICES.md.
 *
 * ```text
 *   ┌───────────────────────────────────────────────────────────┐
 *   │ ← →  ⌕  (search, centred)                        ⚙  ×    │  44px title bar
 *   ├──────────┬─────────────────────────────────┬──────────────┤
 *   │  Home    │                                 │  Now playing  │
 *   │  Search  │   the music                     │  ───────────  │
 *   │  Stats   │                                 │  Queue        │
 *   │          │                                 │  Lyrics       │
 *   │ YOUR     │                                 │              │
 *   │ LIBRARY  │                                 │              │
 *   ├──────────┴─────────────────────────────────┴──────────────┤
 *   │ ▣  Song  Artist            ⏮ ▶ ⏭   ━━━━━━━━   ─○─  🔊    │  84px player
 *   └───────────────────────────────────────────────────────────┘
 * ```
 *
 * The colours are Dannify's own: near-black panels, a green accent, and
 * text that fades in measured steps rather than by eye.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  BarChart3,
  ChevronLeft,
  Heart,
  ChevronRight,
  Download,
  House,
  Library,
  ListMusic,
  Loader2,
  Pause,
  Play,
  Search,
  Settings2,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume2,
  X,
} from 'lucide-react'
import {
  browseAlbum,
  browseArtist,
  browseFollow,
  browseRate,
  browseHome,
  browseLiked,
  browseLibraryPlaylists,
  browseMoods,
  browsePlaylist,
  browseRadio,
  browseSearch,
  browseSuggest,
  browseSubscriptions,
  downloadsAdd,
  downloadsClearFinished,
  downloadsList,
  type BrowseAlbum,
  type BrowseArtist,
  type BrowseCard,
  type BrowsePlaylist,
  type BrowseSearchResults,
  type BrowseShelf,
  type BrowseSong,
  type DownloadJob,
} from './browse'
import SourcesSettingsPanel from './SourcesSettingsPanel'

/* ---- Dannify's design tokens ---------------------------------------------
 * The values are Dannify's own, from its dark palette. Every one of them
 * was measured for contrast rather than picked by eye. */
const DANNIFY = {
  app: 'rgb(8 8 10)',
  panel: 'rgb(18 18 21)',
  raised: 'rgb(27 27 32)',
  elev: 'rgb(37 37 43)',
  fg: 'rgb(240 240 243)',
  accent: 'rgb(26 208 92)',
  accentHover: 'rgb(46 224 111)',
  accentFg: 'rgb(3 22 10)',
  shadowPop: '0 14px 44px rgb(0 0 0 / 0.55), 0 2px 10px rgb(0 0 0 / 0.35)',
  shadowCard: '0 8px 26px rgb(0 0 0 / 0.4)',
  titlebarH: 44,
  playerH: 84,
  sidebarW: 248,
  gap: 8,
  radius: 10,
} as const

/** Faint text, by the strength it was designed at. */
const fg = (alpha: number) => `rgb(${DANNIFY.fg.replace('rgb(', '').replace(')', '')} / ${alpha})`

interface Props {
  /** The app's engine, for the transport. */
  engine: {
    playing: boolean
    trackIndex: number
    duration: number
    volume: number
    toggle: () => void
    select: (index: number, autoplay?: boolean) => void
    next: () => void
    prev: () => void
    seekTo: (seconds: number) => void
    setVolume: (v: number) => void
    subscribeTime: (cb: (t: number) => void) => () => void
  }
  /** The app's tracks, so the player bar can show what is playing. */
  tracks: { id: number; title: string; artist: string; cover?: string }[]
  /** Called with the local URL to play, and the song it came from. */
  onPlay: (url: string, song: BrowseSong) => void
  /** Called with a batch of songs to queue. */
  onQueue: (songs: BrowseSong[]) => void
  onClose: () => void
}

type View = 'home' | 'search' | 'library' | 'artists' | 'albums' | 'downloads' | 'stats'
type Panel = 'queue' | 'lyrics' | 'about'

const fmt = (seconds: number) => {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const m = Math.floor(seconds / 60)
  const s = Math.floor(seconds % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

export default function DannifyApp({
  engine,
  tracks,
  onPlay,
  onQueue,
  onClose,
}: Props) {
  const [view, setView] = useState<View>('home')
  const [panel, setPanel] = useState<Panel>('queue')
  const [shelves, setShelves] = useState<BrowseShelf[]>([])
  const [search, setSearch] = useState<BrowseSearchResults | null>(null)
  const [suggestions, setSuggestions] = useState<string[]>([])
  const [query, setQuery] = useState('')
  const [moods, setMoods] = useState<BrowseShelf[]>([])
  const [liked, setLiked] = useState<BrowseSong[]>([])
  const [playlists, setPlaylists] = useState<BrowseCard[]>([])
  const [artists, setArtists] = useState<BrowseCard[]>([])
  const [albums, setAlbums] = useState<BrowseCard[]>([])
  const [downloads, setDownloads] = useState<DownloadJob[]>([])
  const [artist, setArtist] = useState<BrowseArtist | null>(null)
  /* Whether the account follows the artist on screen. */
  const [following, setFollowing] = useState(false)
  const [album, setAlbum] = useState<BrowseAlbum | null>(null)
  const [playlist, setPlaylist] = useState<BrowsePlaylist | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [opening, setOpening] = useState<string | null>(null)
  /* The ids of the songs the account has liked, so the heart knows. */
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set())
  const searchSeq = useRef(0)

  /* ---- the home feed ---- */
  const loadHome = useCallback(async () => {
    setBusy(true)
    try {
      setShelves(await browseHome(6))
      setError(null)
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    void loadHome()
    void browseMoods()
      .then(setMoods)
      .catch(() => undefined)
    void browseLiked(250)
      .then((songs) => setLikedIds(new Set(songs.map((s) => s.videoId))))
      .catch(() => undefined)
  }, [loadHome])

  /* ---- the library ---- */
  const loadLibrary = useCallback(async () => {
    setBusy(true)
    try {
      const [songs, lists] = await Promise.all([
        browseLiked(250),
        browseLibraryPlaylists(50),
      ])
      setLiked(songs)
      setPlaylists(lists)
      setError(null)
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    if (view === 'library') void loadLibrary()
  }, [view, loadLibrary])

  useEffect(() => {
    if (view !== 'artists') return
    setBusy(true)
    void browseSubscriptions(100)
      .then(setArtists)
      .catch(() => undefined)
      .finally(() => setBusy(false))
  }, [view])

  useEffect(() => {
    if (view !== 'albums') return
    setBusy(true)
    void browseMoods()
      .then((found) => setAlbums(found.flatMap((m) => m.cards)))
      .catch(() => undefined)
      .finally(() => setBusy(false))
  }, [view])

  /* ---- the downloads, polled so the queue is alive ---- */
  useEffect(() => {
    if (view !== 'downloads') return
    let alive = true
    const tick = () => {
      void downloadsList()
        .then((jobs) => {
          if (alive) setDownloads(jobs)
        })
        .catch(() => undefined)
    }
    tick()
    const timer = window.setInterval(tick, 900)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [view])

  /* ---- the type-ahead ---- */
  useEffect(() => {
    if (view !== 'search' || query.trim().length < 2) {
      setSuggestions([])
      return
    }
    const seq = ++searchSeq.current
    const timer = window.setTimeout(() => {
      void browseSuggest(query, 8)
        .then((found) => {
          if (seq === searchSeq.current) setSuggestions(found)
        })
        .catch(() => undefined)
    }, 250)
    return () => window.clearTimeout(timer)
  }, [query, view])

  const runSearch = useCallback(async (text: string) => {
    const trimmed = text.trim()
    if (!trimmed) {
      setSearch(null)
      return
    }
    const seq = ++searchSeq.current
    setBusy(true)
    try {
      const found = await browseSearch(trimmed, 20)
      if (seq === searchSeq.current) setSearch(found)
    } catch (e) {
      if (seq === searchSeq.current) setError(String(e))
    } finally {
      if (seq === searchSeq.current) setBusy(false)
    }
  }, [])

  /* ---- playing ---- */
  const playSong = useCallback(
    async (song: BrowseSong) => {
      setOpening(song.videoId)
      setError(null)
      try {
        const { sourcesPlay } = await import('./bridge')
        const url = await sourcesPlay(`youtube:${song.videoId}`)
        onPlay(url, song)
      } catch (e) {
        setError(String(e))
      } finally {
        setOpening(null)
      }
    },
    [onPlay],
  )

  const toggleLike = useCallback(
    async (song: BrowseSong) => {
      const next = !likedIds.has(song.videoId)
      setLikedIds((prev) => {
        const copy = new Set(prev)
        if (next) copy.add(song.videoId)
        else copy.delete(song.videoId)
        return copy
      })
      try {
        await browseRate(song.videoId, next)
      } catch (e) {
        setError(String(e))
        /* Put it back: the account did not do it. */
        setLikedIds((prev) => {
          const copy = new Set(prev)
          if (next) copy.delete(song.videoId)
          else copy.add(song.videoId)
          return copy
        })
      }
    },
    [likedIds],
  )

  const downloadSong = useCallback(async (song: BrowseSong) => {
    setError(null)
    try {
      await downloadsAdd(song.videoId, song.name, song.artists.join(', '), song.albumName)
      setView('downloads')
    } catch (e) {
      setError(String(e))
    }
  }, [])

  const startRadio = useCallback(
    async (song: BrowseSong) => {
      setError(null)
      try {
        const songs = await browseRadio(song.videoId, 30)
        if (songs.length) onQueue(songs)
      } catch (e) {
        setError(String(e))
      }
    },
    [onQueue],
  )

  const openCard = useCallback(async (card: BrowseCard) => {
    setError(null)
    try {
      if (card.kind === 'ARTIST') {
        setArtist(await browseArtist(card.browseId))
        setFollowing(false)
      } else if (card.kind === 'ALBUM') {
        setAlbum(await browseAlbum(card.browseId))
      } else {
        setPlaylist(await browsePlaylist(card.browseId))
      }
    } catch (e) {
      setError(String(e))
    }
  }, [])

  const toggleFollow = useCallback(async () => {
    if (!artist?.channelId) return
    const next = !following
    setFollowing(next)
    try {
      await browseFollow(artist.channelId, next)
    } catch (e) {
      setError(String(e))
      setFollowing(!next)
    }
  }, [artist, following])

  /* ---- the player bar ---- */
  const nowPlaying = tracks[engine.trackIndex]
  const [time, setTime] = useState(0)
  const { subscribeTime } = engine
  useEffect(() => subscribeTime(setTime), [subscribeTime])
  const progress = engine.duration > 0 ? (time / engine.duration) * 100 : 0

  const nav: { id: View; label: string; icon: typeof House }[] = [
    { id: 'home', label: 'Home', icon: House },
    { id: 'search', label: 'Search', icon: Search },
    { id: 'stats', label: 'Your stats', icon: BarChart3 },
  ]

  return (
    <div
      className="absolute inset-0 z-[86] overflow-hidden font-sans"
      style={{
        background: DANNIFY.app,
        color: DANNIFY.fg,
        display: 'grid',
        gridTemplateRows: `${DANNIFY.titlebarH}px minmax(0, 1fr) ${DANNIFY.playerH}px`,
        gridTemplateColumns: `${DANNIFY.sidebarW}px minmax(0, 1fr) 300px`,
        gridTemplateAreas: '"title title title" "side center panel" "player player player"',
        columnGap: DANNIFY.gap,
        padding: `0 ${DANNIFY.gap}px`,
      }}
    >
      {/* ---- the title bar ---- */}
      <header
        style={{
          gridArea: 'title',
          margin: `0 ${-DANNIFY.gap}px`,
          background: DANNIFY.app,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '0 12px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <IconButton label="Back" onClick={onClose}>
            <ChevronLeft size={18} />
          </IconButton>
          <IconButton label="Forward" onClick={() => undefined} disabled>
            <ChevronRight size={18} />
          </IconButton>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 10 }}>
            <div
              style={{
                width: 18,
                height: 18,
                borderRadius: 5,
                background: DANNIFY.accent,
                color: DANNIFY.accentFg,
                display: 'grid',
                placeItems: 'center',
                fontWeight: 700,
                fontSize: 11,
              }}
            >
              M
            </div>
            <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: '0.01em' }}>MUN15H</span>
          </div>
        </div>

        {/* the search, in the middle, as it is in Dannify */}
        <div style={{ flex: 1, display: 'flex', justifyContent: 'center', position: 'relative' }}>
          <div
            style={{
              width: '100%',
              maxWidth: 520,
              position: 'relative',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                background: DANNIFY.raised,
                border: `1px solid rgb(255 255 255 / 0.08)`,
                borderRadius: 999,
                padding: '6px 14px',
              }}
            >
              <Search size={15} style={{ color: fg(0.4) }} />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onFocus={() => setView('search')}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    void runSearch(query)
                    setSuggestions([])
                  }
                }}
                placeholder="Search"
                style={{
                  flex: 1,
                  minWidth: 0,
                  background: 'transparent',
                  border: 0,
                  outline: 'none',
                  color: DANNIFY.fg,
                  fontSize: 13,
                }}
              />
              {busy && <Loader2 size={14} style={{ color: fg(0.4), animation: 'spin 1s linear infinite' }} />}
            </div>
            {/* the type-ahead */}
            {suggestions.length > 0 && (
              <div
                style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  right: 0,
                  marginTop: 6,
                  background: DANNIFY.elev,
                  borderRadius: 12,
                  boxShadow: DANNIFY.shadowPop,
                  overflow: 'hidden',
                  zIndex: 40,
                }}
              >
                {suggestions.map((s) => (
                  <button
                    key={s}
                    onClick={() => {
                      setQuery(s)
                      setSuggestions([])
                      void runSearch(s)
                    }}
                    style={{
                      display: 'block',
                      width: '100%',
                      textAlign: 'left',
                      padding: '8px 14px',
                      background: 'transparent',
                      border: 0,
                      color: fg(0.8),
                      fontSize: 13,
                      cursor: 'pointer',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = 'rgb(255 255 255 / 0.06)')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <IconButton label="Settings" onClick={() => setSettingsOpen(true)}>
            <Settings2 size={17} />
          </IconButton>
          <IconButton label="Close" onClick={onClose}>
            <X size={17} />
          </IconButton>
        </div>
      </header>

      {/* ---- the sidebar ---- */}
      <nav
        style={{
          gridArea: 'side',
          background: DANNIFY.panel,
          borderRadius: DANNIFY.radius,
          padding: 10,
          overflowY: 'auto',
        }}
      >
        {nav.map((item) => {
          const Icon = item.icon
          const active = view === item.id
          return (
            <button
              key={item.id}
              onClick={() => {
                setView(item.id)
                if (item.id === 'home') void loadHome()
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                width: '100%',
                padding: '9px 10px',
                borderRadius: 8,
                background: active ? 'rgb(255 255 255 / 0.07)' : 'transparent',
                border: 0,
                color: active ? DANNIFY.fg : fg(0.62),
                fontSize: 13,
                fontWeight: 500,
                cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <Icon size={17} style={{ color: active ? DANNIFY.accent : fg(0.62) }} />
              {item.label}
            </button>
          )
        })}

        {/* your library, with the chips to narrow it */}
        <div style={{ marginTop: 18 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '0 10px 8px',
              color: fg(0.5),
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
            }}
          >
            <Library size={15} />
            Your library
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '0 6px' }}>
            {(
              [
                ['library', 'Songs'],
                ['playlists', 'Playlists'],
                ['artists', 'Artists'],
                ['albums', 'Albums'],
                ['downloads', 'Downloads'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setView(id as View)}
                style={{
                  padding: '5px 11px',
                  borderRadius: 999,
                  border: `1px solid rgb(255 255 255 / 0.12)`,
                  background: view === id ? 'rgb(255 255 255 / 0.10)' : 'transparent',
                  color: view === id ? DANNIFY.fg : fg(0.55),
                  fontSize: 11,
                  cursor: 'pointer',
                }}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* the moods */}
        {moods.length > 0 && (
          <div style={{ marginTop: 18 }}>
            <div
              style={{
                padding: '0 10px 8px',
                color: fg(0.5),
                fontSize: 12,
                fontWeight: 600,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
              }}
            >
              Moods
            </div>
            {moods.slice(0, 3).map((mood) => (
              <div key={mood.title} style={{ padding: '0 10px 8px' }}>
                <div style={{ fontSize: 11, color: fg(0.45), marginBottom: 4 }}>
                  {mood.title}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {mood.cards.slice(0, 4).map((c) => (
                    <button
                      key={c.browseId}
                      onClick={() => {
                        setView('search')
                        void browsePlaylist(c.browseId)
                          .then(setPlaylist)
                          .catch((e) => setError(String(e)))
                      }}
                      style={{
                        padding: '3px 8px',
                        borderRadius: 999,
                        border: '1px solid rgb(255 255 255 / 0.10)',
                        background: 'transparent',
                        color: fg(0.4),
                        fontSize: 10,
                        cursor: 'pointer',
                      }}
                    >
                      {c.name}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </nav>

      {/* ---- the main panel ---- */}
      <main
        style={{
          gridArea: 'center',
          position: 'relative',
          display: 'flex',
          minWidth: 0,
          minHeight: 0,
        }}
      >
        <div
          style={{
            position: 'relative',
            flex: 1,
            minWidth: 0,
            overflowY: 'auto',
            borderRadius: DANNIFY.radius,
            background: DANNIFY.panel,
            padding: '20px 22px 28px',
          }}
        >
          {error && (
            <div
              style={{
                marginBottom: 14,
                padding: '10px 12px',
                borderRadius: 10,
                background: 'rgb(242 109 109 / 0.10)',
                border: '1px solid rgb(242 109 109 / 0.25)',
                color: 'rgb(242 180 180)',
                fontSize: 12,
                lineHeight: 1.6,
              }}
            >
              {error}
            </div>
          )}

          {/* ---- HOME ---- */}
          {view === 'home' &&
            (shelves.length === 0 && !busy ? (
              <Empty
                title="Nothing here yet"
                body={
                  'Sign in to YouTube Music in the settings, and your home feed, your library and your playlists are here. The open-licensed sources — Jamendo and the Internet Archive — need no account at all.'
                }
              />
            ) : (
              shelves.map((shelf) => (
                <Shelf
                  key={shelf.title}
                  shelf={shelf}
                  opening={opening}
                  onPlay={playSong}
                  onDownload={downloadSong}
                  onRadio={startRadio}
                  onOpenCard={openCard}
                />
              ))
            ))}

          {/* ---- SEARCH ---- */}
          {view === 'search' && (
            <>
              {!search && (
                <Empty
                  title="Search"
                  body="Songs, artists, albums and playlists, all at once. Start typing in the box above."
                />
              )}
              {search && (
                <>
                  {search.songs.length > 0 && (
                    <section style={{ marginBottom: 26 }}>
                      <SectionTitle>Songs</SectionTitle>
                      <SongTiles
                        songs={search.songs}
                        opening={opening}
                        onPlay={playSong}
                        onDownload={downloadSong}
                        onRadio={startRadio}
                      liked={likedIds}
                      onToggleLike={toggleLike}
                      />
                    </section>
                  )}
                  {(
                    [
                      ['Artists', search.artists],
                      ['Albums', search.albums],
                      ['Playlists', search.playlists],
                    ] as const
                  ).map(([title, cards]) =>
                    cards.length ? (
                      <section key={title} style={{ marginBottom: 26 }}>
                        <SectionTitle>{title}</SectionTitle>
                        <MediaCards cards={cards} onOpen={openCard} />
                      </section>
                    ) : null,
                  )}
                </>
              )}
            </>
          )}

          {/* ---- LIBRARY ---- */}
          {view === 'library' && (
            <>
              {playlists.length > 0 && (
                <section style={{ marginBottom: 26 }}>
                  <SectionTitle>Your playlists</SectionTitle>
                  <MediaCards cards={playlists} onOpen={openCard} />
                </section>
              )}
              <section>
                <SectionTitle>Liked songs ({liked.length})</SectionTitle>
                {liked.length === 0 ? (
                  <Empty
                    title="Nothing liked yet"
                    body="Sign in to YouTube Music and the songs you like are here. Like something and it shows up straight away."
                  />
                ) : (
                  <SongTiles
                    songs={liked}
                    opening={opening}
                    onPlay={playSong}
                    onDownload={downloadSong}
                    onRadio={startRadio}
                  liked={likedIds}
                  onToggleLike={toggleLike}
                  />
                )}
              </section>
            </>
          )}

          {/* ---- ARTISTS ---- */}
          {view === 'artists' && (
            <section>
              <SectionTitle>Artists you follow</SectionTitle>
              {artists.length === 0 ? (
                <Empty
                  title="No artists yet"
                  body="Follow an artist on YouTube Music and they are here, with everything they have released."
                />
              ) : (
                <MediaCards cards={artists} onOpen={openCard} />
              )}
            </section>
          )}

          {/* ---- ALBUMS ---- */}
          {view === 'albums' && (
            <section>
              <SectionTitle>Moods and genres</SectionTitle>
              {albums.length === 0 ? (
                <Empty title="Nothing here" body="Sign in and the genres appear." />
              ) : (
                <MediaCards cards={albums} onOpen={openCard} />
              )}
            </section>
          )}

          {/* ---- STATS ---- */}
          {view === 'stats' && (
            <Empty
              title="Your stats"
              body="Listening history, streaks and your year in music. It is coming — the history is already being kept."
            />
          )}

          {/* ---- DOWNLOADS ---- */}
          {view === 'downloads' && (
            <section>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 12,
                }}
              >
                <SectionTitle>The queue</SectionTitle>
                <button
                  onClick={() => void downloadsClearFinished()}
                  style={{
                    padding: '5px 11px',
                    borderRadius: 999,
                    border: '1px solid rgb(255 255 255 / 0.12)',
                    background: 'transparent',
                    color: fg(0.5),
                    fontSize: 10,
                    cursor: 'pointer',
                  }}
                >
                  Clear finished
                </button>
              </div>
              {downloads.length === 0 ? (
                <Empty
                  title="Nothing is downloading"
                  body="The download button on a song fetches it to a file, and the file joins your library."
                />
              ) : (
                downloads.map((job) => (
                  <div
                    key={job.id}
                    style={{
                      marginBottom: 8,
                      padding: '10px 12px',
                      borderRadius: 10,
                      background: DANNIFY.raised,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div
                          style={{
                            fontSize: 13,
                            color: DANNIFY.fg,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {job.title}
                        </div>
                        <div style={{ fontSize: 11, color: fg(0.45) }}>{job.artist}</div>
                      </div>
                      <span style={{ fontSize: 10, color: fg(0.4) }}>{job.message}</span>
                      {job.status === 'running' && (
                        <Loader2 size={14} style={{ color: fg(0.5), animation: 'spin 1s linear infinite' }} />
                      )}
                    </div>
                    <div
                      style={{
                        marginTop: 8,
                        height: 2,
                        borderRadius: 999,
                        background: 'rgb(255 255 255 / 0.10)',
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          height: '100%',
                          background: DANNIFY.accent,
                          transition: 'width .2s',
                        }}
                      />
                    </div>
                  </div>
                ))
              )}
            </section>
          )}

          {/* ---- an artist, an album or a playlist ---- */}
          {artist && (
            <section>
              <Back onClick={() => setArtist(null)} />
              <Hero
                cover={artist.coverUrl}
                title={artist.name}
                subtitle={[artist.subscribers, artist.monthlyListeners]
                  .filter(Boolean)
                  .join(' · ')}
                description={artist.description}
              />
              {artist.channelId && (
                <button
                  onClick={() => void toggleFollow()}
                  style={{
                    marginTop: 14,
                    padding: '7px 18px',
                    borderRadius: 999,
                    border: 0,
                    background: following ? DANNIFY.accent : DANNIFY.raised,
                    color: following ? DANNIFY.accentFg : DANNIFY.fg,
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {following ? 'Following' : 'Follow'}
                </button>
              )}
              {artist.songs.length > 0 && (
                <div style={{ marginTop: 20 }}>
                  <SectionTitle>Songs</SectionTitle>
                  <SongTiles
                    songs={artist.songs}
                    opening={opening}
                    onPlay={playSong}
                    onDownload={downloadSong}
                    onRadio={startRadio}
                  liked={likedIds}
                  onToggleLike={toggleLike}
                  />
                </div>
              )}
              {artist.albums.length > 0 && (
                <div style={{ marginTop: 26 }}>
                  <SectionTitle>Albums</SectionTitle>
                  <MediaCards cards={artist.albums} onOpen={openCard} />
                </div>
              )}
              {artist.singles.length > 0 && (
                <div style={{ marginTop: 26 }}>
                  <SectionTitle>Singles</SectionTitle>
                  <MediaCards cards={artist.singles} onOpen={openCard} />
                </div>
              )}
            </section>
          )}

          {album && (
            <section>
              <Back onClick={() => setAlbum(null)} />
              <Hero
                cover={album.coverUrl}
                title={album.name}
                subtitle={[album.artists.join(', '), album.year].filter(Boolean).join(' · ')}
                description={album.description}
              />
              <div style={{ marginTop: 20 }}>
                <SongTiles
                  songs={album.tracks}
                  opening={opening}
                  onPlay={playSong}
                  onDownload={downloadSong}
                  onRadio={startRadio}
                liked={likedIds}
                onToggleLike={toggleLike}
                />
              </div>
            </section>
          )}

          {playlist && (
            <section>
              <Back onClick={() => setPlaylist(null)} />
              <Hero
                cover={playlist.coverUrl}
                title={playlist.name}
                subtitle={playlist.author ?? undefined}
                description={playlist.description}
              />
              <div style={{ marginTop: 20 }}>
                <SongTiles
                  songs={playlist.tracks}
                  opening={opening}
                  onPlay={playSong}
                  onDownload={downloadSong}
                  onRadio={startRadio}
                liked={likedIds}
                onToggleLike={toggleLike}
                />
              </div>
            </section>
          )}
        </div>
      </main>

      {/* ---- the side panel ---- */}
      <aside
        style={{
          gridArea: 'panel',
          background: DANNIFY.panel,
          borderRadius: DANNIFY.radius,
          padding: 14,
          overflowY: 'auto',
        }}
      >
        <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
          {(['queue', 'lyrics', 'about'] as Panel[]).map((p) => (
            <button
              key={p}
              onClick={() => setPanel(p)}
              style={{
                padding: '4px 10px',
                borderRadius: 999,
                border: `1px solid ${panel === p ? 'rgb(255 255 255 / 0.22)' : 'rgb(255 255 255 / 0.10)'}`,
                background: panel === p ? 'rgb(255 255 255 / 0.09)' : 'transparent',
                color: panel === p ? DANNIFY.fg : fg(0.5),
                fontSize: 10,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                cursor: 'pointer',
              }}
            >
              {p}
            </button>
          ))}
        </div>

        {panel === 'queue' && (
          <div>
            <div style={{ fontSize: 10, color: fg(0.35), letterSpacing: '0.08em' }}>
              {tracks.length} TRACK{tracks.length === 1 ? '' : 'S'} IN THE QUEUE
            </div>
            {tracks.map((t, index) => (
              <button
                key={t.id}
                onClick={() => engine.select(index, true)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  width: '100%',
                  marginTop: 6,
                  padding: 6,
                  borderRadius: 8,
                  border: 0,
                  background: index === engine.trackIndex ? 'rgb(255 255 255 / 0.07)' : 'transparent',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 6,
                    overflow: 'hidden',
                    background: DANNIFY.raised,
                    flexShrink: 0,
                  }}
                >
                  {t.cover ? (
                    <img src={t.cover} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : null}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 12,
                      color: DANNIFY.fg,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {t.title}
                  </div>
                  <div
                    style={{
                      fontSize: 10,
                      color: fg(0.4),
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {t.artist}
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}

        {panel === 'lyrics' && (
          <p style={{ fontSize: 11, lineHeight: 1.7, color: fg(0.4) }}>
            The lyrics panel is the app&apos;s own — close this and it is there, with the
            word-by-word highlight.
          </p>
        )}

        {panel === 'about' && (
          <p style={{ fontSize: 11, lineHeight: 1.7, color: fg(0.35) }}>
            Everything here is fetched from YouTube Music&apos;s own API, with your session on
            it. The address of the audio never reaches the app — only a local handle does.
          </p>
        )}
      </aside>

      {/* ---- the player bar ---- */}
      <footer
        style={{
          gridArea: 'player',
          margin: `0 ${-DANNIFY.gap}px`,
          background: DANNIFY.app,
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 2fr) minmax(0, 1fr)',
          alignItems: 'center',
          gap: 16,
          padding: '0 14px',
        }}
      >
        {/* what is playing */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <div
            style={{
              width: 56,
              height: 56,
              borderRadius: 8,
              overflow: 'hidden',
              background: DANNIFY.raised,
              flexShrink: 0,
            }}
          >
            {nowPlaying?.cover ? (
              <img
                src={nowPlaying.cover}
                alt=""
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            ) : null}
          </div>
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: 13,
                color: DANNIFY.fg,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {nowPlaying?.title || 'Nothing playing'}
            </div>
            <div
              style={{
                fontSize: 11,
                color: fg(0.45),
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {nowPlaying?.artist || '—'}
            </div>
          </div>
        </div>

        {/* the transport */}
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
            <IconButton label="Shuffle" onClick={() => undefined} disabled>
              <Shuffle size={16} />
            </IconButton>
            <IconButton label="Previous" onClick={engine.prev}>
              <SkipBack size={17} style={{ fill: 'currentColor' }} />
            </IconButton>
            <button
              onClick={engine.toggle}
              aria-label={engine.playing ? 'Pause' : 'Play'}
              style={{
                width: 36,
                height: 36,
                borderRadius: 999,
                border: 0,
                background: DANNIFY.fg,
                color: DANNIFY.app,
                display: 'grid',
                placeItems: 'center',
                cursor: 'pointer',
              }}
            >
              {engine.playing ? (
                <Pause size={16} style={{ fill: 'currentColor' }} />
              ) : (
                <Play size={16} style={{ fill: 'currentColor' }} />
              )}
            </button>
            <IconButton label="Next" onClick={engine.next}>
              <SkipForward size={17} style={{ fill: 'currentColor' }} />
            </IconButton>
            <IconButton label="Repeat" onClick={() => undefined} disabled>
              <ListMusic size={16} />
            </IconButton>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
            <span style={{ fontSize: 10, color: fg(0.4), width: 34, textAlign: 'right' }}>
              {fmt(time)}
            </span>
            <input
              type="range"
              min={0}
              max={Math.max(engine.duration, 0.01)}
              step={0.1}
              value={Math.min(time, engine.duration || 0)}
              onChange={(e) => engine.seekTo(Number(e.target.value))}
              style={{
                flex: 1,
                height: 3,
                appearance: 'none',
                borderRadius: 999,
                background: `linear-gradient(to right, ${DANNIFY.fg} ${progress}%, rgb(255 255 255 / 0.16) ${progress}%)`,
                cursor: 'pointer',
              }}
            />
            <span style={{ fontSize: 10, color: fg(0.4), width: 34 }}>{fmt(engine.duration)}</span>
          </div>
        </div>

        {/* the volume */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
          <Volume2 size={15} style={{ color: fg(0.4) }} />
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={engine.volume}
            onChange={(e) => engine.setVolume(Number(e.target.value))}
            aria-label="Volume"
            style={{
              width: 90,
              height: 3,
              appearance: 'none',
              borderRadius: 999,
              background: `linear-gradient(to right, ${DANNIFY.fg} ${engine.volume * 100}%, rgb(255 255 255 / 0.16) ${engine.volume * 100}%)`,
              cursor: 'pointer',
            }}
          />
        </div>
      </footer>

      {settingsOpen && (
        <SourcesSettingsPanel
          onClose={() => setSettingsOpen(false)}
          onChanged={() => {
            void loadHome()
            void loadLibrary()
          }}
        />
      )}
    </div>
  )
}

/* ---- the pieces ---- */

function IconButton({
  children,
  label,
  onClick,
  disabled,
}: {
  children: React.ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      style={{
        width: 30,
        height: 30,
        borderRadius: 999,
        border: 0,
        background: 'transparent',
        color: disabled ? fg(0.25) : fg(0.62),
        display: 'grid',
        placeItems: 'center',
        cursor: disabled ? 'default' : 'pointer',
      }}
    >
      {children}
    </button>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2
      style={{
        margin: '0 0 10px',
        fontSize: 15,
        fontWeight: 650,
        letterSpacing: '-0.01em',
        color: DANNIFY.fg,
      }}
    >
      {children}
    </h2>
  )
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div
      style={{
        padding: '30px 24px',
        borderRadius: 12,
        background: DANNIFY.raised,
        maxWidth: 520,
      }}
    >
      <div style={{ fontSize: 15, fontWeight: 650, marginBottom: 6 }}>{title}</div>
      <p style={{ margin: 0, fontSize: 12, lineHeight: 1.75, color: fg(0.5) }}>{body}</p>
    </div>
  )
}

function Back({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        marginBottom: 14,
        padding: 0,
        border: 0,
        background: 'transparent',
        color: fg(0.5),
        fontSize: 12,
        cursor: 'pointer',
      }}
    >
      ← Back
    </button>
  )
}

function Hero({
  cover,
  title,
  subtitle,
  description,
}: {
  cover: string | null
  title: string
  subtitle?: string
  description?: string
}) {
  return (
    <div style={{ display: 'flex', gap: 22, alignItems: 'flex-end' }}>
      {cover ? (
        <img
          src={cover}
          alt=""
          style={{ width: 168, height: 168, borderRadius: 10, objectFit: 'cover', flexShrink: 0 }}
        />
      ) : null}
      <div style={{ minWidth: 0 }}>
        <h1 style={{ margin: 0, fontSize: 30, fontWeight: 700, letterSpacing: '-0.02em' }}>
          {title}
        </h1>
        {subtitle ? (
          <div style={{ marginTop: 6, fontSize: 13, color: fg(0.5) }}>{subtitle}</div>
        ) : null}
        {description ? (
          <p
            style={{
              margin: '10px 0 0',
              fontSize: 12,
              lineHeight: 1.7,
              color: fg(0.45),
              maxWidth: 620,
            }}
          >
            {description}
          </p>
        ) : null}
      </div>
    </div>
  )
}

interface SongTileProps {
  songs: BrowseSong[]
  opening: string | null
  onPlay: (song: BrowseSong) => void
  onDownload: (song: BrowseSong) => void
  onRadio: (song: BrowseSong) => void
  /** The songs the account has liked. */
  liked?: Set<string>
  onToggleLike?: (song: BrowseSong) => void
}

/** A list of songs, as wide tiles — Dannify's `SongTile`. */
function SongTiles({
  songs,
  opening,
  onPlay,
  onDownload,
  onRadio,
  liked,
  onToggleLike,
}: SongTileProps) {
  return (
    <div>
      {songs.map((song) => (
        <div
          key={song.videoId}
          onClick={() => onPlay(song)}
          onContextMenu={(e) => e.preventDefault()}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 14,
            padding: '7px 10px',
            borderRadius: 8,
            cursor: 'pointer',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'rgb(255 255 255 / 0.05)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          <div
            style={{
              position: 'relative',
              width: 60,
              height: 60,
              borderRadius: 8,
              overflow: 'hidden',
              background: DANNIFY.raised,
              flexShrink: 0,
            }}
          >
            {song.coverUrl ? (
              <img
                src={song.coverUrl}
                alt=""
                loading="lazy"
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            ) : null}
            <button
              onClick={(e) => {
                e.stopPropagation()
                onPlay(song)
              }}
              disabled={opening !== null}
              aria-label={`Play ${song.name}`}
              style={{
                position: 'absolute',
                inset: 0,
                display: 'grid',
                placeItems: 'center',
                background: 'rgb(0 0 0 / 0.55)',
                border: 0,
                color: '#fff',
                cursor: 'pointer',
                opacity: 0,
                transition: 'opacity .12s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.opacity = '1')}
              onMouseLeave={(e) => (e.currentTarget.style.opacity = '0')}
            >
              {opening === song.videoId ? (
                <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} />
              ) : (
                <Play size={18} style={{ fill: 'currentColor' }} />
              )}
            </button>
          </div>

          <div style={{ minWidth: 0, flex: 1 }}>
            <div
              style={{
                fontSize: 13.5,
                color: DANNIFY.fg,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {song.name}
            </div>
            <div
              style={{
                fontSize: 11.5,
                color: fg(0.45),
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
            >
              {song.artists.join(', ') || 'Unknown artist'}
            </div>
          </div>

          {song.durationSecs ? (
            <span style={{ fontSize: 11, color: fg(0.4) }}>{fmt(song.durationSecs)}</span>
          ) : null}

          {/* the per-song actions */}
          <div style={{ display: 'flex', gap: 2, width: 100, justifyContent: 'flex-end' }}>
            {onToggleLike ? (
              <IconButton
                label={liked?.has(song.videoId) ? `Unlike ${song.name}` : `Like ${song.name}`}
                onClick={() => onToggleLike(song)}
              >
                <Heart
                  size={15}
                  style={{
                    color: liked?.has(song.videoId) ? DANNIFY.accent : fg(0.5),
                    fill: liked?.has(song.videoId) ? DANNIFY.accent : 'transparent',
                  }}
                />
              </IconButton>
            ) : null}
            <IconButton label={`Download ${song.name}`} onClick={() => onDownload(song)}>
              <Download size={15} />
            </IconButton>
            <IconButton label={`Radio from ${song.name}`} onClick={() => onRadio(song)}>
              <Shuffle size={15} />
            </IconButton>
          </div>
        </div>
      ))}
    </div>
  )
}

/** A grid of cards — Dannify's `MediaCard`. */
function MediaCards({
  cards,
  onOpen,
}: {
  cards: BrowseCard[]
  onOpen: (card: BrowseCard) => void
}) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
        gap: 14,
      }}
    >
      {cards.map((card) => (
        <button
          key={`${card.kind}:${card.browseId}`}
          onClick={() => onOpen(card)}
          style={{
            padding: 8,
            borderRadius: 10,
            border: 0,
            background: 'transparent',
            textAlign: 'left',
            cursor: 'pointer',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.background = 'rgb(255 255 255 / 0.05)')}
          onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
        >
          <div
            style={{
              borderRadius: 8,
              overflow: 'hidden',
              background: DANNIFY.raised,
              aspectRatio: '1 / 1',
              boxShadow: DANNIFY.shadowCard,
            }}
          >
            {card.coverUrl ? (
              <img
                src={card.coverUrl}
                alt=""
                loading="lazy"
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              />
            ) : null}
          </div>
          <div
            style={{
              marginTop: 8,
              fontSize: 12.5,
              color: DANNIFY.fg,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {card.name}
          </div>
          <div
            style={{
              fontSize: 11,
              color: fg(0.42),
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {card.subtitle || card.kind}
          </div>
        </button>
      ))}
    </div>
  )
}

/** A shelf on the home feed. */
function Shelf({
  shelf,
  opening,
  onPlay,
  onDownload,
  onRadio,
  onOpenCard,
}: {
  shelf: BrowseShelf
  opening: string | null
  onPlay: (song: BrowseSong) => void
  onDownload: (song: BrowseSong) => void
  onRadio: (song: BrowseSong) => void
  onOpenCard: (card: BrowseCard) => void
}) {
  if (!shelf.title && shelf.songs.length === 0 && shelf.cards.length === 0) return null
  return (
    <section style={{ marginBottom: 28 }}>
      {shelf.title ? <SectionTitle>{shelf.title}</SectionTitle> : null}
      {shelf.songs.length > 0 ? (
        <SongTiles
          songs={shelf.songs}
          opening={opening}
          onPlay={onPlay}
          onDownload={onDownload}
          onRadio={onRadio}
        />
      ) : (
        <MediaCards cards={shelf.cards} onOpen={onOpenCard} />
      )}
    </section>
  )
}
