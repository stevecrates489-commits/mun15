import { chromium } from 'playwright-core'

/* soniccheck — the two Sonic Topography ports mount, draw, expose their
   settings card and dispose cleanly when another style is picked.
   Needs no audio: the frame loop and the module loader both run regardless. */

const BASE = process.env.BASE ?? 'http://127.0.0.1:5210'
const browser = await chromium.launch({
  channel: 'msedge',
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
})
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const logs = []
page.on('console', (m) => {
  const t = m.text()
  /* the duplicate-three warning is pre-existing: every three186 style (all the
     VoltViz WebGL ones included) triggers it beside the app's own three 0.128 */
  if (/Multiple instances of Three\.js/.test(t)) return
  /* the dannify bridge (127.0.0.1:8765) retries forever in headless without
     the Python server — environment noise, present with every style */
  if (/8765/.test(t)) return
  if (m.type() === 'error' || m.type() === 'warning' || /voltviz|sonic|visual/i.test(t)) {
    logs.push(`[${m.type()}] ${t.slice(0, 300)}`)
  }
})
page.on('pageerror', (e) => logs.push(`[pageerror] ${String(e).slice(0, 300)}`))
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
await page.waitForTimeout(4000)
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

/* open the visualiser panel */
await page.click('button[aria-label="Visualiser options"]', { timeout: 8000 })
await page.waitForTimeout(600)

const buttons = await page.evaluate(() => {
  const panel = document.querySelector('.settings-panel')
  if (!panel) return null
  return [...panel.querySelectorAll('button[title]')]
    .map((b) => b.title)
    .filter((t) => t.toLowerCase().includes('sonic'))
})
if (!buttons || buttons.length !== 2) {
  console.log(`[soniccheck] FAIL — expected 2 Sonic buttons in the picker, got: ${JSON.stringify(buttons)}`)
  process.exit(1)
}
console.log(`[soniccheck] ok   picker has both entries: ${buttons.join(' | ')}`)

let pass = 0
let fail = 0
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`) }
  else { fail++; console.log(`  FAIL ${name} ${extra}`) }
}

async function layerState() {
  return page.evaluate(() => {
    const host = document.querySelector('div.bg-layer[aria-hidden="true"]')
    if (!host) return { host: false }
    const layers = [...host.children].map((c) => ({
      op: c.style.opacity || '?',
      canvas: !!c.querySelector('canvas'),
      text: (c.textContent || '').replace(/\s+/g, ' ').slice(0, 110),
    }))
    return { host: true, layers }
  })
}

for (const name of buttons) {
  const before = logs.length
  await page.click(`.settings-panel button[title="${name}"]`, { timeout: 5000 })
  await page.waitForTimeout(1800)
  const st = await layerState()
  const live = st.layers?.find((l) => l.canvas)
  ok(`${name}: canvas mounted`, !!live, JSON.stringify(st))
  ok(`${name}: first frame drawn (fade-in started)`, live?.op === '1', `opacity=${live?.op}`)
  ok(`${name}: no error text`, !live?.text, live?.text ?? '')
  const fresh = logs.slice(before)
  ok(`${name}: no console errors`, fresh.length === 0, fresh.join(' || '))

  /* the settings card: the overlay's gear toggle lives in the panel */
  const card = await page.evaluate(() => {
    const panel = document.querySelector('.settings-panel')
    const gear = [...(panel?.querySelectorAll('button[aria-expanded]') ?? [])].at(-1)
    if (!gear) return { gear: false }
    gear.click()
    return { gear: true }
  })
  await page.waitForTimeout(400)
  const cardOpen = await page.evaluate(() => {
    const panel = document.querySelector('.settings-panel')
    const credit = panel?.textContent ?? ''
    return {
      theme: !!panel?.querySelector('select[aria-label="Theme"]'),
      credit: /GPL-3\.0/i.test(credit) && /CmzYa/i.test(credit),
    }
  })
  ok(`${name}: settings card opens with theme select`, card.gear && cardOpen.theme, JSON.stringify({ card, cardOpen }))
  ok(`${name}: attribution visible`, cardOpen.credit, JSON.stringify(cardOpen))

  /* close the card again — open, it covers the picker buttons below */
  if (card.gear) {
    await page.evaluate(() => {
      const panel = document.querySelector('.settings-panel')
      const gear = [...(panel?.querySelectorAll('button[aria-expanded="true"]') ?? [])].at(-1)
      gear?.click()
    })
    await page.waitForTimeout(300)
  }

  /* settings persist: flip RIPPLES off (original) / AUDIO RESPONSE (extended),
     then reload the record from localStorage */
  const stored = await page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.includes('sonic'))
    return key ? { key, value: JSON.parse(localStorage.getItem(key)) } : null
  })
  ok(`${name}: persisted settings record`, !!stored, JSON.stringify(stored))
}

/* switching away disposes: pick Bar Graph, wait past the fade, the sonic
   canvas must be gone from the DOM */
const before = logs.length
await page.click('.settings-panel button[title="Bar Graph"]', { timeout: 5000 })
await page.waitForTimeout(1800)
const after = await layerState()
const sonicLeftover = after.layers?.filter((l) => l.canvas).length ?? 0
ok('switch away: only the new canvas remains', sonicLeftover <= 1, JSON.stringify(after))
ok('switch away: no disposal errors', logs.slice(before).length === 0, logs.slice(before).join(' || '))

console.log(`[soniccheck] ${pass} passed, ${fail} failed`)
if (logs.length) console.log(`[soniccheck] --- all captured logs ---\n${logs.join('\n')}`)
console.log('[soniccheck] done')
process.exit(fail ? 1 : 0)
