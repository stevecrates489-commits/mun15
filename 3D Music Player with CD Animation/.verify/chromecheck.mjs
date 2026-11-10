import { chromium } from 'playwright-core'

/* chromecheck — the "move every button and panel" editor.
   1. an idle surface has NO translate (so it creates no containing block)
   2. dragging a button commits a rounded offset and applies it
   3. dragging a panel and releasing over the page does not eat the NEXT click
   4. a drag cannot park a surface beyond reach
   5. offsets survive a reload
   6. RESET SCREEN clears them and the translate goes away
*/

const BASE = process.env.BASE ?? 'http://127.0.0.1:5210'
const browser = await chromium.launch({ channel: 'msedge', headless: true })
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
const errors = []
const suspicious = []
page.on('pageerror', (e) => {
  errors.push(String(e))
  console.log('[pageerror]', String(e).slice(0, 300))
})
page.on('console', (m) => {
  if (m.type() !== 'error' && m.type() !== 'warning') return
  const t = m.text()
  if (/Maximum update depth|Cannot update a component|Warning:|act\(/.test(t)) suspicious.push(t.slice(0, 200))
})

let pass = 0
let fail = 0
const check = (name, ok, detail = '') => {
  if (ok) {
    pass++
    console.log(`  ok   ${name}`)
  } else {
    fail++
    console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`)
  }
}
const raf2 = () =>
  page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))
const rectOf = async (sel) => {
  const b = await page.locator(sel).first().boundingBox()
  if (!b) throw new Error('no box for ' + sel)
  return { left: b.x, top: b.y, width: b.width, height: b.height, cx: b.x + b.width / 2, cy: b.y + b.height / 2 }
}
const translateOf = (sel) =>
  page.evaluate((s) => {
    const el = document.querySelector(s)
    if (!el) return 'missing'
    return getComputedStyle(el).translate
  }, sel)
const stored = () =>
  page.evaluate(() => {
    try {
      return JSON.parse(localStorage.getItem('md-chrome-offsets') ?? 'null')
    } catch {
      return 'bad json'
    }
  })
const drag = async (fromX, fromY, toX, toY) => {
  await page.mouse.move(Math.round(fromX), Math.round(fromY))
  await page.mouse.down()
  await page.mouse.move(Math.round(toX), Math.round(toY), { steps: 10 })
  await page.mouse.up()
  await raf2()
}

await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 60000 })
await page.waitForTimeout(4000)
/* start from a clean arrangement (addInitScript would wipe it on every
   navigation, including the reload that tests persistence) */
await page.evaluate(() => localStorage.removeItem('md-chrome-offsets'))
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(6000)

console.log('\n[1] idle surfaces carry no translate')
check('header idle translate is none', (await translateOf('header')) === 'none', await translateOf('header'))

console.log('\n[2] move mode + button drag')
await page.locator('button[aria-label="Customize layout"]').click()
await page.getByRole('button', { name: /MOVE BUTTONS & PANELS/ }).click()
await page.waitForTimeout(120)
const editClassed = await page.evaluate(() =>
  [...document.querySelectorAll('header, footer, button[aria-label="Extensions"]')].every((el) =>
    el.className.includes('cursor-move'),
  ),
)
check('header, footer and buttons enter arrange mode', editClassed)

const header = await rectOf('header')
await drag(header.cx, header.cy, header.cx + 40, header.cy + 24)
let saved = await stored()
check('header offset committed', saved?.header?.dx === 40 && saved?.header?.dy === 24, JSON.stringify(saved?.header))
check('header translate applied', (await translateOf('header')) === '40px 24px', await translateOf('header'))

console.log('\n[3] drag a panel, release off it, then click')
const panel = await rectOf('div.fixed.z-\\[88\\]')
await drag(panel.left + 40, panel.top + 18, panel.left + 40 + 320, panel.top + 18 + 240)
saved = await stored()
const panelOffset = saved?.['panel-customize']
check(
  'panel offset committed',
  !!panelOffset && (panelOffset.dx !== 0 || panelOffset.dy !== 0),
  JSON.stringify(panelOffset),
)

await page.locator('button[aria-label="Extensions"]').click()
await page.waitForTimeout(250)
const extOpen = await page.getByText('EXTENSIONS', { exact: true }).first().isVisible().catch(() => false)
check('click after off-panel drag still opens Extensions', extOpen)
await page.locator('button[aria-label="Close extensions panel"]').click().catch(() => {})
await page.waitForTimeout(250)

console.log('\n[4] a drag cannot strand a surface off-screen')
const ext = await rectOf('button[aria-label="Extensions"]')
await drag(ext.cx, ext.cy, 2400, 1400)
const vw = 1440
const vh = 900
const after = await page.evaluate(() => {
  const r = document.querySelector('button[aria-label="Extensions"]').getBoundingClientRect()
  return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }
})
saved = await stored()
check('extensions offset committed', !!saved?.['btn-extensions'], JSON.stringify(saved?.['btn-extensions']))
check(
  'clamped inside the viewport',
  after.right > 0 && after.left < vw && after.bottom > 0 && after.top < vh,
  JSON.stringify(after),
)

console.log('\n[5] offsets survive a reload')
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(6000)
check('header offset restored', (await translateOf('header')) === '40px 24px', await translateOf('header'))
const restored = await translateOf('button[aria-label="Extensions"]')
check('extensions offset restored', restored !== 'none' && restored !== 'missing', restored)
const settledA = JSON.stringify(await stored())
await page.waitForTimeout(900)
const settledB = JSON.stringify(await stored())
check('re-clamp settles instead of rewriting forever', settledA === settledB, `${settledA} vs ${settledB}`)

console.log('\n[6] RESET SCREEN')
await page.locator('button[aria-label="Customize layout"]').click()
await page.waitForTimeout(150)
await page.locator('button[aria-label="Reset screen layout"]').click()
await raf2()
check('storage cleared', (await stored()) === null, JSON.stringify(await stored()))
check('header back to no translate', (await translateOf('header')) === 'none', await translateOf('header'))
const extAfter = await translateOf('button[aria-label="Extensions"]')
check('extensions back to no translate', extAfter === 'none' || extAfter === '', extAfter)

console.log('\n[7] page errors')
check('no uncaught page errors', errors.length === 0, errors.join(' | ').slice(0, 300))
check('no React render-loop / act warnings', suspicious.length === 0, suspicious.join(' | ').slice(0, 300))

console.log(`\n${fail === 0 ? 'PASS' : 'FAIL'} — ${pass} passed, ${fail} failed`)
await browser.close()
process.exit(fail === 0 ? 0 : 1)
