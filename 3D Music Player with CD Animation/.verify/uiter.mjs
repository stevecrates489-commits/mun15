import { chromium } from 'playwright-core'

/* uiter — UI iteration shots: default panel, hover, colour theme (edge
   darkness check), and the customize-RESET remount case. */

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
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200)))

const bootClear = async () => {
  /* wait for the FULL exit: #boot.ready is transparent + click-through but
     its shader canvas is still on screen for ~a second after — a screenshot
     taken then reads as the shader, not the app */
  for (let i = 0; i < 20; i++) {
    const gone = await page.evaluate(() => {
      const b = document.querySelector('#boot')
      return !b || getComputedStyle(b).display === 'none'
    })
    if (gone) return
    const live = await page.evaluate(() => {
      const b = document.querySelector('#boot')
      return !!b && getComputedStyle(b).pointerEvents !== 'none'
    })
    if (live) await page.mouse.click(20, 880)
    await page.waitForTimeout(1000)
  }
}
const panelRect = () =>
  page.evaluate(() => {
    const el = [...document.querySelectorAll('.glass-panel')].find((p) => p.querySelector('[data-row-index]'))
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: Math.max(0, r.x - 12), y: Math.max(0, r.y - 12), width: r.width + 24, height: Math.min(r.height + 24, 876) }
  })
const shotPanel = async (name) => {
  const clip = await panelRect()
  if (clip) await page.screenshot({ path: `iter-${name}.png`, clip })
  else console.log(`[uiter] no panel for ${name}`)
}

const resafe = async () => {
  for (let i = 0; i < 4; i++) {
    try {
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 })
      return
    } catch {
      await page.waitForTimeout(1200)
    }
  }
  try {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 })
  } catch {
    /* one more race lost — carry on, the shots will say so */
  }
}

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
      for (let i = 1; i <= 11; i++) {
        tx.objectStore('tracks').put({ id: i, file: new File([buf], `T${i}.mp3`, { type: 'audio/mpeg' }), title: titles[i - 1], artist: `Artist ${i}` })
      }
      tx.oncomplete = () => { d.close(); res(null) }
    }
  })
  /* the default view is the Downloads Online folder now (no "all" tab) —
     the seeded tracks have to be IN it or the panel reads empty */
  const folders = [{
    id: -2,
    name: 'Downloads Online',
    trackIds: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  }]
  localStorage.setItem('md-playlists', JSON.stringify(folders))
  localStorage.setItem('md-selected-playlist', '-2')
})
await resafe()
await page.waitForTimeout(3500)
await bootClear()
await page.waitForTimeout(600)
await shotPanel('1-default')

/* hover a row */
const row = await page.evaluate(() => {
  const el = document.querySelector('[data-row-index="2"]')
  if (!el) return null
  const r = el.getBoundingClientRect()
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 }
})
if (row) {
  await page.mouse.move(row.x, row.y)
  await page.waitForTimeout(400)
  await shotPanel('2-hover')
  await page.mouse.move(20, 880)
}

/* ---- colour theme — the "darkness around the screen" check ---- */
await page.evaluate(() => {
  localStorage.setItem('md-theme', 'color')
  localStorage.setItem('md-wall-paint', JSON.stringify({ kind: 'gradient', stops: ['#5b2bd9', '#c04bd9', '#2b9fd9'], angle: 135 }))
})
await resafe()
await page.waitForTimeout(3500)
await bootClear()
await page.waitForTimeout(600)
await page.screenshot({ path: 'iter-3-colour-full.png' })

/* ---- the customize RESET remount case (was: black panel) ---- */
await page.evaluate(() => {
  /* a saved tracklist box so RESET is enabled — simulates the user's state */
  localStorage.setItem('md-tracklist-box', JSON.stringify({ x: 900, y: 400, w: 420, h: 420 }))
})
await resafe()
await page.waitForTimeout(3500)
await bootClear()
await page.waitForTimeout(600)
await page.screenshot({ path: 'iter-4-framed.png' })
await page.evaluate(() => {
  ;[...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === 'Customize layout')?.click()
})
await page.waitForTimeout(500)
await page.evaluate(() => {
  ;[...document.querySelectorAll('button')].find((b) => b.textContent?.trim().startsWith('RESET'))?.click()
})
await page.waitForTimeout(900)
await page.screenshot({ path: 'iter-5-after-reset-full.png' })
await shotPanel('5-after-reset-panel')
console.log('[uiter] done')
await browser.close()
