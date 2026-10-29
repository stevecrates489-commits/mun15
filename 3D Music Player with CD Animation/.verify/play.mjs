import { chromium } from 'playwright-core'

const log = (...a) => console.log(...a)
const browser = await chromium.launch({
  channel: 'msedge',
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required'],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') log('[console]', m.type(), m.text().slice(0, 240))
})
page.on('pageerror', (e) => log('[pageerror]', String(e).slice(0, 300)))

await page.goto('http://127.0.0.1:8765/', { waitUntil: 'networkidle' })
await page.waitForTimeout(1000)
await page.getByText('Search', { exact: true }).first().click()
await page.waitForTimeout(600)
const input = page.locator('input').first()
await input.fill('arijit singh')
await input.press('Enter')
await page.waitForTimeout(4500)

const row = page.locator('.tt-row').first()
await row.hover()
await page.waitForTimeout(300)
await row.locator('button[aria-label="Play"]').click()
log('clicked play')

for (let i = 0; i < 6; i += 1) {
  await page.waitForTimeout(2000)
  const state = await page.evaluate(() => {
    const a = document.querySelector('audio')
    const bar = document.querySelector('.pbar')
    return {
      audio: a
        ? { paused: a.paused, t: Math.round(a.currentTime * 10) / 10, ready: a.readyState, err: a.error?.code ?? null }
        : null,
      barClass: bar ? bar.className : 'none',
      barText: bar ? (bar.textContent || '').replace(/\s+/g, ' ').slice(0, 120) : '',
    }
  })
  log('t+' + (i + 1) * 2 + 's', JSON.stringify(state))
}

await page.screenshot({ path: 'browser-playing.png' })
await browser.close()
