/**
 * Hearing where a song ends.
 *
 * The karaoke project decides a song has finished by watching the LEVEL drop
 * far below the song's own for a moment — a fade-out, or the pause between
 * songs. Over ninety minutes of whole songs that signal fired only in a
 * song's last few seconds and caught every pause between songs, while a
 * "the sound changed" detector could not tell a verse from a chorus at all.
 *
 * This is that detector, fed from the stream instead of a microphone.
 *
 * ── Why the second element ──────────────────────────────────────────────
 *
 * A level can only be read through the Web Audio graph, and a media element
 * whose media was loaded cross-origin WITHOUT CORS produces silence when it
 * is routed into that graph. The element the user hears is therefore never
 * touched: routing it in could mute the radio outright, and the radio is
 * already the fragile part of this app.
 *
 * So a SECOND element loads the same stream with `crossorigin` set, and only
 * that one is routed into the analyser. If the station refuses CORS the
 * second element errors out, the detector goes quiet, and the radio keeps
 * playing exactly as before. The cost is a second connection to the same
 * mount — which is what any second listener does anyway.
 *
 * Nothing in here is allowed to throw at the caller: a detector that breaks
 * must never break playback.
 */

/* The detector's constants, ported from the reference implementation:
   a 0.5s frame, a 20s median as the song's own level, 30dB below it for
   1.5s straight, and a 25s cooldown so one long quiet passage cannot fire
   it twice. */
const FRAME_MS = 500
const LEVEL_FRAMES = 40
const GAP_DB = 30
const GAP_FRAMES = 3
const DEBOUNCE_MS = 25_000
const WARMUP_FRAMES = 12
const EPS = 1e-6

/**
 * The level detector itself — pure arithmetic, no DOM.
 *
 * Feed it one frame's RMS and it says when a song has probably ended.
 */
export class EndDetector {
  private levels: number[] = []
  private gapRun = 0
  private frames = 0
  private lastSignal = -1e9

  /** A new song: its own level is the new baseline. */
  reset(): void {
    this.levels = []
    this.gapRun = 0
    this.frames = 0
  }

  /**
   * Add one frame. Returns true when the song probably ended.
   *
   * The baseline is the MEDIAN of the recent frames, not the mean: a mean
   * is dragged around by the very silence being looked for, and a median is
   * not. Quiet frames are never added to the baseline for the same reason.
   */
  feed(rms: number, now: number): boolean {
    const db = 20 * Math.log10(Math.max(rms, EPS))
    this.frames += 1
    let signal = false
    if (this.frames > WARMUP_FRAMES && this.levels.length >= WARMUP_FRAMES) {
      /* named `base`, not `median`: a local called `median` would shadow the
         helper below, and the call inside its own initialiser is a
         temporal-dead-zone crash */
      const base = median(this.levels)
      this.gapRun = db < base - GAP_DB ? this.gapRun + 1 : 0
      if (this.gapRun >= GAP_FRAMES && now - this.lastSignal >= DEBOUNCE_MS) {
        signal = true
      }
    }
    if (this.gapRun === 0) {
      this.levels.push(db)
      if (this.levels.length > LEVEL_FRAMES) this.levels.shift()
    }
    if (signal) {
      this.lastSignal = now
      this.gapRun = 0
    }
    return signal
  }
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

export interface LevelMonitorOptions {
  /** the song was heard to end, at this wall-clock time */
  onEnd: (atMs: number) => void
}

/**
 * Watches the stream's level through a private second element.
 *
 * Every failure path leads to the same place: the detector stops and the
 * radio is unaffected.
 */
export class RadioLevelMonitor {
  private opts: LevelMonitorOptions
  private el: HTMLAudioElement | null = null
  private ctx: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private timer = 0
  private detector = new EndDetector()
  private samples: Float32Array<ArrayBuffer> | null = null
  private sumSq = 0
  private count = 0
  private frameStart = 0
  private dead = false

  constructor(opts: LevelMonitorOptions) {
    this.opts = opts
  }

  /** Is the detector actually able to see anything? */
  get active(): boolean {
    return !this.dead && !!this.analyser
  }

  /**
   * Begin watching a stream. Resolves as soon as the attempt is made — it
   * never waits for the level to arrive, and never fails.
   */
  start(url: string): void {
    this.stop()
    if (!url) return
    this.dead = false
    try {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext
      if (!Ctor) {
        this.dead = true
        return
      }
      const el = new Audio()
      /* the whole point: this element, and only this element, is allowed to
         be cross-origin */
      el.crossOrigin = 'anonymous'
      el.preload = 'auto'
      el.src = url
      el.addEventListener('error', () => {
        /* the station refused CORS — the detector is blind, the radio is not */
        this.dead = true
      })

      const ctx = new Ctor()
      const source = ctx.createMediaElementSource(el)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 2048
      analyser.smoothingTimeConstant = 0
      /* silence out of the graph: this element exists to be measured, not
         heard — the user already has the real one */
      const mute = ctx.createGain()
      mute.gain.value = 0
      source.connect(analyser)
      analyser.connect(mute)
      mute.connect(ctx.destination)

      this.el = el
      this.ctx = ctx
      this.analyser = analyser
      this.samples = new Float32Array(analyser.fftSize)

      void ctx.resume().catch(() => {})
      /* autoplay may refuse the first attempt; the retry loop tries again */
      void el.play().catch(() => {})

      this.frameStart = Date.now()
      this.timer = window.setInterval(() => this.tick(), 50)
    } catch {
      /* anything at all goes wrong: no detector, no harm */
      this.dead = true
      this.teardown()
    }
  }

  /** A new song: its own level becomes the new baseline. */
  reset(): void {
    this.detector.reset()
    this.sumSq = 0
    this.count = 0
  }

  stop(): void {
    if (this.timer) {
      window.clearInterval(this.timer)
      this.timer = 0
    }
    this.teardown()
  }

  private teardown(): void {
    try {
      this.el?.pause()
    } catch {
      /* already gone */
    }
    try {
      this.el?.removeAttribute('src')
      this.el?.load()
    } catch {
      /* already gone */
    }
    try {
      this.el = null
      this.analyser = null
      void this.ctx?.close().catch(() => {})
      this.ctx = null
    } catch {
      /* already gone */
    }
    this.samples = null
    this.sumSq = 0
    this.count = 0
  }

  private tick(): void {
    const analyser = this.analyser
    const ctx = this.ctx
    const el = this.el
    const samples = this.samples
    if (this.dead || !analyser || !ctx || !el || !samples) return

    /* A suspended context pulls no audio, and a paused element has none to
       pull. Either way the readings would be silence — and silence is the
       very thing being looked for, so a blind detector must stay quiet
       rather than report an end that never happened. */
    if (ctx.state !== 'running') {
      void ctx.resume().catch(() => {})
      return
    }
    if (el.paused || el.readyState < 2) {
      void el.play().catch(() => {})
      return
    }

    try {
      analyser.getFloatTimeDomainData(samples)
    } catch {
      this.dead = true
      return
    }

    let sum = 0
    for (let i = 0; i < samples.length; i++) {
      const v = samples[i]
      sum += v * v
    }
    this.sumSq += sum
    this.count += samples.length

    const now = Date.now()
    if (now - this.frameStart < FRAME_MS) return
    const rms = this.count > 0 ? Math.sqrt(this.sumSq / this.count) : 0
    this.sumSq = 0
    this.count = 0
    this.frameStart = now

    if (this.detector.feed(rms, now)) {
      this.opts.onEnd(now)
    }
  }
}
