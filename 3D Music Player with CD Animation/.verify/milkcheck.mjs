import { chromium } from 'playwright-core'

const BASE = process.env.BASE ?? 'http://127.0.0.1:5199'
const browser = await chromium.launch({ channel: 'msedge', headless: true })
const page = await browser.newPage({ viewport: { width: 800, height: 600 } })
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 200)))
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' })
await page.waitForTimeout(1500)

const result = await page.evaluate(async () => {
  const mod = await import('/node_modules/milkdrop-preset-converter/dist/milkdrop-preset-converter.min.js')
  const conv = mod.default ?? (typeof mod.convertPreset === 'function' ? mod : window.milkdropPresetConverter)

  /* a minimal MilkDrop 2 preset, shaped exactly like the guide's sample */
  const milk = [
    'MILKDROP_PRESET_VERSION=201',
    'PSVERSION=201',
    '[preset00]',
    'fRating=3.000000',
    'fGammaAdj=2.000000',
    'decay=0.980000',
    'zoom=1.000000',
    'wave_r=0.650000',
    'per_frame_init_1=vol = 0.2;',
    'per_frame_1=zoom = zoom + 0.015*sin(time*0.7);',
    'per_frame_2=decay = 0.97 + 0.02*sin(time*2);',
    'comp_1=`shader_body { ret = tex2D(sampler_main, uv).xyz; }`',
  ].join('\r\n')

  const raw = await conv.convertPreset(milk)
  const { presetParts, ...preset } = raw
  return {
    keys: Object.keys(preset).sort(),
    shapes: Array.isArray(preset.shapes) ? preset.shapes.length : -1,
    waves: Array.isArray(preset.waves) ? preset.waves.length : -1,
    hasFrameStr: typeof preset.frame_eqs_str === 'string' && preset.frame_eqs_str.length > 0,
    hasInitStr: typeof preset.init_eqs_str === 'string',
    hasComp: typeof preset.comp === 'string' && preset.comp.length > 0,
    hasWarp: typeof preset.warp === 'string',
    decay: preset.baseVals ? preset.baseVals.decay : undefined,
  }
})

console.log(JSON.stringify(result, null, 2))
/* the guide's checklist: 4 shapes, 4 waves, the _str equation strings, and
   baseVals present (defaults stripped — decay=0.98 IS a default) */
const ok =
  result.shapes === 4 &&
  result.waves === 4 &&
  result.hasFrameStr &&
  result.hasInitStr &&
  result.hasComp
console.log(ok ? 'CONVERTER VERDICT: PASS' : 'CONVERTER VERDICT: FAIL')
await browser.close()
