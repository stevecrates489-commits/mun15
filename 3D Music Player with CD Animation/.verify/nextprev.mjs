import { chromium } from 'playwright-core'

/* nextprev — the Next/Previous + now-playing strip gate:
   A. library mode: transport Previous/Next walk the library and wrap
   B. play-next queue: queued tracks play FIRST, the walk resumes after
   C. folder mode: Next/Prev stay INSIDE the selected folder and wrap —
      they never escape into the rest of the library
   D. the panel's now-playing strip (Previous / Play-Pause / Next) drives
      the same walk, and the strip's own title follows the track
   E. queue order: the row directly under the current row IS the track
      Next plays (the context rotates at the playhead — already-played
      tracks never sit above the upcoming ones)
   F. a long title wears the fade mask and ends before the row icons */

const BASE = process.env.BASE ?? 'http://127.0.0.1:5210'
/* hard ceiling: a hung evaluate must fail loudly, not burn fifteen minutes */
const hardStop = setTimeout(() => {
  console.error('[nextprev] HARD TIMEOUT — killing run after 7 minutes')
  process.exit(2)
}, 420000)
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
  /* md-selected-playlist is deliberately NOT touched here: later phases set
     it right before a reload and the init script would wipe it again */
})
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200)))

let pass = 0
let fail = 0
const check = (name, ok, extra = '') => {
  if (ok) pass++
  else fail++
  console.log(`[nextprev] ${ok ? 'PASS' : 'FAIL'} — ${name}${extra ? ` (${extra})` : ''}`)
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
const dismissBoot = async () => {
  await page.waitForTimeout(3500)
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
}

await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(4000)
/* seed six real files (track 6 carries a deliberately long title) + folders:
   FAVOURITES(-1)[1,2], Road 66(100)[3,4], Triple(101)[1,2,3] */
await page.evaluate(async () => {
  const buf = await (await fetch('/src/assets/track1.mp3')).arrayBuffer()
  /* the write must COMMIT before this promise resolves — reload used to
     race the transaction and boot with an empty library */
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
            title:
              i === 6
                ? 'Aaardvark Track 6 — and then a very long tail of words that must fade away before it reaches the row icons'
                : `Aaardvark Track ${i}`,
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
        /* a throw inside this callback would otherwise never settle the
           promise and hang the whole harness */
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
      { id: 101, name: 'Triple', trackIds: [1, 2, 3] },
    ]),
  )
})
await safeReload()
await dismissBoot()
/* self-diagnosis: a lost seed used to surface as ten mystery failures */
const libCount = await page.evaluate(
  () =>
    new Promise((res) => {
      const rq = indexedDB.open('md-walkman', 3)
      rq.onsuccess = () => {
        const d = rq.result
        try {
          if (!d.objectStoreNames.contains('tracks')) {
            d.close()
            return res(-1)
          }
          const c = d.transaction('tracks', 'readonly').objectStore('tracks').count()
          c.onsuccess = () => {
            res(c.result)
            d.close()
          }
          c.onerror = () => {
            res(-3)
            d.close()
          }
        } catch (e) {
          d.close()
          res(-4)
        }
      }
      rq.onerror = () => res(-2)
    }),
)
check('seeded library holds 6 tracks', libCount === 6, `count=${libCount}`)

const title = () =>
  page.evaluate(() => {
    const s = document.querySelector('h1 span')
    return s ? s.textContent.replace('✦', '').trim() : null
  })
const isPlaying = () =>
  page.evaluate(
    () => !!document.querySelector('button[aria-label="Play / Pause"] svg.lucide-pause'),
  )
const waitTitle = async (pred, ms = 9000) => {
  const t0 = Date.now()
  let last = null
  while (Date.now() - t0 < ms) {
    last = await title()
    if (pred(last)) return last
    await page.waitForTimeout(150)
  }
  return last
}
const waitPlaying = async (want, ms = 7000) => {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    if ((await isPlaying()) === want) return true
    await page.waitForTimeout(150)
  }
  return (await isPlaying()) === want
}
/* click a labelled button, choosing the transport one (outside the panel)
   or the panel one — both exist while the strip is on screen */
const clickBtn = async (label, inPanel = false) => {
  const idx = await page.evaluate(
    ({ l, p }) => {
      const all = [...document.querySelectorAll(`button[aria-label="${l}"]`)]
      return all.findIndex(
        (b) => (p ? !!b.closest('.qp-panel') : !b.closest('.qp-panel')) && b.getClientRects().length > 0,
      )
    },
    { l: label, p: inPanel },
  )
  if (idx < 0) throw new Error(`no visible ${inPanel ? 'panel' : 'transport'} button "${label}"`)
  await page.locator(`button[aria-label="${label}"]`).nth(idx).click()
}
const rowTitles = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('.qp-row[data-qidx] .qp-meta b')].map((b) => b.textContent),
  )
const starts = (prefix) => (t) => !!t && t.startsWith(prefix)

/* ===================== A — library walk ===================== */
let t = await title()
check('boot shows track 1', t === 'Aaardvark Track 1', t ?? 'none')
await clickBtn('Play / Pause')
check('play starts playback', await waitPlaying(true))
await clickBtn('Next')
t = await waitTitle(starts('Aaardvark Track 2'))
check('Next → track 2', starts('Aaardvark Track 2')(t), t ?? 'none')
check('track 2 keeps playing', await waitPlaying(true))
await clickBtn('Next')
t = await waitTitle(starts('Aaardvark Track 3'))
check('Next → track 3', starts('Aaardvark Track 3')(t), t ?? 'none')
await clickBtn('Previous')
t = await waitTitle(starts('Aaardvark Track 2'))
check('Previous → track 2', starts('Aaardvark Track 2')(t), t ?? 'none')
await clickBtn('Previous')
t = await waitTitle(starts('Aaardvark Track 1'))
check('Previous → track 1', starts('Aaardvark Track 1')(t), t ?? 'none')
await clickBtn('Previous')
t = await waitTitle(starts('Aaardvark Track 6'))
check('Previous wraps to track 6', starts('Aaardvark Track 6')(t), t ?? 'none')
await clickBtn('Next')
t = await waitTitle(starts('Aaardvark Track 1'))
check('Next wraps back to track 1', starts('Aaardvark Track 1')(t), t ?? 'none')
check('library walk stayed in sync with playback', await waitPlaying(true))

/* ===================== B — play-next queue ===================== */
/* the panel is open at boot — clicking the door would TOGGLE it shut, so
   only press the knob when it is genuinely not on screen */
const panelShown = () =>
  page.evaluate(() => {
    const p = document.querySelector('.qp-panel')
    if (!p) return false
    const r = p.getBoundingClientRect()
    return (
      !p.className.includes('qp-closed') &&
      !p.className.includes('qp-away') &&
      r.width > 200 &&
      r.x < window.innerWidth - 50 &&
      r.x + r.width > 50
    )
  })
if (!(await panelShown())) {
  await page.click('button[aria-label="Open current queue"]')
  await page.waitForTimeout(500)
}
check('queue panel visible for the queue test', await panelShown())
const addQueue = async (name) => {
  const row = page.locator('.qp-row', { hasText: name }).first()
  await row.hover()
  await page.waitForTimeout(150)
  await row.locator('button[title="Add to queue or playlist"]').click({ force: true })
  await page.waitForTimeout(250)
  await page.click('.qp-menu button:text-is("Add to queue")')
  await page.waitForTimeout(250)
}
await addQueue('Aaardvark Track 5')
await addQueue('Aaardvark Track 6 —')
const queued = await page.evaluate(
  () => document.querySelectorAll('.qp-row[data-qidx]').length,
)
check('queue rows still render after enqueue', queued === 6, `rows=${queued}`)
await clickBtn('Next')
t = await waitTitle(starts('Aaardvark Track 5'))
check('queued track 5 plays first', starts('Aaardvark Track 5')(t), t ?? 'none')
await clickBtn('Next')
t = await waitTitle(starts('Aaardvark Track 6'))
check('queued track 6 plays second', starts('Aaardvark Track 6')(t), t ?? 'none')
await clickBtn('Next')
t = await waitTitle(starts('Aaardvark Track 1'))
check('after the queue drains the walk resumes (wrap → 1)', starts('Aaardvark Track 1')(t), t ?? 'none')
check('queue playback kept running', await waitPlaying(true))

/* F — the long title fades behind the mask instead of reaching the icons */
const row6 = page.locator('.qp-row', { hasText: 'Aaardvark Track 6' }).first()
await row6.hover()
await page.waitForTimeout(350)
const maskInfo = await page.evaluate(() => {
  const row = [...document.querySelectorAll('.qp-row')].find((r) =>
    (r.querySelector('.qp-meta b')?.textContent ?? '').startsWith('Aaardvark Track 6'),
  )
  if (!row) return null
  const meta = row.querySelector('.qp-meta')
  const acts = row.querySelector('.qp-acts')
  const b = meta.querySelector('b')
  const cs = getComputedStyle(meta)
  const mr = meta.getBoundingClientRect()
  const ar = acts.getBoundingClientRect()
  return {
    mask: cs.maskImage || cs.webkitMaskImage || '',
    metaRight: Math.round(mr.right),
    actsLeft: Math.round(ar.left),
    overflow: b.scrollWidth > b.clientWidth + 2,
  }
})
check(
  'long title wears the 108px fade mask on hover',
  !!maskInfo && /108px/.test(maskInfo.mask),
  maskInfo ? maskInfo.mask.slice(0, 70) : 'no row',
)
check(
  'long title actually overflows (truncation engaged)',
  !!maskInfo && maskInfo.overflow,
  maskInfo ? `sw=${maskInfo.overflow}` : '',
)
check(
  'text fades out before it reaches the row icons',
  !!maskInfo && maskInfo.metaRight - 108 <= maskInfo.actsLeft,
  maskInfo ? `fade@${maskInfo.metaRight - 108} ≤ icons ${maskInfo.actsLeft}` : '',
)

/* ===================== C — folder walk ===================== */
await page.evaluate(() => localStorage.setItem('md-selected-playlist', '100'))
await safeReload()
await dismissBoot()
t = await title()
await clickBtn('Play / Pause')
check('folder mode: playback resumes', await waitPlaying(true))
await clickBtn('Next')
t = await waitTitle((x) => x === 'Aaardvark Track 3')
check('folder Next from outside → folder head (3)', t === 'Aaardvark Track 3', t ?? 'none')
await clickBtn('Next')
t = await waitTitle((x) => x === 'Aaardvark Track 4')
check('folder Next → 4', t === 'Aaardvark Track 4', t ?? 'none')
await clickBtn('Next')
t = await waitTitle((x) => x === 'Aaardvark Track 3')
check('folder Next WRAPS to 3 (never escapes to 5)', t === 'Aaardvark Track 3', t ?? 'none')
await clickBtn('Previous')
t = await waitTitle((x) => x === 'Aaardvark Track 4')
check('folder Previous wraps back to 4', t === 'Aaardvark Track 4', t ?? 'none')
check('folder walk stayed in sync with playback', await waitPlaying(true))

/* ===================== D — the now-playing strip ===================== */
if (!(await panelShown())) {
  await page.click('button[aria-label="Open current queue"]')
  await page.waitForTimeout(500)
}
const strip = await page.evaluate(() => {
  const s = document.querySelector('.qp-now')
  if (!s) return null
  return {
    title: s.querySelector('.qp-meta b')?.textContent ?? null,
    artist: s.querySelector('.qp-meta i')?.textContent ?? null,
    labels: [...s.querySelectorAll('button')].map((b) => b.getAttribute('aria-label')),
    w: Math.round(s.getBoundingClientRect().width),
    anim: getComputedStyle(s).animationName,
  }
})
check('now-playing strip is on screen', !!strip, strip ? `w=${strip.w}` : 'missing')
check('strip names the current track', strip?.title === 'Aaardvark Track 4', strip?.title ?? '')
check(
  'strip carries Previous / Pause / Next',
  !!strip && strip.labels.join(',') === 'Previous,Pause,Next',
  strip ? strip.labels.join(',') : '',
)
check(
  'strip eases in (fade, ≤300ms)',
  (await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)) ||
    (!!strip && /qpNowIn/.test(strip.anim)),
  (await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches))
    ? 'reduced-motion: disabled by design'
    : strip?.anim ?? '',
)
await page.click('.qp-now button[aria-label="Next"]')
t = await waitTitle((x) => x === 'Aaardvark Track 3')
check('strip Next advances (4 → 3, folder wrap)', t === 'Aaardvark Track 3', t ?? 'none')
const st1 = await page.evaluate(() => document.querySelector('.qp-now .qp-meta b')?.textContent)
check('strip title follows the track', st1 === 'Aaardvark Track 3', st1 ?? 'none')
await page.click('.qp-now button[aria-label="Previous"]')
t = await waitTitle((x) => x === 'Aaardvark Track 4')
check('strip Previous goes back (3 → 4)', t === 'Aaardvark Track 4', t ?? 'none')
await page.click('.qp-now button[aria-label="Pause"]')
check('strip Pause stops playback', await waitPlaying(false))
const lbl = await page.evaluate(
  () => document.querySelector('.qp-now button.qp-now-play')?.getAttribute('aria-label'),
)
check('strip button flips to Play while paused', lbl === 'Play', lbl ?? 'none')
await page.click('.qp-now button[aria-label="Play"]')
check('strip Play resumes playback', await waitPlaying(true))
await page.screenshot({ path: 'nextprev-strip.png', clip: { x: 980, y: 0, width: 460, height: 860 } })

/* ===================== E — queue order follows the playhead ===================== */
await page.evaluate(() => localStorage.setItem('md-selected-playlist', '101'))
await safeReload()
await dismissBoot()
if (!(await panelShown())) {
  await page.click('button[aria-label="Open current queue"]')
  await page.waitForTimeout(500)
}
await clickBtn('Play / Pause')
check('triple folder: playback resumes', await waitPlaying(true))
await clickBtn('Next')
t = await waitTitle(starts('Aaardvark Track 1'))
check('outside the folder → folder head (1)', starts('Aaardvark Track 1')(t), t ?? 'none')
await clickBtn('Next')
t = await waitTitle(starts('Aaardvark Track 2'))
check('folder Next → 2', starts('Aaardvark Track 2')(t), t ?? 'none')
let rows = await rowTitles()
check(
  'queue lists current first',
  !!rows[0] && rows[0].startsWith('Aaardvark Track 2'),
  rows.join(' | '),
)
check(
  'row under the current row = the track Next plays (3)',
  !!rows[1] && rows[1].startsWith('Aaardvark Track 3'),
  rows.join(' | '),
)
check(
  'already-played track 1 sits AFTER the upcoming track',
  rows.findIndex((r) => r.startsWith('Aaardvark Track 1')) >
    rows.findIndex((r) => r.startsWith('Aaardvark Track 3')),
  rows.join(' | '),
)
await clickBtn('Next')
t = await waitTitle(starts('Aaardvark Track 3'))
check('Next plays exactly the row under the current row', starts('Aaardvark Track 3')(t), t ?? 'none')
rows = await rowTitles()
check(
  'queue rotates with the playhead (3,1,2)',
  !!rows[0]?.startsWith('Aaardvark Track 3') && !!rows[1]?.startsWith('Aaardvark Track 1'),
  rows.join(' | '),
)
await clickBtn('Next')
t = await waitTitle(starts('Aaardvark Track 1'))
check('Next follows the visible order (wrap → 1)', starts('Aaardvark Track 1')(t), t ?? 'none')
await clickBtn('Previous')
t = await waitTitle(starts('Aaardvark Track 3'))
check('Previous follows the visible order (1 → 3)', starts('Aaardvark Track 3')(t), t ?? 'none')
await page.screenshot({ path: 'nextprev-queue.png', clip: { x: 980, y: 0, width: 460, height: 860 } })

console.log(`\n[nextprev] ${pass} passed, ${fail} failed`)
await browser.close()
process.exit(fail ? 1 : 0)
