import { chromium } from 'playwright-core'

/* uifix2 — layout/styling batch.
   1. custom boxes remap proportionally on viewport resize (fullscreen proxy)
   2. bargraph rows aligned: labels same x, control clusters same x, no wrap
   3. wheel over header frosts the WHOLE tracklist panel root; 0 = default */

const BASE = process.env.BASE ?? 'http://127.0.0.1:5210'
const browser = await chromium.launch({
  channel: 'msedge',
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required'],
})
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.addInitScript(() => {
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
    transformCallback: (cb) => cb,
    invoke: () => Promise.resolve(null),
    plugins: {},
    resources: {},
  }
  localStorage.setItem('md-lyrics', '1')
})
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200)))

const out = {}
const raf2 = () =>
  page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))

await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(4000)
await page.evaluate(() => {
  const file = new File([new Uint8Array(1024)], 'p.mp3', { type: 'audio/mpeg' })
  const db = indexedDB.open('md-walkman', 3)
  db.onupgradeneeded = () => {
    const d = db.result
    if (!d.objectStoreNames.contains('tracks')) d.createObjectStore('tracks', { keyPath: 'id' })
    if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'key' })
    if (!d.objectStoreNames.contains('lyrics')) d.createObjectStore('lyrics', { keyPath: 'key' })
  }
  db.onsuccess = () => {
    const d = db.result
    const tx = d.transaction('tracks', 'readwrite')
    tx.objectStore('tracks').put({ id: 1, file, title: 'Probe', artist: 'Q' })
    tx.oncomplete = () => d.close()
  }
})
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(3500)
await raf2()

/* ---- 1 — remap on viewport change ----
   place both panels at known pixel boxes, then resize the viewport 1440→1800
   wide; the boxes must scale by 1.25 (x and w) and stay clamped in view */
await page.evaluate(() => {
  localStorage.setItem('md-lyrics-custom', '1')
  localStorage.setItem('md-lyrics-box-on', JSON.stringify({ x: 120, y: 100, w: 400, h: 300 }))
  localStorage.setItem('md-tracklist-box', JSON.stringify({ x: 800, y: 120, w: 360, h: 500 }))
})
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(3500)
await raf2()
const before = await page.evaluate(() => {
  const host = document.querySelector('.lyrics-host')
  const f = host ? host.closest('div.fixed') : null
  const panel = document.querySelector('.playlist-scroll')?.closest('.glass-panel')
  const pf = panel ? panel.closest('div.fixed') : null
  return {
    lyric: f ? { x: Math.round(f.getBoundingClientRect().x), w: Math.round(f.getBoundingClientRect().width) } : null,
    tl: pf ? { x: Math.round(pf.getBoundingClientRect().x), w: Math.round(pf.getBoundingClientRect().width) } : null,
  }
})
out.beforeResize = before
await page.setViewportSize({ width: 1800, height: 1125 })
await page.waitForTimeout(800)
await raf2()
const after = await page.evaluate(() => {
  const host = document.querySelector('.lyrics-host')
  const f = host ? host.closest('div.fixed') : null
  const panel = document.querySelector('.playlist-scroll')?.closest('.glass-panel')
  const pf = panel ? panel.closest('div.fixed') : null
  const vw = window.innerWidth
  return {
    lyric: f ? { x: Math.round(f.getBoundingClientRect().x), w: Math.round(f.getBoundingClientRect().width) } : null,
    tl: pf ? { x: Math.round(pf.getBoundingClientRect().x), w: Math.round(pf.getBoundingClientRect().width) } : null,
    vw,
  }
})
out.afterResize = after
/* 120 * 1.25 = 150, 400 * 1.25 = 500; 800 * 1.25 = 1000, 360 * 1.25 = 450 */
out.remapScaled =
  after.lyric && after.tl &&
  Math.abs(after.lyric.x - 150) <= 2 && Math.abs(after.lyric.w - 500) <= 2 &&
  Math.abs(after.tl.x - 1000) <= 2 && Math.abs(after.tl.w - 450) <= 2
out.persistedScaled = await page.evaluate(() => {
  const b = JSON.parse(localStorage.getItem('md-lyrics-box-on') ?? 'null')
  const t = JSON.parse(localStorage.getItem('md-tracklist-box') ?? 'null')
  return !!b && !!t && Math.abs(b.x - 150) <= 2 && Math.abs(t.x - 1000) <= 2
})
/* back down — proportional both ways */
await page.setViewportSize({ width: 1440, height: 900 })
await page.waitForTimeout(800)
await raf2()
out.remappedBack = await page.evaluate(() => {
  const b = JSON.parse(localStorage.getItem('md-lyrics-box-on') ?? 'null')
  return !!b && Math.abs(b.x - 120) <= 3 && Math.abs(b.w - 400) <= 3
})
console.log('[uifix2] item 1', JSON.stringify({ remapScaled: out.remapScaled, persistedScaled: out.persistedScaled, remappedBack: out.remappedBack }))

/* ---- 2 — bargraph alignment ---- */
await page.locator('button[aria-label="Visualiser options"]').click()
await page.waitForTimeout(500)
await page.evaluate(() => {
  ;[...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'BAR GRAPH')?.click()
})
await page.waitForTimeout(1200)
await page.evaluate(() => {
  ;[...document.querySelectorAll('button[aria-expanded]')].find((b) => b.textContent?.trim() === 'BAR GRAPH')?.click()
})
await page.waitForTimeout(400)
out.bargraph = await page.evaluate(() => {
  const spans = [...document.querySelectorAll('span')]
    .filter((s) => ['BARS', 'INTENSITY', 'SHOW BACKGROUND'].includes(s.textContent?.trim() ?? ''))
  const rects = spans.map((s) => s.getBoundingClientRect())
  const labelsSameX = rects.length === 3 && rects.every((r) => Math.abs(r.x - rects[0].x) < 1)
  const noWrap = rects.every((r) => r.height < 16)
  /* the [-] buttons of both steppers at the same x */
  const minus = [...document.querySelectorAll('button')].filter(
    (b) => b.getAttribute('aria-label') === 'Fewer bars' || b.getAttribute('aria-label') === 'Decrease intensity',
  )
  const mx = minus.map((b) => b.getBoundingClientRect().x)
  const steppersSameX = minus.length === 2 && Math.abs(mx[0] - mx[1]) < 1
  return { labelsSameX, noWrap, steppersSameX, count: spans.length }
})
console.log('[uifix2] item 2', JSON.stringify(out.bargraph))
await page.locator('button[aria-label="Close visualiser"]').click()
await page.waitForTimeout(400)

/* ---- 3 — whole-panel frost ---- */
const rootSel = '.glass-panel'
out.panelDefault = await page.evaluate((sel) => {
  const cs = getComputedStyle(document.querySelector(sel))
  return cs.backgroundColor === 'rgba(0, 0, 0, 0.45)'
}, rootSel)
await page.evaluate((sel) => {
  const header = document.querySelector(sel)?.querySelector(':scope > div.relative')
  header?.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, bubbles: true, cancelable: true }))
}, rootSel)
await page.waitForTimeout(200)
out.panelFrosted = await page.evaluate((sel) => {
  const cs = getComputedStyle(document.querySelector(sel))
  return (
    cs.backdropFilter.includes('blur(3px)') &&
    cs.backgroundColor === 'rgba(255, 255, 255, 0.05)'
  )
}, rootSel)
/* the frost covers the LIST area too: the root's own box is the frosted one */
out.frostCoversList = await page.evaluate((sel) => {
  const root = document.querySelector(sel)
  const list = root?.querySelector('.playlist-scroll')
  if (!root || !list) return false
  return getComputedStyle(root).backdropFilter.includes('blur')
}, rootSel)
/* wheel back down to 0 — default glass returns */
for (let i = 0; i < 8; i++) {
  await page.evaluate((sel) => {
    document
      .querySelector(sel)
      ?.querySelector(':scope > div.relative')
      ?.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true, cancelable: true }))
  }, rootSel)
}
await page.waitForTimeout(250)
out.panelRestored = await page.evaluate((sel) => {
  const cs = getComputedStyle(document.querySelector(sel))
  return cs.backgroundColor === 'rgba(0, 0, 0, 0.45)'
}, rootSel)
console.log('[uifix2] item 3', JSON.stringify({ panelDefault: out.panelDefault, panelFrosted: out.panelFrosted, frostCoversList: out.frostCoversList, panelRestored: out.panelRestored }))

console.log(JSON.stringify(out, null, 2))
await browser.close()
