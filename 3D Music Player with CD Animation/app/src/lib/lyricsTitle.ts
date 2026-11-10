/* The title the lyrics providers are asked for can differ from the title the
   track is shown under — a rip may be "track 04" while the song is "Sohniye".
   The override lives beside the other display choices in localStorage, keyed
   by track id, and announces itself so the live lyrics panel re-fetches. */

const KEY = 'md-lyrics-title:'
export const LYRICS_TITLE_EVENT = 'md-lyrics-title-changed'

export function getLyricsTitle(trackId: number): string | null {
  try {
    const raw = localStorage.getItem(KEY + trackId)
    return raw && raw.trim() ? raw : null
  } catch {
    return null
  }
}

export function setLyricsTitle(trackId: number, value: string | null): void {
  const trimmed = value?.trim() ?? ''
  try {
    if (trimmed) localStorage.setItem(KEY + trackId, trimmed)
    else localStorage.removeItem(KEY + trackId)
  } catch {
    /* storage unavailable — the override still applies for this session */
  }
  window.dispatchEvent(
    new CustomEvent(LYRICS_TITLE_EVENT, { detail: { id: trackId, title: trimmed || null } }),
  )
}
