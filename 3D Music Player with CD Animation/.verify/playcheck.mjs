import { chromium } from 'playwright-core'

/* playcheck — the pause keep-alive (lib/keepAlive.ts).
   1. the silent element exists, loops, plays from mount, volume 0.01
   2. it keeps playing through a pause
   3. resume after a short pause is instant (click → PAUSE icon)
   4. resume after a LONG pause (65s) is still instant
   5. first play of a selected track is instant
   Headless cannot reproduce the Windows endpoint power-down itself — what
   this proves is the mechanism: the output path is never idle again. */

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

await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(4000)
/* a REAL file: the timing claims mean nothing on a 1KB fake */
await page.evaluate(async () => {
  const buf = await (await fetch('/src/assets/track1.mp3')).arrayBuffer()
  const file = new File([buf], 'Seed One.mp3', { type: 'audio/mpeg' })
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
  /* the default view is the Downloads Online folder (no "all" tab) */
  localStorage.setItem(
    'md-playlists',
    JSON.stringify([{ id: -2, name: 'Downloads Online', trackIds: [1] }]),
  )
  localStorage.setItem('md-selected-playlist', '-2')
})
await safeReload()
await page.waitForTimeout(3500)
/* the boot intro holds the whole window (a click skips it) */
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

/* ---- 1+2 — the keep-alive element ---- */
const keepAlive = await page.evaluate(async () => {
  const m = await import('/src/lib/keepAlive.ts')
  const el = m.keepAliveElement()
  if (!el) return { exists: false }
  return {
    exists: true,
    paused: el.paused,
    loop: el.loop,
    volume: el.volume,
    currentTime: el.currentTime,
  }
})
console.log('[playcheck] 1 keep-alive element:', JSON.stringify(keepAlive))
const kaOk = keepAlive.exists && keepAlive.paused === false && keepAlive.loop === true && keepAlive.volume === 0.01
console.log('[playcheck] 1 keep-alive:', kaOk ? 'PASS' : 'FAIL')

/* ---- 3 — first play is instant ---- */
await page.evaluate(() => {
  ;[...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Play / Pause')?.click()
})
const t0 = Date.now()
let playingIcon = false
for (let i = 0; i < 120; i++) {
  playingIcon = await page.evaluate(
    () => !!document.querySelector('button[aria-label="Play / Pause"] svg.lucide-pause'),
  )
  if (playingIcon) break
  await page.waitForTimeout(50)
}
const firstPlayMs = Date.now() - t0
console.log(`[playcheck] 3 first play → sound state: ${firstPlayMs}ms`, firstPlayMs < 1000 ? 'PASS' : 'FAIL')

/* pause; the keep-alive must keep rendering through it */
await page.evaluate(() => {
  ;[...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Play / Pause')?.click()
})
await page.waitForTimeout(300)
const kaThroughPause = await page.evaluate(async () => {
  const m = await import('/src/lib/keepAlive.ts')
  const el = m.keepAliveElement()
  return el ? { paused: el.paused, t: el.currentTime } : { paused: 'gone' }
})
console.log('[playcheck] 2 keep-alive through pause:', JSON.stringify(kaThroughPause), kaThroughPause.paused === false ? 'PASS' : 'FAIL')

/* ---- 4 — resume after a SHORT pause ---- */
await page.waitForTimeout(1000)
const t1 = Date.now()
await page.evaluate(() => {
  ;[...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Play / Pause')?.click()
})
let ok1 = false
for (let i = 0; i < 120; i++) {
  ok1 = await page.evaluate(
    () => !!document.querySelector('button[aria-label="Play / Pause"] svg.lucide-pause'),
  )
  if (ok1) break
  await page.waitForTimeout(50)
}
const shortResumeMs = Date.now() - t1
console.log(`[playcheck] 4 short-pause resume: ${shortResumeMs}ms`, shortResumeMs < 1000 ? 'PASS' : 'FAIL')

/* ---- 5 — resume after a LONG pause ---- */
console.log('[playcheck] 5 pausing 65s…')
await page.evaluate(() => {
  ;[...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Play / Pause')?.click()
})
const kaLong = await page.evaluate(async () => {
  const m = await import('/src/lib/keepAlive.ts')
  const el = m.keepAliveElement()
  return el ? { paused: el.paused, t: Math.round(el.currentTime) } : { paused: 'gone' }
})
console.log('[playcheck] 5 keep-alive during the long pause:', JSON.stringify(kaLong), kaLong.paused === false ? 'PASS' : 'FAIL')
await page.waitForTimeout(65000)
const t2 = Date.now()
await page.evaluate(() => {
  ;[...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Play / Pause')?.click()
})
let ok2 = false
for (let i = 0; i < 120; i++) {
  ok2 = await page.evaluate(
    () => !!document.querySelector('button[aria-label="Play / Pause"] svg.lucide-pause'),
  )
  if (ok2) break
  await page.waitForTimeout(50)
}
const longResumeMs = Date.now() - t2
console.log(`[playcheck] 5 long-pause resume: ${longResumeMs}ms`, longResumeMs < 1000 ? 'PASS' : 'FAIL')

console.log('[playcheck] done')
await browser.close()
