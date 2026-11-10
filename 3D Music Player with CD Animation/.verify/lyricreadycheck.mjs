/* Is the "the lyrics are here" sign actually GREEN, and does it go away when
 * the track changes? A photo can look green-ish; this reads the paint and
 * then changes the song under the panel and looks again.
 *
 * Run: node .verify/lyricreadycheck.mjs
 */
import { chromium } from 'playwright-core'
import { pathToFileURL } from 'node:url'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const BASE = process.env.BASE ?? 'http://127.0.0.1:5210'
const HERE = dirname(fileURLToPath(import.meta.url))
const MOUNT_URL =
  '/@fs' + pathToFileURL(resolve(HERE, 'mount.tsx')).pathname.replace(/^\/([A-Za-z]:)/, '/$1')

let pass = 0
let fail = 0
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ok   ${name}${detail ? ` — ${detail}` : ''}`) }
  else { fail++; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`) }
}

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

await page.exposeFunction('__lyricsFetch', async (url, referer) => {
  try {
    const res = await page.request.get(url, {
      headers: referer ? { Referer: referer } : {},
      timeout: 20000,
    })
    return { status: res.status(), body: await res.text() }
  } catch (e) {
    return { status: 0, body: '', error: String(e).slice(0, 120) }
  }
})

await page.addInitScript(() => {
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
    transformCallback: (cb) => cb,
    invoke: (cmd, args) => {
      if (cmd === 'lyrics_http_get') return window.__lyricsFetch(args.url, args.referer)
      return Promise.resolve(null)
    },
    plugins: {},
    resources: {},
  }
})

await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForTimeout(4000)

await page.evaluate(async (url) => {
  await import(url)
  await window.__mountLyrics({ id: 'shot' })
}, MOUNT_URL)

const read = () =>
  page.evaluate(() => {
    const dot = document.querySelector('#harness-lyrics-host-shot [data-lyrics-ready]')
    if (!dot) return { present: false }
    const cs = getComputedStyle(dot)
    return { present: true, background: cs.backgroundColor, size: `${cs.width}x${cs.height}` }
  })

await page
  .waitForFunction(
    () => !!document.querySelector('#harness-lyrics-host-shot [data-lyrics-ready]'),
    { timeout: 25000 },
  )
  .catch(() => console.log('  (no provider answered in time)'))

console.log('\n[1] the sign is there and it is green')
const withLyrics = await read()
check('the sign is on the panel', withLyrics.present === true)
check('the sign is green', withLyrics.background === 'rgb(52, 211, 153)', withLyrics.background)
check('the sign is a small dot', withLyrics.size === '4pxx4px', withLyrics.size)

console.log('\n[2] the sign goes when the track changes')
await page.evaluate(() => {
  window.__lyricsMounts?.shot?.setTrack?.({
    title: 'Another Song',
    artist: 'Someone Else',
    duration: 200,
  })
})
await page.waitForTimeout(1200)
const afterChange = await read()
check('the sign is gone with the old song', afterChange.present === false, JSON.stringify(afterChange))

await browser.close()
console.log(`\n${pass} passed, ${fail} failed`)
if (fail) process.exitCode = 1
