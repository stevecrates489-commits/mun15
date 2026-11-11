/* ============================================================================
 * ARCHIVED — the CD is gone from the player.
 *
 * Nothing outside `src/archived/` imports this file, so it is tree-shaken out
 * of the bundle and never reaches the screen. It is kept so the feature can
 * come back without being rewritten. See ./README.md for the restore steps.
 * ========================================================================== */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  clearDiscArt,
  clearDiscArtCollection,
  deleteDiscArtFromCollection,
  listDiscArtCollection,
  loadDiscArt,
  saveDiscArt,
  saveDiscArtToCollection,
} from '../../lib/library'

/* Which artwork dresses the disc when nobody asked for something specific.

   Both follow modes ship ON — a playlist poster or the playing track's cover
   presses its own disc, which is the look the player was built around. They
   are switches, not fixtures: turning one off hands the disc back to the next
   layer down.

   The upload is the DEFAULT face, not a mode: it is what the disc wears when
   no cover/poster is available, and the two toggles decide whether a cover may
   outrank it. Uploading therefore leaves the toggles exactly as the user set
   them — flipping them behind the user's back is its own kind of bug. When a
   cover is winning at that moment, the panel says so instead of silently
   showing the same artwork, which is what "replace does nothing" looked like. */
export const TRACK_ART_KEY = 'md-disc-art-track'
export const PLAYLIST_ART_KEY = 'md-disc-art-playlist'

/* the disc renders at ~500px — anything past 1024 is wasted memory */
const DISC_ART_MAX = 1024
/* a phone photo can be 20MB; anything past this is not disc art */
const DISC_ART_LIMIT = 40 * 1024 * 1024

/**
 * User-supplied disc art. The upload is center-cropped to a square (the disc
 * is round, and stretching a portrait photo across it looked wrong), scaled to
 * DISC_ART_MAX and re-encoded as webp — a 1024² webp is a few hundred KB,
 * which keeps the IndexedDB write cheap and the swap instant.
 *
 * The blob lives in IDB next to the wallpaper; the <img> gets an object URL so
 * a returned disc repaints immediately instead of re-decoding a data URL.
 */
export function useDiscArt() {
  const [url, setUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  /* "persistent" art: the disc keeps wearing the playing track's cover, or the
     open playlist's poster. Persisted alongside the other cd settings. */
  const [trackArt, setTrackArtState] = useState(() => localStorage.getItem(TRACK_ART_KEY) !== '0')
  const [playlistArt, setPlaylistArtState] = useState(() => localStorage.getItem(PLAYLIST_ART_KEY) !== '0')
  /* a short confirmation after an upload. It says the face was SAVED and not
     necessarily VISIBLE, which is the whole confusion this feature had: the
     uploaded label is the default, so a cover outranks it until you toggle. */
  const [pressNote, setPressNote] = useState<string | null>(null)
  const noteTimer = useRef(0)
  useEffect(() => () => window.clearTimeout(noteTimer.current), [])
  const setTrackArt = useCallback((on: boolean) => {
    setTrackArtState(on)
    localStorage.setItem(TRACK_ART_KEY, on ? '1' : '0')
    setPressNote(null) /* the user is steering now — drop the hint */
  }, [])
  const setPlaylistArt = useCallback((on: boolean) => {
    setPlaylistArtState(on)
    localStorage.setItem(PLAYLIST_ART_KEY, on ? '1' : '0')
    setPressNote(null) /* the user is steering now — drop the hint */
  }, [])
  const urlRef = useRef<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  /* replace the live URL, revoking the old one — never leak an object URL */
  const adopt = useCallback((blob: Blob | null) => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current)
    urlRef.current = blob ? URL.createObjectURL(blob) : null
    setUrl(urlRef.current)
  }, [])

  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current)
      urlRef.current = null
    },
    []
  )

  /* hydrate once — a custom disc is a viewing choice and outlives a reload */
  useEffect(() => {
    let alive = true
    void (async () => {
      const blob = await loadDiscArt()
      if (!alive) return
      adopt(blob)
    })()
    return () => {
      alive = false
    }
  }, [adopt])

  /* ---- the collection: every uploaded face, kept and re-wearable ---- */
  const [collection, setCollection] = useState<{ id: string; blob: Blob; url: string; at: number }[]>([])
  const collectionRef = useRef(collection)
  useEffect(() => {
    collectionRef.current = collection
  }, [collection])

  const refreshCollection = useCallback(async () => {
    const recs = await listDiscArtCollection()
    /* drop URLs for records that no longer exist, keep the live ones */
    const alive = new Set(recs.map((r) => r.id))
    for (const item of collectionRef.current) {
      if (!alive.has(item.id)) URL.revokeObjectURL(item.url)
    }
    setCollection(recs.map((r) => ({ id: r.id, blob: r.file, url: URL.createObjectURL(r.file), at: r.at })))
  }, [])

  /* hydrate the collection alongside the current face */
  useEffect(() => {
    let alive = true
    void (async () => {
      const recs = await listDiscArtCollection()
      if (!alive) return
      setCollection(recs.map((r) => ({ id: r.id, blob: r.file, url: URL.createObjectURL(r.file), at: r.at })))
    })()
    return () => {
      alive = false
    }
  }, [])

  /* every object URL minted for the collection dies with the session */
  useEffect(
    () => () => {
      for (const item of collectionRef.current) URL.revokeObjectURL(item.url)
    },
    [],
  )

  /* wear a face from the collection: it becomes the saved default, exactly
     like a fresh upload — and the current one is never removed from the list */
  const applyFromCollection = useCallback(
    async (id: string) => {
      const item = collectionRef.current.find((c) => c.id === id)
      if (!item || busy) return
      await saveDiscArt(item.blob)
      adopt(item.blob)
      window.clearTimeout(noteTimer.current)
      setPressNote('FACE FROM THE COLLECTION SAVED')
      noteTimer.current = window.setTimeout(() => setPressNote(null), 6000)
    },
    [adopt, busy],
  )

  const removeFromCollection = useCallback(async (id: string) => {
    await deleteDiscArtFromCollection(id)
    const item = collectionRef.current.find((c) => c.id === id)
    if (item) URL.revokeObjectURL(item.url)
    setCollection((prev) => prev.filter((c) => c.id !== id))
  }, [])

  const clearCollection = useCallback(async () => {
    await clearDiscArtCollection()
    for (const item of collectionRef.current) URL.revokeObjectURL(item.url)
    setCollection([])
  }, [])

  const pick = useCallback(
    async (file: File | null | undefined) => {
      if (!file || busy) return
      if (!file.type.startsWith('image/')) return
      if (file.size > DISC_ART_LIMIT) return
      setBusy(true)
      try {
        const blob = await rasterizeSquare(file, DISC_ART_MAX)
        await saveDiscArt(blob)
        await saveDiscArtToCollection(blob)
        adopt(blob)
        void refreshCollection()
        /* the toggles are left alone on purpose (see the header comment):
           this upload becomes the default face, and the panel reports which
           layer is actually winning right now */
        window.clearTimeout(noteTimer.current)
        setPressNote('DEFAULT FACE SAVED')
        noteTimer.current = window.setTimeout(() => setPressNote(null), 6000)
      } catch {
        /* unsupported or corrupt image — keep whatever is on the disc now */
      } finally {
        setBusy(false)
      }
    },
    [adopt, busy, refreshCollection]
  )

  const reset = useCallback(async () => {
    await clearDiscArt()
    adopt(null)
    setPressNote(null)
  }, [adopt])

  return {
    url,
    busy,
    inputRef,
    pick,
    reset,
    trackArt,
    playlistArt,
    setTrackArt,
    setPlaylistArt,
    pressNote,
    collection,
    applyFromCollection,
    removeFromCollection,
    clearCollection,
    refreshCollection,
  }
}

/* center-crop → square → downscale → webp (png fallback) */
async function rasterizeSquare(file: File, size: number): Promise<Blob> {
  let src: ImageBitmap | HTMLImageElement
  try {
    /* honors EXIF rotation, where a raw HTMLImageElement does not */
    src = await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    src = await new Promise<HTMLImageElement>((res, rej) => {
      const url = URL.createObjectURL(file)
      const img = new Image()
      img.onload = () => {
        URL.revokeObjectURL(url)
        res(img)
      }
      img.onerror = () => {
        URL.revokeObjectURL(url)
        rej(new Error('decode failed'))
      }
      img.src = url
    })
  }

  const w = src.width
  const h = src.height
  const side = Math.min(w, h)
  const out = Math.max(1, Math.min(side, size))
  const canvas = document.createElement('canvas')
  canvas.width = out
  canvas.height = out
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('no 2d context')
  ctx.drawImage(src, (w - side) / 2, (h - side) / 2, side, side, 0, 0, out, out)
  if ('close' in src) src.close()

  const webp = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/webp', 0.9))
  if (webp) return webp
  const png = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'))
  if (!png) throw new Error('encode failed')
  return png
}
