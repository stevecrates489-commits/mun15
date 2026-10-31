import { chromium } from 'playwright-core'

const BASE = process.env.BASE ?? 'http://127.0.0.1:5199'
const browser = await chromium.launch({
  channel: 'msedge',
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required'],
})
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 300)))
await page.goto(BASE + '/', { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)

const result = await page.evaluate(async () => {
  const { default: BarGraph } = await import('/src/features/voltviz/impl/BarGraph.tsx')
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#000'
  document.body.appendChild(host)
  const container = document.createElement('div')
  container.style.cssText = 'position:absolute;inset:0'
  host.appendChild(container)

  const viz = BarGraph({ container, width: 1440, height: 900, dpr: 1 })
  /* descending bass ramp (so independence is visible) + a mid shelf */
  const loud = () => {
    const a = new Uint8Array(1024)
    for (let i = 1; i < 40; i++) a[i] = Math.max(40, 255 - i * 6)
    for (let i = 40; i < 1024; i++) a[i] = 60 + ((i * 37) % 80)
    return a
  }
  const audio = { spectrum: loud, sampleRate: 48000 }
  const settings = { sensitivity: 1, speed: 1, hueShift: 0, scale: 1 }
  const dt = 1 / 60
  const run = (frames) => {
    for (let i = 0; i < frames; i++) viz.frame({ audio, settings, dt })
  }

  const canvas = container.querySelector('canvas')
  const ctx = canvas.getContext('2d')
  const px = (x, y) => {
    const d = ctx.getImageData(x, y, 1, 1).data
    return [d[0], d[1], d[2]]
  }
  const white = (p) => p[0] > 230 && p[1] > 230 && p[2] > 230
  const dark = (p) => p[0] < 30 && p[1] < 30 && p[2] < 40

  const out = {}

  /* Greys control: bars paint at all */
  viz.api.setPalette(8)
  run(60)
  out.greysLeft = px(5, 890)

  /* Full White: solid white bars on a dark canvas */
  viz.api.setPalette(9)
  run(60)
  out.whiteLeft = px(5, 890)
  out.whiteGap = px(0, 400) /* x=0 is the inter-bar gap: background */
  out.whiteRoundTrip = (viz.api.setPalette(0), run(10), viz.api.setPalette(9), run(10), px(5, 890))

  /* left-edge flicker: 90 loud frames, first bar's column stays lit */
  let darkFrames = 0
  for (let f = 0; f < 90; f++) {
    run(1)
    if (!white(px(5, 594))) darkFrames++
  }
  out.darkFrames = darkFrames

  /* independence: bar TOPS of the first 10 bars, scanned from the top */
  const tops = []
  const barW = 1440 / 128
  for (let b = 0; b < 10; b++) {
    const x = Math.round(b * barW + barW * 0.7)
    let top = 900
    for (let y = 0; y < 900; y++) {
      if (white(px(x, y))) { top = y; break }
    }
    tops.push(900 - top)
  }
  out.tops = tops
  let paired = 0
  for (let i = 1; i < tops.length; i++) if (tops[i] === tops[i - 1]) paired++
  out.pairedCount = paired

  host.remove()
  return out
})

const w = (p) => p[0] > 230 && p[1] > 230 && p[2] > 230
const d = (p) => p[0] < 30 && p[1] < 30 && p[2] < 40
console.log('greys left bar      ', result.greysLeft, 'painted:', result.greysLeft[0] > 15 ? 'ok' : 'FAIL')
console.log('fullWhite left bar  ', result.whiteLeft, w(result.whiteLeft) ? 'WHITE ok' : 'FAIL')
console.log('fullWhite gap pixel ', result.whiteGap, d(result.whiteGap) ? 'DARK ok' : 'FAIL')
console.log('palette round-trip  ', result.whiteRoundTrip, w(result.whiteRoundTrip) ? 'WHITE ok' : 'FAIL')
console.log('left-edge dark frames', result.darkFrames, result.darkFrames === 0 ? 'ok' : 'FAIL')
console.log('bar tops (first 10)  ', JSON.stringify(result.tops))
console.log('paired neighbours    ', result.pairedCount, result.pairedCount === 0 ? 'INDEPENDENT ok' : 'PAIRED')
await browser.close()
