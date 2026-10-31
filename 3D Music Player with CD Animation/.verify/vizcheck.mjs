import { chromium } from 'playwright-core'

const BASE = process.env.BASE ?? 'http://127.0.0.1:5199'
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
})
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)))
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(4500)

const out = {}

/* ---- 1+2 regression — BarGraph renders white bars from spectrum data ---- */
const vizResult = await page.evaluate(async () => {
  const { default: BarGraph } = await import('/src/features/voltviz/impl/BarGraph.tsx')
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#000'
  document.body.appendChild(host)
  const container = document.createElement('div')
  container.style.cssText = 'position:absolute;inset:0'
  host.appendChild(container)

  const viz = BarGraph({ container, width: 1440, height: 900, dpr: 1 })
  const loud = () => {
    const a = new Uint8Array(1024)
    for (let i = 1; i < 40; i++) a[i] = Math.max(40, 255 - i * 6)
    for (let i = 40; i < 1024; i++) a[i] = 60 + ((i * 37) % 80)
    return a
  }
  const silent = () => new Uint8Array(1024)
  const settings = { sensitivity: 1, speed: 1, hueShift: 0, scale: 1 }
  const dt = 1 / 60
  const run = (audio, frames) => {
    for (let i = 0; i < frames; i++) viz.frame({ audio, settings, dt })
  }
  const audioLoud = { spectrum: loud, sampleRate: 48000 }
  const audioSilent = { spectrum: silent, sampleRate: 48000 }

  const canvas = container.querySelector('canvas')
  const ctx = canvas.getContext('2d')
  const px = (x, y) => {
    const d = ctx.getImageData(x, y, 1, 1).data
    return [d[0], d[1], d[2], d[3]]
  }

  const r = {}
  viz.api.setPalette(9) // Full White — crisp assertions
  /* bg OFF (default): silent → opaque dark stage */
  run(audioSilent, 10)
  r.bgOffSilent = px(700, 100)
  /* loud → white bars paint */
  run(audioLoud, 45)
  r.bgOffBar = px(5, 890)
  /* bg ON: silent → the canvas is fully transparent (wallpaper shows) */
  viz.api.setBackground(true)
  run(audioSilent, 5)
  r.bgOnSilent = px(700, 100)
  /* bg ON + loud: bars paint, gaps stay transparent */
  run(audioLoud, 45)
  r.bgOnBar = px(5, 890)
  r.bgOnGap = px(0, 400)
  /* container background follows the setting */
  r.containerBg = getComputedStyle(container).backgroundColor
  /* back off: opaque stage returns */
  viz.api.setBackground(false)
  run(audioSilent, 5)
  r.bgOffAgain = px(700, 100)
  host.remove()
  return r
})
out.bargraph = vizResult

/* ---- 1 — Butterchurn mounts through the real UI (canvas lifecycle) ---- */
await page.locator('button[aria-label="Visualiser options"]').click()
await page.waitForTimeout(400)
await page.locator('button', { hasText: 'BUTTERCHURN' }).first().click()
await page.waitForTimeout(3500)
out.butterchurn = await page.evaluate(() => {
  const host = document.querySelector('.bg-layer')
  const canvas = host?.querySelector('canvas')
  if (!canvas) return { mounted: false }
  const r = canvas.getBoundingClientRect()
  return {
    mounted: true,
    sized: canvas.width > 0 && canvas.height > 0,
    cssSize: `${Math.round(r.width)}x${Math.round(r.height)}`,
  }
})

console.log(JSON.stringify(out, null, 2))
await browser.close()
