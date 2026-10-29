/** The two type names the vendored audio-frame contract needs from VoltViz's
 *  own engine. The player builds its frames from the deck's analyser (see
 *  `audio.ts`), so only the shapes are kept. */

export type StyleId = 'auto' | 'music' | 'speech'

export interface AnalyzerState {
  /** Bytes per second the analyser is feeding in (diagnostics only). */
  fps: number
  [key: string]: unknown
}
