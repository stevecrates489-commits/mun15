import { chromium } from 'playwright-core'

/* vizcheck — why is only Bar Graph alive?
   Picks every registry style in turn and records, per style:
     - the backdrop layer's state (canvas present? error text?)
     - every console line printed while it tried (voltviz logs, errors)
   plus everything captured since load. Needs no audio: the frame loop and
   the module loader both run regardless. */

const BASE = process.env.BASE ?? 'http://127.0.0.1:5210'
const browser = await chromium.launch({
  channel: 'msedge',
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required'],
})
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const logs = []
page.on('console', (m) => {
  const t = m.text()
  if (m.type() === 'error' || m.type() === 'warning' || /voltviz|visual/i.test(t)) {
    logs.push(`[${m.type()}] ${t.slice(0, 300)}`)
  }
})
page.on('pageerror', (e) => logs.push(`[pageerror] ${String(e).slice(0, 300)}`))
await page.addInitScript(() => {
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
    transformCallback: (cb) => cb,
    invoke: () => Promise.resolve(null),
    plugins: {},
    resources: {},
  }
  localStorage.setItem('md-lyrics', '0')
})

await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(4000)
for (let i = 0; i < 6; i++) {
  const up = await page.evaluate(
    () =>
      !document.querySelector('#boot') ||
      getComputedStyle(document.querySelector('#boot')).display === 'none',
  )
  if (up) break
  await page.mouse.click(20, 880)
  await page.waitForTimeout(1200)
}
await page.waitForTimeout(400)

/* start playback so the deck graph (and its analyser) exists */
try {
  await page.click('button[aria-label="Play / Pause"]', { timeout: 5000 })
  await page.waitForTimeout(1200)
} catch {
  console.log('[vizcheck] no transport click — continuing without playback')
}

/* the left-docked queue panel (z-80) sits OVER the header's left cluster
   (z-65) — if it covers the visualiser button, toggle it closed first */
const coverage = await page.evaluate(() => {
  const btn = document.querySelector('button[aria-label="Visualiser options"]')
  if (!btn) return 'no-button'
  const r = btn.getBoundingClientRect()
  const top = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
  if (top === btn || btn.contains(top)) return 'clear'
  return `covered-by <${top?.tagName ?? '?'} class="${String(top?.className ?? '').slice(0, 80)}">`
})
console.log(`[vizcheck] visualiser button coverage: ${coverage}`)
if (coverage.startsWith('covered')) {
  await page.click('button[aria-label="Open current queue"]')
  await page.waitForTimeout(700)
}

/* open the visualiser panel */
await page.click('button[aria-label="Visualiser options"]')
await page.waitForTimeout(600)
const styles = await page.evaluate(() => {
  const panel = document.querySelector('.settings-panel')
  if (!panel) return []
  return [...panel.querySelectorAll('button[title]')]
    .map((b) => b.title)
    .filter((t) => t && t !== 'OFF' && !t.startsWith('Hide '))
})
console.log(`[vizcheck] styles found: ${styles.length} — ${styles.join(' | ')}`)

const startupLogs = logs.length

for (const name of styles) {
  const before = logs.length
  try {
    await page.click(`.settings-panel button[title="${name}"]`, { timeout: 5000 })
  } catch (e) {
    console.log(`[vizcheck] ${name}: CLICK FAILED ${String(e).slice(0, 120)}`)
    continue
  }
  await page.waitForTimeout(1500)
  const st = await page.evaluate(() => {
    const host = document.querySelector('div.bg-layer[aria-hidden="true"]')
    if (!host) return { host: false }
    const layers = [...host.children].map((c) => ({
      op: c.style.opacity || '?',
      canvas: !!c.querySelector('canvas'),
      webgl: !!c.querySelector('canvas') && !!(c.querySelector('canvas').getContext),
      text: (c.textContent || '').replace(/\s+/g, ' ').slice(0, 110),
    }))
    return { host: true, layers }
  })
  const fresh = logs.slice(before)
  console.log(`[vizcheck] ${name}: ${JSON.stringify(st)}`)
  if (fresh.length) console.log(`[vizcheck] ${name} logs: ${fresh.join(' || ')}`)
}

console.log(`[vizcheck] --- startup logs (${startupLogs}) ---`)
for (const l of logs.slice(0, startupLogs)) console.log(`[vizcheck] ${l}`)
console.log('[vizcheck] done')
await browser.close()
