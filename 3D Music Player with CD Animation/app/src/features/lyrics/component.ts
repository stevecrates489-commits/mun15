/**
 * The lyric component, and the one thing this app asks of it.
 *
 * `<am-lyrics>` owns the drawing — the line layout, the highlight sweep, the
 * scroll, the instrument gaps. The app does not redraw any of that. All the
 * app needs from the component is its PARSER: a way to turn an answer into
 * the shape the component renders.
 *
 * So the component is treated as a parser and nothing else. Two of its
 * static functions do that job, and both are pure:
 *
 *   parseTTML          — TTML (the format Apple, lrc.red and our own
 *                        providers speak) into renderable lines
 *   convertKPoeLyrics  — LyricsPlus's own payload into renderable lines
 *
 * Everything else — which providers exist, which one is asked first, what
 * happens when one is down — belongs to the app.
 */

/** one timed piece of a line */
export interface Syllable {
  text: string
  part: boolean
  timestamp: number
  endtime: number
  romanizedText?: string
  lineSynced?: boolean
}

/** one line of a lyric, in the shape the component renders */
export interface LyricsLine {
  text: Syllable[]
  background: boolean
  backgroundText: Syllable[]
  oppositeTurn: boolean
  timestamp: number
  endtime: number
  isWordSynced?: boolean
  alignment?: 'start' | 'end'
  songPart?: string
  romanizedText?: string
  translation?: string
  agentId?: string
  direction?: 'ltr' | 'rtl'
}

/** what the app asks of the component */
export interface ComponentConstructor {
  parseTTML?: (ttml: string) => { lines: LyricsLine[]; songwriters?: string } | null
  convertKPoeLyrics?: (payload: unknown) => LyricsLine[] | null
}

/** the component's constructor, once it has registered itself */
export function lyricsComponent(): ComponentConstructor | null {
  if (typeof customElements === 'undefined') return null
  const ctor = customElements.get('am-lyrics') as unknown as ComponentConstructor | undefined
  return ctor ?? null
}
