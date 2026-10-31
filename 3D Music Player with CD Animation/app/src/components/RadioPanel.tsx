import { useEffect, useMemo, useRef, useState } from 'react'
import { X, Search, Play, Square, Trash2, Radio as RadioIcon, Star, Music2, Sparkles, ChevronDown, Mic2 } from 'lucide-react'
import {
  popularStations,
  searchStations,
  listLanguages,
  listCountries,
  type SearchField,
  type Station,
} from '../lib/radioBrowser'
import { getProxyBase, setProxyBase, type IcyStatus } from '../lib/icy'
import type { KnownStation, RadioSong } from '../features/radio/useRadio'

const FIELDS: { id: SearchField; label: string }[] = [
  { id: 'language', label: 'Language' },
  { id: 'country', label: 'Country' },
  { id: 'tag', label: 'Tag' },
  { id: 'name', label: 'Name' },
]

interface Props {
  known: KnownStation[]
  addAll: boolean
  onAddAll: (v: boolean) => void
  favourites: string[]
  onToggleFavourite: (
    url: string,
    meta?: { uuid?: string; name: string; codec?: string; bitrate?: number; country?: string },
  ) => void
  /** the song the stream is currently playing, when the stream carries titles */
  song: RadioSong | null
  icy: IcyStatus | null
  reconnecting: boolean
  onPlayStation: (s: Station) => void
  onPlayUrl: (
    url: string,
    meta?: { uuid: string; name: string; codec: string; bitrate: number; country: string },
  ) => void
  onForget: (url: string) => void
  current: KnownStation | null
  playing: boolean
  connecting: boolean
  error: string | null
  /* the song clock: where the radio is inside the current song */
  getSongTime: () => number
  songEnded: boolean
  lead: number
  onLead: (sec: number) => void
  levelOn: boolean
  onLevelOn: (v: boolean) => void
  /* what the live visual listens to while it is on: this station, or the
     deck. A source switch, not a power switch — the visual itself is
     turned on and off in the visualiser panel, never from here. */
  vizOn: boolean
  onVizToggle: (on: boolean) => void
  /* the lyrics panel's own toggle — the same switch the header chip flips,
     parked here so a radio listener never has to reach the main deck */
  lyricsOn: boolean
  onToggleLyrics: () => void
  stop: () => void
  onClose: () => void
}

/* the shape a row already holds — handed along when a station is starred or
   tuned, so the known list and the header keep the real name, not the URL */
type RowMeta = { uuid: string; name: string; codec: string; bitrate: number; country: string }
const metaOf = (s: {
  uuid: string
  name: string
  codec: string
  bitrate: number
  country: string
}): RowMeta => ({
  uuid: s.uuid,
  name: s.name,
  codec: s.codec,
  bitrate: s.bitrate,
  country: s.country,
})

const mbps = (kbps: number) => (kbps ? `${kbps}` : '—')

/* bitrate → a colour, so quality is readable without a number */
const qualityTone = (kbps: number) =>
  kbps >= 192 ? 'text-emerald-300' : kbps >= 128 ? 'text-amber-200' : 'text-rose-300'

const clock = (sec: number): string => {
  const s = Math.max(0, Math.floor(sec))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

/**
 * The station's own clock: where the song is, and how far the listener has
 * had to nudge it.
 *
 * The position is written straight into the DOM on every frame. React state
 * would re-render the whole panel sixty times a second to move four
 * characters, and the lyrics panel is already sampling this clock for the
 * highlight — two consumers of one number.
 */
function SongClockBar({
  getTime,
  durationSec,
  ended,
  lead,
  onLead,
}: {
  getTime: () => number
  durationSec: number
  ended: boolean
  lead: number
  onLead: (sec: number) => void
}) {
  const posRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    let raf = 0
    const tick = () => {
      const node = posRef.current
      if (node) {
        const t = getTime()
        node.textContent = durationSec > 0 ? `${clock(t)} / ${clock(durationSec)}` : clock(t)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [getTime, durationSec])

  return (
    <div className="flex items-center gap-2 border-b border-white/10 px-4 py-1.5 font-mono text-[7px] tracking-[0.15em] text-white/30">
      <span className={ended ? 'text-amber-300/80' : 'text-emerald-300/60'}>
        {ended ? 'BETWEEN SONGS' : 'POSITION'}
      </span>
      <span ref={posRef} className="text-white/60">
        00:00
      </span>
      <span className="flex-1" />
      {/* the lead is the one number only a listener can judge: the clock
          learns the station's own lag, but whether the highlight feels early
          or late is the ear's call */}
      <span className="text-white/25">LEAD</span>
      <button
        onClick={() => onLead(lead - 0.5)}
        aria-label="Shift the radio playhead earlier"
        className="rounded border border-white/15 px-1 text-white/50 transition hover:border-white/40 hover:text-white"
      >
        −
      </button>
      <span className="w-10 text-center text-white/60">
        {lead >= 0 ? '+' : ''}
        {lead.toFixed(1)}s
      </span>
      <button
        onClick={() => onLead(lead + 0.5)}
        aria-label="Shift the radio playhead later"
        className="rounded border border-white/15 px-1 text-white/50 transition hover:border-white/40 hover:text-white"
      >
        +
      </button>
    </div>
  )
}

/**
 * "Now playing" strip. Uses a TRANSITION rather than a keyframe: the fx
 * governor sets `animation: none !important` from tier 2 up, which would kill
 * an entrance animation on any machine under load — a transition survives it.
 * Remounting on each new song restarts the transition, so every track change
 * reads as a change.
 */
function NowPlayingStrip({
  song,
  station,
  tone,
  connecting,
}: {
  song: RadioSong | null
  station: string
  tone: string
  connecting?: boolean
}) {
  /* mounted fresh per track change (the parent keys it), so the initial state
     is already "off-screen" and the transition has something to run from.
     Only the flip is in the effect — never a synchronous setState. */
  const [inView, setInView] = useState(false)
  useEffect(() => {
    const raf = requestAnimationFrame(() => setInView(true))
    return () => cancelAnimationFrame(raf)
  }, [])
  return (
    <div
      className="flex items-start gap-2 border-b border-white/10 px-4 py-2 transition-all duration-500 ease-[cubic-bezier(.22,1,.36,1)]"
      style={{
        opacity: inView ? 1 : 0,
        transform: inView ? 'translateY(0)' : 'translateY(8px)',
      }}
    >
      <Music2 size={11} className={`mt-px shrink-0 ${tone}`} />
      {/* the buffering beat: the stream is being fetched but nothing is on
          air yet — a spinner, not a dead name. Gone the moment audio starts
          or the attempt reports an error. */}
      {connecting && (
        <span
          aria-label="Connecting to the stream"
          title="CONNECTING…"
          className="mt-0.5 inline-block h-2.5 w-2.5 shrink-0 animate-spin rounded-full border-[1.5px] border-white/25 border-t-white/80"
        />
      )}
      {/* the station is always named — the detected song sits under it, so a
          title appearing is a change rather than a replacement */}
      <div className="min-w-0 flex-1">
        <div className="truncate font-mono text-[9px] tracking-[0.1em] text-white/70">{station || '—'}</div>
        {song && (
          <div className="truncate font-mono text-[8px] tracking-[0.08em] text-white/85">
            {song.artist ? `${song.artist} — ${song.title}` : song.title}
          </div>
        )}
      </div>
      <span
        className={`shrink-0 font-mono text-[7px] tracking-[0.15em] ${
          song ? 'text-emerald-300/70' : 'text-white/30'
        }`}
      >
        {song ? 'DETECTED' : 'NO TITLES'}
      </span>
    </div>
  )
}

/**
 * Radio browser — two tabs, mirroring the classic layout:
 * known stations (double-click / PLAY to tune) and a search that walks the
 * federation by language, country, tag or name.
 *
 * The station list is sorted playable-first by the API module, so the top rows
 * are the https mp3/aac streams that actually work in a webview. Sorting the
 * table re-sorts locally — the fetched set is never re-requested.
 */
export default function RadioPanel({
  known,
  addAll,
  onAddAll,
  favourites,
  onToggleFavourite,
  song,
  icy,
  reconnecting,
  onPlayStation,
  onPlayUrl,
  onForget,
  current,
  playing,
  connecting,
  error,
  getSongTime,
  songEnded,
  lead,
  onLead,
  levelOn,
  onLevelOn,
  vizOn,
  onVizToggle,
  lyricsOn,
  onToggleLyrics,
  stop,
  onClose,
}: Props) {
  const [tab, setTab] = useState<'known' | 'search'>('known')
  const [field, setField] = useState<SearchField>('language')
  const [query, setQuery] = useState('')
  const [rows, setRows] = useState<Station[]>([])
  const [loading, setLoading] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [customUrl, setCustomUrl] = useState('')
  const [proxy, setProxy] = useState(() => getProxyBase())
  const [sort, setSort] = useState<{ key: 'name' | 'codec' | 'bitrate' | 'votes'; dir: 1 | -1 }>({
    key: 'votes',
    dir: -1,
  })
  /* the proxy and the song-end detector are for the two people who know
     why they want them — everyone else should never have to read past them */
  const [showAdvanced, setShowAdvanced] = useState(false)
  /* the exit is played here rather than left to the unmount: the panel slides
     out over 280ms instead of vanishing between frames */
  const [closing, setClosing] = useState(false)
  const reqRef = useRef(0)

  /* language & country are pickers, not typing: the federation's own lists,
     loaded once each, most-stationed first. Tag and Name stay free text —
     they are exactly the fields a person has in their head. */
  const [languages, setLanguages] = useState<string[] | null>(null)
  const [countries, setCountries] = useState<string[] | null>(null)
  const pickList = field === 'language' ? languages : field === 'country' ? countries : null
  useEffect(() => {
    if (field === 'language' && languages === null) {
      void listLanguages().then(setLanguages).catch(() => setLanguages([]))
    }
    if (field === 'country' && countries === null) {
      void listCountries().then(setCountries).catch(() => setCountries([]))
    }
  }, [field, languages, countries])

  const runSearch = async (f: SearchField, q: string) => {
    const term = q.trim()
    if (!term) return
    const gen = ++reqRef.current
    setLoading(true)
    setSearchError(null)
    try {
      const list = f === 'country' ? await searchStations('country', term) : await searchStations(f, term)
      if (gen !== reqRef.current) return
      setRows(list)
      setSort({ key: 'votes', dir: -1 })
    } catch {
      if (gen !== reqRef.current) return
      setRows([])
      setSearchError('RADIO BROWSER UNREACHABLE')
    } finally {
      if (gen === reqRef.current) setLoading(false)
    }
  }

  /* seed the search tab with something playable so it is never empty */
  useEffect(() => {
    if (tab !== 'search' || rows.length || loading) return
    const gen = ++reqRef.current
    setLoading(true)
    void popularStations()
      .then((list) => {
        if (gen === reqRef.current) setRows(list)
      })
      .catch(() => {})
      .finally(() => {
        if (gen === reqRef.current) setLoading(false)
      })
  }, [tab, rows.length, loading])

  const sorted = useMemo(() => {
    const list = [...rows]
    list.sort((a, b) => {
      const av = a[sort.key]
      const bv = b[sort.key]
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * sort.dir
      return String(av).localeCompare(String(bv)) * sort.dir
    })
    return list
  }, [rows, sort])

  const th = (key: typeof sort.key, label: string, cls = '') => (
    <th className={`px-1.5 py-1 text-left font-mono text-[7px] tracking-[0.15em] text-white/30 transition hover:text-white/60 ${cls}`}>
      <button
        onClick={() => setSort((s) => ({ key, dir: s.key === key && s.dir === -1 ? 1 : -1 }))}
        className="px-1.5 py-1 text-left font-mono text-[7px] tracking-[0.15em] text-white/30 transition hover:text-white/60"
      >
        {label}
        {sort.key === key && <span className="ml-0.5">{sort.dir === -1 ? '▾' : '▴'}</span>}
      </button>
    </th>
  )

  return (
    <div
      className={`settings-panel fx-blur fixed bottom-[calc(13%+46px)] left-[5%] z-[89] flex max-h-[min(62vh,520px)] w-[min(92vw,560px)] flex-col rounded-2xl border border-white/15 bg-black/90 backdrop-blur-md${
        closing ? ' is-closing panel-out-soft' : ''
      }`}
    >
      {/* header */}
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
        <span className="flex items-center gap-2 font-mono text-[9px] tracking-[0.25em] text-white/50">
          <RadioIcon size={12} />
          RADIO
        </span>
        <div className="flex items-center gap-2">
          {/* the live visual's source, from inside the radio: ON makes the
              backdrop listen to this station, OFF hands it back to the deck.
              The visual itself is switched in the visualiser panel. */}
          <button
            onClick={() => onVizToggle(!vizOn)}
            aria-pressed={vizOn}
            title={vizOn ? 'The visual is listening to this station' : 'The visual is listening to the deck'}
            className={`flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[7px] tracking-[0.15em] transition ${
              vizOn
                ? 'border-emerald-300/60 bg-emerald-400/15 text-emerald-200'
                : 'border-white/15 text-white/50 hover:border-white/40 hover:text-white'
            }`}
          >
            <Sparkles size={8} />
            VISUAL {vizOn ? 'ON' : 'OFF'}
          </button>
          {/* lyrics — the main player's toggle, reachable where the radio
              listener already is. The panel opens for the radio's own
              detected songs exactly as it does for library tracks. */}
          <button
            onClick={onToggleLyrics}
            aria-pressed={lyricsOn}
            title={lyricsOn ? 'Hide the lyrics panel' : 'Show the lyrics panel'}
            className={`flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[7px] tracking-[0.15em] transition ${
              lyricsOn
                ? 'border-emerald-300/60 bg-emerald-400/15 text-emerald-200'
                : 'border-white/15 text-white/50 hover:border-white/40 hover:text-white'
            }`}
          >
            <Mic2 size={8} />
            LYRICS {lyricsOn ? 'ON' : 'OFF'}
          </button>
          {(playing || connecting) && current && (
            <button
              onClick={stop}
              title="Stop"
              className="flex items-center gap-1 rounded-full border border-white/15 px-2 py-0.5 font-mono text-[7px] tracking-[0.15em] text-white/50 transition hover:border-white/40 hover:text-white"
            >
              <Square size={8} />
              STOP
            </button>
          )}
          <button
            onClick={() => {
              setClosing(true)
              window.setTimeout(onClose, 280)
            }}
            aria-label="Close radio"
            className="text-white/40 hover:text-white"
          >
            <X size={12} />
          </button>
        </div>
      </div>

      {/* now playing — the detected song when the stream carries one */}
      <NowPlayingStrip
        key={song?.raw ?? current?.url ?? 'idle'}
        song={song}
        station={current?.name ?? ''}
        tone={current ? (playing ? 'text-red-400' : 'text-white/30') : 'text-white/25'}
        connecting={connecting && !playing}
      />
      {/* the station's own clock — where the song is, and the listener's
          correction to it */}
      {song && (
        <SongClockBar
          getTime={getSongTime}
          durationSec={song.durationSec}
          ended={songEnded}
          lead={lead}
          onLead={onLead}
        />
      )}
      {/* metadata status: says plainly when a stream will not give up titles,
          rather than leaving the reader to wonder why nothing appears */}
      {icy && icy.kind !== 'probing' && (
        <div className="border-b border-white/10 px-4 py-1.5 font-mono text-[7px] tracking-[0.15em] text-white/30">
          {icy.kind === 'live'
            ? `ICY · ${icy.mime?.toUpperCase() ?? 'STREAM'}${icy.station ? ` · ${icy.station}` : ''}`
            : icy.message ?? 'NO METADATA'}
        </div>
      )}
      {reconnecting && (
        <div className="border-b border-white/10 px-4 py-1.5 font-mono text-[7px] tracking-[0.15em] text-amber-300">
          RECONNECTING…
        </div>
      )}
      {error && <div className="border-b border-white/10 px-4 py-1.5 font-mono text-[7px] tracking-[0.15em] text-rose-300">{error}</div>}

      {/* tabs */}
      <div className="flex items-center gap-1 px-4 pt-2">
        {(
          [
            ['known', `KNOWN STATIONS${known.length ? ` · ${known.length}` : ''}`],
            ['search', 'SEARCH'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`rounded-t-md px-3 py-1.5 font-mono text-[8px] tracking-[0.15em] transition ${
              tab === id ? 'bg-white/10 text-white' : 'text-white/40 hover:bg-white/5 hover:text-white/70'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'known' ? (
        <>
          <div className="radio-scroll min-h-0 flex-1 overflow-y-auto px-4 py-2">
            {known.length === 0 ? (
              <div className="py-6 text-center font-mono text-[8px] tracking-[0.2em] text-white/30">
                NOTHING TUNED YET
                <br />
                <span className="text-white/20">SEARCH A STATION, OR PASTE A STREAM URL BELOW</span>
              </div>
            ) : (
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="px-1.5 py-1 text-left font-mono text-[7px] tracking-[0.15em] text-white/30">NAME</th>
                    <th className="px-1.5 py-1 text-left font-mono text-[7px] tracking-[0.15em] text-white/30">CODEC</th>
                    <th className="px-1.5 py-1 text-right font-mono text-[7px] tracking-[0.15em] text-white/30">KBPS</th>
                    <th className="px-1.5 py-1 text-left font-mono text-[7px] tracking-[0.15em] text-white/30">URL</th>
                    <th className="w-6" />
                  </tr>
                </thead>
                <tbody>
                  {known.map((s) => (
                    <tr
                      key={s.url}
                      onDoubleClick={() => onPlayUrl(s.url, metaOf(s))}
                      className={`group cursor-pointer transition-colors ${current?.url === s.url ? 'bg-white/[0.08]' : 'hover:bg-white/[0.05]'}`}
                    >
                      <td className="max-w-[160px] truncate px-1.5 py-1.5 text-[11px] text-white/75 group-hover:text-white">{s.name}</td>
                      <td className="px-1.5 py-1.5 font-mono text-[8px] text-white/40">{s.codec}</td>
                      <td className={`px-1.5 py-1.5 text-right font-mono text-[8px] ${qualityTone(s.bitrate)}`}>
                        {mbps(s.bitrate)}
                      </td>
                      <td className="max-w-[120px] truncate px-1.5 py-1.5 font-mono text-[7px] text-white/25">{s.url}</td>
                      <td className="px-1 py-1.5">
                        <span className="flex items-center gap-0.5">
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              onPlayUrl(s.url, metaOf(s))
                            }}
                            title="Play"
                            className="grid h-6 w-6 place-items-center rounded-md text-white/45 transition hover:bg-white/10 hover:text-white"
                          >
                            <Play size={12} />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              onToggleFavourite(s.url)
                            }}
                            title={favourites.includes(s.url) ? 'Remove from favourites' : 'Add to favourites'}
                            className={`grid h-6 w-6 place-items-center rounded-md transition hover:bg-white/10 ${
                              favourites.includes(s.url) ? 'text-amber-300' : 'text-white/35 hover:text-white'
                            }`}
                          >
                            <Star size={12} className={favourites.includes(s.url) ? 'fill-amber-300' : ''} />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              onForget(s.url)
                            }}
                            title="Remove"
                            className="grid h-6 w-6 place-items-center rounded-md text-white/45 transition hover:bg-white/10 hover:text-rose-300"
                          >
                            <Trash2 size={12} />
                          </button>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="border-t border-white/10 px-4 py-2">
            <label className="flex cursor-pointer items-center gap-2 font-mono text-[8px] tracking-[0.12em] text-white/40">
              <input
                type="checkbox"
                checked={addAll}
                onChange={(e) => onAddAll(e.target.checked)}
                className="h-3 w-3 accent-emerald-400"
              />
              ADD ALL PLAYED RADIO STREAMS TO THE LIST
            </label>
          </div>

          <div className="border-t border-white/10 px-4 py-3">
            <button
              onClick={() => setShowAdvanced((v) => !v)}
              aria-expanded={showAdvanced}
              className="flex w-full items-center justify-between font-mono text-[7px] tracking-[0.2em] text-white/35 transition hover:text-white/70"
            >
              <span>ADVANCED</span>
              <ChevronDown
                size={10}
                className={`transition-transform duration-300 ${showAdvanced ? 'rotate-180' : ''}`}
              />
            </button>
            {showAdvanced && (
              <div className="fade-in mt-3">
                <div className="mb-1.5 font-mono text-[7px] tracking-[0.2em] text-white/35">
                  METADATA PROXY · OPTIONAL
                </div>
                <input
                  value={proxy}
                  onChange={(e) => setProxy(e.target.value)}
                  onBlur={(e) => {
                    const v = e.target.value.trim()
                    localStorage.setItem('md-radio-proxy', v)
                    setProxyBase(v)
                  }}
                  onKeyDown={(e) => {
                    if (e.key !== 'Enter') return
                    const v = e.currentTarget.value.trim()
                    localStorage.setItem('md-radio-proxy', v)
                    setProxyBase(v)
                  }}
                  placeholder="https://icy-proxy.you.workers.dev"
                  spellCheck={false}
                  className="w-full rounded-lg border border-white/15 bg-white/5 px-2.5 py-1.5 font-mono text-[9px] text-white outline-none transition focus:border-white/40"
                />
                <p className="mt-1.5 font-mono text-[7px] leading-relaxed tracking-[0.1em] text-white/25">
                  A one-file relay in front of a stream. Only the metadata reads use it — playback stays
                  direct.
                  {proxy ? ' ACTIVE — RESTART A STATION TO APPLY.' : ' EMPTY MEANS DIRECT.'}
                </p>
                <label className="mt-3 flex cursor-pointer items-center gap-2 font-mono text-[7px] tracking-[0.12em] text-white/35">
                  <input
                    type="checkbox"
                    checked={levelOn}
                    onChange={(e) => onLevelOn(e.target.checked)}
                    className="h-3 w-3 accent-emerald-400"
                  />
                  DETECT WHEN A SONG ENDS
                </label>
                <p className="mt-1 font-mono text-[7px] leading-relaxed tracking-[0.1em] text-white/20">
                  Watches the level of a second, silent copy of the stream to catch the end of a song. Needs
                  a station that allows CORS; without one it simply stays quiet. Off means no second
                  connection.
                </p>
              </div>
            )}
          </div>

          <div className="border-t border-white/10 px-4 py-3">
            <div className="mb-1.5 font-mono text-[7px] tracking-[0.2em] text-white/35">PLAY BY STREAM ADDRESS</div>
            <div className="flex gap-2">
              <input
                value={customUrl}
                onChange={(e) => setCustomUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && customUrl.trim()) {
                    onPlayUrl(customUrl.trim())
                    setCustomUrl('')
                  }
                }}
                placeholder="https://stream.example.com/live.mp3"
                spellCheck={false}
                className="min-w-0 flex-1 rounded-lg border border-white/15 bg-white/5 px-2.5 py-1.5 font-mono text-[10px] text-white outline-none transition focus:border-white/40"
              />
              <button
                onClick={() => {
                  if (!customUrl.trim()) return
                  onPlayUrl(customUrl.trim())
                  setCustomUrl('')
                }}
                disabled={!customUrl.trim()}
                className="flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 font-mono text-[8px] tracking-[0.15em] text-black transition disabled:opacity-30"
                style={{
                  background: 'linear-gradient(145deg,#f4f7fa 0%,#c7ccd4 40%,#9aa2ac 70%,#e8ecf1 100%)',
                }}
              >
                <Play size={9} strokeWidth={2.5} />
                PLAY
              </button>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="flex items-end gap-2 border-b border-white/10 px-4 py-2">
            <select
              value={field}
              onChange={(e) => {
                setField(e.target.value as SearchField)
                setQuery('')
              }}
              className="rounded-lg border border-white/15 bg-white/5 px-2 py-1.5 font-mono text-[9px] text-white/80 outline-none focus:border-white/40"
            >
              {FIELDS.map((f) => (
                <option key={f.id} value={f.id} className="bg-black">
                  {f.label}
                </option>
              ))}
            </select>
            {pickList ? (
              /* language & country: chosen from the federation's own list —
                 no spelling, no guessing which spelling the server uses */
              <select
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  if (e.target.value) void runSearch(field, e.target.value)
                }}
                className="min-w-0 flex-1 rounded-lg border border-white/15 bg-white/5 px-2.5 py-1.5 font-mono text-[10px] text-white outline-none transition focus:border-white/40"
                style={{ colorScheme: 'dark' }}
              >
                <option value="" className="bg-black">
                  {pickList.length ? `— pick a ${field} —` : 'LOADING…'}
                </option>
                {pickList.map((name) => (
                  <option key={name} value={name} className="bg-black">
                    {name}
                  </option>
                ))}
              </select>
            ) : (
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void runSearch(field, query)
                }}
                placeholder={field === 'tag' ? 'jazz' : 'queen'}
                spellCheck={false}
                className="min-w-0 flex-1 rounded-lg border border-white/15 bg-white/5 px-2.5 py-1.5 font-mono text-[10px] text-white outline-none transition focus:border-white/40"
              />
            )}
            <button
              onClick={() => void runSearch(field, query)}
              disabled={!query.trim() || loading}
              className="flex shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 font-mono text-[8px] tracking-[0.15em] text-black transition disabled:opacity-30"
              style={{
                background: 'linear-gradient(145deg,#f4f7fa 0%,#c7ccd4 40%,#9aa2ac 70%,#e8ecf1 100%)',
              }}
            >
              <Search size={9} strokeWidth={2.5} />
              {loading ? '…' : 'GO'}
            </button>
          </div>

          <div className="radio-scroll min-h-0 flex-1 overflow-y-auto">
            <div className="px-4">
            {searchError ? (
              <div className="px-4 py-8 text-center font-mono text-[8px] tracking-[0.2em] text-rose-300/80">
                {searchError}
                <br />
                <span className="text-white/25">THE FEDERATION IS OFTEN BRIEFLY DOWN — TRY AGAIN</span>
              </div>
            ) : loading ? (
              <div className="py-3">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="mb-2 flex items-center gap-3">
                    <div className="skeleton-row h-6 flex-1 rounded" />
                    <div className="skeleton-row h-6 w-12 rounded" />
                    <div className="skeleton-row h-6 w-8 rounded" />
                  </div>
                ))}
              </div>
            ) : sorted.length === 0 ? (
              <div className="px-4 py-8 text-center font-mono text-[8px] tracking-[0.2em] text-white/30">NO MATCHES</div>
            ) : (
              <table className="w-full border-collapse">
                <thead>
                  <tr className="border-b border-white/10">
                    {th('name', 'NAME')}
                    {th('codec', 'CODEC')}
                    {th('bitrate', 'KBPS', 'text-right')}
                    {th('votes', 'POPULARITY', 'text-right')}
                    <th className="w-6" />
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((s) => (
                    <tr
                      key={s.uuid}
                      onDoubleClick={() => onPlayStation(s)}
                      className={`group cursor-pointer transition-colors ${current?.url === s.url ? 'bg-white/[0.08]' : 'hover:bg-white/[0.05]'}`}
                    >
                      <td className="max-w-[220px] px-1.5 py-1.5">
                        <span className="block truncate text-[11px] text-white/75 group-hover:text-white">{s.name}</span>
                        <span className="block truncate font-mono text-[7px] text-white/20">
                          {[s.country, s.language].filter(Boolean).join(' · ')}
                        </span>
                      </td>
                      <td className="px-1.5 py-1.5 font-mono text-[8px] text-white/40">{s.codec}</td>
                      <td className={`px-1.5 py-1.5 text-right font-mono text-[8px] ${qualityTone(s.bitrate)}`}>
                        {mbps(s.bitrate)}
                      </td>
                      <td className="px-1.5 py-1.5 text-right font-mono text-[8px] text-white/40">{s.votes}</td>
                      <td className="px-1 py-1.5">
                        <span className="flex items-center gap-0.5">
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              onPlayStation(s)
                            }}
                            title="Play"
                            className="grid h-6 w-6 place-items-center rounded-md text-white/45 transition hover:bg-white/10 hover:text-white"
                          >
                            <Play size={12} />
                          </button>
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              onToggleFavourite(s.url, metaOf(s))
                            }}
                            title={favourites.includes(s.url) ? 'Remove from favourites' : 'Add to favourites'}
                            className={`grid h-6 w-6 place-items-center rounded-md transition hover:bg-white/10 ${
                              favourites.includes(s.url) ? 'text-amber-300' : 'text-white/35 hover:text-white'
                            }`}
                          >
                            <Star size={12} className={favourites.includes(s.url) ? 'fill-amber-300' : ''} />
                          </button>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            </div>
          </div>

          <div className="border-t border-white/10 px-4 py-2 text-right font-mono text-[7px] tracking-[0.15em] text-white/25">
            Powered by{' '}
            <a href="https://www.radio-browser.info" target="_blank" rel="noreferrer" className="text-white/40 underline hover:text-white/70">
              radio-browser
            </a>
          </div>
        </>
      )}
    </div>
  )
}
