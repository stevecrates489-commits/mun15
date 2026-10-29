import { useCallback, useEffect, useRef, useState } from 'react'
import { Channel } from '@tauri-apps/api/core'
import {
  encodePcm,
  hasNativeEngine,
  visualizerListPresets,
  visualizerLoadPreset,
  visualizerLog,
  visualizerLogPath,
  visualizerPresetStep,
  visualizerSetMode,
  visualizerSetSize,
  visualizerSetTextureDir,
  visualizerPushPcm,
  visualizerStart,
  visualizerStatus,
  visualizerStop,
  type VisualizerCompat,
  type VisualizerFrame,
  type VisualizerMode,
  type VisualizerPreset,
  type VisualizerStatus,
} from './bridge'
import { LocalPcmTap, RadioPcmTap } from './pcm'

const MODE_KEY = 'md-visualizer-mode'
const DIR_KEY = 'md-visualizer-dir'
const TEX_KEY = 'md-visualizer-textures'
/* which set of semantics the engine runs under */
const COMPAT_KEY = 'md-visualizer-compat'

/* the floating window renders at the size the classic renderer used, so the
   presets look the way they were designed to look */
export const WINDOW_SIZE = { width: 512, height: 384 }
/* the app's own backdrop is a background, not a feature: a quarter of the
   size and a third of the rate is plenty, and it keeps the frame traffic
   small — every frame that comes back is copied off the GPU and travels
   through the app as text */
export const WALLPAPER_SIZE = { width: 256, height: 192 }

export interface VisualizerOptions {
  /** the player's master analyser — the local songs' samples */
  getAnalyser: () => AnalyserNode | null
  /** the stream that is playing, for the radio's samples */
  radioUrl: string | null
  radioPlaying: boolean
  /** a frame, in wallpaper mode */
  onFrame?: (f: VisualizerFrame) => void
}

/**
 * The visualiser.
 *
 * The engine is native and does the drawing; this owns the conversation with
 * it and, more importantly, the AUDIO: which source is playing, and how its
 * samples get across.
 *
 * The source is picked per tick, not per start. A radio station that cannot
 * be read (no CORS) must not leave the local songs silent, and a radio
 * station that CAN be read must take over the moment it starts — so the
 * tap follows whatever is actually playing.
 */
export function useVisualizer({ getAnalyser, radioUrl, radioPlaying, onFrame }: VisualizerOptions) {
  /* The visualiser is NEVER started on launch: a window that appears by
     itself, over the app, before anybody asked for it, is not what anybody
     wants. The mode always starts off. */
  const [mode, setModeState] = useState<VisualizerMode>('off')
  const [status, setStatus] = useState<VisualizerStatus | null>(null)
  const [presets, setPresets] = useState<VisualizerPreset[]>([])
  const [presetDir, setPresetDir] = useState(() => localStorage.getItem(DIR_KEY) ?? '')
  const [textureDir, setTextureDir] = useState(() => localStorage.getItem(TEX_KEY) ?? '')
  const [error, setError] = useState<string | null>(null)
  /* which semantics the engine runs under. The engine is built around the
     choice, so changing it starts the engine again — the preset is reloaded
     afterwards by the panel. */
  const [compat, setCompatState] = useState<VisualizerCompat>(() => {
    if (typeof localStorage === 'undefined') return 'auto'
    const v = localStorage.getItem(COMPAT_KEY)
    return v === 'milkdrop2' || v === 'milkdrop3' || v === 'projectm' ? v : 'auto'
  })
  /** the radio's samples cannot be read on every station — this says so */
  const [radioBlocked, setRadioBlocked] = useState(false)
  /* the engine has actually sent a picture. The backdrop is not put on
     screen until then: a canvas with nothing in it is a black rectangle
     over the whole app. */
  const [frameSeen, setFrameSeen] = useState(false)
  const frameSeenRef = useRef(false)

  const localTapRef = useRef<LocalPcmTap | null>(null)
  const radioTapRef = useRef<RadioPcmTap | null>(null)
  const modeRef = useRef<VisualizerMode>(mode)
  /* the ref follows the mode, but it is written in an effect: writing a ref
     during a render is a side effect, and the compiler's rules are right */
  useEffect(() => {
    modeRef.current = mode
  }, [mode])
  const onFrameRef = useRef(onFrame)
  useEffect(() => {
    onFrameRef.current = onFrame
  }, [onFrame])

  /* the first picture is worth a re-render: the backdrop waits for it */
  const handleFrame = useCallback((f: VisualizerFrame) => {
    if (!frameSeenRef.current) {
      frameSeenRef.current = true
      setFrameSeen(true)
    }
    onFrameRef.current?.(f)
  }, [])

  const native = hasNativeEngine()

  /* the state of the player's own audio graph — a suspended context is
     silence, and it is worth saying so on screen rather than leaving the
     listener to wonder */
  const [audioState, setAudioState] = useState<string | null>(null)
  useEffect(() => {
    if (!native) return
    const read = () => {
      const a = getAnalyser()
      const ctx = a?.context
      setAudioState(ctx ? ctx.state : 'no graph')
    }
    read()
    const iv = window.setInterval(read, 1000)
    return () => window.clearInterval(iv)
  }, [native, getAnalyser])

  /* the interface's half of the log: what it is doing about the audio, and
     what the engine is being asked to do. One file, both halves. */
  const [logPath, setLogPath] = useState<string | null>(null)
  useEffect(() => {
    if (!native) return
    void visualizerLogPath()
      .then((p) => {
        setLogPath(p)
        return visualizerLog(`the log is at ${p}`)
      })
      .catch(() => {})
  }, [native])

  useEffect(() => {
    if (!native) return
    void visualizerLog(`the audio graph is ${audioState ?? 'unknown'}`)
  }, [native, audioState])

  /* ── the engine's lifecycle ────────────────────────────────────────── */

  const stop = useCallback(async () => {
    if (!native) return
    try {
      await visualizerStop()
    } catch {
      /* the engine may already be gone */
    }
    setStatus(null)
  }, [native])

  const start = useCallback(
    async (next: Exclude<VisualizerMode, 'off'>) => {
      if (!native) {
        setError('THE VISUALISER NEEDS THE DESKTOP APP')
        return
      }
      setError(null)
      try {
        const size = next === 'wallpaper' ? WALLPAPER_SIZE : WINDOW_SIZE
        /* the engine has to analyse at the rate the audio really runs at —
           a webview usually runs at 48kHz, and the engine's own default is
           44.1kHz, so it has to be told */
        const rate = getAnalyser()?.context.sampleRate ?? 48000
        await visualizerStart(next, size.width, size.height, rate, compat)
        /* the channel is always made: in the window mode the engine never
           writes to it, but the toolkit only reads a bare channel out of a
           request, so it has to be there either way */
        const frames = new Channel<VisualizerFrame>()
        frames.onmessage = handleFrame
        await visualizerSetMode(next, frames)
      } catch (e) {
        setError((e as Error).message ?? 'THE VISUALISER COULD NOT START')
        /* a mode that cannot start is a mode that must not be remembered:
           leaving it on means every launch tries again, and every launch
           looks broken */
        setModeState('off')
        try {
          localStorage.setItem(MODE_KEY, 'off')
        } catch {
          /* private mode */
        }
      }
    },
    [native, getAnalyser, handleFrame, compat],
  )

  const setMode = useCallback(
    (next: VisualizerMode) => {
      if (next === modeRef.current) return
      setModeState(next)
      try {
        localStorage.setItem(MODE_KEY, next)
      } catch {
        /* private mode — the choice lasts for this session */
      }
      if (next === 'off') {
        void stop()
        return
      }
      void start(next)
    },
    [start, stop],
  )

  /* ── the status poll ───────────────────────────────────────────────── */

  useEffect(() => {
    if (!native || mode === 'off') return
    let alive = true
    const read = () => {
      void visualizerStatus()
        .then((s) => {
          if (alive) setStatus(s)
        })
        .catch(() => {})
    }
    read()
    const iv = window.setInterval(read, 1000)
    return () => {
      alive = false
      window.clearInterval(iv)
    }
  }, [native, mode])

  /* ── the preset folder ─────────────────────────────────────────────── */

  const refreshPresets = useCallback(
    async (dir: string) => {
      if (!native || !dir.trim()) {
        setPresets([])
        return
      }
      try {
        const list = await visualizerListPresets(dir.trim())
        setPresets(list)
        setError(null)
      } catch (e) {
        setPresets([])
        setError((e as Error).message ?? 'THE PRESET FOLDER COULD NOT BE READ')
      }
    },
    [native],
  )

  const applyPresetDir = useCallback(
    (dir: string) => {
      setPresetDir(dir)
      try {
        localStorage.setItem(DIR_KEY, dir)
      } catch {
        /* private mode */
      }
      void refreshPresets(dir)
    },
    [refreshPresets],
  )

  const applyTextureDir = useCallback(
    (dir: string) => {
      setTextureDir(dir)
      try {
        localStorage.setItem(TEX_KEY, dir)
      } catch {
        /* private mode */
      }
      if (!native) return
      void visualizerSetTextureDir(dir).catch(() => {})
    },
    [native],
  )

  /* the folder is only worth reading when there is an engine to read it for */
  useEffect(() => {
    if (!native || mode === 'off') return
    if (!presetDir.trim()) return
    /* this reads a folder on disk and puts the answer in state — a
       synchronisation with the outside world, which is what effects are for */
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshPresets(presetDir)
    if (textureDir.trim()) void visualizerSetTextureDir(textureDir).catch(() => {})
  }, [native, mode, presetDir, textureDir, refreshPresets])

  const loadPreset = useCallback(
    (path: string) => {
      if (!native) return
      void visualizerLoadPreset(path).catch((e) =>
        setError((e as Error).message ?? 'THE PRESET COULD NOT BE LOADED'),
      )
    },
    [native],
  )

  const stepPreset = useCallback(
    (delta: number) => {
      if (!native) return
      void visualizerPresetStep(delta).catch(() => {})
    },
    [native],
  )

  /**
   * Change the engine's semantics.
   *
   * The engine is built around the choice, so this makes a new one and
   * reloads the preset that was on screen — otherwise the switch would look
   * like it did nothing until the next preset change.
   *
   * It lives HERE, below `loadPreset`, on purpose: a dependency list is
   * read while the hook is rendering, so everything it names has to exist
   * already — naming something declared further down is a crash, not a
   * warning.
   */
  const setCompat = useCallback(
    (next: VisualizerCompat) => {
      if (next === compat) return
      setCompatState(next)
      try {
        localStorage.setItem(COMPAT_KEY, next)
      } catch {
        /* private mode */
      }
      if (modeRef.current === 'off') return
      void start(modeRef.current as Exclude<VisualizerMode, 'off'>).then(() => {
        /* the new engine starts with nothing loaded */
        const current = status?.preset
        if (!current) return
        const found = presets.find((p) => p.name === current)
        if (found) loadPreset(found.path)
      })
    },
    [compat, start, status, presets, loadPreset],
  )

  const setSize = useCallback(
    (width: number, height: number) => {
      if (!native) return
      void visualizerSetSize(width, height).catch(() => {})
    },
    [native],
  )

  /**
   * The mesh the preset's equations are evaluated over.
   *
   * This is the CPU half of a frame: every vertex is evaluated by the
   * preset's own expressions, every frame. A heavy preset on a fine mesh is
   * CPU-bound however good the graphics card is.
   */
  /* ── the audio ─────────────────────────────────────────────────────── */

  /* the taps are made on first use, so that every effect finds one waiting
     for it — the radio's effect runs before the feed's, and a tap that only
     existed afterwards would never be started */
  const localTap = useCallback(() => {
    if (!localTapRef.current) localTapRef.current = new LocalPcmTap(2)
    return localTapRef.current
  }, [])
  const radioTap = useCallback(() => {
    if (!radioTapRef.current) radioTapRef.current = new RadioPcmTap(2)
    return radioTapRef.current
  }, [])

  /* the radio's samples need a stream of their own, and only stations that
     allow CORS can be read at all */
  useEffect(() => {
    const tap = radioTap()
    if (mode === 'off' || !radioPlaying || !radioUrl) {
      tap.stop()
      /* the station is not being read, so there is nothing to report */
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRadioBlocked(false)
      return
    }
    let alive = true
    void tap.start(radioUrl).then((ok) => {
      if (!alive) return
      setRadioBlocked(!ok)
    })
    return () => {
      alive = false
      /* the old stream must not keep playing behind the new one */
      tap.stop()
    }
  }, [mode, radioPlaying, radioUrl, radioTap])

  useEffect(() => {
    return () => {
      radioTapRef.current?.stop()
    }
  }, [])

  /* the feed: one tick, whichever source is playing */
  useEffect(() => {
    if (!native || mode === 'off') return
    const local = localTap()
    const radio = radioTap()
    let stopped = false

    const tick = () => {
      if (stopped) return
      const useRadio = radioPlaying && !!radioUrl && !radioBlocked
      const chunk = useRadio ? radio.take() : local.take()
      if (!chunk) return
      const packet = encodePcm(chunk.samples, chunk.channels)
      void visualizerPushPcm(packet.samples, packet.channels).catch(() => {
        /* the engine is gone — the next tick will find nothing to talk to */
      })
    }

    /* the local tap follows the player's analyser, which is created during
       boot — so it is attached late, and re-attached when the engine is
       rebuilt underneath it */
    const attachAnalyser = () => {
      const a = getAnalyser()
      if (a) local.attach(a)
    }
    attachAnalyser()
    const attachIv = window.setInterval(attachAnalyser, 1000)
    const iv = window.setInterval(tick, 16)
    return () => {
      stopped = true
      window.clearInterval(iv)
      window.clearInterval(attachIv)
    }
  }, [native, mode, radioPlaying, radioUrl, radioBlocked, getAnalyser, localTap, radioTap])

  return {
    mode,
    setMode,
    status,
    error,
    presets,
    presetDir,
    applyPresetDir,
    textureDir,
    applyTextureDir,
    loadPreset,
    stepPreset,
    setSize,
    refreshPresets,
    radioBlocked,
    audioState,
    logPath,
    compat,
    setCompat,
    frameSeen,
    native,
    stop,
  }
}
