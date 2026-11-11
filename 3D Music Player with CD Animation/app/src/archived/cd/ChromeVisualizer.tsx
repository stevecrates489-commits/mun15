/* ============================================================================
 * ARCHIVED — the CD is gone from the player.
 *
 * Nothing outside `src/archived/` imports this file, so it is tree-shaken out
 * of the bundle and never reaches the screen. It is kept so the feature can
 * come back without being rewritten. See ./README.md for the restore steps.
 * ========================================================================== */
import { useEffect, useRef } from 'react'

interface Props {
  getAnalyser: () => AnalyserNode | null
  playing: boolean
}

const TAU = Math.PI * 2
const TICKS = 96
const SECTOR = 4 /* ticks per batched stroke → 24 strokes instead of 96 */
const ARCS = 3
const SEG = 24
const LEVELS = 4 /* alpha buckets per arc band → ≤12 strokes instead of 72 */
const ARC_HUES = [215, 268, 322]
/* intensity is fixed at 90% of the classic look (the slider was removed —
   the component has no live state, the draw never re-reads React) */
const I = 0.9

/**
 * Chrome halo — a machined, audio-reactive bezel that hugs the MiniDisc:
 * 96 silver ticks (batched into 24 sectors), three segmented turbine arcs
 * (alpha-quantized), a live oscilloscope ring and kick ripples. Always
 * perfectly circular.
 *
 * Liveness guarantees — this component historically "froze / vanished":
 *  1. the rAF is scheduled BEFORE the frame body, so no throw can ever
 *     kill the loop;
 *  2. the fps governor only rate-limits — it never clears the canvas
 *     (blank frames read as "vanish"; skipped frames keep the last
 *     picture);
 *  3. a loading/xfade pipeline freezes (or micro-jitters) the analyser —
 *     after 0.5s of identical or flat data the draw falls back to the
 *     idle sine drift, so a static image can never sit on screen;
 *  4. the effect runs once: no Home re-render can restart the loop or
 *     re-allocate the canvas texture.
 *
 * Weight (the CD must stay smooth):
 *  - a LOCKED 30fps cadence (every other display frame): half the rasters
 *    and half the texture uploads, at a steady rhythm that reads smoother
 *    than a wobbling 30-45fps variable rate. The fx governor deepens the
 *    interval on top (fx3: 15fps, fx4: 10fps);
 *  - dpr 1.0: the canvas is stretched on a 125% display anyway — thin
 *    glow lines soften imperceptibly for −36% pixels;
 *  - glow is a pre-baked 192px sprite blitted once per frame;
 *  - canvas box 150% of the stage, geometry anchored to stage width.
 */
export default function ChromeVisualizer({ getAnalyser, playing }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const playingRef = useRef(playing)
  playingRef.current = playing
  const getAnalyserRef = useRef(getAnalyser)
  getAnalyserRef.current = getAnalyser

  useEffect(() => {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    const data = new Uint8Array(256)
    const prev = new Uint8Array(256)
    const wave = new Uint8Array(512)
    const segVBuf = new Float32Array(SEG)

    const tickE = new Float32Array(TICKS).fill(0.06)
    const raw = new Float32Array(TICKS)
    const bandE = new Float32Array(ARCS).fill(0.08)
    let bass = 0
    let bassSlow = 0
    let cooldown = 0
    let stale = 0 /* identical-analyser-frame counter */
    const ripples: { r: number; a: number }[] = []

    /* static colors, computed once */
    const tickColors = Array.from({ length: TICKS }, (_, i) => {
      const hue = 215 + 90 * Math.sin((i / TICKS) * TAU)
      return `hsla(${hue.toFixed(0)},30%,80%,1)`
    })
    const arcColors = ARC_HUES.map((h) => `hsla(${h},32%,80%,1)`)

    /* pre-baked glow sprite: a scaled drawImage instead of re-shading a
       ~630px radial gradient every frame */
    const GLOW_PX = 192
    const glowSrc = (() => {
      const c = document.createElement('canvas')
      c.width = c.height = GLOW_PX
      const g = c.getContext('2d')!
      const gr = g.createRadialGradient(GLOW_PX / 2, GLOW_PX / 2, GLOW_PX * 0.125, GLOW_PX / 2, GLOW_PX / 2, GLOW_PX / 2)
      gr.addColorStop(0, 'rgba(150,180,255,1)')
      gr.addColorStop(1, 'rgba(150,180,255,0)')
      g.fillStyle = gr
      g.fillRect(0, 0, GLOW_PX, GLOW_PX)
      return c
    })()

    /* cadence state: locked 30fps base, deepened by the fx governor */
    let frameIdx = 0

    let vw = 0
    let vh = 0
    let cx = 0
    let cy = 0
    let discR = 0
    let stageW = 0
    const resize = () => {
      /* dpr fixed at 1.0: the canvas is upscaled by the display's 125%
         scale anyway — glow lines soften imperceptibly for −36% pixels
         (less raster + smaller texture upload every drawn frame) */
      const rect = canvas.getBoundingClientRect()
      /* the stage collapses to 0 height whenever the CD is hidden — sizing
         the backing store to that leaves a 1px texture, and stretching it
         back over the restored box IS the vertical-stripe artifact. Skip
         zero measurements; the ResizeObserver re-fires on recovery. */
      if (!rect.width || !rect.height) return
      const dpr = 1
      const w = rect.width
      const h = rect.height
      const bw = Math.max(1, Math.round(w * dpr))
      const bh = Math.max(1, Math.round(h * dpr))
      /* geometry is effect-LOCAL (cx/cy/stageW/discR reset to 0 on every
         effect re-run — StrictMode remount, Fast Refresh). It must be
         refreshed on EVERY call; only the texture realloc is gated, or a
         remount lands on the guard with stageW=0 and the halo collapses
         to an invisible point that later resizes can never fix. */
      const sameTexture = bw === canvas.width && bh === canvas.height
      vw = w
      vh = h
      cx = vw / 2
      cy = vh / 2
      const pw = canvas.parentElement?.getBoundingClientRect().width
      stageW = pw || vw / 1.5
      discR = 0.395 * stageW
      if (sameTexture) return
      canvas.width = bw
      canvas.height = bh
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    resize()
    /* cover BOTH size sources: window resizes (the eased fullscreen entry
       fires a burst of them) and the element's own box (case mount/unmount).
       rAF-coalesced so the halo tracks a growing window frame-by-frame,
       plus a trailing pass for the burst's final resting size */
    let resizeTimer = 0
    let resizeRaf = 0
    const schedule = () => {
      if (!resizeRaf)
        resizeRaf = requestAnimationFrame(() => {
          resizeRaf = 0
          resize()
        })
      window.clearTimeout(resizeTimer)
      resizeTimer = window.setTimeout(resize, 120)
    }
    window.addEventListener('resize', schedule)
    const ro = new ResizeObserver(schedule)
    ro.observe(canvas)

    let last = performance.now()
    let lastErr = 0
    /* loop-liveness: rAF callbacks queued while the document is (or briefly
       reports) hidden get DROPPED by the engine — a plain Ctrl+R can land
       in exactly that window, killing the loop before any visibilitychange
       ever observes it. The self-heal below force-re-arms off this stamp. */
    let lastDrawAt = performance.now()
    const draw = (now: number) => {
      raf = requestAnimationFrame(draw) /* scheduled FIRST — a throw below can never kill the halo */
      lastDrawAt = now
      try {
        const dt = Math.min((now - last) / 1000, 0.05)
        last = now
        const t = now / 1000
        if (!vw || !vh) return /* collapsed stage: keep the last frame, RO re-measures */

        /* locked cadence: base step 2 = 30fps (steady rhythm, half the
           raster/upload load); the fx governor deepens it (3 → 15fps,
           4 → 10fps). Skipped frames keep the last picture — the halo is
           never blanked for degradation */
        const fx = Number(document.documentElement.dataset.fx || 0)
        const step = fx >= 4 ? 6 : fx >= 3 ? 4 : 2
        frameIdx++
        if (frameIdx % step !== 0) return

        ctx.clearRect(0, 0, vw, vh)

        const S = stageW // stage width in canvas units
        const R0 = discR * 1.14
        const spin = t * 0.02

        const an = getAnalyserRef.current()
        const rawAudio = !!(an && playingRef.current)
        if (rawAudio) {
          an!.getByteFrequencyData(data)
          an!.getByteTimeDomainData(wave)
        }

        /* dead-data watchdog: a loading/xfade pipeline parks the analyser on
           one byte-frame — or on noise-floor jitter too small to see, hence
           the spread check. 30 identical-or-flat frames (0.5s) → idle drift,
           so a track swap can NEVER leave a static image */
        let changed = false
        let mx = 0
        let mn = 255
        for (let i = 0; i < data.length; i++) {
          const d = data[i]
          if (d !== prev[i]) changed = true
          if (d > mx) mx = d
          if (d < mn) mn = d
        }
        if (changed && mx - mn >= 3) {
          stale = 0
          prev.set(data)
        } else stale++
        const hasAudio = rawAudio && stale < 30

        /* ---- per-tick energy: angularly smoothed so the ring flows ---- */
        for (let i = 0; i < TICKS; i++) {
          const bin = 2 + Math.floor((i / TICKS) * 100)
          raw[i] = hasAudio ? Math.pow(data[bin] / 255, 1.3) : 0.06 + 0.04 * Math.sin(t * 1.4 + i * 0.35)
        }
        for (let i = 0; i < TICKS; i++) {
          const v =
            (raw[(i + TICKS - 2) % TICKS] +
              raw[(i + TICKS - 1) % TICKS] +
              raw[i] +
              raw[(i + 1) % TICKS] +
              raw[(i + 2) % TICKS]) /
            5
          /* softer attack than decay: the ring flows into a hit instead of
             snapping, and settles without the visual "weight" of hard ticks */
          tickE[i] += (v - tickE[i]) * (v > tickE[i] ? 0.42 : 0.1)
        }

        /* ---- three bands for the turbine arcs ---- */
        const b0 = 2
        const b1 = 16
        const b2 = 50
        const b3 = 110
        const bandLo = [b0, b1, b2]
        const bandHi = [b1, b2, b3]
        for (let b = 0; b < ARCS; b++) {
          let target: number
          if (hasAudio) {
            let sum = 0
            for (let k = bandLo[b]; k < bandHi[b]; k++) sum += data[k]
            target = Math.min(1, Math.pow(sum / ((bandHi[b] - bandLo[b]) * 255), 1.15) * 1.6)
          } else {
            target = 0.08 + 0.04 * Math.sin(t * 1.1 + b * 2)
          }
          bandE[b] += (target - bandE[b]) * (target > bandE[b] ? 0.3 : 0.09)
        }

        /* ---- bass + kick ripple detection ---- */
        if (hasAudio) {
          let sum = 0
          for (let k = 2; k < 14; k++) sum += data[k]
          const target = Math.min(1, Math.pow(sum / (12 * 255), 1.1))
          bass += (target - bass) * (target > bass ? 0.35 : 0.08)
        } else {
          bass += (0.12 + 0.05 * Math.sin(t * 0.8) - bass) * 0.05
        }
        bassSlow += (bass - bassSlow) * 0.06
        cooldown -= dt
        if (hasAudio && bass - bassSlow > 0.12 && cooldown <= 0 && ripples.length < 2) {
          ripples.push({ r: discR * 1.05, a: 0.6 })
          cooldown = 0.3
        }

        /* ---- bass halo behind the disc (pre-baked sprite blit) ---- */
        ctx.globalAlpha = Math.min(1, Math.min(0.45, 0.1 + bass * 0.28) * I)
        const gr = discR * 1.6
        ctx.drawImage(glowSrc, cx - gr, cy - gr, gr * 2, gr * 2)
        ctx.globalAlpha = 1

        /* ---- baseline ring: the perfect circle ---- */
        ctx.strokeStyle = `rgba(220,228,240,${Math.min(1, 0.1 * I).toFixed(3)})`
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.arc(cx, cy, R0, 0, TAU)
        ctx.stroke()

        /* ---- tick ring, batched: one alpha + one stroke per SECTOR
           ticks (24 strokes total — the old per-tick strokes were the
           bulk of this component's frame cost) ---- */
        for (let i = 0; i < TICKS; i += SECTOR) {
          let e = 0
          for (let k = 0; k < SECTOR; k++) e += tickE[i + k]
          e /= SECTOR
          ctx.globalAlpha = Math.min(1, (0.17 + e * 0.62) * I)
          ctx.strokeStyle = tickColors[i + SECTOR / 2]
          ctx.lineWidth = 1.2
          ctx.beginPath()
          for (let k = 0; k < SECTOR; k++) {
            /* per-tick length, sector-shared color/alpha */
            const len = S * 0.012 + tickE[i + k] * S * 0.07
            const ang = ((i + k) / TICKS) * TAU - Math.PI / 2 + spin
            const rr2 = R0 + len
            ctx.moveTo(cx + Math.cos(ang) * R0, cy + Math.sin(ang) * R0)
            ctx.lineTo(cx + Math.cos(ang) * rr2, cy + Math.sin(ang) * rr2)
          }
          ctx.stroke()
        }
        ctx.globalAlpha = 1

        /* ---- live oscilloscope ring: the actual waveform, zero smoothing ----
           it bends with every drum hit in the same frame the sound plays */
        const R1 = R0 + S * 0.028
        const N = 128
        ctx.beginPath()
        for (let i = 0; i <= N; i++) {
          const k = i % N
          let v: number
          if (hasAudio) {
            v = (wave[Math.floor((k / N) * wave.length)] - 128) / 128
            /* crossfade the seam so the loop closes cleanly */
            if (k > N - 10) v = v * ((N - k) / 10)
          } else {
            v = 0.035 * Math.sin(t * 2 + k * 0.3)
          }
          const ang = (k / N) * TAU - Math.PI / 2 + spin
          const r = R1 + v * S * 0.05
          const x = cx + Math.cos(ang) * r
          const y = cy + Math.sin(ang) * r
          if (i === 0) ctx.moveTo(x, y)
          else ctx.lineTo(x, y)
        }
        ctx.closePath()
        const oscA = 0.3 + bass * 0.35
        ctx.strokeStyle = `rgba(225,232,246,${Math.min(1, oscA * I).toFixed(3)})`
        ctx.lineWidth = 1.5
        ctx.stroke()

        /* ---- segmented turbine arcs, alpha-quantized: LEVELS strokes per
           band instead of one per segment ---- */
        for (let b = 0; b < ARCS; b++) {
          const Rb = R0 + S * (0.06 + b * 0.032)
          const rot = t * (0.12 + b * 0.05) * (b % 2 === 0 ? 1 : -1)
          const segVBase = bandE[b]
          for (let s = 0; s < SEG; s++) {
            segVBuf[s] = Math.min(
              1,
              segVBase * (0.6 + 0.4 * Math.sin(s * 1.3 + t * (1 + b * 0.25))),
            )
          }
          ctx.strokeStyle = arcColors[b]
          for (let lvl = 0; lvl < LEVELS; lvl++) {
            const v = (lvl + 0.5) / LEVELS
            let any = false
            ctx.beginPath()
            for (let s = 0; s < SEG; s++) {
              if (Math.min(LEVELS - 1, (segVBuf[s] * LEVELS) | 0) !== lvl) continue
              const a0 = (s / SEG) * TAU + rot
              const span = (TAU / SEG) * 0.62
              const rr = Rb + segVBuf[s] * S * 0.008
              ctx.moveTo(cx + Math.cos(a0) * rr, cy + Math.sin(a0) * rr)
              ctx.arc(cx, cy, rr, a0, a0 + span)
              any = true
            }
            if (any) {
              ctx.globalAlpha = Math.min(1, (0.05 + v * 0.44) * I)
              ctx.lineWidth = 1 + v * 2
              ctx.stroke()
            }
          }
        }
        ctx.globalAlpha = 1

        /* ---- kick ripples (die at 0.7·S — inside the smaller canvas box) ---- */
        for (let i = ripples.length - 1; i >= 0; i--) {
          const rp = ripples[i]
          rp.r += S * 0.38 * dt
          rp.a *= Math.pow(0.18, dt)
          if (rp.a < 0.02 || rp.r > S * 0.7) {
            ripples.splice(i, 1)
            continue
          }
          ctx.strokeStyle = `rgba(205,218,240,${Math.min(1, rp.a * I).toFixed(3)})`
          ctx.lineWidth = 1.5
          ctx.beginPath()
          ctx.arc(cx, cy, rp.r, 0, TAU)
          ctx.stroke()
        }
        ctx.globalAlpha = 1
      } catch (e) {
        if (now - lastErr > 2000) {
          lastErr = now
          console.warn('halo frame dropped:', e)
        }
      }
    }
    /* stability: park while hidden, and ALWAYS re-arm on return (even if
       the hidden branch never ran — that asymmetry is what let a dropped
       rAF stay dead). pageshow covers reload's post-load tick; the 2s
       self-heal catches every remaining way the loop could go quiet. */
    const rearm = () => {
      cancelAnimationFrame(raf)
      last = performance.now()
      lastDrawAt = performance.now()
      raf = requestAnimationFrame(draw)
    }
    const onVis = () => {
      if (document.hidden) cancelAnimationFrame(raf)
      else rearm()
    }
    const onShow = () => {
      if (!document.hidden) rearm()
    }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('pageshow', onShow)
    const heal = window.setInterval(() => {
      if (document.hidden) return
      if (!vw || !vh) resize() /* layout never measured — re-measure even if RO missed it */
      if (performance.now() - lastDrawAt > 1500) {
        resize()
        rearm()
      }
    }, 2000)

    let raf = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(raf)
      cancelAnimationFrame(resizeRaf)
      window.clearTimeout(resizeTimer)
      window.clearInterval(heal)
      window.removeEventListener('resize', schedule)
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('pageshow', onShow)
      ro.disconnect()
    }
  }, [])

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
      style={{ width: '150%', height: '150%', contain: 'paint' }}
    />
  )
}
