import { useCallback, useEffect, useState } from 'react'

export interface PlaylistFolder {
  id: number
  name: string
  trackIds: number[]
  image?: string
}

const STORAGE_KEY = 'md-playlists'

/* Reserved system playlist. Favourites ARE this folder's track list — one
   source of truth, so starring a track and seeing it in the Favourites
   playlist can never disagree (and persist together). Date.now() ids can
   never collide with -1. */
export const FAVOURITES_FOLDER_ID = -1
export const FAVOURITES_FOLDER_NAME = 'FAVOURITES'

/* Where the songs downloaded in the online extension land. Reserved like
   Favourites, for the same reason: the sync that fills it has to be able to
   name it without having created it, and whoever deletes it must get a
   fresh one on the next download rather than a duplicate. */
export const DOWNLOADS_FOLDER_ID = -2
export const DOWNLOADS_FOLDER_NAME = 'Downloads Online'

/* The songs liked in the online extension used to land in a folder of their
   own ("LIKED ONLINE", id -3) — an identifier on them that was asked out of
   the playlist list. The songs themselves are library imports and stay
   exactly where they are; only the grouping is gone, and a folder saved by
   an older build is dropped on load for the same reason. FAVOURITES stays
   this player's own list of stars: an extension like never arrives as one. */
const LEGACY_LIKED_FOLDER_ID = -3

function load(): PlaylistFolder[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (f): f is PlaylistFolder =>
        f &&
        typeof f.id === 'number' &&
        f.id !== LEGACY_LIKED_FOLDER_ID &&
        typeof f.name === 'string' &&
        Array.isArray(f.trackIds),
    )
  } catch {
    return []
  }
}

function persist(folders: PlaylistFolder[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(folders))
  } catch {
    /* storage full or private mode — playlists stay in memory only */
  }
}

export function usePlaylists() {
  const [folders, setFolders] = useState<PlaylistFolder[]>(load)

  useEffect(() => {
    persist(folders)
  }, [folders])

  /* Creating is instant: no dialog, no confirm — the drawer opens the new
     row straight into an inline rename with its name selected, so typing
     replaces it and Enter is enough. Returns the new id so the caller can
     put the caret there. */
  const createFolder = useCallback((name?: string, trackIds: number[] = []) => {
    const id = Date.now()
    setFolders((prev) => [
      ...prev,
      {
        id,
        name: name?.trim() || `Playlist ${String(prev.length + 1).padStart(2, '0')}`,
        trackIds,
      },
    ])
    return id
  }, [])

  /* undo for a deleted playlist: the folder goes back where it was, not at
     the end, so an accidental delete costs nothing */
  const restoreFolder = useCallback((folder: PlaylistFolder, index?: number) => {
    setFolders((prev) => {
      if (prev.some((f) => f.id === folder.id)) return prev
      const at = index == null ? prev.length : Math.max(0, Math.min(index, prev.length))
      const next = [...prev]
      next.splice(at, 0, folder)
      return next
    })
  }, [])

  const duplicateFolder = useCallback((id: number) => {
    setFolders((prev) => {
      const at = prev.findIndex((f) => f.id === id)
      if (at === -1) return prev
      const src = prev[at]
      const copy: PlaylistFolder = {
        id: Date.now(),
        name: `${src.name} copy`,
        trackIds: [...src.trackIds],
        image: src.image,
      }
      const next = [...prev]
      next.splice(at + 1, 0, copy)
      return next
    })
  }, [])

  const renameFolder = useCallback((id: number, name: string) => {
    const n = name.trim()
    if (!n) return
    setFolders((prev) => prev.map((f) => (f.id === id ? { ...f, name: n } : f)))
  }, [])

  const deleteFolder = useCallback((id: number) => {
    setFolders((prev) => prev.filter((f) => f.id !== id))
  }, [])

  /* star a track: the Favourites playlist is created on the first star, and
     un-starring removes the track from that same folder */
  const toggleFavourite = useCallback((trackId: number) => {
    setFolders((prev) => {
      const at = prev.findIndex((f) => f.id === FAVOURITES_FOLDER_ID)
      if (at === -1) {
        return [
          { id: FAVOURITES_FOLDER_ID, name: FAVOURITES_FOLDER_NAME, trackIds: [trackId] },
          ...prev,
        ]
      }
      const folder = prev[at]
      const has = folder.trackIds.includes(trackId)
      const trackIds = has
        ? folder.trackIds.filter((id) => id !== trackId)
        : [...folder.trackIds, trackId]
      const next = [...prev]
      next[at] = { ...folder, trackIds }
      return next
    })
  }, [])

  /* a song downloaded in the online extension: added to its own folder,
     created on the first one */
  const addToDownloads = useCallback((trackId: number) => {
    setFolders((prev) => {
      const at = prev.findIndex((f) => f.id === DOWNLOADS_FOLDER_ID)
      if (at === -1) {
        return [
          { id: DOWNLOADS_FOLDER_ID, name: DOWNLOADS_FOLDER_NAME, trackIds: [trackId] },
          ...prev,
        ]
      }
      const folder = prev[at]
      if (folder.trackIds.includes(trackId)) return prev
      const next = [...prev]
      next[at] = { ...folder, trackIds: [...folder.trackIds, trackId] }
      return next
    })
  }, [])

  const isFavourite = useCallback(
    (trackId: number) => {
      const folder = folders.find((f) => f.id === FAVOURITES_FOLDER_ID)
      return !!folder?.trackIds.includes(trackId)
    },
    [folders],
  )

  const addTrackToFolder = useCallback((folderId: number, trackId: number) => {
    setFolders((prev) =>
      prev.map((f) =>
        f.id === folderId && !f.trackIds.includes(trackId)
          ? { ...f, trackIds: [...f.trackIds, trackId] }
          : f,
      ),
    )
  }, [])

  const removeTrackFromFolder = useCallback((folderId: number, trackId: number) => {
    setFolders((prev) =>
      prev.map((f) =>
        f.id === folderId ? { ...f, trackIds: f.trackIds.filter((t) => t !== trackId) } : f,
      ),
    )
  }, [])

  /* drop a deleted library track out of every playlist so a stale id can
     never resurface in a folder view or a restored session */
  const forgetTrack = useCallback((trackId: number) => {
    setFolders((prev) =>
      prev.map((f) =>
        f.trackIds.includes(trackId)
          ? { ...f, trackIds: f.trackIds.filter((id) => id !== trackId) }
          : f,
      ),
    )
  }, [])

  const reorderTracks = useCallback((folderId: number, from: number, to: number) => {
    setFolders((prev) =>
      prev.map((f) => {
        if (f.id !== folderId || from === to) return f
        if (from < 0 || from >= f.trackIds.length || to < 0 || to >= f.trackIds.length) return f
        const ids = [...f.trackIds]
        const [moved] = ids.splice(from, 1)
        ids.splice(to, 0, moved)
        return { ...f, trackIds: ids }
      }),
    )
  }, [])

  const setFolderImage = useCallback((id: number, dataUrl: string | undefined) => {
    setFolders((prev) => prev.map((f) => (f.id === id ? { ...f, image: dataUrl } : f)))
  }, [])

  return {
    folders,
    createFolder,
    restoreFolder,
    duplicateFolder,
    renameFolder,
    deleteFolder,
    addTrackToFolder,
    removeTrackFromFolder,
    forgetTrack,
    reorderTracks,
    setFolderImage,
    toggleFavourite,
    isFavourite,
    addToDownloads,
  }
}
