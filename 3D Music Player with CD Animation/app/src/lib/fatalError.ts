/**
 * When the app dies, it must SAY SO.
 *
 * A blank window is the worst possible failure: it looks like the app is
 * working, and it tells nobody anything. So every uncaught error is painted
 * on the screen, in plain words, with the stack — and the boot overlay is
 * released so the message is not hidden behind it.
 */

import { releaseBoot } from './bootGate'
import { markBootFailed } from './safeMode'

let shown = false

const STYLE = `
  position: fixed; inset: 0; z-index: 2147483647; overflow: auto;
  background: #12060a; color: #ffd9d9;
  font: 12px/1.5 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  padding: 24px; white-space: pre-wrap; word-break: break-word;
`

const show = (title: string, detail: string) => {
  /* the boot overlay is on top of everything and hides the message */
  releaseBoot()
  if (shown) return
  shown = true
  try {
    const host = document.createElement('div')
    host.setAttribute('data-md-fatal', '1')
    host.setAttribute('style', STYLE)
    const head = document.createElement('div')
    head.setAttribute('style', 'color:#ff6b6b;font-weight:700;letter-spacing:.2em;margin-bottom:12px')
    head.textContent = title
    host.appendChild(head)
    const body = document.createElement('div')
    body.textContent = detail
    host.appendChild(body)
    document.body.appendChild(host)
  } catch {
    /* the document is gone too — there is nothing left to paint on */
  }
}

const describe = (err: unknown): string => {
  if (err instanceof Error) {
    return `${err.message}\n\n${err.stack ?? ''}`
  }
  if (typeof err === 'string') return err
  try {
    return JSON.stringify(err)
  } catch {
    return String(err)
  }
}

/** an uncaught error, from anywhere */
export const reportFatal = (err: unknown, where: string) => {
  /* this launch did not come up cleanly: leave the boot counter standing so
     that a launch which dies three times in a row opens in safe mode */
  markBootFailed()
  show(`${where}`, describe(err))
}

/** install the global nets */
export function installErrorNets() {
  if (typeof window === 'undefined') return
  window.addEventListener('error', (event) => {
    reportFatal(event.error ?? event.message, 'THE APP HIT AN ERROR')
  })
  window.addEventListener('unhandledrejection', (event) => {
    reportFatal(event.reason, 'A PROMISE WAS REJECTED AND NOTHING CAUGHT IT')
  })
}
