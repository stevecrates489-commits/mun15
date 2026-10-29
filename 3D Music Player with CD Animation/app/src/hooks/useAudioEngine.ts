import { useCallback, useEffect, useRef, useState } from 'react'
import { sourcesPlay } from '../features/sources/bridge'

export interface Track {
  id: number
  title: string
  artist: string
  genre: string
  src: string
  cover?: string
  /**
   * For an online track: where it came from.
   *
   * The `src` of an online track is a LOCAL handle that is only good for
   * this session, so it is resolved again every time the track is played.
   * The provider's real address never reaches this code — the registry
   * hands back a loopback URL and keeps the rest to itself.
   */
  remote?: {
    /** `provider:external-id` */
    contentId: string
    provider: string
  }
}

export type RepeatMode = 'off' | 'all' | 'one'

/* ---- playback engine ---------------------------------------------------
   Playback is a single <audio> element routed through ONE Web Audio graph
   (media element → gain → analyser → destination). The previous version
   decoded every file into an AudioBuffer before it could start, which meant
   a 3-4s wait on each track change (and a whole-file decode queued behind
   any pre-decode). A media element starts as soon as the demuxer has enough
   data — near-instant for the local blob URLs the library uses — while the
   analyser, gain and BPM visualiser keep working exactly as before.

   Trade-off: no custom decoded-buffer cache, so the browser owns buffering.
   For local files this is the right trade: the data is already on disk. */
export function useAudioEngine(tracks: Track[]) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const ctxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const gainRef = useRef<GainNode | null>(null)
  /* true when the element was CAPTURED into the graph: then the graph's gain is
     the volume. Normally the element plays on its own and its own volume is
     the volume, which is what keeps the music independent of the graph. */
  const capturedRef = useRef(false)

  const [trackIndex, setTrackIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [duration, setDuration] = useState(0)
  /* true only while the element is genuinely waiting for data — a local
     track should reach `playing` before this ever shows */
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  /* how many tracks in a row refused to play — see onError */
  const consecutiveErrors = useRef(0)

  /* the playback clock stays OUT of React state: a tick would re-render the
     whole Home tree. Subscribers get the position instead, and each one
     re-renders only the small subtree that shows the clock */
  const timeRef = useRef(0)
  const timeSubsRef = useRef(new Set<(t: number) => void>())

  const [volume, setVolumeState] = useState(() => {
    const n = Number(localStorage.getItem('md-volume'))
    return Number.isFinite(n) && n >= 0 && n <= 1 ? n : 0.85
  })
  const [shuffle, setShuffle] = useState(() => localStorage.getItem('md-shuffle') === '1')
  const [repeat, setRepeat] = useState<RepeatMode>(() => {
    const v = localStorage.getItem('md-repeat')
    return v === 'off' || v === 'one' || v === 'all' ? v : 'all'
  })
  useEffect(() => localStorage.setItem('md-shuffle', shuffle ? '1' : '0'), [shuffle])
  useEffect(() => localStorage.setItem('md-repeat', repeat), [repeat])

  const tracksRef = useRef(tracks)
  const indexRef = useRef(trackIndex)
  const shuffleRef = useRef(shuffle)
  const repeatRef = useRef(repeat)
  const volumeRef = useRef(volume)
  const autoAdvanceRef = useRef(true)
  const trackEndSubsRef = useRef(new Set<() => void>())
  const advanceRef = useRef<(dir: 1 | -1, auto: boolean) => void>(() => {})

  useEffect(() => {
    tracksRef.current = tracks
  }, [tracks])
  useEffect(() => {
    indexRef.current = trackIndex
  }, [trackIndex])
  useEffect(() => {
    shuffleRef.current = shuffle
  }, [shuffle])
  useEffect(() => {
    repeatRef.current = repeat
  }, [repeat])
  useEffect(() => {
    volumeRef.current = volume
  }, [volume])

  /* where the current element is pointed, so a late `error` from a torn-down
     source is ignored instead of failing the track that is now playing */
  const srcRef = useRef('')
  const durationRef = useRef(0)
  const offsetRef = useRef(0)
  /* a seek requested before metadata exists — applied by the element's own
     loadedmetadata handler so it is never silently dropped */
  const pendingSeekRef = useRef(0)

  const reportTime = useCallback((t: number) => {
    timeRef.current = t
    timeSubsRef.current.forEach((f) => f(t))
  }, [])

  const subscribeTime = useCallback((cb: (t: number) => void) => {
    timeSubsRef.current.add(cb) /* sync the subscriber immediately (mount / remount) */
    cb(timeRef.current)
    return () => {
      timeSubsRef.current.delete(cb)
    }
  }, [])

  const getCurrentTime = useCallback(() => {
    const el = audioRef.current
    if (el && el.readyState >= 1 && Number.isFinite(el.currentTime)) {
      return Math.max(0, el.currentTime)
    }
    return offsetRef.current
  }, [])

  /* one element + its listeners for the whole session */
  const ensureAudio = useCallback(() => {
    if (audioRef.current) return audioRef.current
    const el = new Audio()
    el.preload = 'auto'

    const onMeta = () => {
      durationRef.current = Number.isFinite(el.duration) ? el.duration : 0
      setDuration(durationRef.current)
      if (pendingSeekRef.current > 0) {
        const max = Math.max(0, durationRef.current - 0.05)
        try {
          el.currentTime = Math.min(pendingSeekRef.current, max)
        } catch {
          /* metadata landed without a seekable range — keep position 0 */
        }
        pendingSeekRef.current = 0
      }
      setBusy(false)
    }
    const onPlaying = () => {
      setPlaying(true)
      setBusy(false)
      setFailed(null)
      watchingRef.current = false
      consecutiveErrors.current = 0
    }
    const onPause = () => setPlaying(false)
    const onWaiting = () => {
      if (!el.paused) setBusy(true)
    }
    const onError = () => {
      /* an error from a source we already left behind is not this track's */
      if (!srcRef.current) return
      setBusy(false)
      setPlaying(false)
      setFailed(el.error?.code === 4 ? 'FORMAT NOT SUPPORTED' : 'COULD NOT PLAY THIS TRACK')
      /* a file that will not play must not leave the deck parked on it: say
         so, then move on. The counter is what keeps a library of nothing but
         bad files from tearing through itself in a second — two skips in a
         row and it stops trying (the message stays on screen). */
      consecutiveErrors.current += 1
      if (consecutiveErrors.current <= 2 && autoAdvanceRef.current) {
        window.setTimeout(() => advanceRef.current(1, true), 700)
      }
    }
    const onEnded = () => {
      if (repeatRef.current === 'one') {
        try {
          el.currentTime = 0
        } catch {
          /* not seekable — restart from whatever position the element has */
        }
        void el.play().catch(() => {})
        return
      }
      reportTime(durationRef.current)
      trackEndSubsRef.current.forEach((f) => f())
      if (autoAdvanceRef.current) advanceRef.current(1, true)
      else setPlaying(false)
    }

    el.addEventListener('loadedmetadata', onMeta)
    el.addEventListener('durationchange', onMeta)
    el.addEventListener('playing', onPlaying)
    el.addEventListener('pause', onPause)
    el.addEventListener('waiting', onWaiting)
    el.addEventListener('canplay', () => setBusy(false))
    el.addEventListener('error', onError)
    el.addEventListener('ended', onEnded)

    audioRef.current = el
    return el
  }, [reportTime])

  /* ONE AudioContext and ONE analyser chain for the whole session. The media
     element is routed through it so the chrome halo, the mini equaliser and
     the BPM-reactive disc keep their spectrum data. */

  /* Watch the deck's element through a capture stream — and keep trying until
     the stream has something in it.

     The graph is built during the boot intro, before any track is loaded, and
     an element with nothing to play hands back a capture stream with no
     tracks: a source node built from one is REFUSED. The old code tried once,
     took the refusal as final, and left the analyser watching nothing for the
     whole session — every spectrum read then said silence, whatever was
     playing. The capture is retried when the element gains media (and on
     every play), so the first refused attempt costs one frame, not the
     session. */
  const watchingRef = useRef(false)
  const watchDeck = useCallback(() => {
    const el = audioRef.current
    const ctx = ctxRef.current
    const gain = gainRef.current
    if (watchingRef.current || !el || !ctx || !gain) return
    const capture = el as unknown as {
      captureStream?: () => MediaStream
      webkitCaptureStream?: () => MediaStream
    }
    try {
      const stream = capture.captureStream?.() ?? capture.webkitCaptureStream?.()
      if (!stream || stream.getTracks().length === 0) return
      ctx.createMediaStreamSource(stream).connect(gain)
      watchingRef.current = true
      /* the element's own volume is the volume now — the graph's gain is
         only there to carry the analysis */
      el.volume = volumeRef.current
    } catch (e) {
      console.error('[audio] the capture stream could not be read', e)
    }
  }, [])

  const ensureGraph = useCallback((): AudioContext | null => {
    const el = ensureAudio()
    if (ctxRef.current) return ctxRef.current
    const w = window as unknown as {
      AudioContext?: typeof AudioContext
      webkitAudioContext?: typeof AudioContext
    }
    const Ctx = w.AudioContext ?? w.webkitAudioContext
    if (!Ctx) return null
    const ctx = new Ctx()
    const analyser = ctx.createAnalyser()
    analyser.fftSize = 512
    analyser.smoothingTimeConstant = 0.55
    const gain = ctx.createGain()
    gain.gain.value = 1
    gain.connect(analyser)
    /* The analyser has to be PULLED — a node whose output goes nowhere is
       never processed, and an analyser that is never processed reads
       silence. So it is connected onwards through a gain of NOTHING: the
       sound has already gone to the speakers by way of the element itself,
       and a second live path would play it twice. */
    const silent = ctx.createGain()
    silent.gain.value = 0
    analyser.connect(silent)
    silent.connect(ctx.destination)

    /* THE ELEMENT IS NEVER CAPTURED.
     *
     * Capturing it — createMediaElementSource — is what makes the sound
     * depend on this graph: once captured, the element's native output is
     * GONE and the only way out is through the analyser and the
     * destination. So a suspended context, a failed capture, a context that
     * never resumed — any of them is silence, and the element cannot be
     * got back.
     *
     * A capture stream gives the same analysis without taking the sound
     * away: the element keeps playing to the speakers on its own, and the
     * analyser watches a copy. The music is now structurally incapable of
     * being silenced by anything that happens in here. */
    const capture = (el as unknown as {
      captureStream?: () => MediaStream
      webkitCaptureStream?: () => MediaStream
    })
    if (capture.captureStream || capture.webkitCaptureStream) {
      watchDeck()
      el.addEventListener('loadedmetadata', watchDeck)
      el.addEventListener('playing', watchDeck)
    } else {
      /* No capture stream: fall back to capturing the element itself, which
         is what this did before, and which makes the sound depend on the
         graph. It is the last resort, not the plan. */
      try {
        const node = ctx.createMediaElementSource(el)
        node.connect(gain)
        gain.gain.value = volumeRef.current
        analyser.connect(ctx.destination)
        capturedRef.current = true
      } catch (e) {
        console.error('[audio] the media element could not be captured', e)
      }
    }
    ctxRef.current = ctx
    analyserRef.current = analyser
    gainRef.current = gain
    return ctx
  }, [ensureAudio, watchDeck])

  /* build the AudioContext + graph during the boot intro so the reveal lands
     on a warm engine — the first play must not hitch creating nodes */
  const prewarm = useCallback(() => {
    try {
      const ctx = ensureGraph()
      if (ctx) void ctx.resume().catch(() => {})
    } catch {
      /* webview without a usable AudioContext: stay silent, never wedge boot */
    }
  }, [ensureGraph])

  const startPlayback = useCallback(() => {
    const el = ensureAudio()
    const ctx = ensureGraph()
    /* a suspended context is the #1 "why is nothing playing" — always resume */
    if (ctx && ctx.state !== 'running') void ctx.resume().catch(() => {})
    setFailed(null)
      watchingRef.current = false
    const p = el.play()
    if (p) {
      void p
        .then(() => {
          setPlaying(true)
          setBusy(false)
        })
        .catch(() => {
          setPlaying(false)
          setFailed('COULD NOT PLAY THIS TRACK')
        })
    }
  }, [ensureAudio, ensureGraph])

  /* ── the context watchdog ──────────────────────────────────────────────
     A SUSPENDED context is silence: the element's own timeline keeps
     moving, the app says "playing", and nothing reaches the speakers. The
     context is built during the boot intro, with no user gesture behind
     it, so it starts suspended — and a resume that happens OUTSIDE a user
     gesture is refused, and a refused resume leaves it suspended for good,
     because nothing tries again.

     That is why the radio needed this years ago and the library's graph
     did not: the radio resumes itself on a pause, a focus change, a
     visibility change. This graph had no such net at all, and the paths
     that start a track without a click — the automatic advance when a
     track ends, a restore — are exactly the ones that leave it stranded.

     So the context is resumed on the next real interaction, whichever it
     is, and retried quietly until it takes. */
  useEffect(() => {
    const wake = () => {
      const ctx = ctxRef.current
      if (!ctx) return
      if (ctx.state === 'running') return
      void ctx
        .resume()
        .then(() => {
          if (ctx.state === 'running') console.info('[audio] the context is running')
        })
        .catch(() => {
          /* refused — most likely still no user gesture behind it */
        })
    }
    const opts = { passive: true } as const
    document.addEventListener('pointerdown', wake, opts)
    document.addEventListener('keydown', wake, opts)
    document.addEventListener('touchstart', wake, opts)
    window.addEventListener('focus', wake)
    const iv = window.setInterval(wake, 1500)
    return () => {
      document.removeEventListener('pointerdown', wake)
      document.removeEventListener('keydown', wake)
      document.removeEventListener('touchstart', wake)
      window.removeEventListener('focus', wake)
      window.clearInterval(iv)
    }
  }, [])

  const loadTrack = useCallback(
    (i: number, autoplay: boolean, startOffset = 0) => {
      const list = tracksRef.current
      if (!list.length) return
      const idx = (i + list.length) % list.length
      const track = list[idx]
      const el = ensureAudio()

      srcRef.current = track.src
      offsetRef.current = startOffset
      pendingSeekRef.current = startOffset
      durationRef.current = 0
      setTrackIndex(idx)
      setDuration(0)
      setFailed(null)
      watchingRef.current = false
      setPlaying(false)
      reportTime(startOffset)

      /* Putting a source into the element and starting it. */
      const apply = (src: string) => {
        srcRef.current = src
        try {
          el.pause()
          el.src = src
          el.load()
        } catch {
          srcRef.current = ''
          setFailed('COULD NOT LOAD THIS TRACK')
          return
        }
        if (autoplay) startPlayback()
      }

      if (track.remote) {
        /* An online track: ask the registry to open it. It finds a source
         * that will deliver, proves there is a byte behind it, and gives
         * back a local URL. Until that arrives there is nothing to play,
         * so the old audio is stopped first rather than left running. */
        try {
          el.pause()
          el.removeAttribute('src')
          el.load()
        } catch {
          /* an element that will not stop is not worth crashing over */
        }
        void sourcesPlay(track.remote.contentId)
          .then((url) => {
            /* the user may have moved on while this was opening */
            if (indexRef.current !== idx) return
            apply(url)
          })
          .catch((e) => {
            if (indexRef.current !== idx) return
            setFailed('COULD NOT OPEN THIS TRACK')
            console.error('[audio] the online source would not open:', e)
          })
        return
      }

      apply(track.src)
    },
    [ensureAudio, reportTime, startPlayback],
  )

  const advance = useCallback(
    (dir: 1 | -1, auto: boolean) => {
      const list = tracksRef.current
      if (!list.length) return
      if (shuffleRef.current && list.length > 1) {
        let pick = indexRef.current
        while (pick === indexRef.current) pick = Math.floor(Math.random() * list.length)
        loadTrack(pick, true)
        return
      }
      let nextIdx = indexRef.current + dir
      if (nextIdx >= list.length) {
        if (auto && repeatRef.current === 'off') {
          audioRef.current?.pause()
          offsetRef.current = 0
          reportTime(0)
          setPlaying(false)
          setTrackIndex(0)
          return
        }
        nextIdx = 0
      }
      if (nextIdx < 0) nextIdx = list.length - 1
      const el = audioRef.current
      const wasPlaying = !!el && !el.paused
      loadTrack(nextIdx, auto || wasPlaying)
    },
    [loadTrack, reportTime],
  )

  useEffect(() => {
    advanceRef.current = advance
  }, [advance])

  const setAutoAdvance = useCallback((v: boolean) => {
    autoAdvanceRef.current = v
  }, [])

  const setRepeatMode = useCallback((mode: RepeatMode) => {
    setRepeat(mode)
  }, [])

  const subscribeTrackEnd = useCallback((cb: () => void) => {
    trackEndSubsRef.current.add(cb)
    return () => {
      trackEndSubsRef.current.delete(cb)
    }
  }, [])

  const cycleRepeat = useCallback(
    () => setRepeat((r) => (r === 'off' ? 'all' : r === 'all' ? 'one' : 'off')),
    [],
  )

  const toggle = useCallback(() => {
    const list = tracksRef.current
    if (!list.length) return
    const el = ensureAudio()
    if (!el.paused) {
      el.pause()
      setPlaying(false)
      reportTime(getCurrentTime())
      return
    }
    if (!el.src) {
      loadTrack(indexRef.current, true, offsetRef.current)
      return
    }
    startPlayback()
  }, [ensureAudio, getCurrentTime, loadTrack, reportTime, startPlayback])

  const next = useCallback(() => advance(1, false), [advance])
  const prev = useCallback(() => advance(-1, false), [advance])
  const select = useCallback((i: number, autoplay = true) => loadTrack(i, autoplay), [loadTrack])
  const setIndexSilent = useCallback((i: number) => setTrackIndex(i), [])

  const stop = useCallback(() => {
    const el = audioRef.current
    srcRef.current = ''
    offsetRef.current = 0
    pendingSeekRef.current = 0
    durationRef.current = 0
    if (el) {
      el.pause()
      try {
        el.removeAttribute('src')
        el.load()
      } catch {
        /* nothing loaded — already stopped */
      }
    }
    setPlaying(false)
    setBusy(false)
    reportTime(0)
    setDuration(0)
    setTrackIndex(0)
  }, [reportTime])

  /* Seek is native: the element needs no flush, no re-open and no decode
     forward. A seek that lands before metadata is remembered and applied by
     the loadedmetadata handler. */
  const seekTo = useCallback(
    (t: number) => {
      const raw = Number(t)
      if (!Number.isFinite(raw)) return
      const dur = durationRef.current
      const target = Math.max(0, dur > 0 ? Math.min(raw, Math.max(0, dur - 0.05)) : raw)
      offsetRef.current = target
      const el = audioRef.current
      if (el && el.readyState >= 1) {
        try {
          el.currentTime = target
        } catch {
          pendingSeekRef.current = target
        }
      } else {
        pendingSeekRef.current = target
      }
      reportTime(target)
    },
    [reportTime],
  )

  const seekBy = useCallback(
    (d: number) => {
      seekTo(getCurrentTime() + d)
    },
    [seekTo, getCurrentTime],
  )

  const setVolume = useCallback((v: number) => {
    setVolumeState(v)
    volumeRef.current = v
    try {
      localStorage.setItem('md-volume', String(v))
    } catch {
      /* private mode / quota — volume still applies this session */
    }
    if (capturedRef.current) {
      /* the element is captured: the graph's gain is the volume */
      if (gainRef.current) gainRef.current.gain.value = v
      return
    }
    /* the element is playing on its own: its own volume is the volume */
    const el = audioRef.current
    if (el) {
      try {
        el.volume = v
      } catch {
        /* the element may not accept it yet */
      }
    }
  }, [])

  const getAnalyser = useCallback(() => analyserRef.current, [])

  /* Another element's sound can be watched by the same analyser — the radio
     plays on an element of its own, and without this the deck's spectrum sees
     silence the whole time a station is on.

     The capture stream, and ONLY the capture stream: that is this repo's rule
     for watching something without holding its sound hostage (see ensureGraph).
     A station keeps playing on its own no matter what this graph does, so a
     stream that will not read is simply left alone rather than captured for
     real. One attachment per element, because two MediaStreamSource nodes on
     the same stream would double every reading. */
  const attachedRef = useRef<WeakSet<HTMLMediaElement> | null>(null)
  const attachSource = useCallback(
    (source: HTMLMediaElement | null) => {
      if (!source) return
      const seen = (attachedRef.current ??= new WeakSet())
      if (seen.has(source)) return
      const ctx = ensureGraph()
      const gain = gainRef.current
      if (!ctx || !gain) return
      const capture = source as unknown as {
        captureStream?: () => MediaStream
        webkitCaptureStream?: () => MediaStream
      }
      const attempt = () => {
        if (seen.has(source)) {
          source.removeEventListener('loadedmetadata', attempt)
          source.removeEventListener('playing', attempt)
          return
        }
        try {
          const stream = capture.captureStream?.() ?? capture.webkitCaptureStream?.()
          /* an element with nothing playing yet hands back a stream with no
             tracks, and a source node built from one is refused — retry on
             loadedmetadata / playing rather than give up on the station */
          if (!stream || stream.getTracks().length === 0) return
          ctx.createMediaStreamSource(stream).connect(gain)
          seen.add(source)
          source.removeEventListener('loadedmetadata', attempt)
          source.removeEventListener('playing', attempt)
        } catch (e) {
          console.error('[audio] a source stream could not be read', e)
        }
      }
      attempt()
      source.addEventListener('loadedmetadata', attempt)
      source.addEventListener('playing', attempt)
    },
    [ensureGraph],
  )

  /* session restore: the library survives in IndexedDB, so the last selected
     track and timeline come back too — always PAUSED (this hook never
     autoplays; loadTrack is called with autoplay=false below). */
  const restoredRef = useRef(false)
  useEffect(() => {
    if (restoredRef.current || !tracks.length) return
    restoredRef.current = true
    const rawIdx = Number(localStorage.getItem('md-track'))
    const idx = Number.isFinite(rawIdx) ? Math.min(Math.max(0, Math.trunc(rawIdx)), tracks.length - 1) : 0
    const rawPos = Number(localStorage.getItem('md-pos'))
    const want = Number.isFinite(rawPos) && rawPos > 2 ? rawPos : 0
    /* deferred: loadTrack sets the index/position itself and must not be a
       synchronous setState inside this effect */
    const timer = window.setTimeout(() => loadTrack(idx, false, want), 250)
    return () => window.clearTimeout(timer)
  }, [tracks, loadTrack])

  /* persist selection + timeline while running, on pause, and on the way out
     (pagehide + visibilitychange — a Tauri close can miss one) */
  useEffect(() => {
    const save = () => {
      if (!srcRef.current) return
      try {
        localStorage.setItem('md-track', String(indexRef.current))
        localStorage.setItem('md-pos', String(Math.max(0, Math.round(timeRef.current))))
      } catch {
        /* private mode / quota — the session just won't resume */
      }
    }
    const iv = window.setInterval(save, 3000)
    const onHide = () => {
      if (document.visibilityState === 'hidden') save()
    }
    document.addEventListener('visibilitychange', onHide)
    window.addEventListener('pagehide', save)
    return () => {
      window.clearInterval(iv)
      document.removeEventListener('visibilitychange', onHide)
      window.removeEventListener('pagehide', save)
      save()
    }
  }, [])

  /* the playhead only needs reporting while audio actually moves — the DOM
     element's own `timeupdate` is 4Hz, far too coarse for the lyrics clock */
  useEffect(() => {
    if (!playing) return
    const iv = window.setInterval(() => reportTime(getCurrentTime()), 100)
    return () => window.clearInterval(iv)
  }, [playing, reportTime, getCurrentTime])

  /* OS now-playing: media keys, lock screen / OS media flyout */
  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    const t = tracks[indexRef.current]
    if (t) {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: t.title,
        artist: t.artist,
        album: 'MUN15H · MD WALKMAN',
        artwork: t.cover ? [{ src: t.cover, sizes: '512x512', type: 'image/jpeg' }] : [],
      })
    }
    /* truthful state for the flyout — a killed session must not keep
       presenting itself as playing after the app restarts */
    navigator.mediaSession.playbackState = playing ? 'playing' : 'paused'
  }, [trackIndex, tracks, playing])

  useEffect(() => {
    if (!('mediaSession' in navigator)) return
    const ms = navigator.mediaSession
    ms.setActionHandler('play', () => startPlayback())
    ms.setActionHandler('pause', () => {
      audioRef.current?.pause()
      setPlaying(false)
    })
    ms.setActionHandler('previoustrack', () => advance(-1, false))
    ms.setActionHandler('nexttrack', () => advance(1, false))
    return () => {
      try {
        ms.setActionHandler('play', null)
        ms.setActionHandler('pause', null)
        ms.setActionHandler('previoustrack', null)
        ms.setActionHandler('nexttrack', null)
      } catch {
        /* a webview that never registered them rejects the clear — harmless */
      }
    }
  }, [advance, startPlayback])

  return {
    trackIndex,
    playing,
    duration,
    subscribeTime,
    volume,
    shuffle,
    repeat,
    toggle,
    next,
    prev,
    select,
    setIndexSilent,
    stop,
    cycleRepeat,
    setShuffle,
    seekTo,
    seekBy,
    setVolume,
    getAnalyser,
    attachSource,
    prewarm,
    getCurrentTime,
    busy,
    failed,
    setAutoAdvance,
    setRepeatMode,
    subscribeTrackEnd,
  }
}

export type SubscribeTime = (cb: (t: number) => void) => () => void
