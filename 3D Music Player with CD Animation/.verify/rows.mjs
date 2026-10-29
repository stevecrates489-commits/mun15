import { chromium } from 'playwright-core'

const browser = await chromium.launch({
  channel: 'msedge',
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required'],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
page.on('console', (m) => console.log('[console]', m.type(), m.text().slice(0, 200)))

await page.goto('http://127.0.0.1:8765/', { waitUntil: 'networkidle' })
await page.waitForTimeout(1200)
await page.getByText('Search', { exact: true }).first().click()
await page.waitForTimeout(600)
const input = page.locator('input').first()
await input.fill('arijit singh')
await input.press('Enter')
await page.waitForTimeout(4500)

const html = await page.evaluate(() => {
  const node = [...document.querySelectorAll('*')].find(
    (n) => n.children.length === 0 && /Tainu Khabar/.test(n.textContent || ''),
  )
  if (!node) return 'no node with that text'
  let el = node
  for (let i = 0; i < 5 && el.parentElement; i += 1) el = el.parentElement
  return el.outerHTML.slice(0, 1600)
})
console.log('HTML:', html)

await browser.close()
