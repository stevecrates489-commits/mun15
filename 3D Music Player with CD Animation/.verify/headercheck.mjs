import { chromium } from 'playwright-core'

const BASE = process.env.BASE ?? 'http://127.0.0.1:5210'
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.addInitScript(() => {
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
    transformCallback: (cb) => cb,
    invoke: () => Promise.resolve(null),
    plugins: {},
    resources: {},
  }
})
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200)))
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(4500)

const out = {}

/* 1 — header: counts on chips, no TRACKLIST bar, footer info row */
out.header = await page.evaluate(() => {
  const chip = [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim().startsWith('ALL'))
  const body = document.body.textContent ?? ''
  const footer = [...document.querySelectorAll('span')].find((s) => /^\d+ TRACKS/.test((s.textContent ?? '').trim()))
  /* if a TRACKLIST label survives, name the element that carries it */
  const stale = [...document.querySelectorAll('body *')]
    .filter((el) => el.childElementCount === 0 && /TRACKLIST/.test(el.textContent ?? ''))
    .map((el) => `${el.tagName}.${String(el.className).slice(0, 60)}`)
    .slice(0, 3)
  return {
    chipText: chip?.textContent?.trim() ?? null,
    chipHasCount: !!chip && /\d/.test(chip.textContent ?? ''),
    tracklistBarGone: stale.length === 0,
    stale,
    footerRow: footer?.textContent?.trim() ?? null,
  }
})
console.log('header:', JSON.stringify(out.header))

/* 4 — wheel over the header tunes its blur; the list is untouched.
   Each dispatch is followed by a frame: the handler sets React state, and
   the style only exists after the re-render commits. */
out.blur = await page.evaluate(async () => {
  const chip = [...document.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim().startsWith('ALL'))
  const header = chip?.closest('.relative')?.parentElement
  if (!header) return { error: 'header not found' }
  const frame = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
  const read = () => /blur\(([\d.]+)px\)/.exec(header.style.backdropFilter ?? '')?.[1] ?? '0'
  const before = read()
  header.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, cancelable: true }))
  await frame()
  header.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, cancelable: true }))
  await frame()
  const afterUp = read()
  header.dispatchEvent(new WheelEvent('wheel', { deltaY: 400, cancelable: true }))
  await frame()
  header.dispatchEvent(new WheelEvent('wheel', { deltaY: 400, cancelable: true }))
  await frame()
  header.dispatchEvent(new WheelEvent('wheel', { deltaY: 400, cancelable: true }))
  await frame()
  const afterDown = read()
  /* a wheel over the LIST region must not touch the header blur */
  const list = document.querySelector('.playlist-scroll') ?? document.querySelector('[class*="overflow-y-auto"]')
  if (list) list.dispatchEvent(new WheelEvent('wheel', { deltaY: -500, cancelable: true, bubbles: true }))
  await frame()
  const afterListWheel = read()
  return { before, afterUp, afterDown, afterListWheel }
})

console.log('header:', JSON.stringify(out.header))
console.log('blur:', JSON.stringify(out.blur))

/* 3 — the visualiser panel's frosted surface */
await page.locator('button[aria-label="Visualiser options"]').click({ force: true, timeout: 8000 }).catch((e) => console.log('[click]', String(e).slice(0, 120)))
await page.waitForTimeout(600)
out.vizPanel = await page.evaluate(() => {
  const p = [...document.querySelectorAll('.settings-panel')].find((q) => q.textContent?.includes('VISUALISER'))
  if (!p) return { found: false }
  const s = getComputedStyle(p)
  return {
    found: true,
    bg: s.backgroundColor,
    blur: s.backdropFilter || s.webkitBackdropFilter,
    shadow: s.boxShadow !== 'none',
    border: s.borderTopWidth + ' ' + s.borderTopColor,
  }
})

console.log('vizPanel:', JSON.stringify(out.vizPanel))
await browser.close()
