import { createWorkletTap } from './worklet.ts'

/**
 * The samples the visualiser hears.
 *
 * A visualiser needs the waveform, not the notes: the engine wants a stream of
 * interleaved samples it can turn into a spectrum, a beat and a waveform
 * itself. Two sources have to feed it, and they are not the same problem:
 *
 *   LOCAL SONGS   the player's own Web Audio graph. The master analyser sits
 *                 in the chain already, so the samples are simply read out of
 *                 it. No trouble at all.
 *
 *   RADIO         a plain <audio> element, deliberately kept OUTSIDE the Web
 *                 Audio graph — routing a cross-origin stream into that graph
 *                 produces silence, which would mute the station. So the
 *                 radio's samples can only be read from a SECOND element
 *                 loaded with `crossorigin`, and that only works on stations
 *                 that send CORS headers. On the others there is no waveform
 *                 to be had, and the visualiser says so plainly rather than
 *                 showing a frozen picture.
 *
 * ── Why the samples are counted ────────────────────────────────────────
 *
 * The analyser hands over its LAST fftSize samples every time it is read, so
 * reading it twice in a frame yields the same window twice. Pushing that
 * window into the engine twice would analyse the same audio twice, and
 * pushing it while skipping the gap would analyse a hole. So the tap counts
 * the samples it has already handed over and pushes only what is new.
 *
 * That counting is the whole of this file's cleverness, and it is kept
 * separate from the DOM so it can be tested on its own.
 */

/** how many samples the engine is given per push */
export const PUSH_SAMPLES = 1024
/** the analyser's window — big enough to cover a frame at 44.1kHz */
export const TAP_FFT = 2048
/// how many batches from the audio thread may be waiting at once
const MAX_QUEUED_BATCHES = 24


export interface PcmChunk {
  /** interleaved samples, -1..1 */
  samples: Float32Array<ArrayBuffer>
  /** how many sample FRAMES (a frame is one sample of every channel) */
  frames: number
  /** channels in `samples` */
  channels: number
}

/**
 * Hands out each sample exactly once.
 *
 * The source is a ROLLING WINDOW: every read returns the most recent
 * `window` samples, and the window slides by however many samples arrived in
 * the meantime. So the new samples are always at the END of the window, and
 * how many there are comes from the audio clock — how long the source's own
 * timeline has moved since the last read.
 *
 * That is the honest way round. The tempting alternative — working out the
 * slide by matching the new window against the old one — is a search over
 * every possible shift, and it is ambiguous exactly when it matters: silence
 * matches at every shift.
 */
export class PcmTape {
  /** how many channels the samples carry */
  readonly channels: number
  /** samples that have arrived but not yet been handed over */
  private pending = 0

  constructor(_window: number, channels: number) {
    this.channels = Math.max(1, channels)
  }

  /**
   * The source's timeline moved on. Note how many samples that was.
   *
   * `elapsedSeconds` is the gap since the last read, and `sampleRate` the
   * rate the source runs at — the two together give the sample count
   * exactly, because the audio clock IS the sample clock.
   */
  advance(elapsedSeconds: number, sampleRate: number): number {
    if (!Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0) return this.pending
    this.pending += Math.round(elapsedSeconds * sampleRate)
    return this.pending
  }

  /**
   * Take the samples that have not been handed over yet.
   *
   * `source` is the most recent window of samples per channel, interleaved.
   * Returns null when there is nothing new — which is the normal case when
   * the source is slower than the frame rate.
   */
  take(source: Float32Array<ArrayBufferLike>): PcmChunk | null {
    const perChannel = Math.floor(source.length / this.channels)
    if (perChannel <= 0) return null
    /* more arrived than the window holds: the oldest of them are gone for
       good, and what is left is the whole window */
    const count = Math.min(this.pending, perChannel)
    if (count <= 0) return null

    const out = new Float32Array(count * this.channels)
    const start = (perChannel - count) * this.channels
    out.set(source.subarray(start, start + out.length))
    this.pending -= count
    return { samples: out, frames: count, channels: this.channels }
  }

  /** the samples handed over so far */
  get pushedFrames(): number {
    return this.pending
  }
}

/**
 * The local player's own graph.
 *
 * The master analyser is already in the chain (gain -> analyser ->
 * destination) with an fftSize of 512, which is too small to cover a frame
 * at 48kHz: 512 samples is 10.7ms and a frame is 16.7ms, so the tap would
 * fall behind and the engine would starve.
 *
 * The engine's analyser is NOT resized. Its fftSize decides how many bins
 * the BPM visualiser sees, and doubling it would quietly change what that
 * detects. Instead the tap hangs a SECOND analyser off the first one — an
 * analyser passes its input through untouched, so the branch carries the same
 * signal while having a window of its own.
 */
export class LocalPcmTap {
  private tape: PcmTape
  /** the worklet sends one channel, so it counts on its own tape */
  private monoTape: PcmTape
  private buffer: Float32Array<ArrayBuffer>
  private source: AnalyserNode | null = null
  private tap: AnalyserNode | null = null
  private worklet: AudioWorkletNode | null = null
  /** batches from the worklet, waiting to be handed over */
  private queued: Float32Array<ArrayBufferLike>[] = []
  private lastTime = -1

  constructor(channels = 2) {
    this.tape = new PcmTape(TAP_FFT, channels)
    this.monoTape = new PcmTape(TAP_FFT, 1)
    this.buffer = new Float32Array(TAP_FFT * channels)
  }

  /** attach to the player's master analyser */
  attach(analyser: AnalyserNode | null): void {
    if (this.source === analyser) return
    this.detach()
    this.source = analyser
    if (!analyser) return
    const ctx = analyser.context
    /* The worklet first: it is the one that does not miss anything. The
       analyser is the fallback for an engine without worklets. */
    void createWorkletTap(ctx, analyser, (samples) => {
      this.queued.push(samples)
    })
      .then(({ node }) => {
        /* the tap may have been replaced while the module was loading */
        if (this.source !== analyser) {
          try {
            node.disconnect()
          } catch {
            /* already gone */
          }
          return
        }
        this.worklet = node
        this.lastTime = -1
      })
      .catch(() => {
        this.attachAnalyser(analyser)
      })
  }

  /** the fallback: a second analyser, branched off the first */
  private attachAnalyser(analyser: AnalyserNode): void {
    try {
      const tap = analyser.context.createAnalyser()
      tap.fftSize = TAP_FFT
      tap.smoothingTimeConstant = 0
      analyser.connect(tap)
      /* The tap has to be PULLED: a node whose output goes nowhere is not
         processed, and an analyser that is not processed reads silence. So
         it is connected onwards — through a gain of nothing, because the
         sound has already gone to the speakers by way of the first
         analyser, and a second path would play it twice. */
      const mute = analyser.context.createGain()
      mute.gain.value = 0
      tap.connect(mute)
      mute.connect(analyser.context.destination)
      this.tap = tap
      this.lastTime = -1
    } catch {
      /* no branch: the tap stays blind, and the radio still works */
      this.tap = null
    }
  }

  private detach(): void {
    if (this.worklet) {
      try {
        this.worklet.disconnect()
      } catch {
        /* already gone */
      }
      this.worklet = null
    }
    if (this.tap) {
      try {
        this.source?.disconnect(this.tap)
        this.tap.disconnect()
      } catch {
        /* already gone */
      }
      this.tap = null
    }
    this.queued = []
    this.lastTime = -1
  }

  /** the samples that have not been handed over yet, or null */
  take(): PcmChunk | null {
    if (this.worklet) return this.takeFromWorklet()
    if (!this.tap) return null
    return this.takeFromAnalyser()
  }

  /** whole batches, straight from the audio thread */
  private takeFromWorklet(): PcmChunk | null {
    /* The queue is BOUNDED. If the main thread is busy the batches pile up,
       and an unbounded pile of Float32Arrays is exactly the sort of thing
       that makes a runtime collect its memory in a lump — a visible hitch
       every few seconds. The oldest batch is dropped instead: the engine
       wants the newest audio, not a backlog. */
    while (this.queued.length > MAX_QUEUED_BATCHES) this.queued.shift()
    const batch = this.queued.shift()
    if (!batch) return null
    /* the worklet sends one channel, so the tape that counts it counts
       single-channel samples */
    const rate = this.source?.context.sampleRate ?? 48_000
    /* the batches ARE the clock: the audio thread decides how much time has
       passed, so the count comes from the batch's own length */
    this.monoTape.advance(batch.length / rate, rate)
    return this.monoTape.take(batch)
  }

  /** pieces, read from the analyser on the main thread */
  private takeFromAnalyser(): PcmChunk | null {
    const a = this.tap
    if (!a) return null
    if (this.buffer.length !== a.fftSize * this.tape.channels) {
      this.buffer = new Float32Array(a.fftSize * this.tape.channels)
    }
    const ctx = a.context
    const now = ctx.currentTime
    if (this.lastTime < 0) {
      this.lastTime = now
      return null
    }
    const elapsed = now - this.lastTime
    this.lastTime = now
    this.tape.advance(elapsed, ctx.sampleRate)
    /* getFloatTimeDomainData is NOT smoothed — the smoothing constant only
       applies to the frequency data, so the waveform is the raw signal */
    a.getFloatTimeDomainData(this.buffer)
    return this.tape.take(this.buffer)
  }

  /** forget the position — used when the source changes under us */
  reset(): void {
    this.tape = new PcmTape(TAP_FFT, this.tape.channels)
    this.monoTape = new PcmTape(TAP_FFT, 1)
    this.lastTime = -1
  }
}

/**
 * A radio stream, read through a second element.
 *
 * The element that the user actually hears is never touched: it is
 * cross-origin without CORS, and routing THAT into an analyser would silence
 * the station. This is a private copy loaded with `crossorigin`, measured and
 * thrown away.
 */
export class RadioPcmTap {
  private el: HTMLAudioElement | null = null
  private ctx: AudioContext | null = null
  private source: MediaElementAudioSourceNode | null = null
  private analyser: AnalyserNode | null = null
  private tape: PcmTape
  private buffer: Float32Array<ArrayBuffer>
  private failed = false
  private lastTime = -1

  constructor(channels = 2) {
    this.tape = new PcmTape(TAP_FFT, channels)
    this.buffer = new Float32Array(TAP_FFT * channels)
  }

  /** why the tap is not working, for the panel to show */
  get error(): string | null {
    if (!this.failed) return null
    return 'THIS STATION DOES NOT ALLOW READING ITS AUDIO — NO VISUALS FOR IT'
  }

  /** start following a stream. Returns false when the station refuses CORS. */
  async start(url: string): Promise<boolean> {
    this.stop()
    if (!url) return false
    this.failed = false
    try {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext
      if (!Ctor) {
        this.failed = true
        return false
      }
      const el = new Audio()
      el.crossOrigin = 'anonymous'
      el.preload = 'auto'
      el.src = url
      /* NOT muted and NOT turned down: the element's own volume is applied
         BEFORE the source node takes its output, so silencing the element
         would silence the very analyser being read. The chain below is what
         keeps it inaudible. */
      el.muted = false
      el.volume = 1

      const ctx = new Ctor()
      await ctx.resume().catch(() => {})

      const source = ctx.createMediaElementSource(el)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = TAP_FFT
      analyser.smoothingTimeConstant = 0
      /* the element is muted, so this chain is measurement only */
      source.connect(analyser)
      /* a muted element still needs to be pulled by the graph */
      const mute = ctx.createGain()
      mute.gain.value = 0
      analyser.connect(mute)
      mute.connect(ctx.destination)

      this.el = el
      this.ctx = ctx
      this.source = source
      this.analyser = analyser

      await el.play().catch(() => {})
      /* a station without CORS fails the load — the element says so */
      const ok = await new Promise<boolean>((resolve) => {
        const done = (v: boolean) => resolve(v)
        const onError = () => done(false)
        el.addEventListener('error', onError, { once: true })
        window.setTimeout(() => done(true), 2500)
      })
      if (!ok) {
        this.failed = true
        this.stop()
        return false
      }
      return true
    } catch {
      this.failed = true
      this.stop()
      return false
    }
  }

  take(): PcmChunk | null {
    const a = this.analyser
    const ctx = this.ctx
    if (!a || !ctx || this.failed) return null
    if (this.buffer.length !== a.fftSize * this.tape.channels) {
      this.buffer = new Float32Array(a.fftSize * this.tape.channels)
    }
    /* the same clock trick as the local tap: the context's own time is the
       sample clock of the graph the element is feeding */
    const now = ctx.currentTime
    if (this.lastTime < 0) {
      this.lastTime = now
      return null
    }
    const elapsed = now - this.lastTime
    this.lastTime = now
    this.tape.advance(elapsed, ctx.sampleRate)
    a.getFloatTimeDomainData(this.buffer)
    return this.tape.take(this.buffer)
  }

  stop(): void {
    try {
      this.el?.pause()
      this.el?.removeAttribute('src')
      this.el?.load()
    } catch {
      /* already gone */
    }
    this.source?.disconnect()
    this.analyser?.disconnect()
    void this.ctx?.close().catch(() => {})
    this.el = null
    this.ctx = null
    this.source = null
    this.analyser = null
    this.tape = new PcmTape(TAP_FFT, this.tape.channels)
  }
}
