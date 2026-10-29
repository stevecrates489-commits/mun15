import { chromium } from 'playwright-core'
const browser = await chromium.launch({ channel: 'msedge', headless: true })
for (const vp of [{width:1035,height:619},{width:1035,height:670},{width:1294,height:806}]) {
  const page = await browser.newPage({ viewport: vp })
  await page.goto('http://127.0.0.1:8765/', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1000)
  const info = await page.evaluate(() => {
    const bar = document.querySelector('.pbar')
    const r = bar?.getBoundingClientRect()
    return {
      vw: innerWidth, vh: innerHeight,
      bar: r ? { top: Math.round(r.top), h: Math.round(r.height), d: getComputedStyle(bar).display, v: getComputedStyle(bar).visibility } : null,
      classes: bar?.className ?? 'none',
      zoom: getComputedStyle(document.documentElement).zoom,
    }
  })
  console.log(JSON.stringify(vp), JSON.stringify(info))
  await page.screenshot({ path: `size-${vp.width}x${vp.height}.png` })
  await page.close()
}
await browser.close()
