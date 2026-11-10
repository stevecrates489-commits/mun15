import { chromium } from 'playwright-core'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/* lyricsshoot — a picture of the real lyric settings panel, with the provider
   list open. The app is started with the lyrics turned on, the gear is
   pressed, and the panel is photographed as it stands.

   Run: node .verify/lyricsshoot.mjs */
const BASE = process.env.BASE ?? 'http://127.0.0.1:5210'
const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(HERE, 'shots')

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })

await page.addInitScript(() => {
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
    transformCallback: (cb) => cb,
    invoke: () => Promise.resolve(null),
    plugins: {},
    resources: {},
  }
  /* the lyrics are off by default — the gear that opens this panel only
     exists when they are on */
  localStorage.setItem('md-lyrics', '1')
})

await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForTimeout(5000)

const gear = await page.$('button[aria-label="Lyrics settings"]')
if (!gear) {
  console.log('the gear was not there')
  await browser.close()
  process.exitCode = 1
}
await gear.click()

/* the panel opens with an animation — wait for it to be actually painted */
await page
  .waitForFunction(
    () => {
      const p = [...document.querySelectorAll('.settings-panel')].find((el) =>
        (el.textContent ?? '').includes('PROVIDERS'),
      )
      return !!p && getComputedStyle(p).opacity === '1'
    },
    { timeout: 10000 },
  )
  .catch(() => console.log('the panel never finished opening'))
await page.waitForTimeout(400)

await page.screenshot({ path: resolve(OUT, 'lyrics-app.png') })
console.log('the app was photographed')

/* the panel that matters is the one with the provider list in it — several
   panels share the class, so it is picked by what it says */
const panel = page.locator('.settings-panel').filter({ hasText: 'PROVIDERS' }).last()
if (await panel.count()) {
  await panel.screenshot({ path: resolve(OUT, 'lyrics-settings.png') })
  console.log('the panel was photographed')
} else {
  console.log('the panel was not found')
}

await browser.close()
