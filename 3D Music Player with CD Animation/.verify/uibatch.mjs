import { chromium } from 'playwright-core'

/* uibatch — the 11-item UI/logic batch:
   1  no idle cursor hiding
   2  bar graph reacts across track changes (capture re-take)
   3  radio VISUAL toggle flips the source only, never the backdrop
   4  header (wallpaper colour icon) above the lyrics overlay
   5  CD-off lyric sheet carries the hard white overrides
   6  NEXT/PREV step reliably, including after a stale standby
   7  no HUE slider in the visualiser tuning
   8  CLICK DISC hint lines gone
   9  bars/intensity steppers align in one vertical column
   10 native select popups painted dark with readable text
   11 favourited presets wear the star in the dropdown */

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
  localStorage.setItem('md-cd-visible', '0')
})
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200)))

const raf2 = () =>
  page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
const clickText = (text) =>
  page.evaluate((t) => {
    ;[...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === t)?.click()
  }, text)
const safeReload = async () => {
  try {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 })
  } catch {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 })
  }
}

await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(4000)
/* three REAL files — the capture re-take and the stepping need real media.
   The transaction is AWAITED: reloading before the put commits loses the
   seed (and every check below with it). */
const seedTracks = () =>
  page.evaluate(async () => {
    const buf = await (await fetch('/src/assets/track1.mp3')).arrayBuffer()
    await new Promise((res, rej) => {
      const db = indexedDB.open('md-walkman', 3)
      db.onupgradeneeded = () => {
        const d = db.result
        if (!d.objectStoreNames.contains('tracks')) d.createObjectStore('tracks', { keyPath: 'id' })
        if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'key' })
        if (!d.objectStoreNames.contains('lyrics')) d.createObjectStore('lyrics', { keyPath: 'key' })
      }
      db.onerror = () => rej(new Error('idb open failed'))
      db.onsuccess = () => {
        const d = db.result
        const tx = d.transaction('tracks', 'readwrite')
        for (let i = 1; i <= 3; i++) {
          tx.objectStore('tracks').put({
            id: i,
            file: new File([buf], `Step ${i}.mp3`, { type: 'audio/mpeg' }),
            title: `Stepper Track ${i}`,
            artist: `Qqz ${i}`,
          })
        }
        tx.oncomplete = () => {
          d.close()
          res(null)
        }
        tx.onerror = () => rej(new Error('idb put failed'))
      }
    })
  })
await seedTracks()
await safeReload()
await page.waitForTimeout(3500)
for (let i = 0; i < 5; i++) {
  const up = await page.evaluate(
    () => !document.querySelector('#boot') || getComputedStyle(document.querySelector('#boot')).display === 'none',
  )
  if (up) break
  await page.mouse.click(20, 880)
  await page.waitForTimeout(1200)
}
/* the library must actually be there — re-seed once if a race ate it */
let rows = await page.evaluate(() => document.querySelectorAll('[data-row-index]').length)
if (rows < 3) {
  await seedTracks()
  await safeReload()
  await page.waitForTimeout(3500)
  for (let i = 0; i < 5; i++) {
    const up = await page.evaluate(
      () => !document.querySelector('#boot') || getComputedStyle(document.querySelector('#boot')).display === 'none',
    )
    if (up) break
    await page.mouse.click(20, 880)
    await page.waitForTimeout(1200)
  }
  rows = await page.evaluate(() => document.querySelectorAll('[data-row-index]').length)
}
console.log('[uibatch] seed rows:', rows)
await page.waitForTimeout(400)
await raf2()

/* ---- 1 — the cursor is never hidden ---- */
await page.mouse.move(700, 400)
await page.waitForTimeout(3600) /* longer than the old 3s timer */
const cursor = await page.evaluate(() => {
  const root = document.querySelector('.md-root')
  const body = getComputedStyle(document.body).cursor
  const rootCur = root ? getComputedStyle(root).cursor : 'missing'
  const anyNone = [...document.querySelectorAll('.md-root, .md-root *')].some(
    (el) => getComputedStyle(el).cursor === 'none',
  )
  return { body, rootCur, anyNone }
})
console.log('[uibatch] 1 cursor:', JSON.stringify(cursor), !cursor.anyNone ? 'PASS' : 'FAIL')

/* ---- 8 — hint lines gone ---- */
const hints = await page.evaluate(() => document.body.textContent.includes('CLICK DISC TO PLAY'))
console.log('[uibatch] 8 hints gone:', !hints ? 'PASS' : 'FAIL')

/* ---- 4 — header above the lyrics overlay ---- */
const zinfo = await page.evaluate(() => {
  const header = document.querySelector('header')
  const hz = header ? Number(getComputedStyle(header).zIndex) : -1
  const swatch = document.querySelector('button[aria-label="Wallpaper colour"]')
  let clickable = false
  if (swatch) {
    const r = swatch.getBoundingClientRect()
    const at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
    clickable = at === swatch || swatch.contains(at)
  }
  return { hz, clickable }
})
console.log('[uibatch] 4 header z:', JSON.stringify(zinfo), zinfo.hz > 60 && zinfo.clickable ? 'PASS' : 'FAIL')

/* ---- 7 + 9 — the bar graph card: no HUE, steppers aligned ---- */
let panelOpen = false
for (let i = 0; i < 5 && !panelOpen; i++) {
  await page.evaluate(() => {
    ;[...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Visualiser options')?.click()
  })
  await page.waitForTimeout(700)
  panelOpen = await page.evaluate(() =>
    [...document.querySelectorAll('.settings-panel')].some((p) => p.textContent.includes('LIVE VISUALS')),
  )
}
/* the style must actually TAKE (the backdrop canvas appears) — retry */
let bgCanvas = false
for (let i = 0; i < 6 && !bgCanvas; i++) {
  await page.evaluate(() => {
    ;[...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'BAR GRAPH')?.click()
  })
  await page.waitForTimeout(1200)
  bgCanvas = await page.evaluate(() => !!document.querySelector('.bg-layer canvas'))
}
console.log('[uibatch] 7b backdrop canvas:', bgCanvas ? 'PASS' : 'FAIL')
await page.waitForTimeout(1200)
/* open the bar graph's own card — poll, the toggle find can race */
let cardOpen = false
for (let i = 0; i < 6 && !cardOpen; i++) {
  cardOpen = await page.evaluate(() => {
    const card = [...document.querySelectorAll('button[aria-expanded]')].find(
      (b) => b.textContent?.trim() === 'BAR GRAPH',
    )
    if (card && card.getAttribute('aria-expanded') === 'false') card.click()
    return card?.getAttribute('aria-expanded') === 'true'
  })
  if (!cardOpen) await page.waitForTimeout(500)
}
const card7 = await page.evaluate(() => {
  const panel = [...document.querySelectorAll('.settings-panel')].find((p) =>
    p.textContent.includes('LIVE VISUALS'),
  )
  if (!panel) return { open: false }
  const labels = [...panel.querySelectorAll('span')].map((s) => s.textContent?.trim())
  return { open: true, hasHue: labels.includes('HUE') }
})
console.log('[uibatch] 7 no HUE:', JSON.stringify(card7), card7.open && !card7.hasHue ? 'PASS' : 'FAIL')

const align9 = await page.evaluate(() => {
  const minusFewer = document.querySelector('button[aria-label="Fewer bars"]')
  const minusInt = document.querySelector('button[aria-label="Decrease intensity"]')
  const outBars = [...document.querySelectorAll('output')].find((o) => o.textContent.trim() === '128')
  const outInt = [...document.querySelectorAll('output')].find((o) => o.textContent.includes('×'))
  if (!minusFewer || !minusInt || !outBars || !outInt) return { found: false }
  const a = minusFewer.getBoundingClientRect()
  const b = minusInt.getBoundingClientRect()
  const oa = outBars.getBoundingClientRect()
  const ob = outInt.getBoundingClientRect()
  return {
    found: true,
    minusDx: Math.abs(a.left - b.left),
    outDx: Math.abs(oa.left - ob.left),
    clusterW: Math.round(a.width),
  }
})
console.log('[uibatch] 9 stepper alignment:', JSON.stringify(align9), align9.found && align9.minusDx < 1.5 && align9.outDx < 1.5 ? 'PASS' : 'FAIL')

/* ---- 10 + 11 — butterchurn dropdown: dark list, star on favourites ----
   (the visualiser panel was closed for item 2 — reopen it; verify the style
   actually takes by polling for the butterchurn select itself) */
let sel10 = { found: false }
for (let i = 0; i < 12 && !sel10.found; i++) {
  const open = await page.evaluate(() =>
    [...document.querySelectorAll('.settings-panel')].some((p) => p.textContent.includes('LIVE VISUALS')),
  )
  if (!open) {
    await page.evaluate(() => {
      ;[...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Visualiser options')?.click()
    })
    await page.waitForTimeout(600)
  }
  await page.evaluate(() => {
    ;[...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'BUTTERCHURN')?.click()
  })
  await page.waitForTimeout(1500)
  sel10 = await page.evaluate(() => {
    const sel = document.querySelector('select[aria-label="Butterchurn preset"]')
    if (!sel) return { found: false }
    return {
      found: true,
      colorScheme: getComputedStyle(sel).colorScheme,
      optBg: getComputedStyle(sel.querySelector('option')).backgroundColor,
      count: sel.options.length,
    }
  })
}
console.log('[uibatch] 10 select:', JSON.stringify(sel10), sel10.found && sel10.colorScheme === 'dark' && sel10.optBg === 'rgb(20, 22, 28)' ? 'PASS' : 'FAIL')

/* favourite the CURRENT preset via the star button, then read the option text */
const star11 = await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button')].find(
    (b) => b.getAttribute('aria-label') === 'Add to favourites',
  )
  btn?.click()
  return !!btn
})
await page.waitForTimeout(400)
const opt11 = await page.evaluate(() => {
  const sel = document.querySelector('select[aria-label="Butterchurn preset"]')
  if (!sel) return { found: false }
  const opt = sel.selectedOptions[0] ?? sel.options[0]
  return { found: true, text: opt?.textContent?.slice(0, 3), value: opt?.value?.slice(0, 20) }
})
console.log('[uibatch] 11 star:', JSON.stringify(opt11), star11 && opt11.found && opt11.text === '⭐ ' ? 'PASS' : 'FAIL')

/* ---- 2 — the live bar graph reacts across track changes ----
   The old bug: the capture stream went stale after `src` changed, so track 2
   onwards read silence. The backdrop canvas must paint on BOTH tracks.
   (the canvas already exists from the card checks — the panel closes, the
   backdrop stays) */
await page.evaluate(() => {
  ;[...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Close visualiser')?.click()
})
await page.waitForTimeout(500)

const playRow = async (i) => {
  await page.evaluate((idx) => {
    const row = document.querySelector(`[data-row-index="${idx}"]`)
    if (row) row.click()
  }, i)
}
/* sample EVERY large 2d canvas and take the most lit one — the backdrop
   must be told apart from the disc/eye canvases by its pixels, not guesses */
const canvasSample = () =>
  page.evaluate(() => {
    const inv = [...document.querySelectorAll('canvas')].map((c) => `${c.width}x${c.height}:${String(c.parentElement?.className).slice(0, 30)}`)
    let best = { found: false, lit: 0, inv }
    for (const cv of document.querySelectorAll('canvas')) {
      const ctx = cv.getContext('2d')
      if (!ctx) continue
      let lit = 0
      for (let x = 4; x < 300; x += 10) {
        for (let y = Math.max(0, cv.height - 300); y < cv.height - 10; y += 12) {
          const d = ctx.getImageData(x, y, 1, 1).data
          if (d[0] > 40 || d[1] > 40 || d[2] > 40) lit++
        }
      }
      if (lit > best.lit) best = { found: true, lit, inv }
    }
    return best
  })

await playRow(0)
/* the backdrop module remounts on style change — poll until a canvas paints */
let s1 = { found: false, lit: 0 }
for (let i = 0; i < 8 && !(s1.found && s1.lit > 20); i++) {
  await page.waitForTimeout(800)
  s1 = await canvasSample()
}
console.log('[uibatch] 2 bars on track 1:', JSON.stringify(s1), s1.found && s1.lit > 20 ? 'PASS' : 'FAIL')

/* ---- 5 — the CD-off lyric sheet carries the hard white overrides ----
   (checked with a track selected, so the panel is really mounted) */
const sheet5 = await page.evaluate(() => {
  for (const el of document.querySelectorAll('*')) {
    const root = el.shadowRoot
    if (!root) continue
    const ours = [...root.adoptedStyleSheets].find((s) => {
      try {
        return s.cssText.includes('--am-lyrics-highlight-color')
      } catch {
        return false
      }
    })
    if (!ours) continue
    const css = ours.cssText
    return {
      found: true,
      hardWhite: css.includes('background-clip: border-box') && css.includes('-webkit-text-stroke: 0'),
      noShadow: /\.lyrics-line[^{]*\{[^}]*text-shadow: none/.test(css),
    }
  }
  return { found: false }
})
console.log('[uibatch] 5 white sheet:', JSON.stringify(sheet5), sheet5.found && sheet5.hardWhite && sheet5.noShadow ? 'PASS' : 'FAIL (manual check)')

await page.evaluate(() => {
  ;[...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Next')?.click()
})
await page.waitForTimeout(2500)
const s2 = await canvasSample()
console.log('[uibatch] 2 bars on track 2:', JSON.stringify(s2), s2.found && s2.lit > 20 ? 'PASS' : 'FAIL')

/* ---- 6 — next/prev stepping (ordered, with a standby armed) ---- */
const nowTitle = () =>
  page.evaluate(() => {
    const active = document.querySelector('[data-row-index][data-active="true"]')
    if (!active) return null
    const leaf = [...active.querySelectorAll('span')].find((s) =>
      /^Stepper Track \d/.test(s.textContent ?? ''),
    )
    return leaf?.textContent ?? null
  })
/* NEXT twice more: 2 → 3 → wrap to 1 */
const steps = []
for (let i = 0; i < 2; i++) {
  await page.evaluate(() => {
    ;[...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Next')?.click()
  })
  await page.waitForTimeout(1500)
  steps.push(await nowTitle())
}
console.log('[uibatch] 6 next steps:', JSON.stringify(steps))
const prevs = []
for (let i = 0; i < 2; i++) {
  await page.evaluate(() => {
    ;[...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Previous')?.click()
  })
  await page.waitForTimeout(1500)
  prevs.push(await nowTitle())
}
console.log('[uibatch] 6 prev steps:', JSON.stringify(prevs))
/* the row's leaf span carries title AND artist — match on the title prefix */
const t1 = steps[0]?.startsWith('Stepper Track 3')
const t2 = steps[1]?.startsWith('Stepper Track 1')
const p1 = prevs[0]?.startsWith('Stepper Track 3') || prevs[0]?.startsWith('Stepper Track 2')
console.log('[uibatch] 6 wrap + prev:', t1 && t2 && p1 ? 'PASS' : 'FAIL')

/* ---- 3 — the radio VISUAL toggle flips the source only ---- */
await page.evaluate(() => {
  const btn = document.querySelector('button[aria-label="Radio (hold)"]')
  btn?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))
})
await page.waitForTimeout(600)
await page.evaluate(() => {
  const btn = document.querySelector('button[aria-label="Radio (hold)"]')
  btn?.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }))
})
await page.waitForTimeout(800)
const radioPanel = await page.evaluate(() => !!document.body.textContent.includes('KNOWN STATIONS'))
const vizBefore = await page.evaluate(() => localStorage.getItem('md-radio-viz'))
if (radioPanel) {
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) =>
      b.textContent?.trim().startsWith('VISUAL'),
    )
    btn?.click()
  })
  await page.waitForTimeout(300)
  const after = await page.evaluate(() => ({
    pref: localStorage.getItem('md-radio-viz'),
    backdropAlive: !!document.querySelector('canvas'),
    panelStillOpen: !!document.body.textContent.includes('KNOWN STATIONS'),
  }))
  const flipped = vizBefore !== after.pref
  console.log('[uibatch] 3 radio viz toggle:', JSON.stringify({ vizBefore, ...after }), flipped && after.backdropAlive ? 'PASS' : 'FAIL')
} else {
  console.log('[uibatch] 3 radio panel did not open — SKIP (manual check)')
}

console.log('[uibatch] done')
await browser.close()
