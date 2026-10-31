import { chromium } from 'playwright-core'

/* scrollcheck — playlist/download batch.
   A. tracklist scroll: overflow-anchor none on the scroller; a wheel fling
      downward never moves scrollTop backward (the centerOn yank regression)
   B. REFRESH button exists in the Downloads Online view (and nowhere else)
   C. Downloads Online exists on a fresh profile, and its ⋯ menu has no DELETE */

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
  localStorage.setItem('md-lyrics', '0')
})
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200)))

const out = {}
const raf2 = () =>
  page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))

await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(4000)
await page.evaluate(() => {
  const bytes = new Uint8Array(1024)
  const file = new File([bytes], 'probe.mp3', { type: 'audio/mpeg' })
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
    for (let i = 1; i <= 60; i++) {
      tx.objectStore('tracks').put({ id: i, file, title: `Track ${String(i).padStart(2, '0')}`, artist: 'Probe' })
    }
    tx.oncomplete = () => d.close()
  }
})
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(3500)
await raf2()

/* C — system playlist exists on a fresh profile (no downloads ever made) */
out.downloadsChipOnFreshLoad = await page.evaluate(() => {
  const folders = JSON.parse(localStorage.getItem('md-playlists') ?? '[]')
  return folders.some((f) => f.id === -2 && f.name === 'Downloads Online')
})
out.downloadsChipVisible = await page.evaluate(() =>
  [...document.querySelectorAll('button')].some((b) => b.textContent?.includes('Downloads Online')),
)

/* B — REFRESH only inside the Downloads Online view */
out.refreshHiddenOnAll = await page.evaluate(
  () => ![...document.querySelectorAll('button')].some((b) => b.textContent?.includes('REFRESH')),
)
await page.evaluate(() => {
  const chip = [...document.querySelectorAll('button')].find((b) => b.textContent?.includes('Downloads Online'))
  chip?.click()
})
await page.waitForTimeout(400)
await raf2()
const refreshBtn = page.locator('button[aria-label="Refresh downloads"]')
out.refreshShownInDownloads = (await refreshBtn.count()) > 0
/* click it — the extension is not running, the pass must end quietly.
   Element-level click: the boot overlay canvas plays with Playwright's
   hit-testing here, and the handler is what we're verifying. */
if (out.refreshShownInDownloads) {
  await refreshBtn.evaluate((el) => el.click())
  await page.waitForTimeout(1200)
  out.refreshClickSurvived = await page.evaluate(() => document.body.classList.contains('layout-editing') === false)
}

/* back to ALL — the chip's text includes its count, so startsWith.
   Done BEFORE the drawer checks: with ALL selected the drawer opens on the
   playlists LIST view (activeFolder null), where every folder row carries
   its ⋯ actions menu. */
await page.evaluate(() => {
  const chip = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim().startsWith('ALL'))
  chip?.click()
})
await page.waitForTimeout(400)
out.chipCount = await page.evaluate(() => document.querySelectorAll('.playlist-row').length)

/* A — overflow-anchor + fling monotonicity */
out.overflowAnchorNone = await page.evaluate(() => {
  const box = document.querySelector('.playlist-scroll')
  return box ? getComputedStyle(box).overflowAnchor === 'none' : false
})
/* fling downward with wheel events; sample scrollTop across the gesture.
   A backward jump (>6px against the direction) is the yank regression. */
const samples = await page.evaluate(async () => {
  const box = document.querySelector('.playlist-scroll')
  if (!box) return null
  const seen = []
  for (let i = 0; i < 30; i++) {
    box.dispatchEvent(new WheelEvent('wheel', { deltaY: 240, bubbles: true, cancelable: true }))
    await new Promise((r) => setTimeout(r, 40))
    seen.push(box.scrollTop)
  }
  await new Promise((r) => setTimeout(r, 900))
  seen.push(box.scrollTop)
  return seen
})
let backward = 0
if (samples) {
  for (let i = 1; i < samples.length; i++) {
    if (samples[i] < samples[i - 1] - 6) backward++
  }
}
out.flingSamples = samples ? samples.length : 0
out.flingReached = samples ? samples[samples.length - 1] > 200 : false
out.flingNoBackwardJump = backward === 0

/* C — the ⋯ menu for Downloads Online has no DELETE. The profile has exactly
   one playlist (the auto-created system one) — its menu must not offer
   DELETE; the hook's deleteFolder guard is the backstop. */
await page.locator('button[aria-label="Toggle playlists"]').click()
await page.waitForTimeout(700)
const menuBtns = page.locator('[data-folder-menu] [role="button"]')
/* the drawer sometimes needs a second beat (entrance animation) */
if ((await menuBtns.count()) === 0) {
  await page.waitForTimeout(800)
}
const rowCount = await menuBtns.count()
out.drawerState = await page.evaluate(() => ({
  list: !!document.querySelector('input[placeholder="SEARCH PLAYLISTS OR TRACKS…"]'),
  menus: document.querySelectorAll('[data-folder-menu]').length,
}))
out.drawerHasMenus = rowCount > 0
const menus = []
for (let i = 0; i < Math.min(rowCount, 6); i++) {
  await menuBtns.nth(i).evaluate((el) => el.click())
  await page.waitForTimeout(250)
  const has = await page.evaluate(() => {
    const items = [...document.querySelectorAll('div.absolute button')]
    return items.some((b) => b.textContent?.trim() === 'DELETE')
  })
  menus.push(has)
  await menuBtns.nth(i).evaluate((el) => el.click()) /* toggle the menu closed */
  await page.waitForTimeout(200)
}
out.downloadsMenuHasNoDelete = menus.length > 0 && menus.every((d) => d === false)

console.log(JSON.stringify(out, null, 2))
await browser.close()
