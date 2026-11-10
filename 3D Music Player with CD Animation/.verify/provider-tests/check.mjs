/* Does the provider test page work?
 *
 * Opens the index straight from the file system, presses TEST on every
 * provider, and says what each one answered. This is the page the user
 * opens, so it had better work.
 *
 * Run: node .verify/provider-tests/check.mjs */
import { chromium } from 'playwright-core'
import { dirname, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PAGE = pathToFileURL(resolve(HERE, 'index.html')).href

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
await page.goto(PAGE, { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(300)

const cards = await page.$$('#grid .card')
console.log(`\n${cards.length} provider cards\n`)

for (const card of cards) {
  const id = await card.getAttribute('data-id')
  await card.$eval('.go', (b) => b.click())
}

/* the gateway is slow; give the slowest one its time */
for (let i = 0; i < 40; i++) {
  await page.waitForTimeout(1000)
  const pending = await page.$$eval('#grid .card', (list) =>
    list.filter((c) => c.querySelector('.out').textContent.trim() === 'asking…').length,
  )
  if (!pending) break
}

const results = await page.$$eval('#grid .card', (list) =>
  list.map((c) => ({
    id: c.getAttribute('data-id'),
    state: c.classList.contains('hit')
      ? 'HIT'
      : c.classList.contains('blocked')
        ? 'BLOCKED'
        : c.classList.contains('miss')
          ? 'MISS'
          : '?',
    head: (c.querySelector('.out .head') || c.querySelector('.out')).textContent.trim().slice(0, 90),
    note: (c.querySelector('.out .note') || { textContent: '' }).textContent.trim().slice(0, 80),
  })),
)

for (const r of results) {
  console.log(`  ${r.state.padEnd(8)} ${r.id.padEnd(18)} ${r.head}`)
  if (r.note) console.log(`  ${' '.repeat(10)} → ${r.note}`)
}

await page.screenshot({ path: resolve(HERE, '..', 'shots', 'provider-tests.png'), fullPage: true })
console.log('\nthe page was photographed\n')

await browser.close()
