import { chromium } from 'playwright-core'

/* polishcheck — the UI/UX polish pass:
   1. the three stage toggles (radio/CD/wallpaper) + favourite heart live in
      the player panel's transport row
   2. the heart toggles FAVOURITES membership (folder + row heart)
   3. no BUFFERING node anywhere; volume slider capped
   4. carousel: feathered stage mask, transparent container
   5. lyrics host padding-top; CURRENT LINE pill centred via translate
   6. settings panels use the thin scrollbar
   7. edit mode: radio opens on a plain click */

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
})
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 160)))

let pass = 0
let fail = 0
const check = (name, ok, extra = '') => {
  if (ok) pass++
  else fail++
  console.log(`[polishcheck] ${ok ? 'PASS' : 'FAIL'} — ${name}${extra ? ` (${extra})` : ''}`)
}
const raf2 = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))

await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(4000)
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
    for (let i = 1; i <= 4; i++) {
      const file = new File([buf], `S${i}.mp3`, { type: 'audio/mpeg' })
      tx.objectStore('tracks').put({ id: i, file, title: `Polish Track ${i}`, artist: `Tester ${i}` })
    }
    tx.oncomplete = () => d.close()
  }
  localStorage.setItem(
    'md-playlists',
    JSON.stringify([
      { id: -2, name: 'Downloads Online', trackIds: [1, 2, 3, 4] },
      { id: -1, name: 'FAVOURITES', trackIds: [1] },
      { id: 100, name: 'Road 66', trackIds: [3, 4] },
    ]),
  )
  localStorage.setItem('md-selected-playlist', '-2')
})
try { await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 }) } catch { await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 }) }
await page.waitForTimeout(3500)
for (let i = 0; i < 6; i++) {
  const up = await page.evaluate(() => !document.querySelector('#boot') || getComputedStyle(document.querySelector('#boot')).display === 'none')
  if (up) break
  await page.mouse.click(20, 880)
  await page.waitForTimeout(1200)
}
await page.waitForTimeout(400)
await raf2()

/* ---- 1. transport row buttons ---- */
const transport = await page.evaluate(() => {
  const btns = [...document.querySelectorAll('.music-control-glass button')]
  const labels = btns.map((b) => b.getAttribute('aria-label'))
  return {
    radio: labels.includes('Radio — hold to open'),
    cd: labels.includes('CD settings'),
    wall: labels.includes('Wallpaper settings'),
    heart: labels.includes('Add to favourites') || labels.includes('Remove from favourites'),
    heartActive: !!btns.find((b) => b.getAttribute('aria-label') === 'Remove from favourites'),
    noFloatingRadio: !document.querySelector('button[aria-label="Radio (hold)"]'),
    noFloatingWall: !document.querySelector('button[aria-label="Wallpaper settings"]:not(.music-control-glass button)'),
  }
})
check('radio toggle inside player panel', transport.radio)
check('CD settings toggle inside player panel', transport.cd)
check('wallpaper settings toggle inside player panel', transport.wall)
check('heart inside player panel', transport.heart)
check('track 1 is in FAVOURITES so heart starts armed', transport.heartActive)
check('no floating radio button on the stage', transport.noFloatingRadio)

/* ---- 2. heart toggles favourites ---- */
await page.evaluate(() => [...document.querySelectorAll('.music-control-glass button')].find((b) => b.getAttribute('aria-label') === 'Remove from favourites')?.click())
await page.waitForTimeout(300)
let favs = await page.evaluate(() => JSON.parse(localStorage.getItem('md-playlists') ?? '[]').find((f) => f.id === -1)?.trackIds ?? [])
check('heart click REMOVES from FAVOURITES', !favs.includes(1), JSON.stringify(favs))
await page.evaluate(() => [...document.querySelectorAll('.music-control-glass button')].find((b) => b.getAttribute('aria-label') === 'Add to favourites')?.click())
await page.waitForTimeout(300)
favs = await page.evaluate(() => JSON.parse(localStorage.getItem('md-playlists') ?? '[]').find((f) => f.id === -1)?.trackIds ?? [])
check('heart click ADDS back to FAVOURITES', favs.includes(1), JSON.stringify(favs))

/* ---- 3. queue panel: hearts on playlist rows, none in queue tab ---- */
await page.click('button[role="tab"]:has-text("My playlists")')
await page.waitForTimeout(600)
await page.click('[data-open="100"]')
await page.waitForTimeout(700)
const plRow = await page.evaluate(() => {
  const row = document.querySelector('.qp-row.qp-t')
  if (!row) return null
  const heart = row.querySelector('button[aria-label*="favourites"]')
  const st = getComputedStyle(row.querySelector('.qp-meta'))
  return { hasHeart: !!heart, mask: st.maskImage || st.webkitMaskImage }
})
check('playlist rows have a heart', !!plRow && plRow.hasHeart)
check('playlist row text fades before 4 icons', !!plRow && /calc\(100% - 132px\)/.test(plRow.mask ?? ''), plRow?.mask?.slice(0, 60))
await page.click('button[role="tab"]:has-text("Current queue")')
await page.waitForTimeout(600)
const qRowHeart = await page.evaluate(() => {
  const row = document.querySelector('.qp-row[data-qidx]')
  return row ? !!row.querySelector('button[aria-label*="favourites"]') : null
})
check('NO heart in Current queue rows', qRowHeart === false)

/* ---- 3b. buffering gone, volume capped ---- */
const misc = await page.evaluate(() => {
  const vol = document.querySelector('.music-control-glass input[type="range"].chrome-range')
  const w = vol ? vol.getBoundingClientRect().width : 0
  return {
    buffering: document.body.textContent.includes('BUFFERING'),
    volW: Math.round(w),
    volParentMax: vol ? getComputedStyle(vol.parentElement).maxWidth : '',
  }
})
check('no BUFFERING text anywhere', misc.buffering === false)
check('volume slider capped at 150px', misc.volParentMax === '150px', `w=${misc.volW}px parent-max=${misc.volParentMax}`)

/* ---- 4. carousel ---- */
const cyl = await page.evaluate(() => {
  const widget = document.querySelector('.cyl-widget')
  if (!widget) return null
  const ws = getComputedStyle(widget)
  const stage = widget.querySelector('.cyl-stage')
  const ss = stage ? getComputedStyle(stage) : null
  return {
    bg: ws.backgroundColor,
    shadow: ws.boxShadow,
    mask: ss ? ss.maskImage || ss.webkitMaskImage : '',
  }
})
check('carousel container transparent', !!cyl && (cyl.bg === 'rgba(0, 0, 0, 0)' || cyl.bg === 'transparent'), String(cyl?.bg))
check('carousel container no shadow', !!cyl && (cyl.shadow === 'none' || cyl.shadow === ''), String(cyl?.shadow))
check('carousel stage feathered mask', !!cyl && cyl.mask.includes('linear-gradient'), cyl?.mask?.slice(0, 70))

/* ---- 5. lyrics ---- */
const lyr = await page.evaluate(() => {
  const host = document.querySelector('.lyrics-host')
  const ret = document.querySelector('.lyrics-return')
  let retRule = ''
  for (const sheet of document.styleSheets) {
    try {
      for (const r of sheet.cssRules) {
        if (r.cssText && r.cssText.includes('div.settings-panel.lyrics-return')) retRule = r.cssText
      }
    } catch {}
  }
  return {
    pad: host ? getComputedStyle(host).paddingTop : '',
    retRule,
    searching: document.body.textContent.includes('SEARCHING FOR LYRICS'),
    providerTag: !!document.querySelector('[data-lyrics-provider]'),
  }
})
check('lyrics host padding-top 2rem', lyr.pad === '32px', lyr.pad)
/* Chrome serialises `-50% 0` as `-50%` — the translate PROPERTY is the point */
check('CURRENT LINE pill centred via translate property', /translate:\s*-50%/.test(lyr.retRule) && lyr.retRule.includes('left: 50%'), lyr.retRule.slice(0, 80))

/* ---- 6. thin scrollbar on a settings panel (open PLAYER SETTINGS first) ---- */
await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Player settings')?.click())
await page.waitForTimeout(400)
const scroll = await page.evaluate(() => {
  const p = [...document.querySelectorAll('.settings-panel.panel-resizable')].find((el) => el.textContent.includes('CROSSFADE') || el.textContent.includes('PLAYER SETTINGS'))
  return p ? getComputedStyle(p).scrollbarWidth : ''
})
check('settings panels use thin scrollbar', scroll === 'thin', scroll)

/* ---- 7. edit mode: radio opens on a plain click (open CUSTOMIZE first) ---- */
await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Player settings')?.click())
await page.evaluate(() => [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Customize layout')?.click())
await page.waitForTimeout(400)
const editBtnFound = await page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'EDIT LAYOUT')
  if (!b) return false
  b.click()
  return true
})
check('EDIT LAYOUT button reachable', editBtnFound)
await page.waitForTimeout(600)
await page.evaluate(() => [...document.querySelectorAll('.music-control-glass button')].find((b) => b.getAttribute('aria-label') === 'Radio — hold to open')?.click())
await page.waitForTimeout(500)
const radioPanel = await page.evaluate(() => {
  const panels = [...document.querySelectorAll('.settings-panel.panel-resizable')]
  return panels.some((p) => p.textContent.toUpperCase().includes('RADIO'))
})
check('radio opens on a plain click in edit mode', radioPanel)

/* screenshot of the transport for the report */
await page.screenshot({ path: 'polishcheck-transport.png', clip: { x: 0, y: 260, width: 1440, height: 380 } })

console.log(`\n[polishcheck] ${pass} passed, ${fail} failed`)
await browser.close()
process.exit(fail ? 1 : 0)
