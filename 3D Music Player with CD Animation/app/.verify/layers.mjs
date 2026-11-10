import { chromium } from 'playwright'

const browser = await chromium.launch({ channel: 'msedge' })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
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
await page.waitForTimeout(800)
const out = await page.evaluate(() => {
  const x = 100
  const y = 100
  const list = []
  for (const n of document.querySelectorAll('*')) {
    const s = getComputedStyle(n)
    if (s.position === 'static' && s.zIndex === 'auto') continue
    const z = Number.parseInt(s.zIndex, 10)
    if (!Number.isFinite(z) || z < 20) continue
    const r = n.getBoundingClientRect()
    if (r.left <= x && r.right >= x && r.top <= y && r.bottom >= y && z < 200) {
      list.push({
        tag: n.tagName,
        cls: String(n.className).slice(0, 70),
        z,
        pos: s.position,
        pe: s.pointerEvents,
        rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
        transform: s.transform,
      })
    }
  }
  return list.sort((a, b) => a.z - b.z)
})
console.log(JSON.stringify(out, null, 2))
await browser.close()
