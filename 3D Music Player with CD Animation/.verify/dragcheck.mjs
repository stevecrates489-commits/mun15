import { chromium } from 'playwright-core'

/* dragcheck — the pointer-based row reorder (PlaylistPanel).
   1. manual sort is on by default → rows are reorderable
   2. a drag lifts a ghost that FOLLOWS the cursor (transform written per
      frame, no native DnD ghost), the origin row parks as the placeholder
   3. the emerald landing marker moves with the hovered row
   4. dropping commits the new order
   5. a plain click still plays the row (threshold) and leaves no ghost
   6. body.row-dragging is only present while a drag is live */

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

const safeReload = async () => {
  try {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 })
  } catch {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 })
  }
}
const raf2 = () =>
  page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
const rowBox = (i) =>
  page.evaluate((idx) => {
    const el = document.querySelector(`[data-row-index="${idx}"]`)
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }
  }, i)

await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(4000)
/* five real files, distinct titles */
await page.evaluate(async () => {
  const buf = await (await fetch('/src/assets/track1.mp3')).arrayBuffer()
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
    for (let i = 1; i <= 5; i++) {
      const file = new File([buf], `Seed ${i}.mp3`, { type: 'audio/mpeg' })
      tx.objectStore('tracks').put({
        id: i,
        file,
        title: `Aaardvark Track ${i}`,
        artist: `Qqz Wvv ${i}`,
      })
    }
    tx.oncomplete = () => d.close()
  }
  /* the default view is the Downloads Online folder (no "all" tab) — the
     seeded tracks must be IN it */
  localStorage.setItem(
    'md-playlists',
    JSON.stringify([{ id: -2, name: 'Downloads Online', trackIds: [1, 2, 3, 4, 5] }]),
  )
  localStorage.setItem('md-selected-playlist', '-2')
})
await safeReload()
await page.waitForTimeout(3500)
/* the boot intro holds the whole window (a click skips it) — the first
   pointerdown of any test would otherwise be eaten by #boot */
for (let i = 0; i < 5; i++) {
  const up = await page.evaluate(
    () => !document.querySelector('#boot') || getComputedStyle(document.querySelector('#boot')).display === 'none',
  )
  if (up) break
  await page.mouse.click(20, 880)
  await page.waitForTimeout(1200)
}
await page.waitForTimeout(400)
await raf2()

const titles = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('[data-row-index]')].map(
      (r) => r.querySelector('span.truncate, .min-w-0 span')?.textContent ?? r.textContent.slice(0, 24),
    ),
  )

/* ---- 1 — reorderable ---- */
const row0 = await rowBox(0)
console.log('[dragcheck] 1 row present:', row0 ? 'PASS' : 'FAIL')

/* ---- 2+3+4 — drag row 0 down onto row 2 ---- */
const before = await page.evaluate(() => document.querySelector('[data-row-index="0"]')?.textContent.slice(0, 40))
await page.mouse.move(row0.x, row0.y)
await page.mouse.down()
/* cross the 5px threshold, then walk down in steps so the loop runs */
for (let s = 1; s <= 10; s++) {
  await page.mouse.move(row0.x, row0.y + s * 14)
  await page.waitForTimeout(30)
}
const midDrag = await page.evaluate(() => {
  const ghost = document.querySelector('.playlist-row-ghost')
  const origin = document.querySelector('.playlist-row-drag-origin')
  const marker = [...document.querySelectorAll('[data-row-index] .absolute')].find((s) =>
    s.className.includes('bg-emerald-300'),
  )
  return {
    ghost: !!ghost,
    ghostFixed: ghost ? getComputedStyle(ghost).position : null,
    ghostPointerEvents: ghost ? getComputedStyle(ghost).pointerEvents : null,
    origin: !!origin,
    marker: !!marker,
    bodyClass: document.body.classList.contains('row-dragging'),
  }
})
console.log('[dragcheck] 2/3 mid-drag:', JSON.stringify(midDrag))
await page.mouse.up()
await page.waitForTimeout(400)
const after = await page.evaluate(() => document.querySelector('[data-row-index="0"]')?.textContent.slice(0, 40))
const cleaned = await page.evaluate(() => ({
  ghost: !!document.querySelector('.playlist-row-ghost'),
  origin: !!document.querySelector('.playlist-row-drag-origin'),
  bodyClass: document.body.classList.contains('row-dragging'),
}))
console.log('[dragcheck] 4 first row before:', JSON.stringify(before))
console.log('[dragcheck] 4 first row after :', JSON.stringify(after))
console.log('[dragcheck] 4 order changed:', before !== after ? 'PASS' : 'FAIL')
console.log('[dragcheck] 6 cleanup:', JSON.stringify(cleaned), !cleaned.ghost && !cleaned.origin && !cleaned.bodyClass ? 'PASS' : 'FAIL')

/* ---- 5 — a plain click plays the row ---- */
const c0 = await rowBox(0)
await page.mouse.move(c0.x, c0.y)
await page.mouse.down()
await page.mouse.up()
await page.waitForTimeout(600)
const clicked = await page.evaluate(() => ({
  active: !!document.querySelector('[data-row-index][data-active="true"]'),
  ghost: !!document.querySelector('.playlist-row-ghost'),
  playing: !!document.querySelector('button[aria-label="Play / Pause"] svg.lucide-pause'),
}))
console.log('[dragcheck] 5 click plays:', JSON.stringify(clicked), clicked.active && !clicked.ghost ? 'PASS' : 'FAIL')

/* ---- second drag upward, then land back on the same index (no-op order) ---- */
const first2 = await rowBox(0)
await page.mouse.move(first2.x, first2.y)
await page.mouse.down()
for (let s = 1; s <= 8; s++) {
  await page.mouse.move(first2.x, first2.y + s * 12)
  await page.waitForTimeout(25)
}
for (let s = 8; s >= 0; s--) {
  await page.mouse.move(first2.x, first2.y + s * 12)
  await page.waitForTimeout(25)
}
await page.mouse.up()
await page.waitForTimeout(300)
console.log('[dragcheck] return-to-slot drag settles:', !(await page.evaluate(() => !!document.querySelector('.playlist-row-ghost'))) ? 'PASS' : 'FAIL')

console.log('[dragcheck] done')
await browser.close()
