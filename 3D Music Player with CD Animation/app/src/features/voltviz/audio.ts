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
 * Nothing here touches the audio graph's output: an analyser is a pass-through
 * node, so the child analysers used for the larger FFT sizes are fed from the
 * deck's analyser and go nowhere.
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

interface Tap {
  analyser: AnalyserNode
  bytes: Uint8Array<ArrayBuffer>
  wave: Uint8Array<ArrayBuffer>
  floats: Float32Array<ArrayBuffer>
}

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v))

/**
 * One source of frames for every mounted visual. Held across style changes so
 * a switch does not rebuild (or re-connect) any analyser.
 */
export interface AudioFrameSource {
  read(now: number): AudioFrame
  /** Forget the taps — the deck's analyser belongs to a graph that is gone. */
  reset(): void
}

export function createAudioFrameSource(getAnalyser: () => AnalyserNode | null): AudioFrameSource {
  const spectrumTaps = new Map<string, Tap>()
  const waveformTaps = new Map<string, Tap>()
  let stereo: { left: Float32Array; right: Float32Array } | null = null
  let splitter: ChannelSplitterNode | null = null
  let leftTap: Tap | null = null
  let rightTap: Tap | null = null
  let sink: GainNode | null = null

  /* A node whose output goes nowhere is never processed — an analyser that is
     never pulled reads silence, which is exactly how the deck's own comment
     puts it. Every tap added here therefore runs through one gain of NOTHING
     out to the speakers, so the graph is walked and the tap has data to read. */
  function sinkFor(base: AnalyserNode): GainNode {
    if (sink) return sink
    const node = base.context.createGain()
    node.gain.value = 0
    node.connect(base.context.destination)
    sink = node
    return node
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

  function tapFor(map: Map<string, Tap>, base: AnalyserNode, fftSize: number, smoothing: number): Tap {
    const key = `${fftSize}:${smoothing}`
    const found = map.get(key)
    if (found) {
      found.analyser.smoothingTimeConstant = smoothing
      return found
    }
    const node = base.context.createAnalyser()
    node.fftSize = fftSize
    node.smoothingTimeConstant = smoothing
    try {
      base.connect(node)
      node.connect(sinkFor(base))
    } catch {
      /* a closed context — the frame reads as silence */
    }
    const tap: Tap = {
      analyser: node,
      bytes: new Uint8Array(node.frequencyBinCount),
      wave: new Uint8Array(node.fftSize),
      floats: new Float32Array(node.fftSize),
    }
    map.set(key, tap)
    return tap
  }

  function spectrum(fftSize: FftSize = 2048, smoothing = 0.8): Uint8Array {
    const base = getAnalyser()
    if (!base) return new Uint8Array(1)
    const tap = tapFor(spectrumTaps, base, fftSize, smoothing)
    tap.analyser.getByteFrequencyData(tap.bytes)
    return tap.bytes
  }

  function waveform(fftSize: FftSize = 2048, smoothing = 0.8): Uint8Array {
    const base = getAnalyser()
    if (!base) return new Uint8Array(1)
    const tap = tapFor(waveformTaps, base, fftSize, smoothing)
    tap.analyser.getByteTimeDomainData(tap.wave)
    return tap.wave
  }

  function waveformFloat(fftSize: FftSize = 2048, smoothing = 0.8): Float32Array {
    const base = getAnalyser()
    if (!base) return new Float32Array(1)
    const tap = tapFor(waveformTaps, base, fftSize, smoothing)
    tap.analyser.getFloatTimeDomainData(tap.floats)
    return tap.floats
  }

  function stereoFrame(): { left: Float32Array; right: Float32Array } {
    const base = getAnalyser()
    if (!base) return { left: new Float32Array(2048), right: new Float32Array(2048) }
    if (!splitter) {
      try {
        splitter = base.context.createChannelSplitter(2)
        base.connect(splitter)
        leftTap = tapFor(waveformTaps, base, 2048, 0.8)
        const l = base.context.createAnalyser()
        const r = base.context.createAnalyser()
        for (const node of [l, r]) {
          node.fftSize = 2048
          node.smoothingTimeConstant = 0.8
        }
        splitter.connect(l, 0)
        splitter.connect(r, 1)
        l.connect(sinkFor(base))
        r.connect(sinkFor(base))
        leftTap = {
          analyser: l,
          bytes: new Uint8Array(l.frequencyBinCount),
          wave: new Uint8Array(l.fftSize),
          floats: new Float32Array(l.fftSize),
        }
        rightTap = {
          analyser: r,
          bytes: new Uint8Array(r.frequencyBinCount),
          wave: new Uint8Array(r.fftSize),
          floats: new Float32Array(r.fftSize),
        }
        stereo = { left: leftTap.floats, right: rightTap.floats }
      } catch {
        /* a mono deck: the two channels read the same */
      }
    }
    if (stereo && leftTap && rightTap) {
      leftTap.analyser.getFloatTimeDomainData(leftTap.floats)
      rightTap.analyser.getFloatTimeDomainData(rightTap.floats)
      return stereo
    }
    const mono = waveformFloat()
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
    spectrumTaps.clear()
    waveformTaps.clear()
    stereo = null
    splitter = null
    leftTap = null
    rightTap = null
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

      const bytes = spectrum(2048, 0.8)
      const bands = bandsOf(bytes, sampleRate)
      const wave = waveformFloat(2048, 0.8)
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
        waveform: (options) => waveform(options?.fftSize ?? 2048, options?.smoothing ?? 0.8),
        waveformFloat: (options) => waveformFloat(options?.fftSize ?? 2048, options?.smoothing ?? 0.8),
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
