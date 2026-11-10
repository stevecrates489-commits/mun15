import { chromium } from 'playwright-core'

/* queuefix — the unified queue panel batch:
   1. header: no close X, no shuffle, no list/layout, no open-queue icon;
      glass (sliders) + pin ONLY — the player gear moved to the main screen
      (its own corner knob), so the panel is queue + playlists only
   2. search box: gone from Current queue, present in My playlists
   3. rows: left-aligned text, Space Grotesk / JetBrains Mono pairing
   4. every row carries a pencil; action icons are 13px (not oversized)
   5. plus opens the add-to menu (queue / a specific playlist, no Downloads)
   6. glass settings pop: 4 sliders, persisted to md-qp-glass; the panel's
      glass is liquidGL (WebGPU/WebGL refraction canvas inside the panel),
      blur rebuilds the lens as frost, and Blurred/Solid drops/brings the
      lens back
   7. player settings live on the MAIN screen: one corner knob opens the
      card (crossfade + steps + normalize + accent + Blurred/Solid), and
      the queue bar carries no shuffle/repeat pills and no ONLINE badges
   8. auto-hide: unpinned panel NEVER closes while the cursor is inside;
      it hides after the cursor leaves and returns from the dock edge
   9. global edit mode: the panel is hosted by a LayoutFrame (dotted box,
      corner handles), the old tracklist ghost frame is GONE
  10. corner resize + SAVE LAYOUT persists md-queue-box; RESET docks back */

const BASE = process.env.BASE ?? 'http://127.0.0.1:5210'
const hardStop = setTimeout(() => {
  console.error('[queuefix] HARD TIMEOUT — killing run after 9 minutes')
  process.exit(2)
}, 540000)
const browser = await chromium.launch({
  channel: 'msedge',
  headless: true,
  args: [
    '--autoplay-policy=no-user-gesture-required',
    /* Chromium 128+ blocks SwiftShader WebGL without this — without it the
       app takes liquidGL's CSS fallback and the GPU path never gets tested */
    '--enable-unsafe-swiftshader',
    '--use-gl=angle',
    '--use-angle=swiftshader',
  ],
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
  localStorage.removeItem('md-qp-glass')
  localStorage.removeItem('md-queue-box')
})
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200)))

let pass = 0
let fail = 0
const check = (name, ok, extra = '') => {
  if (ok) pass++
  else fail++
  console.log(`[queuefix] ${ok ? 'PASS' : 'FAIL'} — ${name}${extra ? ` (${extra})` : ''}`)
}
const raf2 = () =>
  page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
const safeReload = async () => {
  try {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 })
  } catch {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 })
  }
}

await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(4000)
/* seed six real files + playlists: FAVOURITES(-1), Road 66(100), Downloads(-2) */
await page.evaluate(async () => {
  const buf = await (await fetch('/src/assets/track1.mp3')).arrayBuffer()
  /* await the commit: reloading used to race the transaction */
  await new Promise((resolve, reject) => {
    const db = indexedDB.open('md-walkman', 3)
    db.onupgradeneeded = () => {
      const d = db.result
      if (!d.objectStoreNames.contains('tracks')) d.createObjectStore('tracks', { keyPath: 'id' })
      if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta', { keyPath: 'key' })
      if (!d.objectStoreNames.contains('lyrics')) d.createObjectStore('lyrics', { keyPath: 'key' })
    }
    db.onerror = () => reject(db.error)
    db.onsuccess = () => {
      const d = db.result
      try {
        const tx = d.transaction('tracks', 'readwrite')
        for (let i = 1; i <= 6; i++) {
          const file = new File([buf], `Seed ${i}.mp3`, { type: 'audio/mpeg' })
          tx.objectStore('tracks').put({
            id: i,
            file,
            title: `Aaardvark Track ${i}`,
            artist: `Qqz Wvv ${i}`,
          })
        }
        tx.oncomplete = () => {
          d.close()
          resolve(undefined)
        }
        tx.onerror = () => reject(tx.error)
        tx.onabort = () => reject(tx.error)
      } catch (e) {
        d.close()
        reject(e)
      }
    }
  })
  localStorage.setItem(
    'md-playlists',
    JSON.stringify([
      { id: -2, name: 'Downloads Online', trackIds: [1, 2, 3, 4, 5, 6] },
      { id: -1, name: 'FAVOURITES', trackIds: [1, 2] },
      { id: 100, name: 'Road 66', trackIds: [3, 4] },
    ]),
  )
  localStorage.setItem('md-selected-playlist', '-2')
})
await safeReload()
await page.waitForTimeout(3500)
/* the boot intro holds the whole window — dismiss it */
for (let i = 0; i < 6; i++) {
  const up = await page.evaluate(
    () =>
      !document.querySelector('#boot') ||
      getComputedStyle(document.querySelector('#boot')).display === 'none',
  )
  if (up) break
  await page.mouse.click(20, 880)
  await page.waitForTimeout(1200)
}
await page.waitForTimeout(400)
await raf2()

const panelVisible = () =>
  page.evaluate(() => {
    const p = document.querySelector('.qp-panel')
    if (!p) return null
    const r = p.getBoundingClientRect()
    return { x: r.x, y: r.y, w: r.width, h: r.height, cls: p.className }
  })

/* the panel should be open and docked at boot */
const p0 = await panelVisible()
check('queue panel open at boot', !!p0 && p0.w > 200, p0 ? `w=${Math.round(p0.w)}` : 'no panel')

/* ---- 1 — header ---- */
const header = await page.evaluate(() => {
  const head = document.querySelector('.qp-head')
  if (!head) return null
  const labels = [...head.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'))
  return labels
})
check('header buttons exist', Array.isArray(header) && header.length === 2, header ? header.join(' | ') : 'none')
check(
  'no Close (X) in header',
  Array.isArray(header) && !header.includes('Close queue panel'),
)
check(
  'no shuffle in header',
  Array.isArray(header) && !header.some((l) => l && l.toLowerCase().includes('shuffle')),
)
check(
  'no edit/resize/dock/open-queue in header',
  Array.isArray(header) &&
    !header.some(
      (l) =>
        l &&
        (l.toLowerCase().includes('edit mode') ||
          l.toLowerCase().includes('dock') ||
          l.toLowerCase().includes('open current queue')),
    ),
)
check(
  'glass + pin in header — the player gear moved to the main screen',
  Array.isArray(header) &&
    header.includes('Glass settings') &&
    header.includes('Keep panel open') &&
    !header.includes('Player settings'),
)

/* ---- 2 — search only in My playlists ---- */
const qSearch = await page.evaluate(() => !!document.querySelector('.qp-sbox'))
check('no search box on Current queue tab', !qSearch)
await page.click('button[role="tab"]:has-text("My playlists")')
await page.waitForTimeout(500)
const pSearch = await page.evaluate(() => !!document.querySelector('.qp-sbox'))
check('search box present on My playlists tab', pSearch)
const plHeaderHasPlus = await page.evaluate(() =>
  !!document.querySelector('.qp-head button[aria-label="New playlist"]'),
)
check('plus (new playlist) in header on playlists root', plHeaderHasPlus)
await page.click('button[role="tab"]:has-text("Current queue")')
await page.waitForTimeout(500)

/* ---- 3 + 4 — rows: alignment, fonts, pencil, icon size ---- */
const rows = await page.evaluate(() => {
  const list = [...document.querySelectorAll('.qp-row[data-qidx]')]
  const meta = list[0]?.querySelector('.qp-meta')
  if (!meta) return null
  const st = getComputedStyle(meta)
  const title = meta.querySelector('b')
  const artist = meta.querySelector('i')
  const pencil = list.filter(
    (r) => !!r.querySelector('.qp-acts button[title="Edit track"]'),
  ).length
  const icon = meta.parentElement.querySelector('.qp-acts .qp-i, .qp-acts svg')
  const iw = icon ? getComputedStyle(icon).width : '0'
  /* alignment regression: the meta column must start right after the art
     (the 3-col-on-4-children bug pushed it into the acts column) */
  const art = list[0].querySelector('.qp-art').getBoundingClientRect()
  const mr = meta.getBoundingClientRect()
  return {
    count: list.length,
    align: st.textAlign,
    titleFont: title ? getComputedStyle(title).fontFamily : '',
    artistFont: artist ? getComputedStyle(artist).fontFamily : '',
    artistSize: artist ? getComputedStyle(artist).fontSize : '',
    pencils: pencil,
    iconW: parseFloat(iw),
    artToMeta: Math.round(mr.x - (art.x + art.width)),
  }
})
check('queue rows rendered', !!rows && rows.count === 6, rows ? `count=${rows.count}` : 'no rows')
check('row text left-aligned', !!rows && rows.align === 'left', rows ? rows.align : '')
check('title font is Space Grotesk', !!rows && /Space Grotesk/.test(rows.titleFont))
check(
  'artist is JetBrains Mono 10px',
  !!rows && /JetBrains Mono/.test(rows.artistFont) && rows.artistSize === '10px',
  rows ? `${rows.artistSize}` : '',
)
check('pencil on every queue row', !!rows && rows.pencils === rows.count, rows ? `${rows.pencils}/${rows.count}` : '')
check('action icons are 13px', !!rows && rows.iconW === 13, rows ? `${rows.iconW}px` : '')
check(
  'meta starts right after the art (no squeezed column)',
  !!rows && rows.artToMeta >= 8 && rows.artToMeta <= 14,
  rows ? `gap=${rows.artToMeta}px` : '',
)

/* ---- 5 — plus opens the add-to menu ---- */
await page.hover('.qp-row[data-qidx="1"]')
await page.waitForTimeout(200)
await page.click('.qp-row[data-qidx="1"] .qp-acts button[title="Add to queue or playlist"]', { force: true })
await page.waitForTimeout(300)
const menu = await page.evaluate(() => {
  const m = document.querySelector('.qp-menu')
  if (!m) return null
  const items = [...m.querySelectorAll('button')].map((b) => b.textContent.trim())
  return items
})
check('plus opens the add-to menu', Array.isArray(menu) && menu.length > 1, menu ? menu.join(' | ') : '')
check('menu has Add to queue', Array.isArray(menu) && menu.some((t) => t === 'Add to queue'))
check(
  'menu lists FAVOURITES + Road 66, never Downloads Online',
  Array.isArray(menu) &&
    menu.some((t) => t === 'FAVOURITES') &&
    menu.some((t) => t === 'Road 66') &&
    !menu.includes('Downloads Online'),
)
await page.keyboard.press('Escape')
await page.waitForTimeout(200)

/* ---- 6 — glass settings pop ---- */
await page.click('.qp-head button[aria-label="Glass settings"]')
await page.waitForTimeout(250)
const glassPop = await page.evaluate(() => {
  const pop = document.querySelector('.qp-pop[aria-label="Glass settings"]')
  if (!pop) return null
  const ranges = [...pop.querySelectorAll('input[type="range"]')]
  const labels = [...pop.querySelectorAll('.qp-range > span')].map((s) => s.textContent)
  return { n: ranges.length, labels, first: ranges[0]?.value }
})
check(
  'glass pop has 4 sliders',
  !!glassPop && glassPop.n === 4,
  glassPop ? glassPop.labels.join(',') : 'none',
)
check(
  'glass pop labels',
  !!glassPop &&
    glassPop.labels.join(',') === 'Transparency,Blur,Refraction,Radius',
)
/* move the blur slider to 9 and check persistence + the liquidGL rebuild */
await page.evaluate(() => {
  const pop = document.querySelector('.qp-pop[aria-label="Glass settings"]')
  const blur = pop.querySelectorAll('input[type="range"]')[1]
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
  setter.call(blur, '9')
  blur.dispatchEvent(new Event('input', { bubbles: true }))
  blur.dispatchEvent(new Event('change', { bubbles: true }))
})
await page.waitForTimeout(1400)
const glassState = await page.evaluate(() => {
  const saved = JSON.parse(localStorage.getItem('md-qp-glass') ?? '{}')
  const p = document.querySelector('.qp-panel')
  const inner = p?.querySelector('.qp-in')
  return {
    blur: saved.blur,
    lg: p?.dataset.lg ?? null,
    frost: p?.dataset.lgFrost ?? null,
    canvas: !!p?.querySelector('canvas'),
    scrim: inner ? getComputedStyle(inner, '::before').backgroundColor : null,
  }
})
check('glass blur persisted = 9', glassState.blur === 9, JSON.stringify(glassState.blur))
check(
  'liquidGL lens is active on the panel',
  glassState.lg === 'gpu' || glassState.lg === 'css',
  String(glassState.lg),
)
check('lens rebuilt with frost 9', glassState.frost === '9', String(glassState.frost))
check(
  'refraction canvas lives inside the panel',
  glassState.lg !== 'gpu' || glassState.canvas === true,
)
check(
  'dark scrim yields to the lens tint while the GPU lens is up',
  glassState.lg !== 'gpu' || glassState.scrim === 'rgba(0, 0, 0, 0)',
  glassState.scrim ?? 'none',
)
/* the segmented Blurred/Solid pair must NOT be in the glass pop any more */
const segInGlass = await page.evaluate(
  () => !!document.querySelector('.qp-pop[aria-label="Glass settings"] .qp-seg'),
)
check('no Blurred/Solid segment in glass pop', !segInGlass)
await page.keyboard.press('Escape')
await page.waitForTimeout(200)

/* ---- 7 — player settings live on the MAIN screen now ---- */
const popInPanel = await page.evaluate(() => ({
  playerPop: !!document.querySelector('.qp-pop-player'),
  gear: !!document.querySelector('.qp-head button[aria-label="Player settings"]'),
}))
check('no player settings pop inside the panel', !popInPanel.playerPop)
check('no player gear in the panel header', !popInPanel.gear)
/* the queue bar: Clear only — shuffle/repeat belong to the transport */
const barButtons = await page.evaluate(() =>
  [...document.querySelectorAll('.qp-bar button')].map((b) => b.textContent.trim()),
)
check(
  'queue bar has no shuffle/repeat pills (Clear only)',
  barButtons.every((t) => t === 'Clear' || t === 'Browse playlists'),
  barButtons.join(' | ') || 'none',
)
/* no ONLINE badges on rows */
const badges = await page.evaluate(() => document.querySelectorAll('.qp-badge').length)
check('no ONLINE badges on rows', badges === 0, `${badges} badges`)
/* the active accent is chrome/silver — amber belonged to the old drawer */
const pinBg = await page.evaluate(() => {
  const pin = document.querySelector('.qp-pin')
  return pin ? getComputedStyle(pin).backgroundColor : null
})
check('pin active colour is silver, not amber', pinBg === 'rgb(232, 236, 241)', pinBg ?? 'no pin')
/* the corner knobs: ONE queue door + the player-settings knob */
const knobs = await page.evaluate(() => ({
  queue: !!document.querySelector('button[aria-label="Open current queue"]'),
  player: !!document.querySelector('button[aria-label="Player settings"]'),
  playlistDoor: !!document.querySelector('button[aria-label="Open my playlists"]'),
}))
check('one queue door on the corner', knobs.queue === true)
check('the separate playlist door is gone', knobs.playlistDoor === false)
check('the player-settings knob is on the main screen', knobs.player === true)
/* open it and check the card carries everything the old pop did */
await page.click('button[aria-label="Player settings"]')
await page.waitForTimeout(300)
const playerCard = await page.evaluate(() => {
  const pop = document.querySelector('[data-player-settings]')
  if (!pop) return null
  const labels = [...pop.querySelectorAll('span')].map((s) => s.textContent).filter(Boolean)
  const secs = [...pop.querySelectorAll('button[aria-pressed]')].map((b) => b.textContent.trim()).filter((t) => /^\d+s$/.test(t))
  const glassBtns = [...pop.querySelectorAll('button')].map((b) => b.textContent.trim()).filter((t) => t === 'BLURRED' || t === 'SOLID · FAST')
  return { labels, secs, glassBtns }
})
check('player settings card opens on the main screen', !!playerCard)
check(
  'card rows: crossfade + normalize + accent + glass',
  !!playerCard &&
    playerCard.labels.includes('CROSSFADE') &&
    playerCard.labels.includes('NORMALIZE VOLUME') &&
    playerCard.labels.includes('ACCENT FROM ART') &&
    playerCard.labels.includes('GLASS PANELS'),
  playerCard ? playerCard.labels.join(',') : 'none',
)
check('crossfade steps 0/3/5/8', !!playerCard && playerCard.secs.join(',') === '0s,3s,5s,8s', playerCard ? playerCard.secs.join(',') : '')
check(
  'Blurred / Solid · fast switches in the card',
  !!playerCard && playerCard.glassBtns.join('|') === 'BLURRED|SOLID · FAST',
  playerCard ? playerCard.glassBtns.join('|') : '',
)
/* Blurred ↔ Solid: solid must DROP the lens so its opaque pane owns the
   background; blurred must bring the canvas back */
await page.click('button:text-is("SOLID · FAST")')
await page.waitForTimeout(450)
const solidState = await page.evaluate(() => {
  const p = document.querySelector('.qp-panel')
  return {
    lg: p?.dataset.lg ?? null,
    canvas: !!p?.querySelector('canvas'),
    bg: p ? getComputedStyle(p).backgroundColor : null,
  }
})
check(
  'solid mode drops the lens (no canvas, no dataset)',
  solidState.lg == null && solidState.canvas === false,
  `lg=${solidState.lg} canvas=${solidState.canvas}`,
)
check(
  'solid mode shows its opaque pane',
  solidState.bg === 'rgba(16, 16, 21, 0.93)',
  solidState.bg ?? 'none',
)
await page.click('button:text-is("BLURRED")')
await page.waitForTimeout(1600)
const blurBack = await page.evaluate(() => {
  const p = document.querySelector('.qp-panel')
  return { lg: p?.dataset.lg ?? null, canvas: !!p?.querySelector('canvas') }
})
check(
  'blurred mode brings the lens back',
  (blurBack.lg === 'gpu' || blurBack.lg === 'css') &&
    (blurBack.lg !== 'gpu' || blurBack.canvas === true),
  `lg=${blurBack.lg} canvas=${blurBack.canvas}`,
)
await page.keyboard.press('Escape')
await page.waitForTimeout(250)
const cardGone = await page.evaluate(() => !document.querySelector('[data-player-settings]'))
check('Escape closes the card', cardGone)
await page.screenshot({ path: 'queuefix-panel.png', clip: { x: 0, y: 0, width: 460, height: 860 } })

/* ---- 8+9 — auto-hide ---- */
const pc = await panelVisible()
const cx = pc.x + pc.w / 2
const cy = pc.y + pc.h / 2
/* unpin */
await page.click('.qp-pin')
await page.waitForTimeout(200)
/* hover INSIDE the panel, wiggle, give the old bug's timer plenty of time */
await page.mouse.move(cx, cy)
for (let i = 0; i < 6; i++) {
  await page.mouse.move(cx + (i % 2 ? 30 : -30), cy + (i % 3 ? 20 : -20))
  await page.waitForTimeout(90)
}
await page.waitForTimeout(900)
let away = await page.evaluate(() =>
  document.querySelector('.qp-panel')?.className.includes('qp-away'),
)
check('unpinned + cursor INSIDE: panel never closes', away === false, `away=${away}`)
/* move OUT of the panel (inward across the screen, past the 28px arm line) */
await page.mouse.move(cx + pc.w / 2 + 240, cy, { steps: 8 })
await page.waitForTimeout(1000)
away = await page.evaluate(() =>
  document.querySelector('.qp-panel')?.className.includes('qp-away'),
)
check('unpinned + cursor LEFT: panel hides', away === true, `away=${away}`)
/* return via the dock edge: travel inward first (arm), then hop to the
   edge in separate moves — one coalesced stepped move can land in a single
   rAF sample and make the crossing ambiguous */
await page.mouse.move(300, cy, { steps: 6 })
await page.waitForTimeout(150)
await page.mouse.move(60, cy)
await page.waitForTimeout(140)
await page.mouse.move(5, cy)
await page.waitForTimeout(700)
const back = await panelVisible()
check(
  'panel returns from the dock edge',
  !!back && back.x >= 0 && back.x < 120 && !back.cls.includes('qp-away'),
  back ? `x=${Math.round(back.x)}` : '',
)
/* re-pin for the rest of the run */
await page.click('.qp-pin')
await page.waitForTimeout(200)

/* ---- 10 — global edit mode ---- */
await page.click('button[aria-label="Customize layout"]')
await page.waitForTimeout(400)
await page.click('button:has-text("EDIT LAYOUT")')
await page.waitForTimeout(700)
const edit = await page.evaluate(() => {
  const framed = document.querySelector('.qp-panel.qp-framed')
  if (!framed) return { framed: false }
  /* walk up to the LayoutFrame root (fixed, z-[60]) */
  let root = framed.parentElement
  while (root && !String(root.className).includes('z-[60]')) root = root.parentElement
  const hasDash = root
    ? !!root.querySelector(':scope > div.border-dashed, :scope > .border-dashed') ||
      [...(root.children ?? [])].some((c) => String(c.className).includes('border-dashed'))
    : false
  const se = root ? root.querySelector('[aria-label="Resize bottom-right"]') : null
  /* the ghost: any LayoutFrame still hosting the old tracklist (its stable
     root class is .tracklist-glass) — the queue panel's own hidden file
     input must not count */
  const frames = [...document.querySelectorAll('div.fixed')].filter((d) =>
    String(d.className).includes('z-[60]'),
  )
  const ghosts = frames.filter((f) => f.querySelector('.tracklist-glass')).length
  return { framed: true, hasDash, hasSE: !!se, frames: frames.length, ghosts, seBox: se ? se.getBoundingClientRect() : null }
})
check('queue panel hosted by LayoutFrame in edit mode', edit.framed === true)
check('dotted bounding box present', edit.hasDash === true)
check('corner handles present (SE)', edit.hasSE === true)
check('old tracklist ghost frame is gone', edit.ghosts === 0, `frames=${edit.frames} ghosts=${edit.ghosts}`)
const custLabels = await page.evaluate(() =>
  [...document.querySelectorAll('.settings-panel span')].map((s) => s.textContent).filter((t) => t === 'QUEUE' || t === 'TRACKLIST'),
)
check('customize hub: QUEUE section, TRACKLIST gone', custLabels.includes('QUEUE') && !custLabels.includes('TRACKLIST'), custLabels.join(','))

/* ---- 11 — corner resize + SAVE LAYOUT ---- */
const se0 = await page.evaluate(() => {
  const framed = document.querySelector('.qp-panel.qp-framed')
  let root = framed.parentElement
  while (root && !String(root.className).includes('z-[60]')) root = root.parentElement
  const r = root.getBoundingClientRect()
  const se = root.querySelector('[aria-label="Resize bottom-right"]').getBoundingClientRect()
  return { frame: { x: r.x, y: r.y, w: r.width, h: r.height }, se: { x: se.x + se.width / 2, y: se.y + se.height / 2 } }
})
await page.mouse.move(se0.se.x, se0.se.y)
await page.mouse.down()
for (let s = 1; s <= 8; s++) {
  await page.mouse.move(se0.se.x + s * 10, se0.se.y + s * 7)
  await page.waitForTimeout(25)
}
await page.mouse.up()
await page.waitForTimeout(400)
const se1 = await page.evaluate(() => {
  const framed = document.querySelector('.qp-panel.qp-framed')
  let root = framed.parentElement
  while (root && !String(root.className).includes('z-[60]')) root = root.parentElement
  const r = root.getBoundingClientRect()
  return { w: r.width, h: r.height }
})
check(
  'corner resize grows the box (2D)',
  se1.w > se0.frame.w + 40 && se1.h > se0.frame.h + 25,
  `w ${Math.round(se0.frame.w)}→${Math.round(se1.w)} h ${Math.round(se0.frame.h)}→${Math.round(se1.h)}`,
)
await page.click('button:has-text("SAVE LAYOUT")')
await page.waitForTimeout(500)
const savedBox = await page.evaluate(() => JSON.parse(localStorage.getItem('md-queue-box') ?? 'null'))
check('SAVE LAYOUT persists md-queue-box', !!savedBox && savedBox.w > 300, JSON.stringify(savedBox))
const stillFramed = await page.evaluate(
  () => !!document.querySelector('.qp-panel.qp-framed'),
)
check('panel stays at the saved rectangle after save', stillFramed === true)
await page.screenshot({ path: 'queuefix-edit.png' })

/* ---- 12 — RESET docks the panel back ----
   The customize hub is STILL OPEN after SAVE LAYOUT — clicking the corner
   button again would close it. Open it only if the reset button is missing. */
const resetVisible = await page.evaluate(
  () => !!document.querySelector('button[aria-label="Reset queue panel layout"]'),
)
if (!resetVisible) {
  await page.click('button[aria-label="Customize layout"]')
  await page.waitForTimeout(400)
}
await page.click('button[aria-label="Reset queue panel layout"]')
await page.waitForTimeout(500)
const afterReset = await panelVisible()
check(
  'RESET docks the panel (no frame)',
  !!afterReset && !afterReset.cls.includes('qp-framed'),
  afterReset ? afterReset.cls.split(' ').filter((c) => c.startsWith('qp-')).join(' ') : '',
)
const boxGone = await page.evaluate(() => localStorage.getItem('md-queue-box'))
check('md-queue-box cleared', boxGone === null)

await page.screenshot({ path: 'queuefix-final.png' })
console.log(`\n[queuefix] ${pass} passed, ${fail} failed`)
await browser.close()
process.exit(fail ? 1 : 0)
