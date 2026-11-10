import { chromium } from 'playwright-core'

/* which launch flags actually give headless msedge a working WebGL2?
   liquidGL's GPU path (canvas + init + scrim yield) needs it — without it
   every run silently exercises only the CSS fallback. */
const combos = [
  ['baseline', []],
  ['unsafe-swiftshader', ['--enable-unsafe-swiftshader']],
  ['unsafe+angle-sw', ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader']],
  ['gl-swiftshader', ['--use-gl=swiftshader']],
  ['ignore-gpu+unsafe', ['--ignore-gpu-blocklist', '--enable-unsafe-swiftshader']],
  ['disable-gpu+unsafe', ['--disable-gpu', '--enable-unsafe-swiftshader']],
]
for (const [name, args] of combos) {
  try {
    const b = await chromium.launch({ channel: 'msedge', headless: true, args })
    const p = await b.newPage()
    const r = await p.evaluate(() => {
      const c = document.createElement('canvas')
      const gl2 = !!c.getContext('webgl2')
      const gl1 = gl2 || !!c.getContext('webgl')
      return { gl2, gl1, gpu: 'gpu' in navigator }
    })
    console.log(`[webglprobe] ${name}: ${JSON.stringify(r)}`)
    await b.close()
  } catch (e) {
    console.log(`[webglprobe] ${name}: LAUNCH FAIL ${String(e).slice(0, 140)}`)
  }
}
