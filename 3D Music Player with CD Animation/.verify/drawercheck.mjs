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

/* the drawer — opened from the round button top-right */
await page.locator('button[aria-label="Toggle playlists"]').click()
await page.waitForTimeout(600)

/* the gear lives in the drawer's header rail, the section unfolds under it */
await page.locator('button[aria-label="Player settings"]').click()
await page.waitForTimeout(300)
out.section = await page.evaluate(() => {
  const drawer = document.querySelector('.playlist-view')?.parentElement
  const scope = drawer ?? document.body
  return {
    crossfade: (scope.textContent ?? '').includes('CROSSFADE'),
    normalize: (scope.textContent ?? '').includes('NORMALIZE VOLUME'),
  }
})
await page.locator('button[aria-label="Toggle crossfade"]').click()
await page.waitForTimeout(150)
out.crossfade = await page.evaluate(() => localStorage.getItem('md-crossfade'))
await page.locator('button[title="8-second blend"]').click()
await page.waitForTimeout(150)
out.sec = await page.evaluate(() => localStorage.getItem('md-crossfade-sec'))
await page.locator('button[aria-label="Toggle volume normalisation"]').click()
await page.waitForTimeout(150)
out.normalize = await page.evaluate(() => localStorage.getItem('md-normalize'))

/* the main tracklist must be clean of the old gear */
out.panelGearGone = await page.evaluate(() => {
  const bar = document.querySelector('.playlist-row')?.closest('.glass-panel')
  if (!bar) return 'no panel on screen'
  return !bar.querySelector('button[aria-label="Player settings"]')
})

console.log(JSON.stringify(out, null, 2))
await browser.close()
