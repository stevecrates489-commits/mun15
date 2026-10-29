/**
 * The songs downloaded in the online extension, on their way into this player.
 *
 * Dannify keeps what it downloads in its own library, sealed so that only it
 * can read the files. Its own `/downloads` address opens a file on the way
 * out, so nothing here has to know how that works: the player asks which
 * songs were downloaded, takes each new one once, and keeps the audio it is
 * given as an ordinary file in its own library.
 *
 * "Once" is remembered by the download's own path inside Dannify's folder,
 * which is what the extension lists. A song deleted from this player after
 * that stays deleted — the point is not to pull the library in again every
 * time the app starts.
 */

/** The extension's own address: fixed, so the player never has to ask. */
const EXTENSION = 'http://127.0.0.1:8765'

const IMPORTED_KEY = 'dannify-imported'

export interface DannifyDownload {
  /** The path inside Dannify's music folder; also the identity remembered. */
  file: string
  title: string
  artist: string
  album?: string
  video_id?: string
  /** Where the extension serves this song as playable audio. */
  url: string
  /** Where it serves the artwork, if the song has any. */
  cover?: string
}

function importedKeys(): string[] {
  try {
    const raw = localStorage.getItem(IMPORTED_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : []
  } catch {
    return []
  }
}

export function rememberImported(file: string): void {
  try {
    const done = importedKeys()
    if (done.includes(file)) return
    done.push(file)
    localStorage.setItem(IMPORTED_KEY, JSON.stringify(done))
  } catch {
    /* private mode or a full store — the song is in the library either way */
  }
}

/** Everything the extension has downloaded that is not here yet. */
export async function newDannifyDownloads(): Promise<DannifyDownload[]> {
  const gone = new AbortController()
  const timer = window.setTimeout(() => gone.abort(), 5000)
  try {
    const answer = await fetch(`${EXTENSION}/api/player/downloads`, {
      cache: 'no-store',
      signal: gone.signal,
    })
    if (!answer.ok) return []
    const body = (await answer.json()) as { tracks?: DannifyDownload[] }
    const done = new Set(importedKeys())
    return (body.tracks ?? []).filter((t) => t && t.file && t.url && !done.has(t.file))
  } catch {
    /* not running yet, or not this machine's port: nothing to bring in */
    return []
  } finally {
    window.clearTimeout(timer)
  }
}

/** Everything the account has liked that is not here yet.
 *
 * Likes are not files on disk — the extension lists them from YouTube Music,
 * which takes a moment, so this ask is patient where the downloads one is
 * quick. Each song's audio arrives over its own `url` (the extension's
 * stream route) the same way a download's does.
 */
export async function newDannifyLikes(): Promise<DannifyDownload[]> {
  const gone = new AbortController()
  const timer = window.setTimeout(() => gone.abort(), 20000)
  try {
    const answer = await fetch(`${EXTENSION}/api/player/likes`, {
      cache: 'no-store',
      signal: gone.signal,
    })
    if (!answer.ok) return []
    const body = (await answer.json()) as { tracks?: DannifyDownload[] }
    const done = new Set(importedKeys())
    return (body.tracks ?? []).filter((t) => t && t.file && t.url && !done.has(t.file))
  } catch {
    /* not running yet, not signed in, or not this machine's port */
    return []
  } finally {
    window.clearTimeout(timer)
  }
}

/** A finished download, heard the moment it happens.
 *
 *  The list above only says what is on disk — true, but only as often as it
 *  is asked. The extension announces every finished download on its own
 *  socket as it happens (see `player_bridge.py`), and this subscribes to
 *  that: each call to the handler is one song done, and whatever it triggers
 *  picks up only what is new.
 *
 *  The socket is retried every few seconds while this is subscribed, so the
 *  extension starting later (or restarting) is picked up without anybody
 *  asking. The returned function unsubscribes for good.
 */
export function onDannifyDownloadsDone(onDone: () => void): () => void {
  let socket: WebSocket | null = null
  let retry = 0
  let alive = true

  const connect = () => {
    if (!alive) return
    try {
      socket = new WebSocket('ws://127.0.0.1:8765/api/player/downloads-ws')
    } catch {
      retry = window.setTimeout(connect, 5000)
      return
    }
    /* every message this socket carries is a finished download */
    socket.onmessage = () => onDone()
    socket.onerror = () => socket?.close()
    socket.onclose = () => {
      if (alive) retry = window.setTimeout(connect, 5000)
    }
  }
  connect()

  return () => {
    alive = false
    window.clearTimeout(retry)
    socket?.close()
  }
}

const TYPES: Record<string, string> = {
  'audio/mp4': 'm4a',
  'audio/mpeg': 'mp3',
  'audio/flac': 'flac',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'audio/aac': 'aac',
  'audio/x-m4a': 'm4a',
}

function suffixFor(type: string, file: string): string {
  const known = TYPES[type.split(';')[0].trim().toLowerCase()]
  if (known) return `.${known}`
  /* A sealed container's own suffix says nothing: the audio inside is one of
     the ordinary encodings, and the extension names it on the way out. */
  const own = /\.[a-z0-9]+$/i.exec(file)?.[0].toLowerCase() ?? ''
  return own && own !== '.dnf' ? own : '.m4a'
}

/** The song itself, as a file this player can keep and play. */
export async function dannifyAudio(track: DannifyDownload): Promise<File> {
  const answer = await fetch(`${EXTENSION}${track.url}`)
  if (!answer.ok) throw new Error(`the extension answered ${answer.status}`)
  const blob = await answer.blob()
  const type = (answer.headers.get('content-type') ?? '').split(';')[0].trim()
  const name = `${track.artist ? `${track.artist} - ` : ''}${track.title}${suffixFor(type, track.file)}`
  return new File([blob], name, { type: type || 'audio/mp4' })
}

/**
 * The artwork, as a data URL.
 *
 * A data URL rather than the extension's address: the cover has to survive
 * the extension not running, and it is a few tens of kilobytes.
 */
export async function dannifyCover(track: DannifyDownload): Promise<string | undefined> {
  if (!track.cover) return undefined
  try {
    const answer = await fetch(`${EXTENSION}${track.cover}`)
    if (!answer.ok) return undefined
    const blob = await answer.blob()
    if (!blob.size) return undefined
    return await new Promise<string | undefined>((resolve) => {
      const reader = new FileReader()
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : undefined)
      reader.onerror = () => resolve(undefined)
      reader.readAsDataURL(blob)
    })
  } catch {
    return undefined
  }
}
