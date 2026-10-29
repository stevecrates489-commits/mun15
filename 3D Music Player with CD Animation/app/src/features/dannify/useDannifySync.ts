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
  /* a pass in flight must not be joined by the next timer tick: importing
     two copies of one song would put it in the playlist twice */
  const busy = useRef(false)

  const sync = useCallback(async (): Promise<number> => {
    if (busy.current) return 0
    busy.current = true
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
    } finally {
      busy.current = false
    }
    return brought
  }, [addSavedTrack, addToDownloads])

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
