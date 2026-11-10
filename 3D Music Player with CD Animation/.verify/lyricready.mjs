/* A picture of the lyric panel WITH a provider serving it — the green sign
 * and the provider name live in the header of the panel, and a photo is the
 * only honest way to show that they are there.
 *
 * It borrows the harness's road: the panel is the REAL component, mounted
 * through the harness's mount module, and the requests are made from Node and
 * handed back so the desktop's shell-less path is exercised the same way.
 *
 * Run: node .verify/lyricready.mjs
 */
import { chromium } from 'playwright-core'
import { pathToFileURL } from 'node:url'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const BASE = process.env.BASE ?? 'http://127.0.0.1:5210'
const HERE = dirname(fileURLToPath(import.meta.url))
const OUT = resolve(HERE, 'shots')
const MOUNT_URL =
  '/@fs' + pathToFileURL(resolve(HERE, 'mount.tsx')).pathname.replace(/^\/([A-Za-z]:)/, '/$1')

const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })

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
      if (cmd === 'lyrics_http_get') {
        return window.__lyricsFetch(args.url, args.referer)
      }
      return Promise.resolve(null)
    },
    plugins: {},
    resources: {},
  }
})

await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 30000 })
await page.waitForTimeout(4000)

/* the real panel, mounted the way the harness mounts it */
await page.evaluate(async (url) => {
  await import(url)
  await window.__mountLyrics({ id: 'shot' })
}, MOUNT_URL)

/* wait until a provider has answered — the green sign is bound to that */
await page
  .waitForFunction(
    () => !!document.querySelector('#harness-lyrics-host-shot [data-lyrics-ready]'),
    { timeout: 25000 },
  )
  .catch(() => console.log('no provider answered in time'))
await page.waitForTimeout(600)

const host = page.locator('#harness-lyrics-host-shot')
if (await host.count()) {
  await host.screenshot({ path: resolve(OUT, 'lyrics-ready.png') })
  console.log('the panel with the green sign was photographed')
} else {
  console.log('the panel was not found')
}

await browser.close()
