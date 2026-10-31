import { chromium } from 'playwright-core'

const BASE = process.env.BASE ?? 'http://127.0.0.1:5199'
const browser = await chromium.launch({
  channel: 'msedge',
  headless: true,
  args: ['--autoplay-policy=no-user-gesture-required'],
})
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.addInitScript(() => {
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
    transformCallback: (cb) => cb,
    invoke: () => Promise.resolve(null),
    plugins: {},
    resources: {},
  }
})
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200)))
await page.goto(BASE + '/', { waitUntil: 'networkidle' })
await page.waitForTimeout(2500)

const out = {}

/* ---- 4 + 6 — CD settings: covers hidden, collection row + flyout ---- */
await page.locator('button[aria-label="CD settings"]').click()
await page.waitForTimeout(400)
out.cdPanel = await page.evaluate(() => {
  const p = [...document.querySelectorAll('.settings-panel')].find((q) => q.textContent?.includes('CD SETTINGS'))
  if (!p) return { found: false }
  /* textContent sees inside `hidden` subtrees — check real visibility */
  const visible = (label) =>
    [...p.querySelectorAll('span, div, button')].some(
      (el) => el.textContent?.trim() === label && el.getClientRects().length > 0,
    )
  return {
    found: true,
    coversHidden: !visible('TRACK COVER') && !visible('PLAYLIST COVER'),
    collectionRow: visible('CD COLLECTION'),
  }
})
/* hover the collection row → the portal flyout */
const row = page.locator('div', { hasText: 'CD COLLECTION' }).locator('visible=true').last()
await row.hover()
await page.waitForTimeout(400)
out.flyout = await page.evaluate(() => {
  const f = document.querySelector('div[aria-label="CD collection"]')
  if (!f) return { found: false }
  const t = f.textContent ?? ''
  return { found: true, clearAll: t.includes('CLEAR ALL'), empty: t.includes('NOTHING SAVED YET') }
})

/* ---- 7 — colour picker: save, list, rename a gradient preset ---- */
const wpBtn = page.locator('button[aria-label="Wallpaper colour"]')
await wpBtn.click()
await page.waitForTimeout(400)
const picker = page.locator('div[aria-label="Wallpaper colour"]')
await picker.locator('button', { hasText: 'GRADIENT' }).click()
await page.waitForTimeout(200)
await picker.locator('button', { hasText: 'SAVE PRESET' }).click()
await page.locator('input[aria-label="Gradient preset name"]').fill('MIDNIGHT CHROME')
await page.keyboard.press('Enter')
await page.waitForTimeout(300)
out.presetSaved = await page.evaluate(() => {
  const dlg = document.querySelector('div[aria-label="Wallpaper colour"]')
  return dlg?.textContent?.includes('MIDNIGHT CHROME') ?? false
})
/* rename it */
await picker.locator('button[aria-label*="Rename"]').first().click()
await page.locator('input[aria-label="Rename gradient preset"]').fill('CHROME NOON')
await page.keyboard.press('Enter')
await page.waitForTimeout(300)
out.presetRenamed = await page.evaluate(() => {
  const dlg = document.querySelector('div[aria-label="Wallpaper colour"]')
  const t = dlg?.textContent ?? ''
  return t.includes('CHROME NOON') && !t.includes('MIDNIGHT CHROME')
})
out.presetPersisted = await page.evaluate(() => {
  try {
    const raw = JSON.parse(localStorage.getItem('md-wall-gradient-presets') ?? '[]')
    return Array.isArray(raw) && raw.some((p) => p.name === 'CHROME NOON')
  } catch {
    return false
  }
})

console.log(JSON.stringify(out, null, 2))
await browser.close()
