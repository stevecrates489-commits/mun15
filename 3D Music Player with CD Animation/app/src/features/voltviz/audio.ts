/**
 * The audio frame VoltViz's visuals expect, built from the player's own
 * analyser.
 *
 * The visuals were written against VoltViz's engine, which hands them a
 * spectrum, a waveform, named bands, a level and a beat tracker every frame.
 * The player already has the first two — its deck's `AnalyserNode` — so this
 * file derives the rest from it: bands from the spectrum, level from the
 * waveform, and a light energy tracker for the beat and the onsets.
 *
 * ONE analyser, read once a frame. The previous version gave every requested
 * FFT size its own child `AnalyserNode` hanging off the deck's analyser, and
 * that is what made some visuals react while others sat still: a fan-out of
 * analysers is only as good as every one of those nodes staying fed and
 * staying bound to the analyser the engine currently feeds. A node created
 * before the deck re-pointed its graph (a track swap, the radio attaching its
 * own capture stream) read a dead branch for ever, and whichever visual asked
 * for that size simply froze. There is now a single tap — large enough to
 * resolve the bass, unsmoothed so this file owns the smoothing — sampled once
 * per frame, and `spectrum()` / `waveform()` resample that one read to the
 * size the visual asks for. Nothing a visual requests can miss the audio.
 *
 * Nothing here touches the audio graph's output: an analyser is a pass-through
 * node, and the tap runs out through a gain of NOTHING to the destination so
 * the graph is walked and there is data to read.
 */

import type { AudioFrame, Bands, BeatInfo, FftSize, OnsetInfo } from './audio-types'

const RANGES: [keyof Bands, number, number][] = [
  ['sub', 20, 60],
  ['bass', 60, 250],
  ['lowMid', 250, 500],
  ['mid', 500, 2000],
  ['highMid', 2000, 6000],
  ['treble', 6000, 16000],
]

const EMPTY_BANDS: Bands = { sub: 0, bass: 0, lowMid: 0, mid: 0, highMid: 0, treble: 0 }

/** Bins of the one tap: 4096 (8192-point FFT) — ~6 Hz at 48 kHz, fine enough
 *  to resolve sub-bass when a visual asks for a 512-point spectrum. */
const TAP_FFT = 8192

interface Tap {
  base: AnalyserNode
  analyser: AnalyserNode
  freq: Uint8Array<ArrayBuffer>
  wave: Float32Array<ArrayBuffer>
}

/** One resampled spectrum, kept per (fftSize, smoothing) for the frame. */
interface SpectrumSlot {
  /** the frame this slot was computed for — a second read in the same frame
   *  must not smooth the values twice */
  token: number
  out: Uint8Array<ArrayBuffer>
  raw: Uint8Array<ArrayBuffer>
}

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v))

/**
 * One source of frames for every mounted visual. Held across style changes so
 * a switch does not rebuild (or re-connect) any analyser.
 */
export interface AudioFrameSource {
  read(now: number): AudioFrame
  /** Forget the tap — the deck's analyser belongs to a graph that is gone. */
  reset(): void
}

export function createAudioFrameSource(getAnalyser: () => AnalyserNode | null): AudioFrameSource {
  let tap: Tap | null = null
  let sink: GainNode | null = null
  /** bumped by every `read()`: everything derived is computed once per frame */
  let token = 0
  let sampledToken = -1
  const spectra = new Map<string, SpectrumSlot>()
  const floats = new Map<string, Float32Array<ArrayBuffer>>()

  /* the stereo pair — rebuilt when the analyser changes, like the tap */
  let splitterBase: AnalyserNode | null = null
  let leftTap: AnalyserNode | null = null
  let rightTap: AnalyserNode | null = null
  let leftBuf: Float32Array<ArrayBuffer> | null = null
  let rightBuf: Float32Array<ArrayBuffer> | null = null

  /* The one tap. Rebound whenever `getAnalyser()` hands back a different node:
     the engine builds its graph on the first play and again for a station, and
     a tap left on the old node reads silence for ever. */
  function ensureTap(base: AnalyserNode): Tap {
    if (tap && tap.base === base) return tap
    tap = null
    sink = null
    spectra.clear()
    floats.clear()
    splitterBase = null
    leftTap = null
    rightTap = null
    leftBuf = null
    rightBuf = null
    sampledToken = -1

    const node = base.context.createAnalyser()
    node.fftSize = TAP_FFT
    /* unsmoothed: the smoothing a visual asks for is applied per slot below,
       so two visuals asking for different amounts at the same size both get
       what they asked for instead of overwriting one node's setting */
    node.smoothingTimeConstant = 0
    const mute = base.context.createGain()
    mute.gain.value = 0
    mute.connect(base.context.destination)
    sink = mute
    try {
      base.connect(node)
      node.connect(mute)
    } catch {
      /* a closed context — the frame reads as silence */
    }
    tap = {
      base,
      analyser: node,
      freq: new Uint8Array(node.frequencyBinCount),
      wave: new Float32Array(node.fftSize),
    }
    return tap
  }

  /** Pull the tap's buffers once per frame, however many visuals ask. */
  function sample(t: Tap) {
    if (sampledToken === token) return
    sampledToken = token
    t.analyser.getByteFrequencyData(t.freq)
    t.analyser.getFloatTimeDomainData(t.wave)
  }

  function spectrum(fftSize: FftSize = 2048, smoothing = 0.8): Uint8Array {
    const base = getAnalyser()
    if (!base) return new Uint8Array(1)
    const t = ensureTap(base)
    sample(t)

    const bins = fftSize / 2
    const key = `${fftSize}:${smoothing}`
    let slot = spectra.get(key)
    if (!slot || slot.out.length !== bins) {
      slot = { token: -1, out: new Uint8Array(bins), raw: new Uint8Array(bins) }
      spectra.set(key, slot)
    }
    if (slot.token === token) return slot.out

    /* resample: each output bin takes the loudest tap bin inside its band, so
       a coarse spectrum keeps its peaks instead of averaging them away */
    const src = t.freq
    const srcBins = src.length
    for (let j = 0; j < bins; j++) {
      const from = Math.floor((j * srcBins) / bins)
      const to = Math.max(from + 1, Math.floor(((j + 1) * srcBins) / bins))
      let peak = 0
      for (let i = from; i < to && i < srcBins; i++) if (src[i] > peak) peak = src[i]
      slot.raw[j] = peak
    }

    /* the analyser's own smoothing constant, applied per output bin: `out`
       doubles as the previous frame's value */
    const k = clamp(1 - smoothing, 0.01, 1)
    for (let j = 0; j < bins; j++) slot.out[j] += (slot.raw[j] - slot.out[j]) * k

    slot.token = token
    return slot.out
  }

  /** The newest `fftSize` samples of the time-domain buffer, -1..1. */
  function floatWave(fftSize: FftSize): Float32Array {
    const base = getAnalyser()
    if (!base) return new Float32Array(1)
    const t = ensureTap(base)
    sample(t)
    const key = String(fftSize)
    let out = floats.get(key)
    if (!out || out.length !== fftSize) {
      out = new Float32Array(fftSize)
      floats.set(key, out)
    }
    const from = Math.max(0, t.wave.length - fftSize)
    for (let i = 0; i < fftSize; i++) out[i] = t.wave[from + i] ?? 0
    return out
  }

  function waveformFloat(fftSize: FftSize = 2048): Float32Array {
    return floatWave(fftSize)
  }

  function waveform(fftSize: FftSize = 2048): Uint8Array {
    const src = floatWave(fftSize)
    const out = new Uint8Array(src.length)
    for (let i = 0; i < src.length; i++) out[i] = Math.round(128 + clamp(src[i], -1, 1) * 127)
    return out
  }

  function stereoFrame(): { left: Float32Array; right: Float32Array } {
    const base = getAnalyser()
    if (!base) return { left: new Float32Array(2048), right: new Float32Array(2048) }
    ensureTap(base)
    if (splitterBase !== base) {
      splitterBase = base
      leftTap = null
      rightTap = null
      leftBuf = null
      rightBuf = null
      try {
        const split = base.context.createChannelSplitter(2)
        const l = base.context.createAnalyser()
        const r = base.context.createAnalyser()
        for (const node of [l, r]) {
          node.fftSize = 2048
          node.smoothingTimeConstant = 0.8
        }
        split.connect(l, 0)
        split.connect(r, 1)
        l.connect(sink ?? base.context.destination)
        r.connect(sink ?? base.context.destination)
        leftTap = l
        rightTap = r
        leftBuf = new Float32Array(2048)
        rightBuf = new Float32Array(2048)
      } catch {
        /* a mono deck: the two channels read the same */
      }
    }
    if (leftTap && rightTap && leftBuf && rightBuf) {
      leftTap.getFloatTimeDomainData(leftBuf)
      rightTap.getFloatTimeDomainData(rightBuf)
      return { left: leftBuf, right: rightBuf }
    }
    const mono = floatWave(2048)
    return { left: mono, right: mono }
  }

  function bandsOf(bytes: Uint8Array, sampleRate: number): Bands {
    const nyquist = sampleRate / 2
    const bins = bytes.length
    const out: Bands = { ...EMPTY_BANDS }
    for (const [name, lo, hi] of RANGES) {
      const from = Math.max(0, Math.round((lo / nyquist) * bins))
      const to = Math.min(bins, Math.round((hi / nyquist) * bins))
      if (to <= from) continue
      let sum = 0
      for (let i = from; i < to; i++) sum += bytes[i]
      out[name] = clamp(sum / (to - from) / 255)
    }
    return out
  }

  let startedAt = performance.now()
  let lastAt = startedAt
  let frameTime = 0
  let frameDt = 0

  /* the beat tracker: bass energy against its own moving average */
  let energyAvg = 0
  let energyVar = 0
  let sinceBeat = 99
  let period = 0.5
  let barBeat = 0
  let beatCount = 0
  let beatWasHot = false
  let accentEnv = 0
  const onsets = {
    kick: { since: 99, envelope: 0, strength: 0 },
    snare: { since: 99, envelope: 0, strength: 0 },
    hat: { since: 99, envelope: 0, strength: 0 },
  }
  const onsetAvg = { kick: 0.04, snare: 0.02, hat: 0.01 }

  function trackBeat(bass: number, level: number, dt: number): BeatInfo {
    energyAvg += (bass - energyAvg) * Math.min(1, dt * 4)
    energyVar += (Math.abs(bass - energyAvg) - energyVar) * Math.min(1, dt * 2)
    sinceBeat += dt
    const threshold = energyAvg + Math.max(0.045, energyVar * 1.6)
    const hot = bass > threshold && bass > 0.08 && sinceBeat > 0.16
    let isBeat = false
    let strength = 0
    if (hot && !beatWasHot) {
      isBeat = true
      strength = clamp(((bass - threshold) / Math.max(threshold, 0.001)) * 0.6 + 0.45)
      if (sinceBeat < 1.8) period += (sinceBeat - period) * 0.25
      sinceBeat = 0
      beatCount += 1
      barBeat = beatCount % 4
    }
    beatWasHot = hot
    accentEnv = Math.max(0, accentEnv - dt * 3)
    if (!isBeat && level > 0.16 && sinceBeat > 0.4) accentEnv = Math.max(accentEnv, 0.3 * clamp(level * 2))
    return {
      isBeat,
      count: beatCount,
      barBeat,
      barKnown: false,
      downbeat: false,
      bpm: period > 0.15 ? 60 / period : 0,
      tempo: period > 0.15 ? 60 / period : 0,
      divisor: 1,
      confidence: period > 0.15 && period < 1.2 ? 0.6 : 0,
      strength,
      accent: accentEnv,
      phase: clamp(sinceBeat / Math.max(period, 0.15)),
      sinceBeat,
      period,
    }
  }

  function trackOnset(kind: keyof typeof onsets, value: number, dt: number): OnsetInfo {
    const avg = (onsetAvg[kind] += (value - onsetAvg[kind]) * Math.min(1, dt * 5))
    const state = onsets[kind]
    state.since += dt
    state.envelope = Math.max(0, state.envelope - dt * (1000 / 150))
    if (value > avg * 1.6 + 0.02 && state.since > 0.08) {
      state.envelope = 1
      state.since = 0
      state.strength = clamp(value / Math.max(avg, 0.001), 0, 3)
      return { hit: true, since: 0, envelope: 1, strength: state.strength }
    }
    return { hit: false, since: state.since, envelope: state.envelope, strength: state.strength }
  }

  function reset() {
    tap = null
    sink = null
    spectra.clear()
    floats.clear()
    splitterBase = null
    leftTap = null
    rightTap = null
    leftBuf = null
    rightBuf = null
    sampledToken = -1
    startedAt = performance.now()
  }

  return {
    reset,
    read(now: number): AudioFrame {
      const base = getAnalyser()
      const sampleRate = base?.context.sampleRate ?? 48000
      frameTime = (now - startedAt) / 1000
      frameDt = clamp((now - lastAt) / 1000, 0, 0.1)
      lastAt = now
      token += 1

      const bytes = spectrum(2048, 0.8)
      const bands = bandsOf(bytes, sampleRate)
      const wave = floatWave(2048)
      let sum = 0
      let peak = 0
      for (let i = 0; i < wave.length; i++) {
        const v = wave[i]
        sum += v * v
        const a = Math.abs(v)
        if (a > peak) peak = a
      }
      const rms = Math.sqrt(sum / Math.max(1, wave.length))
      const level = { rms, peak }
      const beat = trackBeat(bands.sub * 0.5 + bands.bass * 0.5, rms, frameDt)
      const kick = trackOnset('kick', bands.sub * 0.6 + bands.bass * 0.4, frameDt)
      const snare = trackOnset('snare', bands.mid * 0.6 + bands.highMid * 0.4, frameDt)
      const hat = trackOnset('hat', bands.treble, frameDt)

      const frame: AudioFrame = {
        time: frameTime,
        dt: frameDt,
        sampleRate,
        spectrum: (options) => spectrum(options?.fftSize ?? 2048, options?.smoothing ?? 0.8),
        waveform: (options) => waveform(options?.fftSize ?? 2048),
        waveformFloat: (options) => waveformFloat(options?.fftSize ?? 2048),
        stereo: stereoFrame,
        bands,
        level,
        beat,
        onsets: { kick, snare, hat },
        silent: !base || peak < 0.001,
        style: 'auto',
        gain: 1,
        autoGain: false,
        analysis: { fps: frameDt > 0 ? 1 / frameDt : 0 },
        engine: {
          host: 'scriptprocessor',
          neural: 'off',
          neuralMs: 0,
          latency: 0,
          history: {
            phase: new Float32Array(0),
            kick: new Float32Array(0),
            threshold: new Float32Array(0),
            beats: new Uint8Array(0),
          },
        },
      }
      return frame
    },
  }
}
