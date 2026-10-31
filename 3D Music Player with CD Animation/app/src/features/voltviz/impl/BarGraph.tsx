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
  state(): { palette: number; bars: number; intensity: number; bg: boolean }
  setPalette(index: number): void
  setBars(count: number): void
  setIntensity(value: number): void
  /** SHOW BACKGROUND — wallpaper behind the bars, or the black stage */
  setBackground(on: boolean): void
}

/* the bar graph's own background choice, persisted beside the other visual
   settings: OFF (the default) paints its black stage; ON clears the canvas
   every frame so the wallpaper/gradient behind the backdrop shows through */
const BG_KEY = 'md-bargraph-bg'
/* palette, bar count and intensity persist the same way — the factory owns
   the state, so it reads these on construction and writes them on every
   change; the settings card seeds its own controls from the same keys, so a
   card that mounts before the api is wired still shows the truth */
const PALETTE_KEY = 'md-bargraph-palette'
const BARS_KEY = 'md-bargraph-bars'
const INTENSITY_KEY = 'md-bargraph-intensity'

function readNum(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key)
    /* a MISSING key is not a zero — Number(null) is 0, which would clamp
       every unset setting to its floor and write that back over the default */
    if (raw === null || raw.trim() === '') return fallback
    const n = Number(raw)
    return Number.isFinite(n) ? n : fallback
  } catch {
    return fallback
  }
}

function writeNum(key: string, value: number): void {
  try {
    localStorage.setItem(key, String(value))
  } catch {
    /* private mode — the choice lasts for this session */
  }
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
  /* alpha-capable: with SHOW BACKGROUND on, the canvas is CLEARED each frame
     instead of filled, and the wallpaper shows through it. With it off the
     full opaque paint below makes this visually identical to before. */
  const ctx = canvas.getContext('2d', { alpha: true })
  if (!ctx) throw new Error('this machine will not give the bar graph a 2D canvas')

  let bgOn = (() => {
    try {
      return localStorage.getItem(BG_KEY) === '1'
    } catch {
      return false
    }
  })()
  /* the backdrop's own container paints black for this style (see
     VoltVizBackdrop's blackFor) — the setting owns that too */
  container.style.background = bgOn ? 'transparent' : '#000'

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

  let palette = clamp(Math.round(readNum(PALETTE_KEY, 0)), 0, PALETTES.length - 1)
  let bars = clamp(Math.round(readNum(BARS_KEY, 128)), BAR_COUNTS[0], MAX_BARS)
  let intensity = clamp(readNum(INTENSITY_KEY, 1), 0.1, 3)
  /* the tilt of the low end, eased across frames — read raw off each frame
     it swings between its clamps on a heavy bass line and the left bars pump */
  let lowGain = 1
  /* what the context is actually holding. A bar whose colour matches it
     skips the assignment — the cache lives against the CONTEXT and not
     against the bar, so a bar is never filled with whatever the previous
     draw left behind. (Cached per bar, one flat palette such as Full White
     shared one colour string across all of them: after a frame nothing set
     fillStyle again except the background paint, and the whole graph drew
     itself in the background colour — invisible.) */
  let painted = '#05060a'

  const api: BarGraphApi = {
    state: () => ({ palette, bars, intensity, bg: bgOn }),
    setPalette(index: number) {
      palette = ((Math.round(index) % PALETTES.length) + PALETTES.length) % PALETTES.length
      writeNum(PALETTE_KEY, palette)
    },
    setBars(count: number) {
      const next = clamp(Math.round(count), BAR_COUNTS[0], MAX_BARS)
      if (next !== bars) {
        bars = next
        levels.fill(0)
        writeNum(BARS_KEY, bars)
      }
    },
    setIntensity(value: number) {
      intensity = clamp(Number.isFinite(value) ? value : 1, 0.1, 3)
      writeNum(INTENSITY_KEY, intensity)
    },
    setBackground(on: boolean) {
      bgOn = on
      try {
        localStorage.setItem(BG_KEY, on ? '1' : '0')
      } catch {
        /* private mode — the choice lasts for this session */
      }
      container.style.background = on ? 'transparent' : '#000'
      /* the next frame paints (or clears) under the new mode on its own */
    },
  }
  api.setBars(bars)

  return {
    resize(w, h, pr) {
      cssW = Math.max(1, w)
      cssH = Math.max(1, h)
      ratio = Math.max(1, Math.min(2, pr))
      sizeCanvas()
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
         row of nubs. The tilt is eased, not applied raw: on a loud bass line
         the target swings between its clamps frame to frame, and the left
         bars would pump with it. */
      const lowBins = 8
      let ref = 0
      for (let i = 3; i < lowBins; i++) ref = Math.max(ref, spec[i] ?? 0)
      let lowSum = 0
      for (let i = 1; i < 3; i++) lowSum += spec[i] ?? 0
      const lowAvg = Math.max(1, lowSum / 2)
      const lowTarget = clamp((ref * 0.95 + 2) / lowAvg, 0.55, 1.6)
      lowGain += (lowTarget - lowGain) * (lowTarget > lowGain ? attack : fall)

      const barW = cssW / n
      const gap = Math.min(barW * 0.22, 3)
      const w = Math.max(1, barW - gap)

      /* the stage. OFF: the opaque black paint (with a device pixel of slack
         on every side — the backing store is round(cssW * ratio) wide, and on
         odd ratios that is a pixel more than the transform reaches, an
         uncleared column that flickers). The fill also REPLACES what the
         context holds, so the colour cache is re-synced here: left stale,
         every bar of a flat palette (Full White — one colour string across
         all of them) would match the cache, skip its fillStyle assignment,
         and be drawn in the stale dark colour of the frame before — the
         whole graph invisible. ON: clearRect instead, and the wallpaper
         behind the backdrop shows through the alpha canvas. */
      if (bgOn) {
        ctx.clearRect(-1, -1, cssW + 2, cssH + 2)
        painted = ''
      } else {
        ctx.fillStyle = '#05060a'
        painted = '#05060a'
        ctx.fillRect(-1, -1, cssW + 2, cssH + 2)
      }

      let loudest = 0
      for (let i = 0; i < n; i++) {
        /* each bar owns a band of the log-spaced axis. Rounded to ONE bin,
           the slow-moving low end made neighbours share a bin and jump as
           pairs — so a bar narrower than a bin is interpolated across its
           two neighbours, and a bar spanning several bins reads the loudest
           bin it covers, keeping a peak on its own bar. */
        const f0 = F_LO * Math.pow(F_HI / F_LO, i / Math.max(1, n - 1))
        const f1 = F_LO * Math.pow(F_HI / F_LO, Math.min(1, (i + 1) / Math.max(1, n - 1)))
        const b0 = (f0 / nyquist) * spec.length
        const b1 = (f1 / nyquist) * spec.length
        let v: number
        if (b1 - b0 < 1) {
          const lo = Math.min(spec.length - 1, Math.max(0, Math.floor(b0)))
          const hi = Math.min(spec.length - 1, lo + 1)
          const frac = clamp(b0 - lo, 0, 1)
          const a = spec[lo] ?? 0
          const b = spec[hi] ?? 0
          v = a + (b - a) * frac
        } else {
          const lo = Math.max(0, Math.floor(b0))
          const hi = Math.min(spec.length, Math.max(lo + 1, Math.ceil(b1)))
          let m = 0
          for (let k = lo; k < hi; k++) m = Math.max(m, spec[k] ?? 0)
          v = m
        }
        let val = clamp((Number.isFinite(v) ? v : 0) / 255, 0, 1)
        if (i < lowBins) val *= lowGain * (i < 3 ? 1.12 : 1.04)
        const target = clamp(val * gain, 0, 1)
        const lv = levels[i]
        levels[i] = lv + (target - lv) * (target > lv ? attack : fall)
        const level = clamp(levels[i] * heightScale, 0, 1)
        if (level <= 0.002) continue

        const h = level * cssH
        const color = sample(stops, clamp(level * 0.9 + hue, 0, 1))
        if (color !== painted) {
          ctx.fillStyle = color
          painted = color
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
  /* seeded from the SAME keys the factory persists — a card that mounts
     before the api lands still shows the saved choice, and its mount
     effects then write the identical values straight back */
  const [bars, setBars] = useState(() =>
    clamp(Math.round(readNum(BARS_KEY, 128)), BAR_COUNTS[0], MAX_BARS),
  )
  const [palette, setPalette] = useState(() =>
    clamp(Math.round(readNum(PALETTE_KEY, 0)), 0, PALETTES.length - 1),
  )
  const [intensity, setIntensity] = useState(() => clamp(readNum(INTENSITY_KEY, 1), 0.1, 3))
  const [bg, setBg] = useState(() => viz?.state().bg ?? false)
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
  useEffect(() => {
    viz?.setBackground(bg)
  }, [viz, bg])

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

          {/* one strict grid for every row: labels in a flexible left
              column, controls in a right column of FIXED width, so the
              [-][value][+] clusters sit in one perfect vertical line row
              over row (a flex `justify-end` let each row's cluster land
              wherever its content put it) */}
          <div className="grid grid-cols-[1fr_auto] items-center gap-x-2 gap-y-2">
            <span className="font-mono text-[8px] tracking-[0.15em] text-white/45">BARS</span>
            <div className="grid w-[104px] grid-cols-[24px_48px_24px] items-center justify-items-center gap-1">
              <button className={stepBtn} onClick={() => stepBars(-1)} aria-label="Fewer bars">
                −
              </button>
              <output className={`${field} w-12 text-center tabular-nums`}>{bars}</output>
              <button className={stepBtn} onClick={() => stepBars(1)} aria-label="More bars">
                +
              </button>
            </div>

            <span className="font-mono text-[8px] tracking-[0.15em] text-white/45">INTENSITY</span>
            <div className="grid w-[104px] grid-cols-[24px_48px_24px] items-center justify-items-center gap-1">
              <button
                className={stepBtn}
                onClick={() => setIntensity((v) => Math.max(0.1, Math.round((v - 0.1) * 10) / 10))}
                aria-label="Decrease intensity"
              >
                −
              </button>
              <output className={`${field} w-12 text-center tabular-nums`}>
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

            {/* SHOW BACKGROUND — the wallpaper behind the bars, or the black
                stage. On: the canvas clears each frame and the backdrop's own
                black container steps aside, so the theme/wallpaper shows. */}
            <span className="font-mono text-[8px] tracking-[0.15em] text-white/45">
              SHOW BACKGROUND
            </span>
            <div className="grid w-[104px] justify-items-end">
              <button
                onClick={() => setBg((o) => !o)}
                aria-pressed={bg}
                aria-label="Toggle the background behind the bars"
                title={bg ? 'The wallpaper shows behind the bars' : 'The bars play on the black stage'}
                className={`relative h-4 w-8 shrink-0 rounded-full transition-colors ${
                  bg ? 'bg-emerald-400/80' : 'bg-white/15'
                }`}
              >
                <span
                  className="absolute top-0.5 h-3 w-3 rounded-full bg-white transition-all"
                  style={{ left: bg ? 18 : 2 }}
                />
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
