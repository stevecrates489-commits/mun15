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
  /* the radio's own analyser — fed from the station's capture stream alone,
     so the backdrop can listen to the station by itself */
  const radioAnalyserRef = useRef<AnalyserNode | null>(null)
  /* the tap that FEEDS that analyser — see tuneRadioViz below for why it is
     a private second element and not the element the user hears */
  const radioTapRef = useRef<{ el: HTMLAudioElement; node: MediaElementAudioSourceNode; url: string } | null>(null)
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

  /* ── player settings: crossfade + volume normalisation ─────────────────
     Both are listening preferences, persisted like the rest, and both are
     read by the audio tick through refs — a slider move must never rebuild
     the element that is playing. */
  /* the normalisation multiplier — 1 is untouched, higher lifts quiet tracks.
     It re-learns itself per track (a fresh track starts at 1), because the
     whole point is a consistent loudness ACROSS tracks. */
  const normGainRef = useRef(1)
  const normBufRef = useRef(new Float32Array(512))
  /* the crossfade's second element, and the guard that keeps a fade that has
     already begun from being triggered again every 100ms */
  const xfRef = useRef<HTMLAudioElement | null>(null)
  const xfActiveRef = useRef(false)
  const xfGenRef = useRef(0)
  const xfRampRef = useRef(0)
  /* the STANDBY: while a track plays, the track the advance would pick next
     is preloaded onto this same second element — metadata and media already
     decoded — so a switch is an element swap, not a decode wait. The armed
     record says which index and source it holds. This is the browser
     equivalent of an output buffer that is always full: the device never
     waits for the decoder (see the Winamp OUT.H contract). */
  const xfArmedRef = useRef<{ idx: number; src: string } | null>(null)
  const promoteStandbyRef = useRef<() => boolean>(() => false)
  const [crossfade, setCrossfadeState] = useState(() => localStorage.getItem('md-crossfade') === '1')
  const [crossfadeSec, setCrossfadeSecState] = useState(() => {
    const n = Number(localStorage.getItem('md-crossfade-sec'))
    return ([0, 3, 5, 8] as readonly number[]).includes(n) ? n : 5
  })
  const [normalize, setNormalizeState] = useState(() => localStorage.getItem('md-normalize') === '1')
  const crossfadeRef = useRef(crossfade)
  const crossfadeSecRef = useRef(crossfadeSec)
  const normalizeRef = useRef(normalize)
  useEffect(() => {
    crossfadeRef.current = crossfade
  }, [crossfade])
  useEffect(() => {
    crossfadeSecRef.current = crossfadeSec
  }, [crossfadeSec])
  useEffect(() => {
    normalizeRef.current = normalize
  }, [normalize])
  const setCrossfade = useCallback((on: boolean) => {
    setCrossfadeState(on)
    try {
      localStorage.setItem('md-crossfade', on ? '1' : '0')
    } catch {
      /* private mode — the choice lasts for this session */
    }
  }, [])
  const setCrossfadeSec = useCallback((sec: number) => {
    setCrossfadeSecState(sec)
    try {
      localStorage.setItem('md-crossfade-sec', String(sec))
    } catch {
      /* private mode — the choice lasts for this session */
    }
  }, [])
  const setNormalize = useCallback((on: boolean) => {
    setNormalizeState(on)
    try {
      localStorage.setItem('md-normalize', on ? '1' : '0')
    } catch {
      /* private mode — the choice lasts for this session */
    }
    if (!on) normGainRef.current = 1
  }, [])

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

  /* one element + its listeners for the whole session. The listeners are
     attachable to ANY element: the crossfade promotes its second element to
     the deck when a fade completes, and everything here must come with it. */
  const detachRef = useRef<(() => void) | null>(null)
  const attachElementListeners = useCallback(
    (el: HTMLAudioElement) => {
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
        if (!autoAdvanceRef.current) {
          setPlaying(false)
          return
        }
        /* the standby is already buffered — the swap is instant, no decode
           gap; anything it refused falls through to the plain advance */
        if (promoteStandbyRef.current()) return
        advanceRef.current(1, true)
      }

      el.addEventListener('loadedmetadata', onMeta)
      el.addEventListener('durationchange', onMeta)
      el.addEventListener('playing', onPlaying)
      el.addEventListener('pause', onPause)
      el.addEventListener('waiting', onWaiting)
      const onCanPlay = () => setBusy(false)
      el.addEventListener('canplay', onCanPlay)
      el.addEventListener('error', onError)
      el.addEventListener('ended', onEnded)
      return () => {
        el.removeEventListener('loadedmetadata', onMeta)
        el.removeEventListener('durationchange', onMeta)
        el.removeEventListener('playing', onPlaying)
        el.removeEventListener('pause', onPause)
        el.removeEventListener('waiting', onWaiting)
        el.removeEventListener('canplay', onCanPlay)
        el.removeEventListener('error', onError)
        el.removeEventListener('ended', onEnded)
      }
    },
    [reportTime],
  )

  const ensureAudio = useCallback(() => {
    if (audioRef.current) return audioRef.current
    const el = new Audio()
    el.preload = 'auto'
    detachRef.current = attachElementListeners(el)
    audioRef.current = el
    return el
  }, [attachElementListeners])

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
         only there to carry the analysis. The normalisation multiplier
         rides along: it is part of "how loud the user asked for". */
      el.volume = Math.min(1, volumeRef.current * normGainRef.current)
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
      /* whatever the standby held belongs to the track we just left — a new
         pick re-arms it on the next tick */
      xfArmedRef.current = null
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
      /* a forward move rides the standby when it holds the picked track —
         the swap is instant (this covers NEXT in both shuffle and ordered
         modes, because the preload pre-decided the same pick). NEXT while
         PAUSED keeps its old meaning: load, stay paused. */
      if (dir === 1 && (auto || !audioRef.current?.paused) && xfArmedRef.current && promoteStandbyRef.current()) return
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
        el.volume = Math.min(1, v * normGainRef.current)
      } catch {
        /* the element may not accept it yet */
      }
    }
  }, [])

  const getAnalyser = useCallback(() => analyserRef.current, [])

  /* the radio's own analyser — null until a station's capture stream has
     been attached once. The visualiser's frame source re-asks every frame,
     so one that appears later is picked up without a rebuild. */
  const getRadioAnalyser = useCallback(() => radioAnalyserRef.current, [])

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
          const node = ctx.createMediaStreamSource(stream)
          node.connect(gain)
          /* the radio's own analyser, built on the first attach: this stream
             and nothing else feeds it, so the visualiser can listen to the
             station alone. Pulled through a gain of nothing, the same way
             the deck's is — an unpulled analyser reads silence. */
          if (!radioAnalyserRef.current) {
            const radio = ctx.createAnalyser()
            radio.fftSize = 512
            radio.smoothingTimeConstant = 0.55
            const mute = ctx.createGain()
            mute.gain.value = 0
            radio.connect(mute)
            mute.connect(ctx.destination)
            radioAnalyserRef.current = radio
          }
          node.connect(radioAnalyserRef.current)
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

  /* ── the radio visualiser's ear ──────────────────────────────────────────
     The analyser the visuals read when "VISUAL" is on in the radio panel.
     Fed by a private second element, not the element the user hears — and
     that is not a nicety, it is the whole fix: a media element whose stream
     was loaded cross-origin WITHOUT CORS produces SILENCE when it is routed
     into the Web Audio graph (the same lesson the song-end detector paid
     for — see lib/radioLevel). The audible element's capture runs into the
     deck gain as before (harmless), but every analyser reading off it is
     zeros, which is exactly the "the visualiser follows tracks and ignores
     the radio" report. The tap loads the SAME resolved stream URL with
     `crossorigin` set and only it reaches the analyser. A station that
     refuses CORS kills only the tap: the analyser is nulled, and the
     visualiser's deck fallback takes over rather than reading silence. */
  const tuneRadioViz = useCallback(
    (url: string | null) => {
      const tap = radioTapRef.current
      if (tap && url && tap.url === url) return
      if (tap) {
        try {
          tap.el.pause()
          tap.el.removeAttribute('src')
          tap.el.load()
        } catch {
          /* nothing was loaded */
        }
        try {
          tap.node.disconnect()
        } catch {
          /* the node was never connected */
        }
        radioTapRef.current = null
        radioAnalyserRef.current = null
      }
      if (!url) return
      const ctx = ensureGraph()
      if (!ctx) return
      try {
        if (!radioAnalyserRef.current) {
          const radio = ctx.createAnalyser()
          radio.fftSize = 512
          radio.smoothingTimeConstant = 0.55
          const mute = ctx.createGain()
          mute.gain.value = 0
          radio.connect(mute)
          mute.connect(ctx.destination)
          radioAnalyserRef.current = radio
        }
        const el = new Audio()
        el.crossOrigin = 'anonymous'
        el.preload = 'auto'
        el.src = url
        const node = ctx.createMediaElementSource(el)
        node.connect(radioAnalyserRef.current)
        radioTapRef.current = { el, node, url }
        /* autoplay may refuse the first attempt — retry whenever the stream
           is actually ready, the way attachSource does */
        const kick = () => void el.play().catch(() => {})
        el.addEventListener('canplay', kick, { once: true })
        void el.play().catch(() => {})
        /* the station refused CORS: only the tap dies, playback is untouched.
           Nulling the analyser hands the visualiser to its deck fallback. */
        el.addEventListener(
          'error',
          () => {
            if (radioTapRef.current?.el !== el) return
            radioTapRef.current = null
            radioAnalyserRef.current = null
          },
          { once: true },
        )
      } catch {
        radioTapRef.current = null
        radioAnalyserRef.current = null
      }
    },
    [ensureGraph],
  )

  /* ── the audio tick ─────────────────────────────────────────────────────
     Runs on the same 100ms heartbeat that reports the playhead. Two jobs:
     volume normalisation (a slow AGC against the deck's own analyser) and
     the crossfade trigger, which starts a fade when the playing track is
     about to end. Both are element-volume arithmetic — the element is never
     routed through the graph, so this is the only sane lever. */
  const tickAudio = useCallback(() => {
    const el = audioRef.current
    if (!el || el.paused) return

    if (!xfActiveRef.current) {
      if (normalizeRef.current) {
        const an = analyserRef.current
        if (an && an.context.state === 'running') {
          const buf = normBufRef.current
          an.getFloatTimeDomainData(buf)
          let sum = 0
          for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
          const rms = Math.sqrt(sum / buf.length)
          /* the capture stream is watched pre-volume, but dividing by the
             element's volume keeps the measurement honest either way */
          const base = rms / Math.max(0.05, el.volume || volumeRef.current)
          const inst = Math.min(2.4, Math.max(0.35, 0.14 / Math.max(0.012, base)))
          /* slow AGC: a couple of seconds to settle, no pumping on transients */
          normGainRef.current += (inst - normGainRef.current) * 0.05
        }
      } else {
        normGainRef.current += (1 - normGainRef.current) * 0.15
      }
      el.volume = Math.min(1, volumeRef.current * normGainRef.current)

      /* the crossfade trigger: near the end of a local track, start blending
         into the next one. Remote sources open through the registry and are
         left to the natural end. */
      if (
        crossfadeRef.current &&
        crossfadeSecRef.current >= 1 &&
        autoAdvanceRef.current &&
        repeatRef.current !== 'one' &&
        durationRef.current > 0
      ) {
        const remain = durationRef.current - el.currentTime
        if (remain > 0 && remain <= crossfadeSecRef.current) {
          void beginXfade()
          return
        }
      }

      /* the standby preload: with the fade window (or the whole track) still
         ahead, buffer the next track on the parked element — a later switch
         is then an element swap, not a decode wait */
      if (autoAdvanceRef.current && repeatRef.current !== 'one' && durationRef.current > 0) {
        const remain = durationRef.current - el.currentTime
        const xfWindow = crossfadeRef.current ? crossfadeSecRef.current : 0
        if (remain > Math.max(0.4, xfWindow) && !xfActiveRef.current) schedulePreload()
      }
    }
  }, [])

  /* ── the element handover ───────────────────────────────────────────────
     Shared by the crossfade and the standby swap: the second element becomes
     the deck (listeners, capture, timeline, index), the old one is parked
     and becomes the next handover's pool. */
  const takeoverFrom = useCallback(
    (xf: HTMLAudioElement, fromEl: HTMLAudioElement, nextIdx: number, nextSrc: string) => {
      detachRef.current?.()
      fromEl.pause()
      try {
        fromEl.removeAttribute('src')
        fromEl.load()
      } catch {
        /* nothing loaded */
      }
      detachRef.current = attachElementListeners(xf)
      xfRef.current = fromEl
      audioRef.current = xf
      srcRef.current = nextSrc
      offsetRef.current = 0
      pendingSeekRef.current = 0
      durationRef.current = Number.isFinite(xf.duration) ? xf.duration : 0
      setDuration(durationRef.current)
      setTrackIndex(nextIdx)
      watchingRef.current = false
      normGainRef.current = 1
      xfArmedRef.current = null
      /* any fade that was ramping against the old pair must stand down —
         the deck it was fading is gone */
      xfGenRef.current++
    },
    [attachElementListeners],
  )

  /* ── the crossfade ──────────────────────────────────────────────────────
     The next track is played on a SECOND element, rising from silence while
     the current one falls — a true overlap. When the fade is done the
     elements trade places: the second becomes the deck (its listeners, its
     capture, its state), the old one is parked and reused as the next fade's
     pool. A user action (pick, skip, pause) aborts the ramp mid-flight and
     everything is put back the way it was. */
  const beginXfade = useCallback(async () => {
    const list = tracksRef.current
    if (!list.length) return
    /* the track `advance` would pick — the STANDBY's pick when one is armed
       (it pre-decided shuffle, so the fade blends into exactly the track
       that is already buffered), or a fresh pick of the same shape */
    let nextIdx = xfArmedRef.current?.idx ?? -1
    if (nextIdx < 0 || !list[nextIdx]) {
      if (shuffleRef.current && list.length > 1) {
        nextIdx = indexRef.current
        while (nextIdx === indexRef.current) nextIdx = Math.floor(Math.random() * list.length)
      } else {
        nextIdx = indexRef.current + 1
        if (nextIdx >= list.length) {
          if (repeatRef.current === 'off') return
          nextIdx = 0
        }
      }
    }
    const next = list[nextIdx]
    if (next.remote) return
    const fromEl = audioRef.current
    if (!fromEl || fromEl.paused) return
    const fromSrc = srcRef.current
    const gen = ++xfGenRef.current
    xfActiveRef.current = true

    const xf = xfRef.current ?? new Audio()
    xf.preload = 'auto'
    xfRef.current = xf
    const baseFrom = fromEl.volume
    const baseTo = Math.min(1, volumeRef.current * normGainRef.current)
    xf.volume = 0
    try {
      /* the standby may already hold this exact track, buffered — re-setting
         the source would throw the head start away */
      if (xf.getAttribute('src') !== next.src) {
        xf.src = next.src
        xf.load()
      }
      await xf.play()
    } catch {
      /* the shadow element was refused — let the track end naturally */
      xfActiveRef.current = false
      return
    }

    const D = Math.min(Math.max(1, crossfadeSecRef.current), 10) * 1000
    await new Promise<void>((res) => {
      const t0 = performance.now()
      const step = () => {
        /* a user action — pick, skip, pause — aborts the ramp mid-flight */
        const aborted = xfGenRef.current !== gen || fromEl.paused || srcRef.current !== fromSrc
        const k = Math.min(1, (performance.now() - t0) / D)
        if (!aborted && k < 1) {
          const e = k * k * (3 - 2 * k)
          fromEl.volume = Math.max(0, baseFrom * (1 - e))
          xf.volume = baseTo * e
          xfRampRef.current = requestAnimationFrame(step)
          return
        }
        if (!aborted) {
          fromEl.volume = 0
          xf.volume = baseTo
        }
        xfRampRef.current = 0
        res()
      }
      xfRampRef.current = requestAnimationFrame(step)
    })
    xfRampRef.current = 0

    if (xfGenRef.current !== gen || fromEl.paused) {
      /* aborted mid-fade: put the levels back, stop the shadow element —
         unless a handover already promoted it to the deck, in which case it
         is playing the library and must not be touched */
      if (xfRef.current === xf) {
        xf.pause()
        xf.removeAttribute('src')
        try {
          xf.load()
        } catch {
          /* nothing loaded */
        }
        fromEl.volume = baseFrom
      }
      xfActiveRef.current = false
      return
    }

    /* ── the takeover ── */
    takeoverFrom(xf, fromEl, nextIdx, next.src)
    setPlaying(true)
    setBusy(false)
    setFailed(null)
    xf.volume = baseTo
    reportTime(getCurrentTime())
    /* the analyser watches the OLD element's capture stream — introduce it
       to the new one, or every spectrum consumer goes blind */
    watchDeckRef.current()
    xfActiveRef.current = false
  }, [attachElementListeners, getCurrentTime, reportTime, takeoverFrom])

  /* ── the standby preload ────────────────────────────────────────────────
     While a track plays, the track the advance WOULD pick is buffered on the
     parked element (metadata + media, nothing audible). A switch then costs
     an element swap — the browser twin of Winamp's always-full output
     buffer, where the device never waits for the decoder. */
  const schedulePreload = useCallback(() => {
    const xf = xfRef.current
    const list = tracksRef.current
    if (!xf || !list.length) return
    /* a still-valid arming is left alone; anything else re-arms */
    const armed = xfArmedRef.current
    if (armed) {
      if (list[armed.idx] && list[armed.idx].src === armed.src && xf.getAttribute('src') === armed.src) return
      xfArmedRef.current = null
    }
    let idx: number
    if (shuffleRef.current && list.length > 1) {
      idx = indexRef.current
      while (idx === indexRef.current) idx = Math.floor(Math.random() * list.length)
    } else {
      idx = indexRef.current + 1
      if (idx >= list.length) {
        if (repeatRef.current === 'off') return
        idx = 0
      }
    }
    const next = list[idx]
    if (next.remote) return /* registry sources open their own way */
    if (xf.getAttribute('src') !== next.src) {
      xf.preload = 'auto'
      xf.src = next.src
      try {
        xf.load()
      } catch {
        /* nothing to preload from this source — the natural end still works */
        return
      }
    }
    xfArmedRef.current = { idx, src: next.src }
  }, [])

  /* ── the standby swap ───────────────────────────────────────────────────
     The buffered track takes over in one move: no source set, no load, no
     metadata wait — the gap between tracks drops to the swap itself. */
  const promoteStandby = useCallback((): boolean => {
    const armed = xfArmedRef.current
    const xf = xfRef.current
    const list = tracksRef.current
    if (!armed || !xf || !list[armed.idx]) return false
    if (xf.getAttribute('src') !== armed.src || xf.readyState < 2) return false
    const fromEl = audioRef.current
    if (!fromEl) return false
    const baseTo = Math.min(1, volumeRef.current * normGainRef.current)
    takeoverFrom(xf, fromEl, armed.idx, armed.src)
    xf.volume = baseTo
    xfActiveRef.current = false
    setPlaying(false) /* the element's own 'playing' event flips it for real */
    setBusy(false)
    setFailed(null)
    reportTime(0)
    void xf.play().catch(() => setPlaying(false))
    /* spectrum consumers follow the deck element */
    watchDeckRef.current()
    return true
  }, [reportTime, takeoverFrom])
  useEffect(() => {
    promoteStandbyRef.current = promoteStandby
  }, [promoteStandby])
  const watchDeckRef = useRef<() => void>(() => {})
  useEffect(() => {
    watchDeckRef.current = watchDeck
  }, [watchDeck])

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
     element's own `timeupdate` is 4Hz, far too coarse for the lyrics clock.
     The same tick drives the player settings: normalisation and the
     crossfade trigger are element-volume arithmetic, not graph work. */
  useEffect(() => {
    if (!playing) return
    const iv = window.setInterval(() => {
      reportTime(getCurrentTime())
      tickAudio()
    }, 100)
    return () => window.clearInterval(iv)
  }, [playing, reportTime, getCurrentTime, tickAudio])

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
    /* scrubbing from the OS overlay / hardware keys lands here, in seconds */
    ms.setActionHandler('seekto', (d) => {
      if (d.seekTime != null && Number.isFinite(d.seekTime)) seekTo(d.seekTime)
    })
    ms.setActionHandler('seekbackward', (d) => seekBy(-(d.seekOffset ?? 10)))
    ms.setActionHandler('seekforward', (d) => seekBy(d.seekOffset ?? 10))
    return () => {
      try {
        ms.setActionHandler('play', null)
        ms.setActionHandler('pause', null)
        ms.setActionHandler('previoustrack', null)
        ms.setActionHandler('nexttrack', null)
        ms.setActionHandler('seekto', null)
        ms.setActionHandler('seekbackward', null)
        ms.setActionHandler('seekforward', null)
      } catch {
        /* a webview that never registered them rejects the clear — harmless */
      }
    }
  }, [advance, startPlayback, seekTo, seekBy])

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
    getRadioAnalyser,
    attachSource,
    tuneRadioViz,
    prewarm,
    getCurrentTime,
    busy,
    failed,
    setAutoAdvance,
    setRepeatMode,
    subscribeTrackEnd,
    /* player settings */
    crossfade,
    crossfadeSec,
    setCrossfade,
    setCrossfadeSec,
    normalize,
    setNormalize,
  }
}

export type SubscribeTime = (cb: (t: number) => void) => () => void
