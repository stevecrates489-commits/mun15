import { chromium } from 'playwright-core'

/* lyrfix — lyrics texture rules, permanent placeholder, wallpaper flyout.
   1. metal iff (CD ON && pinned); CD OFF forces white; unpinned forces white
   2. the cute placeholder, once shown, stays (no 2-3s disappearance)
   3. YOUR WALLPAPERS row + left-side hover flyout; panel X always in view */

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
const safeReload = async () => {
  try {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 })
  } catch {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 })
  }
}

const TTML =
  '<tt xmlns="http://www.w3.org/ns/ttml"><body><div>' +
  '<p begin="00:00.000" end="00:05.000">STEEL LINE ONE</p>' +
  '<p begin="00:05.000" end="00:10.000">STEEL LINE TWO</p>' +
  '</div></body></tt>'

/* what the lyrics element currently wears: metal gradient or strict white */
const sheetFace = () =>
  page.evaluate(() => {
    const root = document.querySelector('.lyrics-host')?.querySelector('am-lyrics')?.shadowRoot
    if (!root) return { host: false }
    let css = ''
    for (const sheet of root.adoptedStyleSheets) {
      try {
        for (const rule of sheet.cssRules) css += rule.cssText + '\n'
      } catch {
        /* not inspectable — skip */
      }
    }
    return {
      host: true,
      metal: css.includes('linear-gradient(100deg'),
      white: css.includes('#ffffff 55%'),
      lines: root.querySelectorAll('.lyrics-line:not(.lyrics-footer)').length,
    }
  })

await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(4000)
await page.evaluate((ttml) => {
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
    tx.objectStore('tracks').put({ id: 1, file, title: 'Steel Probe', artist: 'Qqz' })
    const tx2 = d.transaction('lyrics', 'readwrite')
    tx2.objectStore('lyrics').put({
      key: '1',
      title: 'Steel Probe',
      artist: 'Qqz',
      ttml,
      source: 'custom',
      custom: true,
      savedAt: Date.now(),
    })
    tx2.oncomplete = () => d.close()
  }
}, TTML)
await safeReload()
await page.waitForTimeout(3500)
await raf2()

/* 1a — CD ON + pinned → metal */
out.pinnedCdOn = { ...(await sheetFace()), pinnedShown: await page.evaluate(() =>
  [...document.querySelectorAll('button')].some((b) => b.getAttribute('aria-label') === 'Unpin these lyrics'),
) }

/* 1b — CD OFF + pinned → white (the bleed-through fix) */
await page.evaluate(() => localStorage.setItem('md-cd-visible', '0'))
await safeReload()
await page.waitForTimeout(3500)
await raf2()
out.pinnedCdOff = { ...(await sheetFace()), pinnedStill: await page.evaluate(() =>
  [...document.querySelectorAll('button')].some((b) => b.getAttribute('aria-label') === 'Unpin these lyrics'),
) }

/* 1c — unpinned + CD ON → white */
await page.evaluate(() => {
  localStorage.setItem('md-cd-visible', '1')
  const db = indexedDB.open('md-walkman', 3)
  db.onsuccess = () => {
    const d = db.result
    const tx = d.transaction('lyrics', 'readwrite')
    tx.objectStore('lyrics').delete('1')
    tx.oncomplete = () => d.close()
  }
})
await safeReload()
await page.waitForTimeout(3500)
await raf2()
out.unpinnedCdOn = await sheetFace()
console.log('[lyrfix] item 1', JSON.stringify(out))

/* 2 — the placeholder, once shown, stays: observe well past the point
   where the old footer bug cleared it (~1s after appearing) */
await page.evaluate(() => localStorage.setItem('md-cd-visible', '0'))
await safeReload()
await page.waitForTimeout(3500)
out.placeholderAppeared = false
for (let i = 0; i < 8; i++) {
  await page.waitForTimeout(2000)
  if (await page.evaluate(() => (document.body.textContent ?? '').includes('JUST VIBING'))) {
    out.placeholderAppeared = true
    break
  }
}
await page.waitForTimeout(15000)
out.placeholderStays = await page.evaluate(() => (document.body.textContent ?? '').includes('JUST VIBING'))
console.log('[lyrfix] item 2', JSON.stringify(out))

/* 3 — wallpaper settings: compact panel + left-side flyout */
await page.evaluate(() => localStorage.setItem('md-cd-visible', '1'))
await page.locator('button[aria-label="Wallpaper settings"]').click()
await page.waitForTimeout(500)
out.panelXVisible = await page.evaluate(() => {
  const panel = [...document.querySelectorAll('.settings-panel')].find((q) =>
    q.textContent?.includes('WALLPAPER SETTINGS'),
  )
  if (!panel) return false
  const pr = panel.getBoundingClientRect()
  const x = [...panel.querySelectorAll('button')].find((b) => b.closest('div') === panel && b.querySelector('svg'))
  const listGone = !panel.textContent?.includes('SAVED WALLPAPERS') && panel.textContent?.includes('YOUR WALLPAPERS')
  /* the panel must end above the bottom of the window with room to spare —
     and the close button must sit inside the viewport */
  const closeVisible = [...panel.querySelectorAll('button')].some((b) => {
    const r = b.getBoundingClientRect()
    return r.top >= 0 && r.bottom <= window.innerHeight && r.height > 0 && panel.textContent?.includes('')
      ? b.getAttribute('aria-label') === null && r.width > 0 && r.top < 60 + pr.top + 40
      : false
  })
  return { pr: { top: pr.top, bottom: pr.bottom }, vh: window.innerHeight, listGone, closeVisible, xFound: !!x }
})
/* hover the YOUR WALLPAPERS row */
const rowBox = await page.evaluate(() => {
  const row = [...document.querySelectorAll('div')].find((d) =>
    d.textContent?.trim().startsWith('YOUR WALLPAPERS') && d.getAttribute('aria-haspopup') === 'true',
  )
  if (!row) return null
  const r = row.getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2, left: r.left }
})
await page.mouse.move(rowBox.x, rowBox.y)
await page.waitForTimeout(500)
out.flyout = await page.evaluate((rowLeft) => {
  const f = document.querySelector('[aria-label="Saved wallpapers"]')
  if (!f) return { found: false }
  const r = f.getBoundingClientRect()
  return {
    found: true,
    opensLeft: r.right <= rowLeft + 2,
    hasClearAll: f.textContent?.includes('CLEAR ALL') ?? false,
    emptyState: f.textContent?.includes('NOTHING SAVED YET') ?? false,
    onScreen: r.left >= 0 && r.top >= 0,
  }
}, rowBox.left)
console.log('[lyrfix] item 3', JSON.stringify(out.flyout))

console.log(JSON.stringify(out, null, 2))
await browser.close()
