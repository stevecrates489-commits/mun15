import { chromium } from 'playwright-core'

const browser = await chromium.launch({
  channel: 'msedge',
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required'],
})
for (const vp of [{ width: 1294, height: 806 }, { width: 1280, height: 800 }, { width: 1294, height: 774 }]) {
  const page = await browser.newPage({ viewport: vp })
  await page.goto('http://127.0.0.1:8765/', { waitUntil: 'networkidle' })
  await page.waitForTimeout(1200)
  const info = await page.evaluate(() => {
    const bar = document.querySelector('.pbar')
    const shell = document.querySelector('.shell-player')
    const r = bar?.getBoundingClientRect()
    return {
      vh: window.innerHeight,
      docH: document.documentElement.scrollHeight,
      bar: r ? { top: Math.round(r.top), h: Math.round(r.height), bottom: Math.round(r.bottom) } : null,
      shellH: shell ? Math.round(shell.getBoundingClientRect().height) : null,
      bodyOverflow: getComputedStyle(document.body).overflow,
    }
  })
  console.log(JSON.stringify(vp), JSON.stringify(info))
  await page.close()
}
await browser.close()
