import { chromium } from 'playwright'

const browser = await chromium.launch({ channel: 'msedge' })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)))
await page.addInitScript(() => {
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
    transformCallback: () => 1,
    unregisterCallback: () => {},
    convertFileSrc: (p) => p,
    invoke: async (cmd) => {
      if (cmd === 'plugin:window|scale_factor') return 1
      if (cmd === 'plugin:window|inner_size') return { width: 1440, height: 900 }
      if (cmd === 'plugin:window|inner_position') return { x: 0, y: 0 }
      if (cmd === 'plugin:window|outer_position') return { x: 0, y: 0 }
      if (cmd === 'plugin:window|is_maximized') return false
      return null
    },
  }
})
await page.goto('http://127.0.0.1:5210/', { waitUntil: 'commit', timeout: 90000 })
await page.waitForSelector('.qp-panel', { timeout: 90000 })
await page.waitForTimeout(1200)
await page.screenshot({ path: '.verify/queue2.jpg', type: 'jpeg', quality: 70 })
await page.getByRole('tab', { name: 'My playlists' }).click()
await page.waitForTimeout(700)
await page.screenshot({ path: '.verify/playlists2.jpg', type: 'jpeg', quality: 70 })
console.log(await page.locator('.qp-panel').innerText())
await browser.close()
