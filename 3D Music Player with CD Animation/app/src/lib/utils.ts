import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/* Titles picked up off the web arrive wearing their packaging:
 * "Song (Official Lyric Video) [HD]". The full title is never destroyed —
 * it stays in the file and in Edit Info — only the list shows the clean
 * form. Anything that is left empty by the cleanup falls back to the
 * original so a title can never render blank. */
const BRACKETED_NOISE = new RegExp(
  '[\\(\\[\\{【][^\\)\\]】]*(?:official|lyric(?:s)?(?:\\s+video)?|music\\s+video|audio|visuali[sz]er|hd|hq|4k|uhd|1080p?|720p?|mv|stream|full\\s+album)[^\\)\\]】]*[\\)\\]】]',
  'gi',
)
const TAG_NOISE = new RegExp(
  '[\\[(【](?:official|lyrics?|hd|hq|4k|uhd|1080p?|720p?|audio|visuali[sz]er|explicit|clean)[\\]\\)】]',
  'gi',
)
const TRAILING_NOISE =
  /\s*[-–—|:]+\s*(?:official\s+)?(?:lyric\s+)?(?:music\s+)?video\s*$/i

export function cleanTitle(raw: string): string {
  const out = raw
    .replace(BRACKETED_NOISE, '')
    .replace(TAG_NOISE, '')
    .replace(TRAILING_NOISE, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
  return out || raw
}
