import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { getCurrentWindow } from '@tauri-apps/api/window'
import type { Track } from '../../hooks/useAudioEngine'
import { readTags } from '../../lib/tags'
import { loadLibrary, saveToLibrary, deleteFromLibrary, updateTrackMeta, saveOrder, loadOrder } from '../../lib/library'
import { bootReset } from '../../lib/bootReset'

/* the slice of the audio engine the playlist drives; Home owns the engine
   and injects it through a ref so there is no hook-ordering cycle */
export interface PlaylistEngine {
  trackIndex: number
  playing: boolean
  setIndexSilent: (i: number) => void
  stop: () => void
  select: (i: number, autoplay?: boolean) => void
}

export const fmt = (s: number) => {
  if (!Number.isFinite(s) || s <= 0) return '–:––'
  const m = Math.floor(s / 60)
  const ss = Math.floor(s % 60)
  return `${m}:${ss.toString().padStart(2, '0')}`
}

const AUDIO_RE = /\.(mp3|flac|wav|ogg|oga|m4a|m4b|aac|opus|webm|wma|aiff?|ape|mp4|mka|amr|mid|midi|wv|tta)$/i

const extOf = (name: string) => (name.match(/\.([a-z0-9]+)$/i)?.[1] ?? 'AUDIO').toUpperCase()

/* opening a native file dialog drops the window out of fullscreen —
   re-request it the moment the chooser closes (pick or cancel).
   Fullscreen is window-level (Tauri), so the DOM API's fullscreenElement
   would always read null here — ask the window instead. */
export function openFilePicker(input: HTMLInputElement | null) {
  if (!input) return
  let wasFs = false
  void getCurrentWindow()
    .isFullscreen()
    .then((fs) => (wasFs = fs))
    .catch(() => {})
  const restore = () => {
    if (!wasFs) return
    void getCurrentWindow()
      .isFullscreen()
      .then((fs) => {
        if (!fs) return getCurrentWindow().setFullscreen(true)
      })
      .catch(() => {})
  }
  input.addEventListener('change', restore, { once: true })
  input.addEventListener('cancel', restore, { once: true })
  input.click()
}

/* dropping a folder arrives as one opaque directory File that the audio
   filter silently discards — walk the entry tree so a whole album folder
   imports instead of "loading" zero tracks */
export async function filesFromDrop(dt: DataTransfer): Promise<File[]> {
  const entries = Array.from(dt.items ?? [])
    .filter((i) => i.kind === 'file')
    .map((i) => i.webkitGetAsEntry?.() ?? null) /* captured synchronously — the store dies after the event */
  if (!entries.some(Boolean)) return Array.from(dt.files)
  const out: File[] = []
  const walk = async (entry: FileSystemEntry | null): Promise<void> => {
    if (!entry) return
    if (entry.isFile) {
      const f = await new Promise<File | null>((res) => {
        ;(entry as FileSystemFileEntry).file(res, () => res(null))
      })
      if (f) out.push(f)
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader()
      for (;;) {
        /* readEntries yields ≤100 per call — loop until the directory is drained */
        const batch = await new Promise<FileSystemEntry[]>((res) => reader.readEntries(res, () => res([])))
        if (!batch.length) break
        for (const e of batch) await walk(e)
      }
    }
  }
  for (const e of entries) await walk(e)
  return out
}

function makeTrack(id: number, file: File, title: string, artist: string, cover?: string): Track {
  return { id, title, artist, genre: extOf(file.name), src: URL.createObjectURL(file), cover }
}

/**
 * A track that came from an online source.
 *
 * There is no file and no address here — just the provider's reference.
 * The audio is opened when the track is played, and the address it comes
 * from never reaches this code.
 */
function makeOnlineTrack(
  id: number,
  contentId: string,
  provider: string,
  title: string,
  artist: string,
  cover?: string,
): Track {
  return {
    id,
    title,
    artist,
    genre: 'ONLINE',
    /* Empty: the real source is resolved when the track is played. */
    src: '',
    cover,
    remote: { contentId, provider },
  }
}

/* ---- track durations: one shared cache + a single-flight queue ----
   each playlist row used to create its own <audio>, so importing N tracks
   opened N simultaneous metadata reads; probes now run one at a time and
   every row reuses the cached value on re-mount */
const durationCache = new Map<string, number>()
let durationChain: Promise<void> = Promise.resolve()

/* how often the import loop is allowed to touch React state (see the
   batcher in usePlaylist): long enough to keep big Add Files runs off the
   critical path, short enough that rows and the READING counter still
   visibly stream in */
const IMPORT_FLUSH_EVERY = 150

function probeDuration(src: string): Promise<number> {
  return new Promise((resolve) => {
    const a = new Audio()
    a.preload = 'metadata'
    let settled = false
    let timer = 0
    const finish = (d: number) => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      a.removeAttribute('src')
      durationCache.set(src, d)
      resolve(d)
    }
    timer = window.setTimeout(() => finish(0), 8000) /* a wedged probe can't stall the queue */
    a.addEventListener('loadedmetadata', () => finish(a.duration || 0), { once: true })
    a.addEventListener('error', () => finish(0), { once: true })
    a.src = src
  })
}

function readDuration(src: string): Promise<number> {
  const hit = durationCache.get(src)
  if (hit !== undefined) return Promise.resolve(hit)
  /* chain behind the in-flight probe — exactly one Audio element at a time */
  const next = durationChain.then(() => durationCache.get(src) ?? probeDuration(src))
  durationChain = next.then(
    () => undefined,
    () => undefined,
  )
  return next
}

/* resolves through the shared cache/queue; unmounting just detaches — the
   probe finishes in the background and warms the cache for later mounts.

   `enabled` lets a row ask only once it is on screen. Importing a whole
   album used to start one metadata probe per row the moment its row
   appeared — hundreds of `Audio` elements reading files back-to-back in a
   single-flight chain that could run for minutes, contending with the deck
   for the media pipeline the whole time ("play takes a beat after adding
   files"). The visible rows are the only ones whose duration anyone can
   see; the rest probe when they scroll into view, and the cache means a
   re-mount never pays for it twice. */
export function useDuration(src: string, enabled = true) {
  const [d, setD] = useState(() => durationCache.get(src) ?? 0)
  useEffect(() => {
    if (!enabled || !src) return
    let alive = true
    void readDuration(src).then((v) => {
      if (alive) setD(v)
    })
    return () => {
      alive = false
    }
  }, [src, enabled])
  return d
}

/** The total length of a view, from the durations already probed. The header's
 * count row shows it once every track in the view is known — rows probe as
 * they scroll into view, so it fills in without ever starting reads itself. */
export function durationStats(srcs: readonly string[]): { known: number; total: number } {
  let known = 0
  let total = 0
  for (const src of srcs) {
    const d = durationCache.get(src) ?? 0
    if (d > 0) {
      known += 1
      total += d
    }
  }
  return { known, total }
}

export function usePlaylist(engRef: RefObject<PlaylistEngine | null>) {
  const [localTracks, setLocalTracks] = useState<Track[]>([])
  const tracksRef = useRef(localTracks)
  /* sync after commit — event callbacks read it, never render (react-hooks/refs) */
  useEffect(() => {
    tracksRef.current = localTracks
  }, [localTracks])

  const fileInputRef = useRef<HTMLInputElement>(null)
  const m3uInputRef = useRef<HTMLInputElement>(null)
  const pendingOrderRef = useRef<string[] | null>(null)
  const [importHint, setImportHint] = useState<string | null>(null)
  const [importing, setImporting] = useState<{ total: number; done: number } | null>(null)
  /* boot indicator: tiny loading sign while the library restores, then a tick */
  const [boot, setBoot] = useState<'loading' | 'ready' | null>('loading')

  /* ---- import state lands in batches, not per file ----
     Each imported file used to call setLocalTracks AND setImporting, so
     adding N files re-rendered the whole Home tree twice per file — N
     growing lists, N growing tracklists — and the main thread stayed busy
     with reconciliation while a play press on a just-added row waited
     behind it. Rows and the READING counter now queue and land in one
     commit every IMPORT_FLUSH_EVERY ms (and once more at the end, exact). */
  const appendBufRef = useRef<Track[]>([])
  const progressBufRef = useRef<{ total: number; done: number } | null>(null)
  const flushTimerRef = useRef<number | undefined>(undefined)

  const flushImport = useCallback(() => {
    if (flushTimerRef.current !== undefined) {
      window.clearTimeout(flushTimerRef.current)
      flushTimerRef.current = undefined
    }
    const buf = appendBufRef.current
    if (buf.length) {
      appendBufRef.current = []
      setLocalTracks((prev) => [...prev, ...buf])
    }
    const prog = progressBufRef.current
    if (prog) {
      progressBufRef.current = null
      setImporting(prog)
    }
  }, [])

  /* queue a row and/or a progress reading; the first one arms the timer */
  const queueImport = useCallback(
    (track: Track | null, progress: { total: number; done: number } | null) => {
      if (track) appendBufRef.current.push(track)
      if (progress) progressBufRef.current = progress
      if (flushTimerRef.current === undefined) {
        flushTimerRef.current = window.setTimeout(flushImport, IMPORT_FLUSH_EVERY)
      }
    },
    [flushImport],
  )

  /* a queued flush must never outlive the hook */
  useEffect(() => () => window.clearTimeout(flushTimerRef.current), [])

  /* import a single audio file into the library: tags read, blob-url track
     built, persisted to IndexedDB, and appended to the live track list.
     Returns the track (or null when it could not be saved to disk). */
  const importFile = useCallback(
    async (file: File): Promise<Track | null> => {
      const tags = await readTags(file).catch(() => ({}) as { title?: string; artist?: string; cover?: string })
      const id = Date.now() + Math.floor(Math.random() * 1000)
      const title = tags.title || file.name.replace(/\.[a-z0-9]+$/i, '')
      const artist = tags.artist || 'LOCAL FILE'
      const track = makeTrack(id, file, title, artist, tags.cover)
      /* row appears with the next batch flush — but the counter only
         advances once IndexedDB has the blob: the old fire-and-forget put
         could fail or be aborted by a quick close, leaving "loaded" tracks
         that vanished on the next launch */
      queueImport(track, null)
      const saved = await saveToLibrary({ id, file, title, artist, cover: tags.cover })
      if (!saved) {
        setImportHint('TRACK NOT SAVED TO DISK')
        window.setTimeout(() => setImportHint(null), 3000)
        return null
      }
      return track
    },
    [queueImport, setImportHint],
  )

  /**
   * Add a file whose details are already known.
   *
   * A song downloaded in the online extension arrives with its own title,
   * artist and cover, taken from the same entry Dannify shows. Reading the
   * tags back out of the audio would only disagree with them (and a sealed
   * container has no readable tags at all), so they are taken as given.
   */
  const addSavedTrack = useCallback(
    async (entry: {
      file: File
      title: string
      artist: string
      cover?: string
    }): Promise<Track | null> => {
      const id = Date.now() + Math.floor(Math.random() * 1000)
      const title = entry.title || entry.file.name.replace(/\.[a-z0-9]+$/i, '')
      const artist = entry.artist || 'LOCAL FILE'
      const track = makeTrack(id, entry.file, title, artist, entry.cover)
      setLocalTracks((prev) => [...prev, track])
      const saved = await saveToLibrary({ id, file: entry.file, title, artist, cover: entry.cover })
      if (!saved) {
        setImportHint('TRACK NOT SAVED TO DISK')
        window.setTimeout(() => setImportHint(null), 3000)
        return null
      }
      return track
    },
    [setImportHint],
  )

  /**
   * Add a track that came from an online source.
   *
   * Only the reference is stored — the provider's address is not kept, and
   * the audio is opened when the track is played.
   */
  const addOnlineTrack = useCallback(
    async (entry: {
      contentId: string
      provider: string
      title: string
      artist: string
      album?: string
      cover?: string
    }): Promise<Track | null> => {
      const id = Date.now() + Math.floor(Math.random() * 1000)
      const track = makeOnlineTrack(
        id,
        entry.contentId,
        entry.provider,
        entry.title || 'UNTITLED',
        entry.artist || 'UNKNOWN ARTIST',
        entry.cover,
      )
      setLocalTracks((prev) => [...prev, track])
      const saved = await saveToLibrary({
        id,
        remote: { contentId: entry.contentId, provider: entry.provider },
        title: track.title,
        artist: track.artist,
        cover: entry.cover,
      })
      if (!saved) {
        setImportHint('TRACK NOT SAVED TO DISK')
        window.setTimeout(() => setImportHint(null), 3000)
        return null
      }
      return track
    },
    [setImportHint],
  )

  const addFiles = useCallback(async (files: FileList | File[] | null, onAdded?: (track: Track) => void) => {
    if (!files?.length) return
    const all = Array.from(files)
    const list = all.filter((f) => AUDIO_RE.test(f.name) || f.type.startsWith('audio'))
    const skipped = all.length - list.length
    if (!list.length) {
      /* never drop files silently — say why nothing appeared */
      if (skipped) setImportHint(`${skipped} FILE${skipped > 1 ? 'S' : ''} SKIPPED — NOT AUDIO`)
      return
    }
    setImporting({ total: list.length, done: 0 })
    const base = tracksRef.current /* synced before this import started */
    const added: Track[] = []
    let failed = 0
    let done = 0
    for (const f of list) {
      const track = await importFile(f)
      if (track) {
        added.push(track)
        onAdded?.(track)
      } else failed++
      done++
      queueImport(null, { total: list.length, done })
    }
    /* land whatever the batcher is holding before the exact final state
       below, so no queued row can arrive after the list is rebuilt */
    flushImport()
    /* rebuild from what we know — never from a ref whose commit may not
       have flushed yet; if an m3u8 import is pending, rank the newcomers */
    let finalList = [...base, ...added]
    const order = pendingOrderRef.current
    if (order?.length) {
      const rank = (t: Track) => {
        const i = order.findIndex(
          (nm) => nm.toLowerCase() === t.title.toLowerCase() || nm.toLowerCase().includes(t.title.toLowerCase()),
        )
        return i === -1 ? order.length : i
      }
      finalList = [...finalList].sort((a, b) => rank(a) - rank(b))
      pendingOrderRef.current = null
      setImportHint(null)
    }
    setLocalTracks(finalList)
    /* adds never used to persist an order at all — without this the restored
       library falls back to id order and can shuffle after a restart */
    void saveOrder(finalList.map((t) => t.id))
    setImporting(null)
    if (failed) setImportHint(`${failed} TRACK${failed > 1 ? 'S' : ''} NOT SAVED TO DISK`)
    else if (skipped) setImportHint(`${skipped} FILE${skipped > 1 ? 'S' : ''} SKIPPED — NOT AUDIO`)
  }, [importFile, queueImport, flushImport])

  /* restore the persisted library (audio blobs live in IndexedDB) */
  useEffect(() => {
    let alive = true
    let readyTimer: number | undefined
    void bootReset
      .then(() => Promise.all([loadLibrary(), loadOrder()]))
      .then(([entries, order]) => {
        if (!alive) return
        if (!entries.length) {
          setBoot(null)
          return
        }
        const rank = new Map(order.map((id, i) => [id, i]))
        const sorted = [...entries].sort(
          (a, b) => (rank.get(a.id) ?? entries.length) - (rank.get(b.id) ?? entries.length),
        )
        setLocalTracks(
          sorted.map((e) =>
            e.file
              ? makeTrack(e.id, e.file, e.title, e.artist, e.cover)
              : e.remote
                ? makeOnlineTrack(
                    e.id,
                    e.remote.contentId,
                    e.remote.provider,
                    e.title,
                    e.artist,
                    e.cover,
                  )
                : null,
          ).filter((t): t is Track => t !== null),
        )
        setBoot('ready')
        readyTimer = window.setTimeout(() => setBoot(null), 2000)
      })
      .catch(() => {
        if (alive) setBoot(null)
      })
    return () => {
      alive = false
      window.clearTimeout(readyTimer)
    }
  }, [])

  /* drag to reorder */
  const reorderTracks = useCallback(
    (from: number | null, to: number) => {
      if (from == null || from === to) return
      const e = engRef.current
      const lt = tracksRef.current
      if (!e) return
      if (from < 0 || from >= lt.length || to < 0 || to >= lt.length) return
      const next = [...lt]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      setLocalTracks(next)
      void saveOrder(next.map((t) => t.id))
      /* keep the audio engine pointing at the same song */
      const playingId = lt[e.trackIndex]?.id
      const newIndex = next.findIndex((t) => t.id === playingId)
      if (newIndex !== -1 && newIndex !== e.trackIndex) e.setIndexSilent(newIndex)
    },
    [engRef],
  )

  /* export / import the playlist as a standard m3u8 */
  const exportM3u = useCallback(() => {
    const lt = tracksRef.current
    if (!lt.length) return
    const lines = ['#EXTM3U', '#PLAYLIST:MUN15H MD Walkman']
    lt.forEach((t) => {
      lines.push(`#EXTINF:-1,${t.artist} - ${t.title}`)
      lines.push(`${t.title.replace(/[\\/:*?"<>|]/g, '_')}.${t.genre.toLowerCase()}`)
    })
    const blob = new Blob([lines.join('\n')], { type: 'audio/x-mpegurl' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'MUN15H-md-playlist.m3u8'
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 5000)
  }, [])

  const importM3u = useCallback(async (file: File | undefined) => {
    if (!file) return
    const text = await file.text()
    const names = text
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'))
    if (!names.length) return
    pendingOrderRef.current = names
    setImportHint(`${names.length} PENDING — SELECT THE AUDIO FILES`)
    openFilePicker(fileInputRef.current)
  }, [])

  /* `removeTrackAt` — deleting a track must not decide, by itself, that the
     music stops (1.10):

       - the current track, PLAYING  → the sound keeps going after the row
         is gone. The element holds the file; the slot the victim leaves
         shows the next track. The victim's object URL is deliberately NOT
         revoked — revoking it under a playing element is exactly what would
         kill the sound that must continue.
       - the current track, PAUSED   → the playhead parks on the next track,
         so RESUME starts that one rather than the deleted file.
       - any other track             → indices above it shift down. */
  const removeTrackAt = useCallback((globalIndex: number) => {
    const e = engRef.current
    const lt = tracksRef.current
    const victim = lt[globalIndex]
    if (!victim) return
    const isCurrent = !!e && globalIndex === e.trackIndex
    const keepAudio = isCurrent && !!e.playing
    if (!keepAudio) URL.revokeObjectURL(victim.src)
    durationCache.delete(victim.src)
    void deleteFromLibrary(victim.id)
    const newLocal = lt.filter((t) => t.id !== victim.id)
    setLocalTracks(newLocal)
    void saveOrder(newLocal.map((t) => t.id))
    if (!e) return
    if (isCurrent) {
      if (keepAudio) {
        /* Still audible. The index must park where a subsequent AUTO-ADVANCE
           lands on the track that FOLLOWS the victim, not skip it: the slot
           numbers all shifted down, so the old slot now holds the next
           track — parking one behind it (or on the last slot when the
           victim was first, so the wrap-around reaches slot 0) keeps
           …A, victim, next… in order when this audio ends. */
        if (newLocal.length > 0) {
          const parked = globalIndex > 0 ? globalIndex - 1 : newLocal.length - 1
          e.setIndexSilent(parked)
        }
        /* empty list: nothing to park on — the element finishes the
           survivor on its own, exactly as the rule demands */
      } else if (newLocal.length === 0) {
        e.stop()
      } else {
        /* paused: park on the next track's slot so RESUME plays it */
        e.select(Math.min(globalIndex, newLocal.length - 1), false)
      }
    } else if (globalIndex < e.trackIndex) {
      e.setIndexSilent(e.trackIndex - 1)
    }
  }, [engRef])

  const onSelect = useCallback((i: number) => engRef.current?.select(i), [engRef])

  /* correct a track's title/artist. The playlist keeps ids, so the edit is
     keyed by id and never disturbs playback (the engine re-reads the title
     from the list on its next render) */
    const renameTrack = useCallback(
      async (id: number, title: string, artist: string, cover?: string) => {
        const t = title.trim()
        const a = artist.trim()
        if (!t) return
        setLocalTracks((lt) => lt.map((x) => (x.id === id ? { ...x, title: t, artist: a, ...(cover !== undefined ? { cover } : {}) } : x)))
        const ok = await updateTrackMeta(id, t, a, cover)
      if (!ok) {
        setImportHint('EDIT NOT SAVED TO DISK')
        window.setTimeout(() => setImportHint(null), 3000)
      }
    },
    [setImportHint],
  )

  return {
    tracks: localTracks,
    boot,
    importing,
    importHint,
    setImportHint,
    fileInputRef,
    m3uInputRef,
    addFiles,
    addSavedTrack,
    addOnlineTrack,
    importFile,
    removeTrackAt,
    onSelect,
    renameTrack,
    reorderTracks,
    exportM3u,
    importM3u,
    openAudioPicker: () => openFilePicker(fileInputRef.current),
    openM3uPicker: () => openFilePicker(m3uInputRef.current),
  }
}
