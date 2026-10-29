/**
 * Butterchurn — MilkDrop, running in WebGL, on the deck's own audio.
 *
 * This one is different from every other style here in one way that matters:
 * it does not paint from the AudioFrame. Butterchurn reads a live AudioNode
 * itself, so the module taps the deck's analyser through a private gain (its
 * output is muted into the destination, exactly like the app's other taps)
 * and lets Butterchurn drive its own mixer. The shared SENSITIVITY slider is
 * wired to that tap's gain, so it is the one of the four shared settings that
 * does anything here; the visual's own card carries the preset controls.
 *
 * Both packages are loaded on demand: Butterchurn plus its preset packs are
 * far heavier than every other visual combined, and nobody should pay for
 * them by opening the player.
 */
import { useEffect, useState } from 'react'
import type { OverlayProps, VisualizerFactory } from '../runtime-types'

type ButterApi = {
  presets(): string[]
  state(): { preset: string; cycle: number; random: boolean }
  setPreset(name: string): void
  next(): void
  prev(): void
  setCycle(seconds: number): void
  setRandom(on: boolean): void
}

/** The packs wrap themselves in a UMD default; unwrap whatever shape arrives. */
function presetsFrom(mod: unknown): Record<string, object> {
  let bag = ((mod as { default?: unknown }).default ?? mod) as Record<string, object>
  const inner = (bag as unknown as { default?: unknown }).default
  if (inner && typeof inner === 'object') bag = inner as Record<string, object>
  return bag
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))

const ButterchurnViz: VisualizerFactory = async ({
  container,
  width,
  height,
  dpr,
  analyser,
  getAnalyser,
}) => {
  const canvas = document.createElement('canvas')
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block'
  container.appendChild(canvas)

  const [{ default: Butterchurn }, presetsModule] = await Promise.all([
    import('butterchurn'),
    import('butterchurn-presets'),
  ])

  const presets = presetsFrom(presetsModule)
  const names = Object.keys(presets).sort((a, b) => a.localeCompare(b))
  if (!names.length) throw new Error('the preset pack came back empty')

  const size = {
    width: Math.max(1, width),
    height: Math.max(1, height),
    dpr: Math.min(2, dpr),
  }

  let visualizer: ReturnType<typeof Butterchurn.createVisualizer> | null = null
  let tap: GainNode | null = null
  let mute: GainNode | null = null
  let index = Math.floor(Math.random() * names.length)
  let cycle = 15
  let random = true
  let elapsed = 0
  const history: number[] = []
  let disposed = false

  const load = (next: number, blend = 5.7) => {
    index = ((next % names.length) + names.length) % names.length
    if (!visualizer) return
    try {
      visualizer.loadPreset(presets[names[index]], blend)
    } catch {
      /* a preset the renderer cannot compile — keep the previous picture */
    }
  }

  /* The deck builds its audio graph on the FIRST PLAY, so this visual is
     usually picked before there is anything to listen to. Build once the
     analyser exists instead of failing at mount: the canvas is already up and
     starts moving on the next frame after playback begins. */
  const build = (an: AnalyserNode) => {
    const context = an.context as AudioContext
    tap = context.createGain()
    tap.gain.value = 1
    mute = context.createGain()
    mute.gain.value = 0
    try {
      an.connect(tap)
      tap.connect(mute)
      mute.connect(context.destination)
    } catch {
      /* an already-closed context — Butterchurn will simply read silence */
    }
    visualizer = Butterchurn.createVisualizer(context, canvas, {
      width: size.width,
      height: size.height,
      pixelRatio: size.dpr,
      textureRatio: 1,
    })
    try {
      visualizer.connectAudio(tap)
    } catch {
      /* nothing to connect to — it renders black until the next build */
    }
    load(index, 0)
  }

  const opening = analyser ?? getAnalyser?.() ?? null
  if (opening) build(opening)

  const next = (blend = 5.7) => {
    history.push(index)
    if (history.length > 32) history.shift()
    load(random ? Math.floor(Math.random() * names.length) : index + 1, blend)
  }

  const prev = (blend = 5.7) => {
    load(history.length ? (history.pop() as number) : index - 1, blend)
  }

  const api: ButterApi = {
    presets: () => names,
    state: () => ({ preset: names[index], cycle, random }),
    setPreset(name: string) {
      const at = names.indexOf(name)
      if (at >= 0) {
        history.push(index)
        load(at)
      }
    },
    next: () => next(),
    prev: () => prev(),
    setCycle(seconds: number) {
      cycle = clamp(Number.isFinite(seconds) ? seconds : 0, 0, 600)
      elapsed = 0
    },
    setRandom(on: boolean) {
      random = !!on
    },
  }

  return {
    resize(w, h, pr) {
      size.width = Math.max(1, w)
      size.height = Math.max(1, h)
      size.dpr = Math.min(2, pr)
      visualizer?.setRendererSize(size.width, size.height, {
        pixelRatio: size.dpr,
        textureRatio: 1,
      })
    },

    frame({ settings, dt }) {
      if (disposed) return
      /* still no audio graph? try again each frame until the deck has one */
      if (!visualizer) {
        const an = getAnalyser?.() ?? null
        if (!an) return
        build(an)
        if (!visualizer) return
      }
      if (tap) tap.gain.value = clamp(settings.sensitivity, 0.1, 3)
      if (cycle > 0) {
        elapsed += dt
        if (elapsed >= cycle) {
          elapsed = 0
          next(2.7)
        }
      }
      try {
        visualizer.render()
      } catch {
        /* a preset that will not compile must not take the backdrop down */
      }
    },

    dispose() {
      disposed = true
      const an = getAnalyser?.() ?? null
      try {
        if (visualizer && tap) visualizer.disconnectAudio(tap)
      } catch {
        /* already gone */
      }
      try {
        visualizer?.dispose?.()
      } catch {
        /* already gone */
      }
      try {
        if (an && tap) an.disconnect(tap)
        tap?.disconnect()
        mute?.disconnect()
      } catch {
        /* already gone */
      }
      canvas.width = canvas.height = 0
      canvas.remove()
    },

    api: api as unknown as Record<string, (...args: never[]) => unknown>,
  }
}

export default ButterchurnViz

/* ---- its own settings card ------------------------------------------- */

const field =
  'h-6 min-w-0 rounded-md border border-white/15 bg-white/[0.06] px-2 font-mono text-[9px] tracking-[0.12em] text-white/80 outline-none transition hover:border-white/35 focus-visible:border-white/45'
const stepBtn =
  'grid h-6 w-6 place-items-center rounded-md border border-white/15 bg-white/[0.06] text-[11px] leading-none text-white/70 transition hover:border-white/40 hover:text-white'
const check = 'h-3 w-3 accent-emerald-400'

export function Overlay({ api }: OverlayProps) {
  const viz = api as unknown as ButterApi | null
  const names = viz?.presets() ?? []
  const initial = viz?.state()
  const [preset, setPreset] = useState(initial?.preset ?? names[0] ?? '')
  const [cycle, setCycle] = useState(initial?.cycle ?? 15)
  const [random, setRandom] = useState(initial?.random ?? true)
  /* collapsed until asked for: the card sits over the panel's own controls */
  const [open, setOpen] = useState(false)

  useEffect(() => {
    viz?.setCycle(cycle)
  }, [viz, cycle])
  useEffect(() => {
    viz?.setRandom(random)
  }, [viz, random])

  const pick = (name: string) => {
    setPreset(name)
    viz?.setPreset(name)
  }
  const step = (dir: number) => {
    viz?.[dir > 0 ? 'next' : 'prev']()
    /* the module is the source of truth for what is on screen */
    const now = viz?.state().preset
    if (now) setPreset(now)
  }

  return (
    <div className="absolute bottom-3 right-3 z-20 w-[268px] max-w-[calc(100%-1.5rem)]">
      {open && (
        <div className="mb-2 flex flex-col gap-2 rounded-xl border border-white/15 bg-black/70 p-2.5 backdrop-blur-sm">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[7px] tracking-[0.2em] text-white/40">BUTTERCHURN</span>
            <span className="font-mono text-[7px] tracking-[0.15em] text-white/30">
              {names.length} PRESETS
            </span>
          </div>

          <div className="flex items-center gap-1">
            <button className={stepBtn} onClick={() => step(-1)} aria-label="Previous preset">
              ‹
            </button>
            <select
              value={preset}
              onChange={(e) => pick(e.target.value)}
              aria-label="Butterchurn preset"
              className={`${field} flex-1 truncate`}
              style={{ colorScheme: 'dark' }}
            >
              {names.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <button className={stepBtn} onClick={() => step(1)} aria-label="Next preset">
              ›
            </button>
          </div>

          <label className="flex items-center justify-between gap-2 font-mono text-[8px] tracking-[0.15em] text-white/45">
            AUTO-CYCLE
            <span className="flex items-center gap-1">
              <input
                type="checkbox"
                checked={cycle > 0}
                onChange={(e) => setCycle(e.target.checked ? 15 : 0)}
                className={check}
                aria-label="Cycle presets automatically"
              />
              <input
                type="number"
                min={1}
                max={600}
                value={Math.max(1, Math.round(cycle))}
                onChange={(e) => setCycle(clamp(Number(e.target.value) || 0, 0, 600))}
                className={`${field} w-12 tabular-nums`}
                aria-label="Seconds per preset"
              />
              <span className="text-white/30">s</span>
            </span>
          </label>

          <label className="flex items-center justify-between gap-2 font-mono text-[8px] tracking-[0.15em] text-white/45">
            RANDOM NEXT
            <input
              type="checkbox"
              checked={random}
              onChange={(e) => setRandom(e.target.checked)}
              className={check}
              aria-label="Pick the next preset at random"
            />
          </label>
        </div>
      )}
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="ml-auto flex h-7 items-center gap-1.5 rounded-full border border-white/15 bg-black/60 px-3 font-mono text-[8px] tracking-[0.18em] text-white/60 transition hover:border-white/40 hover:text-white"
      >
        BUTTERCHURN
      </button>
    </div>
  )
}
