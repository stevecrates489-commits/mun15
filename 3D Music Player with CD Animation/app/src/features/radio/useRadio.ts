import { useCallback, useEffect, useRef, useState } from 'react'
import { resolveStream, type Station } from '../../lib/radioBrowser'
import { IcyTracker, type IcyStatus } from '../../lib/icy'
import { RadioLevelMonitor } from '../../lib/radioLevel'
import { SongClock } from './songClock'
import { cleanRadioArtist, cleanRadioTitle, fetchRadioLyrics } from './radioLyrics'
import { lyricsToTtml } from '../../lib/ttml'

/* one element + one tracker for the whole session. A fresh Audio() per station
   leaks a decoder each time, and both must outlive a StrictMode remount so a
   live stream is not torn down and re-opened on the spot.

   The element is ADOPTED into the document by useRadio's mount effect (see
   below) before any station can start — a detached <audio> gets its playback
   suspended whenever the browser decides the page has nothing to play, which
   is exactly what killed the stream when the radio panel was closed. */
const el = typeof Audio !== 'undefined' ? new Audio() : null

/**
 * The station's element, for anything that needs to WATCH it.
 *
 * Radio plays on this element rather than the deck's, so the analyser that
 * feeds the halo, the equaliser and the backdrops knows nothing about a
 * station until it is told about this element (see `attachSource`).
 */
export const getRadioElement = (): HTMLAudioElement | null => el
const icy = new IcyTracker()

/* The playhead for a stream that has none, and the ear that hears where a
   song ends. Both outlive a StrictMode remount for the same reason the
   element does: a live stream must not be torn down and rebuilt on the
   spot. The clock is pure arithmetic; the level monitor watches a private
   second element and is safe to fail — see radioLevel.ts. */
const clock = new SongClock()
/* the level monitor is a session singleton, so its verdict reaches the hook
   through this hand-off — the same shape as reopenRef below */
let levelEndRef: (atMs: number) => void = () => {}
const level = new RadioLevelMonitor({
  onEnd: (atMs) => levelEndRef(atMs),
})

/* The detected-song debounce must be cancellable from OUTSIDE its effect: a
   timer left pending when the station changes fires a couple of seconds later
   and resurrects the PREVIOUS station's song — which reads as "every station
   shows the same artist". */
let songTimer = 0
const clearSongTimer = () => {
  if (songTimer) {
    window.clearTimeout(songTimer)
    songTimer = 0
  }
}

export interface KnownStation {
  uuid: string
  name: string
  url: string
  codec: string
  bitrate: number
  country: string
  playedAt: number
}

export interface RadioSong {
  artist: string
  title: string
  raw: string
  /* which stream this title came from. A detection that outlives its station
     is the bug: it keeps the previous artist on screen for the next station, and
     it makes the lyrics panel fetch the WRONG song — hence "no lyrics found"
     on a track change, and PIN returning nothing to store. */
  url: string
  /* the synced lyrics, as TTML. Empty until the lyrics source answers, and
     empty forever when it has nothing for this song — the panel then falls
     back to its own providers. */
  ttml: string
  /* the song's length in seconds as the lyrics source reports it. 0 when
     unknown: the clock uses it to work out how late the station announced. */
  durationSec: number
  /* which announcement this is — a stale lookup is discarded by comparing it */
  token: number
}

const KNOWN_KEY = 'md-radio-known'
const ADD_ALL_KEY = 'md-radio-add-all'
const FAV_KEY = 'md-radio-favs'
/* the user's correction to the radio playhead, in seconds. The clock learns
   the station's own lag; this is the part only a listener can judge. */
const LEAD_KEY = 'md-radio-lead'
/* whether the level detector runs at all. It opens a second connection to
   the stream, which some stations count against their listener limit. */
const LEVEL_KEY = 'md-radio-level'

const MAX_RETRIES = 3
const RETRY_BASE = 2500
/* a reconnect only counts as "recovered" after this much uninterrupted
   playback. Without it a stream that dies every few seconds reconnects
   forever — heard as music coming and going, not as an error. */
const STABLE_MS = 15_000
/* two resume attempts inside this window would fight each other over the
   same socket, so the watchdog only nudges the element this often */
const RESUME_GAP = 1200

const readJson = <T,>(key: string, fallback: T): T => {
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? 'null')
    return (Array.isArray(raw) ? raw : fallback) as T
  } catch {
    return fallback
  }
}

const writeJson = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* private mode / quota — the list still works for this session */
  }
}

/**
 * Live radio. Deliberately OUTSIDE the Web Audio graph:
 *
 *  - a stream has no finite length, so it cannot be decoded into an AudioBuffer
 *    the way library tracks are (that engine is for local files, on purpose);
 *  - streams rarely send CORS headers, and `createElementSource` on a non-CORS
 *    source produces SILENCE — much worse than a resting visualiser.
 *
 * When a stream DOES permit metadata, the ICY tracker reads "now playing"
 * out of it and the result is surfaced as `currentSong` for the lyrics panel.
 */
export function useRadio(onStart: () => void) {
  const [known, setKnown] = useState<KnownStation[]>(() => readJson(KNOWN_KEY, []))
  /* OFF by default: with it on, every stream that plays was saved into the
     known list under its raw address, and the list filled up with URLs
     instead of station names. Only starred stations are kept unless the
     reader asks for more. */
  const [addAll, setAddAll] = useState(() => localStorage.getItem(ADD_ALL_KEY) === '1')
  const [favourites, setFavourites] = useState<string[]>(() => readJson(FAV_KEY, []))
  const [current, setCurrent] = useState<KnownStation | null>(null)
  const [song, setSong] = useState<RadioSong | null>(null)
  const [icyStatus, setIcyStatus] = useState<IcyStatus | null>(null)
  const [playing, setPlaying] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [reconnecting, setReconnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /* the song was heard to end — the fade-out, or a silence long enough to be
     one. The clock keeps running; this only says the station is between
     songs, which the panel shows. */
  const [songEnded, setSongEnded] = useState(false)
  /* the listener's own correction to the radio playhead, in seconds */
  const [lead, setLeadState] = useState(() => {
    const n = Number(localStorage.getItem(LEAD_KEY))
    return Number.isFinite(n) ? n : 0
  })
  const [levelOn, setLevelOnState] = useState(() => localStorage.getItem(LEVEL_KEY) !== '0')

  /* the stall watchdog: a stream can die WITHOUT an error event (the socket
     just stops delivering), so liveness is watched rather than assumed */
  const lastDataRef = useRef(0)
  const wantRef = useRef(false)
  /* the panel taunts the mixer with this: playback must outlive the panel, so
     a pause that nobody asked for is treated as an interruption, not a stop */
  const userPausedRef = useRef(false)
  const retryRef = useRef(0)
  const retryTimerRef = useRef(0)
  /* when the current healthy run of playback began — the retry budget is only
     refunded after it has lasted STABLE_MS */
  const healthyAtRef = useRef(0)
  const lastResumeAtRef = useRef(0)
  const resumeFailsRef = useRef(0)
  /* re-open path, reachable from the resume watchdog (which is created before
     open() exists) without adding open() to a dependency list */
  const reopenRef = useRef<() => void>(() => {})
  const urlRef = useRef('')
  const metaRef = useRef<{
    uuid: string
    name: string
    codec: string
    bitrate: number
    country: string
  } | undefined>(undefined)
  /* the announcement currently being displayed, and the one being fetched —
     a title that arrives while a lookup is in flight must not be overwritten
     by the older answer, and the token is how that is spotted */
  const pendingSongRef = useRef<RadioSong | null>(null)
  const songTokenRef = useRef(0)


  /* ── the element lives in the document, not in the panel ───────────────
     An <audio> that is not attached anywhere is suspended by the engine when
     it stops being referenced by visible UI: the stream falls silent, the
     watchdog retries, goes silent again — the "goes and comes" loop. Adopting
     the SAME element once (adoptNode, so it survives a StrictMode remount and
     keeps its src and decoder) inside a display:none sink gives it a stable
     home for the whole session. */
  useEffect(() => {
    if (!el || el.isConnected || document.getElementById('md-radio-sink')) return
    const sink = document.createElement('div')
    sink.id = 'md-radio-sink'
    sink.style.display = 'none'
    document.body.appendChild(sink)
    sink.appendChild(document.adoptNode(el))
  }, [])

  /* every unasked-for pause is resumed, and `playing` is put back in step.
     Sources of one, all seen in the wild: the panel closing, a tab switch, a
     lock screen, the OS muting a background renderer, closing a file dialog.
     Only stop() and the explicit toggle() are allowed to leave `wantRef` set
     while paused, which is why they are the only paths that clear it. */
  useEffect(() => {
    if (!el) return
    const resume = () => {
      if (!wantRef.current || userPausedRef.current || !el.paused) return
      /* a paused element with no src is the teardown between two stations —
         play() there would just log an abort */
      if (!el.getAttribute('src')) return
      const now = Date.now()
      if (now - lastResumeAtRef.current < RESUME_GAP) return
      lastResumeAtRef.current = now
      lastDataRef.current = now
      void el
        .play()
        .then(() => {
          resumeFailsRef.current = 0
          setPlaying(true)
        })
        .catch(() => {
          /* the element refused: its connection is gone, not paused. A couple
             of silent nudges first, then a real reconnect — repeatedly calling
             play() on a dead socket is the loop that sounded like the stream
             going and coming. */
          resumeFailsRef.current++
          if (resumeFailsRef.current < 3) return
          resumeFailsRef.current = 0
          reopenRef.current()
        })
    }
    el.addEventListener('pause', resume)
    document.addEventListener('visibilitychange', resume)
    window.addEventListener('focus', resume)
    window.addEventListener('pageshow', resume)
    /* the belt to the event braces: an element can be paused silently (no
       event at all) by the renderer under memory pressure */
    const iv = window.setInterval(resume, 2000)
    return () => {
      el.removeEventListener('pause', resume)
      document.removeEventListener('visibilitychange', resume)
      window.removeEventListener('focus', resume)
      window.removeEventListener('pageshow', resume)
      window.clearInterval(iv)
    }
  }, [])

  const remember = useCallback((s: KnownStation) => {
    setKnown((prev) => {
      const next = [s, ...prev.filter((k) => k.url !== s.url)].slice(0, 40)
      writeJson(KNOWN_KEY, next)
      return next
    })
  }, [])

  /**
   * Where the radio is inside the current song, in seconds.
   *
   * Stable on purpose: the lyrics panel samples it every animation frame,
   * and a new function identity would restart that loop on every render.
   */
  const getSongTime = useCallback(() => clock.positionSec(Date.now()), [])

  const setLead = useCallback((sec: number) => {
    const v = Number.isFinite(sec) ? Math.max(-30, Math.min(60, sec)) : 0
    setLeadState(v)
    localStorage.setItem(LEAD_KEY, String(Math.round(v * 10) / 10))
  }, [])

  const setLevelOn = useCallback((on: boolean) => {
    setLevelOnState(on)
    localStorage.setItem(LEVEL_KEY, on ? '1' : '0')
    if (!on) level.stop()
  }, [])

  const open = useCallback(
    async (
      url: string,
      meta?: { uuid: string; name: string; codec: string; bitrate: number; country: string },
    ) => {
      if (!el || !url) return
      onStart()
      urlRef.current = url
      metaRef.current = meta
      /* the teardown below pauses the element — disarm the resume watchdog
         FIRST, or it would call play() on the emptied element */
      wantRef.current = false
      setError(null)
      setConnecting(true)
      setPlaying(false)
      userPausedRef.current = false
      resumeFailsRef.current = 0
      healthyAtRef.current = Date.now()
      clearSongTimer() /* otherwise the previous station's title resurfaces */
      setSong(null)
      pendingSongRef.current = null
      setSongEnded(false)
      /* the clock belongs to the station, not to the song: it is reset here
         because a new station announces its titles differently */
      clock.reset()

      el.pause()
      try {
        el.removeAttribute('src')
        el.load()
      } catch {
        /* nothing was loaded — the stop is already true */
      }
      icy.stop()

      /* a .pls/.m3u link has to be opened before it can be played */
      let target = url.trim()
      try {
        target = await resolveStream(target)
      } catch {
        /* keep the raw URL — the element will report the real failure */
      }
      urlRef.current = target

      const rec: KnownStation = {
        uuid: meta?.uuid ?? target,
        name: meta?.name ?? target,
        url: target,
        codec: meta?.codec ?? '?',
        bitrate: meta?.bitrate ?? 0,
        country: meta?.country ?? '',
        playedAt: Date.now(),
      }
      setCurrent(rec)
      if (addAll) remember(rec)

      lastDataRef.current = Date.now()
      wantRef.current = true
      retryRef.current = 0
      setReconnecting(false)
      await icy.start(target, el)
      /* The ear for the fade-out. It opens a second connection to the same
         stream, so it starts only once the audio is up — and only if the
         listener wants it. It cannot affect playback: it watches a private
         element, and the one the user hears is never routed anywhere. */
      if (levelOn) level.start(target)
    },
    [addAll, onStart, remember, levelOn],
  )

  /* Giving up must STOP the element, not just relabel the state. An element
     left unpaused on a dead socket reports itself as playing for ever, so
     "STREAM LOST" could still be followed by a blip of sound — the last half
     of the "goes and comes" report. */
  const abandon = useCallback((msg: string) => {
    if (!el) return
    window.clearTimeout(retryTimerRef.current)
    wantRef.current = false
    resumeFailsRef.current = 0
    icy.stop()
    level.stop()
    try {
      el.pause()
      el.removeAttribute('src')
      el.load()
    } catch {
      /* nothing loaded — it is already silent */
    }
    setPlaying(false)
    setConnecting(false)
    setReconnecting(false)
    setError(msg)
  }, [])

  /* ── liveness: one event source, no duplicate timers ─────────────────── */
  useEffect(() => {
    if (!el) return
    const mark = () => {
      lastDataRef.current = Date.now()
      setConnecting(false)
      /* refund the retry budget only after a genuinely stable run: resetting
         it on the first byte let a flapping stream retry for ever */
      if (retryRef.current && Date.now() - healthyAtRef.current > STABLE_MS) retryRef.current = 0
    }
    const onPlaying = () => {
      userPausedRef.current = false
      healthyAtRef.current = Date.now()
      setPlaying(true)
      setConnecting(false)
      setError(null)
      mark()
    }
    const onWaiting = () => setConnecting(true)
    const onError = () => {
      if (!wantRef.current) return
      /* the metadata reader is a SECOND socket on the same stream. When audio
         fails, it must go quiet too — otherwise its own reconnect competes
         with the audio one and the station stutters instead of recovering. */
      icy.stop()
      setPlaying(false)
      setConnecting(false)
      setError('STREAM UNAVAILABLE')
      /* a permanent element error (code 4) is terminal; a spurious one while
         the stream is buffering recovers by itself, so only the dead case
         retries through open() */
      if (el?.error?.code === 4) {
        retryRef.current++
        if (retryRef.current > MAX_RETRIES) return abandon('STREAM UNAVAILABLE')
        window.clearTimeout(retryTimerRef.current)
        retryTimerRef.current = window.setTimeout(() => {
          if (wantRef.current) void open(urlRef.current, metaRef.current)
        }, RETRY_BASE * retryRef.current)
      }
    }
    const onEnded = () => {
      icy.stop()
      setPlaying(false)
      setConnecting(false)
    }
    el.addEventListener('playing', onPlaying)
    el.addEventListener('waiting', onWaiting)
    el.addEventListener('stalled', mark)
    el.addEventListener('progress', mark)
    el.addEventListener('timeupdate', mark)
    el.addEventListener('error', onError)
    el.addEventListener('ended', onEnded)
    const iv = window.setInterval(() => {
      if (!wantRef.current || !el.paused) return
      /* paused but expected to be live — that is the silent-death case */
      if (Date.now() - lastDataRef.current < 12_000) return
      retryRef.current++
      if (retryRef.current > MAX_RETRIES) return abandon('STREAM LOST')
      setReconnecting(true)
      /* exponential backoff: 2.5s, 5s, 7.5s — a dying mount, not a hammer */
      retryTimerRef.current = window.setTimeout(() => {
        if (!wantRef.current) return
        void open(urlRef.current, metaRef.current)
      }, RETRY_BASE * retryRef.current)
    }, 4000)
    return () => {
      el.removeEventListener('playing', onPlaying)
      el.removeEventListener('waiting', onWaiting)
      el.removeEventListener('stalled', mark)
      el.removeEventListener('progress', mark)
      el.removeEventListener('timeupdate', mark)
      el.removeEventListener('error', onError)
      el.removeEventListener('ended', onEnded)
      window.clearInterval(iv)
      window.clearTimeout(retryTimerRef.current)
    }
  }, [open, abandon])

  /* ── ICY metadata: "now playing" ──────────────────────────────────────
     Debounced in two places on purpose. The tracker drops changes closer than
     3s apart (station-name flicker), and this second one means a burst of
     titles — which is exactly what a mix does — settles before any lyric
     lookup is triggered.

     The CLOCK, though, is anchored the moment the title arrives, not two
     seconds later: the announcement is the station saying "this song starts
     now", and the position is measured from that instant. The debounce only
     delays what the panel shows. */
  useEffect(() => {
    const offSong = icy.onSong((s) => {
      const at = Date.now()
      /* a station's title carries the streaming-service noise — "Song (2020
         Remaster)", "Artist - Title - Live". The lyrics sources index the
         plain record, so the cleaned form is what gets looked up, and what
         the panel shows. */
      const artist = cleanRadioArtist(s.artist)
      const title = cleanRadioTitle(s.title) || s.title
      const url = urlRef.current

      clock.announce({ title, artist, url }, at)
      /* a new song has its own level: the detector's baseline is reset */
      level.reset()
      setSongEnded(false)

      const token = ++songTokenRef.current
      const entry: RadioSong = {
        artist,
        title,
        raw: s.raw,
        url,
        ttml: '',
        durationSec: 0,
        token,
      }
      pendingSongRef.current = entry

      clearSongTimer()
      songTimer = window.setTimeout(() => {
        const pending = pendingSongRef.current
        if (pending && pending.token === token) setSong(pending)
      }, 2000)

      /* The lyrics lookup starts NOW, in parallel with the debounce: it is a
         network round-trip and the highlight cannot wait for it. */
      void fetchRadioLyrics(artist, title)
        .then((found) => {
          const pending = pendingSongRef.current
          /* a title that arrived while this was in flight wins */
          if (!pending || pending.token !== token) return
          if (!found.synced && !found.plain) return
          const ttml = found.synced ? lyricsToTtml(found.lrc) : ''
          pending.ttml = ttml
          pending.durationSec = found.durationSec
          /* the song's length is what lets the clock work out how late this
             station announces its titles */
          if (found.durationSec > 0) clock.setDuration(found.durationSec)
          setSong((prev) => (prev && prev.token === token ? { ...pending } : prev))
        })
        .catch(() => {})
    })
    const offStatus = icy.onStatus(setIcyStatus)
    const offEnd = icy.onEnd(() => {
      if (!wantRef.current) return
      retryRef.current++
      if (retryRef.current > MAX_RETRIES) return abandon('STREAM ENDED')
      setReconnecting(true)
      retryTimerRef.current = window.setTimeout(() => {
        if (wantRef.current) void open(urlRef.current, metaRef.current)
      }, RETRY_BASE * retryRef.current)
    })
    return () => {
      clearSongTimer()
      offSong()
      offStatus()
      offEnd()
    }
  }, [open, abandon])
  /* the resume watchdog's escalation target: tear the dead socket down and
     tune the same station again (never a new one). Assigned in an effect, not
     during render — a ref write in the render body is a render side effect. */
  useEffect(() => {
    reopenRef.current = () => {
      if (!wantRef.current || userPausedRef.current || !urlRef.current) return
      void open(urlRef.current, metaRef.current)
    }
  }, [open])

  /* The level monitor is a session singleton, so its verdict comes back
     through a hand-off assigned here. It says the song ended — the clock
     records when, and the panel shows that the station is between songs. */
  useEffect(() => {
    levelEndRef = (atMs) => {
      clock.noteEnd(atMs)
      setSongEnded(true)
    }
    return () => {
      levelEndRef = () => {}
    }
  }, [])

  const playUrl = useCallback(
    (url: string, meta?: { uuid: string; name: string; codec: string; bitrate: number; country: string }) => {
      void open(url, meta)
    },
    [open],
  )

  const playStation = useCallback(
    (s: Station) => {
      if (!s.url) {
        setError('NO STREAM URL')
        return
      }
      void open(s.url, { uuid: s.uuid, name: s.name, codec: s.codec, bitrate: s.bitrate, country: s.country })
    },
    [open],
  )

  const stop = useCallback(() => {
    if (!el) return
    window.clearTimeout(retryTimerRef.current)
    wantRef.current = false
    userPausedRef.current = false
    clearSongTimer()
    icy.stop()
    level.stop()
    clock.reset()
    el.pause()
    try {
      el.removeAttribute('src')
      el.load()
    } catch {
      /* nothing loaded — already stopped */
    }
    setPlaying(false)
    setConnecting(false)
    setReconnecting(false)
    setCurrent(null)
    setSong(null)
    setIcyStatus(null)
    setError(null)
  }, [])

  const toggle = useCallback(() => {
    if (!el) return
    if (playing) {
      /* an explicit pause is the ONE pause that is allowed to stick */
      userPausedRef.current = true
      el.pause()
      setPlaying(false)
      return
    }
    setConnecting(true)
    userPausedRef.current = false
    wantRef.current = true
    lastDataRef.current = Date.now()
    void el.play().catch(() => setError('COULD NOT RESUME'))
  }, [playing])

  const forget = useCallback((url: string) => {
    setKnown((prev) => {
      const next = prev.filter((k) => k.url !== url)
      writeJson(KNOWN_KEY, next)
      return next
    })
  }, [])

  const setAddAllPersist = useCallback((on: boolean) => {
    setAddAll(on)
    localStorage.setItem(ADD_ALL_KEY, on ? '1' : '0')
  }, [])

  const toggleFavourite = useCallback((url: string) => {
    setFavourites((prev) => {
      const next = prev.includes(url) ? prev.filter((f) => f !== url) : [url, ...prev].slice(0, 100)
      writeJson(FAV_KEY, next)
      return next
    })
  }, [])

  /* a library track taking over the output must drop the radio title with it —
     otherwise the lyrics panel keeps fetching the RADIO song and shows
     "no lyrics found" for every library track */
  const clearSong = useCallback(() => {
    clearSongTimer()
    setSong(null)
    pendingSongRef.current = null
    setSongEnded(false)
    clock.reset()
  }, [])

  /* a local track taking over the output stops the stream WITHOUT forgetting
     the station: the next radio play resumes the same one from the panel */
  const pauseStream = useCallback(() => {
    if (!el) return
    wantRef.current = false
    userPausedRef.current = true
    clearSongTimer()
    icy.stop()
    level.stop()
    el.pause()
    setPlaying(false)
    setConnecting(false)
    setReconnecting(false)
    setSong(null)
    setIcyStatus(null)
    setError(null)
  }, [])

  return {
    known,
    addAll,
    setAddAll: setAddAllPersist,
    favourites,
    toggleFavourite,
    current,
    song,
    icyStatus,
    playing,
    connecting,
    reconnecting,
    error,
    /* the radio playhead: seconds into the current song, as far as the clock
       can tell. Sampled by the lyrics panel every frame. */
    getSongTime,
    /* the song was heard to end — the station is between songs */
    songEnded,
    /* the listener's correction to the playhead, in seconds */
    lead,
    setLead,
    /* whether the level detector runs */
    levelOn,
    setLevelOn,
    playStation,
    playUrl,
    stop,
    pauseStream,
    toggle,
    forget,
    clearSong,
  }
}
