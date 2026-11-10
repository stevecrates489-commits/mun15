import { chromium } from 'playwright-core'

/* shot — screenshot the tracklist panel (and full app) for the UI pass */
const BASE = process.env.BASE ?? 'http://127.0.0.1:5210'
const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] })
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
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(4500)
await page.evaluate(async () => {
  const buf = await (await fetch('/src/assets/track1.mp3')).arrayBuffer()
  await new Promise((res) => {
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
      const titles = ['Baarish', 'Saving Grace', 'Tu Aake Dekhle', 'Dior', 'Midnight City', 'Nightcall', 'Instant Crush', 'Genesis', 'Otis', 'Redbone', 'Sunflower']
      const artists = ['Mohammed Irfan', 'KIRBY', 'King', 'Shubh', 'M83', 'Kavinsky', 'Daft Punk', 'Grimes', 'Outkast', 'Childish Gambino', 'Post Malone']
      for (let i = 1; i <= 11; i++) {
        tx.objectStore('tracks').put({
          id: i,
          file: new File([buf], `T${i}.mp3`, { type: 'audio/mpeg' }),
          title: titles[i - 1],
          artist: artists[i - 1],
        })
      }
      tx.oncomplete = () => { d.close(); res(null) }
    }
  })
})
try { await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 }) } catch { await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 }) }
await page.waitForTimeout(3500)
for (let i = 0; i < 6; i++) {
  const up = await page.evaluate(() => !document.querySelector('#boot') || getComputedStyle(document.querySelector('#boot')).display === 'none' || getComputedStyle(document.querySelector('#boot')).pointerEvents === 'none')
  if (up) break
  await page.mouse.click(20, 880)
  await page.waitForTimeout(1000)
}
await page.waitForTimeout(800)
await page.screenshot({ path: 'shot-tracklist.png' })
/* panel close-up */
const panel = await page.evaluate(() => {
  const el = [...document.querySelectorAll('.glass-panel')].find((p) => p.querySelector('[data-row-index]'))
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { x: Math.max(0, r.x - 10), y: Math.max(0, r.y - 10), width: r.width + 20, height: Math.min(r.height + 20, 880) }
})
if (panel) await page.screenshot({ path: 'shot-panel.png', clip: panel })
/* hover state on a row */
const row = await page.evaluate(() => {
  const el = document.querySelector('[data-row-index="2"]')
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
})
if (row) {
  await page.mouse.move(row.x, row.y)
  await page.waitForTimeout(400)
  await page.screenshot({ path: 'shot-row-hover.png', clip: panel })
}
console.log('shots done', JSON.stringify({ panel, row }))
await browser.close()
