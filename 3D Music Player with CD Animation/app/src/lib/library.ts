export interface StoredTrack {
  id: number
  /**
   * The audio itself, for a track that came from a file.
   *
   * An online track has no file: it has a `remote` reference instead, and
   * the bytes are fetched when it is played.
   */
  file?: File
  /**
   * Where an online track came from: `provider:external-id`.
   *
   * Only the reference is kept. The address the music comes from is not
   * stored — not here, not anywhere — because it expires, and because a
   * stored address is a liability.
   */
  remote?: { contentId: string; provider: string }
  title: string
  artist: string
  cover?: string
}

export interface StoredWallpaper {
  type: 'image' | 'video'
  file: File
  /* the untouched source video, kept so quality can be re-chosen later */
  original?: File
}

const DB_NAME = 'md-walkman'
const STORE = 'tracks'
const META = 'meta'
const LYRICS = 'lyrics'

/* singleton connection — opening a new IDB connection per operation leaks
   them (browsers cap concurrent connections) and can deadlock version
   changes. Open once, reuse forever. */
let dbPromise: Promise<IDBDatabase> | null = null
function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((res, rej) => {
      const req = indexedDB.open(DB_NAME, 3)
      req.onupgradeneeded = () => {
        const db = req.result
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' })
        if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: 'key' })
        if (!db.objectStoreNames.contains(LYRICS)) db.createObjectStore(LYRICS, { keyPath: 'key' })
      }
      req.onsuccess = () => res(req.result)
      req.onerror = () => rej(req.error)
    })
  }
  return dbPromise
}

function put<T>(db: IDBDatabase, store: string, value: T): Promise<void> {
  return new Promise((res, rej) => {
    const tx = db.transaction(store, 'readwrite')
    tx.objectStore(store).put(value)
    tx.oncomplete = () => res()
    tx.onerror = () => rej(tx.error)
  })
}

function getAll<T>(db: IDBDatabase, store: string): Promise<T[]> {
  return new Promise((res, rej) => {
    const req = db.transaction(store, 'readonly').objectStore(store).getAll()
    req.onsuccess = () => res((req.result as T[]) ?? [])
    req.onerror = () => rej(req.error)
  })
}

/* File objects survive structured clone, so the actual audio blobs are
   persisted — the library survives reloads with no server involved */
export async function loadLibrary(): Promise<StoredTrack[]> {
  try {
    const db = await openDb()
    return await getAll<StoredTrack>(db, STORE)
  } catch {
    return []
  }
}

/* returns false when the write didn't land (quota / private mode) so the
   caller can surface it instead of silently losing the track on restart */
export async function saveToLibrary(entry: StoredTrack): Promise<boolean> {
  try {
    const db = await openDb()
    await put(db, STORE, entry)
    return true
  } catch {
    return false
  }
}

export async function deleteFromLibrary(id: number): Promise<void> {
  try {
    const db = await openDb()
    await new Promise<void>((res, rej) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).delete(id)
      tx.oncomplete = () => res()
      tx.onerror = () => rej(tx.error)
    })
  } catch {}
}

/* correct a track's title/artist. ID3 tags are routinely missing or wrong,
   and lyrics matching needs BOTH to be right — without this a badly tagged
   import is stuck fetching someone else's lyrics forever */
export async function updateTrackMeta(id: number, title: string, artist: string, cover?: string): Promise<boolean> {
  try {
    const db = await openDb()
    const existing = await new Promise<StoredTrack | undefined>((res, rej) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(id)
      req.onsuccess = () => res(req.result)
      req.onerror = () => rej(req.error)
    })
    if (!existing) return false
    await put(db, STORE, { ...existing, title, artist, ...(cover !== undefined ? { cover } : {}) })
    return true
  } catch {
    return false
  }
}

/* playlist ordering lives in meta as a single id array */
export async function saveOrder(ids: number[]): Promise<void> {
  try {
    const db = await openDb()
    await put(db, META, { key: 'order', ids })
  } catch {}
}

export async function loadOrder(): Promise<number[]> {
  try {
    const db = await openDb()
    const rec = await new Promise<{ key: string; ids: number[] } | undefined>((res, rej) => {
      const req = db.transaction(META, 'readonly').objectStore(META).get('order')
      req.onsuccess = () => res(req.result)
      req.onerror = () => rej(req.error)
    })
    return rec?.ids ?? []
  } catch {
    return []
  }
}

/* custom wallpaper (image or video file) */
export async function saveWallpaper(w: StoredWallpaper): Promise<void> {
  try {
    const db = await openDb()
    await put(db, META, { key: 'wallpaper', ...w })
  } catch {}
}

export async function loadWallpaper(): Promise<StoredWallpaper | null> {
  try {
    const db = await openDb()
    const rec = await new Promise<(StoredWallpaper & { key: string }) | undefined>((res, rej) => {
      const req = db.transaction(META, 'readonly').objectStore(META).get('wallpaper')
      req.onsuccess = () => res(req.result)
      req.onerror = () => rej(req.error)
    })
    return rec ? { type: rec.type, file: rec.file } : null
  } catch {
    return null
  }
}

export async function clearWallpaper(): Promise<void> {
  try {
    const db = await openDb()
    await new Promise<void>((res, rej) => {
      const tx = db.transaction(META, 'readwrite')
      tx.objectStore(META).delete('wallpaper')
      tx.oncomplete = () => res()
      tx.onerror = () => rej(tx.error)
    })
  } catch {}
}

/* custom disc art — ONE image blob (a real MiniDisc only ever holds one label) */
export async function saveDiscArt(file: Blob): Promise<void> {
  try {
    const db = await openDb()
    await put(db, META, { key: 'discArt', file })
  } catch {
    /* private mode / quota — the disc keeps whatever it already shows */
  }
}

export async function loadDiscArt(): Promise<Blob | null> {
  try {
    const db = await openDb()
    const rec = await new Promise<{ key: string; file: Blob } | undefined>((res, rej) => {
      const req = db.transaction(META, 'readonly').objectStore(META).get('discArt')
      req.onsuccess = () => res(req.result)
      req.onerror = () => rej(req.error)
    })
    /* a File survives the clone, but type-check it anyway — a stale record
       from an older shape must not reach an <img src> */
    return rec?.file instanceof Blob ? rec.file : null
  } catch {
    return null
  }
}

export async function clearDiscArt(): Promise<void> {
  try {
    const db = await openDb()
    await new Promise<void>((res, rej) => {
      const tx = db.transaction(META, 'readwrite')
      tx.objectStore(META).delete('discArt')
      tx.oncomplete = () => res()
      tx.onerror = () => rej(tx.error)
    })
  } catch {
    /* nothing to clear, or the store is unreachable — either way it's gone */
  }
}

/* ---- local lyrics ----
   One record per track. `ttml` is the only format stored, because handing it
   to the component's `ttml` property renders the lyrics with ZERO network
   requests — that is the whole point of pinning. `offsetMs` rides along
   because a mis-timed source stays mis-timed: the correction is part of what
   makes the pinned copy correct, so it is pinned with it. */
export interface LocalLyrics {
  key: string
  title: string
  artist: string
  ttml: string
  /* provider that served it ('lrc.red', …) or 'custom' when the user wrote it */
  source: string
  custom: boolean
  savedAt: number
}

export async function saveLocalLyrics(entry: LocalLyrics): Promise<boolean> {
  /* never persist something that would render as "no lyrics found" — a
     record like that shadows the live fetch for good */
  if (!storedLyricsAreUsable(entry.ttml)) return false
  try {
    const db = await openDb()
    await put(db, LYRICS, entry)
    return true
  } catch {
    /* private mode / quota — the caller surfaces it */
    return false
  }
}

/* Does a stored TTML actually contain a singable line?
   A record written while the element had nothing loaded (the PIN-during-load
   race) holds a string with no <p> content. Handed to the component that
   renders nothing, and because the record lives in IndexedDB it shadows the
   live fetch forever — including across reloads. So a line-less record is
   treated as absent and purged rather than served. */
export const storedLyricsAreUsable = (ttml: string): boolean => {
  if (!ttml.trim()) return false
  try {
    const doc = new DOMParser().parseFromString(ttml, 'text/xml')
    if (doc.querySelector('parsererror')) return false
    return Array.from(doc.querySelectorAll('p')).some((p) => (p.textContent ?? '').trim().length > 0)
  } catch {
    return false
  }
}

export async function loadLocalLyrics(key: string): Promise<LocalLyrics | null> {
  try {
    const db = await openDb()
    const rec = await new Promise<LocalLyrics | undefined>((res, rej) => {
      const req = db.transaction(LYRICS, 'readonly').objectStore(LYRICS).get(key)
      req.onsuccess = () => res(req.result)
      req.onerror = () => rej(req.error)
    })
    /* an older/foreign record must never reach the component as a ttml string */
    if (!rec || typeof rec.ttml !== 'string') return null
    if (!storedLyricsAreUsable(rec.ttml)) {
      /* purge — a broken record must never outlive the mistake that made it */
      void deleteLocalLyrics(key)
      return null
    }
    return rec
  } catch {
    return null
  }
}

/* ---- per-track sync offset ----
   Lives apart from the lyrics record on purpose: a correction is valid for a
   song whatever its lyric source, and it must survive unpinning / re-pinning.
   Absent record means 0 — every track starts there, which is the whole point. */
const OFFSET_PREFIX = 'lyric-offset:'

export async function saveTrackOffset(key: string, ms: number): Promise<boolean> {
  try {
    const db = await openDb()
    await put(db, META, { key: OFFSET_PREFIX + key, ms })
    return true
  } catch {
    return false
  }
}

export async function loadTrackOffset(key: string): Promise<number> {
  try {
    const db = await openDb()
    const rec = await new Promise<{ key: string; ms?: number } | undefined>((res, rej) => {
      const req = db.transaction(META, 'readonly').objectStore(META).get(OFFSET_PREFIX + key)
      req.onsuccess = () => res(req.result)
      req.onerror = () => rej(req.error)
    })
    const ms = Number(rec?.ms)
    /* a record written before offsets existed must not poison the clock */
    return Number.isFinite(ms) ? ms : 0
  } catch {
    return 0
  }
}

export async function deleteTrackOffset(key: string): Promise<void> {
  try {
    const db = await openDb()
    await new Promise<void>((res, rej) => {
      const tx = db.transaction(META, 'readwrite')
      tx.objectStore(META).delete(OFFSET_PREFIX + key)
      tx.oncomplete = () => res()
      tx.onerror = () => rej(tx.error)
    })
  } catch {
    /* nothing to delete, or the store is unreachable — either way it's gone */
  }
}

export async function deleteLocalLyrics(key: string): Promise<void> {
  try {
    const db = await openDb()
    await new Promise<void>((res, rej) => {
      const tx = db.transaction(LYRICS, 'readwrite')
      tx.objectStore(LYRICS).delete(key)
      tx.oncomplete = () => res()
      tx.onerror = () => rej(tx.error)
    })
  } catch {
    /* nothing to delete, or the store is unreachable — either way it's gone */
  }
}
