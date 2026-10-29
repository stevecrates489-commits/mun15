/**
 * Bar Graph — the spectrum, one bar per band, drawn edge to edge.
 *
 * From Visicality's bar graph: a log-spaced spectrum with the low end
 * tilted up (byte spectra sit far too low in the bass to read), one filled
 * bar per bin, coloured by LEVEL through a d3 palette. No d3 here — the ten
 * palettes are the same colour ramps, interpolated by hand — and no layout
 * pass: bars are plain fillRects on one canvas, so it costs a fraction of
 * what the WebGL styles do.
 *
 * It reads the deck's own analyser through the shared AudioFrame, so it is
 * the track that is playing and not a simulation. Settings:
 *   - own card: palette, bar count (32…512), intensity
 *   - the shared four: sensitivity (level gain), speed (fall/attack rate),
 *     hueShift (rotates the palette), scale (vertical size)
 */
import { useEffect, useState } from 'react'
import type { OverlayProps, VisualizerFactory } from '../runtime-types'

type Stop = readonly [number, number, number]

const PALETTES: { name: string; stops: readonly Stop[] }[] = [
  { name: 'Rainbow', stops: [[255, 32, 32], [255, 214, 32], [62, 234, 84], [32, 214, 234], [54, 84, 234], [234, 54, 214]] },
  { name: 'Plasma', stops: [[13, 8, 135], [126, 3, 168], [204, 71, 120], [248, 149, 64], [240, 249, 33]] },
  { name: 'Viridis', stops: [[68, 1, 84], [59, 82, 139], [33, 145, 140], [94, 201, 98], [253, 231, 37]] },
  { name: 'Sinebow', stops: [[255, 0, 96], [255, 200, 0], [64, 255, 96], [0, 200, 255], [160, 0, 255]] },
  { name: 'Spectral', stops: [[158, 1, 66], [244, 109, 67], [254, 224, 139], [230, 245, 152], [50, 136, 189]] },
  { name: 'Cubehelix', stops: [[12, 8, 20], [86, 54, 107], [146, 109, 158], [176, 164, 186], [232, 228, 226]] },
  { name: 'YlOrRd', stops: [[255, 255, 204], [254, 178, 76], [253, 141, 60], [240, 59, 32], [189, 0, 38]] },
  { name: 'YlGnBu', stops: [[255, 255, 217], [199, 233, 180], [65, 182, 196], [44, 127, 184], [37, 52, 148]] },
  { name: 'Greys', stops: [[255, 255, 255], [189, 189, 189], [115, 115, 115], [37, 37, 37]] },
  { name: 'Full White', stops: [[255, 255, 255], [255, 255, 255]] },
]

const BAR_COUNTS = [32, 64, 96, 128, 192, 256, 384, 512] as const
const F_LO = 34
const F_HI = 15000
const MAX_BARS = 512

type BarGraphApi = {
  state(): { palette: number; bars: number; intensity: number }
  setPalette(index: number): void
  setBars(count: number): void
  setIntensity(value: number): void
}

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v))

/** The palette ramps, sampled at t (0…1) — the d3 interpolators by hand. */
function sample(stops: readonly Stop[], t: number): string {
  const x = clamp(t, 0, 1) * (stops.length - 1)
  const i = Math.min(stops.length - 2, Math.floor(x))
  const f = x - i
  const a = stops[i]
  const b = stops[i + 1]
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * f)},${Math.round(
    a[1] + (b[1] - a[1]) * f,
  )},${Math.round(a[2] + (b[2] - a[2]) * f)})`
}

const BarGraph: VisualizerFactory = ({ container, width, height, dpr }) => {
  const canvas = document.createElement('canvas')
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block'
  container.appendChild(canvas)
  const ctx = canvas.getContext('2d', { alpha: false })
  if (!ctx) throw new Error('this machine will not give the bar graph a 2D canvas')

  let cssW = Math.max(1, width)
  let cssH = Math.max(1, height)
  let ratio = Math.max(1, Math.min(2, dpr))

  const sizeCanvas = () => {
    canvas.width = Math.max(1, Math.round(cssW * ratio))
    canvas.height = Math.max(1, Math.round(cssH * ratio))
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0)
  }
  sizeCanvas()

  /* the bars' own smoothing state — per bar, so a bin that drops reads as a
     fall rather than a hole */
  const levels = new Float32Array(MAX_BARS)

  let palette = 0
  let bars = 128
  let intensity = 1
  /* last colour per bar, so a bar that has not moved does not re-parse a
     colour string every frame */
  const lastColor = new Array<string>(MAX_BARS).fill('')

  const api: BarGraphApi = {
    state: () => ({ palette, bars, intensity }),
    setPalette(index: number) {
      palette = ((Math.round(index) % PALETTES.length) + PALETTES.length) % PALETTES.length
    },
    setBars(count: number) {
      const next = clamp(Math.round(count), BAR_COUNTS[0], MAX_BARS)
      if (next !== bars) {
        bars = next
        levels.fill(0)
        lastColor.fill('')
      }
    },
    setIntensity(value: number) {
      intensity = clamp(Number.isFinite(value) ? value : 1, 0.1, 3)
    },
  }
  api.setBars(bars)

  return {
    resize(w, h, pr) {
      cssW = Math.max(1, w)
      cssH = Math.max(1, h)
      ratio = Math.max(1, Math.min(2, pr))
      sizeCanvas()
      lastColor.fill('')
    },

    frame({ audio, settings, dt }) {
      if (cssW < 2 || cssH < 2) return
      const spec = audio.spectrum({ fftSize: 2048, smoothing: 0.72 })
      const n = bars
      const nyquist = audio.sampleRate / 2
      const gain = intensity * clamp(settings.sensitivity, 0.1, 3)
      const speed = clamp(settings.speed, 0.1, 3)
      const attack = Math.min(1, dt * (7 + 12 * speed))
      const fall = Math.min(1, dt * (2.2 + 5 * speed))
      const heightScale = clamp(settings.scale, 0.5, 3)
      const hue = ((settings.hueShift / 360) % 1 + 1) % 1
      const stops = PALETTES[palette].stops

      /* the low end, tilted up: a byte spectrum's bass bins sit near the
         floor on most masters, and without this the graph's left third is a
         row of nubs */
      const lowBins = 8
      let ref = 0
      for (let i = 3; i < lowBins; i++) ref = Math.max(ref, spec[i] ?? 0)
      let lowSum = 0
      for (let i = 1; i < 3; i++) lowSum += spec[i] ?? 0
      const lowAvg = Math.max(1, lowSum / 2)
      const lowGain = clamp((ref * 0.95 + 2) / lowAvg, 0.55, 1.6)

      const barW = cssW / n
      const gap = Math.min(barW * 0.22, 3)
      const w = Math.max(1, barW - gap)

      ctx.fillStyle = '#05060a'
      ctx.fillRect(0, 0, cssW, cssH)

      let loudest = 0
      for (let i = 0; i < n; i++) {
        const f = F_LO * Math.pow(F_HI / F_LO, i / Math.max(1, n - 1))
        const bin = Math.min(spec.length - 1, Math.max(0, Math.round((f / nyquist) * spec.length)))
        let v = (spec[bin] ?? 0) / 255
        if (i < lowBins) v *= lowGain * (i < 3 ? 1.12 : 1.04)
        const target = clamp(v * gain, 0, 1)
        const lv = levels[i]
        levels[i] = lv + (target - lv) * (target > lv ? attack : fall)
        const level = clamp(levels[i] * heightScale, 0, 1)
        if (level <= 0.002) continue

        const h = level * cssH
        const color = sample(stops, clamp(level * 0.9 + hue, 0, 1))
        if (color !== lastColor[i]) {
          lastColor[i] = color
          ctx.fillStyle = color
        }
        ctx.fillRect(i * barW + gap / 2, cssH - h, w, h)
        if (level > loudest) loudest = level
      }

      /* silence is not a broken screen: a hairline baseline says the visual
         is here and waiting, instead of leaving a black window */
      if (loudest < 0.01) {
        ctx.fillStyle = 'rgba(255,255,255,0.14)'
        ctx.fillRect(0, cssH - 1, cssW, 1)
      }
    },

    dispose() {
      canvas.width = canvas.height = 0
      canvas.remove()
    },

    api: api as unknown as Record<string, (...args: never[]) => unknown>,
  }
}

export default BarGraph

/* ---- its own settings card ------------------------------------------- */

const field =
  'h-6 min-w-0 rounded-md border border-white/15 bg-white/[0.06] px-2 font-mono text-[9px] tracking-[0.12em] text-white/80 outline-none transition hover:border-white/35 focus-visible:border-white/45'
const stepBtn =
  'grid h-6 w-6 place-items-center rounded-md border border-white/15 bg-white/[0.06] text-[11px] leading-none text-white/70 transition hover:border-white/40 hover:text-white'

export function Overlay({ api }: OverlayProps) {
  const viz = api as unknown as BarGraphApi | null
  const [bars, setBars] = useState(() => viz?.state().bars ?? 128)
  const [palette, setPalette] = useState(() => viz?.state().palette ?? 0)
  const [intensity, setIntensity] = useState(() => viz?.state().intensity ?? 1)
  /* collapsed until asked for: the card sits over the panel's own controls */
  const [open, setOpen] = useState(false)

  useEffect(() => {
    viz?.setBars(bars)
  }, [viz, bars])
  useEffect(() => {
    viz?.setPalette(palette)
  }, [viz, palette])
  useEffect(() => {
    viz?.setIntensity(intensity)
  }, [viz, intensity])

  const stepBars = (dir: number) => {
    const i = BAR_COUNTS.indexOf(bars as (typeof BAR_COUNTS)[number])
    const at = i < 0 ? BAR_COUNTS.indexOf(128) : i
    setBars(BAR_COUNTS[clamp(at + dir, 0, BAR_COUNTS.length - 1)])
  }

  return (
    <div className="absolute bottom-3 right-3 z-20 w-[248px] max-w-[calc(100%-1.5rem)]">
      {open && (
        <div className="mb-2 flex flex-col gap-2 rounded-xl border border-white/15 bg-black/70 p-2.5 backdrop-blur-sm">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[7px] tracking-[0.2em] text-white/40">BAR GRAPH</span>
            <span className="font-mono text-[7px] tracking-[0.15em] text-white/30">
              {PALETTES[palette].name.toUpperCase()}
            </span>
          </div>

          <div className="grid grid-cols-5 gap-1">
            {PALETTES.map((p, i) => (
              <button
                key={p.name}
                onClick={() => setPalette(i)}
                title={p.name}
                aria-label={`Palette ${p.name}`}
                aria-pressed={palette === i}
                className={`h-4 rounded-[4px] border transition ${
                  palette === i ? 'border-white/80' : 'border-white/15 hover:border-white/50'
                }`}
                style={{
                  background: `linear-gradient(90deg, ${p.stops
                    .map((s) => `rgb(${s[0]},${s[1]},${s[2]})`)
                    .join(', ')})`,
                }}
              />
            ))}
          </div>

          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[8px] tracking-[0.15em] text-white/45">BARS</span>
            <div className="flex items-center gap-1">
              <button className={stepBtn} onClick={() => stepBars(-1)} aria-label="Fewer bars">
                −
              </button>
              <output className={`${field} text-center tabular-nums`}>{bars}</output>
              <button className={stepBtn} onClick={() => stepBars(1)} aria-label="More bars">
                +
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-[8px] tracking-[0.15em] text-white/45">INTENSITY</span>
            <div className="flex items-center gap-1">
              <button
                className={stepBtn}
                onClick={() => setIntensity((v) => Math.max(0.1, Math.round((v - 0.1) * 10) / 10))}
                aria-label="Decrease intensity"
              >
                −
              </button>
              <output className={`${field} min-w-[46px] text-center tabular-nums`}>
                {intensity.toFixed(1)}×
              </output>
              <button
                className={stepBtn}
                onClick={() => setIntensity((v) => Math.min(3, Math.round((v + 0.1) * 10) / 10))}
                aria-label="Increase intensity"
              >
                +
              </button>
            </div>
          </div>
        </div>
      )}
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="ml-auto flex h-7 items-center gap-1.5 rounded-full border border-white/15 bg-black/60 px-3 font-mono text-[8px] tracking-[0.18em] text-white/60 transition hover:border-white/40 hover:text-white"
      >
        BAR GRAPH
      </button>
    </div>
  )
}
