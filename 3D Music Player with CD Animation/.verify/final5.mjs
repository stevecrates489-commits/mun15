import { chromium } from 'playwright-core'

/* final5 — lyrics sheet (item 5) + dropdown CSS (item 10) + star (item 11) */

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
  localStorage.setItem('md-lyrics', '1')
  localStorage.setItem('md-cd-visible', '0')
})
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)))

await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(4500)
await page.evaluate(async () => {
  const buf = await (await fetch('/src/assets/track1.mp3')).arrayBuffer()
  const ttml =
    '<tt xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="http://www.w3.org/ns/ttml#metadata">' +
    '<body><div>' +
    '<p begin="00:00.000" end="00:04.000"><span>Plain white line one</span></p>' +
    '<p begin="00:04.000" end="00:08.000"><span>Plain white line two</span></p>' +
    '</div></body></tt>'
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
      const tx = d.transaction(['tracks', 'lyrics'], 'readwrite')
      tx.objectStore('tracks').put({ id: 1, file: new File([buf], 'S1.mp3', { type: 'audio/mpeg' }), title: 'Stepper Track 1', artist: 'Qqz 1' })
      tx.objectStore('lyrics').put({
        key: '1',
        title: 'Stepper Track 1',
        artist: 'Qqz 1',
        ttml,
        source: 'custom',
        custom: true,
        savedAt: Date.now(),
      })
      tx.oncomplete = () => { d.close(); res(null) }
    }
  })
})
try { await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 }) } catch {}
await page.waitForTimeout(3500)
for (let i = 0; i < 5; i++) {
  const up = await page.evaluate(() => !document.querySelector('#boot') || getComputedStyle(document.querySelector('#boot')).display === 'none')
  if (up) break
  await page.mouse.click(20, 880)
  await page.waitForTimeout(1200)
}
await page.evaluate(() => document.querySelector('[data-row-index="0"]')?.click())
await page.waitForTimeout(2500)

/* ---- 5 — the CD-off lyrics render PLAIN WHITE (the rendered proof) ----
   The adopted sheets throw on cssRules here, so judge the cascade by what it
   produces: a seeded pinned lyric's line, computed. CD is OFF, so the metal
   face must lose to the hard white sheet no matter what. */
let s5 = { found: false }
for (let i = 0; i < 10 && !s5.found; i++) {
  await page.waitForTimeout(800)
  s5 = await page.evaluate(() => {
    const host = [...document.querySelectorAll('*')].find((el) => el.shadowRoot?.querySelector?.('.lyrics-line'))
    if (!host) return { found: false }
    const line = host.shadowRoot.querySelector('.lyrics-line:not(.active)') ?? host.shadowRoot.querySelector('.lyrics-line')
    const cs = getComputedStyle(line)
    return {
      found: true,
      color: cs.color,
      fill: cs.getPropertyValue('-webkit-text-fill-color'),
      shadow: cs.textShadow === 'none' ? 'none' : 'present',
      stroke: cs.getPropertyValue('-webkit-text-stroke-width'),
      bgImage: cs.backgroundImage === 'none' ? 'none' : 'present',
    }
  })
}
const white5 =
  s5.found &&
  (s5.color === 'rgb(255, 255, 255)' || s5.fill === 'rgb(255, 255, 255)') &&
  s5.shadow === 'none' &&
  s5.bgImage === 'none'
console.log('[final5] 5 rendered white:', JSON.stringify(s5), white5 ? 'PASS' : 'FAIL')

/* ---- 10 — the dark dropdown CSS applies to a real select ---- */
const s10 = await page.evaluate(() => {
  const sel = document.createElement('select')
  sel.id = 'probe-select'
  const opt = document.createElement('option')
  opt.textContent = 'probe'
  sel.appendChild(opt)
  document.body.appendChild(sel)
  const out = {
    colorScheme: getComputedStyle(sel).colorScheme,
    optBg: getComputedStyle(opt).backgroundColor,
    optColor: getComputedStyle(opt).color,
  }
  sel.remove()
  return out
})
console.log('[final5] 10 dropdown css:', JSON.stringify(s10), s10.colorScheme === 'dark' && (s10.optBg === 'rgb(20, 22, 28)' || s10.optBg === 'rgb(43, 51, 64)') ? 'PASS' : 'FAIL')

/* ---- 11 — the star template ships in the module ---- */
const s11 = await page.evaluate(async () => {
  const src = await (await fetch('/src/features/voltviz/impl/Butterchurn.tsx')).text()
  return {
    star: src.includes("'⭐ '") || src.includes('"⭐ "') || src.includes('⭐'),
    favCheck: src.includes('isFav(n)'),
  }
})
console.log('[final5] 11 star ships:', JSON.stringify(s11), s11.star && s11.favCheck ? 'PASS' : 'FAIL')

await browser.close()
