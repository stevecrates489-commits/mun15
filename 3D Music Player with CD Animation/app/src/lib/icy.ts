/**
 * ICY metadata: reading "now playing" out of a live stream.
 *
 * A radio stream interleaves small metadata blocks between the audio frames.
 * The server advertises the spacing as the `icy-metaint` header, so the wire
 * format is:
 *
 *   [ audio × metaint bytes ][ 1 byte length ][ length×16 bytes metadata ]
 *   ... repeated forever
 *
 * and the metadata carries `StreamTitle='Artist - Title';`.
 *
 * ── Why this file is shaped the way it is ───────────────────────────────
 *
 * Reading those bytes means `fetch()`ing the stream, which needs CORS. Radio
 * streams generally do not send CORS headers, so for most stations this fails
 * outright and the answer is: play the audio, show no metadata. That is a real
 * limit of the web platform, not of this implementation, and there is no
 * honest way around it without a proxy — so the fallback is explicit and the
 * UI says so instead of showing a blank "unknown" forever.
 *
 * Playback is always the plain <audio> element, started immediately. Metadata
 * is a SECOND, best-effort connection: if the stream allows the fetch, titles
 * arrive in the background; if not, the station still plays. Nothing about
 * metadata may delay or interrupt the audio.
 */

export interface IcySong {
  artist: string
  title: string
  raw: string
}

export type IcyKind = 'probing' | 'none' | 'live' | 'error'

export interface IcyStatus {
  kind: IcyKind
  station?: string
  metaint?: number
  mime?: string
  message?: string
}

export interface Probe {
  ok: boolean
  metaint: number
  mime: string
  station: string
  /** a metadata block actually arrived during the probe */
  hasTitles: boolean
}

const PROBE_BYTES = 24 * 1024
const TITLE_MIN = 3

/* AutoDJ systems fill the tag when nothing is announced — "No title" and its
   cousins are placeholders, not songs. They are dropped here, so the panel
   keeps showing the station's own name instead of the placeholder. */
const TITLE_PLACEHOLDER = /^(no[\s-]?title|untitled|unknown( track| artist|)?|n\/?a|none|track)$/i

const decoder = new TextDecoder()

/* ── optional CORS relay ────────────────────────────────────────────────
   Reading ICY metadata means fetch(), which means CORS, and radio streams
   mostly do not send the headers. A one-file relay in front of the stream
   adds them — when one is configured here, ONLY the metadata reads go through
   it. Playback stays direct, because a plain <audio> element needs no CORS
   and routing the audio through a relay would add latency for nothing.

   Set from the radio panel; persisted under `md-radio-proxy`. */
let proxyBase = ''

export function setProxyBase(url: string): void {
  proxyBase = url.trim().replace(/\/+$/, '')
}

export function getProxyBase(): string {
  return proxyBase
}

const via = (url: string): string =>
  proxyBase ? `${proxyBase}?target=${encodeURIComponent(url)}` : url

/* A chunk arriving from a network reader is backed by a plain ArrayBuffer —
   `copied` gives a view a fresh, correctly-offset buffer so subarray views
   can be handed to TextDecoder without slicing the wrong bytes. */
const copied = (u: Uint8Array): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(u.byteLength)
  out.set(u)
  return out
}

const concat = (a: Uint8Array, b: Uint8Array): Uint8Array<ArrayBuffer> => {
  if (!a.length) return copied(b)
  const out = new Uint8Array(a.length + b.length)
  out.set(a)
  out.set(b, a.length)
  return out
}

/**
 * Ask the server whether it will hand over metadata at all. Short-lived: it
 * reads a couple of kilobytes and cancels, so it never leaves a stream open.
 */
export async function probeStream(url: string): Promise<Probe> {
  // Mixed content: fetching http:// from a secure page is blocked by the
  // browser before it even hits the wire. Skip the probe entirely.
  if (url.startsWith('http://') && window.location.protocol === 'https:') {
    return { ok: false, metaint: 0, mime: '', station: '', hasTitles: false }
  }
  const ac = new AbortController()
  const timer = window.setTimeout(() => ac.abort(), 6000)
  try {
    const res = await fetch(via(url), {
      headers: { 'Icy-MetaData': '1' },
      signal: ac.signal,
    })
    if (!res.ok || !res.body) return { ok: false, metaint: 0, mime: '', station: '', hasTitles: false }

    const metaint = Number(res.headers.get('icy-metaint')) || 0
    const station = res.headers.get('icy-name') ?? ''
    const mime = guessMime(res.headers.get('content-type') ?? '')

    /* metaint = 0 is a server saying "I have the header but no metadata" */
    if (metaint <= 0) return { ok: true, metaint: 0, mime, station, hasTitles: false }

    const reader = res.body.getReader()
    let total = 0
    let carry = new Uint8Array(0)
    let hasTitles = false
    try {
      while (total < PROBE_BYTES) {
        const { done, value } = await reader.read()
        if (done) break
        total += value.length
        carry = concat(carry, value)
        /* only need to get as far as the first metadata block */
        if (carry.length > metaint + 1) {
          const len = carry[metaint] * 16
          if (len > 0 && carry.length >= metaint + 1 + len) {
            const text = decoder.decode(copied(carry.subarray(metaint + 1, metaint + 1 + len)))
            hasTitles = /StreamTitle\s*=/i.test(text)
            break
          }
        }
      }
    } finally {
      try {
        await reader.cancel()
      } catch {
        /* the body may already be released — nothing to cancel */
      }
    }
    return { ok: true, metaint, mime, station, hasTitles }
  } catch {
    /* CORS refusal, DNS, TLS — indistinguishable from here, and all of them
       mean the same thing to the player: plain audio, no metadata */
    return { ok: false, metaint: 0, mime: '', station: '', hasTitles: false }
  } finally {
    window.clearTimeout(timer)
  }
}

function guessMime(contentType: string): string {
  const t = contentType.toLowerCase()
  if (t.includes('mpeg') || t.includes('mp3')) return 'audio/mpeg'
  if (t.includes('aac') || t.includes('mp4')) return 'audio/mp4'
  if (t.includes('ogg')) return 'audio/ogg'
  if (t.includes('opus')) return 'audio/ogg; codecs="opus"'
  return ''
}

/**
 * Tracks one stream: reads its metadata, decides the playback shape, and
 * reports song changes. Song change is simply "the StreamTitle string
 * changed", with a debounce so a station blinking its own name between tracks
 * does not fire three lyric lookups in a row.
 */
export class IcyTracker {
  private ac: AbortController | null = null
  private audio: HTMLAudioElement | null = null
  private lastTitle = ''
  private lastChangeAt = 0
  private stopped = true

  private songCbs = new Set<(s: IcySong) => void>()
  private statusCbs = new Set<(s: IcyStatus) => void>()
  private endCbs = new Set<() => void>()

  onSong(cb: (s: IcySong) => void): () => void {
    this.songCbs.add(cb)
    return () => this.songCbs.delete(cb)
  }
  onStatus(cb: (s: IcyStatus) => void): () => void {
    this.statusCbs.add(cb)
    return () => this.statusCbs.delete(cb)
  }
  onEnd(cb: () => void): () => void {
    this.endCbs.add(cb)
    return () => this.endCbs.delete(cb)
  }

  private emitSong(s: IcySong) {
    this.songCbs.forEach((cb) => cb(s))
  }
  private emitStatus(s: IcyStatus) {
    this.statusCbs.forEach((cb) => cb(s))
  }
  private emitEnd() {
    this.endCbs.forEach((cb) => cb())
  }

  /**
   * Begin. Never throws: every failure mode degrades to plain playback and is
   * reported through the status channel instead.
   */
  async start(url: string, audio: HTMLAudioElement): Promise<void> {
    this.stop()
    this.audio = audio
    this.lastTitle = ''
    this.lastChangeAt = 0
    this.stopped = false
    this.emitStatus({ kind: 'probing' })

    /* audio starts NOW — metadata is a background detail. Waiting for the
       probe first (up to 6s, and it fails on every stream without CORS) made
       a station look stalled before it had made a single sound. */
    await this.playPlain(url)
    void this.probeAndTrack(url).catch(() => {})
  }

  /**
   * Metadata runs on a second connection: a `fetch` with `Icy-MetaData: 1`
   * interleaves titles between the audio frames. Failure here never touches
   * playback — the station is already playing by the time this settles.
   */
  private async probeAndTrack(url: string): Promise<void> {
    let probe: Probe
    try {
      probe = await probeStream(url)
    } catch {
      probe = { ok: false, metaint: 0, mime: '', station: '', hasTitles: false }
    }
    if (this.stopped) return

    /* no metadata available — the overwhelmingly common case, and a perfectly
       good outcome: the listener hears the station either way */
    if (!probe.ok || probe.metaint <= 0) {
      this.emitStatus({
        kind: 'none',
        station: probe.station,
        message: probe.ok ? 'NO METADATA FROM THIS STREAM' : 'STREAM DOES NOT ALLOW METADATA',
      })
      return
    }

    this.emitStatus({
      kind: 'live',
      station: probe.station,
      metaint: probe.metaint,
      mime: probe.mime,
      message: 'AUDIO + METADATA',
    })
    void this.pumpMetadata(url, probe.metaint).catch(() => {})
  }

  /** plain element playback — the one path that needs no CORS and no MSE */
  private async playPlain(url: string): Promise<void> {
    const audio = this.audio
    if (!audio) return
    audio.src = url
    audio.load()
    try {
      /* a dead stream can leave play() pending forever — never await it, or
         the whole open() call hangs and the listener never gets control back.
         The `playing`/`error` events are the real signals. */
      audio.play().catch(() => {})
    } catch {
      /* a suspended context or a refused autoplay — the stall watchdog and the
         play button surface this, never a throw from here */
    }
  }

  /* ── the reader ─────────────────────────────────────────────────────── */

  /**
   * Walks the stream frame by frame, parsing the metadata blocks. The audio
   * bytes are discarded — the element is already playing the stream itself.
   */
  private async pump(url: string, metaint: number, signal?: AbortSignal): Promise<void> {
    let reader: ReadableStreamDefaultReader<Uint8Array> | null = null
    try {
      const res = await fetch(via(url), { headers: { 'Icy-MetaData': '1' }, signal })
      if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`)
      reader = res.body.getReader()

      let carry = new Uint8Array(0)
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        carry = concat(carry, value)
        let off = 0
        let progressed = true
        while (progressed) {
          progressed = false
          if (carry.length - off < metaint + 1) break
          const len = carry[off + metaint] * 16
          if (carry.length - off < metaint + 1 + len) break
          off += metaint
          if (len > 0) this.parseTitle(decoder.decode(copied(carry.subarray(off + 1, off + 1 + len))))
          off += 1 + len
          progressed = true
        }
        carry = carry.subarray(off)
      }
      /* the socket closed cleanly on a live stream — that is an outage, not a
         natural end, so it is surfaced as one */
      if (!this.stopped) this.emitEnd()
    } catch {
      /* a torn socket or an aborted read on a live stream — both mean the
         stream stopped, which is what the retry path needs to know */
      if (signal?.aborted) return
      if (!this.stopped) this.emitEnd()
    } finally {
      if (reader) {
        try {
          await reader.cancel()
        } catch {
          /* the body may already be released — nothing to cancel */
        }
      }
    }
  }

  /** metadata-only reader: parse titles, discard the duplicated audio bytes */
  private async pumpMetadata(url: string, metaint: number): Promise<void> {
    const ac = new AbortController()
    this.ac = ac
    try {
      await this.pump(url, metaint, ac.signal)
    } catch {
      /* stream ended or was aborted — nothing to retry from here */
    }
  }

  /**
   * Extract artist/title from a StreamTitle block.
   *
   * Formats seen in the wild: `Artist - Title`, `Artist - Title - Album`,
   * bare `Title`, and occasionally just the station name. The first ` - ` is
   * the artist/title split; anything after a second separator is dropped
   * rather than guessed at.
   */
  private parseTitle(text: string): void {
    const m = /StreamTitle\s*=\s*'([^']*)'/i.exec(text)
    if (!m) return
    const raw = m[1].trim()
    if (!raw || raw === this.lastTitle || TITLE_PLACEHOLDER.test(raw)) return
    if (raw.length < TITLE_MIN) return

    /* a station blinking its own name between tracks is the classic false
       positive; 3s is long enough to outlast that and short enough to still
       feel like the change is now */
    const now = Date.now()
    if (now - this.lastChangeAt < 3000) return
    this.lastChangeAt = now

    const split = raw.indexOf(' - ')
    const artist = split > 0 ? raw.slice(0, split).trim() : ''
    const title = (split > 0 ? raw.slice(split + 3) : raw).trim()
    if (!title) return

    this.lastTitle = raw
    this.emitSong({ artist, title, raw })
  }

  stop(): void {
    this.stopped = true
    this.ac?.abort()
    this.ac = null
    this.lastTitle = ''
  }
}

