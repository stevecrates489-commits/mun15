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
await page.waitForTimeout(1000)
await page.screenshot({ path: '.verify/before.jpg', type: 'jpeg', quality: 70 })
await page.evaluate(() => {
  const el = document.querySelector('.qp-panel')
  el.style.backdropFilter = 'none'
  el.style.webkitBackdropFilter = 'none'
  el.classList.add('lg-fallback')
})
await page.waitForTimeout(300)
await page.screenshot({ path: '.verify/after.jpg', type: 'jpeg', quality: 70 })
await page.locator('.qp-panel').screenshot({ path: '.verify/after-panel.jpg', type: 'jpeg', quality: 80 })
await browser.close()
