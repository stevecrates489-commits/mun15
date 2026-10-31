/**
 * Keeps this player's library in step with the extension's own library.
 *
 * A song saved in Dannify is saved here too — the audio, its title, its
 * artist and its cover — and lands in the "Downloads Online" playlist, so it
 * plays from this player's own deck like anything imported by hand.
 *
 * A song LIKED in Dannify is brought in the same way and lands in the
 * library like any other import — with no folder of its own and no star:
 * FAVOURITES is this player's own list, and an extension like never
 * arrives as one.
 *
 * When it runs: once shortly after the player starts, every minute after
 * that, and whenever its window is closed (that is the moment a download has
 * just finished). Each song is taken once, so the minute-by-minute pass
 * costs one small request when there is nothing to do.
 */

import { useCallback, useEffect, useRef } from 'react'
import {
  dannifyAudio,
  dannifyCover,
  newDannifyDownloads,
  newDannifyLikes,
  rememberImported,
} from './downloads'

interface Deps {
  /** Adds a file with its details already known; null when it could not be saved. */
  addSavedTrack: (entry: {
    file: File
    title: string
    artist: string
    cover?: string
  }) => Promise<{ id: number } | null>
  /** Puts a track in the "Downloads Online" playlist. */
  addToDownloads: (trackId: number) => void
}

const FIRST_PASS_MS = 6000
const EVERY_MS = 60_000

export function useDannifySync({ addSavedTrack, addToDownloads }: Deps) {
  /* Passes are SERIALIZED on a promise chain. The old busy-guard turned a
     click that arrived during a pass into a silent no-op — the Refresh
     button read as dead — and two truly concurrent passes could still have
     double-imported one song (both read the "new" list before either
     remembered it). A queue fixes both: every caller gets its own pass, in
     order, and a pass that finds nothing costs one small list read. */
  const chainRef = useRef<Promise<number>>(Promise.resolve(0))

  const doPass = useCallback(async (): Promise<number> => {
    let brought = 0
    try {
      for (const entry of await newDannifyDownloads()) {
        try {
          const cover = await dannifyCover(entry)
          const file = await dannifyAudio(entry)
          const track = await addSavedTrack({
            file,
            title: entry.title,
            artist: entry.artist,
            cover,
          })
          if (!track) break /* disk trouble — stop, and retry later */
          addToDownloads(track.id)
          rememberImported(entry.file)
          brought++
        } catch {
          /* that one could not be read, or the extension went away mid-pass;
             whatever came before is in, and the rest is tried next time */
          break
        }
      }
    } catch {
      /* the list itself was unreachable: nothing to do */
    }

    /* the liked songs: into the library like any other import, with no
       folder of their own. One that will not stream is
       skipped rather than ended: a single unavailable video must not hold
       every song after it out of the folder. */
    try {
      for (const entry of await newDannifyLikes()) {
        try {
          const cover = await dannifyCover(entry)
          const file = await dannifyAudio(entry)
          const track = await addSavedTrack({
            file,
            title: entry.title,
            artist: entry.artist,
            cover,
          })
          if (!track) break /* disk trouble — stop, and retry later */
          rememberImported(entry.file)
          brought++
        } catch {
          /* that one would not stream, or the extension went away mid-pass */
          continue
        }
      }
    } catch {
      /* the list itself was unreachable: nothing to do */
    }
    return brought
  }, [addSavedTrack, addToDownloads])

  const sync = useCallback((): Promise<number> => {
    const pass = chainRef.current.then(doPass)
    /* the chain must survive a failed pass — the next caller still runs */
    chainRef.current = pass.then(
      () => 0,
      () => 0,
    )
    return pass
  }, [doPass])

  useEffect(() => {
    const first = window.setTimeout(() => void sync(), FIRST_PASS_MS)
    const timer = window.setInterval(() => void sync(), EVERY_MS)
    return () => {
      window.clearTimeout(first)
      window.clearInterval(timer)
    }
  }, [sync])

  return { sync }
}
