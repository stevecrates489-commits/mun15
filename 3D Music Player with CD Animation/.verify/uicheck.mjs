import { chromium } from 'playwright-core'

const BASE = process.env.BASE ?? 'http://127.0.0.1:5199'
const browser = await chromium.launch({
  channel: 'msedge',
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required'],
})
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
/* the shell calls getCurrentWindow() during render, which needs Tauri's
   internals — a plain browser has none. This shim is TEST-ONLY: the real
   answer is the Tauri window, where nothing here is needed. */
await page.addInitScript(() => {
  const w = window
  w.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
    transformCallback: (cb) => cb,
    invoke: () => Promise.resolve(null),
    plugins: {},
    resources: {},
  }
})
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)))
await page.goto(BASE + '/', { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)

const checks = {}

/* 5 — FrameBars are gone entirely */
checks.frameBars = await page.evaluate(() => ({
  elements: document.querySelectorAll('.frame-bar, .frame-bar-top, .frame-bar-bottom').length,
  barVar: document.documentElement.style.getPropertyValue('--bar') || '',
}))

/* 2 — the visualiser panel opens directly below the header button */
const vizBtn = page.locator('button[aria-label="Visualiser options"]')
await vizBtn.click()
await page.waitForTimeout(500)
checks.visualizerPanel = await page.evaluate(() => {
  const panel = [...document.querySelectorAll('.settings-panel')].find((p) =>
    p.textContent?.includes('VISUALISER'),
  )
  if (!panel) return { found: false }
  const r = panel.getBoundingClientRect()
  return { found: true, top: Math.round(r.top), leftPct: Math.round((r.left / window.innerWidth) * 100) }
})
/* close it again */
await page.locator('button[aria-label="Close visualiser"]').click()
await page.waitForTimeout(400)

/* 7+8 — radio panel: opened by a 450ms HOLD of the radio button */
const radioBtn = page.locator('button[aria-label="Radio (hold)"]')
if ((await radioBtn.count()) > 0) {
  const box = await radioBtn.boundingBox()
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.waitForTimeout(650)
  await page.mouse.up()
  await page.waitForTimeout(500)
  checks.radioPanel = await page.evaluate(() => {
    const panel = [...document.querySelectorAll('.settings-panel')].find((p) =>
      p.textContent?.includes('RADIO'),
    )
    if (!panel) return { found: false }
    const r = panel.getBoundingClientRect()
    return { found: true, top: Math.round(r.top), hasStrip: !!panel.textContent?.match(/NO TITLES|DETECTED|POSITION/) }
  })
  const closeBtn = page.locator('button[aria-label="Close radio"]')
  if ((await closeBtn.count()) > 0) {
    await closeBtn.click()
    /* 8 — mid-exit, the panel must still be mounted (280ms slide) */
    await page.waitForTimeout(120)
    checks.radioExitStillMounted = await page.evaluate(
      () => !![...document.querySelectorAll('.settings-panel')].find((p) => p.textContent?.includes('RADIO')),
    )
    await page.waitForTimeout(500)
    checks.radioExitGone = await page.evaluate(
      () => ![...document.querySelectorAll('.settings-panel')].find((p) => p.textContent?.includes('RADIO')),
    )
  }
} else {
  checks.radioPanel = { found: false, note: 'no radio button matched' }
}

console.log(JSON.stringify(checks, null, 2))
await browser.close()
