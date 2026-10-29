/**
 * The bridge to the visualiser engine.
 *
 * The engine itself is native — the MilkDrop renderer lives in the Rust
 * backend, on the GPU, in a window of its own. This module is the only
 * place that knows how to talk to it, so the rest of the app never has to
 * care whether the engine is running.
 *
 * Two directions cross the boundary, and they are not symmetric:
 *
 *   PCM    the samples, going OUT to the engine. These go as an INVOKE, not
 *          a channel: Tauri's channels run from the backend to the webview,
 *          so the audio has to travel the other way as a request. One small
 *          request a frame is fine — the reply is nothing and is never
 *          waited for.
 *
 *   FRAMES the rendered pixels, coming BACK in wallpaper mode, where the
 *          visuals are the app's own backdrop. That IS a channel, the
 *          direction it was made for. In window mode there is no frame
 *          channel at all — the engine draws straight to the screen.
 *
 * Both carry base64, because the IPC is JSON: a frame of 256x256 RGBA is
 * 262144 bytes, and as a JSON array of numbers it would be megabytes of text
 * before it even left the building. Base64 costs a third more and is a
 * single string.
 */

import { Channel, invoke } from '@tauri-apps/api/core'

export type VisualizerMode = 'off' | 'window' | 'wallpaper'

/**
 * Which set of semantics the engine runs under.
 *
 *   auto       the engine reads each preset and runs it under the semantics
 *              it was written for. This is the default, and it matters: an
 *              MD3 preset forced to run under MD2 semantics does not merely
 *              look wrong, it can hang the engine outright.
 *   milkdrop2  the original renderer's own behaviour — the "exact Winamp"
 *              look, and the per-vertex blend patterns that go with it.
 *              This is what a `.milk` preset wants.
 *   milkdrop3  MilkDrop 3: double presets, the MD3 blend patterns, the auto
 *              hard cuts and the composite-shader effects. This is what a
 *              `.milk2` preset wants.
 *   projectm   the reference implementation's behaviour.
 *
 * The engine is built around the choice, so switching it makes a new engine —
 * which the app does by starting the visualiser again.
 */
export type VisualizerCompat = 'auto' | 'milkdrop2' | 'milkdrop3' | 'projectm'

/** the samples on their way to the engine */
export interface PcmPacket {
  /** base64 of interleaved signed 16-bit samples, -32768..32767 */
  samples: string
  /** channels in the samples */
  channels: number
}

/** one rendered frame, on its way back */
export interface VisualizerFrame {
  width: number
  height: number
  /** base64 of RGBA8, row 0 = the top row */
  data: string
}

export interface VisualizerPreset {
  /** the file's name, without the extension */
  name: string
  /** the full path, which is what the engine loads */
  path: string
}

export interface VisualizerStatus {
  running: boolean
  mode: VisualizerMode
  /** the preset on screen */
  preset: string | null
  /** which semantics the engine is running: milkdrop2, milkdrop3, projectm */
  compat: string | null
  /** the frame rate the engine is actually achieving */
  fps: number
  /** why it is not running, when it is not */
  error: string | null
  /** how many presets were found in the preset folder */
  presetCount: number
  /** which piece of hardware is drawing the pictures */
  adapter?: string | null
  /** how long the CPU half of a frame takes — the preset's equations */
  cpuMs?: number
  /** how long the wait for the GPU takes — the pixels */
  gpuMs?: number
  /** the size the picture is drawn at (the window stretches it) */
  renderWidth?: number
  renderHeight?: number
  /** the size of the window the picture is stretched into */
  windowWidth?: number
  windowHeight?: number
}


const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/* Two base64 characters for every twelve bits. A table of 4096 turns the
   conversion into two lookups and a concatenation per three bytes, where the
   obvious version — one huge `String.fromCharCode.apply` — allocates an
   array the size of the buffer and does the same work dozens of times a
   second on the main thread. That is enough to make the interface stutter,
   which is the very thing this is meant to avoid. */
const PAIRS: string[] = (() => {
  const out: string[] = new Array(4096)
  for (let i = 0; i < 4096; i++) {
    out[i] = ALPHABET[i >> 6] + ALPHABET[i & 63]
  }
  return out
})()

/**
 * base64 for a byte buffer.
 */
export function toBase64(bytes: Uint8Array): string {
  const parts: string[] = []
  const whole = bytes.length - (bytes.length % 3)
  let i = 0
  for (; i < whole; i += 3) {
    const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2]
    parts.push(PAIRS[(n >> 12) & 0xfff], PAIRS[n & 0xfff])
  }
  const rest = bytes.length - whole
  if (rest === 1) {
    /* eight bits become two characters and two padding marks */
    const b = bytes[i]
    parts.push(ALPHABET[b >> 2], ALPHABET[(b & 3) << 4], '==')
  } else if (rest === 2) {
    /* sixteen bits become three characters and one padding mark */
    const b0 = bytes[i]
    const b1 = bytes[i + 1]
    parts.push(
      ALPHABET[b0 >> 2],
      ALPHABET[((b0 & 3) << 4) | (b1 >> 4)],
      ALPHABET[(b1 & 15) << 2],
      '=',
    )
  }
  return parts.join('')
}

/** the samples, as the engine wants them: signed 16-bit, interleaved */
export function encodePcm(samples: Float32Array, channels: number): PcmPacket {
  const out = new Int16Array(samples.length)
  for (let i = 0; i < samples.length; i++) {
    const v = samples[i]
    /* the engine's scale: full scale is 32768, and anything past it is
       clipped rather than wrapped — a wrapped sample is a loud click */
    const scaled = v < -1 ? -1 : v > 1 ? 1 : v
    out[i] = Math.round(scaled * 32767)
  }
  return { samples: toBase64(new Uint8Array(out.buffer)), channels }
}

/* ── the commands ─────────────────────────────────────────────────────── */

export const visualizerStatus = () =>
  invoke<VisualizerStatus>('visualizer_status')

export const visualizerStart = (
  mode: Exclude<VisualizerMode, 'off'>,
  width: number,
  height: number,
  sampleRate: number,
  compat: VisualizerCompat,
) => invoke<void>('visualizer_start', { mode, width, height, sampleRate, compat })

export const visualizerStop = () => invoke<void>('visualizer_stop')

/**
 * Hand the engine a block of samples.
 *
 * A request rather than a channel, because the audio travels towards the
 * backend and Tauri's channels only run the other way. Fire and forget:
 * the engine has nothing to say about a block of samples.
 */
export const visualizerPushPcm = (samples: string, channels: number) =>
  invoke<void>('visualizer_pcm', { samples, channels })

/**
 * Switch between the floating window and the app's own backdrop.
 *
 * The frame channel is always there, even in window mode: the toolkit only
 * knows how to read a bare channel out of a request, and the engine simply
 * never writes to it when it is drawing to a window of its own.
 */
export const visualizerSetMode = (
  mode: Exclude<VisualizerMode, 'off'>,
  frames: Channel<VisualizerFrame>,
) => invoke<void>('visualizer_set_mode', { mode, frames })

export const visualizerListPresets = (dir: string) =>
  invoke<VisualizerPreset[]>('visualizer_list_presets', { dir })

export const visualizerLoadPreset = (path: string) =>
  invoke<void>('visualizer_load_preset', { path })

export const visualizerPresetStep = (delta: number) =>
  invoke<void>('visualizer_preset_step', { delta })

export const visualizerSetTextureDir = (dir: string) =>
  invoke<void>('visualizer_set_texture_dir', { dir })

export const visualizerSetSize = (width: number, height: number) =>
  invoke<void>('visualizer_set_size', { width, height })

/** where the engine's log is, so the panel can say so */
export const visualizerLogPath = () => invoke<string>('visualizer_log_path')

/** write a line into the engine's log, from the interface's side */
export const visualizerLog = (line: string) =>
  invoke<void>('visualizer_log', { line })

/** is the native side there at all? — the app also runs in a plain browser */
export const hasNativeEngine = (): boolean =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
