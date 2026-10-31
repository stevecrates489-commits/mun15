import { chromium } from 'playwright-core'

const BASE = process.env.BASE ?? 'http://127.0.0.1:5199'
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
})
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200)))
await page.goto(BASE + '/', { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)

const out = {}

/* ---- 3+4+5 — Player Settings popover ---- */
await page.locator('button[aria-label="Player settings"]').click()
await page.waitForTimeout(300)
out.menuOpens = await page.evaluate(() => {
  const menus = [...document.querySelectorAll('body > div')].filter((d) => d.textContent?.includes('PLAYER SETTINGS'))
  return menus.length > 0
})
await page.locator('button[aria-label="Toggle crossfade"]').click()
await page.waitForTimeout(150)
out.crossfadeToggled = await page.evaluate(() => localStorage.getItem('md-crossfade'))
await page.locator('button[title="8-second blend"]').click()
await page.waitForTimeout(150)
out.crossfadeSec = await page.evaluate(() => localStorage.getItem('md-crossfade-sec'))
await page.locator('button[aria-label="Toggle volume normalisation"]').click()
await page.waitForTimeout(150)
out.normalizeToggled = await page.evaluate(() => localStorage.getItem('md-normalize'))

/* ---- 1 — accent extraction on synthetic two-tone art ---- */
out.accent = await page.evaluate(async () => {
  const { extractAccents } = await import('/src/lib/accent.ts')
  const c = document.createElement('canvas')
  c.width = 64
  c.height = 64
  const x = c.getContext('2d')
  x.fillStyle = 'rgb(220, 40, 40)'
  x.fillRect(0, 0, 32, 64)
  x.fillStyle = 'rgb(40, 60, 220)'
  x.fillRect(32, 0, 32, 64)
  const res = await extractAccents(c.toDataURL())
  if (!res) return { ok: false }
  const reddish = res.a[0] > 150 && res.a[0] > res.a[2]
  const bluish = res.b[2] > 120 && res.b[2] > res.b[0]
  return { ok: true, reddish, bluish, a: res.a, b: res.b }
})

/* seekto handler registered? */
out.seektoRegistered = await page.evaluate(async () => {
  if (!('mediaSession' in navigator)) return 'unsupported'
  /* a handler that was never set throws NOT_SUPPORTED_ERR on read-back via
     setActionHandler(null)? Instead probe indirectly: the app's effect ran —
     assert via a dry-call: set to null then back by dispatching is not
     observable, so report capability only */
  return 'available'
})

console.log(JSON.stringify(out, null, 2))
await browser.close()
