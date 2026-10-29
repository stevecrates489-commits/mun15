import { chromium } from 'playwright-core'

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1294, height: 806 } })
await page.setContent(`
  <body style="margin:0;background:#0b0b0d">
    <div style="height:32px;background:#000;color:#fff;font:10px monospace;padding:8px">
      DANNIFY · THE ONLINE EXTENSION
    </div>
    <iframe id="f" src="http://127.0.0.1:8765/" style="display:block;width:100%;height:774px;border:0"></iframe>
  </body>
`)
await page.waitForTimeout(4000)
const frame = page.frames().find((f) => f.url().includes('8765'))
const info = await frame.evaluate(() => {
  const bar = document.querySelector('.pbar')
  const r = bar?.getBoundingClientRect()
  return {
    vh: window.innerHeight,
    bar: r ? { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height) } : null,
  }
})
console.log('frame viewport / bar:', JSON.stringify(info))
await page.screenshot({ path: 'iframe.png' })
await browser.close()
