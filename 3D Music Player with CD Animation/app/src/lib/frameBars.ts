/**
 * The frame bars' on/off switch lives here rather than in the component, so
 * the component file exports only a component (fast refresh) and the
 * settings card can flip the flag without importing it.
 */

const FLAG = 'md-frame-bars'

/** Fired on `window` whenever the flag changes, so the bars appear/disappear
 *  without a reload. */
export const FRAME_BARS_EVENT = 'md-frame-bars-changed'

export function readFrameBars(): boolean {
  try {
    return localStorage.getItem(FLAG) === '1'
  } catch {
    return false
  }
}

export function writeFrameBars(on: boolean): void {
  try {
    localStorage.setItem(FLAG, on ? '1' : '0')
  } catch {
    /* private mode — the choice lasts for this session */
  }
  window.dispatchEvent(new Event(FRAME_BARS_EVENT))
}
