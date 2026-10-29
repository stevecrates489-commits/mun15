/* wallpaperPipeline.ts — client-side video wallpaper pipeline.
 *
 *   probe → plan → (convert) → poster → store → play
 *
 * Any container the browser can demux (mp4, webm, mkv, mov…) is normalized to
 * H.264/MP4 at the user's chosen size and fps, using WebCodecs via mediabunny.
 * Audio is dropped. Output is faststart (moov before mdat). Files are capped
 * at MAX_SECONDS so a wallpaper loops without dragging on. Everything runs in
 * the tab — no server, no upload, no ffmpeg.wasm.
 *
 * Public API:
 *   importWallpaper(file, opts)     full pipeline in one call
 *   WallpaperPlayer                 attaches to a <video>, reports real FPS
 *   store                           IndexedDB with in-memory fallback
 *   PRESETS, MAX_SECONDS, FPS_MIN, FPS_MAX, explain
 */

import {
  Input, Output, Conversion, ConversionCanceledError, BlobSource, BufferTarget,
  Mp4OutputFormat, ALL_FORMATS,
} from 'mediabunny'

/* ═══════════════════════════════════════════════════════════════════════════
   Constants
   ═══════════════════════════════════════════════════════════════════════════ */

export const MAX_SECONDS = 35
export const FPS_MIN = 24
export const FPS_MAX = 90

export type WallPreset = 'performance' | 'balanced' | 'high' | 'original'

export const PRESETS: Record<
  Exclude<WallPreset, 'original'>,
  { long: number; fps: number; bitrate: number }
> = {
  performance: { long: 854, fps: 24, bitrate: 2.5e6 },
  balanced: { long: 1280, fps: 30, bitrate: 6.0e6 },
  high: { long: 1920, fps: 30, bitrate: 12.0e6 },
}

/* ═══════════════════════════════════════════════════════════════════════════
   Utilities
   ═══════════════════════════════════════════════════════════════════════════ */

/** Turn any thrown thing into a readable string. */
export const explain = (e: unknown): string => {
  if (e instanceof Error) return e.message
  if (e && typeof e === 'object' && 'target' in e) {
    const t = e as { target?: { error?: { code?: number; message?: string } } }
    if (t.target?.error)
      return `media error ${t.target.error.code} ${t.target.error.message || ''}`.trim()
  }
  if (typeof e === 'string') return e
  if (e) return `${(e as { type?: string }).type || ''} ${JSON.stringify(e)}`.trim()
  return 'unknown error (null)'
}

/** Wrap an async step so failures say which step broke. */
const step = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
  try {
    return await fn()
  } catch (e) {
    if (e instanceof ConversionCanceledError) throw e
    throw new Error(`${name} failed: ${explain(e)}`)
  }
}

/** Checked at every phase boundary so the pill's ✕ cancels between steps,
    not just while the encoder is running. */
const throwIfAborted = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new ConversionCanceledError()
}

/** H.264 requires even dimensions. */
const even = (n: number) => Math.max(2, Math.round(n / 2) * 2)
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))

/* ═══════════════════════════════════════════════════════════════════════════
   1. probe — describe the file without touching it
   ═══════════════════════════════════════════════════════════════════════════ */

export interface ProbeInfo {
  mime: string
  duration: number
  width: number
  height: number
  codec: string | null
  codecString: string
  fps: number
  sourceFps: number
  bitrate: number
  hdr: boolean
  tenBit: boolean
  fullRange: boolean
}

export async function probe(file: File): Promise<ProbeInfo> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS })
  try {
    const track = await input.getPrimaryVideoTrack()
    if (!track) throw new Error('No video track in this file — it may be audio-only or corrupt')

    const cfg = await track.getDecoderConfig().catch(() => null)

    /* average packet rate & bitrate over a window — more reliable than metadata */
    let stats = { averagePacketRate: 0, averageBitrate: 0 }
    try {
      stats = await track.computePacketStats(150)
    } catch {}

    /* color space for HDR detection */
    let cs: VideoColorSpaceInit | null = null
    try {
      cs = await track.getColorSpace()
    } catch {}

    const fps = stats.averagePacketRate || 30
    const codecString = cfg?.codec || ''

    return {
      mime: file.type,
      duration: await input.computeDuration(),
      width: track.displayWidth,
      height: track.displayHeight,
      codec: track.codec,
      codecString,
      fps,
      sourceFps: Math.round(fps) || 30,
      bitrate: stats.averageBitrate || 0,
      hdr: (cs?.transfer as string) === 'pq' || (cs?.transfer as string) === 'hlg',
      tenBit:
        /avc1\.6a/i.test(codecString) ||
        /hev[1c]\.2/i.test(codecString) ||
        /vp09\.0[23]/i.test(codecString),
      fullRange: cs?.fullRange === true,
    }
  } finally {
    input.dispose()
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   2. plan — decide size, fps, bitrate, whether to skip encoding entirely
   ═══════════════════════════════════════════════════════════════════════════ */

export interface WallPlan {
  w: number
  h: number
  fps: number
  bitrate: number
  trim: boolean
  start: number
  end: number
  skip: boolean
  srcFps: number
  wantFps: number
  fpsLimited: boolean
  fpsChanged: boolean
}

export function plan(
  info: ProbeInfo,
  presetName: Exclude<WallPreset, 'original'>,
  start = 0,
  targetFps: number | null = null,
): WallPlan {
  const p = PRESETS[presetName]

  /* scale so the longest side fits the preset — never upscale */
  const s = Math.min(1, p.long / Math.max(info.width, info.height))

  const srcFps = Math.round(info.fps) || p.fps

  /* fps: user's choice clamped to [FPS_MIN, FPS_MAX], then clamped to source */
  const want = targetFps != null ? clamp(Math.round(targetFps), FPS_MIN, FPS_MAX) : Math.min(p.fps, srcFps)
  const fps = Math.min(want, srcFps)
  const fpsChanged = Math.abs(fps - srcFps) > 0.5
  const fpsLimited = fps < want

  const trim = start > 0 || info.duration > MAX_SECONDS + 0.5

  /* "Skip" = keep the original file byte-for-byte. Only safe when it's already
     H.264 Main/Main10-adjacent baseline|main|high profile, 8-bit, SDR, small
     enough, low enough fps & bitrate, and doesn't need trimming. */
  const fine =
    /mp4/i.test(info.mime) &&
    info.codec === 'avc' &&
    /^avc1\.(42|4d|64)/i.test(info.codecString) &&
    !info.tenBit &&
    !info.hdr &&
    s >= 1 &&
    !fpsChanged &&
    (!info.bitrate || info.bitrate <= p.bitrate * 1.6) &&
    !trim

  return {
    w: even(info.width * s),
    h: even(info.height * s),
    fps,
    bitrate: p.bitrate,
    trim,
    start,
    end: start + MAX_SECONDS,
    skip: fine,
    srcFps,
    wantFps: want,
    fpsLimited,
    fpsChanged,
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   3. encoder support — will this run, and will it use hardware?
   ═══════════════════════════════════════════════════════════════════════════ */

export async function encoderSupport(w: number, h: number, fps: number, bitrate: number) {
  if (typeof VideoEncoder === 'undefined') return { ok: false, hardware: false, note: 'WebCodecs missing' }

  const test = async (accel: string) => {
    try {
      const r = await VideoEncoder.isConfigSupported({
        codec: 'avc1.640028',
        width: w,
        height: h,
        framerate: fps,
        bitrate,
        hardwareAcceleration: accel as HardwareAcceleration,
      })
      return r.supported === true
    } catch {
      return false
    }
  }

  const hardware = await test('prefer-hardware')
  const any = await test('no-preference')
  return { ok: any, hardware, note: hardware ? 'hardware encoder' : 'software encoder' }
}

/* ═══════════════════════════════════════════════════════════════════════════
   4. convert — the actual transcode
   ═══════════════════════════════════════════════════════════════════════════ */

export async function convert(
  file: File,
  pl: WallPlan,
  { onProgress, signal }: { onProgress?: (p: number) => void; signal?: AbortSignal } = {},
): Promise<Blob> {
  throwIfAborted(signal)
  if (typeof VideoEncoder === 'undefined')
    throw new Error('WebCodecs is not available in this browser')

  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS })
  /* fastStart:'in-memory' puts the moov atom first → playback starts instantly */
  const target = new BufferTarget()
  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
    target,
  })

  const conv = await Conversion.init({
    input,
    output,
    video: {
      codec: 'avc',
      width: pl.w,
      height: pl.h,
      fit: 'contain',
      frameRate: pl.fps,
      bitrate: pl.bitrate,
      forceTranscode: true,
    },
    audio: { discard: true },
    trim: pl.trim ? { start: pl.start, end: pl.end } : undefined,
  })

  if (!conv.isValid) {
    const reasons = conv.discardedTracks.map((t) => t.reason).join(', ')
    throw new Error(`This file can't be converted here (${reasons || 'no usable tracks'})`)
  }

  const onAbort = () => void conv.cancel()
  signal?.addEventListener('abort', onAbort)
  /* aborting while init was still awaiting would never fire the listener —
     check the flag directly so a click in that window still cancels */
  if (signal?.aborted) conv.cancel()
  conv.onProgress = (p) => onProgress?.(p)

  try {
    await step('encoding', () => conv.execute())
  } finally {
    signal?.removeEventListener('abort', onAbort)
    input.dispose()
  }

  const buf = target.buffer
  if (!buf || buf.byteLength < 1000)
    throw new Error(`encoder produced an empty file (${buf ? buf.byteLength : 'null'} bytes)`)

  return new Blob([buf], { type: 'video/mp4' })
}

/* ═══════════════════════════════════════════════════════════════════════════
   5. poster — grab a frame for the thumbnail
   ═══════════════════════════════════════════════════════════════════════════ */

export async function poster(blob: Blob, at = 1): Promise<Blob | null> {
  const v = document.createElement('video')
  const url = URL.createObjectURL(blob)
  v.muted = true
  v.preload = 'auto'
  v.src = url

  try {
    await new Promise<void>((ok, no) => {
      v.onloadeddata = () => ok()
      v.onerror = () =>
        no(new Error(`browser could not play the converted file: media error ${v.error?.code ?? ''}`))
    })

    v.currentTime = Math.min(at, (v.duration || 2) / 2)
    await new Promise<void>((r) => {
      v.onseeked = () => r()
    })

    const scale = Math.min(1, 640 / v.videoWidth)
    const c = document.createElement('canvas')
    c.width = Math.round(v.videoWidth * scale)
    c.height = Math.round(v.videoHeight * scale)
    c.getContext('2d')!.drawImage(v, 0, 0, c.width, c.height)

    return await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.8))
  } finally {
    /* release the throwaway element's decoder immediately — relying on GC
       here held hardware decoder slots across repeated wallpaper imports */
    v.removeAttribute('src')
    v.load()
    URL.revokeObjectURL(url)
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   6. storage — IndexedDB, with an in-memory fallback for private mode
   ═══════════════════════════════════════════════════════════════════════════ */

let idbBroken = false
const mem = new Map<string, WallpaperRecord>()

export interface WallpaperRecord {
  id: string
  name: string
  width: number
  height: number
  fps: number
  sourceFps: number
  duration: number
  size: number
  preset: WallPreset
  hdr: boolean
  converted: boolean
  created: number
  blob: Blob
  poster: Blob | null
  original?: File | null
  persisted?: boolean
}

const openIDB = () =>
  new Promise<IDBDatabase>((ok, no) => {
    let r: IDBOpenDBRequest
    try {
      r = indexedDB.open('wallpapers', 1)
    } catch (e) {
      return no(e)
    }
    r.onupgradeneeded = () => r.result.createObjectStore('w', { keyPath: 'id' })
    r.onsuccess = () => ok(r.result)
    r.onerror = () => no(r.error)
    r.onblocked = () => no(new Error('IndexedDB blocked'))
  })

const tx = async <T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> => {
  if (idbBroken) throw new Error('idb disabled')
  const db = await openIDB()
  return new Promise<T>((ok, no) => {
    const t = db.transaction('w', mode)
    const q = fn(t.objectStore('w'))
    t.oncomplete = () => ok(q && q.result as T)
    t.onerror = () => no(t.error)
  })
}

export const store = {
  /** 'idb' until the first failure flips it to 'memory'. */
  mode: 'idb' as 'idb' | 'memory',

  async save(rec: WallpaperRecord): Promise<void> {
    try {
      await tx('readwrite', (s) => s.put(rec))
    } catch (e) {
      idbBroken = true
      this.mode = 'memory'
      mem.set(rec.id, rec)
      throw Object.assign(new Error(`IndexedDB save failed: ${explain(e)} — wallpaper kept in memory for this session only`), {
        __fellback: true,
      })
    }
  },
  async get(id: string): Promise<WallpaperRecord | undefined> {
    try {
      return await tx<WallpaperRecord | undefined>('readonly', (s) => s.get(id))
    } catch {
      return mem.get(id)
    }
  },
  async list(): Promise<WallpaperRecord[]> {
    try {
      return await tx<WallpaperRecord[]>('readonly', (s) => s.getAll())
    } catch {
      return [...mem.values()]
    }
  },
  async remove(id: string): Promise<void> {
    try {
      await tx('readwrite', (s) => s.delete(id))
    } catch {
      mem.delete(id)
    }
  },
}

/** Call once at startup so the UI can warn before the user tries anything. */
export async function storageMode(): Promise<{ mode: string; error?: string }> {
  try {
    const db = await openIDB()
    db.close()
    return { mode: 'idb' }
  } catch (e) {
    idbBroken = true
    store.mode = 'memory'
    return { mode: 'memory', error: explain(e) }
  }
}

/** Ask the browser to keep our storage (quota safety). */
export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (navigator.storage?.persist) return await navigator.storage.persist()
  } catch {}
  return false
}

/* ═══════════════════════════════════════════════════════════════════════════
   7. importWallpaper — the whole pipeline in one call
   ═══════════════════════════════════════════════════════════════════════════ */

export async function importWallpaper(
  file: File,
  {
    preset = 'balanced',
    start = 0,
    fps = null,
    onStage,
    onProgress,
    onLog,
    signal,
  }: {
    preset?: Exclude<WallPreset, 'original'>
    start?: number
    fps?: number | null
    onStage?: (s: string) => void
    onProgress?: (p: number) => void
    onLog?: (m: string) => void
    signal?: AbortSignal
  } = {},
): Promise<WallpaperRecord> {
  const log = (m: string) => onLog?.(m)

  throwIfAborted(signal)
  onStage?.('Analyzing')
  const info = await step('probe', () => probe(file))
  const pl = plan(info, preset, start, fps)
  log(`source: ${JSON.stringify(info)}`)
  log(`plan: ${JSON.stringify(pl)}`)

  if (info.hdr)
    log('HDR source — WebCodecs does not tone-map, colors will look washed out')

  if (pl.fpsLimited)
    log(`note: asked ${pl.wantFps} fps, source is ${pl.srcFps} — encoding at ${pl.fps} (no upscaling)`)

  const enc = await encoderSupport(pl.w, pl.h, pl.fps, pl.bitrate)
  log(`H.264 encoder: ${JSON.stringify(enc)}`)

  let blob: Blob = file
  if (!pl.skip) {
    onStage?.('Converting')
    const t0 = performance.now()
    blob = await convert(file, pl, { onProgress, signal })
    log(`converted in ${((performance.now() - t0) / 1000).toFixed(1)}s → ${(blob.size / 1e6).toFixed(2)} MB`)
  } else {
    log('source already optimal — keeping original')
  }

  /* a ✕ click landing after the encode but before the save must still win */
  throwIfAborted(signal)

  /* sanity check: is it really an MP4? */
  const head = new Uint8Array(await blob.slice(4, 8).arrayBuffer())
  const headStr = String.fromCharCode(...head)
  log(`file header: ${headStr}`)

  onStage?.('Saving')
  let pst: Blob | null = null
  try {
    pst = await poster(blob)
  } catch (e) {
    log(`poster skipped: ${explain(e)}`)
  }
  /* poster capture is the slow part of "Saving" — a ✕ click during it must
     still abort, before anything is written to IndexedDB */
  throwIfAborted(signal)

  const rec: WallpaperRecord = {
    id: crypto.randomUUID(),
    name: file.name.replace(/\.[^.]+$/, ''),
    width: pl.skip ? info.width : pl.w,
    height: pl.skip ? info.height : pl.h,
    fps: pl.skip ? pl.srcFps : pl.fps,
    sourceFps: pl.srcFps,
    duration: Math.min(info.duration, MAX_SECONDS),
    size: blob.size,
    preset,
    hdr: info.hdr,
    converted: !pl.skip,
    created: Date.now(),
    blob,
    poster: pst,
    original: file,
    persisted: undefined,
  }

  try {
    await store.save(rec)
    rec.persisted = true
    log('saved to IndexedDB')
  } catch (e) {
    if ((e as { __fellback?: boolean }).__fellback) {
      log('IndexedDB unavailable — kept in memory for this session')
      rec.persisted = false
    } else {
      throw new Error(`saving to IndexedDB failed: ${explain(e)}`)
    }
  }

  return rec
}

/* ═══════════════════════════════════════════════════════════════════════════
   8. WallpaperPlayer — playback, real FPS, and a governor that isn't fooled
      by background work
   ═══════════════════════════════════════════════════════════════════════════ */

export class WallpaperPlayer {
  private readonly v: HTMLVideoElement
  private readonly onDegrade?: (tier: number) => void
  private readonly onFps?: (fps: number) => void

  private url: string | null = null
  private posterUrl: string | null = null
  private tier = 0 /* 0 = full effects … 4 = decode paused */
  private busy = false /* true while encoding — governor stops counting */
  private destroyed = false
  /* true only while a VIDEO wallpaper should actually be presenting frames.
     false when the active theme isn't 'custom' or the wallpaper is an image —
     without this the element keeps DECODING invisibly behind a hidden layer
     (and visibilitychange/srcHeal happily re-play it), which showed up as a
     persistent ~30fps UI after "clearing" the wallpaper via a theme switch */
  private active = false
  pauseOnHidden = true

  private frames = 0
  private t0 = performance.now()
  private rvfc = -1
  private poll: number | null = null
  private pf = 0
  private pt = 0
  private stallCount = 0
  private lastPresented = -1
  private heal: number | null = null
  private srcHeal: number | null = null

  private readonly onVis = () => {
    if (document.hidden) {
      if (this.pauseOnHidden) this.v.pause()
    } else if (this.active && this.v.src && this.tier < 4) {
      void this.v.play().catch(() => {})
    }
  }

  constructor(video: HTMLVideoElement, { onDegrade, onFps }: { onDegrade?: (t: number) => void; onFps?: (f: number) => void } = {}) {
    Object.assign(video, {
      muted: true,
      loop: true,
      playsInline: true,
      disablePictureInPicture: true,
      preload: 'auto',
      controls: false,
    })
    this.v = video
    this.onDegrade = onDegrade
    this.onFps = onFps

    document.addEventListener('visibilitychange', this.onVis)

    /* black-frame self-heal: on weak GPUs the video's compositor layer can be
       dropped (renders black) after heavy UI churn like slider drags. If the
       video claims to be playing but presents no new frames for ~2s, re-seek
       to force the decoder + compositor to kick back in */
    this.heal = window.setInterval(() => {
      const v = this.v
      if (this.destroyed || v.paused || !v.src || document.hidden) return
      const q = v.getVideoPlaybackQuality?.()
      const presented = q ? q.totalVideoFrames : -1
      if (presented >= 0) {
        if (this.lastPresented === presented) {
          this.stallCount++
          if (this.stallCount >= 2) {
            this.stallCount = 0
            const end = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 1e7
            v.currentTime = v.currentTime + 0.1 < end ? v.currentTime + 0.1 : 0
          }
        } else {
          this.stallCount = 0
        }
        this.lastPresented = presented
      }
    }, 1000)

    /* lost-src self-heal: if the video element's src goes empty while a
       wallpaper is supposed to be active (Chromium compositor drop), restore it */
    this.srcHeal = window.setInterval(() => {
      const v = this.v
      if (this.destroyed || !this.url || !this.active || document.hidden) return
      if (!v.src && !v.paused) return
      if (!v.src) {
        v.src = this.url
        void v.play().catch(() => {})
      }
    }, 2000)

    /* frame-time governor: shed effects when the UI can't keep up.
       Ladder (video): 0 full → 1 backdrop-filter off → 2 infinite animations
       off → 3 full-screen blend layers off → 4 wallpaper decode paused.
       Without a video the top grade is 2 (nothing else is left to shed).
       Counts regardless of video state (jank is jank), and walks back DOWN
       after a clean window so a transient stall (import, BPM analysis) never
       leaves the player visually degraded.
       Hysteresis + deadband: at tier 3+ a weak-but-steady machine runs at
       ~30fps (dt≈31ms) — neither healthy (≤26ms) nor a stall. Counting that
       as "bad" made the governor oscillate into the last-resort pause (the
       stuttery ~23fps wall meter), so above tier 3 only GENUINE stalls
       (>38ms) push towards the pause while frames ≤34ms can still walk the
       ladder back down. Below tier 3 the usual 30ms jank bar applies. */
    let last = performance.now()
    let bad = 0
    let good = 0
    let calm = 0
    const governor = (t: number) => {
      if (this.destroyed) return
      const dt = t - last
      last = t

      if (this.busy) {
        bad = 0
        good = 0
        calm = 0
      } else if (!document.hidden) {
        if (this.tier >= 3) {
          bad = dt > 38 ? bad + 1 : 0
          good = dt <= 26 ? good + 1 : 0
          calm = dt <= 34 ? calm + 1 : 0
        } else {
          bad = dt > 30 ? bad + 1 : Math.max(0, bad - 1)
          good = dt <= 26 ? good + 1 : 0
          calm = 0
        }
        const maxTier = this.url ? 4 : 2
        const escalateAt = this.tier === 3 ? 240 : 90
        const decayAt = this.tier === 4 ? 1200 : 600
        /* tier 4 may recover on "calm" (a steady ~30fps can come back off the
           pause); tiers 1-3 only recover on genuinely healthy frames */
        const health = this.tier === 4 ? Math.max(good, calm) : good
        if (bad > escalateAt && this.tier < maxTier) {
          this.tier++
          bad = 0
          good = 0
          calm = 0
          document.documentElement.dataset.fx = String(this.tier)
          if (this.tier === 4) this.v.pause() /* last resort: stop decode, keep last frame */
          this.onDegrade?.(this.tier)
        } else if (this.tier > 0 && health >= decayAt) {
          this.tier--
          good = 0
          calm = 0
          if (this.tier > 0) document.documentElement.dataset.fx = String(this.tier)
          else delete document.documentElement.dataset.fx
          if (this.tier < 4 && this.active && this.url && !this.busy && !document.hidden) void this.v.play().catch(() => {})
          this.onDegrade?.(this.tier)
        }
      }

      if (!this.destroyed) requestAnimationFrame(governor)
    }
    requestAnimationFrame(governor)
  }

  /* ---- FPS counting ---- */

  private tick(now: number) {
    this.frames++
    const dt = now - this.t0
    if (dt >= 1000) {
      this.onFps?.((this.frames * 1000) / dt)
      this.frames = 0
      this.t0 = now
    }
    const v = this.v as HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: (n: number) => void) => number
    }
    this.rvfc = v.requestVideoFrameCallback((n) => this.tick(n)) /* unbound `this.tick` crashes: class callbacks run with this === undefined */
  }

  private pollQuality() {
    const q = this.v.getVideoPlaybackQuality?.()
    if (!q) return
    const now = performance.now()
    const d = q.totalVideoFrames - this.pf
    this.pf = q.totalVideoFrames
    if (now - this.pt >= 1000) {
      this.onFps?.((d * 1000) / (now - this.pt))
      this.pt = now
    }
  }

  private startCount() {
    this.stopCount()
    this.frames = 0
    this.t0 = performance.now()
    const v = this.v as HTMLVideoElement & {
      requestVideoFrameCallback?: (cb: (n: number) => void) => number
      cancelVideoFrameCallback?: (h: number) => void
    }
    if (v.requestVideoFrameCallback) {
      this.rvfc = v.requestVideoFrameCallback((n) => this.tick(n)) /* unbound `this.tick` crashes: class callbacks run with this === undefined */
    } else {
      const q = this.v.getVideoPlaybackQuality?.()
      this.pf = q ? q.totalVideoFrames : 0
      this.pt = performance.now()
      this.poll = window.setInterval(() => this.pollQuality(), 250)
    }
  }

  private stopCount() {
    const v = this.v as HTMLVideoElement & {
      cancelVideoFrameCallback?: (h: number) => void
    }
    if (this.rvfc != null) {
      try {
        v.cancelVideoFrameCallback(this.rvfc)
      } catch {}
      this.rvfc = -1
    }
    if (this.poll != null) {
      window.clearInterval(this.poll)
      this.poll = null
    }
  }

  /* ---- public API ---- */

  /** Swap in a new wallpaper. src may be a Blob or a URL string. */
  async set(src: Blob | string, posterBlob?: Blob | null) {
    this.stopCount()

    if (this.url?.startsWith('blob:')) URL.revokeObjectURL(this.url)
    if (this.posterUrl) URL.revokeObjectURL(this.posterUrl)

    this.url = src instanceof Blob ? URL.createObjectURL(src) : src
    this.posterUrl = posterBlob ? URL.createObjectURL(posterBlob) : null
    /* poster shows while the video loads — the test architecture's trick */
    if (this.posterUrl) this.v.poster = this.posterUrl

    this.tier = 0
    delete document.documentElement.dataset.fx
    this.active = true /* receiving a video means it is meant to show */

    this.v.src = this.url
    this.startCount()
    await this.v.play().catch(() => {})
  }

  /** Show/hide duty for the video: false pauses decode (theme switched away
      or wallpaper is an image) so nothing keeps decoding behind a hidden
      layer; true resumes, honouring busy/tier/hidden guards. */
  setActive(on: boolean) {
    this.active = on
    if (!on) {
      this.v.pause()
      return
    }
    if (this.url && !this.busy && this.tier < 4 && !document.hidden) void this.v.play().catch(() => {})
  }

  /** Pause the governor and the video while heavy work happens elsewhere. */
  async pauseForWork() {
    this.busy = true
    this.v.pause()
  }

  /** Resume after heavy work. */
  async resumeAfterWork() {
    this.busy = false
    if (this.active && !document.hidden) await this.v.play().catch(() => {})
  }

  resetTier() {
    this.tier = 0
    delete document.documentElement.dataset.fx
  }

  destroy() {
    this.destroyed = true
    this.stopCount()
    if (this.heal) window.clearInterval(this.heal)
    if (this.srcHeal) window.clearInterval(this.srcHeal)
    document.removeEventListener('visibilitychange', this.onVis)
    if (this.url?.startsWith('blob:')) URL.revokeObjectURL(this.url)
    if (this.posterUrl) URL.revokeObjectURL(this.posterUrl)
  }
}
