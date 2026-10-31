import { chromium } from 'playwright-core'

/* lyrcheck — the CUSTOMIZE layout system.
   1. drag/resize selects no text (body.layout-editing + preventDefault)
   2. two lyrics rectangles: md-lyrics-box-on / md-lyrics-box-off (CD split),
      legacy md-lyrics-box migrates into the CD-on slot
   3. EDIT → chrome appears → SAVE LAYOUT → chrome gone, layout kept
   4. tracklist framed the same way, persisted in md-tracklist-box, RESET docks
   5. Customize button + panel with the moved CUSTOM POSITION toggle */

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
  /* pre-CD-split record — must migrate into the CD-ON slot */
  localStorage.setItem('md-lyrics-box', JSON.stringify({ x: 60, y: 50, w: 420, h: 320 }))
})
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200)))

const out = {}
const raf2 = () =>
  page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))

const lyricsFrame = () =>
  page.evaluate(() => {
    const host = document.querySelector('.lyrics-host')
    const f = host ? host.closest('div.fixed') : null
    if (!f) return null
    const r = f.getBoundingClientRect()
    return { x: r.x, y: r.y, w: r.width, h: r.height, handles: f.querySelectorAll('[role="separator"]').length }
  })

const tracklistFrame = () =>
  page.evaluate(() => {
    const panel = document.querySelector('.playlist-scroll')?.closest('.glass-panel')
    const f = panel ? panel.closest('div.fixed') : null
    if (!f) return null
    const r = f.getBoundingClientRect()
    return { x: r.x, y: r.y, w: r.width, h: r.height, handles: f.querySelectorAll('[role="separator"]').length }
  })

const uiState = () =>
  page.evaluate(() => ({
    editing: document.body.classList.contains('layout-editing'),
    userSelect: getComputedStyle(document.body).userSelect,
    saveBtn: [...document.querySelectorAll('button')].some((b) => b.textContent?.includes('SAVE LAYOUT')),
    selection: (window.getSelection() ?? { toString: () => '' }).toString().length,
  }))

const openCustomize = async () => {
  await page.locator('button[aria-label="Customize layout"]').click()
  await page.waitForTimeout(400)
}
const clickCustomize = async (label) => {
  await page.locator('div.settings-panel', { hasText: 'CUSTOMIZE' }).locator('button', { hasText: label }).first().click()
  await page.waitForTimeout(400)
}

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
    tx.objectStore('tracks').put({ id: 1, file, title: 'Pent Straight', artist: 'Gurnam Bhullar' })
    tx.oncomplete = () => d.close()
  }
})
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(3500)
await raf2()

/* 5 — Customize button + panel; toggle moved out of Lyrics Settings */
await openCustomize()
out.customizePanel = await page.evaluate(() => {
  const p = [...document.querySelectorAll('.settings-panel')].find((q) => q.textContent?.includes('CUSTOMIZE'))
  if (!p) return { found: false }
  const t = p.textContent ?? ''
  return { found: true, customPos: t.includes('CUSTOM POSITION'), editLyrics: t.includes('EDIT LYRICS LAYOUT'), editTracklist: t.includes('EDIT TRACKLIST LAYOUT') }
})
await page.locator('button[aria-label="Close customize panel"]').click()
await page.waitForTimeout(400)
await page.locator('button[aria-label="Lyrics settings"]').click()
await page.waitForTimeout(400)
out.lyricsSettingsMigrated = await page.evaluate(() => {
  const p = [...document.querySelectorAll('.settings-panel')].find((q) => q.textContent?.includes('LYRICS SETTINGS'))
  return !!p && !p.textContent?.includes('CUSTOM POSITION')
})
await page.locator('button[aria-label="Close lyrics settings"]').click()
await page.waitForTimeout(300)

/* 2 + 3 — lyrics edit with the CD ON: legacy box migrates, edit, save */
await openCustomize()
await clickCustomize('CUSTOM POSITION') /* on — uses the migrated legacy box */
await raf2()
out.migratedFrame = await lyricsFrame() /* expect ≈ {60,50,420,320} — legacy read as the CD-on box */
/* the legacy key stays the fallback until the first edit commits the new key */
out.migratedOn = await page.evaluate(() => !!localStorage.getItem('md-lyrics-box-on'))

await clickCustomize('EDIT LYRICS LAYOUT')
await raf2()
let st = await uiState()
let fr = await lyricsFrame()
out.editChrome = { editing: st.editing, userSelect: st.userSelect, saveBtn: st.saveBtn, handles: fr?.handles }
/* item 1 — a drag over the words must not select text */
await page.mouse.move(fr.x + fr.w * 0.5, fr.y + fr.h * 0.5)
await page.mouse.down()
for (let i = 1; i <= 10; i++) await page.mouse.move(fr.x + fr.w * 0.5 + 12 * i, fr.y + fr.h * 0.5 + 6 * i)
await page.mouse.up()
await page.waitForTimeout(250)
out.noTextSelected = (await uiState()).selection === 0
await raf2()
const moved1 = await lyricsFrame()
out.dragInEdit = moved1 && moved1.x > fr.x + 100 && moved1.y > fr.y + 40
out.boxOnSaved = await page.evaluate((r) => {
  const b = JSON.parse(localStorage.getItem('md-lyrics-box-on') ?? 'null')
  return !!b && Math.round(b.x) === Math.round(r.x) && Math.round(b.y) === Math.round(r.y)
}, moved1)

/* 3 — SAVE LAYOUT exits; chrome disappears; layout kept */
await page.locator('button', { hasText: 'SAVE LAYOUT' }).click()
await page.waitForTimeout(400)
st = await uiState()
fr = await lyricsFrame()
out.afterSave = { editing: st.editing, userSelect: st.userSelect, saveBtn: st.saveBtn, handles: fr.handles, rectKept: Math.abs(fr.x - moved1.x) < 1 }

/* 2 — CD OFF gets its own rectangle */
await page.evaluate(() => localStorage.setItem('md-cd-visible', '0'))
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(3500)
await raf2()
const cdOffBefore = await lyricsFrame() /* no box-off yet → default, NOT the cd-on box */
out.cdOffSeparate = cdOffBefore && Math.abs(cdOffBefore.x - moved1.x) > 30
await openCustomize()
await clickCustomize('EDIT LYRICS LAYOUT')
await raf2()
fr = await lyricsFrame()
await page.mouse.move(fr.x + fr.w * 0.5, fr.y + fr.h * 0.8)
await page.mouse.down()
for (let i = 1; i <= 10; i++) await page.mouse.move(fr.x + fr.w * 0.5 - 10 * i, fr.y + fr.h * 0.8 + 8 * i)
await page.mouse.up()
await page.waitForTimeout(250)
await page.locator('button', { hasText: 'SAVE LAYOUT' }).click()
await page.waitForTimeout(400)
out.boxOffSaved = await page.evaluate(() => !!localStorage.getItem('md-lyrics-box-off'))
const offRect = await lyricsFrame()

/* 2 — toggling the CD switches between the two saved layouts */
await page.evaluate(() => localStorage.setItem('md-cd-visible', '1'))
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(3500)
await raf2()
const cdOnRect = await lyricsFrame()
out.cdSwitchOn = cdOnRect && Math.abs(cdOnRect.x - moved1.x) < 1 && Math.abs(cdOnRect.y - moved1.y) < 1
await page.evaluate(() => localStorage.setItem('md-cd-visible', '0'))
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(3500)
await raf2()
const cdOffRect = await lyricsFrame()
out.cdSwitchOff = cdOffRect && offRect && Math.abs(cdOffRect.x - offRect.x) < 1 && Math.abs(cdOffRect.y - offRect.y) < 1

/* 4 — tracklist: edit, drag, resize, save, persist, reset */
await openCustomize()
await clickCustomize('EDIT TRACKLIST LAYOUT')
await raf2()
const tf0 = await tracklistFrame()
out.tracklistFramed = !!tf0 && tf0.handles === 8
await page.mouse.move(tf0.x + tf0.w * 0.5, tf0.y + tf0.h * 0.9)
await page.mouse.down()
for (let i = 1; i <= 10; i++) await page.mouse.move(tf0.x + tf0.w * 0.5 + 8 * i, tf0.y + tf0.h * 0.9 + 4 * i)
await page.mouse.up()
await page.waitForTimeout(250)
const hpos = await page.evaluate(() => {
  const panel = document.querySelector('.playlist-scroll')?.closest('.glass-panel')
  const h = [...(panel ? panel.closest('div.fixed').querySelectorAll('[role="separator"]') : [])]
    .find((q) => q.getAttribute('aria-label') === 'Resize bottom-right')
  const r = h.getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
})
await page.mouse.move(hpos.x, hpos.y)
await page.mouse.down()
for (let i = 1; i <= 8; i++) await page.mouse.move(hpos.x + 12 * i, hpos.y + 8 * i)
await page.mouse.up()
await page.waitForTimeout(250)
const tf1 = await tracklistFrame()
out.tracklistMovedResized = tf1 && tf1.x > tf0.x + 40 && tf1.w > tf0.w + 40
out.tracklistSavedBox = await page.evaluate((r) => {
  const b = JSON.parse(localStorage.getItem('md-tracklist-box') ?? 'null')
  return !!b && Math.round(b.x) === Math.round(r.x) && Math.round(b.w) === Math.round(r.w)
}, tf1)
await page.locator('button', { hasText: 'SAVE LAYOUT' }).click()
await page.waitForTimeout(400)
out.tracklistChromeGone = (await tracklistFrame()).handles === 0

/* 4 — remembers on reload */
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(3500)
await raf2()
const tf2 = await tracklistFrame()
out.tracklistAfterReload = tf2 && Math.abs(tf2.x - tf1.x) < 1 && Math.abs(tf2.w - tf1.w) < 1

/* 4 — RESET docks it back and clears the box */
await openCustomize()
await page.locator('div.settings-panel', { hasText: 'CUSTOMIZE' }).locator('button[aria-label="Reset tracklist layout"]').click()
await page.waitForTimeout(400)
out.tracklistReset = await page.evaluate(() => {
  const panel = document.querySelector('.playlist-scroll')?.closest('.glass-panel')
  return !localStorage.getItem('md-tracklist-box') && panel && !panel.closest('div.fixed')
})

console.log(JSON.stringify(out, null, 2))
await browser.close()
