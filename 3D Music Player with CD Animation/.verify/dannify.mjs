import { chromium } from 'playwright-core'

const log = (...a) => console.log(...a)

const browser = await chromium.launch({
  channel: 'msedge',
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required'],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
page.on('console', (m) => log('[console]', m.type(), m.text().slice(0, 300)))
page.on('pageerror', (e) => log('[pageerror]', String(e).slice(0, 400)))
page.on('requestfailed', (r) => log('[failed]', r.url().slice(0, 150), r.failure()?.errorText))

await page.goto('http://127.0.0.1:8765/', { waitUntil: 'networkidle' })
await page.waitForTimeout(1500)

const buttons = await page.getByRole('button').allInnerTexts()
log('buttons:', JSON.stringify(buttons.slice(0, 12)))

// sidebar Search
await page.getByText('Search', { exact: true }).first().click()
await page.waitForTimeout(800)
const input = page.locator('input').first()
await input.fill('arijit singh')
await input.press('Enter')
await page.waitForTimeout(5000)

const facetCount = await page.getByRole('button', { name: /^Songs/ }).first().innerText().catch(() => 'none')
log('facet:', facetCount)

// click the first song row
const row = page.locator('[role="option"], [data-song-id]').first()
log('rows found:', await page.locator('[role="option"], [data-song-id]').count())
await row.click().catch((e) => log('row click failed', String(e).slice(0, 200)))
await page.waitForTimeout(6000)

const audio = await page.evaluate(() =>
  [...document.querySelectorAll('audio')].map((a) => ({
    src: (a.currentSrc || a.src || '').slice(0, 120),
    paused: a.paused,
    time: Math.round(a.currentTime * 10) / 10,
    ready: a.readyState,
    err: a.error ? a.error.code : null,
  })),
)
log('audio:', JSON.stringify(audio))

const bars = await page.evaluate(() => {
  const el = [...document.querySelectorAll('*')].find((n) =>
    /player|now playing/i.test(n.className?.toString?.() || ''),
  )
  return el ? el.className.toString().slice(0, 120) : 'no player element'
})
log('player element:', bars)

await page.screenshot({ path: 'browser-search.png' })
await browser.close()
