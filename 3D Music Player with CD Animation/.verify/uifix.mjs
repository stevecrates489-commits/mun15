import { chromium } from 'playwright-core'

/* uifix — UI/persistence/logic batch.
   1. header frost: light glass, no dark tint, fully clear at blur 0
   2. bargraph settings persist (palette/bars/intensity) + card renders
   3. radio panel LYRICS toggle drives the main lyrics panel
   4. downloads REFRESH: immediate CHECKING state, note when the pass lands
   5. lyrics placeholder strictly after the search window; searching line before */

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
/* the long-lived dev server sometimes stalls one navigation — one retry */
const safeReload = async () => {
  try {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 })
  } catch {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 })
  }
}
const clickText = (text) =>
  page.evaluate((t) => {
    ;[...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === t)?.click()
  }, text)

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
    tx.objectStore('tracks').put({ id: 1, file, title: 'Zqxv Wqkj Nnff', artist: 'Qqz Wvv' })
    tx.oncomplete = () => d.close()
  }
})
await safeReload()
await page.waitForTimeout(3500)
await raf2()

/* ---- 1 — header frost ---- */
const headerSel = '.glass-panel > div.relative'
out.headerClearAtTop = await page.evaluate((sel) => {
  const el = document.querySelector(sel)
  if (!el) return false
  const cs = getComputedStyle(el)
  return (cs.backgroundColor === 'rgba(0, 0, 0, 0)' || cs.backgroundColor === 'transparent') && cs.backdropFilter === 'none'
}, headerSel)
await page.evaluate((sel) => {
  document.querySelector(sel)?.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, bubbles: true, cancelable: true }))
}, headerSel)
await page.waitForTimeout(150)
out.headerFrost = await page.evaluate((sel) => {
  const cs = getComputedStyle(document.querySelector(sel))
  return cs.backdropFilter.includes('blur') && cs.backgroundColor === 'rgba(255, 255, 255, 0.05)'
}, headerSel)
out.headerNoDarkTint = await page.evaluate((sel) => {
  const cs = getComputedStyle(document.querySelector(sel))
  return !/rgba\(8, 10, 16/.test(cs.backgroundColor)
}, headerSel)
console.log('[uifix] item 1', JSON.stringify(out))

/* ---- 2 — bargraph persistence ----
   the style button and the card toggle BOTH read 'BAR GRAPH' — the card
   toggle is the one carrying aria-expanded */
await page.locator('button[aria-label="Visualiser options"]').click()
await page.waitForTimeout(500)
await clickText('BAR GRAPH') /* activates the style */
await page.waitForTimeout(1200)
await page.evaluate(() => {
  const card = [...document.querySelectorAll('button[aria-expanded]')].find(
    (b) => b.textContent?.trim() === 'BAR GRAPH',
  )
  card?.click()
})
await page.waitForTimeout(400)
out.bargraphCardOpen = await page.evaluate(
  () => !!document.querySelector('button[aria-label="More bars"]'),
)
await page.evaluate(() => {
  ;[...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'More bars')?.click()
  ;[...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Palette Plasma')?.click()
})
await page.waitForTimeout(300)
out.bargraphSavedLive = await page.evaluate(
  () => localStorage.getItem('md-bargraph-bars') === '192' && localStorage.getItem('md-bargraph-palette') === '1',
)
out.bargraphBgTogglePresent = await page.evaluate(
  () => !!document.querySelector('button[aria-label="Toggle the background behind the bars"]'),
)
out.bargraphBgToggleWorks = await page.evaluate(() => {
  const t = document.querySelector('button[aria-label="Toggle the background behind the bars"]')
  const before = t?.getAttribute('aria-pressed')
  t?.click()
  return before !== undefined
})
await page.waitForTimeout(150)
out.bargraphBgToggleFlipped = await page.evaluate(
  () => localStorage.getItem('md-bargraph-bg') === '1',
)
/* click it back off so the persisted run starts from a known state */
await page.evaluate(() => {
  document.querySelector('button[aria-label="Toggle the background behind the bars"]')?.click()
})
out.bargraphRowsAligned = await page.evaluate(() => {
  const spans = [...document.querySelectorAll('span')]
    .filter((s) => ['BARS', 'INTENSITY', 'SHOW BACKGROUND'].includes(s.textContent?.trim() ?? ''))
    .map((s) => s.getBoundingClientRect())
  return spans.length === 3 && Math.abs(spans[0].x - spans[1].x) < 1 && Math.abs(spans[1].x - spans[2].x) < 1
})
await page.locator('button[aria-label="Close visualiser"]').click()
await page.waitForTimeout(400)
await safeReload()
await page.waitForTimeout(3500)
await page.locator('button[aria-label="Visualiser options"]').click()
await page.waitForTimeout(500)
await clickText('BAR GRAPH')
await page.waitForTimeout(1200)
await page.evaluate(() => {
  const card = [...document.querySelectorAll('button[aria-expanded]')].find(
    (b) => b.textContent?.trim() === 'BAR GRAPH',
  )
  card?.click()
})
await page.waitForTimeout(400)
out.bargraphPersisted = await page.evaluate(() => {
  const outs = [...document.querySelectorAll('output')].map((o) => o.textContent?.trim())
  return outs.includes('192') && localStorage.getItem('md-bargraph-bars') === '192' && localStorage.getItem('md-bargraph-palette') === '1'
})
out.bargraphIntensityKey = await page.evaluate(() => {
  const n = Number(localStorage.getItem('md-bargraph-intensity'))
  return Number.isFinite(n) && n >= 0.1 && n <= 3
})
await page.locator('button[aria-label="Close visualiser"]').click()
await page.waitForTimeout(400)
console.log('[uifix] item 2', JSON.stringify(out))

/* ---- 3 — radio panel lyrics toggle ----
   raw mouse coordinates (the hover() hit-test stalls on this button) */
const radioBtn = page.locator('button[aria-label="Radio (hold)"]')
const rbox = await radioBtn.boundingBox()
await page.mouse.move(rbox.x + rbox.width / 2, rbox.y + rbox.height / 2)
await page.mouse.down()
await page.waitForTimeout(650)
await page.mouse.up()
await page.waitForTimeout(1000)
await page.evaluate(() => {
  ;[...document.querySelectorAll('button')].find((b) => b.textContent?.includes('LYRICS OFF'))?.click()
})
await page.waitForTimeout(400)
out.radioLyricsTogglesOn = await page.evaluate(() => {
  const on = [...document.querySelectorAll('button')].some((b) => b.textContent?.includes('LYRICS ON'))
  const overlay = !!document.querySelector('.lyrics-host')
  return on && overlay
})
await page.evaluate(() => {
  ;[...document.querySelectorAll('button')].find((b) => b.textContent?.includes('LYRICS ON'))?.click()
})
await page.waitForTimeout(400)
out.radioLyricsTogglesOff = await page.evaluate(() => {
  const off = [...document.querySelectorAll('button')].some((b) => b.textContent?.includes('LYRICS OFF'))
  const gone = !document.querySelector('.lyrics-host')
  return off && gone
})
await page.evaluate(() => document.querySelector('button[aria-label="Close radio"]')?.click())
await page.waitForTimeout(500)
console.log('[uifix] item 3', JSON.stringify(out))

/* ---- 4 — downloads refresh feedback ---- */
await page.evaluate(() => {
  ;[...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Downloads Online'))?.click()
})
await page.waitForTimeout(400)
await page.evaluate(() => document.querySelector('button[aria-label="Refresh downloads"]')?.click())
await page.waitForTimeout(400)
out.refreshImmediateState = await page.evaluate(
  () => (document.body.textContent ?? '').includes('CHECKING'),
)
/* the pass can take ~25s when the extension's likes list is slow — poll */
out.refreshNote = false
for (let i = 0; i < 12; i++) {
  await page.waitForTimeout(3000)
  if (await page.evaluate(() => (document.body.textContent ?? '').includes('UP TO DATE'))) {
    out.refreshNote = true
    break
  }
}
console.log('[uifix] item 4', JSON.stringify(out))

/* ---- 5 — lyrics placeholder strictly after the window ---- */
await page.evaluate(() => {
  ;[...document.querySelectorAll('button')].find((b) => b.textContent?.trim().startsWith('ALL'))?.click()
})
await page.waitForTimeout(400)
await page.evaluate(() => {
  const chip = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'LYRICS')
  if (chip && chip.getAttribute('aria-pressed') !== 'true') chip.click()
})
await page.waitForTimeout(400)
await page.evaluate(() => {
  const row = [...document.querySelectorAll('.playlist-row')].find((r) => r.textContent?.includes('Zqxv Wqkj Nnff'))
  ;(row?.querySelector('[role="button"], button') ?? row)?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
})
await page.waitForTimeout(1500)
out.searchingShown = await page.evaluate(() => (document.body.textContent ?? '').includes('SEARCHING FOR LYRICS'))
out.placeholderNotYet = await page.evaluate(() => !(document.body.textContent ?? '').includes('JUST VIBING'))
await page.waitForTimeout(12000)
out.placeholderAfterWindow = await page.evaluate(() => (document.body.textContent ?? '').includes('JUST VIBING'))
console.log('[uifix] item 5', JSON.stringify(out))

console.log(JSON.stringify(out, null, 2))
await browser.close()
