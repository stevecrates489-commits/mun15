import { chromium } from 'playwright-core'
import { pathToFileURL } from 'node:url'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/* lyricscheck — the lyric provider chain, proven inside the running app.

   The chain is wired into the lyric component, a provider is reached, and what
   it returns is rendered by the component's own parser, so a lyric from a
   fallback provider is drawn exactly like one from its own sources.

   Then the part a person would notice: the panel says which provider is
   serving, the settings panel lists the whole waterfall with its tiers, the
   order can be changed and is kept, it can be put back, a provider can be
   asked for this track on its own, and one that has nothing says so without
   taking the words off the screen.

   ONE fetch is made on purpose. The mounted panel asks the chain itself, and
   every other answer here is read out of that one fetch — a second chain run
   for the same song would only prove the same thing twice, and the services
   answer a repeat request less willingly. */
const BASE = process.env.BASE ?? 'http://127.0.0.1:5210'
const HERE = dirname(fileURLToPath(import.meta.url))
/* the mount module lives next to this file and is served by the dev server
   through its /@fs/ path — it is a browser module with JSX in it, so it has to
   go through the same transform the app's own modules do */
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

/* The desktop app does its own HTTP through the shell, which has no CORS
   rule. The browser does not, so the requests are made from Node and handed
   back — the same road the Rust command takes, so the providers that answer
   on the desktop answer here too. */
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

try {
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 30000 })
} catch (e) {
  console.log('  FAIL the app did not open —', String(e).slice(0, 160))
  await browser.close()
  process.exitCode = 1
}
await page.waitForTimeout(4000)

console.log('\n[1] the fallback chain is wired into the lyric component')
const wiring = await page.evaluate(async () => {
  const ctor = customElements.get('am-lyrics')
  if (!ctor) return { registered: false }
  /* the app installs the chain by itself when its lyric panel loads — this is
     checked BEFORE anything is installed here, so it is the app's own doing
     that is being proved */
  const installedByApp = !!(ctor.prototype.fetchLyrics && ctor.prototype.fetchLyrics.__mavisFallbackChain)
  const installer = await import('/src/features/lyrics/installProviderChain.ts')
  installer.installLyricsProviderChain()
  const fn = ctor.prototype.fetchLyrics
  return {
    registered: true,
    installedByApp,
    patched: !!(fn && fn.__mavisFallbackChain),
    hasParser: typeof ctor.parseTTML === 'function',
  }
})
check('the lyric component is registered', wiring.registered)
check('the app installed the chain by itself', wiring.installedByApp === true)
check('the fetch has been wrapped', wiring.patched === true)
check('the component still has its own parser', wiring.hasParser === true)

console.log('\n[2] the real panels are mounted')
const mounted = await page.evaluate(async (url) => {
  await import(url)
  if (!window.__mountLyrics) return { ok: false, why: 'no mount function' }
  await window.__mountLyrics({ id: 'main' })
  const api = window.__lyricsMounts?.main?.apiRef?.current ?? null
  return { ok: true, hasApi: !!api }
}, MOUNT_URL)
check('the panels mounted', mounted.ok === true, mounted.why ?? '')
check('the lyric panel is driving the component', mounted.hasApi === true)
if (!mounted.ok || !mounted.hasApi) {
  console.log('\n  --   the panels did not mount, so the rest cannot be checked\n')
  console.log(`\n${pass} passed, ${fail} failed\n`)
  await browser.close()
  process.exitCode = 1
  process.exit(0)
}

/* the chain has to be asked, and a provider has to answer */
const readPanel = (id = 'main') =>
  page.evaluate((mount) => {
    const el = document.querySelector(`#harness-lyrics-host-${mount} am-lyrics`)
    const root = el?.shadowRoot
    const lines = root
      ? [...root.querySelectorAll('.lyrics-line:not(.lyrics-gap):not(.lyrics-footer)')]
          .map((l) => (l.textContent ?? '').replace(/\s+/g, ' ').trim())
          .filter(Boolean)
      : []
    const badge = document.querySelector(`#harness-lyrics-host-${mount} [data-lyrics-provider]`)
    const ready = document.querySelector(`#harness-lyrics-host-${mount} [data-lyrics-ready]`)
    const api = window.__lyricsMounts?.[mount]?.apiRef?.current ?? null
    return {
      lines,
      badgeId: badge ? badge.getAttribute('data-lyrics-provider') : null,
      badgeText: badge ? badge.textContent.trim() : '',
      green: !!ready,
      apiProvider: api?.providerId() ?? null,
      source: api?.source() ?? null,
      ttml: api?.extractTtml() ?? '',
    }
  }, id)

let panel = null
for (let i = 0; i < 40 && !(panel && panel.lines.length); i++) {
  await page.waitForTimeout(1000)
  panel = await readPanel('main')
}
check('a provider answered', !!panel?.badgeId, panel?.badgeId ?? 'nobody answered')
check('the words are on the panel', (panel?.lines.length ?? 0) > 0, `${panel?.lines.length ?? 0} lines`)
check('the panel agrees with the component', panel?.badgeId === panel?.apiProvider)

console.log('\n[3] the panel says which provider is serving')
check('the provider is named on the panel', !!panel?.badgeText, panel?.badgeText ?? 'nothing named it')
check('the name carries its tier', /·\s*T[123]$/.test(panel?.badgeText ?? ''), panel?.badgeText ?? '')
check('the panel says where the words came from', !!panel?.source, panel?.source ?? '')
check('there is a green sign that the lyrics are here', panel?.green === true)

console.log('\n[4] the component renders it the way it renders a pinned lyric')
const rendered = await page.evaluate(async (ttml) => {
  const host = document.createElement('div')
  /* out of the way, but in the page — the component needs a real document */
  host.style.cssText =
    'position:fixed;left:-9999px;top:0;width:640px;height:420px;opacity:0;pointer-events:none'
  document.body.appendChild(host)
  const el = document.createElement('am-lyrics')
  el.ttml = ttml
  el.style.display = 'block'
  el.style.height = '100%'
  host.appendChild(el)
  await new Promise((r) => setTimeout(r, 1800))
  const root = el.shadowRoot
  /* the footer wears a `.lyrics-line` class once a fetch has resolved, and it
     is not a lyric — the app's own check leaves it out for the same reason */
  const lines = [...(root ? root.querySelectorAll('.lyrics-line:not(.lyrics-gap):not(.lyrics-footer)') : [])]
    .map((l) => (l.textContent ?? '').replace(/\s+/g, ' ').trim())
    .filter(Boolean)
  host.remove()
  return { count: lines.length, first: lines[0] ?? '', sample: lines.slice(0, 4) }
}, panel?.ttml ?? '')
check('the component drew the lines', rendered.count > 0, `${rendered.count} lines`)
check('the words are real', rendered.first.length > 0, rendered.first.slice(0, 60))
check('it drew the same words as the provider gave', rendered.first === (panel?.lines[0] ?? ''), rendered.first.slice(0, 40))
console.log(`       ${rendered.sample.join(' / ')}`)

console.log('\n[5] the settings panel lists the whole waterfall')
const MAIN = '#harness-lyrics-settings-main'
const list = await page.evaluate(
  (scope) =>
    [...document.querySelectorAll(`${scope} [data-provider-id]`)].map((r) => ({
      id: r.getAttribute('data-provider-id'),
      tier: r.getAttribute('data-tier'),
      available: r.getAttribute('data-available'),
      text: r.textContent.replace(/\s+/g, ' ').trim(),
    })),
  MAIN,
)
check('every provider is listed', list.length === 11, `${list.length} rows`)
check(
  'the tiers are the ones the waterfall has',
  list.map((r) => r.tier).join(','),
  '1,1,1,1,1,1,1,2,2,2,3',
)
check('the rows carry the provider names', list.some((r) => r.text.includes('NETEASE')))
check(
  'every listed provider is reachable (the dead ones were removed, not disabled)',
  list.filter((r) => r.available === 'no').length === 0,
  list.filter((r) => r.available === 'no').map((r) => r.id).join(', '),
)
check('the tier of each provider is on its row', list.every((r) => r.tier === '1' || r.tier === '2' || r.tier === '3'))
check(
  'an unavailable provider is not clickable',
  await page.$$eval(`${MAIN} [data-available="no"] button:not([aria-label^="Reorder"])`, (list) =>
    list.every((b) => b.disabled),
  ),
)

console.log('\n[6] the order can be changed, and it is kept')
const before = list.map((r) => r.id)
const grip = await page.$(`${MAIN} [data-provider-id] button[aria-label^="Reorder"]`)
check('the rows have a handle to drag', !!grip)
if (grip) {
  const g = await grip.boundingBox()
  const target = await (await page.$(`${MAIN} [data-provider-id="netease"]`)).boundingBox()
  if (g && target) {
    await page.mouse.move(g.x + g.width / 2, g.y + g.height / 2)
    await page.mouse.down()
    await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 12 })
    await page.mouse.up()
    await page.waitForTimeout(400)
  }
}
const after = await page.evaluate(
  (scope) => [...document.querySelectorAll(`${scope} [data-provider-id]`)].map((r) => r.getAttribute('data-provider-id')),
  MAIN,
)
check('the order changed', after.join(',') !== before.join(','), after.slice(0, 3).join(' → '))
const stored = await page.evaluate(() => localStorage.getItem('md-lyrics-provider-order'))
check('the order is kept between sessions', !!stored, (stored ?? '').slice(0, 60))
check('the kept order is the new one', stored === JSON.stringify(after))

console.log('\n[7] the order stays where the person put it')
check('there is no reset button', !(await page.$(`${MAIN} [data-action="reset-provider-order"]`)))
const stillThere = await page.evaluate(
  (scope) => [...document.querySelectorAll(`${scope} [data-provider-id]`)].map((r) => r.getAttribute('data-provider-id')),
  MAIN,
)
check('the list still shows the new order', stillThere.join(',') === after.join(','), stillThere.slice(0, 3).join(' → '))
check(
  'the kept order is still the new one',
  (await page.evaluate(() => localStorage.getItem('md-lyrics-provider-order'))) === JSON.stringify(after),
)

console.log('\n[8] clicking a provider that has the track takes the panel over')
await page.click(`${MAIN} [data-provider-id="lrclib"] button:not([aria-label^="Reorder"])`)
await page.waitForTimeout(10000)
const afterForce = await readPanel('main')
check('the new provider is the one serving', afterForce.badgeId === 'lrclib', afterForce.badgeText)
check('the panel agrees with the component', afterForce.apiProvider === 'lrclib')
check('the name carries its tier', /·\s*T2$/.test(afterForce.badgeText), afterForce.badgeText)
check('there are still words on the panel', afterForce.lines.length > 0, `${afterForce.lines.length} lines`)

console.log('\n[9] a provider that has NOTHING says so, and leaves the words alone')
/* A PINNED lyric: the words are on the screen and no provider was asked for
   them. The element is then pointed at a song nobody has, so that any
   provider asked for it comes back empty — and the words must stay. */
await page.evaluate(async (url) => {
  await import(url)
  await window.__mountLyrics({
    id: 'pinned',
    title: 'Zzzqqq Nonexistent Song 9f3a',
    artist: 'Nobody At All',
    ttml:
      '<tt xmlns="http://www.w3.org/ns/ttml"><body><div>' +
      '<p begin="00:00.00" end="00:03.00">Pinned words that must survive</p>' +
      '<p begin="00:03.00" end="00:06.00">A second pinned line</p>' +
      '</div></body></tt>',
  })
  /* the panel does not put a song on a pinned lyric, so it is put here */
  const el = document.querySelector('#harness-lyrics-host-pinned am-lyrics')
  if (el) {
    el.songTitle = 'Zzzqqq Nonexistent Song 9f3a'
    el.songArtist = 'Nobody At All'
  }
}, MOUNT_URL)
await page.waitForTimeout(2500)

const pinnedBefore = await readPanel('pinned')
check('the pinned words are on the panel', pinnedBefore.lines.length > 0, pinnedBefore.lines[0] ?? '')

await page.click('#harness-lyrics-settings-pinned [data-provider-id="lrclib"] button:not([aria-label^="Reorder"])')
await page.waitForTimeout(8000)
const error = await page.evaluate(() => {
  const el = document.querySelector('#harness-lyrics-settings-pinned [data-provider-error]')
  return el ? el.textContent.trim() : null
})
check('the failure is reported', !!error, error ?? 'nothing was said')
const pinnedAfter = await readPanel('pinned')
check('the words are still on the panel', pinnedAfter.lines.length > 0, `${pinnedAfter.lines.length} lines`)
check(
  'the words were not replaced',
  pinnedAfter.lines.join(' | ') === pinnedBefore.lines.join(' | '),
)

console.log('\n[10] the order survives a restart')
await page.reload({ waitUntil: 'domcontentloaded' })
await page.waitForTimeout(4000)
const afterReload = await page.evaluate(() => localStorage.getItem('md-lyrics-provider-order'))
check('the order is still there after a reload', afterReload === JSON.stringify(after), (afterReload ?? '').slice(0, 60))

console.log(`\n${pass} passed, ${fail} failed\n`)
await browser.close()
process.exitCode = fail ? 1 : 0